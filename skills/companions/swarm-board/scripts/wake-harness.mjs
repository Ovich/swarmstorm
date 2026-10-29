// Wake harness, run by hand: node scripts/wake-harness.mjs [<empty dir>]. It drives this checkout's swarm CLI as
// several members of several runs in a throwaway data home (the directory given, which must be missing or empty),
// and for each event asks one question: does a member sitting in `wait --mentions` wake or sleep? Cases that must
// not wake (plain talk, other runs, claims, joins, bursts) and cases that must (mentions, pause/resume, an
// agreement party's merge, all-joined, an urgent post) print PASS, FAIL or PENDING (the verb or flag is not there
// yet) with the wake latency, and the run exits 1 on any FAIL. It starts its own board server and stops it at the
// end. Never part of `npm test`: it takes minutes and sleeps on purpose.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// no dir given: a fresh one under the system temp folder, named in the first line (G11)
const HOME = process.argv[2] ? path.resolve(process.argv[2]) : fs.mkdtempSync(path.join(os.tmpdir(), "wake-harness-"));
if (!process.argv[2]) console.log(`data home: ${HOME}`);
if (fs.existsSync(HOME) && fs.readdirSync(HOME).length > 0) {
  console.error(`usage: node scripts/wake-harness.mjs [<empty dir>]   (${HOME} is not empty; with no dir, a fresh temp one is made)`);
  process.exit(2);
}
fs.mkdirSync(HOME, { recursive: true });
// a throwaway repository in the data home: members run from its root, so paths are repository-relative; a code
// run's join makes a worktree and a branch per seat, which must never land in this checkout
const REPO = path.join(HOME, "repo");
fs.mkdirSync(REPO);
fs.writeFileSync(path.join(REPO, "README.md"), "wake harness\n");
for (const argv of [["init", "-q", "-b", "main"], ["add", "."], ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "root"], ["branch", "trunk"]])
  if (spawnSync("git", argv, { cwd: REPO }).status !== 0) {
    console.error(`git ${argv.join(" ")} failed in ${REPO}`);
    process.exit(2);
  }
// the CLI under test is this checkout's source, bundled into the data home (dist-cli/ may be older than src/)
const CLI = path.join(HOME, "swarm-cli.mjs");
const built = spawnSync(process.execPath, [path.join(ROOT, "build.mjs"), "--outfile", CLI], { cwd: ROOT, encoding: "utf8" });
if (built.status !== 0 || !fs.existsSync(CLI)) {
  console.error("build failed (npm ci in the swarm-board folder first?):", built.stdout + built.stderr);
  process.exit(2);
}
const env = { ...process.env, SWARMSTORM_HOME: HOME, SWARM_AIVIEW: path.join(HOME, "none.mjs") };
delete env.CLAUDE_CODE_SESSION_ID; // outside a harness session the CLI spawns each member's link itself
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sw = (...a) => {
  const r = spawnSync(process.execPath, [CLI, ...a], { cwd: REPO, env, encoding: "utf8" });
  return { code: r.status, out: (r.stdout + r.stderr).trim() };
};
// a code run merges under the merge lock, onto a branch no checkout holds
const lockMerge = (as) => sw("merge-lock", "--onto", "trunk", "--as", as);
// merged takes only a sha git knows on the branch (V1): trunk's own head stands in for each merge
const trunkSha = () => spawnSync("git", ["rev-parse", "--short", "trunk"], { cwd: REPO, encoding: "utf8" }).stdout.trim();
const probe = (as, timeout = 8000) => {
  const t0 = Date.now();
  const p = spawn(process.execPath, [CLI, "wait", "--mentions", "--as", as, "--timeout", String(timeout)], { cwd: REPO, env });
  let out = "";
  p.stdout.on("data", (d) => (out += d));
  p.stderr.on("data", (d) => (out += d));
  const done = new Promise((res) => p.on("close", () => res({ ms: Date.now() - t0, out: out.trim() })));
  return { done, settled: () => p.exitCode !== null };
};
const missing = (r) => r.code !== 0 && /unknown (verb|flag|option)|unrecognized|not a verb|no such verb/i.test(r.out);

const seatsFile = (ids, extra = {}) => {
  const f = path.join(HOME, `seats-${ids.join("")}.json`);
  fs.writeFileSync(f, JSON.stringify(ids.map((id) => ({ id, role: "worker", ...(extra[id] ?? {}) }))));
  return f;
};
const open = (group, ids, extra) =>
  Number(sw("open", "--kind", "task", "--group", group, "--title", group, "--seats", seatsFile(ids, extra), "--protocol", "none").out.split("\n").find((l) => /^\d+$/.test(l)));
const join = (run, id, group) => sw("join", "--run", String(run), "--seat", id, "--doing", "waiting", "--as", `${group}/${id}`);
const post = (as, body, ...x) => sw("post", "--as", as, body, ...x);

const A = open("ra", ["w1", "w2", "s"]);
const B = open("rb", ["x1"]);
const S = open("rs", ["sub", "m"], { sub: { on: ["any:merged", "agreement"] } });
for (const id of ["w1", "w2", "s"]) join(A, id, "ra");
join(B, "x1", "rb");
for (const id of ["sub", "m"]) join(S, id, "rs");
for (const m of ["ra/w1", "ra/w2", "ra/s", "rb/x1", "rs/sub", "rs/m", "ra/orchestrator"]) sw("deliver", "--as", m); // drain join noise

const results = [];
const record = (r) => {
  results.push(r);
  console.log(r.status, r.id, r.detail ?? "");
};

/** One case: `who` waits; after 1.5 s `action` runs; `expect` is "wake" or "sleep". An action may return {pending}. */
async function kase(id, expect, who, action, timeout = 6000) {
  sw("deliver", "--as", who);
  const pr = probe(who, timeout);
  await sleep(1500);
  const act = action();
  const r = await pr.done;
  if (act?.pending) return record({ id, status: "PENDING", detail: act.pending });
  const woke = r.ms < timeout - 300 && r.out.length > 0;
  const ms = woke ? r.ms - 1500 : null;
  const got = r.out.split("\n").slice(0, 3).join(" | ").slice(0, 140);
  const ok = (expect === "wake") === woke;
  const acted = ok ? "" : ` · action: ${(act?.out ?? "").split("\n")[0].slice(0, 120)}`;
  record({ id, status: ok ? "PASS" : "FAIL", expect, woke, ms, detail: `${expect}: ${woke ? `woke ${ms}ms · ${got}` : "slept"}${acted}` });
}
const check = (id, ok, detail) => record({ id, status: ok ? "PASS" : "FAIL", detail });

// A: must not wake ra/s
await kase("A1 plain post own run", "sleep", "ra/s", () => post("ra/w1", "just talking"));
await kase("A2 plain post other run", "sleep", "ra/s", () => post("rb/x1", "other run talk"));
await kase("A3 mention of another member", "sleep", "ra/s", () => post("ra/orchestrator", "@w2 do X"));
await kase("A4a doing event", "sleep", "ra/s", () => sw("doing", "--as", "ra/w1", "editing"));
await kase("A4b claim", "sleep", "ra/s", () => sw("claim", "--as", "ra/w1", "comms-test/zz.txt", "--new"));
await kase("A4c release", "sleep", "ra/s", () => sw("release", "--as", "ra/w1", "comms-test/zz.txt"));
await kase("A6 burst 30 posts", "sleep", "ra/s", () => {
  let r;
  for (let i = 0; i < 30; i++) r = post("ra/w1", `burst ${i}`);
  return r;
}, 20000);
await kase("A7 --about file not held", "sleep", "ra/s", () => post("ra/w1", "about readme", "--about", "README.md"));
await kase("A8 own post", "sleep", "ra/s", () => post("ra/s", "me talking"));
await kase("A11 agreement on file not held", "sleep", "ra/s", () => sw("agree", "--as", "ra/w1", "w2 owns README", "--about", "README.md"));
await kase("A10 other run paused", "sleep", "ra/s", () => sw("pause", "other run pause", "--as", "rb/orchestrator"));
sw("resume", "go", "--as", "rb/orchestrator");
sw("deliver", "--as", "ra/s");

// B: must wake
await kase("B1a @id", "wake", "ra/s", () => post("ra/orchestrator", "@s hello"));
await kase("B1b @group/id", "wake", "ra/s", () => post("ra/w1", "@ra/s hello"));
await kase("B1c @swarm", "wake", "ra/s", () => post("ra/orchestrator", "@swarm all hands"));
await kase("B1d @orchestrator", "wake", "ra/orchestrator", () => post("ra/w1", "@orchestrator done"));
const nick = sw("roster", "--as", "ra/orchestrator").out.match(/(\w+) (\w+) · ra\/s\b/);
if (nick) await kase("B1e @Nick", "wake", "ra/s", () => post("ra/w1", `@${nick[1]}${nick[2]} hi`));
else record({ id: "B1e @Nick", status: "FAIL", detail: "no funny name for ra/s in the roster" });
await kase("B3a subscribed any:merged (another seat's merge)", "wake", "rs/sub", () => {
  sw("claim", "--as", "rs/m", "src/b3a.txt", "--new");
  lockMerge("rs/m");
  return sw("merged", "--report", "-", "--as", "rs/m", trunkSha(), "--files", "src/b3a.txt");
}, 5000);
await kase("B4 agreement on file it holds", "wake", "ra/s", () => {
  sw("claim", "--as", "ra/s", "README.md");
  sw("deliver", "--as", "ra/s");
  return sw("agree", "--as", "ra/w1", "@ra/s I append after you", "--about", "README.md");
});
await kase("B5a pause wakes member", "wake", "ra/s", () => sw("pause", "stop", "--as", "ra/orchestrator"));
await kase("B5b resume wakes member", "wake", "ra/s", () => sw("resume", "go on", "--as", "ra/orchestrator"));
await kase("B5c phase wakes member", "wake", "ra/s", () => sw("phase", "p1", "do it", "--as", "ra/orchestrator"));
lockMerge("ra/w1");
await kase("B8 agreement party: merged of the agreed file", "wake", "ra/s", () => sw("merged", "--report", "-", "--as", "ra/w1", trunkSha(), "--files", "README.md"));
// D7: the party to an agreement hears the merge without holding a claim
sw("release", "--as", "ra/s", "README.md");
lockMerge("ra/w1");
await kase("D7 agreement party with no claim woken by merged", "wake", "ra/s", () => sw("merged", "--report", "-", "--as", "ra/w1", trunkSha(), "--files", "README.md"));

// D8: a paused run holds a mention; the resume brings it
{
  sw("pause", "hold", "--as", "ra/orchestrator");
  sw("deliver", "--as", "ra/s");
  const pr = probe("ra/s", 12000);
  await sleep(1500);
  post("ra/w1", "@s while paused");
  await sleep(3500);
  const heldWhilePaused = !pr.settled();
  sw("resume", "go", "--as", "ra/orchestrator");
  const r = await pr.done;
  check("D8 paused run: a mention does not wake, the resume does", heldWhilePaused && r.ms < 11000 && /while paused/.test(r.out), `held ${heldWhilePaused}, resume woke after ${r.ms}ms, got ${r.out.split("\n")[0]?.slice(0, 80)}`);
}
sw("deliver", "--as", "ra/s");

// D10: an urgent post wakes a paused member
await kase("D10 post --urgent wakes a paused member", "wake", "ra/s", () => {
  sw("pause", "hold again", "--as", "ra/orchestrator");
  sw("deliver", "--as", "ra/s");
  const r = post("ra/w1", "urgent news", "--urgent");
  return missing(r) ? { pending: `post --urgent: ${r.out.split("\n")[0].slice(0, 80)}` } : r;
});
sw("resume", "go", "--as", "ra/orchestrator");
sw("deliver", "--as", "ra/s");

// D3 / D5 / D17: composition and the lobby, on a fresh run of three declared seats
const C = open("rc", ["a", "b", "c"]);
const ja = join(C, "a", "rc");
{
  const lines = ja.out.split("\n").filter((l) => /not joined/i.test(l)).join("\n");
  check("D3 join answer lists every declared seat", /\bb\b/.test(lines) && /\bc\b/.test(lines), lines.replace(/\n/g, " | "));
}
join(C, "b", "rc");
sw("deliver", "--as", "rc/orchestrator");
await kase("D5 all-joined wakes the orchestrator", "wake", "rc/orchestrator", () => join(C, "c", "rc"), 5000);
const und = join(C, "zz", "rc");
check("D17 join of an undeclared seat is refused, pointing to seat add", und.code !== 0 && /seat add/.test(und.out), und.out.split("\n")[0].slice(0, 120));

// D4: a seat added late, and its join, are carried: w1 sleeps, and finds them at its next deliver
sw("deliver", "--as", "ra/w1");
let added;
await kase("D4 late seat add and join do not wake a member", "sleep", "ra/w1", () => {
  added = sw("seat", "add", "w5", "--run", String(A), "--role", "worker");
  if (missing(added)) return { pending: `seat add: ${added.out.split("\n")[0].slice(0, 80)}` };
  return join(A, "w5", "ra");
});
if (added && !missing(added)) {
  const carried = sw("deliver", "--as", "ra/w1").out;
  check("D4 the late seat is in w1's next deliver", /w5/.test(carried), carried.split("\n").filter((l) => /w5/.test(l))[0]?.slice(0, 100) ?? "w5 not in deliver");
}

// C: timing
const lat = [];
for (let i = 0; i < 5; i++) {
  sw("deliver", "--as", "ra/s");
  const pr = probe("ra/s");
  await sleep(1000);
  const t = Date.now();
  post("ra/orchestrator", `@s ping ${i}`);
  await pr.done;
  lat.push(Date.now() - t);
}
record({ id: "C1 latency ms (5 mentions)", status: Math.max(...lat) < 4000 ? "PASS" : "FAIL", detail: lat.join(" ") });
sw("deliver", "--as", "ra/s");
post("ra/orchestrator", "@s before you waited");
const t4 = Date.now();
const r4 = await probe("ra/s").done;
record({ id: "C4 mention posted before the wait returns at once", status: Date.now() - t4 < 4000 && /before you waited/.test(r4.out) ? "PASS" : "FAIL", detail: `${Date.now() - t4}ms` });
sw("deliver", "--as", "ra/s");
for (let i = 0; i < 5; i++) post("ra/w1", `@s race ${i}`);
const got = sw("deliver", "--as", "ra/s").out;
const n = (got.match(/race \d/g) ?? []).length;
record({ id: "C5 five mentions in a burst all delivered", status: n === 5 ? "PASS" : "FAIL", detail: `${n} of 5` });

// E: answer noise, before the close
const e1 = post("ra/w2", "plain");
record({ id: "E1 a plain post's answer is short", status: e1.code === 0 && e1.out.split("\n").length <= 3 ? "PASS" : "FAIL", detail: e1.out.split("\n").length + " lines: " + e1.out.split("\n")[0].slice(0, 60) });

// A9: after close
sw("close", "--run", String(A));
const r9 = await probe("ra/s", 4000).done;
record({ id: "A9 a wait after the run closed returns", status: r9.ms < 3700 ? "PASS" : "FAIL", detail: `${r9.ms}ms · ${r9.out.split("\n")[0]?.slice(0, 80)}` });

// stop the board server this run started
const find = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const f = find(p);
      if (f) return f;
    } else if (e.name === "swarm-server.json") return p;
  }
  return null;
};
const stateFile = find(HOME);
if (stateFile) {
  try {
    process.kill(JSON.parse(fs.readFileSync(stateFile, "utf8")).pid);
  } catch {
    /* already gone */
  }
}
fs.writeFileSync(path.join(HOME, "wake-results.json"), JSON.stringify(results, null, 1));
const count = (s) => results.filter((r) => r.status === s).length;
console.log(`done: ${count("PASS")} PASS, ${count("FAIL")} FAIL, ${count("PENDING")} PENDING`);
process.exit(count("FAIL") ? 1 : 0);
