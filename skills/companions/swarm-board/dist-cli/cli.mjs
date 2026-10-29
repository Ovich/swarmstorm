import { createRequire as __swarmRequire } from "node:module"; const require = __swarmRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __commonJS = (cb, mod) => function __require2() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/board/home.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
var homeFromEnv, NEW_HOME, OLD_HOME, DATA_ROOT, SQLITE_PATH;
var init_home = __esm({
  "src/board/home.ts"() {
    "use strict";
    homeFromEnv = process.env.SWARMSTORM_HOME ?? process.env.CHARRETTE_HOME;
    NEW_HOME = path.join(os.homedir(), "swarmstorm_appdata");
    OLD_HOME = path.join(os.homedir(), "charrette_appdata");
    DATA_ROOT = homeFromEnv ? path.resolve(homeFromEnv) : !fs.existsSync(NEW_HOME) && fs.existsSync(OLD_HOME) ? OLD_HOME : NEW_HOME;
    SQLITE_PATH = path.join(DATA_ROOT, "swarm.sqlite");
  }
});

// src/board/mentions.ts
function planCode(plan) {
  const words = plan.split(/[-_\s.]+/).filter((w) => w && !/^\d+$/.test(w));
  if (words.length === 0) return plan.slice(0, 2).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
function parseMentions(body, senderPlan, plans, names) {
  const out = /* @__PURE__ */ new Set();
  for (const m of body.matchAll(MENTION)) {
    const token = m[1].replace(/[.\-]+$/, "");
    const named = names?.get(token.toLowerCase());
    if (named) {
      out.add(named);
    } else if (token.includes("/")) {
      const [plan, seat] = token.split("/");
      out.add(`${plan}/${seat === "all" ? "*" : seat}`);
    } else if (token.includes("\xB7")) {
      const [code, seat] = token.split("\xB7");
      for (const plan of plans) if (planCode(plan) === code.toUpperCase()) out.add(`${plan}/${seat === "all" ? "*" : seat}`);
    } else if (token === "swarm") {
      out.add(`${senderPlan}/*`);
    } else if (token === "all") {
      continue;
    } else if (isCodeShaped(token) && plansOfCode(token, plans).length) {
      for (const plan of plansOfCode(token, plans)) out.add(`${plan}/*`);
    } else {
      out.add(`${senderPlan}/${token}`);
    }
  }
  return [...out];
}
function unmatchedMentions(body, senderPlan, plans, names) {
  const handleOf = new Map([...names ?? /* @__PURE__ */ new Map()].map(([handle, member]) => [member, handle]));
  const members = /* @__PURE__ */ new Set([...handleOf.keys(), ...[senderPlan, ...plans].map((p) => `${p}/orchestrator`)]);
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const m of body.matchAll(MENTION)) {
    const token = m[1].replace(/[.\-]+$/, "");
    if (seen.has(token)) continue;
    seen.add(token);
    if (names?.has(token.toLowerCase())) continue;
    if (token === "all") {
      out.push({ name: token, closest: ["swarm"] });
      continue;
    }
    const targets = parseMentions(`@${token}`, senderPlan, plans, names);
    if (targets.length && targets.every((t) => t.endsWith("/*") || members.has(t))) continue;
    if (isCodeShaped(token)) {
      const codes = [...new Set(plans.map(planCode))];
      out.push({ name: token, closest: codes.sort((a, b) => editDistance(token.toUpperCase(), a) - editDistance(token.toUpperCase(), b)).slice(0, 3) });
      continue;
    }
    const wanted = token.split(/[/·]/).pop().toLowerCase();
    const gap = (member) => Math.min(editDistance(wanted, member.slice(member.lastIndexOf("/") + 1).toLowerCase()), editDistance(wanted, handleOf.get(member) ?? member));
    out.push({ name: token, closest: [...members].sort((a, b) => gap(a) - gap(b)).slice(0, 3) });
  }
  return out;
}
var isCodeShaped, plansOfCode, MENTION, nameHandle, editDistance;
var init_mentions = __esm({
  "src/board/mentions.ts"() {
    "use strict";
    isCodeShaped = (token) => /^[A-Za-z]{2}$/.test(token);
    plansOfCode = (code, plans) => plans.filter((plan) => planCode(plan) === code.toUpperCase());
    MENTION = /(?<![\w@])@([A-Za-z0-9][\w.\-]*(?:[\/·][A-Za-z0-9][\w.\-]*)?)/g;
    nameHandle = (nick) => nick.replace(/\s+/g, "").toLowerCase();
    editDistance = (a, b) => {
      let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
      for (let i = 1; i <= a.length; i++) {
        const row = [i];
        for (let j = 1; j <= b.length; j++) row.push(Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
        prev = row;
      }
      return prev[b.length];
    };
  }
});

// src/board/kinds.ts
function profileOf(kind) {
  const profile = PROFILES[kind];
  if (!profile || !Object.hasOwn(PROFILES, kind)) throw new Error(`unknown kind ${kind}: the kinds are ${Object.keys(PROFILES).join(", ")}`);
  return profile;
}
var run, carried, PROFILES;
var init_kinds = __esm({
  "src/board/kinds.ts"() {
    "use strict";
    run = (...events) => events.map((event) => ({ event, scope: "run" }));
    carried = (...events) => events.map((event) => ({ event, scope: "run", carry: true }));
    PROFILES = {
      plan: { kind: "plan", claims: true, mergeLock: true, worktree: true, member: "worker", wholeThread: false, defaults: { member: [], orchestrator: [...run("ended", "stale", "all-joined"), ...carried("done", "joined", "idle")] } },
      brainstorm: {
        kind: "brainstorm",
        claims: false,
        mergeLock: false,
        worktree: false,
        member: "seat",
        wholeThread: true,
        defaults: { member: [], orchestrator: [...run("agreement", "endorsement", "ended", "stale", "all-joined"), ...carried("done", "joined", "idle")] }
      },
      // a swarm without a plan (the `swarm` skill): workers in worktrees take tasks posted to them, as a plan's do slices
      task: { kind: "task", claims: true, mergeLock: true, worktree: true, member: "worker", wholeThread: false, defaults: { member: [], orchestrator: [...run("ended", "stale", "all-joined"), ...carried("done", "joined", "idle")] } }
    };
  }
});

// src/board/events.ts
function stalledMove(m, me, cli) {
  const meta = m.meta && "rule" in m.meta ? m.meta : null;
  if (meta?.members && meta.members.length > 1)
    return meta.members.map((one) => `${one.member}: ${one.rule ? stalledMove({ ...m, meta: { ...one, rule: one.rule } }, me, cli) : stalledMove({ ...m, meta: null }, me, cli)}`).join("; ");
  const id = meta?.member ?? "<member>";
  switch (meta?.rule) {
    case "ended":
      return "a post does not wake it: SendMessage it, or dispatch it again";
    case "in-turn":
      return "SendMessage it; if it does not answer, dispatch it again";
    case "background":
      return `ask it: ${cli} post ${word(`@${id} \u2026`)} --as ${word(me.name)}, or SendMessage it if its turn ended`;
    case "call":
      return "SendMessage it to stop the call";
    case "owing":
      return `${cli} post ${word(`@${id} your part of ${meta.phase ?? "<phase>"}`)} --as ${word(me.name)}: its wait returns on it`;
    case "lock":
      return `ask ${meta.holder ?? "its holder"} to unlock ${meta.lock ?? "<lock>"}, or to stop what it holds: ${cli} post ${word(`@${meta.holder ?? "<holder>"} \u2026`)} --as ${word(me.name)}`;
    default:
      return `read the thread, then address the member who owes a move (${cli} post "@<member> <what you need>" --as ${word(me.name)})`;
  }
}
function eventOf(m) {
  if (m.event && isEvent(m.event)) return m.event;
  return m.kind === "agreement" || m.kind === "endorsement" || m.kind === "urgent" ? m.kind : null;
}
function parseSubscriptions(spec) {
  const parts = (Array.isArray(spec) ? spec : [spec]).flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const p of parts) {
    const prefix = /^(any|main):/.exec(p)?.[0];
    const name = prefix ? p.slice(prefix.length) : p;
    if (!isEvent(name)) throw new Error(`unknown event ${name}: the events are ${NAMES.join(", ")}`);
    const sub = { event: name, scope: prefix ? "any" : "run" };
    if (!out.some((o) => o.event === sub.event && o.scope === sub.scope)) out.push(sub);
  }
  return out;
}
function formatSubscriptions(subs) {
  return subs.map((s) => `${s.scope === "any" ? `any:${s.event}` : s.event}${s.carry ? " (carried)" : ""}`).join(", ");
}
function mentions(m, me) {
  return m.mentions.includes(me.name) || m.mentions.includes(`${me.plan}/*`);
}
function wakes(m, me, subs) {
  if (m.from === me.name && !(m.event && isEvent(m.event) && EVENTS[m.event].toAuthor)) return false;
  if (mentions(m, me)) return true;
  const e = eventOf(m);
  if (!e) return false;
  if (EVENTS[e].always) return true;
  return subs.some((s) => !s.carry && s.event === e && (s.scope === "any" || m.run === me.run));
}
function carries(m, me, subs) {
  if (m.from === me.name && !(m.event && isEvent(m.event) && EVENTS[m.event].toAuthor)) return false;
  if (wakes(m, me, subs)) return false;
  const e = eventOf(m);
  if (!e) return false;
  if (EVENTS[e].ambient && m.run === me.run) return true;
  return subs.some((s) => s.carry === true && s.event === e && (s.scope === "any" || m.run === me.run));
}
var word, FOREGROUND_WAIT_MS, FOREGROUND_NOTE, foregroundWait, EVENTS, NAMES, isEvent;
var init_events = __esm({
  "src/board/events.ts"() {
    "use strict";
    init_kinds();
    word = (w) => /^[\w@%+=:,./-]+$/.test(w) ? w : `"${w.replace(/(["\\$`])/g, "\\$1")}"`;
    FOREGROUND_WAIT_MS = 17e4;
    FOREGROUND_NOTE = "it holds 170 s, as Claude Code detaches a foreground command that runs past 180 s; run it again when it returns empty";
    foregroundWait = (cli, me) => `${cli} wait --mentions --as ${word(me.name)} --timeout ${FOREGROUND_WAIT_MS}`;
    EVENTS = {
      // a seat backs another member's agreement (D36)
      agreement: {
        name: "agreement",
        next: (m, me, cli) => profileOf(me.kind).member === "seat" && m.from !== me.name ? `back it: ${cli} endorse ${m.seq} --as ${word(me.name)}` : null
      },
      endorsement: { name: "endorsement" },
      merged: { name: "merged" },
      joined: { name: "joined" },
      ended: { name: "ended" },
      stale: { name: "stale" },
      // an orchestrator silent STALE_MS, posted once in its run (D15); "back" when it calls again
      quiet: { name: "quiet" },
      back: { name: "back" },
      // when a run opens: its kind, group and title (D69)
      opened: { name: "opened" },
      closed: { name: "closed" },
      urgent: { name: "urgent", always: true },
      // the orchestrator opens a phase (`phase <name> <text>`), the current one ending with it: a separator on the thread;
      // it mentions `<group>/*`, so its own run's members wake and no other's, whatever the run's kind; a member
      // runs `done <name>` when its part is in
      phase: {
        name: "phase",
        next: (m, me, cli) => {
          const name = m.meta && "phase" in m.meta ? m.meta.phase : null;
          if (!name || me.seat === "orchestrator" || m.from === me.name) return null;
          return `when your part of ${name} is posted: ${cli} done ${word(name)} --as ${word(me.name)}`;
        }
      },
      // the orchestrator pauses its run (`pause [text]`): mentions `<group>/*`, every member stops and waits for the resume
      pause: {
        name: "pause",
        next: (m, me, cli) => {
          if (me.seat === "orchestrator" || m.from === me.name) return null;
          const pause3 = m.meta && "person" in m.meta ? m.meta : null;
          const why = pause3?.person ? `waiting on the person: ${pause3.text || "their decision"}; ` : "";
          return `${why}stop where you are: start nothing new, claim and merge nothing; wait in the foreground for the resume (${FOREGROUND_NOTE}): ${foregroundWait(cli, me)}`;
        }
      },
      // the orchestrator lifts the pause (`resume [text]`), its message in the body: every member continues
      resume: {
        name: "resume",
        next: (m, me) => me.seat === "orchestrator" || m.from === me.name ? null : "the run resumed: continue where you stopped, as the resume's message says"
      },
      // a member finished the current phase (`done <name>`); mentions the orchestrator
      done: { name: "done" },
      // every member of the run is done with the current phase: one event to the orchestrator
      "all-done": {
        name: "all-done",
        next: (m, me, cli) => me.seat === "orchestrator" ? `open the next phase: ${cli} phase <name> "<text>" --as ${word(me.name)}; after the last, ${cli} close --run ${m.run}` : null
      },
      // every member but the orchestrator waiting (D31): at each whole IDLE_MS while it holds; wakes the orchestrator alone
      idle: {
        name: "idle",
        toAuthor: true,
        next: (_m, me, cli) => me.seat === "orchestrator" ? `the swarm is quiet: open the next phase if all are done (${cli} phase <name> "<text>" --as ${word(me.name)}), else wait again` : null
      },
      // `stalled <member>`: one member quiet past the run's threshold, to the orchestrator alone, again every
      // STALLED_AGAIN_MS while it lasts (swarm-relay D11); no other member is woken
      stalled: {
        name: "stalled",
        toAuthor: true,
        next: (m, me, cli) => me.seat === "orchestrator" ? stalledMove(m, me, cli) : null
      },
      // a member told gone reads non-gone again (idea 1, rule 4): once, to the orchestrator alone
      recovered: { name: "recovered", toAuthor: true },
      // idea 4: a named lock released (unlock, end, gone, close); mentions each waiter across runs, who locks again
      unlocked: {
        toAuthor: true,
        name: "unlocked",
        next: (m, me, cli) => {
          const name = m.meta && "unlocked" in m.meta ? m.meta.unlocked : null;
          return name && m.mentions.includes(me.name) ? `it is free: lock it now: ${cli} lock ${word(name)} --as ${word(me.name)}` : null;
        }
      },
      // idea 4: a member killed by name or pattern, or by port without the port's lock; to the orchestrator alone
      breach: {
        name: "breach",
        toAuthor: true,
        next: (m, me) => {
          const member = m.meta && "breach" in m.meta ? m.meta.breach : null;
          return member && me.seat === "orchestrator" ? `SendMessage ${member} "stop only the PIDs you started, or lock the port first: machine.md"` : null;
        }
      },
      // a member whose agent finished without end, or whose link is lost (D12); to the orchestrator alone
      gone: {
        name: "gone",
        toAuthor: true,
        next: (_m, me) => me.seat === "orchestrator" ? "its agent is not running: dispatch it again, or close its seat" : null
      },
      // a member's transcript cannot be read: the stall check is blind for it; mentions the orchestrator
      liveness: {
        name: "liveness",
        toAuthor: true,
        // idea 1, rule 4 (v1-b): a link lost while the transcript grows; the member restarts it with the command its join printed
        next: (m, me, cli) => {
          const member = m.meta && "linkDown" in m.meta ? m.meta.linkDown : null;
          if (!member || me.seat !== "orchestrator") return null;
          const all = m.meta && "linkDowns" in m.meta && m.meta.linkDowns ? m.meta.linkDowns : [member];
          if (all.length > 1) return all.map((one) => `SendMessage ${one} to restart its link, in the background: ${cli} link --run ${m.run} --as ${word(one)}`).join("; ");
          return `SendMessage ${member} to restart its link, in the background: ${cli} link --run ${m.run} --as ${word(member)}`;
        }
      },
      // a write outside the writer's claim on a path another holds (D10); mentions: the holder, then the writer
      flag: {
        name: "flag",
        next: (m, me, cli) => {
          const [holder, writer] = m.mentions;
          if (!m.about || !holder || !writer) return null;
          if (me.name === holder) return `settle it: ${cli} agree ${word(`@${writer} <who changes what>`)} --about ${word(m.about)}`;
          if (me.name === writer) return `settle it: ${cli} post ${word(`@${holder} <what you change>`)} --about ${word(m.about)}`;
          return null;
        }
      },
      // the run's composition changed (D4): `+ w4 worker (the app)`, `- w2 gone`, `+ w2 back`; carried to every member, waking none
      composition: { name: "composition", ambient: true },
      // every declared seat has a member (D5): to the orchestrator, which opens the first phase or posts the tasks on it
      "all-joined": {
        name: "all-joined",
        next: (_m, me, cli) => me.seat === "orchestrator" ? `every declared seat has joined: post the tasks, or open the first phase (${cli} phase <name> "<text>" --as ${word(me.name)})` : null
      }
    };
    NAMES = Object.keys(EVENTS);
    isEvent = (s) => Object.hasOwn(EVENTS, s);
  }
});

// src/board/claims.ts
function claimsOf(deps) {
  const { db, transaction, bump, now, lastSeq, participantById, isLive, insertMessage, relPath, fold, slashes, doingOf } = deps;
  const clearFlags = () => {
    db.prepare("DELETE FROM flags WHERE NOT EXISTS (SELECT 1 FROM claims c WHERE c.repo = flags.repo AND c.path = flags.path)").run();
    db.prepare(
      `DELETE FROM notices WHERE NOT EXISTS (SELECT 1 FROM claims c WHERE c.repo = notices.repo AND c.path = notices.path AND c.participant = notices.participant)
         OR NOT EXISTS (SELECT 1 FROM claims c WHERE c.repo = notices.repo AND c.path = notices.path AND c.participant = notices.other)`
    ).run();
  };
  const holdersOf = (repo, rel) => db.prepare("SELECT participant, kind, since_seq FROM claims WHERE repo = ? AND path = ? ORDER BY rowid").all(repo, rel).map((r) => ({ participant: Number(r.participant), kind: String(r.kind), since: Number(r.since_seq) })).filter((c) => isLive(c.participant));
  const hold = (p, rel, kind) => transaction(() => {
    const r = db.prepare(
      `INSERT INTO claims (repo, path, participant, kind, since_seq) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (repo, path, participant) DO UPDATE SET kind = excluded.kind WHERE claims.kind = 'inside' AND excluded.kind = 'interface'`
    ).run(p.repo, rel, p.id, kind, lastSeq());
    db.prepare(
      `INSERT INTO claim_log (repo, path, participant, kind) VALUES (?, ?, ?, ?)
         ON CONFLICT (repo, path, participant) DO UPDATE SET kind = 'interface' WHERE excluded.kind = 'interface'`
    ).run(p.repo, rel, p.id, kind);
    if (Number(r.changes) === 0) return false;
    bump(p.repo);
    return true;
  });
  const take = (p, rel, kind) => transaction(() => {
    const held = holdersOf(p.repo, rel).filter((c) => c.participant !== p.id);
    if (held.length) return { held, taken: false };
    return { held, taken: hold(p, rel, kind) };
  });
  const hasPostedAbout = (p, rel, holders) => {
    const since = Math.min(...holders.map((h) => h.since));
    const rows = db.prepare("SELECT seq, body, about, mentions FROM messages WHERE repo = ? AND author = ? AND seq > ? AND kind != 'event' AND by_board = 0").all(p.repo, p.id, since);
    const base = rel.split("/").pop();
    const names = (r) => {
      const about = r.about == null ? "" : fold(slashes(String(r.about)));
      const f = fold(rel);
      if (about && (about === f || f.endsWith(`/${about}`))) return true;
      const body = fold(String(r.body));
      return body.includes(f) || body.includes(fold(base));
    };
    const told = rows.filter(names).map((r) => ({ seq: Number(r.seq), mentions: JSON.parse(String(r.mentions)) }));
    return holders.every((h) => {
      const o = participantById(h.participant);
      return told.some((r) => r.seq > h.since && (r.mentions.includes(o.name) || r.mentions.includes(`${o.plan}/*`)));
    });
  };
  const recordShares = (me, rel, people) => {
    const share = db.prepare("INSERT OR IGNORE INTO shares (repo, path, participant, other, seq) VALUES (?, ?, ?, ?, ?)");
    for (const o of people) share.run(me.repo, rel, me.id, o.id, lastSeq());
  };
  const noticeOf = (me, rel, people) => {
    const told = db.prepare("INSERT OR IGNORE INTO notices (repo, path, participant, other) VALUES (?, ?, ?, ?)");
    const fresh = people.filter((o) => Number(told.run(me.repo, rel, me.id, o.id).changes) > 0);
    return fresh.length ? fresh.map((o) => `${rel} is also held by ${o.name}: ${doingOf(o.id)}`).join("; ") : null;
  };
  const releaseAll = (id) => {
    const owner = db.prepare("SELECT r.repo FROM participants p JOIN runs r ON r.id = p.run WHERE p.id = ?").get(id);
    const claims = Number(db.prepare("DELETE FROM claims WHERE participant = ?").run(id).changes);
    const locks = Number(db.prepare("DELETE FROM merge_locks WHERE participant = ?").run(id).changes);
    db.prepare("DELETE FROM claim_requests WHERE participant = ?").run(id);
    clearFlags();
    if (owner && claims + locks > 0) bump(String(owner.repo));
  };
  const takeLockWaiters = (repo) => {
    const rows = db.prepare("SELECT participant FROM lock_waiters WHERE repo = ? ORDER BY rowid").all(repo);
    db.prepare("DELETE FROM lock_waiters WHERE repo = ?").run(repo);
    return rows.map((r) => Number(r.participant)).filter(isLive).map((id) => participantById(id).name);
  };
  const openTurn = (p) => db.prepare(
    `SELECT rowid AS id, granted_at FROM lock_requests t WHERE participant = ? AND merged_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM call_log c WHERE c.participant = t.participant AND c.verb = 'end' AND c.at >= t.asked_at)
         ORDER BY rowid DESC LIMIT 1`
  ).get(p.id);
  const grantTurn = (p, at, anew) => {
    const turn = openTurn(p);
    if (turn && turn.granted_at == null) db.prepare("UPDATE lock_requests SET granted_at = ? WHERE rowid = ?").run(at, Number(turn.id));
    else if (!turn || anew) db.prepare("INSERT INTO lock_requests (repo, participant, asked_at, granted_at) VALUES (?, ?, ?, ?)").run(p.repo, p.id, at, at);
  };
  const declared = (id) => JSON.parse(String(db.prepare("SELECT files FROM participants WHERE id = ?").get(id).files));
  return {
    clearFlags,
    releaseAll,
    lockWaitersFreedBy(p) {
      const held = db.prepare("SELECT 1 FROM merge_locks WHERE repo = ? AND participant = ?").get(p.repo, p.id) !== void 0;
      return held ? takeLockWaiters(p.repo).filter((n) => n !== p.name) : [];
    },
    claimByPost(me, m) {
      if (m.kind !== "msg" && m.kind !== "agreement" || !m.about) return null;
      const about = fold(relPath(me.repo, m.about) ?? slashes(m.about));
      return transaction(() => {
        const asked = db.prepare("SELECT path, kind FROM claim_requests WHERE repo = ? AND participant = ?").all(me.repo, me.id).find((r) => {
          const x = fold(String(r.path));
          return x === about || x.endsWith(`/${about}`);
        });
        if (!asked) return null;
        const rel = String(asked.path);
        const others = holdersOf(me.repo, rel).filter((c) => c.participant !== me.id);
        if (!others.length || !hasPostedAbout(me, rel, others)) return null;
        hold(me, rel, String(asked.kind) === "interface" ? "interface" : "inside");
        db.prepare("DELETE FROM claim_requests WHERE repo = ? AND path = ? AND participant = ?").run(me.repo, rel, me.id);
        const people = others.map((c) => participantById(c.participant));
        recordShares(me, rel, people);
        return { path: rel, sharedWith: people.map((o) => o.name) };
      });
    },
    claimDeclared(p, files) {
      transaction(() => {
        for (const f of files) {
          const rel = relPath(p.repo, f.path);
          if (rel) take(p, rel, f.interface ? "interface" : "inside");
        }
      });
    },
    askedAbout(me, author, m) {
      const about = fold(relPath(me.repo, m.about) ?? slashes(m.about));
      const mine = db.prepare("SELECT path FROM claims WHERE repo = ? AND participant = ? AND since_seq < ?").all(me.repo, me.id, m.seq);
      const rel = mine.map((r) => String(r.path)).find((x) => fold(x) === about || fold(x).endsWith(`/${about}`));
      if (!rel) return null;
      const theirs = db.prepare("SELECT 1 FROM claims WHERE repo = ? AND path = ? AND participant = ? AND since_seq < ?").get(me.repo, rel, author, m.seq);
      return theirs ? null : rel;
    },
    heldInOtherRun(p, rel) {
      const f = fold(rel);
      const rows = db.prepare("SELECT l.path FROM claim_log l JOIN participants q ON q.id = l.participant WHERE l.repo = ? AND q.run != ?").all(p.repo, p.run);
      return rows.some((r) => {
        const x = fold(String(r.path));
        return x === f || x.endsWith(`/${f}`);
      });
    },
    holderNames(repo, about) {
      const f = fold(relPath(repo, about) ?? slashes(about));
      if (!f) return [];
      const rows = db.prepare("SELECT participant, path FROM claims WHERE repo = ?").all(repo);
      return [...new Set(rows.filter((r) => {
        const x = fold(String(r.path));
        return x === f || x.endsWith(`/${f}`);
      }).map((r) => Number(r.participant)).filter(isLive).map((id) => participantById(id).name))];
    },
    holds(p, about) {
      const f = fold(relPath(p.repo, about) ?? slashes(about));
      if (!f) return false;
      const rows = db.prepare("SELECT path FROM claims WHERE repo = ? AND participant = ?").all(p.repo, p.id);
      return rows.some((r) => {
        const x = fold(String(r.path));
        return x === f || x.endsWith(`/${f}`);
      });
    },
    checkEdit(me, file, opts = {}) {
      const kind = opts.interface ? "interface" : "inside";
      const rel = relPath(me.repo, file);
      if (!rel) return { allowed: true, sharedWith: [], notice: null };
      return transaction(() => {
        const all = holdersOf(me.repo, rel);
        const others = all.filter((c) => c.participant !== me.id);
        if (!others.length) {
          hold(me, rel, kind);
          return { allowed: true, sharedWith: [], notice: null };
        }
        const people = others.map((c) => participantById(c.participant));
        if (!all.some((c) => c.participant === me.id)) {
          if (!hasPostedAbout(me, rel, others)) {
            db.prepare(
              `INSERT INTO claim_requests (repo, path, participant, kind) VALUES (?, ?, ?, ?)
               ON CONFLICT (repo, path, participant) DO UPDATE SET kind = CASE WHEN claim_requests.kind = 'interface' THEN 'interface' ELSE excluded.kind END`
            ).run(me.repo, rel, me.id, kind);
            const who = people.map((o) => `${o.name} (${o.nick}: ${doingOf(o.id)})`).join(", ");
            const at = people.map((o) => `@${o.name}`).join(" ");
            return {
              allowed: false,
              refusal: `${rel} is also held by ${who}. You may share it, but first tell ${people.length > 1 ? "them" : "its holder"} what you change in it: \`swarm post "${at} \u2026" --about ${rel}\`; ${people.length > 1 ? "they answer" : "its holder answers"} with an agreement on who changes what (\`swarm agree \u2026 --about ${rel}\`), and that agreement goes. Claim again once posted; do not wait for the agreement.`
            };
          }
        }
        hold(me, rel, kind);
        db.prepare("DELETE FROM claim_requests WHERE repo = ? AND path = ? AND participant = ?").run(me.repo, rel, me.id);
        recordShares(me, rel, people);
        const sharedWith = people.map((o) => ({ member: o.name, doing: doingOf(o.id) }));
        return { allowed: true, sharedWith, notice: noticeOf(me, rel, people) };
      });
    },
    reconcileWrites(me, changed) {
      const flags = [];
      return transaction(() => {
        const flag = db.prepare("INSERT OR IGNORE INTO flags (repo, path, participant) VALUES (?, ?, ?)");
        const posted = db.prepare("INSERT OR IGNORE INTO flag_posts (repo, path, participant, holder) VALUES (?, ?, ?, ?)");
        for (const file of changed) {
          const rel = relPath(me.repo, file);
          if (!rel) continue;
          if (holdersOf(me.repo, rel).some((c) => c.participant === me.id)) {
            take(me, rel, "inside");
            continue;
          }
          const { held: others, taken } = take(me, rel, "inside");
          if (taken || others.length) flag.run(me.repo, rel, me.id);
          if (!others.length) continue;
          const holder = participantById(others[0].participant);
          if (Number(posted.run(me.repo, rel, me.id, holder.id).changes) === 0) continue;
          const m = insertMessage(
            me,
            `@${holder.name} @${me.name} flag: ${me.name} wrote ${rel} outside its claim; ${holder.name} holds it. Settle it here.`,
            rel,
            "event",
            [holder.name, me.name],
            { event: EVENTS.flag.name }
          );
          flags.push({ path: rel, holder: holder.name, seq: m.seq });
        }
        return flags;
      });
    },
    release(me, file) {
      const rel = relPath(me.repo, file);
      if (!rel) return;
      transaction(() => {
        const r = db.prepare("DELETE FROM claims WHERE repo = ? AND path = ? AND participant = ?").run(me.repo, rel, me.id);
        if (Number(r.changes) === 0) return;
        clearFlags();
        bump(me.repo);
      });
    },
    lockMerge(me, onto, reflogMark) {
      return transaction(() => {
        const r = db.prepare("SELECT participant FROM merge_locks WHERE repo = ?").get(me.repo);
        if (r && Number(r.participant) !== me.id && isLive(Number(r.participant))) {
          db.prepare("INSERT OR IGNORE INTO lock_waiters (repo, participant) VALUES (?, ?)").run(me.repo, me.id);
          const turn = openTurn(me);
          if (turn && turn.granted_at == null) db.prepare("UPDATE lock_requests SET refused = refused + 1 WHERE rowid = ?").run(Number(turn.id));
          else db.prepare("INSERT INTO lock_requests (repo, participant, asked_at, refused) VALUES (?, ?, ?, 1)").run(me.repo, me.id, now());
          return { granted: false, holder: participantById(Number(r.participant)).name };
        }
        if (r && Number(r.participant) === me.id) {
          if (onto) db.prepare("UPDATE merge_locks SET onto = ? WHERE repo = ?").run(onto, me.repo);
          grantTurn(me, String(db.prepare("SELECT at FROM merge_locks WHERE repo = ?").get(me.repo).at), false);
          return { granted: true };
        }
        db.prepare("DELETE FROM lock_waiters WHERE repo = ?").run(me.repo);
        const at = now();
        db.prepare("INSERT OR REPLACE INTO merge_locks (repo, participant, at, onto, reflog_mark) VALUES (?, ?, ?, ?, ?)").run(me.repo, me.id, at, onto ?? null, reflogMark ?? null);
        grantTurn(me, at, true);
        bump(me.repo);
        return { granted: true };
      });
    },
    heldMergeLock(me) {
      const r = db.prepare("SELECT at, onto, reflog_mark FROM merge_locks WHERE repo = ? AND participant = ?").get(me.repo, me.id);
      return r ? { grantedAt: String(r.at), onto: r.onto == null ? null : String(r.onto), reflogMark: r.reflog_mark == null ? null : Number(r.reflog_mark) } : null;
    },
    merged(me, sha, files, conflicts) {
      const rels = [...new Set(files.map((f) => relPath(me.repo, f)).filter((x) => x !== null))];
      const conflicted = conflicts && "files" in conflicts ? new Set(conflicts.files.map((f) => fold(slashes(f)))) : null;
      const wanted = new Set(rels);
      const told = /* @__PURE__ */ new Set();
      const iface = /* @__PURE__ */ new Set();
      const sharers = [];
      let waiters = [];
      let onto = null;
      transaction(() => {
        transaction(() => {
          const lock = db.prepare("SELECT participant, onto FROM merge_locks WHERE repo = ?").get(me.repo);
          if (lock && Number(lock.participant) !== me.id && isLive(Number(lock.participant))) {
            throw new Error(`the merge lock is held by ${participantById(Number(lock.participant)).name}, not ${me.name}`);
          }
          if (lock && Number(lock.participant) === me.id && lock.onto != null) onto = String(lock.onto);
          db.prepare("DELETE FROM merge_locks WHERE repo = ?").run(me.repo);
          db.prepare("UPDATE participants SET merged = 1 WHERE id = ?").run(me.id);
          const turn = openTurn(me);
          if (turn) db.prepare("UPDATE lock_requests SET merged_at = ? WHERE rowid = ?").run(now(), Number(turn.id));
          waiters = takeLockWaiters(me.repo).filter((n) => n !== me.name);
        });
        for (const rel of rels) {
          for (const c of holdersOf(me.repo, rel)) {
            if (c.kind === "interface") iface.add(rel);
            if (c.participant !== me.id) told.add(participantById(c.participant).name);
          }
        }
        const everyone = db.prepare("SELECT p.id, p.seat, r.plan FROM participants p JOIN runs r ON r.id = p.run WHERE r.repo = ? AND r.state = 'open' AND p.ended_at IS NULL").all(me.repo);
        for (const o of everyone) {
          for (const f of declared(Number(o.id))) {
            const rel = relPath(me.repo, f.path);
            if (!rel || !wanted.has(rel)) continue;
            if (f.interface) iface.add(rel);
            if (Number(o.id) !== me.id) told.add(`${o.plan}/${o.seat}`);
          }
        }
        const agreed = /* @__PURE__ */ new Set();
        const foldedWanted = new Set(rels.map(fold));
        const live = new Set(db.prepare("SELECT p.id, p.seat, r.plan FROM participants p JOIN runs r ON r.id = p.run WHERE r.repo = ? AND r.state = 'open' AND p.ended_at IS NULL").all(me.repo).map((o) => `${o.plan}/${o.seat}`));
        for (const a of db.prepare("SELECT author, about, mentions FROM messages WHERE repo = ? AND kind = 'agreement' AND about IS NOT NULL").all(me.repo)) {
          if (!foldedWanted.has(fold(slashes(String(a.about))))) continue;
          const parties = [participantById(Number(a.author)).name, ...JSON.parse(String(a.mentions))];
          for (const n of parties) if (n !== me.name && live.has(n) && !told.has(n)) agreed.add(n);
        }
        const openPlans = db.prepare("SELECT DISTINCT plan, kind FROM runs WHERE repo = ? AND state = 'open'").all(me.repo).filter((r) => profileOf(String(r.kind)).claims).map((r) => String(r.plan));
        const all = iface.size ? openPlans.map((plan) => `${plan}/*`) : [];
        const lines = [`merged ${sha}${onto ? ` into ${onto}` : ""}: rebase your branch onto it.`];
        if (told.size) lines.push(`${[...told].map((n) => `@${n}`).join(" ")}: you hold or declared a file it changed.`);
        if (agreed.size) lines.push(`${[...agreed].map((n) => `@${n}`).join(" ")}: you agreed on a file it changed.`);
        if (iface.size) lines.push(`@swarm interface changed: ${[...iface].join(", ")}.`);
        if (waiters.length) lines.push(`the merge lock is free: ${waiters.map((n) => `@${n}`).join(" ")}`);
        lines.push(`files: ${rels.join(", ") || "-"}`);
        for (const rel of rels) {
          if (conflicted && !conflicted.has(fold(rel))) continue;
          const ids = new Set(holdersOf(me.repo, rel).map((c) => c.participant));
          const held = db.prepare("SELECT l.participant FROM claim_log l JOIN participants p ON p.id = l.participant WHERE l.repo = ? AND l.path = ? AND p.run = ? ORDER BY l.rowid").all(me.repo, rel, me.run);
          for (const r of held) ids.add(Number(r.participant));
          ids.delete(me.id);
          for (const id of ids) sharers.push({ path: rel, member: participantById(id).name });
        }
        const meta = { rebase: [...told], tell: [...new Set(sharers.map((o) => o.member))] };
        insertMessage(me, lines.join("\n"), null, "event", [.../* @__PURE__ */ new Set([...told, ...agreed, ...waiters, ...all])], { event: EVENTS.merged.name, meta });
        db.prepare("INSERT INTO merges (participant, run, sha, at, files, conflicts) VALUES (?, ?, ?, ?, ?, ?)").run(
          me.id,
          me.run,
          sha,
          now(),
          JSON.stringify(rels),
          conflicts && "files" in conflicts ? JSON.stringify(conflicts.files.map(slashes)) : null
        );
      });
      return sharers;
    }
  };
}
var init_claims = __esm({
  "src/board/claims.ts"() {
    "use strict";
    init_events();
    init_kinds();
  }
});

// src/board/stats.ts
function distinctFlags(messages) {
  const seen = /* @__PURE__ */ new Set();
  return messages.filter((m) => {
    if (!isBoardFlag(m)) return false;
    const [, path10 = m.about ?? "", holder = ""] = String(m.body).match(FLAG_BODY) ?? [];
    const key = JSON.stringify([Number(m.author), foldPath(String(path10)), holder]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function periodStart(since) {
  if (since === void 0) return null;
  const days = since.match(/^(\d+)d$/);
  const at = days ? Date.now() - Number(days[1]) * DAY_MS : Date.parse(since);
  if (Number.isNaN(at)) throw new Error(`since takes <n>d or an ISO time, got ${since}`);
  return new Date(at).toISOString();
}
function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}
function sumKnown(values) {
  const known = values.filter((v) => typeof v === "number");
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}
function timeline(joined, over, calls, turns, silentAfterMs) {
  if (!(over > joined)) return [];
  const exact = [];
  for (const t of turns) {
    if (t.refused > 0) exact.push({ from: t.asked, to: t.granted ?? t.over, what: "waiting" });
    if (t.granted !== null) exact.push({ from: t.granted, to: t.merged ?? t.over, what: "merging" });
  }
  const points = [joined, ...calls.filter((c) => c > joined && c < over), over].sort((a, b) => a - b);
  const silent = [];
  for (let i = 1; i < points.length; i++) if (points[i] - points[i - 1] > silentAfterMs) silent.push({ from: points[i - 1], to: points[i], what: "silent" });
  const clip = (t) => Math.min(over, Math.max(joined, t));
  const bounds = [.../* @__PURE__ */ new Set([joined, over, ...[...exact, ...silent].flatMap((s) => [clip(s.from), clip(s.to)])])].sort((a, b) => a - b);
  const inside = (spans, what, at) => spans.some((s) => s.what === what && s.from <= at && at < s.to);
  const out = [];
  for (let i = 1; i < bounds.length; i++) {
    const from = bounds[i - 1];
    const to = bounds[i];
    const mid = (from + to) / 2;
    const what = inside(exact, "merging", mid) ? "merging" : inside(exact, "waiting", mid) ? "waiting" : inside(silent, "silent", mid) ? "silent" : "working";
    const last = out[out.length - 1];
    if (last && last.what === what && ms(last.to) === from) last.to = iso(to);
    else out.push({ from: iso(from), to: iso(to), what, inferred: what === "working" || what === "silent" });
  }
  return out;
}
function estimatedTimeline(joined, over, mergedAt) {
  if (!(over > joined)) return [];
  const merges = mergedAt.filter((t) => t > joined && t <= over).sort((a, b) => a - b);
  const working = { from: iso(joined), to: iso(merges[0] ?? over), what: "working", inferred: true };
  return [working, ...merges.map((t) => ({ from: iso(t), to: iso(t), what: "merging", inferred: true }))];
}
function mergesFromEvents(messages) {
  return messages.filter((m) => m.kind === "event" && (m.event === "merged" || m.event == null && MERGED_BODY.test(String(m.body)))).map((m) => {
    const line = String(m.body).match(FILES_LINE)?.[1].trim();
    const files = line === void 0 ? null : line === "-" ? [] : line.split(", ").map((f) => f.trim()).filter(Boolean);
    return { participant: Number(m.author), at: ms(m.at), files, conflicts: null };
  });
}
function computeRun(db, r, now, silentAfterMs) {
  const id = Number(r.id);
  const repo = String(r.repo);
  const kind = profileOf(String(r.kind ?? "plan")).kind;
  const openedAt = String(r.opened_at);
  const closedAt = r.closed_at == null ? null : String(r.closed_at);
  const runOver = closedAt ? ms(closedAt) : now;
  const since = db.prepare("SELECT value FROM settings WHERE name = ?").get(RECORDS_SINCE);
  const recorded = since !== void 0 && ms(openedAt) >= ms(since.value);
  const sharesSince = db.prepare("SELECT value FROM settings WHERE name = ?").get(SHARES_SINCE);
  const sharesRecorded = sharesSince !== void 0 && ms(openedAt) >= ms(sharesSince.value);
  const people = db.prepare("SELECT * FROM participants WHERE run = ? ORDER BY id").all(id);
  const ids = people.map((p) => Number(p.id));
  const marks = ids.map(() => "?").join(", ") || "NULL";
  const nameOf = (p) => `${r.plan}/${p.seat}`;
  const messages = db.prepare(`SELECT * FROM messages WHERE run = ? OR (run IS NULL AND author IN (${marks})) ORDER BY seq`).all(id, ...ids);
  const merges = recorded ? db.prepare("SELECT * FROM merges WHERE run = ? ORDER BY rowid").all(id) : [];
  const claimLog = db.prepare(`SELECT path, participant, kind FROM claim_log WHERE participant IN (${marks}) ORDER BY rowid`).all(...ids);
  const shares = db.prepare(`SELECT path, participant, other FROM shares WHERE participant IN (${marks}) AND other IN (${marks})`).all(...ids, ...ids);
  const orchestrators = new Set(people.filter((p) => String(p.seat) === ORCHESTRATOR).map((p) => Number(p.id)));
  const conflictedOf = (m) => m.conflicts == null ? null : JSON.parse(String(m.conflicts));
  const mergesRead = recorded ? merges.map((m) => ({ participant: Number(m.participant), at: ms(m.at), files: JSON.parse(String(m.files)), conflicts: conflictedOf(m) })) : mergesFromEvents(messages);
  const mergeTimesOf = (pid) => mergesRead.filter((m) => m.participant === pid).map((m) => m.at);
  const grants = recorded ? db.prepare(
    `SELECT t.participant, t.asked_at, t.granted_at, p.seat, r.plan FROM lock_requests t
             LEFT JOIN participants p ON p.id = t.participant LEFT JOIN runs r ON r.id = p.run
           WHERE t.repo = ? AND t.granted_at IS NOT NULL ORDER BY t.granted_at`
  ).all(repo) : [];
  const lockWaitsMs = [];
  const boardFlags = distinctFlags(messages);
  const racesLost = [];
  const members = people.map((p) => {
    const pid = Number(p.id);
    const joined = ms(p.joined_at);
    const over = Math.min(p.ended_at == null ? runOver : ms(p.ended_at), Math.max(now, joined));
    const calls = recorded ? db.prepare("SELECT at, verb FROM call_log WHERE participant = ? ORDER BY at").all(pid) : [];
    const endCalls = calls.filter((c) => c.verb === "end").map((c) => ms(c.at));
    const turns = recorded ? db.prepare("SELECT * FROM lock_requests WHERE participant = ? ORDER BY rowid").all(pid).map((t) => {
      const asked = ms(t.asked_at);
      const merged = t.merged_at == null ? null : ms(t.merged_at);
      return {
        asked,
        granted: t.granted_at == null ? null : ms(t.granted_at),
        merged,
        refused: Number(t.refused),
        // a turn without a merge is closed by the member's next end call (D25), else by its end
        over: merged ?? endCalls.find((e) => e >= asked) ?? over
      };
    }) : [];
    const memberMarks = [];
    let lost = 0;
    let waitedMs = null;
    for (const t of turns) {
      if (t.granted !== null) lockWaitsMs.push(t.granted - t.asked);
      if (t.refused === 0) continue;
      const until = t.granted ?? t.over;
      for (const g of grants) {
        const at = ms(g.granted_at);
        if (Number(g.participant) === pid || !(ms(g.asked_at) > t.asked) || !(at > t.asked && at < until)) continue;
        lost++;
        waitedMs = Math.max(waitedMs ?? 0, at - t.asked);
        const winner = g.seat == null ? "a member" : `${g.plan}/${g.seat}`;
        memberMarks.push({ at: iso(at), what: "race", note: `the merge lock went to ${winner}, who asked later` });
      }
    }
    if (lost) racesLost.push({ member: nameOf(p), lost, waitedMs });
    const own = messages.filter((m) => Number(m.author) === pid);
    const posts = own.filter((m) => m.kind !== "event" && Number(m.by_board ?? 0) === 0);
    const flagged = boardFlags.filter((m) => Number(m.author) === pid);
    for (const m of [...own.filter((x) => x.kind === "agreement"), ...flagged]) {
      memberMarks.push({
        at: String(m.at),
        what: m.kind === "agreement" ? "agreement" : "flag",
        seq: Number(m.seq),
        ...m.about != null ? { path: String(m.about) } : {},
        note: firstLine(String(m.body))
      });
    }
    for (const m of mergesRead.filter((x) => x.participant === pid)) {
      for (const f of m.conflicts ?? []) memberMarks.push({ at: iso(m.at), what: "conflict", path: f, note: `the rebase met a conflict in ${f}` });
    }
    memberMarks.sort((a, b) => ms(a.at) - ms(b.at));
    return {
      member: nameOf(p),
      nick: p.nick == null ? String(p.seat) : String(p.nick),
      seat: String(p.seat),
      joined: String(p.joined_at),
      ended: p.ended_at == null ? null : String(p.ended_at),
      intervals: recorded ? timeline(joined, over, calls.map((c) => ms(c.at)), turns, silentAfterMs) : estimatedTimeline(joined, over, mergeTimesOf(pid)),
      marks: memberMarks,
      posts: posts.length,
      postTimes: posts.map((m) => String(m.at)),
      claims: claimLog.filter((c) => Number(c.participant) === pid).length,
      flags: flagged.length,
      unsourced: posts.filter((m) => !SOURCE.test(String(m.body))).length,
      // read from its spans and marks once they are whole, below (D40)
      waitingMs: null,
      agreementsMade: null,
      endorsed: null,
      objections: null,
      estimated: !recorded
    };
  });
  const firstMerge = mergesRead.length ? Math.min(...mergesRead.map((m) => m.at)) : null;
  const length = runOver - ms(openedAt);
  const base = {
    run: id,
    kind,
    code: planCode(String(r.plan)),
    title: String(r.title),
    openedAt,
    closedAt,
    lengthMs: Number.isNaN(length) ? null : length,
    recorded,
    firstMergeAtMs: firstMerge === null ? null : firstMerge - ms(openedAt),
    racesLost: recorded ? racesLost.reduce((n, x) => n + (x.lost ?? 0), 0) : null,
    members
  };
  if (kind === "brainstorm") {
    const { brainstorm, marksOf, unsourcedOf } = debateOf(db, id, people.filter((p) => !orchestrators.has(Number(p.id))), messages);
    members.forEach((m, i) => {
      const pid = Number(people[i].id);
      m.marks = [...m.marks, ...marksOf.get(pid) ?? []].sort((a, b) => ms(a.at) - ms(b.at));
      m.unsourced = unsourcedOf.get(pid) ?? 0;
    });
    return { ...base, brainstorm };
  }
  if (kind !== "plan") return base;
  const sliceMembers = people.filter((p) => !orchestrators.has(Number(p.id)));
  const timesMs = sliceMembers.flatMap((p) => {
    const mergedAt = mergeTimesOf(Number(p.id));
    const end = mergedAt.length ? Math.min(...mergedAt) : p.ended_at == null ? null : ms(p.ended_at);
    return end === null ? [] : [end - ms(p.joined_at)];
  });
  const sliceCount = Number(db.prepare("SELECT COUNT(*) AS n FROM seats WHERE run = ?").get(id).n);
  const addedMidRun = messages.filter((m) => m.kind === "event" && orchestrators.has(Number(m.author)) && /^added \S+: /.test(String(m.body))).length;
  const holdersByPath = /* @__PURE__ */ new Map();
  for (const c of claimLog) {
    const key = foldPath(String(c.path));
    const entry2 = holdersByPath.get(key) ?? { path: String(c.path), holders: [] };
    if (!entry2.holders.includes(Number(c.participant))) entry2.holders.push(Number(c.participant));
    holdersByPath.set(key, entry2);
  }
  const sharersOf = (path10) => new Set(shares.filter((sh) => foldPath(String(sh.path)) === foldPath(path10)).flatMap((sh) => [Number(sh.participant), Number(sh.other)]));
  const byId = new Map(people.map((p) => [Number(p.id), p]));
  const membershipOf = (pid) => {
    const p = byId.get(pid);
    return { from: ms(p.joined_at), to: p.ended_at == null ? runOver : ms(p.ended_at) };
  };
  const membersTogether = (a, b) => {
    const x = membershipOf(a);
    const y = membershipOf(b);
    return x.from < y.to && y.from < x.to;
  };
  const claimersTogether = (claimers) => claimers.filter((h) => claimers.some((o) => o !== h && membersTogether(h, o)));
  const namesPath = (m, path10) => {
    if (aboutNames(m.about, path10)) return true;
    const body = foldPath(String(m.body));
    return body.includes(foldPath(path10)) || body.includes(foldPath(path10.split("/").pop()));
  };
  const said = messages.filter((m) => m.kind !== "event" && Number(m.by_board ?? 0) === 0);
  const interfaceClaims = claimLog.filter((c) => c.kind === "interface");
  const perFile = [];
  let everyHolderTold = 0;
  let agreed = 0;
  let agreedBeforeMerge = 0;
  for (const { path: path10, holders: everyHolder } of holdersByPath.values()) {
    const sharers = sharersOf(path10);
    const holders = sharesRecorded ? everyHolder.filter((h) => sharers.has(h)) : claimersTogether(everyHolder);
    if (holders.length < 2) continue;
    const tellTimes = [];
    let told = true;
    for (let i = 1; i < holders.length; i++) {
      const tells = said.filter((m) => Number(m.author) === holders[i] && namesPath(m, path10));
      tellTimes.push(...tells.map((m) => ms(m.at)));
      const mentioned = (e) => tells.some((m) => {
        const named = JSON.parse(String(m.mentions));
        return named.includes(nameOf(byId.get(e))) || named.includes(`${r.plan}/*`);
      });
      if (!holders.slice(0, i).every(mentioned)) told = false;
    }
    const sharedAt = tellTimes.length ? Math.min(...tellTimes) : null;
    const agreement = messages.find((m) => m.kind === "agreement" && aboutNames(m.about, path10));
    const mergedWith = mergesRead.filter((m) => m.files ? m.files.some((f) => foldPath(f) === foldPath(path10)) : holders.includes(m.participant));
    const firstMergeOfPath = mergedWith.length ? Math.min(...mergedWith.map((m) => m.at)) : null;
    if (told) {
      everyHolderTold++;
      if (agreement) {
        agreed++;
        if (firstMergeOfPath === null || ms(agreement.at) < firstMergeOfPath) agreedBeforeMerge++;
      }
    }
    const met = mergedWith.map((m) => m.conflicts);
    const conflict = !recorded ? null : met.some((c) => c?.some((f) => foldPath(f) === foldPath(path10))) ? true : met.some((c) => c === null) ? null : false;
    const declaredInterface = holders.some(
      (h) => JSON.parse(String(byId.get(h).files ?? "[]")).some((d) => d.interface === true && aboutNames(d.path, path10))
    );
    const claimedInterface = interfaceClaims.some((c) => holders.includes(Number(c.participant)) && foldPath(String(c.path)) === foldPath(path10));
    perFile.push({
      path: path10,
      holders: holders.map((h) => nameOf(byId.get(h))),
      interface: declaredInterface || claimedInterface,
      told,
      agreement: agreement ? Number(agreement.seq) : null,
      // below 0: agreed before the tell (D46)
      agreedAfterMs: agreement && sharedAt !== null ? ms(agreement.at) - sharedAt : null,
      conflict
    });
  }
  let known = 0;
  let inShared = 0;
  let unknownMerges = 0;
  for (const m of merges) {
    const files = conflictedOf(m);
    if (files === null) {
      unknownMerges++;
      continue;
    }
    known += files.length;
    inShared += files.filter((f) => claimLog.some((c) => Number(c.participant) !== Number(m.participant) && foldPath(String(c.path)) === foldPath(f))).length;
  }
  const mergedSlices = recorded ? new Set(merges.map((m) => Number(m.participant)).filter((pid) => !orchestrators.has(pid))).size : sliceMembers.filter((p) => Number(p.merged ?? 0) === 1).length;
  return {
    ...base,
    plan: {
      slices: { merged: mergedSlices, of: sliceCount, addedMidRun, timesMs, timesEstimated: !recorded },
      lock: { waitsMs: lockWaitsMs, racesLost },
      shared: { files: perFile.length, everyHolderTold, agreed, agreedBeforeMerge, perFile, estimated: !sharesRecorded },
      flags: boardFlags.length,
      conflicts: recorded ? { known, inShared, unknownMerges } : { known: null, inShared: null, unknownMerges: null }
    }
  };
}
function skepticOf(db, run2, seats) {
  const seated = (seat) => new Set(seats.filter((p) => String(p.seat) === seat).map((p) => Number(p.id)));
  const named = seated(SKEPTIC);
  if (named.size) return named;
  const rows = db.prepare("SELECT id, on_events FROM seats WHERE run = ? AND on_events IS NOT NULL ORDER BY ord").all(run2);
  const subscribesToAgreement = (row) => JSON.parse(String(row.on_events)).flatMap((e) => e.split(",")).some((e) => e.trim().replace(/^(any|main):/, "") === "agreement");
  const subscribed = rows.find(subscribesToAgreement);
  return subscribed ? seated(String(subscribed.id)) : /* @__PURE__ */ new Set();
}
function debateOf(db, run2, seats, messages) {
  const skeptic = skepticOf(db, run2, seats);
  const seatIds = new Set(seats.map((p) => Number(p.id)));
  const questionOf = (m) => {
    const about = m.about == null ? "" : String(m.about).trim();
    return QUESTION.test(about) ? about : null;
  };
  const spoken = (m) => Number(m.by_board ?? 0) === 0 && (m.kind === "msg" || m.kind === "urgent" || m.kind === "agreement");
  const bySeq = new Map(messages.map((m) => [Number(m.seq), m]));
  const endorsements = [];
  const skepticEndorsedAt = /* @__PURE__ */ new Map();
  for (const m of messages) {
    if (m.kind !== "endorsement" || m.endorses == null) continue;
    const agreement = bySeq.get(Number(m.endorses));
    const question = agreement && agreement.kind === "agreement" ? questionOf(agreement) : null;
    if (question === null) continue;
    endorsements.push({ endorsement: m, question });
    if (skeptic.has(Number(m.author)) && !skepticEndorsedAt.has(Number(m.endorses))) skepticEndorsedAt.set(Number(m.endorses), Number(m.seq));
  }
  const endorsedSeqs = new Set(skepticEndorsedAt.keys());
  const skepticEndorsements = endorsements.filter(({ endorsement }) => skeptic.has(Number(endorsement.author)));
  const endorsedBefore = (agreementSeq, seq) => (skepticEndorsedAt.get(agreementSeq) ?? Infinity) < seq;
  const outcomeOf = /* @__PURE__ */ new Map();
  for (const m of messages) {
    const q = questionOf(m);
    if (q !== null && m.kind === "agreement" && endorsedSeqs.has(Number(m.seq)) && !outcomeOf.has(q)) outcomeOf.set(q, m);
  }
  const questions = /* @__PURE__ */ new Map();
  const marksOf = /* @__PURE__ */ new Map();
  const unsourcedOf = /* @__PURE__ */ new Map();
  const mark = (pid, x) => void marksOf.set(pid, [...marksOf.get(pid) ?? [], x]);
  const lastAgreementOn = /* @__PURE__ */ new Map();
  let agreements = 0;
  let sourced = 0;
  let claims = 0;
  for (const m of messages) {
    const q = questionOf(m);
    if (q === null || !spoken(m)) continue;
    const author = Number(m.author);
    const question = questions.get(q) ?? { id: q, firstPost: String(m.at), outcome: null, exchanges: 0 };
    questions.set(q, question);
    const outcome = outcomeOf.get(q);
    const beforeOutcome = !outcome || Number(m.seq) < Number(outcome.seq);
    if (beforeOutcome && seatIds.has(author)) question.exchanges = (question.exchanges ?? 0) + 1;
    if (m.kind === "agreement") {
      agreements++;
      lastAgreementOn.set(q, m);
      continue;
    }
    if (beforeOutcome) {
      claims++;
      if (SOURCE.test(String(m.body))) sourced++;
      else unsourcedOf.set(author, (unsourcedOf.get(author) ?? 0) + 1);
    }
    const last = lastAgreementOn.get(q);
    if (skeptic.has(author) && last && Number(last.author) !== author && !endorsedBefore(Number(last.seq), Number(m.seq))) {
      mark(author, { at: String(m.at), what: "objected", seq: Number(m.seq), path: q, note: `objects to #${last.seq}: ${firstLine(String(m.body))}` });
    }
  }
  for (const { endorsement, question } of endorsements) {
    mark(Number(endorsement.author), { at: String(endorsement.at), what: "endorsed", seq: Number(endorsement.seq), path: question, note: `endorses #${endorsement.endorses}` });
  }
  for (const [q, outcome] of outcomeOf) {
    const question = questions.get(q);
    if (question) question.outcome = { at: String(outcome.at), seq: Number(outcome.seq), kind: "agreed" };
  }
  return {
    brainstorm: {
      questions: [...questions.values()].sort((a, b) => ms(a.firstPost) - ms(b.firstPost)),
      agreements,
      endorsed: skepticEndorsements.length,
      claimsWithSource: { n: sourced, of: claims, inferred: true }
    },
    marksOf,
    unsourcedOf
  };
}
function withMemberFigures(run2) {
  const debated = run2.brainstorm !== void 0;
  const marked = (m, what) => m.marks.filter((x) => x.what === what).length;
  const lengthOf = (i) => ms(i.to) - ms(i.from);
  const members = run2.members.map((m) => ({
    ...m,
    waitingMs: m.waitingMs ?? (run2.recorded ? m.intervals.filter((i) => i.what === "waiting").reduce((n, i) => n + lengthOf(i), 0) : null),
    agreementsMade: m.agreementsMade ?? marked(m, "agreement"),
    endorsed: m.endorsed ?? (debated ? marked(m, "endorsed") : null),
    objections: m.objections ?? (debated ? marked(m, "objected") : null),
    // a summary from before the events were read (D45) reads its member as not estimated
    estimated: m.estimated ?? false
  }));
  const plan = run2.plan && {
    ...run2.plan,
    slices: slicesOfSummary(run2.plan.slices),
    shared: {
      ...run2.plan.shared,
      estimated: run2.plan.shared.estimated ?? false,
      // a summary from before `told` (D46) reads each file told, as its list read it
      perFile: run2.plan.shared.perFile.map((f) => ({ ...f, told: f.told ?? true }))
    }
  };
  return { ...run2, members, ...plan ? { plan } : {} };
}
function slicesOfSummary(slices) {
  const { estimated, ...rest } = slices;
  return { ...rest, timesEstimated: slices.timesEstimated ?? estimated ?? false };
}
function summarize(db, run2, silentAfterMs) {
  const r = db.prepare("SELECT * FROM runs WHERE id = ?").get(run2);
  if (!r) throw new Error(`no run ${run2}`);
  return withMemberFigures(computeRun(db, r, Date.now(), silentAfterMs));
}
function totalsOf(runs) {
  const plans = runs.flatMap((r) => r.plan ? [r.plan] : []);
  const recorded = runs.filter((r) => r.recorded);
  const recordedPlans = recorded.flatMap((r) => r.plan ? [r.plan] : []);
  const silentOf = (r) => r.members.filter((m) => m.intervals.some((i) => i.what === "silent")).length;
  const times = plans.flatMap((p) => p.slices.timesMs);
  const waits = recordedPlans.flatMap((p) => p.lock.waitsMs);
  const bins = [...WAIT_BINS_MS, Infinity].map((upper, i) => waits.filter((w) => w >= (WAIT_BINS_MS[i - 1] ?? 0) && w < upper).length);
  const shared = (pick) => sumKnown(plans.map((p) => pick(p.shared)));
  const files = shared((s) => s.files);
  const agreed = shared((s) => s.agreed);
  const series = (figure) => runs.map((r) => r.recorded ? figure(r) : null);
  const everyRun = (figure) => runs.map(figure);
  return {
    runs: runs.length,
    byKind: { plan: runs.filter((r) => r.kind === "plan").length, brainstorm: runs.filter((r) => r.kind === "brainstorm").length },
    notRecorded: runs.length - recorded.length,
    members: runs.length ? runs.reduce((n, r) => n + r.members.length, 0) : null,
    silentMembers: sumKnown(recorded.map(silentOf)),
    slices: {
      merged: sumKnown(plans.map((p) => p.slices.merged)),
      of: sumKnown(plans.map((p) => p.slices.of)),
      p50Ms: percentile(times, 0.5),
      p90Ms: percentile(times, 0.9),
      timesEstimatedRuns: plans.filter((p) => p.slices.timesEstimated).length
    },
    // merges: the lock turns granted, each one merge's wait
    lockWait: { merges: recordedPlans.length ? waits.length : null, p50Ms: percentile(waits, 0.5), p90Ms: percentile(waits, 0.9), bins: recordedPlans.length ? bins : [] },
    shared: {
      files,
      everyHolderTold: shared((s) => s.everyHolderTold),
      agreed,
      agreedBeforeMerge: shared((s) => s.agreedBeforeMerge),
      withoutAgreement: files === null || agreed === null ? null : files - agreed,
      estimatedRuns: plans.filter((p) => p.shared.estimated).length
    },
    flags: sumKnown(plans.map((p) => p.flags)),
    runsWithoutFlag: plans.length ? plans.filter((p) => p.flags === 0).length : null,
    conflicts: {
      known: sumKnown(plans.map((p) => p.conflicts.known)),
      inShared: sumKnown(plans.map((p) => p.conflicts.inShared)),
      unknownMerges: sumKnown(plans.map((p) => p.conflicts.unknownMerges))
    },
    brainstorm: brainstormTotalsOf(runs),
    series: {
      slicesMerged: everyRun((r) => r.plan?.slices.merged ?? null),
      sliceTimeP50: everyRun((r) => r.plan ? percentile(r.plan.slices.timesMs, 0.5) : null),
      lockWaitP50: series((r) => r.plan ? percentile(r.plan.lock.waitsMs, 0.5) : null),
      sharedAgreed: everyRun((r) => r.plan?.shared.agreed ?? null),
      // flags come from the board's messages, kept for a run before the records too (D43)
      flags: everyRun((r) => r.plan?.flags ?? null),
      conflicts: series((r) => r.plan?.conflicts.known ?? null),
      silentMembers: series(silentOf)
    }
  };
}
function brainstormTotalsOf(runs) {
  const debated = runs.flatMap((r) => r.brainstorm ? [{ run: r, debate: r.brainstorm }] : []);
  const questions = debated.flatMap((d) => d.debate.questions);
  const settled = questions.filter((q) => q.outcome !== null);
  const objectedOf = (r, q) => q.outcome !== null && r.members.some((m) => m.marks.some((x) => x.what === "objected" && x.path === q.id && x.seq !== void 0 && x.seq < q.outcome.seq));
  const n = sumKnown(debated.map((d) => d.debate.claimsWithSource.n));
  const of = sumKnown(debated.map((d) => d.debate.claimsWithSource.of));
  const silentSeatsOf = (r) => r.members.filter((m) => m.seat !== ORCHESTRATOR && m.intervals.some((i) => i.what === "silent")).length;
  const brainstorms = runs.filter((r) => r.kind === "brainstorm");
  return {
    notRecorded: brainstorms.length ? brainstorms.filter((r) => !r.recorded).length : null,
    questionsSettled: debated.length ? settled.length : null,
    questions: debated.length ? questions.length : null,
    exchangesMedian: percentile(settled.flatMap((q) => q.exchanges === null ? [] : [q.exchanges]), 0.5),
    objectedThenAgreed: debated.length ? debated.reduce((k, d) => k + d.debate.questions.filter((q) => objectedOf(d.run, q)).length, 0) : null,
    sourcedShare: n === null || !of ? null : n / of,
    claimsWithSource: { n, of },
    silentSeats: sumKnown(debated.filter((d) => d.run.recorded).map((d) => silentSeatsOf(d.run)))
  };
}
function filesAcross(runs) {
  const byPath = /* @__PURE__ */ new Map();
  for (const r of runs) {
    for (const f of r.plan?.shared.perFile ?? []) {
      const key = foldPath(f.path);
      const entry2 = byPath.get(key) ?? { path: f.path, perRun: [] };
      entry2.perRun.push({ run: r.run, holders: f.holders, agreed: f.agreement !== null, conflict: f.conflict, interface: f.interface ?? null });
      byPath.set(key, entry2);
    }
  }
  return [...byPath.values()].map(({ path: path10, perRun }) => ({
    path: path10,
    runs: perRun.map((x) => x.run),
    holders: new Set(perRun.flatMap((x) => x.holders)).size,
    agreements: perRun.filter((x) => x.agreed).length,
    conflicts: perRun.every((x) => x.conflict === null) ? null : perRun.filter((x) => x.conflict === true).length,
    // the runs in which a holder declared or claimed it an interface; null when none knows (summaries from before D37)
    declaredInterface: perRun.every((x) => x.interface === null) ? null : perRun.filter((x) => x.interface === true).length,
    perRun: perRun.map((x) => ({ run: x.run, holders: x.holders.length, conflict: x.conflict }))
  })).sort((a, b) => b.runs.length - a.runs.length || a.path.localeCompare(b.path));
}
function statsOf(db, scope, silentAfterMs) {
  for (const k of scope.kinds ?? []) profileOf(k);
  const start = periodStart(scope.since);
  const where = ["repo = ?", KEPT];
  const params = [scope.repo];
  if (scope.run !== void 0) {
    where.push("id = ?");
    params.push(scope.run);
  }
  if (scope.kinds?.length) {
    where.push(`kind IN (${scope.kinds.map(() => "?").join(", ")})`);
    params.push(...scope.kinds);
  }
  if (scope.closedOnly) where.push("state = 'closed'");
  if (start) {
    where.push("(state = 'open' OR closed_at >= ?)");
    params.push(start);
  }
  db.exec("BEGIN");
  try {
    if (scope.run !== void 0 && !db.prepare(`SELECT 1 FROM runs WHERE id = ? AND repo = ? AND ${KEPT}`).get(scope.run, scope.repo)) {
      throw new Error(`no run ${scope.run}`);
    }
    const rows = db.prepare(`SELECT * FROM runs WHERE ${where.join(" AND ")} ORDER BY opened_at, id`).all(...params);
    const stored = db.prepare("SELECT body FROM run_stats WHERE run = ?");
    const now = Date.now();
    const runs = rows.map((r) => {
      const row = stored.get(Number(r.id));
      return withMemberFigures(row ? JSON.parse(String(row.body)) : computeRun(db, r, now, silentAfterMs));
    });
    return { scope, runs, totals: totalsOf(runs), files: filesAcross(runs), silentAfterMs };
  } finally {
    db.exec("COMMIT");
  }
}
var DAY_MS, MINUTE_MS, CASELESS, foldPath, RECORDS_SINCE, SHARES_SINCE, ORCHESTRATOR, SKEPTIC, QUESTION, FLAG_BODY, isBoardFlag, SOURCE, WAIT_BINS_MS, ms, iso, firstLine, aboutNames, MERGED_BODY, FILES_LINE, KEPT;
var init_stats = __esm({
  "src/board/stats.ts"() {
    "use strict";
    init_kinds();
    init_mentions();
    DAY_MS = 24 * 60 * 60 * 1e3;
    MINUTE_MS = 60 * 1e3;
    CASELESS = process.platform === "win32";
    foldPath = (p) => CASELESS ? p.toLowerCase() : p;
    RECORDS_SINCE = "records-since";
    SHARES_SINCE = "shares-since";
    ORCHESTRATOR = "orchestrator";
    SKEPTIC = "skeptic";
    QUESTION = /^D\d+$/;
    FLAG_BODY = /flag:\s*\S+\s+wrote\s+(\S+)\s+outside its claim(?:;\s*(\S+)\s+holds it)?/;
    isBoardFlag = (m) => Number(m.by_board ?? 0) === 1 && (m.event === "flag" || m.event == null && FLAG_BODY.test(String(m.body)));
    SOURCE = /[\w./\\-]+\.\w+:\d+|#\d+|https?:\/\/\S+/;
    WAIT_BINS_MS = [1, 2, 5, 10].map((m) => m * MINUTE_MS);
    ms = (at) => Date.parse(String(at));
    iso = (t) => new Date(t).toISOString();
    firstLine = (body) => body.split(/\r?\n/)[0].slice(0, 120);
    aboutNames = (about, path10) => {
      if (about == null) return false;
      const a = foldPath(String(about).replace(/\\/g, "/"));
      const f = foldPath(path10);
      return a === f || f.endsWith(`/${a}`);
    };
    MERGED_BODY = /^merged \S+/;
    FILES_LINE = /^files: (.*)$/m;
    KEPT = "(pruned_at IS NULL OR id IN (SELECT run FROM run_stats))";
  }
});

// src/board/names.ts
function funnyName(taken, random = Math.random) {
  const used = new Set([...taken].map((t) => t.toLowerCase()));
  const pick = (xs) => xs[Math.floor(random() * xs.length) % xs.length];
  const free = ADJECTIVES.flatMap((a) => ANIMALS.map((b) => `${a} ${b}`)).filter((n) => !used.has(n.toLowerCase()));
  if (free.length) return pick(free);
  for (let i = 2; ; i++) {
    const n = `${pick(ADJECTIVES)} ${pick(ANIMALS)} ${i}`;
    if (!used.has(n.toLowerCase())) return n;
  }
}
var ADJECTIVES, ANIMALS;
var init_names = __esm({
  "src/board/names.ts"() {
    "use strict";
    ADJECTIVES = [
      "Sleepy",
      "Grumpy",
      "Brave",
      "Clumsy",
      "Dizzy",
      "Fuzzy",
      "Gentle",
      "Hasty",
      "Jolly",
      "Lucky",
      "Mighty",
      "Nimble",
      "Plucky",
      "Quiet",
      "Rusty",
      "Sneaky",
      "Tidy",
      "Witty",
      "Zesty",
      "Bouncy",
      "Cheeky",
      "Dapper",
      "Eager",
      "Fancy",
      "Giddy",
      "Humble",
      "Lofty",
      "Merry",
      "Peppy",
      "Snappy"
    ];
    ANIMALS = [
      "Otter",
      "Badger",
      "Walrus",
      "Penguin",
      "Llama",
      "Ferret",
      "Puffin",
      "Wombat",
      "Gecko",
      "Moose",
      "Panda",
      "Lemur",
      "Narwhal",
      "Hedgehog",
      "Koala",
      "Yak",
      "Toucan",
      "Beaver",
      "Platypus",
      "Raccoon",
      "Alpaca",
      "Bison",
      "Capybara",
      "Dingo",
      "Emu",
      "Flamingo",
      "Gibbon",
      "Heron",
      "Ibis",
      "Jackal"
    ];
  }
});

// src/board/liveness.ts
var claudeCodeJsonl, IDLE_MS, NO_TRANSCRIPT_MS, STALL_MS_DEFAULT, READINGS_KEPT_MS, BUSY_MAX_MS, STALLED_AGAIN_MS, LINK_LOST_MS, IN_TURN_MS, OWE_WAIT_MS, CARRY_MAX_MS, LOCK_HELD_MS;
var init_liveness = __esm({
  "src/board/liveness.ts"() {
    "use strict";
    claudeCodeJsonl = {
      name: "claude-code-jsonl",
      read(chunk, from) {
        const end = chunk.lastIndexOf(10);
        if (end < 0) return from;
        let tokens = from.tokens;
        let parsed = 0;
        for (const line of chunk.subarray(0, end).toString("utf8").split("\n")) {
          const text = line.trim();
          if (!text) continue;
          let obj;
          try {
            obj = JSON.parse(text);
          } catch {
            if (parsed === 0 && from.offset === 0) return null;
            continue;
          }
          if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
            if (parsed === 0 && from.offset === 0) return null;
            continue;
          }
          parsed++;
          const usage = obj.message?.usage;
          if (!usage) continue;
          for (const k of ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"]) {
            const n = usage[k];
            if (typeof n === "number" && Number.isFinite(n)) tokens += n;
          }
        }
        return { offset: from.offset + end + 1, tokens };
      }
    };
    IDLE_MS = 15 * 60 * 1e3;
    NO_TRANSCRIPT_MS = 30 * 1e3;
    STALL_MS_DEFAULT = 6e4;
    READINGS_KEPT_MS = 10 * 60 * 1e3;
    BUSY_MAX_MS = 15 * 60 * 1e3;
    STALLED_AGAIN_MS = 15 * 60 * 1e3;
    LINK_LOST_MS = 30 * 1e3;
    IN_TURN_MS = 120 * 1e3;
    OWE_WAIT_MS = 10 * 60 * 1e3;
    CARRY_MAX_MS = 5 * 60 * 1e3;
    LOCK_HELD_MS = 10 * 60 * 1e3;
  }
});

// src/board/board.ts
import fs2 from "node:fs";
import path2 from "node:path";
function messageLine(m) {
  const first = m.body.split(/\r?\n/)[0];
  const text = first.length > LINE_WIDTH ? `${first.slice(0, LINE_WIDTH - 1)}\u2026` : first;
  const kind = m.kind === "msg" ? "" : ` (${m.kind})`;
  const about = m.about ? ` about ${m.about}` : "";
  return `#${m.seq} ${m.from}${kind}${about}: ${text}`;
}
async function openBoard(dbPath = SQLITE_PATH) {
  process.removeAllListeners("warning");
  process.on("warning", (w) => {
    if (w.name !== "ExperimentalWarning") console.warn(w);
  });
  const { DatabaseSync } = await import("node:sqlite");
  fs2.mkdirSync(path2.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath, { timeout: 5e3 });
  const recordsAreNew = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'call_log'").get() === void 0;
  const sharesAreNew = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'shares'").get() === void 0;
  const hasTable = (name) => db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== void 0;
  const columnsOf = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => String(c.name));
  if (hasTable("slices") && !hasTable("seats")) db.exec("ALTER TABLE slices RENAME TO seats");
  if (hasTable("seats") && columnsOf("seats").includes("title")) db.exec("ALTER TABLE seats DROP COLUMN title");
  if (hasTable("participants") && columnsOf("participants").includes("slice")) db.exec("ALTER TABLE participants RENAME COLUMN slice TO seat");
  db.exec(`
    PRAGMA journal_mode = DELETE;
    -- Several CLI processes write, and aiview reads, concurrently; without a busy timeout a
    -- concurrent verb fails outright with SQLITE_BUSY.
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY,
      repo TEXT NOT NULL,
      plan TEXT NOT NULL,
      title TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'open',
      opened_at TEXT NOT NULL,
      closed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS seats (
      run INTEGER NOT NULL,
      id TEXT NOT NULL,
      role TEXT,
      area TEXT,
      blockers TEXT NOT NULL DEFAULT '[]',
      state TEXT NOT NULL DEFAULT 'ready',
      ord INTEGER NOT NULL,
      PRIMARY KEY (run, id)
    );
    CREATE TABLE IF NOT EXISTS participants (
      id INTEGER PRIMARY KEY,
      run INTEGER NOT NULL,
      seat TEXT NOT NULL,
      worktree TEXT,
      doing TEXT NOT NULL DEFAULT '',
      files TEXT NOT NULL DEFAULT '[]',
      since_seq INTEGER NOT NULL DEFAULT 0,
      joined_at TEXT NOT NULL,
      ended_at TEXT,
      last_call TEXT,
      UNIQUE (run, seat)
    );
    CREATE TABLE IF NOT EXISTS messages (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      repo TEXT NOT NULL,
      author INTEGER NOT NULL,
      body TEXT NOT NULL,
      about TEXT,
      kind TEXT NOT NULL DEFAULT 'msg',
      mentions TEXT NOT NULL DEFAULT '[]',
      at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_repo ON messages (repo, seq);
    CREATE TABLE IF NOT EXISTS deliveries (
      participant INTEGER NOT NULL,
      seq INTEGER NOT NULL,
      PRIMARY KEY (participant, seq)
    );
    -- claims are global by repository-relative path, across every run on a repository (D12, D20);
    -- a path may have several holders (D40). since_seq: the thread's last seq when it was claimed
    CREATE TABLE IF NOT EXISTS claims (
      repo TEXT NOT NULL,
      path TEXT NOT NULL,
      participant INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'inside',
      since_seq INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (repo, path, participant)
    );
    -- every claim made, kept past its release: who held a path during a run (D63), and whether as an
    -- interface: widened to 'interface' when the claim is made or widened so, never narrowed (D42)
    CREATE TABLE IF NOT EXISTS claim_log (
      repo TEXT NOT NULL,
      path TEXT NOT NULL,
      participant INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'inside',
      PRIMARY KEY (repo, path, participant)
    );
    -- a claim granted beside a live holder of the path, kept past both claims' release: who held a path
    -- at the same time as whom during a run, from the seq it began (D39); append-only, deleted with its run
    CREATE TABLE IF NOT EXISTS shares (
      repo TEXT NOT NULL,
      path TEXT NOT NULL,
      participant INTEGER NOT NULL,
      other INTEGER NOT NULL,
      seq INTEGER NOT NULL,
      PRIMARY KEY (repo, path, participant, other)
    );
    -- a holder of a shared path already told of another holder (D41): once per member and path
    CREATE TABLE IF NOT EXISTS notices (
      repo TEXT NOT NULL,
      path TEXT NOT NULL,
      participant INTEGER NOT NULL,
      other INTEGER NOT NULL,
      PRIMARY KEY (repo, path, participant, other)
    );
    CREATE TABLE IF NOT EXISTS merge_locks (
      repo TEXT PRIMARY KEY,
      participant INTEGER NOT NULL,
      at TEXT NOT NULL
    );
    -- a member refused the merge lock since its holder took it: mentioned when it is released (D65)
    CREATE TABLE IF NOT EXISTS lock_waiters (
      repo TEXT NOT NULL,
      participant INTEGER NOT NULL,
      PRIMARY KEY (repo, participant)
    );
    -- a path written outside its writer's claim, by reconcileWrites; lives while a claim on it does (D39)
    CREATE TABLE IF NOT EXISTS flags (
      repo TEXT NOT NULL,
      path TEXT NOT NULL,
      participant INTEGER NOT NULL,
      PRIMARY KEY (repo, path, participant)
    );
    -- a claim refused as held: the post that settles it claims it (D7)
    CREATE TABLE IF NOT EXISTS claim_requests (
      repo TEXT NOT NULL,
      path TEXT NOT NULL,
      participant INTEGER NOT NULL,
      kind TEXT NOT NULL,
      PRIMARY KEY (repo, path, participant)
    );
    -- a flag posted, once per writer, path and holder (D8)
    CREATE TABLE IF NOT EXISTS flag_posts (
      repo TEXT NOT NULL,
      path TEXT NOT NULL,
      participant INTEGER NOT NULL,
      holder INTEGER NOT NULL,
      PRIMARY KEY (repo, path, participant, holder)
    );
    -- a version per repository, moved by every write: what onChange compares (D39)
    CREATE TABLE IF NOT EXISTS changes (
      repo TEXT PRIMARY KEY,
      version INTEGER NOT NULL
    );
    -- one row per merge, written by merged, deleted with its run by prune (D25): files and conflicts JSON, conflicts NULL for unknown
    CREATE TABLE IF NOT EXISTS merges (
      participant INTEGER NOT NULL,
      run INTEGER NOT NULL,
      sha TEXT NOT NULL,
      at TEXT NOT NULL,
      files TEXT NOT NULL,
      conflicts TEXT
    );
    CREATE INDEX IF NOT EXISTS merges_run ON merges (run);
    -- one row per counted call, written by countCall in the verb's transaction (D25); deleted with its run
    CREATE TABLE IF NOT EXISTS call_log (participant INTEGER NOT NULL, at TEXT NOT NULL, verb TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS call_log_by_participant ON call_log (participant, at);
    -- one row per merge-lock turn: asked, granted, merged; refused counts the refusals (D25); deleted with its run
    CREATE TABLE IF NOT EXISTS lock_requests (repo TEXT NOT NULL, participant INTEGER NOT NULL, asked_at TEXT NOT NULL,
      granted_at TEXT, merged_at TEXT, refused INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS lock_requests_by_participant ON lock_requests (participant, asked_at);
    -- a closed run's figures, RunStats JSON, written once at close or by prune first; never pruned (D20, D21)
    CREATE TABLE IF NOT EXISTS run_stats (run INTEGER PRIMARY KEY, repo TEXT NOT NULL, kind TEXT NOT NULL,
      closed_at TEXT NOT NULL, body TEXT NOT NULL);
    -- board settings (D32): retention-days; the board's own last-upkeep (D16)
    CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value TEXT NOT NULL);
    -- the identities and hook_seen tables, left in stores from before D58, are no longer read or written
    -- a member done with a phase, once per run, member and phase; a phase opened again clears its rows
    CREATE TABLE IF NOT EXISTS phase_done (run INTEGER NOT NULL, participant INTEGER NOT NULL, phase TEXT NOT NULL, at TEXT NOT NULL,
      PRIMARY KEY (run, participant, phase));
    -- a member's transcript (member: its seat id, or orchestrator) and where its token counter stands
    CREATE TABLE IF NOT EXISTS transcripts (run INTEGER NOT NULL, member TEXT NOT NULL, path TEXT NOT NULL, adapter TEXT,
      offset INTEGER NOT NULL DEFAULT 0, tokens INTEGER NOT NULL DEFAULT 0, readable INTEGER NOT NULL DEFAULT 0,
      read_at TEXT, moved_at TEXT, PRIMARY KEY (run, member));
    -- the poller's readings, pruned past READINGS_KEPT_MS
    CREATE TABLE IF NOT EXISTS token_readings (run INTEGER NOT NULL, member TEXT NOT NULL, t TEXT NOT NULL, tokens INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS token_readings_by_run ON token_readings (run, t);
    -- a liveness warning posted, once per member and condition (none, unreadable); a good read clears unreadable
    CREATE TABLE IF NOT EXISTS liveness_warned (run INTEGER NOT NULL, member TEXT NOT NULL, cond TEXT NOT NULL, PRIMARY KEY (run, member, cond));
    -- a member's latest activity, from its link's frames (swarm-relay D9); stalled_at: the last stalled told of it (D11)
    CREATE TABLE IF NOT EXISTS member_activity (
      run INTEGER NOT NULL, member TEXT NOT NULL,
      grew_at INTEGER, tokens INTEGER NOT NULL DEFAULT 0, context INTEGER,
      open_tool TEXT, open_target TEXT, open_since INTEGER, last_tool TEXT,
      finished INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, stalled_at INTEGER,
      PRIMARY KEY (run, member));
    -- a member's link as the server last saw it: connected, else lost since lost_at (ms epoch); swarm-relay D37
    CREATE TABLE IF NOT EXISTS member_links (
      run INTEGER NOT NULL, member TEXT NOT NULL, connected INTEGER NOT NULL, lost_at INTEGER,
      PRIMARY KEY (run, member));
  `);
  if (recordsAreNew) db.prepare("INSERT OR IGNORE INTO settings (name, value) VALUES (?, ?)").run(RECORDS_SINCE2, (/* @__PURE__ */ new Date()).toISOString());
  if (sharesAreNew) db.prepare("INSERT OR IGNORE INTO settings (name, value) VALUES (?, ?)").run(SHARES_SINCE2, (/* @__PURE__ */ new Date()).toISOString());
  const upkeep = (table, column, ddl) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  };
  upkeep("participants", "worktree", "worktree TEXT");
  upkeep("claim_log", "kind", "kind TEXT NOT NULL DEFAULT 'inside'");
  upkeep("participants", "last_call", "last_call TEXT");
  upkeep("participants", "calls", "calls INTEGER NOT NULL DEFAULT 0");
  upkeep("participants", "waiting", "waiting INTEGER NOT NULL DEFAULT 0");
  upkeep("member_activity", "open_wait", "open_wait INTEGER NOT NULL DEFAULT 0");
  upkeep("participants", "listening", "listening INTEGER NOT NULL DEFAULT 0");
  upkeep("participants", "nick", "nick TEXT");
  upkeep("participants", "wait_gen", "wait_gen INTEGER NOT NULL DEFAULT 0");
  upkeep("participants", "merged", "merged INTEGER NOT NULL DEFAULT 0");
  upkeep("messages", "by_board", "by_board INTEGER NOT NULL DEFAULT 0");
  upkeep("runs", "link", "link TEXT");
  upkeep("messages", "meta", "meta TEXT");
  upkeep("merge_locks", "onto", "onto TEXT");
  upkeep("merge_locks", "reflog_mark", "reflog_mark INTEGER");
  upkeep("seats", "link", "link TEXT");
  upkeep("seats", "role", "role TEXT");
  upkeep("seats", "area", "area TEXT");
  upkeep("runs", "kind", "kind TEXT NOT NULL DEFAULT 'plan'");
  upkeep("messages", "run", "run INTEGER");
  upkeep("messages", "endorses", "endorses INTEGER");
  upkeep("runs", "stale_flagged", "stale_flagged INTEGER NOT NULL DEFAULT 0");
  upkeep("participants", "progress_at", "progress_at TEXT");
  upkeep("participants", "quiet_flagged", "quiet_flagged INTEGER NOT NULL DEFAULT 0");
  upkeep("runs", "pruned_at", "pruned_at TEXT");
  upkeep("messages", "event", "event TEXT");
  upkeep("participants", "subs", "subs TEXT NOT NULL DEFAULT '[]'");
  upkeep("seats", "on_events", "on_events TEXT");
  upkeep("seats", "busy_max", "busy_max INTEGER");
  upkeep("member_activity", "open_shell", "open_shell INTEGER NOT NULL DEFAULT 0");
  upkeep("runs", "phase", "phase TEXT");
  upkeep("runs", "phase_text", "phase_text TEXT");
  upkeep("runs", "paused", "paused TEXT");
  upkeep("runs", "resumed_at", "resumed_at TEXT");
  upkeep("runs", "stall_ms", `stall_ms INTEGER NOT NULL DEFAULT ${STALL_MS_DEFAULT}`);
  upkeep("runs", "protocol", "protocol TEXT");
  upkeep("runs", "stall_posts", "stall_posts INTEGER NOT NULL DEFAULT 0");
  upkeep("runs", "paused_person", "paused_person INTEGER NOT NULL DEFAULT 0");
  upkeep("runs", "phase_watch", "phase_watch TEXT");
  upkeep("participants", "phase_shown", "phase_shown TEXT");
  upkeep("runs", "phase_for", "phase_for TEXT");
  upkeep("participants", "empty_waits", "empty_waits INTEGER NOT NULL DEFAULT 0");
  upkeep("participants", "dormant", "dormant INTEGER NOT NULL DEFAULT 0");
  db.exec("CREATE TABLE IF NOT EXISTS carry_due (participant INTEGER NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY (participant, seq))");
  db.exec(`CREATE TABLE IF NOT EXISTS locks (name TEXT PRIMARY KEY, participant INTEGER NOT NULL, since TEXT NOT NULL, note TEXT);
    CREATE TABLE IF NOT EXISTS named_lock_waiters (name TEXT NOT NULL, participant INTEGER NOT NULL, since TEXT NOT NULL, PRIMARY KEY (name, participant));
    CREATE TABLE IF NOT EXISTS lock_releases (name TEXT PRIMARY KEY, at TEXT NOT NULL, by TEXT NOT NULL, how TEXT NOT NULL);`);
  upkeep("member_activity", "in_turn", "in_turn INTEGER");
  upkeep("member_activity", "last_line", "last_line TEXT");
  upkeep("member_activity", "bg_target", "bg_target TEXT");
  upkeep("member_activity", "bg_since", "bg_since INTEGER");
  upkeep("member_activity", "bg_grew_at", "bg_grew_at INTEGER");
  upkeep("member_activity", "transcript", "transcript TEXT");
  upkeep("member_activity", "owe_since", "owe_since INTEGER");
  upkeep("member_activity", "wait_left_at", "wait_left_at INTEGER");
  db.exec("CREATE INDEX IF NOT EXISTS messages_channel ON messages (repo, run, seq)");
  const claimKey = db.prepare("PRAGMA table_info(claims)").all().find((c) => c.name === "participant");
  if (claimKey && claimKey.pk === 0) {
    db.exec(`
      BEGIN;
      ALTER TABLE claims RENAME TO claims_before_d40;
      CREATE TABLE claims (
        repo TEXT NOT NULL,
        path TEXT NOT NULL,
        participant INTEGER NOT NULL,
        kind TEXT NOT NULL DEFAULT 'inside',
        since_seq INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (repo, path, participant)
      );
      INSERT INTO claims (repo, path, participant, kind) SELECT repo, path, participant, kind FROM claims_before_d40;
      DROP TABLE claims_before_d40;
      COMMIT;
    `);
  }
  const localWakers = /* @__PURE__ */ new Set();
  const touch = () => {
    for (const wake of [...localWakers]) queueMicrotask(wake);
  };
  const now = () => (/* @__PURE__ */ new Date()).toISOString();
  let depth = 0;
  let dirty = false;
  const transaction = (fn) => {
    if (depth > 0) return fn();
    db.exec("BEGIN IMMEDIATE");
    depth++;
    let ok = false;
    try {
      const out = fn();
      db.exec("COMMIT");
      ok = true;
      return out;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    } finally {
      depth--;
      if (dirty) {
        dirty = false;
        if (ok) touch();
      }
    }
  };
  const bump = (repo) => {
    db.prepare("INSERT INTO changes (repo, version) VALUES (?, 1) ON CONFLICT (repo) DO UPDATE SET version = version + 1").run(repo);
    if (depth > 0) dirty = true;
    else touch();
  };
  const runRow = (id) => {
    const r = db.prepare("SELECT * FROM runs WHERE id = ?").get(id);
    if (!r) throw new Error(`unknown run ${id}`);
    return r;
  };
  const phaseOf = (r) => r.phase == null ? null : { name: String(r.phase), text: String(r.phase_text ?? "") };
  const toRun = (r) => ({
    phase: phaseOf(r),
    paused: r.paused == null ? null : String(r.paused),
    pausedPerson: r.paused != null && Number(r.paused_person ?? 0) === 1,
    protocol: r.protocol == null ? null : String(r.protocol),
    id: Number(r.id),
    repo: String(r.repo),
    kind: profileOf(String(r.kind ?? "plan")).kind,
    plan: String(r.plan),
    group: String(r.plan),
    title: String(r.title),
    link: r.link == null ? null : String(r.link),
    state: r.state === "closed" ? "closed" : "open",
    seats: db.prepare("SELECT * FROM seats WHERE run = ? ORDER BY ord").all(Number(r.id)).map((s) => ({
      id: String(s.id),
      ...s.role == null ? {} : { role: String(s.role) },
      ...s.area == null ? {} : { area: String(s.area) },
      link: s.link == null ? null : String(s.link),
      blockers: JSON.parse(String(s.blockers)),
      state: String(s.state),
      ...s.busy_max == null ? {} : { busyMax: Number(s.busy_max) }
    }))
  });
  const nickOf = (r) => r.nick == null ? String(r.seat) : String(r.nick);
  const unusedNick = (repo) => {
    const rows = db.prepare(`${PARTICIPANT_SQL} WHERE r.repo = ? AND r.state = 'open' AND p.ended_at IS NULL`).all(repo);
    return funnyName(rows.map(nickOf));
  };
  const subsOf = (r) => JSON.parse(String(r.subs ?? "[]")).map((x) => ({
    event: x.event,
    scope: x.scope === "run" ? "run" : "any",
    ...x.carry === true ? { carry: true } : {}
  }));
  const PARTICIPANT_SQL = `SELECT p.*, r.repo, r.plan, r.kind FROM participants p JOIN runs r ON r.id = p.run`;
  const toParticipant = (r) => ({
    id: Number(r.id),
    run: Number(r.run),
    repo: String(r.repo),
    kind: profileOf(String(r.kind ?? "plan")).kind,
    plan: String(r.plan),
    seat: String(r.seat),
    name: `${r.plan}/${r.seat}`,
    nick: nickOf(r),
    ended: r.ended_at != null,
    worktree: r.worktree == null ? null : String(r.worktree),
    listening: Number(r.listening) === 1,
    subscriptions: subsOf(r)
  });
  const participantById = (id) => toParticipant(db.prepare(`${PARTICIPANT_SQL} WHERE p.id = ?`).get(id));
  const toMessage = (r) => {
    const author = participantById(Number(r.author));
    return {
      seq: Number(r.seq),
      repo: String(r.repo),
      from: author.name,
      body: String(r.body),
      about: r.about == null ? null : String(r.about),
      kind: String(r.kind),
      mentions: JSON.parse(String(r.mentions)),
      at: String(r.at),
      // an old main row (null) is labelled with its author's run (plan D13)
      run: r.run == null ? author.run : Number(r.run),
      endorses: r.endorses == null ? null : Number(r.endorses),
      event: r.event == null || !Object.hasOwn(EVENTS, String(r.event)) ? null : String(r.event),
      meta: r.meta == null ? null : JSON.parse(String(r.meta))
    };
  };
  const lastSeq = () => Number(db.prepare("SELECT COALESCE(MAX(seq), 0) AS s FROM messages").get().s);
  const openPlans = (repo) => db.prepare("SELECT DISTINCT plan FROM runs WHERE repo = ? AND state = 'open'").all(repo).map((r) => String(r.plan));
  const activeNames = (repo) => {
    const rows = db.prepare(`${PARTICIPANT_SQL} WHERE r.repo = ? AND r.state = 'open' AND p.ended_at IS NULL AND p.seat != '${ORCHESTRATOR2}'`).all(repo);
    return new Map(rows.map((r) => [nameHandle(nickOf(r)), `${r.plan}/${r.seat}`]));
  };
  const insertMessage = (p, body, about, kind, named, extra = {}) => {
    const mentions2 = named ?? extra.parties ?? (kind === "event" ? [] : parseMentions(body, p.plan, openPlans(p.repo), activeNames(p.repo)));
    const run2 = p.run;
    if (runRow(run2).state === "closed") throw new Error(`run ${run2} is closed`);
    const r = db.prepare("INSERT INTO messages (repo, author, body, about, kind, mentions, at, by_board, run, endorses, event, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(p.repo, p.id, body, about, kind, JSON.stringify(mentions2), now(), named ? 1 : 0, run2, extra.endorses ?? null, extra.event ?? null, extra.meta ? JSON.stringify(extra.meta) : null);
    const seq = Number(r.lastInsertRowid);
    bump(p.repo);
    return board2.read(seq);
  };
  const gated = (p, verb) => {
    if (!profileOf(p.kind).claims) throw new Error(`${verb}: a ${p.kind} run has no claims`);
    return p;
  };
  const live = (p) => {
    const fresh = participantById(p.id);
    if (fresh.ended) throw new Error(`member ${p.name} has ended`);
    return fresh;
  };
  const isLive = (id) => db.prepare("SELECT 1 FROM participants p JOIN runs r ON r.id = p.run WHERE p.id = ? AND p.ended_at IS NULL AND r.state = 'open'").get(id) !== void 0;
  const fold = (s) => CASELESS2 ? s.toLowerCase() : s;
  const slashes = (rel) => rel.split(/[\\/]+/).filter((x) => x && x !== ".").join("/");
  const roots = (repo) => {
    const out = /* @__PURE__ */ new Set();
    if (path2.basename(repo).toLowerCase() === ".git") out.add(path2.resolve(path2.dirname(repo)));
    const rows = db.prepare("SELECT DISTINCT p.worktree FROM participants p JOIN runs r ON r.id = p.run WHERE r.repo = ? AND p.worktree IS NOT NULL").all(repo);
    for (const r of rows) out.add(path2.resolve(String(r.worktree)));
    return [...out].sort((a, b) => b.length - a.length);
  };
  const relPath = (repo, file) => {
    if (!path2.isAbsolute(file) && !file.startsWith("/")) return slashes(file) || null;
    const abs = fold(path2.resolve(file));
    for (const root of roots(repo)) {
      const r = fold(root);
      if (abs.startsWith(r.endsWith(path2.sep) ? r : r + path2.sep)) return slashes(path2.resolve(file).slice(root.length)) || null;
    }
    return null;
  };
  const doingOf = (id) => String(db.prepare("SELECT doing FROM participants WHERE id = ?").get(id).doing) || "no note";
  const claims = claimsOf({ db, transaction, bump, now, lastSeq, participantById, isLive, insertMessage, relPath, fold, slashes, doingOf });
  const unseenRows = (me) => db.prepare(
    `SELECT m.* FROM messages m
         WHERE m.repo = ? AND m.seq > ? AND (m.author != ? OR m.event IN (${TO_AUTHOR}))
           AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.participant = ? AND d.seq = m.seq)
         ORDER BY m.seq`
  ).all(me.repo, Number(db.prepare("SELECT since_seq FROM participants WHERE id = ?").get(me.id).since_seq), me.id, me.id);
  const unreadOf = (id) => {
    const me = participantById(id);
    return unseenRows(me).filter((r) => {
      const m = toMessage(r);
      return mentions(m, me) || wakes(m, me, me.subscriptions);
    }).length;
  };
  const deliverTo = (p, fromWait, mentionsOnly = false) => {
    const me = participantById(p.id);
    const named = (m) => mentions(m, me) || (m.kind === "agreement" || m.kind === "endorsement") && m.about != null && claims.holds(me, m.about);
    const whole = profileOf(me.kind).wholeThread;
    const ownPost = (m) => whole && m.run === me.run && m.kind !== "event";
    const messages = transaction(() => {
      const unseen = unseenRows(me);
      const silentWhilePaused = runRow(me.run).paused != null;
      const due = db.prepare("SELECT 1 FROM carry_due WHERE participant = ? AND seq = ?");
      const carried2 = (r) => !silentWhilePaused && carries(toMessage(r), me, me.subscriptions);
      const woken = (r) => silentWhilePaused ? eventOf(toMessage(r)) === "urgent" || me.seat !== ORCHESTRATOR2 && eventOf(toMessage(r)) === "pause" : named(toMessage(r)) || wakes(toMessage(r), me, me.subscriptions) || carried2(r) && due.get(me.id, Number(r.seq)) != null;
      const heard = unseen.filter((r) => toMessage(r).run === me.run || woken(r) || carried2(r));
      const rows = silentWhilePaused && fromWait ? heard.some(woken) ? heard.filter(woken) : [] : !mentionsOnly ? heard : !heard.some(woken) ? [] : heard.filter((r) => woken(r) || carried2(r) || whole && ownPost(toMessage(r)));
      const mark = db.prepare("INSERT INTO deliveries (participant, seq) VALUES (?, ?)");
      for (const r of rows) mark.run(me.id, Number(r.seq));
      const at = now();
      db.prepare("UPDATE participants SET last_call = ? WHERE id = ?").run(at, me.id);
      if (fromWait) {
        const last = db.prepare("SELECT MAX(at) AS at FROM call_log WHERE participant = ?").get(me.id);
        if (last.at == null || Date.parse(at) - Date.parse(String(last.at)) >= WAIT_LOG_EVERY_MS) {
          db.prepare("INSERT INTO call_log (participant, at, verb) VALUES (?, ?, 'deliver')").run(me.id, at);
        }
      }
      if (!fromWait) {
        const r = db.prepare("UPDATE participants SET waiting = 0 WHERE id = ? AND waiting = 1").run(me.id);
        if (Number(r.changes) > 0) bump(me.repo);
      }
      return rows.map((r) => {
        const m = toMessage(r);
        const rel = r.by_board || m.kind !== "msg" || !m.about || !named(m) ? null : claims.askedAbout(me, Number(r.author), m);
        return rel ? { ...m, answer: `answer with an agreement on who changes what: swarm agree "<who changes what in ${rel}>" --about ${rel}` } : m;
      });
    });
    const full = (m) => named(m) || mentionsOnly && wakes(m, me, me.subscriptions) || ownPost(m);
    return {
      full: messages.filter(full),
      lines: messages.filter((m) => !full(m)).map(messageLine)
    };
  };
  const retentionDays = () => {
    const r = db.prepare("SELECT value FROM settings WHERE name = 'retention-days'").get();
    return r ? Number(r.value) : RETENTION_DEFAULT_DAYS;
  };
  const retentionCutoff = (at) => new Date(at.getTime() - retentionDays() * DAY_MS2).toISOString();
  const listedRuns = () => db.prepare("SELECT * FROM runs WHERE pruned_at IS NULL AND (state = 'open' OR (state = 'closed' AND closed_at >= ?)) ORDER BY id").all(retentionCutoff(/* @__PURE__ */ new Date()));
  const runSummary = (r) => {
    const id = Number(r.id);
    const count = (sql) => Number(db.prepare(sql).get(id).n);
    const open = r.state === "open";
    return {
      run: id,
      kind: profileOf(String(r.kind ?? "plan")).kind,
      plan: String(r.plan),
      group: String(r.plan),
      code: planCode(String(r.plan)),
      title: String(r.title),
      link: r.link == null ? null : String(r.link),
      open,
      members: open ? count(`SELECT COUNT(*) AS n FROM participants WHERE run = ? AND seat != '${ORCHESTRATOR2}' AND ended_at IS NULL`) : 0,
      done: count("SELECT COUNT(*) AS n FROM seats WHERE run = ? AND state = 'done'"),
      of: count("SELECT COUNT(*) AS n FROM seats WHERE run = ?"),
      phase: phaseOf(r),
      progress: progressOf(id, r.phase == null ? null : String(r.phase)),
      stallMs: Number(r.stall_ms ?? STALL_MS_DEFAULT),
      protocol: r.protocol == null ? null : String(r.protocol),
      paused: r.paused == null ? null : { text: String(r.paused), person: Number(r.paused_person ?? 0) === 1 }
    };
  };
  const repoName = (repo) => {
    const base = path2.basename(repo);
    return base.toLowerCase() === ".git" ? path2.basename(path2.dirname(repo)) : base.replace(/\.git$/i, "");
  };
  const listeners = /* @__PURE__ */ new Set();
  let watching = null;
  let versions = /* @__PURE__ */ new Map();
  const readVersions = () => new Map(db.prepare("SELECT repo, version FROM changes").all().map((r) => [String(r.repo), Number(r.version)]));
  const insertSeat = (run2, s, ord) => {
    if (s.on) parseSubscriptions(s.on);
    if (s.busyMax != null && !(Number.isInteger(s.busyMax) && s.busyMax > 0)) throw new Error(`seat ${s.id}: busyMax is a positive whole number of ms, got ${JSON.stringify(s.busyMax)}`);
    db.prepare("INSERT INTO seats (run, id, role, area, blockers, link, ord, on_events, busy_max) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      run2,
      s.id,
      s.role ?? null,
      s.area ?? null,
      JSON.stringify(s.blockers ?? []),
      s.link ?? null,
      ord,
      s.on ? JSON.stringify(s.on) : null,
      s.busyMax ?? null
    );
  };
  const compositionOf = (run2) => {
    const seats = db.prepare("SELECT * FROM seats WHERE run = ? ORDER BY ord").all(run2);
    const people = db.prepare(`${PARTICIPANT_SQL} WHERE p.run = ?`).all(run2);
    const goneSet = new Set(db.prepare("SELECT member FROM liveness_warned WHERE run = ? AND cond = 'gone'").all(run2).map((x) => String(x.member)));
    const plan = String(runRow(run2).plan);
    const showRole = new Set(seats.map((s) => s.role == null ? "" : String(s.role))).size > 1;
    const entry2 = (seat, s) => {
      const p = people.find((x) => String(x.seat) === seat);
      return {
        seat,
        member: p ? `${plan}/${seat}` : null,
        nick: p ? nickOf(p) : null,
        ...s?.role == null ? {} : { role: String(s.role) },
        ...s?.area == null ? {} : { area: String(s.area) },
        state: !p ? "not joined" : p.ended_at != null ? "ended" : goneSet.has(seat) ? "gone" : "joined"
      };
    };
    const entries = [entry2(ORCHESTRATOR2), ...seats.map((s) => entry2(String(s.id), s))];
    const lines = entries.map((e) => `${e.seat}${e.nick ? ` ${e.nick}` : ""}${showRole && e.role ? ` ${e.role}` : ""}${e.area ? ` (${e.area})` : ""}: ${e.state}`);
    return { run: run2, entries, showRole, lines };
  };
  const postComposition = (author, seat, sign, tag) => {
    const c = compositionOf(author.run);
    const e = c.entries.find((x) => x.seat === seat);
    const who = `${seat}${e?.nick ? ` ${e.nick}` : ""}${c.showRole && e?.role ? ` ${e.role}` : ""}${e?.area ? ` (${e.area})` : ""}`;
    insertMessage(author, `${sign} ${who}${tag ? ` ${tag}` : ""}`, null, "event", void 0, { event: EVENTS.composition.name });
  };
  const setSubs = (p, subs) => {
    db.prepare("UPDATE participants SET subs = ? WHERE id = ?").run(JSON.stringify(subs), p.id);
    bump(p.repo);
    return subs;
  };
  const sameSub = (a, b) => a.event === b.event && a.scope === b.scope;
  const idleSince = /* @__PURE__ */ new Map();
  const presenceOf = /* @__PURE__ */ new Map();
  const noPresence = () => ({ connected: false, lostAt: null });
  const heldWaits = /* @__PURE__ */ new Map();
  const orchestratorIn = (run2) => participantById(Number(db.prepare("SELECT id FROM participants WHERE run = ? AND seat = ?").get(run2, ORCHESTRATOR2).id));
  const activityOf = (run2, member) => db.prepare("SELECT * FROM member_activity WHERE run = ? AND member = ?").get(run2, member);
  const progressAtOf = (p, run2, a) => Math.max(
    a?.grew_at == null ? 0 : Number(a.grew_at),
    p.progress_at == null ? 0 : Date.parse(String(p.progress_at)),
    Date.parse(String(p.joined_at)),
    run2.resumed_at == null ? 0 : Date.parse(String(run2.resumed_at))
  );
  const seatBusyMaxOf = (run2, seat) => {
    const s = db.prepare("SELECT busy_max FROM seats WHERE run = ? AND id = ?").get(run2, seat);
    return s?.busy_max == null ? null : Number(s.busy_max);
  };
  const stateOf = (p, run2, t, presence, withHolder = true) => {
    const member = String(p.seat);
    const a = activityOf(Number(run2.id), member);
    const heldSince = heldWaits.get(Number(p.id)) ?? null;
    const inWait = heldSince != null;
    if (a && Number(a.finished) === 1) return { member, state: "gone", doing: null, since: Number(a.at), reason: "its agent finished without end" };
    const link = presence(member);
    const linkLost = !link.connected && link.lostAt != null && t - link.lostAt >= LINK_LOST_MS;
    const transcriptGrowing = link.transcriptGrewAt != null && t - link.transcriptGrewAt < LINK_LOST_MS;
    if (linkLost && !transcriptGrowing) return { member, state: "gone", doing: null, since: link.lostAt, reason: "its link was lost" };
    if (linkLost) return { member, state: "working", doing: a?.last_tool == null ? null : String(a.last_tool), since: link.transcriptGrewAt ?? null, reason: "link down" };
    if (!a) {
      if (inWait) return { member, state: "waiting", doing: null, since: null };
      const joined = Date.parse(String(p.joined_at));
      return { member, state: "quiet", doing: null, since: joined, reason: t - joined >= NO_TRANSCRIPT_MS ? "no transcript found" : "no activity yet" };
    }
    const open = a.open_tool == null ? null : `${a.open_tool} ${String(a.open_target ?? "")}`.trim();
    const stallMs = Number(run2.stall_ms ?? STALL_MS_DEFAULT);
    const last = a.last_tool == null ? null : String(a.last_tool);
    const lastLine = a.last_line == null ? last : String(a.last_line);
    const said = `; last: "${lastLine ?? ""}"`;
    if (open && heldSince != null && Number(a.open_wait) === 1) {
      const lockWait = withHolder ? lockWaitOf(Number(p.id), t) : null;
      if (lockWait) return { member, state: "waiting", doing: lockWait, since: Number(a.open_since) };
      const owing = owingOf(p, run2, a, t, stallMs);
      if (owing) return { member, state: "quiet", doing: open, since: owing.since, reason: `waiting, not done ${owing.phase}${said}`, rule: "owing", owes: owing.phase };
      return { member, state: "waiting", doing: open, since: Number(a.open_since) };
    }
    if (open) {
      const since = Number(a.open_since);
      const cap = Number(a.open_shell ?? 0) === 1 ? BUSY_MAX_MS : seatBusyMaxOf(Number(run2.id), member) ?? BUSY_MAX_MS;
      const long = t - since >= cap;
      return { member, state: "busy", doing: open, since, ...long ? { reason: `call open ${minutes(cap)} min, may be long or hung${said}`, rule: "call" } : {} };
    }
    const progressed = progressAtOf(p, run2, a);
    if (t - progressed < stallMs) return { member, state: "working", doing: last, since: progressed };
    const inTurn = a.in_turn == null ? null : Number(a.in_turn) === 1;
    if (inTurn === true && t - progressed < IN_TURN_MS) return { member, state: "working", doing: last, since: progressed };
    if (a.bg_target != null) {
      const target = String(a.bg_target);
      const bgSince = Number(a.bg_since);
      const outputAt = a.bg_grew_at == null ? bgSince : Number(a.bg_grew_at);
      const capped = t - bgSince >= BUSY_MAX_MS;
      if (!capped && t - outputAt < stallMs) return { member, state: "busy", doing: `background ${target}`, since: bgSince };
      const reason2 = capped ? `background ${target} ${minutes(BUSY_MAX_MS)} min${said}` : `background ${target} silent ${Math.round(stallMs / 1e3)} s${said}`;
      return { member, state: "quiet", doing: `background ${target}`, since: capped ? bgSince : outputAt, reason: reason2, rule: "background" };
    }
    if (inTurn === true) return { member, state: "quiet", doing: last, since: progressed, reason: `in turn, no line for ${minutes(IN_TURN_MS)} min (its model may be hung)${said}`, rule: "in-turn" };
    if (inTurn === false) return { member, state: "quiet", doing: last, since: progressed, reason: `turn ended${said}`, rule: "ended" };
    const reason = `no progress for ${Math.floor((t - progressed) / 1e3)}s, link ${link.connected ? "alive" : "down"}${last ? `; last ${last}` : ""}`;
    return { member, state: "quiet", doing: last, since: progressed, reason };
  };
  const minutes = (ms2) => Math.round(ms2 / 6e4);
  const phaseIsFor = (run2, seat) => run2.phase_for == null || JSON.parse(String(run2.phase_for)).includes(seat);
  const owedNameOf = (p, run2) => {
    if (String(p.seat) === ORCHESTRATOR2 || run2.state !== "open" || run2.phase == null || !phaseIsFor(run2, String(p.seat))) return null;
    const done = db.prepare("SELECT 1 FROM phase_done WHERE run = ? AND participant = ? AND phase = ?").get(Number(run2.id), Number(p.id), String(run2.phase));
    return done ? null : String(run2.phase);
  };
  const othersSettledSince = /* @__PURE__ */ new Map();
  const owingOf = (p, run2, a, t, stallMs) => {
    const phase = owedNameOf(p, run2);
    if (phase == null || a.owe_since == null) return null;
    const since = Number(a.owe_since);
    if (t - since >= OWE_WAIT_MS) return { phase, since };
    const others = db.prepare("SELECT * FROM participants WHERE run = ? AND ended_at IS NULL AND id != ? AND seat != ?").all(Number(run2.id), Number(p.id), ORCHESTRATOR2);
    const settled = others.every((o) => {
      const oa = activityOf(Number(run2.id), String(o.seat));
      const waits = heldWaits.has(Number(o.id)) && (oa == null || Number(oa.open_wait) === 1);
      return waits || owedNameOf(o, run2) == null;
    });
    const key = Number(p.id);
    if (!settled) {
      othersSettledSince.delete(key);
      return null;
    }
    const from = othersSettledSince.get(key) ?? t;
    othersSettledSince.set(key, from);
    return t - Math.max(from, since) >= stallMs ? { phase, since } : null;
  };
  const keepOwingSpan = (run2, p, a, t) => {
    const set = (oweSince, leftAt2) => {
      const was = a.owe_since == null ? null : Number(a.owe_since);
      if (was === oweSince && (a.wait_left_at == null ? null : Number(a.wait_left_at)) === leftAt2) return;
      const spanChanged = was !== oweSince;
      db.prepare(`UPDATE member_activity SET owe_since = ?, wait_left_at = ?${spanChanged ? ", stalled_at = NULL" : ""} WHERE run = ? AND member = ?`).run(oweSince, leftAt2, Number(run2.id), String(p.seat));
    };
    const held = heldWaits.get(Number(p.id));
    const inWait = held != null && a.open_tool != null && Number(a.open_wait) === 1;
    if (owedNameOf(p, run2) == null) return set(null, null);
    if (inWait) return set(a.owe_since == null ? held : Number(a.owe_since), null);
    if (a.owe_since == null) return;
    const leftAt = a.wait_left_at == null ? t : Number(a.wait_left_at);
    const progressAt = p.progress_at == null ? 0 : Date.parse(String(p.progress_at));
    const otherCall = a.open_tool != null && Number(a.open_wait) !== 1;
    const lapsed = t - leftAt >= Number(run2.stall_ms ?? STALL_MS_DEFAULT);
    if (otherCall || progressAt > leftAt || lapsed) return set(null, null);
    set(Number(a.owe_since), leftAt);
  };
  const statesOf = (run2, t) => {
    const r = db.prepare("SELECT * FROM runs WHERE id = ?").get(run2);
    if (!r) return /* @__PURE__ */ new Map();
    const presence = presenceOf.get(run2) ?? noPresence;
    const live2 = db.prepare("SELECT * FROM participants WHERE run = ? AND ended_at IS NULL ORDER BY id").all(run2);
    return new Map(live2.map((p) => [String(p.seat), stateOf(p, r, t, presence)]));
  };
  const LOCK_NAME = /^[a-z0-9:._/-]{1,80}$/;
  const memberRowOf = (id) => db.prepare("SELECT p.*, r.plan AS plan, r.repo AS repo FROM participants p JOIN runs r ON r.id = p.run WHERE p.id = ?").get(id);
  const holderOf = (lock, t) => {
    const h = memberRowOf(Number(lock.participant));
    const run2 = db.prepare("SELECT * FROM runs WHERE id = ?").get(Number(h.run));
    const st = stateOf(h, run2, t, presenceOf.get(Number(h.run)) ?? noPresence, false);
    return { member: `${h.plan}/${h.seat}`, nick: nickOf(h), run: Number(h.run), code: planCode(String(h.plan)), since: String(lock.since), state: st.state, doing: st.doing };
  };
  const lockWaitOf = (id, t) => {
    const w = db.prepare("SELECT l.* FROM named_lock_waiters w JOIN locks l ON l.name = w.name WHERE w.participant = ? ORDER BY w.since LIMIT 1").get(id);
    if (!w) return null;
    const h = holderOf(w, t);
    return `lock ${String(w.name)}, held by ${h.nick} (${h.state})`;
  };
  const releaseLocksOf = (id, how, why, only) => {
    const held = only == null ? db.prepare("SELECT * FROM locks WHERE participant = ?").all(id) : db.prepare("SELECT * FROM locks WHERE participant = ? AND name = ?").all(id, only);
    const freed = [];
    const holder = memberRowOf(id);
    for (const l of held) {
      const name = String(l.name);
      db.prepare("DELETE FROM locks WHERE name = ?").run(name);
      db.prepare("INSERT OR REPLACE INTO lock_releases (name, at, by, how) VALUES (?, ?, ?, ?)").run(name, now(), `${holder.plan}/${holder.seat}`, how);
      db.prepare("DELETE FROM liveness_warned WHERE cond = ?").run(`lock ${name}`);
      const waiters = db.prepare("SELECT p.id FROM named_lock_waiters w JOIN participants p ON p.id = w.participant WHERE w.name = ? AND p.ended_at IS NULL ORDER BY w.since").all(name).map((w) => memberRowOf(Number(w.id)));
      const names = waiters.map((w) => `${w.plan}/${w.seat}`);
      freed.push(...names);
      const byRepo = /* @__PURE__ */ new Map();
      for (const w of waiters) byRepo.set(String(w.repo), [...byRepo.get(String(w.repo)) ?? [], w]);
      if (!byRepo.has(String(holder.repo))) byRepo.set(String(holder.repo), []);
      for (const [repo, inRepo] of byRepo) {
        const holderRunOpen = runRow(Number(holder.run)).state === "open";
        const authorRow = repo === String(holder.repo) && holderRunOpen ? holder : inRepo[0];
        if (!authorRow) continue;
        const named = inRepo.map((w) => `${w.plan}/${w.seat}`);
        insertMessage(participantById(Number(authorRow.id)), `unlocked ${name}${why}${named.length ? `: ${named.map((n) => `@${n}`).join(" ")}` : ""}`, null, "event", named, {
          event: EVENTS.unlocked.name,
          meta: { unlocked: name }
        });
      }
    }
    if (only == null) db.prepare("DELETE FROM named_lock_waiters WHERE participant = ?").run(id);
    return freed;
  };
  const livenessOf = (run2, st, t) => {
    if (!st) return void 0;
    const a = activityOf(run2, st.member);
    const r = db.prepare("SELECT * FROM runs WHERE id = ?").get(run2);
    const p = db.prepare("SELECT * FROM participants WHERE run = ? AND seat = ?").get(run2, st.member);
    const link = (presenceOf.get(run2) ?? noPresence)(st.member);
    const { member: _, ...state } = st;
    return {
      ...state,
      tokens: a ? Number(a.tokens) : null,
      movedAt: a?.grew_at == null ? null : new Date(Number(a.grew_at)).toISOString(),
      // D38: the two ages, since its last progress and since its last sign of life
      progressAt: progressAtOf(p, r, a),
      aliveAt: link.connected ? t : link.lostAt
    };
  };
  const agesOf = (l) => ({ progressAt: l?.progressAt ?? null, aliveAt: l?.aliveAt ?? null });
  const doneWakeCase = (p, name, progress) => {
    const r = runRow(p.run);
    const watch = r.phase_watch == null ? [] : JSON.parse(String(r.phase_watch));
    if (watch.includes(p.seat)) return "watched";
    const opened = Number(db.prepare("SELECT MAX(seq) AS seq FROM messages WHERE run = ? AND event = ?").get(p.run, EVENTS.phase.name).seq ?? 0);
    const orch = db.prepare("SELECT id FROM participants WHERE run = ? AND seat = ?").get(p.run, ORCHESTRATOR2);
    if (orch) {
      const asked = db.prepare("SELECT seq, mentions FROM messages WHERE run = ? AND author = ? AND seq > ? AND kind != 'event' ORDER BY seq DESC").all(p.run, Number(orch.id), opened).find(
        (m) => JSON.parse(String(m.mentions)).includes(p.name)
      );
      if (asked) {
        const answered = db.prepare("SELECT 1 FROM messages WHERE author = ? AND seq > ? AND kind != 'event' LIMIT 1").get(p.id, Number(asked.seq));
        if (!answered) return `no post since the orchestrator's #${Number(asked.seq)}`;
      }
    }
    if (progress.of - progress.done === 1) {
      const owing = db.prepare("SELECT id, seat FROM participants WHERE run = ? AND seat != ? AND ended_at IS NULL").all(p.run, ORCHESTRATOR2).find(
        (o) => phaseIsFor(r, String(o.seat)) && !db.prepare("SELECT 1 FROM phase_done WHERE run = ? AND participant = ? AND phase = ?").get(p.run, Number(o.id), name) && !progress.gone.includes(`${p.plan}/${o.seat}`)
      );
      if (owing) return `all but ${String(owing.seat)}`;
    }
    return null;
  };
  const progressOf = (run2, phase) => {
    if (phase == null) return null;
    const rows = db.prepare(
      `SELECT (SELECT r.plan FROM runs r WHERE r.id = p.run) AS plan, p.seat, p.ended_at, p.dormant, EXISTS (SELECT 1 FROM phase_done d WHERE d.run = p.run AND d.participant = p.id AND d.phase = ?) AS done,
           EXISTS (SELECT 1 FROM liveness_warned w WHERE w.run = p.run AND w.member = p.seat AND w.cond = 'gone') AS gone
         FROM participants p WHERE p.run = ? AND p.seat != '${ORCHESTRATOR2}'`
    ).all(phase, run2);
    const runR = runRow(run2);
    const named = (seat) => runR.phase === phase && runR.phase_for != null && phaseIsFor(runR, seat);
    const live2 = rows.filter((r) => (Number(r.done) === 1 || r.ended_at == null || Number(r.dormant) === 1 || named(String(r.seat))) && (runR.phase !== phase || phaseIsFor(runR, String(r.seat))));
    const gone = live2.filter((r) => Number(r.done) !== 1 && r.ended_at == null && Number(r.gone) === 1);
    const counted2 = live2.filter((r) => !gone.includes(r));
    const dormant = counted2.filter((r) => Number(r.done) !== 1 && r.ended_at != null).map((r) => `${r.plan}/${r.seat}`);
    return { phase, done: counted2.filter((r) => Number(r.done) === 1).length, of: counted2.length, gone: gone.map((r) => `${r.plan}/${r.seat}`), dormant };
  };
  const allDoneOnce = (author, progress) => {
    if (!(progress.of > 0 && progress.done === progress.of)) return false;
    if (Number(db.prepare("INSERT OR IGNORE INTO liveness_warned (run, member, cond) VALUES (?, ?, ?)").run(author.run, ORCHESTRATOR2, `all-done ${progress.phase}`).changes) !== 1) return false;
    insertMessage(author, `all done ${progress.phase}: every member is done (${progress.done}/${progress.of})${goneSuffix(progress.gone)}; open the next phase`, null, "event", [`${author.plan}/${ORCHESTRATOR2}`], {
      event: EVENTS["all-done"].name,
      meta: { phase: progress.phase }
    });
    return true;
  };
  const storeRunStats = (run2) => {
    const body = summarize(db, run2, STALE_MS);
    const r = runRow(run2);
    db.prepare("INSERT OR REPLACE INTO run_stats (run, repo, kind, closed_at, body) VALUES (?, ?, ?, ?, ?)").run(run2, String(r.repo), body.kind, String(r.closed_at), JSON.stringify(body));
  };
  const board2 = {
    openRun({ repo, kind = "plan", group, title, link, seats, transcript, stallMs, protocol }) {
      const profile = profileOf(kind);
      if (protocol != null && !PROTOCOL_NAME.test(protocol)) throw new Error(`a protocol is named in lower case, digits and dashes (build-verify), got ${protocol}`);
      if (stallMs !== void 0 && !(Number.isInteger(stallMs) && stallMs > 0)) throw new Error(`the stall threshold takes a positive whole number of ms, got ${stallMs}`);
      const id = transaction(() => {
        const r = db.prepare("INSERT INTO runs (repo, kind, plan, title, link, opened_at, stall_ms, protocol) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(repo, profile.kind, group, title, link ?? null, now(), stallMs ?? STALL_MS_DEFAULT, protocol ?? null);
        const run2 = Number(r.lastInsertRowid);
        seats.forEach((s, i) => insertSeat(run2, s, i));
        const orchestrator = db.prepare("INSERT INTO participants (run, seat, since_seq, joined_at, subs, nick) VALUES (?, ?, ?, ?, ?, ?)").run(
          run2,
          ORCHESTRATOR2,
          lastSeq(),
          now(),
          JSON.stringify(profile.defaults.orchestrator),
          unusedNick(repo)
        );
        insertMessage(participantById(Number(orchestrator.lastInsertRowid)), `run ${run2} opened: ${profile.kind} ${group}, ${title}`, null, "event", void 0, {
          event: EVENTS.opened.name
        });
        bump(repo);
        return run2;
      });
      return toRun(runRow(id));
    },
    setSeatState(run2, seat, state) {
      runRow(run2);
      if (!SEAT_STATES.has(state)) throw new Error(`unknown seat state ${state}`);
      transaction(() => {
        const r = db.prepare("UPDATE seats SET state = ? WHERE run = ? AND id = ?").run(state, run2, seat);
        if (Number(r.changes) === 0) throw new Error(`unknown seat ${seat} in run ${run2}`);
        bump(String(runRow(run2).repo));
        if (state !== "done") return;
        const p = db.prepare("SELECT id FROM participants WHERE run = ? AND seat = ?").get(run2, seat);
        if (p) claims.releaseAll(Number(p.id));
      });
    },
    addSeat(run2, spec) {
      const r = runRow(run2);
      if (r.state !== "open") throw new Error(`run ${run2} is closed`);
      if (spec.id === ORCHESTRATOR2) throw new Error(`"${ORCHESTRATOR2}" is not a seat`);
      return transaction(() => {
        const ids = db.prepare("SELECT id FROM seats WHERE run = ?").all(run2).map((x) => String(x.id));
        if (ids.includes(spec.id)) throw new Error(`seat ${spec.id} is already in run ${run2}`);
        const unknown = (spec.blockers ?? []).filter((b) => !ids.includes(b));
        if (unknown.length) throw new Error(`unknown blocker ${unknown.join(", ")} in run ${run2}`);
        const ord = Number(db.prepare("SELECT COALESCE(MAX(ord), -1) AS o FROM seats WHERE run = ?").get(run2).o) + 1;
        insertSeat(run2, spec, ord);
        const orchestrator = db.prepare("SELECT id FROM participants WHERE run = ? AND seat = ?").get(run2, ORCHESTRATOR2);
        postComposition(participantById(Number(orchestrator.id)), spec.id, "+", "added");
        return toRun(runRow(run2)).seats.find((x) => x.id === spec.id);
      });
    },
    closeRun(run2) {
      runRow(run2);
      transaction(() => {
        const author = db.prepare("SELECT id FROM participants WHERE run = ? AND seat = ?").get(run2, ORCHESTRATOR2) ?? db.prepare("SELECT id FROM participants WHERE run = ? ORDER BY id LIMIT 1").get(run2);
        if (author) insertMessage(participantById(Number(author.id)), `run ${run2} closed`, null, "event", void 0, { event: EVENTS.closed.name });
        for (const m of db.prepare("SELECT id FROM participants WHERE run = ?").all(run2)) releaseLocksOf(Number(m.id), "close", ` (run ${run2} closed)`);
        db.prepare("UPDATE runs SET state = 'closed', closed_at = ? WHERE id = ?").run(now(), run2);
        bump(String(runRow(run2).repo));
        db.prepare("UPDATE participants SET ended_at = COALESCE(ended_at, ?) WHERE run = ?").run(now(), run2);
        try {
          storeRunStats(run2);
        } catch {
        }
        for (const p of db.prepare("SELECT id FROM participants WHERE run = ?").all(run2)) claims.releaseAll(Number(p.id));
      });
    },
    prune(at = /* @__PURE__ */ new Date()) {
      return transaction(() => {
        const cutoff = retentionCutoff(at);
        const expired = db.prepare("SELECT id, repo FROM runs WHERE state = 'closed' AND closed_at < ? AND pruned_at IS NULL").all(cutoff).filter((r) => {
          if (db.prepare("SELECT 1 FROM run_stats WHERE run = ?").get(Number(r.id))) return true;
          try {
            storeRunStats(Number(r.id));
            return true;
          } catch {
            return false;
          }
        });
        const touched = new Set(expired.map((r) => String(r.repo)));
        const runIds = expired.map((r) => Number(r.id));
        const inExpired = runIds.length ? `run IN (${runIds.join(", ")})` : "0";
        const doomed = db.prepare(
          `SELECT seq, repo FROM messages WHERE ${inExpired}
               OR (run IS NULL AND at < ? AND kind != 'agreement'
                   AND NOT (kind = 'endorsement' AND endorses IN (SELECT seq FROM messages WHERE run IS NULL AND kind = 'agreement')))`
        ).all(cutoff);
        const dropDeliveries = db.prepare("DELETE FROM deliveries WHERE seq = ?");
        const dropMessage = db.prepare("DELETE FROM messages WHERE seq = ?");
        for (const m of doomed) {
          dropDeliveries.run(Number(m.seq));
          dropMessage.run(Number(m.seq));
          touched.add(String(m.repo));
        }
        for (const run2 of runIds) {
          for (const r of db.prepare("SELECT id FROM participants WHERE run = ?").all(run2)) {
            const id = Number(r.id);
            for (const table of ["claim_log", "shares", "notices", "flags", "claims", "lock_waiters", "merge_locks", "deliveries", "claim_requests", "flag_posts", "call_log", "lock_requests"]) {
              db.prepare(`DELETE FROM ${table} WHERE participant = ?`).run(id);
            }
            db.prepare("DELETE FROM notices WHERE other = ?").run(id);
            db.prepare("DELETE FROM shares WHERE other = ?").run(id);
            if (!db.prepare("SELECT 1 FROM messages WHERE author = ? LIMIT 1").get(id)) db.prepare("DELETE FROM participants WHERE id = ?").run(id);
          }
          db.prepare("DELETE FROM seats WHERE run = ?").run(run2);
          db.prepare("DELETE FROM merges WHERE run = ?").run(run2);
          for (const table of ["phase_done", "transcripts", "token_readings", "liveness_warned", "member_activity", "member_links"]) db.prepare(`DELETE FROM ${table} WHERE run = ?`).run(run2);
          db.prepare("UPDATE runs SET pruned_at = ? WHERE id = ?").run(at.toISOString(), run2);
        }
        for (const repo of touched) bump(repo);
        return { messages: doomed.length, runs: runIds.length };
      });
    },
    setting(name, value) {
      if (name !== "retention-days") throw new Error(`unknown setting ${name}`);
      if (value !== void 0) {
        if (!Number.isInteger(value) || value < 1) throw new Error(`${name} takes a positive whole number of days, got ${value}`);
        db.prepare("INSERT INTO settings (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value").run(name, String(value));
      }
      return retentionDays();
    },
    upkeepIfDue(at = /* @__PURE__ */ new Date()) {
      const due = () => {
        const r = db.prepare("SELECT value FROM settings WHERE name = ?").get(LAST_UPKEEP);
        return !(at.getTime() - Date.parse(String(r?.value)) < UPKEEP_EVERY_MS);
      };
      if (!due()) return false;
      const recorded = transaction(() => {
        if (!due()) return false;
        db.prepare("INSERT INTO settings (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value").run(LAST_UPKEEP, at.toISOString());
        return true;
      });
      if (!recorded) return false;
      board2.prune(at);
      board2.flagStale(at);
      return true;
    },
    flagStale(at = /* @__PURE__ */ new Date()) {
      const silentBefore = at.getTime() - STALE_MS;
      return transaction(() => {
        const quiet = db.prepare("SELECT p.id, p.last_call, p.joined_at FROM participants p JOIN runs r ON r.id = p.run WHERE r.state = 'open' AND r.paused IS NULL AND p.seat = ? AND p.ended_at IS NULL AND p.quiet_flagged = 0").all(ORCHESTRATOR2);
        for (const o of quiet) {
          const silentSince = Date.parse(String(o.last_call ?? o.joined_at));
          if (silentSince >= silentBefore) continue;
          const minutes2 = Math.floor((at.getTime() - silentSince) / 6e4);
          insertMessage(participantById(Number(o.id)), `quiet ${minutes2} min`, null, "event", [], { event: EVENTS.quiet.name });
          db.prepare("UPDATE participants SET quiet_flagged = 1 WHERE id = ?").run(Number(o.id));
        }
        const flagged = [];
        for (const r of db.prepare("SELECT id, plan FROM runs WHERE state = 'open' AND paused IS NULL AND stale_flagged = 0 ORDER BY id").all()) {
          const id = Number(r.id);
          const members = db.prepare("SELECT id, seat, last_call, joined_at FROM participants WHERE run = ? AND ended_at IS NULL").all(id);
          if (!members.length || members.some((m) => Date.parse(String(m.last_call ?? m.joined_at)) >= silentBefore)) continue;
          const author = members.find((m) => String(m.seat) === ORCHESTRATOR2) ?? members[0];
          const group = String(r.plan);
          insertMessage(participantById(Number(author.id)), `run ${id} (${group}) is stale: every member silent; close it or dispatch again`, null, "event", [`${group}/${ORCHESTRATOR2}`], {
            event: EVENTS.stale.name
          });
          db.prepare("UPDATE runs SET stale_flagged = 1 WHERE id = ?").run(id);
          flagged.push(id);
        }
        return flagged;
      });
    },
    runs() {
      return db.prepare("SELECT * FROM runs WHERE state = 'open' ORDER BY id").all().map(toRun);
    },
    join({ run: run2, seat, doing, files, worktree, on }) {
      const r = runRow(run2);
      if (r.state !== "open") throw new Error(`run ${run2} is closed`);
      if (seat === ORCHESTRATOR2) throw new Error(`"${ORCHESTRATOR2}" is not a seat`);
      const profile = profileOf(String(r.kind ?? "plan"));
      if (files.length && !profile.claims) throw new Error(`join: a ${profile.kind} run has no claims`);
      const where = worktree && profile.worktree ? path2.resolve(worktree) : null;
      return transaction(() => {
        let entry2 = "new";
        const id = transaction(() => {
          const existing = db.prepare("SELECT id, nick, ended_at FROM participants WHERE run = ? AND seat = ?").get(run2, seat);
          const seatRow = db.prepare("SELECT on_events FROM seats WHERE run = ? AND id = ?").get(run2, seat);
          if (!seatRow && !existing) throw new Error(`seat ${seat} is not declared in run ${run2}: declare it first with \`seat add ${seat}\``);
          const seatOn = seatRow?.on_events != null ? parseSubscriptions(JSON.parse(String(seatRow.on_events))) : null;
          const subs = JSON.stringify(on ?? seatOn ?? profile.defaults.member);
          const fresh = () => unusedNick(String(r.repo));
          if (existing) {
            entry2 = existing.ended_at == null ? "again" : "back";
            db.prepare("UPDATE participants SET doing = ?, files = ?, worktree = ?, ended_at = NULL, dormant = 0, merged = 0, subs = ?, nick = COALESCE(nick, ?) WHERE id = ?").run(
              doing,
              JSON.stringify(files),
              where,
              subs,
              existing.nick == null ? fresh() : null,
              Number(existing.id)
            );
            return Number(existing.id);
          }
          const earliest = db.prepare("SELECT MIN(seq) AS seq FROM messages WHERE run = ? AND mentions LIKE ?").get(run2, `%"${String(r.plan)}/${seat}"%`);
          const since = earliest?.seq != null ? Math.min(lastSeq(), Number(earliest.seq) - 1) : lastSeq();
          const ins = db.prepare("INSERT INTO participants (run, seat, worktree, doing, files, since_seq, joined_at, nick, subs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(run2, seat, where, doing, JSON.stringify(files), since, now(), fresh(), subs);
          return Number(ins.lastInsertRowid);
        });
        const member = participantById(id);
        claims.claimDeclared(member, files);
        insertMessage(member, `joined: ${doing}`, null, "event", void 0, { event: EVENTS.joined.name });
        if (entry2 !== "again") postComposition(member, seat, "+", entry2 === "back" ? "back" : "");
        if (entry2 === "new") {
          const declared = Number(db.prepare("SELECT COUNT(*) AS n FROM seats WHERE run = ?").get(run2).n);
          const seated = Number(db.prepare("SELECT COUNT(*) AS n FROM participants WHERE run = ? AND seat != ?").get(run2, ORCHESTRATOR2).n);
          if (declared > 0 && seated >= declared && db.prepare("SELECT 1 FROM seats s WHERE s.run = ? AND NOT EXISTS (SELECT 1 FROM participants p WHERE p.run = s.run AND p.seat = s.id)").get(run2) === void 0) {
            insertMessage(member, `all joined: ${declared} seat${declared === 1 ? "" : "s"}`, null, "event", void 0, { event: EVENTS["all-joined"].name });
          }
        }
        return { member, roster: board2.roster(member.repo), composition: compositionOf(run2) };
      });
    },
    composition(run2) {
      runRow(run2);
      return compositionOf(run2);
    },
    participant(name) {
      const i = name.lastIndexOf("/");
      if (i <= 0) return null;
      const plan = name.slice(0, i);
      const seat = name.slice(i + 1);
      const r = db.prepare(`${PARTICIPANT_SQL} WHERE r.plan = ? AND p.seat = ? ORDER BY (r.state = 'open') DESC, r.id DESC LIMIT 1`).get(plan, seat);
      return r ? toParticipant(r) : null;
    },
    identify({ worktree }) {
      if (!worktree) return null;
      const here = fold(path2.resolve(worktree));
      const rows = db.prepare(`${PARTICIPANT_SQL} WHERE p.worktree IS NOT NULL AND p.ended_at IS NULL AND r.state = 'open'`).all().filter(
        (r) => {
          const root = fold(String(r.worktree));
          return here === root || here.startsWith(root.endsWith(path2.sep) ? root : root + path2.sep);
        }
      );
      if (!rows.length) return null;
      const deepest = Math.max(...rows.map((r) => String(r.worktree).length));
      const best = rows.filter((r) => String(r.worktree).length === deepest);
      return best.length === 1 ? toParticipant(best[0]) : null;
    },
    setDoing(p, doing) {
      const fresh = live(p);
      db.prepare("UPDATE participants SET doing = ? WHERE id = ?").run(doing, fresh.id);
      insertMessage(fresh, `doing: ${doing}`, null, "event");
    },
    subscribe(p, subs) {
      const fresh = live(p);
      const kept = fresh.subscriptions.filter((o) => !subs.some((s) => sameSub(o, s) && o.carry && !s.carry));
      return setSubs(fresh, [...kept, ...subs.filter((s) => !kept.some((o) => sameSub(o, s)))]);
    },
    unsubscribe(p, subs) {
      const fresh = live(p);
      return setSubs(fresh, fresh.subscriptions.filter((o) => !subs.some((s) => sameSub(o, s))));
    },
    end(p) {
      const fresh = live(p);
      const dormant = board2.idle(fresh) ? 1 : 0;
      transaction(() => {
        const waiters = claims.lockWaitersFreedBy(fresh);
        const ended = { event: EVENTS.ended.name };
        postComposition(fresh, fresh.seat, "-", "ended");
        if (waiters.length) insertMessage(fresh, `ended
the merge lock is free: ${waiters.map((n) => `@${n}`).join(" ")}`, null, "event", waiters, ended);
        else insertMessage(fresh, "ended", null, "event", void 0, ended);
        releaseLocksOf(fresh.id, "end", " (its holder ended)");
        db.prepare("UPDATE participants SET ended_at = ?, dormant = ?, doing = CASE merged WHEN 1 THEN 'merged and ended' ELSE 'ended' END WHERE id = ?").run(now(), dormant, fresh.id);
        claims.releaseAll(fresh.id);
      });
    },
    phase(p, name, text, opts = {}) {
      const fresh = live(p);
      if (fresh.seat !== ORCHESTRATOR2) throw new Error(`phase: only the orchestrator opens a phase; ${fresh.name} is not ${fresh.plan}/${ORCHESTRATOR2}`);
      if (!PHASE_NAME.test(name)) throw new Error(`phase: a phase name is one word, got ${JSON.stringify(name)}`);
      const said = text.trim();
      if (!said) throw new Error(`phase ${name}: what does it ask?`);
      if (runRow(fresh.run).state !== "open") throw new Error(`run ${fresh.run} is closed`);
      return transaction(() => {
        const seatOf = (w) => w.slice(w.lastIndexOf("/") + 1).replace(/^@/, "");
        const watch = (opts.watch ?? []).map(seatOf).filter(Boolean);
        const only = [...new Set((opts.for ?? []).map(seatOf).filter(Boolean))];
        const unknown = only.filter((s) => s === ORCHESTRATOR2 || !db.prepare("SELECT 1 FROM seats WHERE run = ? AND id = ?").get(fresh.run, s) && !db.prepare("SELECT 1 FROM participants WHERE run = ? AND seat = ?").get(fresh.run, s));
        if (unknown.length) throw new Error(`phase ${name}: --for names no seat of run ${fresh.run}: ${unknown.join(", ")}`);
        db.prepare("UPDATE runs SET phase = ?, phase_text = ?, phase_watch = ?, phase_for = ? WHERE id = ?").run(name, said, watch.length ? JSON.stringify(watch) : null, only.length ? JSON.stringify(only) : null, fresh.run);
        db.prepare("DELETE FROM phase_done WHERE run = ? AND phase = ?").run(fresh.run, name);
        db.prepare("DELETE FROM liveness_warned WHERE run = ? AND member = ? AND cond = ?").run(fresh.run, ORCHESTRATOR2, `all-done ${name}`);
        const woken = only.length ? only.map((s) => `${fresh.plan}/${s}`) : [`${fresh.plan}/*`];
        return insertMessage(fresh, `phase ${name}: ${said}`, null, "event", woken, { event: EVENTS.phase.name, meta: { phase: name } });
      });
    },
    currentPhase(run2) {
      return phaseOf(runRow(run2));
    },
    showPhase(p) {
      const fresh = participantById(p.id);
      const phase = phaseOf(runRow(fresh.run));
      if (!phase) return null;
      const opened = db.prepare("SELECT MAX(seq) AS seq FROM messages WHERE run = ? AND event = ?").get(fresh.run, EVENTS.phase.name);
      const key = `${phase.name}#${opened.seq ?? 0}`;
      const shown = db.prepare("SELECT phase_shown FROM participants WHERE id = ?").get(fresh.id);
      if (shown.phase_shown === key) return { phase, first: false };
      db.prepare("UPDATE participants SET phase_shown = ? WHERE id = ?").run(key, fresh.id);
      return { phase, first: true };
    },
    lock(p, name, note) {
      const fresh = live(p);
      if (!LOCK_NAME.test(name)) throw new Error(`lock: a lock name is [a-z0-9:._/-], at most 80 characters (port:<n>, app:<name>, db:<name>, browser:<profile>); got ${JSON.stringify(name)}`);
      return transaction(() => {
        let held = db.prepare("SELECT * FROM locks WHERE name = ?").get(name);
        if (held && memberRowOf(Number(held.participant)).ended_at != null) {
          releaseLocksOf(Number(held.participant), "end", " (its holder ended)", name);
          held = void 0;
        }
        if (!held || Number(held.participant) === fresh.id) {
          if (!held) db.prepare("INSERT INTO locks (name, participant, since, note) VALUES (?, ?, ?, ?)").run(name, fresh.id, now(), note ?? null);
          db.prepare("DELETE FROM named_lock_waiters WHERE name = ? AND participant = ?").run(name, fresh.id);
          bump(fresh.repo);
          const rel = db.prepare("SELECT at, by, how FROM lock_releases WHERE name = ?").get(name);
          return { granted: true, ...rel ? { released: { at: String(rel.at), by: String(rel.by), how: String(rel.how) } } : {} };
        }
        db.prepare("INSERT OR IGNORE INTO named_lock_waiters (name, participant, since) VALUES (?, ?, ?)").run(name, fresh.id, now());
        bump(fresh.repo);
        return { granted: false, holder: holderOf(held, Date.now()) };
      });
    },
    unlock(p, name) {
      const fresh = live(p);
      return transaction(() => {
        const held = db.prepare("SELECT 1 FROM locks WHERE name = ? AND participant = ?").get(name, fresh.id);
        if (!held) return { released: false, waiters: [] };
        const waiters = releaseLocksOf(fresh.id, "unlock", "", name);
        bump(fresh.repo);
        return { released: true, waiters };
      });
    },
    locks() {
      return db.prepare("SELECT * FROM locks ORDER BY since").all().map((l) => {
        const h = memberRowOf(Number(l.participant));
        const waiters = db.prepare("SELECT participant FROM named_lock_waiters WHERE name = ? ORDER BY since").all(String(l.name)).map((w) => {
          const r = memberRowOf(Number(w.participant));
          return `${r.plan}/${r.seat}`;
        });
        return { name: String(l.name), member: `${h.plan}/${h.seat}`, run: Number(h.run), since: String(l.since), note: l.note == null ? null : String(l.note), waiters };
      });
    },
    pause(p, text = "", opts = {}) {
      const fresh = live(p);
      if (fresh.seat !== ORCHESTRATOR2) throw new Error(`pause: only the orchestrator pauses its run; ${fresh.name} is not ${fresh.plan}/${ORCHESTRATOR2}`);
      const r = runRow(fresh.run);
      if (r.state !== "open") throw new Error(`run ${fresh.run} is closed`);
      if (r.paused != null) throw new Error(`run ${fresh.run} is already paused`);
      const said = text.trim();
      return transaction(() => {
        const person = opts.person === true;
        db.prepare("UPDATE runs SET paused = ?, paused_person = ? WHERE id = ?").run(said, person ? 1 : 0, fresh.run);
        const why = person ? `: waiting on the person${said ? `: ${said}` : ""}` : said ? `: ${said}` : "";
        return insertMessage(fresh, `pause: stop where you are and wait for the resume${why}`, null, "event", [`${fresh.plan}/*`], { event: EVENTS.pause.name, meta: { person, text: said } });
      });
    },
    resume(p, text = "") {
      const fresh = live(p);
      if (fresh.seat !== ORCHESTRATOR2) throw new Error(`resume: only the orchestrator resumes its run; ${fresh.name} is not ${fresh.plan}/${ORCHESTRATOR2}`);
      const r = runRow(fresh.run);
      if (r.state !== "open") throw new Error(`run ${fresh.run} is closed`);
      if (r.paused == null) throw new Error(`run ${fresh.run} is not paused`);
      const said = text.trim();
      return transaction(() => {
        const me = participantById(fresh.id);
        const held = unseenRows(me).map(toMessage).filter((m) => m.run === me.run && (mentions(m, me) || wakes(m, me, me.subscriptions) || carries(m, me, me.subscriptions)));
        const mark = db.prepare("INSERT OR IGNORE INTO deliveries (participant, seq) VALUES (?, ?)");
        for (const m of held) mark.run(me.id, m.seq);
        db.prepare("UPDATE runs SET paused = NULL, paused_person = 0, resumed_at = ?, stall_posts = 0 WHERE id = ?").run(now(), fresh.run);
        const message = insertMessage(fresh, `resume: continue${said ? `: ${said}` : ""}`, null, "event", [`${fresh.plan}/*`], { event: EVENTS.resume.name });
        return { ...message, held: held.map(messageLine) };
      });
    },
    pausedOf(run2) {
      const r = runRow(run2);
      return r.paused == null ? null : String(r.paused);
    },
    done(p, name) {
      const fresh = live(p);
      if (fresh.seat === ORCHESTRATOR2) throw new Error("done: the orchestrator opens phases; a member runs done");
      const current = phaseOf(runRow(fresh.run));
      if (!current) throw new Error(`done ${name}: no phase is open in run ${fresh.run}`);
      const orch = `${fresh.plan}/${ORCHESTRATOR2}`;
      if (current.name !== name) {
        const opened = db.prepare("SELECT meta FROM messages WHERE run = ? AND event = ?").all(fresh.run, EVENTS.phase.name).some(
          (r) => r.meta != null && JSON.parse(String(r.meta)).phase === name
        );
        if (!opened) throw new Error(`done ${name}: the current phase is ${current.name}`);
        return transaction(() => {
          const added = Number(db.prepare("INSERT OR IGNORE INTO phase_done (run, participant, phase, at) VALUES (?, ?, ?, ?)").run(fresh.run, fresh.id, name, now()).changes) > 0;
          const progress = progressOf(fresh.run, name);
          if (!added) return { progress, all: false, already: true, late: true, message: null };
          const message = insertMessage(fresh, `late done ${name}; the current phase is ${current.name}`, null, "event", [orch], { event: EVENTS.done.name, meta: { phase: name } });
          return { progress, all: false, already: false, late: true, message };
        });
      }
      return transaction(() => {
        const added = Number(db.prepare("INSERT OR IGNORE INTO phase_done (run, participant, phase, at) VALUES (?, ?, ?, ?)").run(fresh.run, fresh.id, name, now()).changes) > 0;
        const progress = progressOf(fresh.run, name);
        const all = progress.of > 0 && progress.done === progress.of;
        if (!added) return { progress, all, already: true, late: false, message: null };
        const wakeCase = doneWakeCase(fresh, name, progress);
        const body = `done ${name} (${progress.done}/${progress.of})${goneSuffix(progress.gone)}${wakeCase ? `: ${wakeCase}` : ""}`;
        const message = insertMessage(fresh, body, null, "event", wakeCase ? [orch] : [], { event: EVENTS.done.name, meta: { phase: name } });
        allDoneOnce(fresh, progress);
        return { progress, all, already: false, late: false, message };
      });
    },
    lastActivity(run2) {
      const r = runRow(run2);
      const row = db.prepare("SELECT MAX(COALESCE(p.last_call, p.joined_at)) AS calls, (SELECT MAX(m.at) FROM messages m JOIN participants q ON q.id = m.author WHERE q.run = ?) AS posts FROM participants p WHERE p.run = ?").get(run2, run2);
      return [String(r.opened_at), row?.calls, row?.posts].filter((v) => typeof v === "string").sort().at(-1);
    },
    phaseProgress(run2) {
      const r = runRow(run2);
      return progressOf(run2, r.phase == null ? null : String(r.phase));
    },
    owedPhase(p) {
      const row = db.prepare("SELECT id, run, seat, ended_at FROM participants WHERE id = ?").get(p.id);
      if (!row || row.ended_at != null || String(row.seat) === ORCHESTRATOR2) return null;
      const r = db.prepare("SELECT * FROM runs WHERE id = ?").get(Number(row.run));
      const current = r && r.state === "open" ? phaseOf(r) : null;
      if (!current || !phaseIsFor(r, String(row.seat))) return null;
      const done = db.prepare("SELECT 1 FROM phase_done WHERE run = ? AND participant = ? AND phase = ?").get(Number(row.run), Number(row.id), current.name);
      return done ? null : current;
    },
    recordActivity(run2, member, act, at) {
      const r = db.prepare("SELECT * FROM runs WHERE id = ?").get(run2);
      if (!r || r.state !== "open") return;
      if (!db.prepare("SELECT 1 FROM participants WHERE run = ? AND seat = ? AND ended_at IS NULL").get(run2, member)) return;
      transaction(() => {
        const o = act.openTool;
        db.prepare(
          `INSERT INTO member_activity (run, member, grew_at, tokens, context, open_tool, open_target, open_since, open_wait, last_tool, finished, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (run, member) DO UPDATE SET grew_at = excluded.grew_at, tokens = excluded.tokens, context = excluded.context, open_tool = excluded.open_tool,
             open_target = excluded.open_target, open_since = excluded.open_since, open_wait = excluded.open_wait, last_tool = excluded.last_tool, finished = excluded.finished, at = excluded.at`
        ).run(run2, member, act.grewAt, act.tokens, act.context, o?.name ?? null, o?.target ?? null, o?.since ?? null, o?.boardWait ? 1 : 0, act.lastTool, act.finished ? 1 : 0, at.getTime());
        db.prepare("UPDATE member_activity SET open_shell = ? WHERE run = ? AND member = ?").run(o?.shell ? 1 : 0, run2, member);
        const bg = act.background ?? null;
        db.prepare("UPDATE member_activity SET in_turn = ?, last_line = ?, bg_target = ?, bg_since = ?, bg_grew_at = ?, transcript = ? WHERE run = ? AND member = ?").run(
          act.inTurn == null ? null : act.inTurn ? 1 : 0,
          act.lastLine ?? null,
          bg?.target ?? null,
          bg?.since ?? null,
          bg?.outputGrewAt ?? null,
          act.transcript ?? null,
          run2,
          member
        );
        db.prepare("INSERT INTO token_readings (run, member, t, tokens) VALUES (?, ?, ?, ?)").run(run2, member, at.toISOString(), act.tokens);
        const kill = act.breach ?? null;
        if (kill) {
          const me = db.prepare("SELECT id FROM participants WHERE run = ? AND seat = ? AND ended_at IS NULL").get(run2, member);
          const unlockedPorts = (kill.ports ?? []).filter((n) => !db.prepare("SELECT 1 FROM locks WHERE name = ? AND participant = ?").get(`port:${n}`, Number(me.id)));
          const breached = kill.kind === "pattern" || unlockedPorts.length > 0;
          const command = kill.command.slice(0, 120);
          if (breached && Number(db.prepare("INSERT OR IGNORE INTO liveness_warned (run, member, cond) VALUES (?, ?, ?)").run(run2, member, `breach ${command}`).changes) === 1) {
            const orch = orchestratorIn(run2);
            const ports = kill.kind === "port" ? ` (port ${unlockedPorts.join(", ")} not locked)` : "";
            insertMessage(orch, `breach ${String(r.plan)}/${member}: ${command}${ports}`, null, "event", [orch.name], { event: EVENTS.breach.name, meta: { breach: `${String(r.plan)}/${member}` } });
          }
        }
        bump(String(r.repo));
      });
    },
    memberStates(run2, at) {
      return [...statesOf(run2, at.getTime()).values()];
    },
    livenessTick(run2, at, presence) {
      const r = db.prepare("SELECT * FROM runs WHERE id = ?").get(run2);
      if (!r || r.state !== "open") {
        presenceOf.delete(run2);
        idleSince.delete(run2);
        return false;
      }
      presenceOf.set(run2, presence);
      const t = at.getTime();
      transaction(() => {
        db.prepare("DELETE FROM token_readings WHERE run = ? AND t < ?").run(run2, new Date(t - READINGS_KEPT_MS).toISOString());
        for (const p of db.prepare("SELECT * FROM participants WHERE run = ? AND ended_at IS NULL").all(run2)) {
          const a = activityOf(run2, String(p.seat));
          if (a) keepOwingSpan(r, p, a, t);
        }
        const states = statesOf(run2, t);
        const others = [...states.values()].filter((st) => st.member !== ORCHESTRATOR2);
        const orch = orchestratorIn(run2);
        let progress = progressOf(run2, r.phase == null ? null : String(r.phase));
        let where = progress ? `phase ${progress.phase} ${progressText(progress)}` : "no phase open";
        let moved = false;
        const livenessLines = [];
        const stalledNow = [];
        for (const st of others) {
          if (st.state !== "gone") {
            if (Number(db.prepare("DELETE FROM liveness_warned WHERE run = ? AND member = ? AND cond = 'gone'").run(run2, st.member).changes) === 1) {
              insertMessage(orch, `recovered ${orch.plan}/${st.member}: ${st.state}`, null, "event", [orch.name], { event: EVENTS.recovered.name });
              postComposition(orch, st.member, "+", "back");
            }
          } else if (Number(db.prepare("INSERT OR IGNORE INTO liveness_warned (run, member, cond) VALUES (?, ?, 'gone')").run(run2, st.member).changes) === 1) {
            insertMessage(orch, `gone ${orch.plan}/${st.member}: ${st.reason}`, null, "event", [orch.name], { event: EVENTS.gone.name });
            postComposition(orch, st.member, "-", "gone");
            const goneRow = db.prepare("SELECT id FROM participants WHERE run = ? AND seat = ? AND ended_at IS NULL").get(run2, st.member);
            if (goneRow) releaseLocksOf(Number(goneRow.id), "gone", " (its holder is gone)");
          }
          if (st.reason === "link down" && st.state === "working") {
            if (Number(db.prepare("INSERT OR IGNORE INTO liveness_warned (run, member, cond) VALUES (?, ?, 'link-down')").run(run2, st.member).changes) === 1)
              livenessLines.push({ body: `${orch.plan}/${st.member}: link lost, transcript still growing: restart its link`, linkDown: `${orch.plan}/${st.member}` });
          } else db.prepare("DELETE FROM liveness_warned WHERE run = ? AND member = ? AND cond = 'link-down'").run(run2, st.member);
          const a = activityOf(run2, st.member);
          if (!a) {
            const p = db.prepare("SELECT joined_at FROM participants WHERE run = ? AND seat = ? AND ended_at IS NULL").get(run2, st.member);
            if (p && t - Date.parse(String(p.joined_at)) >= NO_TRANSCRIPT_MS) {
              const warned = db.prepare("INSERT OR IGNORE INTO liveness_warned (run, member, cond) VALUES (?, ?, 'none')").run(run2, st.member);
              if (Number(warned.changes) === 1)
                livenessLines.push({ body: `no transcript found for ${orch.plan}/${st.member}: its state is presence only` });
            }
            continue;
          }
          const longCall = st.state === "busy" && st.rule === "call";
          if (st.state !== "quiet" && !longCall || r.paused != null || !presence(st.member).connected) {
            const owingSpanOpen = a.owe_since != null;
            if (a.stalled_at != null && !owingSpanOpen) {
              db.prepare("UPDATE member_activity SET stalled_at = NULL WHERE run = ? AND member = ?").run(run2, st.member);
              moved = true;
            }
            continue;
          }
          const meta = st.rule ? { rule: st.rule, member: st.member, ...st.owes ? { phase: st.owes } : {} } : void 0;
          stalledNow.push({ st, meta, due: a.stalled_at == null || t - Number(a.stalled_at) >= STALLED_AGAIN_MS });
        }
        if (livenessLines.length === 1) {
          const [l] = livenessLines;
          insertMessage(orch, l.linkDown ? `liveness ${l.body}` : l.body, null, "event", [orch.name], { event: EVENTS.liveness.name, ...l.linkDown ? { meta: { linkDown: l.linkDown } } : {} });
        } else if (livenessLines.length > 1) {
          const downs = livenessLines.flatMap((l) => l.linkDown ? [l.linkDown] : []);
          insertMessage(orch, `liveness ${orch.plan}: ${livenessLines.map((l) => l.body).join("; ")}`, null, "event", [orch.name], {
            event: EVENTS.liveness.name,
            ...downs.length ? { meta: { linkDown: downs[0], linkDowns: downs } } : {}
          });
        }
        if (stalledNow.some((x) => x.due)) {
          if (stalledNow.length === 1) {
            const [{ st, meta }] = stalledNow;
            insertMessage(orch, `stalled ${orch.plan}/${st.member}: ${st.reason}; ${where}`, null, "event", [orch.name], { event: EVENTS.stalled.name, ...meta ? { meta } : {} });
          } else {
            const metas = stalledNow.map((x) => x.meta ?? { member: x.st.member });
            const ruled = stalledNow.find((x) => x.meta)?.meta;
            const body = `stalled ${orch.plan}: ${stalledNow.length} members: ${stalledNow.map(({ st }) => `${orch.plan}/${st.member}${st.rule ? ` (${st.rule})` : ""}: ${st.reason}`).join("; ")}; ${where}`;
            insertMessage(orch, body, null, "event", [orch.name], { event: EVENTS.stalled.name, ...ruled ? { meta: { ...ruled, members: metas } } : {} });
          }
          for (const { st } of stalledNow) db.prepare("UPDATE member_activity SET stalled_at = ? WHERE run = ? AND member = ?").run(t, run2, st.member);
        }
        if (r.paused == null) {
          const waited = db.prepare("SELECT w.name AS name, MIN(w.since) AS first, COUNT(*) AS n FROM named_lock_waiters w JOIN participants p ON p.id = w.participant WHERE p.run = ? AND p.ended_at IS NULL GROUP BY w.name").all(run2);
          for (const w of waited) {
            const name = String(w.name);
            const lock = db.prepare("SELECT * FROM locks WHERE name = ?").get(name);
            if (!lock) continue;
            const h = holderOf(lock, t);
            const holderSince = statesOf(h.run, t).get(h.member.slice(h.member.lastIndexOf("/") + 1))?.since ?? null;
            const heldLong = t - Date.parse(String(w.first)) >= LOCK_HELD_MS;
            const holderStuck = (h.state === "waiting" || h.state === "quiet") && holderSince != null && t - holderSince >= Number(r.stall_ms ?? STALL_MS_DEFAULT);
            if (!heldLong && !holderStuck) continue;
            const holderSlice = h.member.slice(h.member.lastIndexOf("/") + 1);
            const handle = `${h.code}\xB7${holderSlice}`;
            const why = heldLong ? `held ${minutes(t - Date.parse(String(w.first)))} min since its first waiter` : `its holder ${h.state} ${Math.round((t - holderSince) / 1e3)} s`;
            const body = `stalled ${h.member} \xB7 lock ${name}: ${why}; ${h.nick} (${h.state}${h.doing ? `, ${h.doing}` : ""}), ${Number(w.n)} waiting`;
            const meta = { rule: "lock", member: holderSlice, lock: name, holder: handle };
            const holderOrch = orchestratorIn(h.run);
            for (const to of h.run === run2 ? [orch] : [orch, holderOrch]) {
              if (Number(db.prepare("INSERT OR IGNORE INTO liveness_warned (run, member, cond) VALUES (?, ?, ?)").run(to.run, ORCHESTRATOR2, `lock ${name}`).changes) !== 1) continue;
              insertMessage(to, body, null, "event", [to.name], { event: EVENTS.stalled.name, meta });
            }
          }
        }
        progress = progressOf(run2, r.phase == null ? null : String(r.phase));
        where = progress ? `phase ${progress.phase} ${progressText(progress)}` : "no phase open";
        if (progress?.gone.length) allDoneOnce(orch, progress);
        const gone = others.filter((st) => st.state === "gone").map((st) => `${orch.plan}/${st.member}`);
        const present = others.filter((st) => st.state !== "gone");
        const joined = new Set(others.map((st) => st.member));
        const toJoin = db.prepare("SELECT id FROM seats WHERE run = ? AND state != 'done'").all(run2).some((s) => !joined.has(String(s.id)));
        const allWaiting = r.paused == null && !toJoin && present.length > 0 && present.every((st) => st.state === "waiting");
        if (!allWaiting) {
          const was = idleSince.get(run2);
          if (was) idleSince.set(run2, { since: Number.NaN, postedAt: was.postedAt, spellPosted: false, postedSeq: was.postedSeq, stirred: true });
        } else {
          const kept = idleSince.get(run2);
          const idle = kept && !Number.isNaN(kept.since) ? kept : { since: t, postedAt: kept?.postedAt ?? null, spellPosted: false, postedSeq: kept?.postedSeq ?? 0, stirred: kept?.stirred ?? false };
          idleSince.set(run2, idle);
          const held = t - idle.since;
          const lastSeq2 = Number(db.prepare("SELECT MAX(m.seq) AS s FROM messages m JOIN participants p ON p.id = m.author WHERE p.run = ? AND (m.event IS NULL OR m.event != 'idle')").get(run2).s ?? 0);
          if (idle.postedAt == null || t - idle.postedAt >= IDLE_MS && (idle.stirred || lastSeq2 > idle.postedSeq)) {
            const allDoneTold = r.phase != null && db.prepare("SELECT 1 FROM liveness_warned WHERE run = ? AND member = ? AND cond = ?").get(run2, ORCHESTRATOR2, `all-done ${String(r.phase)}`) != null;
            const carriedIdle = !idle.spellPosted && allDoneTold;
            idle.postedAt = t;
            idle.spellPosted = true;
            idle.postedSeq = lastSeq2;
            idle.stirred = false;
            insertMessage(orch, `idle ${Math.floor(held / 1e3)}s: every member is waiting${goneSuffix(gone)}; ${where}`, null, "event", carriedIdle ? [] : [orch.name], { event: EVENTS.idle.name });
          }
        }
        if (r.paused == null) {
          const resumedAt = r.resumed_at == null ? 0 : Date.parse(String(r.resumed_at));
          const markDue = db.prepare("INSERT OR IGNORE INTO carry_due (participant, seq) VALUES (?, ?)");
          for (const row of db.prepare("SELECT id FROM participants WHERE run = ? AND ended_at IS NULL").all(run2)) {
            const me = participantById(Number(row.id));
            if (!me.subscriptions.some((s) => s.carry)) continue;
            for (const m of unseenRows(me).map(toMessage)) {
              if (!carries(m, me, me.subscriptions) || EVENTS[eventOf(m)].ambient || t - Math.max(Date.parse(m.at), resumedAt) < CARRY_MAX_MS) continue;
              if (Number(markDue.run(me.id, m.seq).changes) === 1) moved = true;
            }
          }
        }
        if (moved) bump(String(r.repo));
      });
      return true;
    },
    endedMembers(repo) {
      const rows = db.prepare(`${PARTICIPANT_SQL} WHERE r.repo = ? AND r.state = 'open' AND p.ended_at IS NOT NULL`).all(repo);
      return [...new Set(rows.map((r) => `${r.plan}/${r.seat}`))];
    },
    heldBy(p) {
      return db.prepare("SELECT path FROM claims WHERE participant = ?").all(p.id).map((r) => String(r.path));
    },
    roster(repo) {
      const rows = db.prepare(`${PARTICIPANT_SQL} WHERE r.repo = ? AND r.state = 'open' AND p.ended_at IS NULL ORDER BY r.id, p.id`).all(repo);
      const t = Date.now();
      const cutoff = t - STALE_MS;
      const statesByRun = /* @__PURE__ */ new Map();
      const stateIn = (run2, member) => {
        if (!statesByRun.has(run2)) statesByRun.set(run2, statesOf(run2, t));
        return statesByRun.get(run2).get(member);
      };
      return rows.map((r) => ({
        name: `${r.plan}/${r.seat}`,
        nick: nickOf(r),
        run: Number(r.run),
        plan: String(r.plan),
        seat: String(r.seat),
        doing: String(r.doing),
        files: JSON.parse(String(r.files)),
        held: db.prepare("SELECT path, kind FROM claims WHERE participant = ? ORDER BY rowid").all(Number(r.id)).map((c) => ({ path: String(c.path), interface: c.kind === "interface" })),
        stale: Date.parse(String(r.last_call ?? r.joined_at)) < cutoff,
        subscriptions: subsOf(r),
        worktree: r.worktree == null ? null : String(r.worktree),
        state: stateIn(Number(r.run), String(r.seat))?.state ?? "working",
        activity: stateIn(Number(r.run), String(r.seat))?.doing ?? null,
        ...agesOf(livenessOf(Number(r.run), stateIn(Number(r.run), String(r.seat)), t)),
        unread: unreadOf(Number(r.id)),
        busyMax: seatBusyMaxOf(Number(r.run), String(r.seat))
      }));
    },
    post(p, body, opts = {}) {
      const fresh = live(p);
      let named;
      if (opts.kind === "agreement") {
        const parsed = parseMentions(body, fresh.plan, openPlans(fresh.repo), activeNames(fresh.repo));
        const extra = (opts.with ?? []).map((w) => w.trim().replace(/^@/, "")).filter(Boolean);
        const given = extra.length ? parseMentions(extra.map((w) => `@${w}`).join(" "), fresh.plan, openPlans(fresh.repo), activeNames(fresh.repo)) : [];
        const holders = !parsed.length && !given.length && opts.about ? claims.holderNames(fresh.repo, opts.about).filter((n) => n !== fresh.name) : [];
        named = [.../* @__PURE__ */ new Set([...parsed, ...given, ...holders])].filter((n) => n !== fresh.name);
        if (!named.length && profileOf(fresh.kind).claims) throw new Error("agree needs another party: @<seat> or --with <seat>; to inform, use post");
      }
      const m = insertMessage(fresh, body, opts.about ?? null, opts.kind ?? "msg", void 0, named ? { parties: named } : {});
      const claimed = profileOf(fresh.kind).claims ? claims.claimByPost(fresh, m) : null;
      return claimed ? { ...m, claimed } : m;
    },
    endorse(p, seq) {
      const fresh = live(p);
      const r = db.prepare("SELECT * FROM messages WHERE seq = ?").get(seq);
      if (!r) throw new Error(`unknown message #${seq}`);
      if (r.kind !== "agreement") throw new Error(`#${seq} is not an agreement`);
      if (Number(r.author) === fresh.id) throw new Error(`#${seq} is your own agreement`);
      const author = participantById(Number(r.author));
      const about = r.about == null ? null : String(r.about);
      return insertMessage(fresh, `endorses #${seq}`, about, "endorsement", [author.name], { endorses: seq });
    },
    thread(p, name) {
      const fresh = participantById(p.id);
      const phase = name ?? phaseOf(runRow(fresh.run))?.name;
      if (!phase) return [];
      const opened = db.prepare("SELECT MAX(seq) AS s FROM messages WHERE run = ? AND event = ? AND json_extract(meta, '$.phase') = ?").get(fresh.run, EVENTS.phase.name, phase);
      if (opened.s == null) throw new Error(`thread: phase ${phase} was never opened in run ${fresh.run}`);
      const next = db.prepare("SELECT MIN(seq) AS s FROM messages WHERE run = ? AND event = ? AND seq > ?").get(fresh.run, EVENTS.phase.name, Number(opened.s));
      return db.prepare("SELECT * FROM messages WHERE run = ? AND seq > ? AND seq < ? AND kind != 'event' ORDER BY seq").all(fresh.run, Number(opened.s), next.s == null ? Number.MAX_SAFE_INTEGER : Number(next.s)).map(toMessage);
    },
    read(seq) {
      const r = db.prepare("SELECT * FROM messages WHERE seq = ?").get(seq);
      if (!r) throw new Error(`unknown message #${seq}`);
      return toMessage(r);
    },
    deliver(p) {
      return deliverTo(p, false);
    },
    deliverMentions(p) {
      return deliverTo(p, false, true);
    },
    idle(p) {
      const row = db.prepare("SELECT * FROM participants WHERE id = ?").get(p.id);
      if (!row || row.ended_at != null || String(row.seat) === ORCHESTRATOR2 || Number(row.empty_waits) < 2) return false;
      if (owedNameOf(row, runRow(Number(row.run))) != null) return false;
      if (db.prepare("SELECT 1 FROM merge_locks WHERE participant = ? LIMIT 1").get(p.id) !== void 0) return false;
      if (db.prepare("SELECT 1 FROM claims WHERE participant = ? LIMIT 1").get(p.id) !== void 0) return false;
      return unreadOf(p.id) === 0;
    },
    unreadMentions(p) {
      return unreadOf(p.id);
    },
    wait(p, opts = {}) {
      const { timeoutMs, mentionsOnly = false, signal: abort } = opts;
      const column = mentionsOnly ? "listening" : "waiting";
      const gen = transaction(() => {
        const me = participantById(p.id);
        db.prepare("UPDATE participants SET wait_gen = wait_gen + 1, waiting = ?, listening = ? WHERE id = ?").run(mentionsOnly ? 0 : 1, mentionsOnly ? 1 : 0, me.id);
        bump(me.repo);
        return Number(db.prepare("SELECT wait_gen FROM participants WHERE id = ?").get(me.id).wait_gen);
      });
      const current = () => Number(db.prepare("SELECT wait_gen FROM participants WHERE id = ?").get(p.id).wait_gen) === gen;
      const held = Date.now();
      heldWaits.set(p.id, held);
      return new Promise((resolve, reject) => {
        let settled = false;
        let poll;
        let timer;
        let timedOut = false;
        const finish = (d) => {
          if (settled) return;
          settled = true;
          localWakers.delete(check);
          abort?.removeEventListener("abort", onAbort);
          clearInterval(poll);
          clearTimeout(timer);
          if (heldWaits.get(p.id) === held) heldWaits.delete(p.id);
          const got = !(d instanceof Error) && (d.full.length > 0 || d.lines.length > 0);
          if (got || timedOut) {
            try {
              db.prepare(`UPDATE participants SET empty_waits = ${got || !mentionsOnly ? "0" : "empty_waits + 1"} WHERE id = ?`).run(p.id);
            } catch {
            }
          }
          try {
            transaction(() => {
              const r = db.prepare(`UPDATE participants SET ${column} = 0 WHERE id = ? AND wait_gen = ? AND ${column} = 1`).run(p.id, gen);
              if (Number(r.changes) > 0) bump(participantById(p.id).repo);
            });
          } catch {
          }
          if (d instanceof Error) reject(d);
          else resolve(d);
        };
        const check = () => {
          if (settled) return;
          try {
            if (participantById(p.id).ended) return finish({ full: [], lines: [] });
            const d = transaction(() => current() ? deliverTo(p, true, mentionsOnly) : null);
            if (!d) return finish({ full: [], lines: [], superseded: true });
            if (d.full.length || d.lines.length) finish(d);
          } catch (e) {
            finish(e);
          }
        };
        const onAbort = () => finish({ full: [], lines: [] });
        if (abort?.aborted) return onAbort();
        abort?.addEventListener("abort", onAbort);
        localWakers.add(check);
        poll = setInterval(check, WAIT_POLL_MS);
        if (timeoutMs !== void 0)
          timer = setTimeout(() => {
            timedOut = true;
            finish({ full: [], lines: [] });
          }, timeoutMs);
        check();
      });
    },
    checkEdit(p, file, opts = {}) {
      return claims.checkEdit(gated(live(p), "claim"), file, opts);
    },
    reconcileWrites(p, changed) {
      return claims.reconcileWrites(gated(live(p), "reconcile"), changed);
    },
    release(p, file) {
      claims.release(gated(live(p), "release"), file);
    },
    lockMerge(p, onto, reflogMark) {
      return claims.lockMerge(gated(live(p), "merge-lock"), onto, reflogMark);
    },
    merged(p, sha, files, conflicts) {
      return claims.merged(gated(live(p), "merged"), sha, files, conflicts);
    },
    heldMergeLock(p) {
      return claims.heldMergeLock(p);
    },
    stats(scope) {
      return statsOf(db, scope, STALE_MS);
    },
    repos() {
      const byRepo = /* @__PURE__ */ new Map();
      for (const r of listedRuns()) {
        const list = byRepo.get(String(r.repo)) ?? [];
        list.push(runSummary(r));
        byRepo.set(String(r.repo), list);
      }
      const latest = (runs) => Math.max(...runs.map((x) => x.run));
      return [...byRepo.entries()].map(([repo, runs]) => ({ repo, name: repoName(repo), runs })).sort((a, b) => Number(b.runs.some((x) => x.open)) - Number(a.runs.some((x) => x.open)) || latest(b.runs) - latest(a.runs));
    },
    snapshot(repo) {
      const runRows = listedRuns().filter((r) => r.repo === repo);
      if (!runRows.length) throw new Error(`no repository ${repo}`);
      const runIds = runRows.map((r) => Number(r.id));
      const marks = runIds.map(() => "?").join(", ");
      const lockRow = db.prepare("SELECT participant, at FROM merge_locks WHERE repo = ?").get(repo);
      const lockHolder = lockRow && isLive(Number(lockRow.participant)) ? Number(lockRow.participant) : null;
      const sliceRows = db.prepare(`SELECT * FROM seats WHERE run IN (${marks}) ORDER BY run, ord`).all(...runIds);
      const sliceOf = new Map(sliceRows.map((s) => [`${s.run}/${s.id}`, s]));
      const people = db.prepare(`${PARTICIPANT_SQL} WHERE p.run IN (${marks}) ORDER BY p.run, p.id`).all(...runIds);
      const runOpen = new Map(runRows.map((r) => [Number(r.id), r.state === "open"]));
      const t = Date.now();
      const statesByRun = /* @__PURE__ */ new Map();
      const stateIn = (run2, member) => {
        if (!statesByRun.has(run2)) statesByRun.set(run2, statesOf(run2, t));
        return statesByRun.get(run2).get(member);
      };
      const cutoff = t - STALE_MS;
      const claimsOf2 = db.prepare("SELECT path, kind FROM claims WHERE participant = ? ORDER BY rowid");
      const live2 = db.prepare("SELECT c.path, c.kind, c.participant, p.seat, r.plan FROM claims c JOIN participants p ON p.id = c.participant JOIN runs r ON r.id = p.run WHERE c.repo = ? ORDER BY c.rowid").all(repo).filter((c) => isLive(Number(c.participant)));
      const files = /* @__PURE__ */ new Map();
      for (const c of live2) {
        const f = files.get(String(c.path)) ?? { path: String(c.path), holders: [], interface: false };
        f.holders.push(`${c.plan}/${c.seat}`);
        f.interface ||= c.kind === "interface";
        files.set(f.path, f);
      }
      const everClaimed = db.prepare("SELECT 1 FROM claim_log WHERE repo = ? AND path = ? AND participant = ?");
      for (const r of people) {
        if (String(r.seat) === ORCHESTRATOR2 || !isLive(Number(r.id))) continue;
        const name = `${r.plan}/${r.seat}`;
        for (const d of JSON.parse(String(r.files))) {
          const f = files.get(relPath(repo, d.path) ?? d.path);
          if (f && !f.holders.includes(name) && !everClaimed.get(repo, f.path, Number(r.id))) f.holders.push(name);
        }
      }
      const sharedBy = (path10, id) => live2.some((c) => String(c.path) === path10 && Number(c.participant) !== id);
      const roster = people.map((r) => {
        const id = Number(r.id);
        const seat = String(r.seat);
        const orchestrator = seat === ORCHESTRATOR2;
        const s = sliceOf.get(`${r.run}/${seat}`);
        const ended = r.ended_at != null;
        const state = orchestrator ? runOpen.get(Number(r.run)) ? "watching" : "done" : s?.state === "done" ? "done" : ended ? "ended" : lockHolder === id ? "merging" : Number(r.waiting) === 1 ? "waiting" : "working";
        return {
          run: Number(r.run),
          member: `${r.plan}/${seat}`,
          nick: nickOf(r),
          plan: String(r.plan),
          seat,
          ...orchestrator || s?.role == null ? {} : { role: String(s.role) },
          ...orchestrator || s?.area == null ? {} : { area: String(s.area) },
          doing: String(r.doing),
          state,
          stale: !ended && !orchestrator && Date.parse(String(r.last_call ?? r.joined_at)) < cutoff,
          files: claimsOf2.all(id).map((c) => ({ path: String(c.path), interface: c.kind === "interface", shared: sharedBy(String(c.path), id) })),
          joined: String(r.joined_at),
          ended: r.ended_at == null ? null : String(r.ended_at),
          calls: Number(r.calls ?? 0),
          listening: !ended && Number(r.listening) === 1,
          on: subsOf(r).map((x) => formatSubscriptions([x])),
          lastCall: String(r.last_call ?? r.joined_at),
          liveness: ended ? void 0 : livenessOf(Number(r.run), stateIn(Number(r.run), seat), t),
          unread: ended ? 0 : unreadOf(id)
        };
      });
      const events = db.prepare("SELECT * FROM (SELECT * FROM messages WHERE repo = ? ORDER BY seq DESC LIMIT ?) ORDER BY seq").all(repo, EVENTS_SHOWN).map((r) => {
        const m = toMessage(r);
        return {
          seq: m.seq,
          at: m.at,
          kind: m.kind,
          from: m.from,
          body: m.body,
          about: m.about,
          run: m.run,
          channel: m.run,
          event: m.event,
          mentions: m.mentions,
          meta: m.meta ?? null
        };
      });
      const nameOf = new Map(people.map((r) => [`${r.run}/${r.seat}`, `${r.plan}/${r.seat}`]));
      const queues = {};
      for (const run2 of runRows) {
        queues[String(run2.plan)] = sliceRows.filter((s) => Number(s.run) === Number(run2.id)).map((s) => ({
          seat: String(s.id),
          ...s.role == null ? {} : { role: String(s.role) },
          ...s.area == null ? {} : { area: String(s.area) },
          link: s.link == null ? null : String(s.link),
          state: String(s.state),
          blockers: JSON.parse(String(s.blockers)),
          member: nameOf.get(`${run2.id}/${s.id}`) ?? null
        }));
      }
      const flags = db.prepare("SELECT f.path, p.seat, r.plan FROM flags f JOIN participants p ON p.id = f.participant JOIN runs r ON r.id = p.run WHERE f.repo = ? ORDER BY f.rowid").all(repo).map((f) => ({ path: String(f.path), member: `${f.plan}/${f.seat}` }));
      const lockHistory = db.prepare("SELECT t.asked_at, t.granted_at, t.merged_at, t.refused, p.seat, r.plan FROM lock_requests t JOIN participants p ON p.id = t.participant JOIN runs r ON r.id = p.run WHERE t.repo = ? ORDER BY t.asked_at DESC, t.rowid DESC LIMIT 50").all(repo).map((t2) => ({
        member: `${t2.plan}/${t2.seat}`,
        askedAt: String(t2.asked_at),
        grantedAt: t2.granted_at == null ? null : String(t2.granted_at),
        mergedAt: t2.merged_at == null ? null : String(t2.merged_at),
        refused: Number(t2.refused)
      }));
      return {
        repo,
        name: repoName(repo),
        runs: runRows.map(runSummary),
        lockHistory,
        lock: lockHolder !== null ? { holder: participantById(lockHolder).name, since: String(lockRow.at) } : null,
        roster,
        events,
        queues,
        files: [...files.values()],
        flags
      };
    },
    onChange(listener) {
      listeners.add(listener);
      if (!watching) {
        versions = readVersions();
        const check = () => {
          let next;
          try {
            next = readVersions();
          } catch {
            return;
          }
          const moved = [...next].filter(([repo, v]) => versions.get(repo) !== v).map(([repo]) => repo);
          versions = next;
          for (const repo of moved) for (const l of [...listeners]) l(repo);
        };
        localWakers.add(check);
        const poll = setInterval(check, WAIT_POLL_MS);
        poll.unref?.();
        watching = { close: () => (localWakers.delete(check), clearInterval(poll)) };
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size && watching) {
          watching.close();
          watching = null;
        }
      };
    },
    recordLink(run2, member, link) {
      db.prepare("INSERT OR REPLACE INTO member_links (run, member, connected, lost_at) VALUES (?, ?, ?, ?)").run(run2, member, link.connected ? 1 : 0, link.lostAt);
    },
    savedLinks() {
      return db.prepare("SELECT * FROM member_links").all().map((r) => ({
        run: Number(r.run),
        member: String(r.member),
        connected: Number(r.connected) === 1,
        lostAt: r.lost_at == null ? null : Number(r.lost_at)
      }));
    },
    close() {
      watching?.close();
      watching = null;
      listeners.clear();
      db.close();
    }
  };
  const PROGRESS_VERBS = /* @__PURE__ */ new Set(["post", "done", "setDoing", "endorse", "merged"]);
  const countCall = (p, verb) => {
    const at = now();
    db.prepare("UPDATE participants SET calls = calls + 1, last_call = ? WHERE id = ?").run(at, p.id);
    if (PROGRESS_VERBS.has(verb)) db.prepare("UPDATE participants SET progress_at = ? WHERE id = ?").run(at, p.id);
    db.prepare("INSERT INTO call_log (participant, at, verb) VALUES (?, ?, ?)").run(p.id, at, verb);
    db.prepare("UPDATE runs SET stale_flagged = 0 WHERE id = ? AND stale_flagged = 1").run(p.run);
    if (Number(db.prepare("UPDATE participants SET quiet_flagged = 0 WHERE id = ? AND quiet_flagged = 1").run(p.id).changes) > 0 && runRow(p.run).state === "open")
      insertMessage(participantById(p.id), "back", null, "event", [], { event: EVENTS.back.name });
    bump(participantById(p.id).repo);
  };
  const counted = (name, verb) => (p, ...rest) => transaction(() => {
    const out = verb(p, ...rest);
    countCall(p, name);
    return out;
  });
  board2.setDoing = counted("setDoing", board2.setDoing);
  board2.subscribe = counted("subscribe", board2.subscribe);
  board2.unsubscribe = counted("unsubscribe", board2.unsubscribe);
  board2.end = counted("end", board2.end);
  board2.post = counted("post", board2.post);
  board2.phase = counted("phase", board2.phase);
  board2.pause = counted("pause", board2.pause);
  board2.resume = counted("resume", board2.resume);
  board2.done = counted("done", board2.done);
  board2.endorse = counted("endorse", board2.endorse);
  board2.deliver = counted("deliver", board2.deliver);
  board2.wait = counted("wait", board2.wait);
  board2.checkEdit = counted("checkEdit", board2.checkEdit);
  board2.release = counted("release", board2.release);
  board2.lockMerge = counted("lockMerge", board2.lockMerge);
  board2.merged = counted("merged", board2.merged);
  const read = board2.read;
  board2.read = (seq, by) => {
    const m = read(seq);
    if (by) transaction(() => countCall(by, "read"));
    return m;
  };
  return board2;
}
var progressText, goneSuffix, PROTOCOL_NAME, PHASE_NAME, SEAT_STATES, TO_AUTHOR, ORCHESTRATOR2, WAIT_POLL_MS, LINE_WIDTH, STALE_MS, WAIT_LOG_EVERY_MS, UPKEEP_EVERY_MS, LAST_UPKEEP, RECORDS_SINCE2, SHARES_SINCE2, RETENTION_DEFAULT_DAYS, DAY_MS2, EVENTS_SHOWN, CASELESS2;
var init_board = __esm({
  "src/board/board.ts"() {
    "use strict";
    init_home();
    init_mentions();
    init_claims();
    init_stats();
    init_kinds();
    init_events();
    init_names();
    init_liveness();
    progressText = (p) => `${p.done}/${p.of} done${p.gone.length ? `, ${p.gone.length} gone` : ""}`;
    goneSuffix = (gone) => gone.length ? ` (${gone.length} gone: ${gone.join(", ")})` : "";
    PROTOCOL_NAME = /^[a-z0-9][a-z0-9-]*$/;
    PHASE_NAME = /^[\w.-]+$/;
    SEAT_STATES = /* @__PURE__ */ new Set(["ready", "running", "done", "blocked"]);
    TO_AUTHOR = Object.values(EVENTS).filter((e) => e.toAuthor).map((e) => `'${e.name}'`).join(", ");
    ORCHESTRATOR2 = "orchestrator";
    WAIT_POLL_MS = 1e3;
    LINE_WIDTH = 100;
    STALE_MS = 10 * 60 * 1e3;
    WAIT_LOG_EVERY_MS = 60 * 1e3;
    UPKEEP_EVERY_MS = 5 * 60 * 1e3;
    LAST_UPKEEP = "last-upkeep";
    RECORDS_SINCE2 = "records-since";
    SHARES_SINCE2 = "shares-since";
    RETENTION_DEFAULT_DAYS = 30;
    DAY_MS2 = 24 * 60 * 60 * 1e3;
    EVENTS_SHOWN = 500;
    CASELESS2 = process.platform === "win32";
  }
});

// src/wire.ts
import crypto from "node:crypto";
import fs3 from "node:fs";
import path3 from "node:path";
function encode(f) {
  return JSON.stringify(f);
}
function decode(text) {
  const f = JSON.parse(text);
  const type = f && typeof f === "object" ? f.type : void 0;
  if (typeof type !== "string" || !FRAME_TYPES.has(type)) throw new Error(`unknown frame type: ${String(type)}`);
  return f;
}
function bundleVersion(entry2 = process.argv[1] ?? "") {
  const file = path3.resolve(entry2);
  let v = versionsByEntry.get(file);
  if (v === void 0) {
    v = crypto.createHash("sha256").update(fs3.readFileSync(file)).digest("hex").slice(0, 16);
    versionsByEntry.set(file, v);
  }
  return v;
}
function serverStateFile(dataRoot) {
  return path3.join(dataRoot, "swarm-server.json");
}
function serverLogFile(dataRoot) {
  return path3.join(dataRoot, "swarm-server.log");
}
function serverStartLock(dataRoot) {
  return path3.join(dataRoot, "swarm-server.lock");
}
function serverLockHolder(dataRoot) {
  try {
    const pid = Number(fs3.readFileSync(serverStartLock(dataRoot), "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}
function liveStartLockHolder(dataRoot) {
  const holder = serverLockHolder(dataRoot);
  if (holder === null || !isAlive(holder)) return null;
  try {
    if (JSON.parse(fs3.readFileSync(serverStateFile(dataRoot), "utf8")).pid === holder) return holder;
  } catch {
  }
  try {
    return Date.now() - fs3.statSync(serverStartLock(dataRoot)).mtimeMs < START_LOCK_GRACE_MS ? holder : null;
  } catch {
    return null;
  }
}
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}
var RPC_METHODS, FRAME_TYPES, versionsByEntry, SERVER_STARTER_ENV, START_LOCK_GRACE_MS;
var init_wire = __esm({
  "src/wire.ts"() {
    "use strict";
    RPC_METHODS = [
      "openRun",
      "setSeatState",
      "addSeat",
      "closeRun",
      "phase",
      "currentPhase",
      "showPhase",
      "lock",
      "unlock",
      "locks",
      "pause",
      "resume",
      "pausedOf",
      "done",
      "phaseProgress",
      "lastActivity",
      "owedPhase",
      "idle",
      "unreadMentions",
      "setting",
      "runs",
      "join",
      "participant",
      "identify",
      "setDoing",
      "subscribe",
      "unsubscribe",
      "end",
      "roster",
      "endedMembers",
      "heldBy",
      "post",
      "endorse",
      "read",
      "thread",
      "deliver",
      "deliverMentions",
      "wait",
      "checkEdit",
      "reconcileWrites",
      "release",
      "lockMerge",
      "merged",
      "heldMergeLock",
      "stats",
      "repos",
      "snapshot",
      "composition"
    ];
    FRAME_TYPES = /* @__PURE__ */ new Set(["hello", "call", "cancel", "activity", "bye", "subscribe", "welcome", "result", "refused", "changed"]);
    versionsByEntry = /* @__PURE__ */ new Map();
    SERVER_STARTER_ENV = "SWARM_SERVER_STARTER";
    START_LOCK_GRACE_MS = 15e3;
  }
});

// node_modules/ws/lib/constants.js
var require_constants = __commonJS({
  "node_modules/ws/lib/constants.js"(exports, module) {
    "use strict";
    var BINARY_TYPES = ["nodebuffer", "arraybuffer", "fragments"];
    var hasBlob = typeof Blob !== "undefined";
    if (hasBlob) BINARY_TYPES.push("blob");
    module.exports = {
      BINARY_TYPES,
      EMPTY_BUFFER: Buffer.alloc(0),
      GUID: "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
      hasBlob,
      kForOnEventAttribute: /* @__PURE__ */ Symbol("kIsForOnEventAttribute"),
      kListener: /* @__PURE__ */ Symbol("kListener"),
      kStatusCode: /* @__PURE__ */ Symbol("status-code"),
      kWebSocket: /* @__PURE__ */ Symbol("websocket"),
      NOOP: () => {
      }
    };
  }
});

// node_modules/ws/lib/buffer-util.js
var require_buffer_util = __commonJS({
  "node_modules/ws/lib/buffer-util.js"(exports, module) {
    "use strict";
    var { EMPTY_BUFFER } = require_constants();
    var FastBuffer = Buffer[Symbol.species];
    function concat(list, totalLength) {
      if (list.length === 0) return EMPTY_BUFFER;
      if (list.length === 1) return list[0];
      const target = Buffer.allocUnsafe(totalLength);
      let offset = 0;
      for (let i = 0; i < list.length; i++) {
        const buf = list[i];
        target.set(buf, offset);
        offset += buf.length;
      }
      if (offset < totalLength) {
        return new FastBuffer(target.buffer, target.byteOffset, offset);
      }
      return target;
    }
    function _mask(source, mask, output, offset, length) {
      for (let i = 0; i < length; i++) {
        output[offset + i] = source[i] ^ mask[i & 3];
      }
    }
    function _unmask(buffer, mask) {
      for (let i = 0; i < buffer.length; i++) {
        buffer[i] ^= mask[i & 3];
      }
    }
    function toArrayBuffer(buf) {
      if (buf.length === buf.buffer.byteLength) {
        return buf.buffer;
      }
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
    }
    function toBuffer(data) {
      toBuffer.readOnly = true;
      if (Buffer.isBuffer(data)) return data;
      let buf;
      if (data instanceof ArrayBuffer) {
        buf = new FastBuffer(data);
      } else if (ArrayBuffer.isView(data)) {
        buf = new FastBuffer(data.buffer, data.byteOffset, data.byteLength);
      } else {
        buf = Buffer.from(data);
        toBuffer.readOnly = false;
      }
      return buf;
    }
    module.exports = {
      concat,
      mask: _mask,
      toArrayBuffer,
      toBuffer,
      unmask: _unmask
    };
    if (!process.env.WS_NO_BUFFER_UTIL) {
      try {
        const bufferUtil = __require("bufferutil");
        module.exports.mask = function(source, mask, output, offset, length) {
          if (length < 48) _mask(source, mask, output, offset, length);
          else bufferUtil.mask(source, mask, output, offset, length);
        };
        module.exports.unmask = function(buffer, mask) {
          if (buffer.length < 32) _unmask(buffer, mask);
          else bufferUtil.unmask(buffer, mask);
        };
      } catch (e) {
      }
    }
  }
});

// node_modules/ws/lib/limiter.js
var require_limiter = __commonJS({
  "node_modules/ws/lib/limiter.js"(exports, module) {
    "use strict";
    var kDone = /* @__PURE__ */ Symbol("kDone");
    var kRun = /* @__PURE__ */ Symbol("kRun");
    var Limiter = class {
      /**
       * Creates a new `Limiter`.
       *
       * @param {Number} [concurrency=Infinity] The maximum number of jobs allowed
       *     to run concurrently
       */
      constructor(concurrency) {
        this[kDone] = () => {
          this.pending--;
          this[kRun]();
        };
        this.concurrency = concurrency || Infinity;
        this.jobs = [];
        this.pending = 0;
      }
      /**
       * Adds a job to the queue.
       *
       * @param {Function} job The job to run
       * @public
       */
      add(job) {
        this.jobs.push(job);
        this[kRun]();
      }
      /**
       * Removes a job from the queue and runs it if possible.
       *
       * @private
       */
      [kRun]() {
        if (this.pending === this.concurrency) return;
        if (this.jobs.length) {
          const job = this.jobs.shift();
          this.pending++;
          job(this[kDone]);
        }
      }
    };
    module.exports = Limiter;
  }
});

// node_modules/ws/lib/permessage-deflate.js
var require_permessage_deflate = __commonJS({
  "node_modules/ws/lib/permessage-deflate.js"(exports, module) {
    "use strict";
    var zlib = __require("zlib");
    var bufferUtil = require_buffer_util();
    var Limiter = require_limiter();
    var { kStatusCode } = require_constants();
    var FastBuffer = Buffer[Symbol.species];
    var TRAILER = Buffer.from([0, 0, 255, 255]);
    var kPerMessageDeflate = /* @__PURE__ */ Symbol("permessage-deflate");
    var kTotalLength = /* @__PURE__ */ Symbol("total-length");
    var kCallback = /* @__PURE__ */ Symbol("callback");
    var kBuffers = /* @__PURE__ */ Symbol("buffers");
    var kError = /* @__PURE__ */ Symbol("error");
    var zlibLimiter;
    var PerMessageDeflate = class {
      /**
       * Creates a PerMessageDeflate instance.
       *
       * @param {Object} [options] Configuration options
       * @param {(Boolean|Number)} [options.clientMaxWindowBits] Advertise support
       *     for, or request, a custom client window size
       * @param {Boolean} [options.clientNoContextTakeover=false] Advertise/
       *     acknowledge disabling of client context takeover
       * @param {Number} [options.concurrencyLimit=10] The number of concurrent
       *     calls to zlib
       * @param {(Boolean|Number)} [options.serverMaxWindowBits] Request/confirm the
       *     use of a custom server window size
       * @param {Boolean} [options.serverNoContextTakeover=false] Request/accept
       *     disabling of server context takeover
       * @param {Number} [options.threshold=1024] Size (in bytes) below which
       *     messages should not be compressed if context takeover is disabled
       * @param {Object} [options.zlibDeflateOptions] Options to pass to zlib on
       *     deflate
       * @param {Object} [options.zlibInflateOptions] Options to pass to zlib on
       *     inflate
       * @param {Boolean} [isServer=false] Create the instance in either server or
       *     client mode
       * @param {Number} [maxPayload=0] The maximum allowed message length
       */
      constructor(options, isServer, maxPayload) {
        this._maxPayload = maxPayload | 0;
        this._options = options || {};
        this._threshold = this._options.threshold !== void 0 ? this._options.threshold : 1024;
        this._isServer = !!isServer;
        this._deflate = null;
        this._inflate = null;
        this.params = null;
        if (!zlibLimiter) {
          const concurrency = this._options.concurrencyLimit !== void 0 ? this._options.concurrencyLimit : 10;
          zlibLimiter = new Limiter(concurrency);
        }
      }
      /**
       * @type {String}
       */
      static get extensionName() {
        return "permessage-deflate";
      }
      /**
       * Create an extension negotiation offer.
       *
       * @return {Object} Extension parameters
       * @public
       */
      offer() {
        const params = {};
        if (this._options.serverNoContextTakeover) {
          params.server_no_context_takeover = true;
        }
        if (this._options.clientNoContextTakeover) {
          params.client_no_context_takeover = true;
        }
        if (this._options.serverMaxWindowBits) {
          params.server_max_window_bits = this._options.serverMaxWindowBits;
        }
        if (this._options.clientMaxWindowBits) {
          params.client_max_window_bits = this._options.clientMaxWindowBits;
        } else if (this._options.clientMaxWindowBits == null) {
          params.client_max_window_bits = true;
        }
        return params;
      }
      /**
       * Accept an extension negotiation offer/response.
       *
       * @param {Array} configurations The extension negotiation offers/reponse
       * @return {Object} Accepted configuration
       * @public
       */
      accept(configurations) {
        configurations = this.normalizeParams(configurations);
        this.params = this._isServer ? this.acceptAsServer(configurations) : this.acceptAsClient(configurations);
        return this.params;
      }
      /**
       * Releases all resources used by the extension.
       *
       * @public
       */
      cleanup() {
        if (this._inflate) {
          this._inflate.close();
          this._inflate = null;
        }
        if (this._deflate) {
          const callback = this._deflate[kCallback];
          this._deflate.close();
          this._deflate = null;
          if (callback) {
            callback(
              new Error(
                "The deflate stream was closed while data was being processed"
              )
            );
          }
        }
      }
      /**
       *  Accept an extension negotiation offer.
       *
       * @param {Array} offers The extension negotiation offers
       * @return {Object} Accepted configuration
       * @private
       */
      acceptAsServer(offers) {
        const opts = this._options;
        const accepted = offers.find((params) => {
          if (opts.serverNoContextTakeover === false && params.server_no_context_takeover || params.server_max_window_bits && (opts.serverMaxWindowBits === false || typeof opts.serverMaxWindowBits === "number" && opts.serverMaxWindowBits > params.server_max_window_bits) || typeof opts.clientMaxWindowBits === "number" && !params.client_max_window_bits) {
            return false;
          }
          return true;
        });
        if (!accepted) {
          throw new Error("None of the extension offers can be accepted");
        }
        if (opts.serverNoContextTakeover) {
          accepted.server_no_context_takeover = true;
        }
        if (opts.clientNoContextTakeover) {
          accepted.client_no_context_takeover = true;
        }
        if (typeof opts.serverMaxWindowBits === "number") {
          accepted.server_max_window_bits = opts.serverMaxWindowBits;
        }
        if (typeof opts.clientMaxWindowBits === "number") {
          accepted.client_max_window_bits = opts.clientMaxWindowBits;
        } else if (accepted.client_max_window_bits === true || opts.clientMaxWindowBits === false) {
          delete accepted.client_max_window_bits;
        }
        return accepted;
      }
      /**
       * Accept the extension negotiation response.
       *
       * @param {Array} response The extension negotiation response
       * @return {Object} Accepted configuration
       * @private
       */
      acceptAsClient(response) {
        const params = response[0];
        if (this._options.clientNoContextTakeover === false && params.client_no_context_takeover) {
          throw new Error('Unexpected parameter "client_no_context_takeover"');
        }
        if (!params.client_max_window_bits) {
          if (typeof this._options.clientMaxWindowBits === "number") {
            params.client_max_window_bits = this._options.clientMaxWindowBits;
          }
        } else if (this._options.clientMaxWindowBits === false || typeof this._options.clientMaxWindowBits === "number" && params.client_max_window_bits > this._options.clientMaxWindowBits) {
          throw new Error(
            'Unexpected or invalid parameter "client_max_window_bits"'
          );
        }
        return params;
      }
      /**
       * Normalize parameters.
       *
       * @param {Array} configurations The extension negotiation offers/reponse
       * @return {Array} The offers/response with normalized parameters
       * @private
       */
      normalizeParams(configurations) {
        configurations.forEach((params) => {
          Object.keys(params).forEach((key) => {
            let value = params[key];
            if (value.length > 1) {
              throw new Error(`Parameter "${key}" must have only a single value`);
            }
            value = value[0];
            if (key === "client_max_window_bits") {
              if (value !== true) {
                const num = +value;
                if (!Number.isInteger(num) || num < 8 || num > 15) {
                  throw new TypeError(
                    `Invalid value for parameter "${key}": ${value}`
                  );
                }
                value = num;
              } else if (!this._isServer) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
            } else if (key === "server_max_window_bits") {
              const num = +value;
              if (!Number.isInteger(num) || num < 8 || num > 15) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
              value = num;
            } else if (key === "client_no_context_takeover" || key === "server_no_context_takeover") {
              if (value !== true) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
            } else {
              throw new Error(`Unknown parameter "${key}"`);
            }
            params[key] = value;
          });
        });
        return configurations;
      }
      /**
       * Decompress data. Concurrency limited.
       *
       * @param {Buffer} data Compressed data
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @public
       */
      decompress(data, fin, callback) {
        zlibLimiter.add((done) => {
          this._decompress(data, fin, (err, result) => {
            done();
            callback(err, result);
          });
        });
      }
      /**
       * Compress data. Concurrency limited.
       *
       * @param {(Buffer|String)} data Data to compress
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @public
       */
      compress(data, fin, callback) {
        zlibLimiter.add((done) => {
          this._compress(data, fin, (err, result) => {
            done();
            callback(err, result);
          });
        });
      }
      /**
       * Decompress data.
       *
       * @param {Buffer} data Compressed data
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @private
       */
      _decompress(data, fin, callback) {
        const endpoint = this._isServer ? "client" : "server";
        if (!this._inflate) {
          const key = `${endpoint}_max_window_bits`;
          const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
          this._inflate = zlib.createInflateRaw({
            ...this._options.zlibInflateOptions,
            windowBits
          });
          this._inflate[kPerMessageDeflate] = this;
          this._inflate[kTotalLength] = 0;
          this._inflate[kBuffers] = [];
          this._inflate.on("error", inflateOnError);
          this._inflate.on("data", inflateOnData);
        }
        this._inflate[kCallback] = callback;
        this._inflate.write(data);
        if (fin) this._inflate.write(TRAILER);
        this._inflate.flush(() => {
          const err = this._inflate[kError];
          if (err) {
            this._inflate.close();
            this._inflate = null;
            callback(err);
            return;
          }
          const data2 = bufferUtil.concat(
            this._inflate[kBuffers],
            this._inflate[kTotalLength]
          );
          if (this._inflate._readableState.endEmitted) {
            this._inflate.close();
            this._inflate = null;
          } else {
            this._inflate[kTotalLength] = 0;
            this._inflate[kBuffers] = [];
            if (fin && this.params[`${endpoint}_no_context_takeover`]) {
              this._inflate.reset();
            }
          }
          callback(null, data2);
        });
      }
      /**
       * Compress data.
       *
       * @param {(Buffer|String)} data Data to compress
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @private
       */
      _compress(data, fin, callback) {
        const endpoint = this._isServer ? "server" : "client";
        if (!this._deflate) {
          const key = `${endpoint}_max_window_bits`;
          const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
          this._deflate = zlib.createDeflateRaw({
            ...this._options.zlibDeflateOptions,
            windowBits
          });
          this._deflate[kTotalLength] = 0;
          this._deflate[kBuffers] = [];
          this._deflate.on("data", deflateOnData);
        }
        this._deflate[kCallback] = callback;
        this._deflate.write(data);
        this._deflate.flush(zlib.Z_SYNC_FLUSH, () => {
          if (!this._deflate) {
            return;
          }
          let data2 = bufferUtil.concat(
            this._deflate[kBuffers],
            this._deflate[kTotalLength]
          );
          if (fin) {
            data2 = new FastBuffer(data2.buffer, data2.byteOffset, data2.length - 4);
          }
          this._deflate[kCallback] = null;
          this._deflate[kTotalLength] = 0;
          this._deflate[kBuffers] = [];
          if (fin && this.params[`${endpoint}_no_context_takeover`]) {
            this._deflate.reset();
          }
          callback(null, data2);
        });
      }
    };
    module.exports = PerMessageDeflate;
    function deflateOnData(chunk) {
      this[kBuffers].push(chunk);
      this[kTotalLength] += chunk.length;
    }
    function inflateOnData(chunk) {
      this[kTotalLength] += chunk.length;
      if (this[kPerMessageDeflate]._maxPayload < 1 || this[kTotalLength] <= this[kPerMessageDeflate]._maxPayload) {
        this[kBuffers].push(chunk);
        return;
      }
      this[kError] = new RangeError("Max payload size exceeded");
      this[kError].code = "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH";
      this[kError][kStatusCode] = 1009;
      this.removeListener("data", inflateOnData);
      this.reset();
    }
    function inflateOnError(err) {
      this[kPerMessageDeflate]._inflate = null;
      if (this[kError]) {
        this[kCallback](this[kError]);
        return;
      }
      err[kStatusCode] = 1007;
      this[kCallback](err);
    }
  }
});

// node_modules/ws/lib/validation.js
var require_validation = __commonJS({
  "node_modules/ws/lib/validation.js"(exports, module) {
    "use strict";
    var { isUtf8 } = __require("buffer");
    var { hasBlob } = require_constants();
    var tokenChars = [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 0 - 15
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 16 - 31
      0,
      1,
      0,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      1,
      1,
      0,
      1,
      1,
      0,
      // 32 - 47
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      // 48 - 63
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      // 64 - 79
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      1,
      1,
      // 80 - 95
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      // 96 - 111
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      1,
      0,
      1,
      0
      // 112 - 127
    ];
    function isValidStatusCode(code) {
      return code >= 1e3 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006 || code >= 3e3 && code <= 4999;
    }
    function _isValidUTF8(buf) {
      const len = buf.length;
      let i = 0;
      while (i < len) {
        if ((buf[i] & 128) === 0) {
          i++;
        } else if ((buf[i] & 224) === 192) {
          if (i + 1 === len || (buf[i + 1] & 192) !== 128 || (buf[i] & 254) === 192) {
            return false;
          }
          i += 2;
        } else if ((buf[i] & 240) === 224) {
          if (i + 2 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || buf[i] === 224 && (buf[i + 1] & 224) === 128 || // Overlong
          buf[i] === 237 && (buf[i + 1] & 224) === 160) {
            return false;
          }
          i += 3;
        } else if ((buf[i] & 248) === 240) {
          if (i + 3 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || (buf[i + 3] & 192) !== 128 || buf[i] === 240 && (buf[i + 1] & 240) === 128 || // Overlong
          buf[i] === 244 && buf[i + 1] > 143 || buf[i] > 244) {
            return false;
          }
          i += 4;
        } else {
          return false;
        }
      }
      return true;
    }
    function isBlob(value) {
      return hasBlob && typeof value === "object" && typeof value.arrayBuffer === "function" && typeof value.type === "string" && typeof value.stream === "function" && (value[Symbol.toStringTag] === "Blob" || value[Symbol.toStringTag] === "File");
    }
    module.exports = {
      isBlob,
      isValidStatusCode,
      isValidUTF8: _isValidUTF8,
      tokenChars
    };
    if (isUtf8) {
      module.exports.isValidUTF8 = function(buf) {
        return buf.length < 24 ? _isValidUTF8(buf) : isUtf8(buf);
      };
    } else if (!process.env.WS_NO_UTF_8_VALIDATE) {
      try {
        const isValidUTF8 = __require("utf-8-validate");
        module.exports.isValidUTF8 = function(buf) {
          return buf.length < 32 ? _isValidUTF8(buf) : isValidUTF8(buf);
        };
      } catch (e) {
      }
    }
  }
});

// node_modules/ws/lib/receiver.js
var require_receiver = __commonJS({
  "node_modules/ws/lib/receiver.js"(exports, module) {
    "use strict";
    var { Writable } = __require("stream");
    var PerMessageDeflate = require_permessage_deflate();
    var {
      BINARY_TYPES,
      EMPTY_BUFFER,
      kStatusCode,
      kWebSocket
    } = require_constants();
    var { concat, toArrayBuffer, unmask } = require_buffer_util();
    var { isValidStatusCode, isValidUTF8 } = require_validation();
    var FastBuffer = Buffer[Symbol.species];
    var GET_INFO = 0;
    var GET_PAYLOAD_LENGTH_16 = 1;
    var GET_PAYLOAD_LENGTH_64 = 2;
    var GET_MASK = 3;
    var GET_DATA = 4;
    var INFLATING = 5;
    var DEFER_EVENT = 6;
    var Receiver2 = class extends Writable {
      /**
       * Creates a Receiver instance.
       *
       * @param {Object} [options] Options object
       * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {String} [options.binaryType=nodebuffer] The type for binary data
       * @param {Object} [options.extensions] An object containing the negotiated
       *     extensions
       * @param {Boolean} [options.isServer=false] Specifies whether to operate in
       *     client or server mode
       * @param {Number} [options.maxPayload=0] The maximum allowed message length
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       */
      constructor(options = {}) {
        super();
        this._allowSynchronousEvents = options.allowSynchronousEvents !== void 0 ? options.allowSynchronousEvents : true;
        this._binaryType = options.binaryType || BINARY_TYPES[0];
        this._extensions = options.extensions || {};
        this._isServer = !!options.isServer;
        this._maxPayload = options.maxPayload | 0;
        this._skipUTF8Validation = !!options.skipUTF8Validation;
        this[kWebSocket] = void 0;
        this._bufferedBytes = 0;
        this._buffers = [];
        this._compressed = false;
        this._payloadLength = 0;
        this._mask = void 0;
        this._fragmented = 0;
        this._masked = false;
        this._fin = false;
        this._opcode = 0;
        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._fragments = [];
        this._errored = false;
        this._loop = false;
        this._state = GET_INFO;
      }
      /**
       * Implements `Writable.prototype._write()`.
       *
       * @param {Buffer} chunk The chunk of data to write
       * @param {String} encoding The character encoding of `chunk`
       * @param {Function} cb Callback
       * @private
       */
      _write(chunk, encoding, cb) {
        if (this._opcode === 8 && this._state == GET_INFO) return cb();
        this._bufferedBytes += chunk.length;
        this._buffers.push(chunk);
        this.startLoop(cb);
      }
      /**
       * Consumes `n` bytes from the buffered data.
       *
       * @param {Number} n The number of bytes to consume
       * @return {Buffer} The consumed bytes
       * @private
       */
      consume(n) {
        this._bufferedBytes -= n;
        if (n === this._buffers[0].length) return this._buffers.shift();
        if (n < this._buffers[0].length) {
          const buf = this._buffers[0];
          this._buffers[0] = new FastBuffer(
            buf.buffer,
            buf.byteOffset + n,
            buf.length - n
          );
          return new FastBuffer(buf.buffer, buf.byteOffset, n);
        }
        const dst = Buffer.allocUnsafe(n);
        do {
          const buf = this._buffers[0];
          const offset = dst.length - n;
          if (n >= buf.length) {
            dst.set(this._buffers.shift(), offset);
          } else {
            dst.set(new Uint8Array(buf.buffer, buf.byteOffset, n), offset);
            this._buffers[0] = new FastBuffer(
              buf.buffer,
              buf.byteOffset + n,
              buf.length - n
            );
          }
          n -= buf.length;
        } while (n > 0);
        return dst;
      }
      /**
       * Starts the parsing loop.
       *
       * @param {Function} cb Callback
       * @private
       */
      startLoop(cb) {
        this._loop = true;
        do {
          switch (this._state) {
            case GET_INFO:
              this.getInfo(cb);
              break;
            case GET_PAYLOAD_LENGTH_16:
              this.getPayloadLength16(cb);
              break;
            case GET_PAYLOAD_LENGTH_64:
              this.getPayloadLength64(cb);
              break;
            case GET_MASK:
              this.getMask();
              break;
            case GET_DATA:
              this.getData(cb);
              break;
            case INFLATING:
            case DEFER_EVENT:
              this._loop = false;
              return;
          }
        } while (this._loop);
        if (!this._errored) cb();
      }
      /**
       * Reads the first two bytes of a frame.
       *
       * @param {Function} cb Callback
       * @private
       */
      getInfo(cb) {
        if (this._bufferedBytes < 2) {
          this._loop = false;
          return;
        }
        const buf = this.consume(2);
        if ((buf[0] & 48) !== 0) {
          const error = this.createError(
            RangeError,
            "RSV2 and RSV3 must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_RSV_2_3"
          );
          cb(error);
          return;
        }
        const compressed = (buf[0] & 64) === 64;
        if (compressed && !this._extensions[PerMessageDeflate.extensionName]) {
          const error = this.createError(
            RangeError,
            "RSV1 must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_RSV_1"
          );
          cb(error);
          return;
        }
        this._fin = (buf[0] & 128) === 128;
        this._opcode = buf[0] & 15;
        this._payloadLength = buf[1] & 127;
        if (this._opcode === 0) {
          if (compressed) {
            const error = this.createError(
              RangeError,
              "RSV1 must be clear",
              true,
              1002,
              "WS_ERR_UNEXPECTED_RSV_1"
            );
            cb(error);
            return;
          }
          if (!this._fragmented) {
            const error = this.createError(
              RangeError,
              "invalid opcode 0",
              true,
              1002,
              "WS_ERR_INVALID_OPCODE"
            );
            cb(error);
            return;
          }
          this._opcode = this._fragmented;
        } else if (this._opcode === 1 || this._opcode === 2) {
          if (this._fragmented) {
            const error = this.createError(
              RangeError,
              `invalid opcode ${this._opcode}`,
              true,
              1002,
              "WS_ERR_INVALID_OPCODE"
            );
            cb(error);
            return;
          }
          this._compressed = compressed;
        } else if (this._opcode > 7 && this._opcode < 11) {
          if (!this._fin) {
            const error = this.createError(
              RangeError,
              "FIN must be set",
              true,
              1002,
              "WS_ERR_EXPECTED_FIN"
            );
            cb(error);
            return;
          }
          if (compressed) {
            const error = this.createError(
              RangeError,
              "RSV1 must be clear",
              true,
              1002,
              "WS_ERR_UNEXPECTED_RSV_1"
            );
            cb(error);
            return;
          }
          if (this._payloadLength > 125 || this._opcode === 8 && this._payloadLength === 1) {
            const error = this.createError(
              RangeError,
              `invalid payload length ${this._payloadLength}`,
              true,
              1002,
              "WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH"
            );
            cb(error);
            return;
          }
        } else {
          const error = this.createError(
            RangeError,
            `invalid opcode ${this._opcode}`,
            true,
            1002,
            "WS_ERR_INVALID_OPCODE"
          );
          cb(error);
          return;
        }
        if (!this._fin && !this._fragmented) this._fragmented = this._opcode;
        this._masked = (buf[1] & 128) === 128;
        if (this._isServer) {
          if (!this._masked) {
            const error = this.createError(
              RangeError,
              "MASK must be set",
              true,
              1002,
              "WS_ERR_EXPECTED_MASK"
            );
            cb(error);
            return;
          }
        } else if (this._masked) {
          const error = this.createError(
            RangeError,
            "MASK must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_MASK"
          );
          cb(error);
          return;
        }
        if (this._payloadLength === 126) this._state = GET_PAYLOAD_LENGTH_16;
        else if (this._payloadLength === 127) this._state = GET_PAYLOAD_LENGTH_64;
        else this.haveLength(cb);
      }
      /**
       * Gets extended payload length (7+16).
       *
       * @param {Function} cb Callback
       * @private
       */
      getPayloadLength16(cb) {
        if (this._bufferedBytes < 2) {
          this._loop = false;
          return;
        }
        this._payloadLength = this.consume(2).readUInt16BE(0);
        this.haveLength(cb);
      }
      /**
       * Gets extended payload length (7+64).
       *
       * @param {Function} cb Callback
       * @private
       */
      getPayloadLength64(cb) {
        if (this._bufferedBytes < 8) {
          this._loop = false;
          return;
        }
        const buf = this.consume(8);
        const num = buf.readUInt32BE(0);
        if (num > Math.pow(2, 53 - 32) - 1) {
          const error = this.createError(
            RangeError,
            "Unsupported WebSocket frame: payload length > 2^53 - 1",
            false,
            1009,
            "WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH"
          );
          cb(error);
          return;
        }
        this._payloadLength = num * Math.pow(2, 32) + buf.readUInt32BE(4);
        this.haveLength(cb);
      }
      /**
       * Payload length has been read.
       *
       * @param {Function} cb Callback
       * @private
       */
      haveLength(cb) {
        if (this._payloadLength && this._opcode < 8) {
          this._totalPayloadLength += this._payloadLength;
          if (this._totalPayloadLength > this._maxPayload && this._maxPayload > 0) {
            const error = this.createError(
              RangeError,
              "Max payload size exceeded",
              false,
              1009,
              "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
            );
            cb(error);
            return;
          }
        }
        if (this._masked) this._state = GET_MASK;
        else this._state = GET_DATA;
      }
      /**
       * Reads mask bytes.
       *
       * @private
       */
      getMask() {
        if (this._bufferedBytes < 4) {
          this._loop = false;
          return;
        }
        this._mask = this.consume(4);
        this._state = GET_DATA;
      }
      /**
       * Reads data bytes.
       *
       * @param {Function} cb Callback
       * @private
       */
      getData(cb) {
        let data = EMPTY_BUFFER;
        if (this._payloadLength) {
          if (this._bufferedBytes < this._payloadLength) {
            this._loop = false;
            return;
          }
          data = this.consume(this._payloadLength);
          if (this._masked && (this._mask[0] | this._mask[1] | this._mask[2] | this._mask[3]) !== 0) {
            unmask(data, this._mask);
          }
        }
        if (this._opcode > 7) {
          this.controlMessage(data, cb);
          return;
        }
        if (this._compressed) {
          this._state = INFLATING;
          this.decompress(data, cb);
          return;
        }
        if (data.length) {
          this._messageLength = this._totalPayloadLength;
          this._fragments.push(data);
        }
        this.dataMessage(cb);
      }
      /**
       * Decompresses data.
       *
       * @param {Buffer} data Compressed data
       * @param {Function} cb Callback
       * @private
       */
      decompress(data, cb) {
        const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
        perMessageDeflate.decompress(data, this._fin, (err, buf) => {
          if (err) return cb(err);
          if (buf.length) {
            this._messageLength += buf.length;
            if (this._messageLength > this._maxPayload && this._maxPayload > 0) {
              const error = this.createError(
                RangeError,
                "Max payload size exceeded",
                false,
                1009,
                "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
              );
              cb(error);
              return;
            }
            this._fragments.push(buf);
          }
          this.dataMessage(cb);
          if (this._state === GET_INFO) this.startLoop(cb);
        });
      }
      /**
       * Handles a data message.
       *
       * @param {Function} cb Callback
       * @private
       */
      dataMessage(cb) {
        if (!this._fin) {
          this._state = GET_INFO;
          return;
        }
        const messageLength = this._messageLength;
        const fragments = this._fragments;
        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._fragmented = 0;
        this._fragments = [];
        if (this._opcode === 2) {
          let data;
          if (this._binaryType === "nodebuffer") {
            data = concat(fragments, messageLength);
          } else if (this._binaryType === "arraybuffer") {
            data = toArrayBuffer(concat(fragments, messageLength));
          } else if (this._binaryType === "blob") {
            data = new Blob(fragments);
          } else {
            data = fragments;
          }
          if (this._allowSynchronousEvents) {
            this.emit("message", data, true);
            this._state = GET_INFO;
          } else {
            this._state = DEFER_EVENT;
            setImmediate(() => {
              this.emit("message", data, true);
              this._state = GET_INFO;
              this.startLoop(cb);
            });
          }
        } else {
          const buf = concat(fragments, messageLength);
          if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
            const error = this.createError(
              Error,
              "invalid UTF-8 sequence",
              true,
              1007,
              "WS_ERR_INVALID_UTF8"
            );
            cb(error);
            return;
          }
          if (this._state === INFLATING || this._allowSynchronousEvents) {
            this.emit("message", buf, false);
            this._state = GET_INFO;
          } else {
            this._state = DEFER_EVENT;
            setImmediate(() => {
              this.emit("message", buf, false);
              this._state = GET_INFO;
              this.startLoop(cb);
            });
          }
        }
      }
      /**
       * Handles a control message.
       *
       * @param {Buffer} data Data to handle
       * @return {(Error|RangeError|undefined)} A possible error
       * @private
       */
      controlMessage(data, cb) {
        if (this._opcode === 8) {
          if (data.length === 0) {
            this._loop = false;
            this.emit("conclude", 1005, EMPTY_BUFFER);
            this.end();
          } else {
            const code = data.readUInt16BE(0);
            if (!isValidStatusCode(code)) {
              const error = this.createError(
                RangeError,
                `invalid status code ${code}`,
                true,
                1002,
                "WS_ERR_INVALID_CLOSE_CODE"
              );
              cb(error);
              return;
            }
            const buf = new FastBuffer(
              data.buffer,
              data.byteOffset + 2,
              data.length - 2
            );
            if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
              const error = this.createError(
                Error,
                "invalid UTF-8 sequence",
                true,
                1007,
                "WS_ERR_INVALID_UTF8"
              );
              cb(error);
              return;
            }
            this._loop = false;
            this.emit("conclude", code, buf);
            this.end();
          }
          this._state = GET_INFO;
          return;
        }
        if (this._allowSynchronousEvents) {
          this.emit(this._opcode === 9 ? "ping" : "pong", data);
          this._state = GET_INFO;
        } else {
          this._state = DEFER_EVENT;
          setImmediate(() => {
            this.emit(this._opcode === 9 ? "ping" : "pong", data);
            this._state = GET_INFO;
            this.startLoop(cb);
          });
        }
      }
      /**
       * Builds an error object.
       *
       * @param {function(new:Error|RangeError)} ErrorCtor The error constructor
       * @param {String} message The error message
       * @param {Boolean} prefix Specifies whether or not to add a default prefix to
       *     `message`
       * @param {Number} statusCode The status code
       * @param {String} errorCode The exposed error code
       * @return {(Error|RangeError)} The error
       * @private
       */
      createError(ErrorCtor, message, prefix, statusCode, errorCode) {
        this._loop = false;
        this._errored = true;
        const err = new ErrorCtor(
          prefix ? `Invalid WebSocket frame: ${message}` : message
        );
        Error.captureStackTrace(err, this.createError);
        err.code = errorCode;
        err[kStatusCode] = statusCode;
        return err;
      }
    };
    module.exports = Receiver2;
  }
});

// node_modules/ws/lib/sender.js
var require_sender = __commonJS({
  "node_modules/ws/lib/sender.js"(exports, module) {
    "use strict";
    var { Duplex } = __require("stream");
    var { randomFillSync } = __require("crypto");
    var PerMessageDeflate = require_permessage_deflate();
    var { EMPTY_BUFFER, kWebSocket, NOOP } = require_constants();
    var { isBlob, isValidStatusCode } = require_validation();
    var { mask: applyMask, toBuffer } = require_buffer_util();
    var kByteLength = /* @__PURE__ */ Symbol("kByteLength");
    var maskBuffer = Buffer.alloc(4);
    var RANDOM_POOL_SIZE = 8 * 1024;
    var randomPool;
    var randomPoolPointer = RANDOM_POOL_SIZE;
    var DEFAULT = 0;
    var DEFLATING = 1;
    var GET_BLOB_DATA = 2;
    var Sender2 = class _Sender {
      /**
       * Creates a Sender instance.
       *
       * @param {Duplex} socket The connection socket
       * @param {Object} [extensions] An object containing the negotiated extensions
       * @param {Function} [generateMask] The function used to generate the masking
       *     key
       */
      constructor(socket, extensions, generateMask) {
        this._extensions = extensions || {};
        if (generateMask) {
          this._generateMask = generateMask;
          this._maskBuffer = Buffer.alloc(4);
        }
        this._socket = socket;
        this._firstFragment = true;
        this._compress = false;
        this._bufferedBytes = 0;
        this._queue = [];
        this._state = DEFAULT;
        this.onerror = NOOP;
        this[kWebSocket] = void 0;
      }
      /**
       * Frames a piece of data according to the HyBi WebSocket protocol.
       *
       * @param {(Buffer|String)} data The data to frame
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @return {(Buffer|String)[]} The framed data
       * @public
       */
      static frame(data, options) {
        let mask;
        let merge = false;
        let offset = 2;
        let skipMasking = false;
        if (options.mask) {
          mask = options.maskBuffer || maskBuffer;
          if (options.generateMask) {
            options.generateMask(mask);
          } else {
            if (randomPoolPointer === RANDOM_POOL_SIZE) {
              if (randomPool === void 0) {
                randomPool = Buffer.alloc(RANDOM_POOL_SIZE);
              }
              randomFillSync(randomPool, 0, RANDOM_POOL_SIZE);
              randomPoolPointer = 0;
            }
            mask[0] = randomPool[randomPoolPointer++];
            mask[1] = randomPool[randomPoolPointer++];
            mask[2] = randomPool[randomPoolPointer++];
            mask[3] = randomPool[randomPoolPointer++];
          }
          skipMasking = (mask[0] | mask[1] | mask[2] | mask[3]) === 0;
          offset = 6;
        }
        let dataLength;
        if (typeof data === "string") {
          if ((!options.mask || skipMasking) && options[kByteLength] !== void 0) {
            dataLength = options[kByteLength];
          } else {
            data = Buffer.from(data);
            dataLength = data.length;
          }
        } else {
          dataLength = data.length;
          merge = options.mask && options.readOnly && !skipMasking;
        }
        let payloadLength = dataLength;
        if (dataLength >= 65536) {
          offset += 8;
          payloadLength = 127;
        } else if (dataLength > 125) {
          offset += 2;
          payloadLength = 126;
        }
        const target = Buffer.allocUnsafe(merge ? dataLength + offset : offset);
        target[0] = options.fin ? options.opcode | 128 : options.opcode;
        if (options.rsv1) target[0] |= 64;
        target[1] = payloadLength;
        if (payloadLength === 126) {
          target.writeUInt16BE(dataLength, 2);
        } else if (payloadLength === 127) {
          target[2] = target[3] = 0;
          target.writeUIntBE(dataLength, 4, 6);
        }
        if (!options.mask) return [target, data];
        target[1] |= 128;
        target[offset - 4] = mask[0];
        target[offset - 3] = mask[1];
        target[offset - 2] = mask[2];
        target[offset - 1] = mask[3];
        if (skipMasking) return [target, data];
        if (merge) {
          applyMask(data, mask, target, offset, dataLength);
          return [target];
        }
        applyMask(data, mask, data, 0, dataLength);
        return [target, data];
      }
      /**
       * Sends a close message to the other peer.
       *
       * @param {Number} [code] The status code component of the body
       * @param {(String|Buffer)} [data] The message component of the body
       * @param {Boolean} [mask=false] Specifies whether or not to mask the message
       * @param {Function} [cb] Callback
       * @public
       */
      close(code, data, mask, cb) {
        let buf;
        if (code === void 0) {
          buf = EMPTY_BUFFER;
        } else if (typeof code !== "number" || !isValidStatusCode(code)) {
          throw new TypeError("First argument must be a valid error code number");
        } else if (data === void 0 || !data.length) {
          buf = Buffer.allocUnsafe(2);
          buf.writeUInt16BE(code, 0);
        } else {
          const length = Buffer.byteLength(data);
          if (length > 123) {
            throw new RangeError("The message must not be greater than 123 bytes");
          }
          buf = Buffer.allocUnsafe(2 + length);
          buf.writeUInt16BE(code, 0);
          if (typeof data === "string") {
            buf.write(data, 2);
          } else {
            buf.set(data, 2);
          }
        }
        const options = {
          [kByteLength]: buf.length,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 8,
          readOnly: false,
          rsv1: false
        };
        if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, buf, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(buf, options), cb);
        }
      }
      /**
       * Sends a ping message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback
       * @public
       */
      ping(data, mask, cb) {
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (byteLength > 125) {
          throw new RangeError("The data size must not be greater than 125 bytes");
        }
        const options = {
          [kByteLength]: byteLength,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 9,
          readOnly,
          rsv1: false
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, false, options, cb]);
          } else {
            this.getBlobData(data, false, options, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(data, options), cb);
        }
      }
      /**
       * Sends a pong message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback
       * @public
       */
      pong(data, mask, cb) {
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (byteLength > 125) {
          throw new RangeError("The data size must not be greater than 125 bytes");
        }
        const options = {
          [kByteLength]: byteLength,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 10,
          readOnly,
          rsv1: false
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, false, options, cb]);
          } else {
            this.getBlobData(data, false, options, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(data, options), cb);
        }
      }
      /**
       * Sends a data message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Object} options Options object
       * @param {Boolean} [options.binary=false] Specifies whether `data` is binary
       *     or text
       * @param {Boolean} [options.compress=false] Specifies whether or not to
       *     compress `data`
       * @param {Boolean} [options.fin=false] Specifies whether the fragment is the
       *     last one
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Function} [cb] Callback
       * @public
       */
      send(data, options, cb) {
        const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
        let opcode = options.binary ? 2 : 1;
        let rsv1 = options.compress;
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (this._firstFragment) {
          this._firstFragment = false;
          if (rsv1 && perMessageDeflate && perMessageDeflate.params[perMessageDeflate._isServer ? "server_no_context_takeover" : "client_no_context_takeover"]) {
            rsv1 = byteLength >= perMessageDeflate._threshold;
          }
          this._compress = rsv1;
        } else {
          rsv1 = false;
          opcode = 0;
        }
        if (options.fin) this._firstFragment = true;
        const opts = {
          [kByteLength]: byteLength,
          fin: options.fin,
          generateMask: this._generateMask,
          mask: options.mask,
          maskBuffer: this._maskBuffer,
          opcode,
          readOnly,
          rsv1
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, this._compress, opts, cb]);
          } else {
            this.getBlobData(data, this._compress, opts, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, this._compress, opts, cb]);
        } else {
          this.dispatch(data, this._compress, opts, cb);
        }
      }
      /**
       * Gets the contents of a blob as binary data.
       *
       * @param {Blob} blob The blob
       * @param {Boolean} [compress=false] Specifies whether or not to compress
       *     the data
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @param {Function} [cb] Callback
       * @private
       */
      getBlobData(blob, compress, options, cb) {
        this._bufferedBytes += options[kByteLength];
        this._state = GET_BLOB_DATA;
        blob.arrayBuffer().then((arrayBuffer) => {
          if (this._socket.destroyed) {
            const err = new Error(
              "The socket was closed while the blob was being read"
            );
            process.nextTick(callCallbacks, this, err, cb);
            return;
          }
          this._bufferedBytes -= options[kByteLength];
          const data = toBuffer(arrayBuffer);
          if (!compress) {
            this._state = DEFAULT;
            this.sendFrame(_Sender.frame(data, options), cb);
            this.dequeue();
          } else {
            this.dispatch(data, compress, options, cb);
          }
        }).catch((err) => {
          process.nextTick(onError, this, err, cb);
        });
      }
      /**
       * Dispatches a message.
       *
       * @param {(Buffer|String)} data The message to send
       * @param {Boolean} [compress=false] Specifies whether or not to compress
       *     `data`
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @param {Function} [cb] Callback
       * @private
       */
      dispatch(data, compress, options, cb) {
        if (!compress) {
          this.sendFrame(_Sender.frame(data, options), cb);
          return;
        }
        const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
        this._bufferedBytes += options[kByteLength];
        this._state = DEFLATING;
        perMessageDeflate.compress(data, options.fin, (_, buf) => {
          if (this._socket.destroyed) {
            const err = new Error(
              "The socket was closed while data was being compressed"
            );
            callCallbacks(this, err, cb);
            return;
          }
          this._bufferedBytes -= options[kByteLength];
          this._state = DEFAULT;
          options.readOnly = false;
          this.sendFrame(_Sender.frame(buf, options), cb);
          this.dequeue();
        });
      }
      /**
       * Executes queued send operations.
       *
       * @private
       */
      dequeue() {
        while (this._state === DEFAULT && this._queue.length) {
          const params = this._queue.shift();
          this._bufferedBytes -= params[3][kByteLength];
          Reflect.apply(params[0], this, params.slice(1));
        }
      }
      /**
       * Enqueues a send operation.
       *
       * @param {Array} params Send operation parameters.
       * @private
       */
      enqueue(params) {
        this._bufferedBytes += params[3][kByteLength];
        this._queue.push(params);
      }
      /**
       * Sends a frame.
       *
       * @param {(Buffer | String)[]} list The frame to send
       * @param {Function} [cb] Callback
       * @private
       */
      sendFrame(list, cb) {
        if (list.length === 2) {
          this._socket.cork();
          this._socket.write(list[0]);
          this._socket.write(list[1], cb);
          this._socket.uncork();
        } else {
          this._socket.write(list[0], cb);
        }
      }
    };
    module.exports = Sender2;
    function callCallbacks(sender, err, cb) {
      if (typeof cb === "function") cb(err);
      for (let i = 0; i < sender._queue.length; i++) {
        const params = sender._queue[i];
        const callback = params[params.length - 1];
        if (typeof callback === "function") callback(err);
      }
    }
    function onError(sender, err, cb) {
      callCallbacks(sender, err, cb);
      sender.onerror(err);
    }
  }
});

// node_modules/ws/lib/event-target.js
var require_event_target = __commonJS({
  "node_modules/ws/lib/event-target.js"(exports, module) {
    "use strict";
    var { kForOnEventAttribute, kListener } = require_constants();
    var kCode = /* @__PURE__ */ Symbol("kCode");
    var kData = /* @__PURE__ */ Symbol("kData");
    var kError = /* @__PURE__ */ Symbol("kError");
    var kMessage = /* @__PURE__ */ Symbol("kMessage");
    var kReason = /* @__PURE__ */ Symbol("kReason");
    var kTarget = /* @__PURE__ */ Symbol("kTarget");
    var kType = /* @__PURE__ */ Symbol("kType");
    var kWasClean = /* @__PURE__ */ Symbol("kWasClean");
    var Event = class {
      /**
       * Create a new `Event`.
       *
       * @param {String} type The name of the event
       * @throws {TypeError} If the `type` argument is not specified
       */
      constructor(type) {
        this[kTarget] = null;
        this[kType] = type;
      }
      /**
       * @type {*}
       */
      get target() {
        return this[kTarget];
      }
      /**
       * @type {String}
       */
      get type() {
        return this[kType];
      }
    };
    Object.defineProperty(Event.prototype, "target", { enumerable: true });
    Object.defineProperty(Event.prototype, "type", { enumerable: true });
    var CloseEvent = class extends Event {
      /**
       * Create a new `CloseEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {Number} [options.code=0] The status code explaining why the
       *     connection was closed
       * @param {String} [options.reason=''] A human-readable string explaining why
       *     the connection was closed
       * @param {Boolean} [options.wasClean=false] Indicates whether or not the
       *     connection was cleanly closed
       */
      constructor(type, options = {}) {
        super(type);
        this[kCode] = options.code === void 0 ? 0 : options.code;
        this[kReason] = options.reason === void 0 ? "" : options.reason;
        this[kWasClean] = options.wasClean === void 0 ? false : options.wasClean;
      }
      /**
       * @type {Number}
       */
      get code() {
        return this[kCode];
      }
      /**
       * @type {String}
       */
      get reason() {
        return this[kReason];
      }
      /**
       * @type {Boolean}
       */
      get wasClean() {
        return this[kWasClean];
      }
    };
    Object.defineProperty(CloseEvent.prototype, "code", { enumerable: true });
    Object.defineProperty(CloseEvent.prototype, "reason", { enumerable: true });
    Object.defineProperty(CloseEvent.prototype, "wasClean", { enumerable: true });
    var ErrorEvent = class extends Event {
      /**
       * Create a new `ErrorEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {*} [options.error=null] The error that generated this event
       * @param {String} [options.message=''] The error message
       */
      constructor(type, options = {}) {
        super(type);
        this[kError] = options.error === void 0 ? null : options.error;
        this[kMessage] = options.message === void 0 ? "" : options.message;
      }
      /**
       * @type {*}
       */
      get error() {
        return this[kError];
      }
      /**
       * @type {String}
       */
      get message() {
        return this[kMessage];
      }
    };
    Object.defineProperty(ErrorEvent.prototype, "error", { enumerable: true });
    Object.defineProperty(ErrorEvent.prototype, "message", { enumerable: true });
    var MessageEvent = class extends Event {
      /**
       * Create a new `MessageEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {*} [options.data=null] The message content
       */
      constructor(type, options = {}) {
        super(type);
        this[kData] = options.data === void 0 ? null : options.data;
      }
      /**
       * @type {*}
       */
      get data() {
        return this[kData];
      }
    };
    Object.defineProperty(MessageEvent.prototype, "data", { enumerable: true });
    var EventTarget = {
      /**
       * Register an event listener.
       *
       * @param {String} type A string representing the event type to listen for
       * @param {(Function|Object)} handler The listener to add
       * @param {Object} [options] An options object specifies characteristics about
       *     the event listener
       * @param {Boolean} [options.once=false] A `Boolean` indicating that the
       *     listener should be invoked at most once after being added. If `true`,
       *     the listener would be automatically removed when invoked.
       * @public
       */
      addEventListener(type, handler, options = {}) {
        for (const listener of this.listeners(type)) {
          if (!options[kForOnEventAttribute] && listener[kListener] === handler && !listener[kForOnEventAttribute]) {
            return;
          }
        }
        let wrapper;
        if (type === "message") {
          wrapper = function onMessage(data, isBinary) {
            const event = new MessageEvent("message", {
              data: isBinary ? data : data.toString()
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "close") {
          wrapper = function onClose(code, message) {
            const event = new CloseEvent("close", {
              code,
              reason: message.toString(),
              wasClean: this._closeFrameReceived && this._closeFrameSent
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "error") {
          wrapper = function onError(error) {
            const event = new ErrorEvent("error", {
              error,
              message: error.message
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "open") {
          wrapper = function onOpen() {
            const event = new Event("open");
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else {
          return;
        }
        wrapper[kForOnEventAttribute] = !!options[kForOnEventAttribute];
        wrapper[kListener] = handler;
        if (options.once) {
          this.once(type, wrapper);
        } else {
          this.on(type, wrapper);
        }
      },
      /**
       * Remove an event listener.
       *
       * @param {String} type A string representing the event type to remove
       * @param {(Function|Object)} handler The listener to remove
       * @public
       */
      removeEventListener(type, handler) {
        for (const listener of this.listeners(type)) {
          if (listener[kListener] === handler && !listener[kForOnEventAttribute]) {
            this.removeListener(type, listener);
            break;
          }
        }
      }
    };
    module.exports = {
      CloseEvent,
      ErrorEvent,
      Event,
      EventTarget,
      MessageEvent
    };
    function callListener(listener, thisArg, event) {
      if (typeof listener === "object" && listener.handleEvent) {
        listener.handleEvent.call(listener, event);
      } else {
        listener.call(thisArg, event);
      }
    }
  }
});

// node_modules/ws/lib/extension.js
var require_extension = __commonJS({
  "node_modules/ws/lib/extension.js"(exports, module) {
    "use strict";
    var { tokenChars } = require_validation();
    function push(dest, name, elem) {
      if (dest[name] === void 0) dest[name] = [elem];
      else dest[name].push(elem);
    }
    function parse(header) {
      const offers = /* @__PURE__ */ Object.create(null);
      let params = /* @__PURE__ */ Object.create(null);
      let mustUnescape = false;
      let isEscaping = false;
      let inQuotes = false;
      let extensionName;
      let paramName;
      let start = -1;
      let code = -1;
      let end = -1;
      let i = 0;
      for (; i < header.length; i++) {
        code = header.charCodeAt(i);
        if (extensionName === void 0) {
          if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (i !== 0 && (code === 32 || code === 9)) {
            if (end === -1 && start !== -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            const name = header.slice(start, end);
            if (code === 44) {
              push(offers, name, params);
              params = /* @__PURE__ */ Object.create(null);
            } else {
              extensionName = name;
            }
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else if (paramName === void 0) {
          if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (code === 32 || code === 9) {
            if (end === -1 && start !== -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            push(params, header.slice(start, end), true);
            if (code === 44) {
              push(offers, extensionName, params);
              params = /* @__PURE__ */ Object.create(null);
              extensionName = void 0;
            }
            start = end = -1;
          } else if (code === 61 && start !== -1 && end === -1) {
            paramName = header.slice(start, i);
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else {
          if (isEscaping) {
            if (tokenChars[code] !== 1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (start === -1) start = i;
            else if (!mustUnescape) mustUnescape = true;
            isEscaping = false;
          } else if (inQuotes) {
            if (tokenChars[code] === 1) {
              if (start === -1) start = i;
            } else if (code === 34 && start !== -1) {
              inQuotes = false;
              end = i;
            } else if (code === 92) {
              isEscaping = true;
            } else {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
          } else if (code === 34 && header.charCodeAt(i - 1) === 61) {
            inQuotes = true;
          } else if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (start !== -1 && (code === 32 || code === 9)) {
            if (end === -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            let value = header.slice(start, end);
            if (mustUnescape) {
              value = value.replace(/\\/g, "");
              mustUnescape = false;
            }
            push(params, paramName, value);
            if (code === 44) {
              push(offers, extensionName, params);
              params = /* @__PURE__ */ Object.create(null);
              extensionName = void 0;
            }
            paramName = void 0;
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        }
      }
      if (start === -1 || inQuotes || code === 32 || code === 9) {
        throw new SyntaxError("Unexpected end of input");
      }
      if (end === -1) end = i;
      const token = header.slice(start, end);
      if (extensionName === void 0) {
        push(offers, token, params);
      } else {
        if (paramName === void 0) {
          push(params, token, true);
        } else if (mustUnescape) {
          push(params, paramName, token.replace(/\\/g, ""));
        } else {
          push(params, paramName, token);
        }
        push(offers, extensionName, params);
      }
      return offers;
    }
    function format(extensions) {
      return Object.keys(extensions).map((extension) => {
        let configurations = extensions[extension];
        if (!Array.isArray(configurations)) configurations = [configurations];
        return configurations.map((params) => {
          return [extension].concat(
            Object.keys(params).map((k) => {
              let values = params[k];
              if (!Array.isArray(values)) values = [values];
              return values.map((v) => v === true ? k : `${k}=${v}`).join("; ");
            })
          ).join("; ");
        }).join(", ");
      }).join(", ");
    }
    module.exports = { format, parse };
  }
});

// node_modules/ws/lib/websocket.js
var require_websocket = __commonJS({
  "node_modules/ws/lib/websocket.js"(exports, module) {
    "use strict";
    var EventEmitter = __require("events");
    var https = __require("https");
    var http2 = __require("http");
    var net3 = __require("net");
    var tls = __require("tls");
    var { randomBytes, createHash } = __require("crypto");
    var { Duplex, Readable } = __require("stream");
    var { URL } = __require("url");
    var PerMessageDeflate = require_permessage_deflate();
    var Receiver2 = require_receiver();
    var Sender2 = require_sender();
    var { isBlob } = require_validation();
    var {
      BINARY_TYPES,
      EMPTY_BUFFER,
      GUID,
      kForOnEventAttribute,
      kListener,
      kStatusCode,
      kWebSocket,
      NOOP
    } = require_constants();
    var {
      EventTarget: { addEventListener, removeEventListener }
    } = require_event_target();
    var { format, parse } = require_extension();
    var { toBuffer } = require_buffer_util();
    var closeTimeout = 30 * 1e3;
    var kAborted = /* @__PURE__ */ Symbol("kAborted");
    var protocolVersions = [8, 13];
    var readyStates = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];
    var subprotocolRegex = /^[!#$%&'*+\-.0-9A-Z^_`|a-z~]+$/;
    var WebSocket3 = class _WebSocket extends EventEmitter {
      /**
       * Create a new `WebSocket`.
       *
       * @param {(String|URL)} address The URL to which to connect
       * @param {(String|String[])} [protocols] The subprotocols
       * @param {Object} [options] Connection options
       */
      constructor(address, protocols, options) {
        super();
        this._binaryType = BINARY_TYPES[0];
        this._closeCode = 1006;
        this._closeFrameReceived = false;
        this._closeFrameSent = false;
        this._closeMessage = EMPTY_BUFFER;
        this._closeTimer = null;
        this._errorEmitted = false;
        this._extensions = {};
        this._paused = false;
        this._protocol = "";
        this._readyState = _WebSocket.CONNECTING;
        this._receiver = null;
        this._sender = null;
        this._socket = null;
        if (address !== null) {
          this._bufferedAmount = 0;
          this._isServer = false;
          this._redirects = 0;
          if (protocols === void 0) {
            protocols = [];
          } else if (!Array.isArray(protocols)) {
            if (typeof protocols === "object" && protocols !== null) {
              options = protocols;
              protocols = [];
            } else {
              protocols = [protocols];
            }
          }
          initAsClient(this, address, protocols, options);
        } else {
          this._autoPong = options.autoPong;
          this._isServer = true;
        }
      }
      /**
       * For historical reasons, the custom "nodebuffer" type is used by the default
       * instead of "blob".
       *
       * @type {String}
       */
      get binaryType() {
        return this._binaryType;
      }
      set binaryType(type) {
        if (!BINARY_TYPES.includes(type)) return;
        this._binaryType = type;
        if (this._receiver) this._receiver._binaryType = type;
      }
      /**
       * @type {Number}
       */
      get bufferedAmount() {
        if (!this._socket) return this._bufferedAmount;
        return this._socket._writableState.length + this._sender._bufferedBytes;
      }
      /**
       * @type {String}
       */
      get extensions() {
        return Object.keys(this._extensions).join();
      }
      /**
       * @type {Boolean}
       */
      get isPaused() {
        return this._paused;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onclose() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onerror() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onopen() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onmessage() {
        return null;
      }
      /**
       * @type {String}
       */
      get protocol() {
        return this._protocol;
      }
      /**
       * @type {Number}
       */
      get readyState() {
        return this._readyState;
      }
      /**
       * @type {String}
       */
      get url() {
        return this._url;
      }
      /**
       * Set up the socket and the internal resources.
       *
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Object} options Options object
       * @param {Boolean} [options.allowSynchronousEvents=false] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Number} [options.maxPayload=0] The maximum allowed message size
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       * @private
       */
      setSocket(socket, head, options) {
        const receiver = new Receiver2({
          allowSynchronousEvents: options.allowSynchronousEvents,
          binaryType: this.binaryType,
          extensions: this._extensions,
          isServer: this._isServer,
          maxPayload: options.maxPayload,
          skipUTF8Validation: options.skipUTF8Validation
        });
        const sender = new Sender2(socket, this._extensions, options.generateMask);
        this._receiver = receiver;
        this._sender = sender;
        this._socket = socket;
        receiver[kWebSocket] = this;
        sender[kWebSocket] = this;
        socket[kWebSocket] = this;
        receiver.on("conclude", receiverOnConclude);
        receiver.on("drain", receiverOnDrain);
        receiver.on("error", receiverOnError);
        receiver.on("message", receiverOnMessage);
        receiver.on("ping", receiverOnPing);
        receiver.on("pong", receiverOnPong);
        sender.onerror = senderOnError;
        if (socket.setTimeout) socket.setTimeout(0);
        if (socket.setNoDelay) socket.setNoDelay();
        if (head.length > 0) socket.unshift(head);
        socket.on("close", socketOnClose);
        socket.on("data", socketOnData);
        socket.on("end", socketOnEnd);
        socket.on("error", socketOnError);
        this._readyState = _WebSocket.OPEN;
        this.emit("open");
      }
      /**
       * Emit the `'close'` event.
       *
       * @private
       */
      emitClose() {
        if (!this._socket) {
          this._readyState = _WebSocket.CLOSED;
          this.emit("close", this._closeCode, this._closeMessage);
          return;
        }
        if (this._extensions[PerMessageDeflate.extensionName]) {
          this._extensions[PerMessageDeflate.extensionName].cleanup();
        }
        this._receiver.removeAllListeners();
        this._readyState = _WebSocket.CLOSED;
        this.emit("close", this._closeCode, this._closeMessage);
      }
      /**
       * Start a closing handshake.
       *
       *          +----------+   +-----------+   +----------+
       *     - - -|ws.close()|-->|close frame|-->|ws.close()|- - -
       *    |     +----------+   +-----------+   +----------+     |
       *          +----------+   +-----------+         |
       * CLOSING  |ws.close()|<--|close frame|<--+-----+       CLOSING
       *          +----------+   +-----------+   |
       *    |           |                        |   +---+        |
       *                +------------------------+-->|fin| - - - -
       *    |         +---+                      |   +---+
       *     - - - - -|fin|<---------------------+
       *              +---+
       *
       * @param {Number} [code] Status code explaining why the connection is closing
       * @param {(String|Buffer)} [data] The reason why the connection is
       *     closing
       * @public
       */
      close(code, data) {
        if (this.readyState === _WebSocket.CLOSED) return;
        if (this.readyState === _WebSocket.CONNECTING) {
          const msg = "WebSocket was closed before the connection was established";
          abortHandshake(this, this._req, msg);
          return;
        }
        if (this.readyState === _WebSocket.CLOSING) {
          if (this._closeFrameSent && (this._closeFrameReceived || this._receiver._writableState.errorEmitted)) {
            this._socket.end();
          }
          return;
        }
        this._readyState = _WebSocket.CLOSING;
        this._sender.close(code, data, !this._isServer, (err) => {
          if (err) return;
          this._closeFrameSent = true;
          if (this._closeFrameReceived || this._receiver._writableState.errorEmitted) {
            this._socket.end();
          }
        });
        setCloseTimer(this);
      }
      /**
       * Pause the socket.
       *
       * @public
       */
      pause() {
        if (this.readyState === _WebSocket.CONNECTING || this.readyState === _WebSocket.CLOSED) {
          return;
        }
        this._paused = true;
        this._socket.pause();
      }
      /**
       * Send a ping.
       *
       * @param {*} [data] The data to send
       * @param {Boolean} [mask] Indicates whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when the ping is sent
       * @public
       */
      ping(data, mask, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof data === "function") {
          cb = data;
          data = mask = void 0;
        } else if (typeof mask === "function") {
          cb = mask;
          mask = void 0;
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        if (mask === void 0) mask = !this._isServer;
        this._sender.ping(data || EMPTY_BUFFER, mask, cb);
      }
      /**
       * Send a pong.
       *
       * @param {*} [data] The data to send
       * @param {Boolean} [mask] Indicates whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when the pong is sent
       * @public
       */
      pong(data, mask, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof data === "function") {
          cb = data;
          data = mask = void 0;
        } else if (typeof mask === "function") {
          cb = mask;
          mask = void 0;
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        if (mask === void 0) mask = !this._isServer;
        this._sender.pong(data || EMPTY_BUFFER, mask, cb);
      }
      /**
       * Resume the socket.
       *
       * @public
       */
      resume() {
        if (this.readyState === _WebSocket.CONNECTING || this.readyState === _WebSocket.CLOSED) {
          return;
        }
        this._paused = false;
        if (!this._receiver._writableState.needDrain) this._socket.resume();
      }
      /**
       * Send a data message.
       *
       * @param {*} data The message to send
       * @param {Object} [options] Options object
       * @param {Boolean} [options.binary] Specifies whether `data` is binary or
       *     text
       * @param {Boolean} [options.compress] Specifies whether or not to compress
       *     `data`
       * @param {Boolean} [options.fin=true] Specifies whether the fragment is the
       *     last one
       * @param {Boolean} [options.mask] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when data is written out
       * @public
       */
      send(data, options, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof options === "function") {
          cb = options;
          options = {};
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        const opts = {
          binary: typeof data !== "string",
          mask: !this._isServer,
          compress: true,
          fin: true,
          ...options
        };
        if (!this._extensions[PerMessageDeflate.extensionName]) {
          opts.compress = false;
        }
        this._sender.send(data || EMPTY_BUFFER, opts, cb);
      }
      /**
       * Forcibly close the connection.
       *
       * @public
       */
      terminate() {
        if (this.readyState === _WebSocket.CLOSED) return;
        if (this.readyState === _WebSocket.CONNECTING) {
          const msg = "WebSocket was closed before the connection was established";
          abortHandshake(this, this._req, msg);
          return;
        }
        if (this._socket) {
          this._readyState = _WebSocket.CLOSING;
          this._socket.destroy();
        }
      }
    };
    Object.defineProperty(WebSocket3, "CONNECTING", {
      enumerable: true,
      value: readyStates.indexOf("CONNECTING")
    });
    Object.defineProperty(WebSocket3.prototype, "CONNECTING", {
      enumerable: true,
      value: readyStates.indexOf("CONNECTING")
    });
    Object.defineProperty(WebSocket3, "OPEN", {
      enumerable: true,
      value: readyStates.indexOf("OPEN")
    });
    Object.defineProperty(WebSocket3.prototype, "OPEN", {
      enumerable: true,
      value: readyStates.indexOf("OPEN")
    });
    Object.defineProperty(WebSocket3, "CLOSING", {
      enumerable: true,
      value: readyStates.indexOf("CLOSING")
    });
    Object.defineProperty(WebSocket3.prototype, "CLOSING", {
      enumerable: true,
      value: readyStates.indexOf("CLOSING")
    });
    Object.defineProperty(WebSocket3, "CLOSED", {
      enumerable: true,
      value: readyStates.indexOf("CLOSED")
    });
    Object.defineProperty(WebSocket3.prototype, "CLOSED", {
      enumerable: true,
      value: readyStates.indexOf("CLOSED")
    });
    [
      "binaryType",
      "bufferedAmount",
      "extensions",
      "isPaused",
      "protocol",
      "readyState",
      "url"
    ].forEach((property) => {
      Object.defineProperty(WebSocket3.prototype, property, { enumerable: true });
    });
    ["open", "error", "close", "message"].forEach((method) => {
      Object.defineProperty(WebSocket3.prototype, `on${method}`, {
        enumerable: true,
        get() {
          for (const listener of this.listeners(method)) {
            if (listener[kForOnEventAttribute]) return listener[kListener];
          }
          return null;
        },
        set(handler) {
          for (const listener of this.listeners(method)) {
            if (listener[kForOnEventAttribute]) {
              this.removeListener(method, listener);
              break;
            }
          }
          if (typeof handler !== "function") return;
          this.addEventListener(method, handler, {
            [kForOnEventAttribute]: true
          });
        }
      });
    });
    WebSocket3.prototype.addEventListener = addEventListener;
    WebSocket3.prototype.removeEventListener = removeEventListener;
    module.exports = WebSocket3;
    function initAsClient(websocket, address, protocols, options) {
      const opts = {
        allowSynchronousEvents: true,
        autoPong: true,
        protocolVersion: protocolVersions[1],
        maxPayload: 100 * 1024 * 1024,
        skipUTF8Validation: false,
        perMessageDeflate: true,
        followRedirects: false,
        maxRedirects: 10,
        ...options,
        socketPath: void 0,
        hostname: void 0,
        protocol: void 0,
        timeout: void 0,
        method: "GET",
        host: void 0,
        path: void 0,
        port: void 0
      };
      websocket._autoPong = opts.autoPong;
      if (!protocolVersions.includes(opts.protocolVersion)) {
        throw new RangeError(
          `Unsupported protocol version: ${opts.protocolVersion} (supported versions: ${protocolVersions.join(", ")})`
        );
      }
      let parsedUrl;
      if (address instanceof URL) {
        parsedUrl = address;
      } else {
        try {
          parsedUrl = new URL(address);
        } catch (e) {
          throw new SyntaxError(`Invalid URL: ${address}`);
        }
      }
      if (parsedUrl.protocol === "http:") {
        parsedUrl.protocol = "ws:";
      } else if (parsedUrl.protocol === "https:") {
        parsedUrl.protocol = "wss:";
      }
      websocket._url = parsedUrl.href;
      const isSecure = parsedUrl.protocol === "wss:";
      const isIpcUrl = parsedUrl.protocol === "ws+unix:";
      let invalidUrlMessage;
      if (parsedUrl.protocol !== "ws:" && !isSecure && !isIpcUrl) {
        invalidUrlMessage = `The URL's protocol must be one of "ws:", "wss:", "http:", "https:", or "ws+unix:"`;
      } else if (isIpcUrl && !parsedUrl.pathname) {
        invalidUrlMessage = "The URL's pathname is empty";
      } else if (parsedUrl.hash) {
        invalidUrlMessage = "The URL contains a fragment identifier";
      }
      if (invalidUrlMessage) {
        const err = new SyntaxError(invalidUrlMessage);
        if (websocket._redirects === 0) {
          throw err;
        } else {
          emitErrorAndClose(websocket, err);
          return;
        }
      }
      const defaultPort = isSecure ? 443 : 80;
      const key = randomBytes(16).toString("base64");
      const request = isSecure ? https.request : http2.request;
      const protocolSet = /* @__PURE__ */ new Set();
      let perMessageDeflate;
      opts.createConnection = opts.createConnection || (isSecure ? tlsConnect : netConnect);
      opts.defaultPort = opts.defaultPort || defaultPort;
      opts.port = parsedUrl.port || defaultPort;
      opts.host = parsedUrl.hostname.startsWith("[") ? parsedUrl.hostname.slice(1, -1) : parsedUrl.hostname;
      opts.headers = {
        ...opts.headers,
        "Sec-WebSocket-Version": opts.protocolVersion,
        "Sec-WebSocket-Key": key,
        Connection: "Upgrade",
        Upgrade: "websocket"
      };
      opts.path = parsedUrl.pathname + parsedUrl.search;
      opts.timeout = opts.handshakeTimeout;
      if (opts.perMessageDeflate) {
        perMessageDeflate = new PerMessageDeflate(
          opts.perMessageDeflate !== true ? opts.perMessageDeflate : {},
          false,
          opts.maxPayload
        );
        opts.headers["Sec-WebSocket-Extensions"] = format({
          [PerMessageDeflate.extensionName]: perMessageDeflate.offer()
        });
      }
      if (protocols.length) {
        for (const protocol of protocols) {
          if (typeof protocol !== "string" || !subprotocolRegex.test(protocol) || protocolSet.has(protocol)) {
            throw new SyntaxError(
              "An invalid or duplicated subprotocol was specified"
            );
          }
          protocolSet.add(protocol);
        }
        opts.headers["Sec-WebSocket-Protocol"] = protocols.join(",");
      }
      if (opts.origin) {
        if (opts.protocolVersion < 13) {
          opts.headers["Sec-WebSocket-Origin"] = opts.origin;
        } else {
          opts.headers.Origin = opts.origin;
        }
      }
      if (parsedUrl.username || parsedUrl.password) {
        opts.auth = `${parsedUrl.username}:${parsedUrl.password}`;
      }
      if (isIpcUrl) {
        const parts = opts.path.split(":");
        opts.socketPath = parts[0];
        opts.path = parts[1];
      }
      let req;
      if (opts.followRedirects) {
        if (websocket._redirects === 0) {
          websocket._originalIpc = isIpcUrl;
          websocket._originalSecure = isSecure;
          websocket._originalHostOrSocketPath = isIpcUrl ? opts.socketPath : parsedUrl.host;
          const headers = options && options.headers;
          options = { ...options, headers: {} };
          if (headers) {
            for (const [key2, value] of Object.entries(headers)) {
              options.headers[key2.toLowerCase()] = value;
            }
          }
        } else if (websocket.listenerCount("redirect") === 0) {
          const isSameHost = isIpcUrl ? websocket._originalIpc ? opts.socketPath === websocket._originalHostOrSocketPath : false : websocket._originalIpc ? false : parsedUrl.host === websocket._originalHostOrSocketPath;
          if (!isSameHost || websocket._originalSecure && !isSecure) {
            delete opts.headers.authorization;
            delete opts.headers.cookie;
            if (!isSameHost) delete opts.headers.host;
            opts.auth = void 0;
          }
        }
        if (opts.auth && !options.headers.authorization) {
          options.headers.authorization = "Basic " + Buffer.from(opts.auth).toString("base64");
        }
        req = websocket._req = request(opts);
        if (websocket._redirects) {
          websocket.emit("redirect", websocket.url, req);
        }
      } else {
        req = websocket._req = request(opts);
      }
      if (opts.timeout) {
        req.on("timeout", () => {
          abortHandshake(websocket, req, "Opening handshake has timed out");
        });
      }
      req.on("error", (err) => {
        if (req === null || req[kAborted]) return;
        req = websocket._req = null;
        emitErrorAndClose(websocket, err);
      });
      req.on("response", (res) => {
        const location = res.headers.location;
        const statusCode = res.statusCode;
        if (location && opts.followRedirects && statusCode >= 300 && statusCode < 400) {
          if (++websocket._redirects > opts.maxRedirects) {
            abortHandshake(websocket, req, "Maximum redirects exceeded");
            return;
          }
          req.abort();
          let addr;
          try {
            addr = new URL(location, address);
          } catch (e) {
            const err = new SyntaxError(`Invalid URL: ${location}`);
            emitErrorAndClose(websocket, err);
            return;
          }
          initAsClient(websocket, addr, protocols, options);
        } else if (!websocket.emit("unexpected-response", req, res)) {
          abortHandshake(
            websocket,
            req,
            `Unexpected server response: ${res.statusCode}`
          );
        }
      });
      req.on("upgrade", (res, socket, head) => {
        websocket.emit("upgrade", res);
        if (websocket.readyState !== WebSocket3.CONNECTING) return;
        req = websocket._req = null;
        const upgrade = res.headers.upgrade;
        if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
          abortHandshake(websocket, socket, "Invalid Upgrade header");
          return;
        }
        const digest = createHash("sha1").update(key + GUID).digest("base64");
        if (res.headers["sec-websocket-accept"] !== digest) {
          abortHandshake(websocket, socket, "Invalid Sec-WebSocket-Accept header");
          return;
        }
        const serverProt = res.headers["sec-websocket-protocol"];
        let protError;
        if (serverProt !== void 0) {
          if (!protocolSet.size) {
            protError = "Server sent a subprotocol but none was requested";
          } else if (!protocolSet.has(serverProt)) {
            protError = "Server sent an invalid subprotocol";
          }
        } else if (protocolSet.size) {
          protError = "Server sent no subprotocol";
        }
        if (protError) {
          abortHandshake(websocket, socket, protError);
          return;
        }
        if (serverProt) websocket._protocol = serverProt;
        const secWebSocketExtensions = res.headers["sec-websocket-extensions"];
        if (secWebSocketExtensions !== void 0) {
          if (!perMessageDeflate) {
            const message = "Server sent a Sec-WebSocket-Extensions header but no extension was requested";
            abortHandshake(websocket, socket, message);
            return;
          }
          let extensions;
          try {
            extensions = parse(secWebSocketExtensions);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Extensions header";
            abortHandshake(websocket, socket, message);
            return;
          }
          const extensionNames = Object.keys(extensions);
          if (extensionNames.length !== 1 || extensionNames[0] !== PerMessageDeflate.extensionName) {
            const message = "Server indicated an extension that was not requested";
            abortHandshake(websocket, socket, message);
            return;
          }
          try {
            perMessageDeflate.accept(extensions[PerMessageDeflate.extensionName]);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Extensions header";
            abortHandshake(websocket, socket, message);
            return;
          }
          websocket._extensions[PerMessageDeflate.extensionName] = perMessageDeflate;
        }
        websocket.setSocket(socket, head, {
          allowSynchronousEvents: opts.allowSynchronousEvents,
          generateMask: opts.generateMask,
          maxPayload: opts.maxPayload,
          skipUTF8Validation: opts.skipUTF8Validation
        });
      });
      if (opts.finishRequest) {
        opts.finishRequest(req, websocket);
      } else {
        req.end();
      }
    }
    function emitErrorAndClose(websocket, err) {
      websocket._readyState = WebSocket3.CLOSING;
      websocket._errorEmitted = true;
      websocket.emit("error", err);
      websocket.emitClose();
    }
    function netConnect(options) {
      options.path = options.socketPath;
      return net3.connect(options);
    }
    function tlsConnect(options) {
      options.path = void 0;
      if (!options.servername && options.servername !== "") {
        options.servername = net3.isIP(options.host) ? "" : options.host;
      }
      return tls.connect(options);
    }
    function abortHandshake(websocket, stream, message) {
      websocket._readyState = WebSocket3.CLOSING;
      const err = new Error(message);
      Error.captureStackTrace(err, abortHandshake);
      if (stream.setHeader) {
        stream[kAborted] = true;
        stream.abort();
        if (stream.socket && !stream.socket.destroyed) {
          stream.socket.destroy();
        }
        process.nextTick(emitErrorAndClose, websocket, err);
      } else {
        stream.destroy(err);
        stream.once("error", websocket.emit.bind(websocket, "error"));
        stream.once("close", websocket.emitClose.bind(websocket));
      }
    }
    function sendAfterClose(websocket, data, cb) {
      if (data) {
        const length = isBlob(data) ? data.size : toBuffer(data).length;
        if (websocket._socket) websocket._sender._bufferedBytes += length;
        else websocket._bufferedAmount += length;
      }
      if (cb) {
        const err = new Error(
          `WebSocket is not open: readyState ${websocket.readyState} (${readyStates[websocket.readyState]})`
        );
        process.nextTick(cb, err);
      }
    }
    function receiverOnConclude(code, reason) {
      const websocket = this[kWebSocket];
      websocket._closeFrameReceived = true;
      websocket._closeMessage = reason;
      websocket._closeCode = code;
      if (websocket._socket[kWebSocket] === void 0) return;
      websocket._socket.removeListener("data", socketOnData);
      process.nextTick(resume, websocket._socket);
      if (code === 1005) websocket.close();
      else websocket.close(code, reason);
    }
    function receiverOnDrain() {
      const websocket = this[kWebSocket];
      if (!websocket.isPaused) websocket._socket.resume();
    }
    function receiverOnError(err) {
      const websocket = this[kWebSocket];
      if (websocket._socket[kWebSocket] !== void 0) {
        websocket._socket.removeListener("data", socketOnData);
        process.nextTick(resume, websocket._socket);
        websocket.close(err[kStatusCode]);
      }
      if (!websocket._errorEmitted) {
        websocket._errorEmitted = true;
        websocket.emit("error", err);
      }
    }
    function receiverOnFinish() {
      this[kWebSocket].emitClose();
    }
    function receiverOnMessage(data, isBinary) {
      this[kWebSocket].emit("message", data, isBinary);
    }
    function receiverOnPing(data) {
      const websocket = this[kWebSocket];
      if (websocket._autoPong) websocket.pong(data, !this._isServer, NOOP);
      websocket.emit("ping", data);
    }
    function receiverOnPong(data) {
      this[kWebSocket].emit("pong", data);
    }
    function resume(stream) {
      stream.resume();
    }
    function senderOnError(err) {
      const websocket = this[kWebSocket];
      if (websocket.readyState === WebSocket3.CLOSED) return;
      if (websocket.readyState === WebSocket3.OPEN) {
        websocket._readyState = WebSocket3.CLOSING;
        setCloseTimer(websocket);
      }
      this._socket.end();
      if (!websocket._errorEmitted) {
        websocket._errorEmitted = true;
        websocket.emit("error", err);
      }
    }
    function setCloseTimer(websocket) {
      websocket._closeTimer = setTimeout(
        websocket._socket.destroy.bind(websocket._socket),
        closeTimeout
      );
    }
    function socketOnClose() {
      const websocket = this[kWebSocket];
      this.removeListener("close", socketOnClose);
      this.removeListener("data", socketOnData);
      this.removeListener("end", socketOnEnd);
      websocket._readyState = WebSocket3.CLOSING;
      let chunk;
      if (!this._readableState.endEmitted && !websocket._closeFrameReceived && !websocket._receiver._writableState.errorEmitted && (chunk = websocket._socket.read()) !== null) {
        websocket._receiver.write(chunk);
      }
      websocket._receiver.end();
      this[kWebSocket] = void 0;
      clearTimeout(websocket._closeTimer);
      if (websocket._receiver._writableState.finished || websocket._receiver._writableState.errorEmitted) {
        websocket.emitClose();
      } else {
        websocket._receiver.on("error", receiverOnFinish);
        websocket._receiver.on("finish", receiverOnFinish);
      }
    }
    function socketOnData(chunk) {
      if (!this[kWebSocket]._receiver.write(chunk)) {
        this.pause();
      }
    }
    function socketOnEnd() {
      const websocket = this[kWebSocket];
      websocket._readyState = WebSocket3.CLOSING;
      websocket._receiver.end();
      this.end();
    }
    function socketOnError() {
      const websocket = this[kWebSocket];
      this.removeListener("error", socketOnError);
      this.on("error", NOOP);
      if (websocket) {
        websocket._readyState = WebSocket3.CLOSING;
        this.destroy();
      }
    }
  }
});

// node_modules/ws/lib/stream.js
var require_stream = __commonJS({
  "node_modules/ws/lib/stream.js"(exports, module) {
    "use strict";
    var WebSocket3 = require_websocket();
    var { Duplex } = __require("stream");
    function emitClose(stream) {
      stream.emit("close");
    }
    function duplexOnEnd() {
      if (!this.destroyed && this._writableState.finished) {
        this.destroy();
      }
    }
    function duplexOnError(err) {
      this.removeListener("error", duplexOnError);
      this.destroy();
      if (this.listenerCount("error") === 0) {
        this.emit("error", err);
      }
    }
    function createWebSocketStream2(ws, options) {
      let terminateOnDestroy = true;
      const duplex = new Duplex({
        ...options,
        autoDestroy: false,
        emitClose: false,
        objectMode: false,
        writableObjectMode: false
      });
      ws.on("message", function message(msg, isBinary) {
        const data = !isBinary && duplex._readableState.objectMode ? msg.toString() : msg;
        if (!duplex.push(data)) ws.pause();
      });
      ws.once("error", function error(err) {
        if (duplex.destroyed) return;
        terminateOnDestroy = false;
        duplex.destroy(err);
      });
      ws.once("close", function close() {
        if (duplex.destroyed) return;
        duplex.push(null);
      });
      duplex._destroy = function(err, callback) {
        if (ws.readyState === ws.CLOSED) {
          callback(err);
          process.nextTick(emitClose, duplex);
          return;
        }
        let called = false;
        ws.once("error", function error(err2) {
          called = true;
          callback(err2);
        });
        ws.once("close", function close() {
          if (!called) callback(err);
          process.nextTick(emitClose, duplex);
        });
        if (terminateOnDestroy) ws.terminate();
      };
      duplex._final = function(callback) {
        if (ws.readyState === ws.CONNECTING) {
          ws.once("open", function open() {
            duplex._final(callback);
          });
          return;
        }
        if (ws._socket === null) return;
        if (ws._socket._writableState.finished) {
          callback();
          if (duplex._readableState.endEmitted) duplex.destroy();
        } else {
          ws._socket.once("finish", function finish() {
            callback();
          });
          ws.close();
        }
      };
      duplex._read = function() {
        if (ws.isPaused) ws.resume();
      };
      duplex._write = function(chunk, encoding, callback) {
        if (ws.readyState === ws.CONNECTING) {
          ws.once("open", function open() {
            duplex._write(chunk, encoding, callback);
          });
          return;
        }
        ws.send(chunk, callback);
      };
      duplex.on("end", duplexOnEnd);
      duplex.on("error", duplexOnError);
      return duplex;
    }
    module.exports = createWebSocketStream2;
  }
});

// node_modules/ws/lib/subprotocol.js
var require_subprotocol = __commonJS({
  "node_modules/ws/lib/subprotocol.js"(exports, module) {
    "use strict";
    var { tokenChars } = require_validation();
    function parse(header) {
      const protocols = /* @__PURE__ */ new Set();
      let start = -1;
      let end = -1;
      let i = 0;
      for (i; i < header.length; i++) {
        const code = header.charCodeAt(i);
        if (end === -1 && tokenChars[code] === 1) {
          if (start === -1) start = i;
        } else if (i !== 0 && (code === 32 || code === 9)) {
          if (end === -1 && start !== -1) end = i;
        } else if (code === 44) {
          if (start === -1) {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
          if (end === -1) end = i;
          const protocol2 = header.slice(start, end);
          if (protocols.has(protocol2)) {
            throw new SyntaxError(`The "${protocol2}" subprotocol is duplicated`);
          }
          protocols.add(protocol2);
          start = end = -1;
        } else {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
      }
      if (start === -1 || end !== -1) {
        throw new SyntaxError("Unexpected end of input");
      }
      const protocol = header.slice(start, i);
      if (protocols.has(protocol)) {
        throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
      }
      protocols.add(protocol);
      return protocols;
    }
    module.exports = { parse };
  }
});

// node_modules/ws/lib/websocket-server.js
var require_websocket_server = __commonJS({
  "node_modules/ws/lib/websocket-server.js"(exports, module) {
    "use strict";
    var EventEmitter = __require("events");
    var http2 = __require("http");
    var { Duplex } = __require("stream");
    var { createHash } = __require("crypto");
    var extension = require_extension();
    var PerMessageDeflate = require_permessage_deflate();
    var subprotocol = require_subprotocol();
    var WebSocket3 = require_websocket();
    var { GUID, kWebSocket } = require_constants();
    var keyRegex = /^[+/0-9A-Za-z]{22}==$/;
    var RUNNING = 0;
    var CLOSING = 1;
    var CLOSED = 2;
    var WebSocketServer2 = class extends EventEmitter {
      /**
       * Create a `WebSocketServer` instance.
       *
       * @param {Object} options Configuration options
       * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {Boolean} [options.autoPong=true] Specifies whether or not to
       *     automatically send a pong in response to a ping
       * @param {Number} [options.backlog=511] The maximum length of the queue of
       *     pending connections
       * @param {Boolean} [options.clientTracking=true] Specifies whether or not to
       *     track clients
       * @param {Function} [options.handleProtocols] A hook to handle protocols
       * @param {String} [options.host] The hostname where to bind the server
       * @param {Number} [options.maxPayload=104857600] The maximum allowed message
       *     size
       * @param {Boolean} [options.noServer=false] Enable no server mode
       * @param {String} [options.path] Accept only connections matching this path
       * @param {(Boolean|Object)} [options.perMessageDeflate=false] Enable/disable
       *     permessage-deflate
       * @param {Number} [options.port] The port where to bind the server
       * @param {(http.Server|https.Server)} [options.server] A pre-created HTTP/S
       *     server to use
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       * @param {Function} [options.verifyClient] A hook to reject connections
       * @param {Function} [options.WebSocket=WebSocket] Specifies the `WebSocket`
       *     class to use. It must be the `WebSocket` class or class that extends it
       * @param {Function} [callback] A listener for the `listening` event
       */
      constructor(options, callback) {
        super();
        options = {
          allowSynchronousEvents: true,
          autoPong: true,
          maxPayload: 100 * 1024 * 1024,
          skipUTF8Validation: false,
          perMessageDeflate: false,
          handleProtocols: null,
          clientTracking: true,
          verifyClient: null,
          noServer: false,
          backlog: null,
          // use default (511 as implemented in net.js)
          server: null,
          host: null,
          path: null,
          port: null,
          WebSocket: WebSocket3,
          ...options
        };
        if (options.port == null && !options.server && !options.noServer || options.port != null && (options.server || options.noServer) || options.server && options.noServer) {
          throw new TypeError(
            'One and only one of the "port", "server", or "noServer" options must be specified'
          );
        }
        if (options.port != null) {
          this._server = http2.createServer((req, res) => {
            const body = http2.STATUS_CODES[426];
            res.writeHead(426, {
              "Content-Length": body.length,
              "Content-Type": "text/plain"
            });
            res.end(body);
          });
          this._server.listen(
            options.port,
            options.host,
            options.backlog,
            callback
          );
        } else if (options.server) {
          this._server = options.server;
        }
        if (this._server) {
          const emitConnection = this.emit.bind(this, "connection");
          this._removeListeners = addListeners(this._server, {
            listening: this.emit.bind(this, "listening"),
            error: this.emit.bind(this, "error"),
            upgrade: (req, socket, head) => {
              this.handleUpgrade(req, socket, head, emitConnection);
            }
          });
        }
        if (options.perMessageDeflate === true) options.perMessageDeflate = {};
        if (options.clientTracking) {
          this.clients = /* @__PURE__ */ new Set();
          this._shouldEmitClose = false;
        }
        this.options = options;
        this._state = RUNNING;
      }
      /**
       * Returns the bound address, the address family name, and port of the server
       * as reported by the operating system if listening on an IP socket.
       * If the server is listening on a pipe or UNIX domain socket, the name is
       * returned as a string.
       *
       * @return {(Object|String|null)} The address of the server
       * @public
       */
      address() {
        if (this.options.noServer) {
          throw new Error('The server is operating in "noServer" mode');
        }
        if (!this._server) return null;
        return this._server.address();
      }
      /**
       * Stop the server from accepting new connections and emit the `'close'` event
       * when all existing connections are closed.
       *
       * @param {Function} [cb] A one-time listener for the `'close'` event
       * @public
       */
      close(cb) {
        if (this._state === CLOSED) {
          if (cb) {
            this.once("close", () => {
              cb(new Error("The server is not running"));
            });
          }
          process.nextTick(emitClose, this);
          return;
        }
        if (cb) this.once("close", cb);
        if (this._state === CLOSING) return;
        this._state = CLOSING;
        if (this.options.noServer || this.options.server) {
          if (this._server) {
            this._removeListeners();
            this._removeListeners = this._server = null;
          }
          if (this.clients) {
            if (!this.clients.size) {
              process.nextTick(emitClose, this);
            } else {
              this._shouldEmitClose = true;
            }
          } else {
            process.nextTick(emitClose, this);
          }
        } else {
          const server = this._server;
          this._removeListeners();
          this._removeListeners = this._server = null;
          server.close(() => {
            emitClose(this);
          });
        }
      }
      /**
       * See if a given request should be handled by this server instance.
       *
       * @param {http.IncomingMessage} req Request object to inspect
       * @return {Boolean} `true` if the request is valid, else `false`
       * @public
       */
      shouldHandle(req) {
        if (this.options.path) {
          const index = req.url.indexOf("?");
          const pathname = index !== -1 ? req.url.slice(0, index) : req.url;
          if (pathname !== this.options.path) return false;
        }
        return true;
      }
      /**
       * Handle a HTTP Upgrade request.
       *
       * @param {http.IncomingMessage} req The request object
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Function} cb Callback
       * @public
       */
      handleUpgrade(req, socket, head, cb) {
        socket.on("error", socketOnError);
        const key = req.headers["sec-websocket-key"];
        const upgrade = req.headers.upgrade;
        const version = +req.headers["sec-websocket-version"];
        if (req.method !== "GET") {
          const message = "Invalid HTTP method";
          abortHandshakeOrEmitwsClientError(this, req, socket, 405, message);
          return;
        }
        if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
          const message = "Invalid Upgrade header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
        if (key === void 0 || !keyRegex.test(key)) {
          const message = "Missing or invalid Sec-WebSocket-Key header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
        if (version !== 13 && version !== 8) {
          const message = "Missing or invalid Sec-WebSocket-Version header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message, {
            "Sec-WebSocket-Version": "13, 8"
          });
          return;
        }
        if (!this.shouldHandle(req)) {
          abortHandshake(socket, 400);
          return;
        }
        const secWebSocketProtocol = req.headers["sec-websocket-protocol"];
        let protocols = /* @__PURE__ */ new Set();
        if (secWebSocketProtocol !== void 0) {
          try {
            protocols = subprotocol.parse(secWebSocketProtocol);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Protocol header";
            abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
            return;
          }
        }
        const secWebSocketExtensions = req.headers["sec-websocket-extensions"];
        const extensions = {};
        if (this.options.perMessageDeflate && secWebSocketExtensions !== void 0) {
          const perMessageDeflate = new PerMessageDeflate(
            this.options.perMessageDeflate,
            true,
            this.options.maxPayload
          );
          try {
            const offers = extension.parse(secWebSocketExtensions);
            if (offers[PerMessageDeflate.extensionName]) {
              perMessageDeflate.accept(offers[PerMessageDeflate.extensionName]);
              extensions[PerMessageDeflate.extensionName] = perMessageDeflate;
            }
          } catch (err) {
            const message = "Invalid or unacceptable Sec-WebSocket-Extensions header";
            abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
            return;
          }
        }
        if (this.options.verifyClient) {
          const info = {
            origin: req.headers[`${version === 8 ? "sec-websocket-origin" : "origin"}`],
            secure: !!(req.socket.authorized || req.socket.encrypted),
            req
          };
          if (this.options.verifyClient.length === 2) {
            this.options.verifyClient(info, (verified, code, message, headers) => {
              if (!verified) {
                return abortHandshake(socket, code || 401, message, headers);
              }
              this.completeUpgrade(
                extensions,
                key,
                protocols,
                req,
                socket,
                head,
                cb
              );
            });
            return;
          }
          if (!this.options.verifyClient(info)) return abortHandshake(socket, 401);
        }
        this.completeUpgrade(extensions, key, protocols, req, socket, head, cb);
      }
      /**
       * Upgrade the connection to WebSocket.
       *
       * @param {Object} extensions The accepted extensions
       * @param {String} key The value of the `Sec-WebSocket-Key` header
       * @param {Set} protocols The subprotocols
       * @param {http.IncomingMessage} req The request object
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Function} cb Callback
       * @throws {Error} If called more than once with the same socket
       * @private
       */
      completeUpgrade(extensions, key, protocols, req, socket, head, cb) {
        if (!socket.readable || !socket.writable) return socket.destroy();
        if (socket[kWebSocket]) {
          throw new Error(
            "server.handleUpgrade() was called more than once with the same socket, possibly due to a misconfiguration"
          );
        }
        if (this._state > RUNNING) return abortHandshake(socket, 503);
        const digest = createHash("sha1").update(key + GUID).digest("base64");
        const headers = [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Accept: ${digest}`
        ];
        const ws = new this.options.WebSocket(null, void 0, this.options);
        if (protocols.size) {
          const protocol = this.options.handleProtocols ? this.options.handleProtocols(protocols, req) : protocols.values().next().value;
          if (protocol) {
            headers.push(`Sec-WebSocket-Protocol: ${protocol}`);
            ws._protocol = protocol;
          }
        }
        if (extensions[PerMessageDeflate.extensionName]) {
          const params = extensions[PerMessageDeflate.extensionName].params;
          const value = extension.format({
            [PerMessageDeflate.extensionName]: [params]
          });
          headers.push(`Sec-WebSocket-Extensions: ${value}`);
          ws._extensions = extensions;
        }
        this.emit("headers", headers, req);
        socket.write(headers.concat("\r\n").join("\r\n"));
        socket.removeListener("error", socketOnError);
        ws.setSocket(socket, head, {
          allowSynchronousEvents: this.options.allowSynchronousEvents,
          maxPayload: this.options.maxPayload,
          skipUTF8Validation: this.options.skipUTF8Validation
        });
        if (this.clients) {
          this.clients.add(ws);
          ws.on("close", () => {
            this.clients.delete(ws);
            if (this._shouldEmitClose && !this.clients.size) {
              process.nextTick(emitClose, this);
            }
          });
        }
        cb(ws, req);
      }
    };
    module.exports = WebSocketServer2;
    function addListeners(server, map) {
      for (const event of Object.keys(map)) server.on(event, map[event]);
      return function removeListeners() {
        for (const event of Object.keys(map)) {
          server.removeListener(event, map[event]);
        }
      };
    }
    function emitClose(server) {
      server._state = CLOSED;
      server.emit("close");
    }
    function socketOnError() {
      this.destroy();
    }
    function abortHandshake(socket, code, message, headers) {
      message = message || http2.STATUS_CODES[code];
      headers = {
        Connection: "close",
        "Content-Type": "text/html",
        "Content-Length": Buffer.byteLength(message),
        ...headers
      };
      socket.once("finish", socket.destroy);
      socket.end(
        `HTTP/1.1 ${code} ${http2.STATUS_CODES[code]}\r
` + Object.keys(headers).map((h) => `${h}: ${headers[h]}`).join("\r\n") + "\r\n\r\n" + message
      );
    }
    function abortHandshakeOrEmitwsClientError(server, req, socket, code, message, headers) {
      if (server.listenerCount("wsClientError")) {
        const err = new Error(message);
        Error.captureStackTrace(err, abortHandshakeOrEmitwsClientError);
        server.emit("wsClientError", err, socket, req);
      } else {
        abortHandshake(socket, code, message, headers);
      }
    }
  }
});

// node_modules/ws/wrapper.mjs
var import_stream, import_receiver, import_sender, import_websocket, import_websocket_server;
var init_wrapper = __esm({
  "node_modules/ws/wrapper.mjs"() {
    import_stream = __toESM(require_stream(), 1);
    import_receiver = __toESM(require_receiver(), 1);
    import_sender = __toESM(require_sender(), 1);
    import_websocket = __toESM(require_websocket(), 1);
    import_websocket_server = __toESM(require_websocket_server(), 1);
  }
});

// src/server/server.ts
var server_exports = {};
__export(server_exports, {
  onBoardServerClosed: () => onBoardServerClosed,
  startBoardServer: () => startBoardServer,
  stopBoardServer: () => stopBoardServer
});
import crypto4 from "node:crypto";
import fs8 from "node:fs";
import http from "node:http";
import path8 from "node:path";
async function startBoardServer(opts) {
  logStart(opts.dataRoot);
  await takeStartLock(opts.dataRoot);
  try {
    return await runBoardServer(opts);
  } catch (e) {
    releaseStartLock(opts.dataRoot);
    throw e;
  }
}
function logStart(dataRoot) {
  fs8.mkdirSync(dataRoot, { recursive: true });
  fs8.appendFileSync(serverLogFile(dataRoot), `serve: home ${path8.resolve(dataRoot)}, pid ${process.pid}, started by ${process.ppid} ${starterCommandLine()}
`);
}
function starterCommandLine() {
  const passed = process.env[SERVER_STARTER_ENV];
  if (passed) return passed;
  try {
    const read = fs8.readFileSync(`/proc/${process.ppid}/cmdline`, "utf8").split("\0").filter(Boolean).join(" ");
    if (read) return read;
  } catch {
  }
  return "unknown";
}
async function takeStartLock(dataRoot) {
  fs8.mkdirSync(dataRoot, { recursive: true });
  const lock = serverStartLock(dataRoot);
  for (let emptyReads = 0; ; ) {
    try {
      fs8.writeFileSync(lock, String(process.pid), { flag: "wx" });
      return;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    const holder = serverLockHolder(dataRoot);
    if (holder === process.pid) return;
    if (holder !== null && liveStartLockHolder(dataRoot) === holder) throw new Error(`swarm: a board server already runs on this data home (pid ${holder})`);
    if (holder === null && ++emptyReads <= LOCK_READ_RETRIES) {
      await new Promise((r) => setTimeout(r, LOCK_READ_RETRY_MS));
      continue;
    }
    await removeStaleStartLock(dataRoot, holder);
    emptyReads = 0;
  }
}
async function removeStaleStartLock(dataRoot, seen) {
  const breaker = `${serverStartLock(dataRoot)}.break`;
  try {
    fs8.writeFileSync(breaker, String(process.pid), { flag: "wx" });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    try {
      if (Date.now() - fs8.statSync(breaker).mtimeMs > BREAKER_STALE_MS) fs8.rmSync(breaker, { force: true });
    } catch {
    }
    await new Promise((r) => setTimeout(r, LOCK_READ_RETRY_MS));
    return;
  }
  try {
    if (serverLockHolder(dataRoot) === seen) fs8.rmSync(serverStartLock(dataRoot), { force: true });
  } finally {
    fs8.rmSync(breaker, { force: true });
  }
}
function releaseStartLock(dataRoot) {
  if (serverLockHolder(dataRoot) === process.pid) fs8.rmSync(serverStartLock(dataRoot), { force: true });
}
async function runBoardServer(opts) {
  const host = opts.host ?? "127.0.0.1";
  const now = opts.now ?? (() => /* @__PURE__ */ new Date());
  const board2 = await openBoard(path8.join(opts.dataRoot, "swarm.sqlite"));
  const secret = crypto4.randomBytes(24).toString("hex");
  const version = bundleVersion();
  const speakers = /* @__PURE__ */ new Set();
  const calls = /* @__PURE__ */ new Map();
  const links = /* @__PURE__ */ new Map();
  const memberOf = (name) => name.slice(name.lastIndexOf("/") + 1);
  const keepLink = (run3, member, link) => {
    const members = links.get(run3) ?? /* @__PURE__ */ new Map();
    links.set(run3, members);
    members.set(member, link);
    logged("recordLink", () => board2.recordLink(run3, member, link));
  };
  const linked = (m, connected) => keepLink(m.run, memberOf(m.name), connected ? { connected: true, lostAt: null } : { connected: false, lostAt: now().getTime() });
  const transcripts = /* @__PURE__ */ new Map();
  const grewAt = (file) => {
    if (!file) return null;
    try {
      const st = fs8.statSync(file);
      return st.isFile() ? st.mtimeMs : null;
    } catch {
      return null;
    }
  };
  const presenceIn = (run3) => (member) => {
    const link = links.get(run3)?.get(member) ?? { connected: false, lostAt: null };
    return link.connected ? link : { ...link, transcriptGrewAt: grewAt(transcripts.get(run3)?.get(member)) };
  };
  const logged = (what, fn) => {
    try {
      fn();
    } catch (e) {
      console.error(`swarm server: ${what} failed: ${e.stack ?? e.message}`);
    }
  };
  const startedAt = now().getTime();
  for (const saved of board2.savedLinks())
    keepLink(saved.run, saved.member, saved.connected ? { connected: false, lostAt: startedAt } : { connected: false, lostAt: saved.lostAt });
  const send = (s, f) => {
    if (s.socket.readyState === s.socket.OPEN) s.socket.send(encode(f));
  };
  const refuse = (s, reason) => {
    send(s, { type: "refused", reason });
    s.socket.close();
  };
  const answer = (id, rec, text) => {
    rec.answer = text;
    rec.answeredAt = Date.now();
    rec.cancelWait = null;
    if (rec.speaker.socket.readyState === rec.speaker.socket.OPEN) rec.speaker.socket.send(text);
    void id;
  };
  const dropWait = (id) => {
    const rec = calls.get(id);
    if (!rec || rec.answer !== null) return;
    calls.delete(id);
    rec.cancelWait?.abort();
  };
  const run2 = (s, call) => {
    const known = calls.get(call.id);
    if (known) {
      known.speaker = s;
      if (known.answer !== null) s.socket.send(known.answer);
      return;
    }
    const rec = { speaker: s, answer: null, answeredAt: 0, cancelWait: null };
    calls.set(call.id, rec);
    const fail2 = (error) => answer(call.id, rec, encode({ type: "result", id: call.id, ok: false, error }));
    if (!CALLABLE.has(call.method)) return fail2(`unknown method ${String(call.method)}`);
    const args2 = Array.isArray(call.args) ? [...call.args] : [];
    if (call.method === "wait") {
      rec.cancelWait = new AbortController();
      args2[1] = { ...args2[1] ?? {}, signal: rec.cancelWait.signal };
    }
    let out;
    try {
      out = board2[call.method](...args2);
    } catch (e) {
      return fail2(e.message);
    }
    const settle = (value) => {
      if (calls.get(call.id) !== rec) return;
      answer(call.id, rec, encode({ type: "result", id: call.id, ok: true, value: value === void 0 ? null : value }));
      if (call.method === "closeRun") closed(Number(args2[0]));
    };
    if (out instanceof Promise) out.then(settle, (e) => calls.get(call.id) === rec && fail2(e.message));
    else settle(out);
  };
  const closed = (run3) => {
    for (const s of speakers) if (s.member?.run === run3) refuse(s, "closed");
  };
  const httpServer = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === STOP_PATH && req.headers[SECRET_HEADER] === secret) {
      res.end("stopping");
      void close();
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  const wss = new import_websocket_server.default({ server: httpServer });
  wss.on("connection", (socket) => {
    const s = { socket, member: null, lastPong: Date.now(), subscribed: false };
    let welcomed = false;
    socket.on("pong", () => s.lastPong = Date.now());
    socket.on("message", (data) => {
      let f;
      try {
        f = decode(String(data));
      } catch {
        return socket.close();
      }
      if (!welcomed) {
        if (f.type !== "hello") return socket.close();
        if (f.secret !== secret) return refuse(s, "secret");
        if (f.version !== version) return refuse(s, "version");
        if (f.member) {
          for (const other of speakers)
            if (f.supersede && other.member && other.member.name === f.member.name && other.member.run === f.member.run) refuse(other, "superseded");
          s.member = f.member;
          linked(f.member, true);
        }
        welcomed = true;
        speakers.add(s);
        return send(s, { type: "welcome", version });
      }
      if (f.type === "call") run2(s, f);
      else if (f.type === "cancel") dropWait(f.id);
      else if (f.type === "bye") socket.close();
      else if (f.type === "activity" && s.member) {
        const m = s.member;
        const file = f.activity.transcript;
        if (file) {
          const members = transcripts.get(m.run) ?? /* @__PURE__ */ new Map();
          transcripts.set(m.run, members);
          members.set(memberOf(m.name), file);
        }
        logged("activity", () => board2.recordActivity(m.run, memberOf(m.name), f.activity, now()));
      } else if (f.type === "subscribe") s.subscribed = true;
    });
    socket.on("close", () => {
      speakers.delete(s);
      const m = s.member;
      if (m && ![...speakers].some((o) => o.member?.run === m.run && o.member.name === m.name)) linked(m, false);
      for (const [id, rec] of calls) if (rec.speaker === s && rec.answer === null && rec.cancelWait) dropWait(id);
    });
  });
  const port = await listen(httpServer, host, opts.port ?? 0);
  const state = { pid: process.pid, port, secret, version };
  const stateFile = serverStateFile(opts.dataRoot);
  fs8.mkdirSync(opts.dataRoot, { recursive: true });
  fs8.writeFileSync(stateFile, JSON.stringify(state));
  const stopTellingReaders = board2.onChange((repo) => {
    for (const s of speakers) if (s.subscribed) send(s, { type: "changed", repo });
  });
  const upkeep = setInterval(() => {
    const at = now();
    logged("upkeep", () => board2.upkeepIfDue(at));
    logged("liveness", () => {
      for (const r of board2.runs()) logged(`liveness of run ${r.id}`, () => board2.livenessTick(r.id, at, presenceIn(r.id)));
    });
    const t = Date.now();
    for (const [id, rec] of calls) if (rec.answer !== null && t - rec.answeredAt > RESULT_CACHE_MS) calls.delete(id);
  }, UPKEEP_LOOK_MS);
  const ping = setInterval(() => {
    const t = Date.now();
    for (const s of speakers) {
      if (t - s.lastPong > PONG_WITHIN_MS) s.socket.terminate();
      else s.socket.ping();
    }
  }, PING_EVERY_MS);
  let closing = null;
  const close = () => closing ??= (async () => {
    clearInterval(upkeep);
    clearInterval(ping);
    stopTellingReaders();
    for (const s of speakers) refuse(s, "shutdown");
    for (const id of [...calls.keys()]) dropWait(id);
    const wssClosed = new Promise((r) => wss.close(() => r()));
    const cut = setTimeout(() => wss.clients.forEach((c) => c.terminate()), CLOSE_GRACE_MS);
    await wssClosed;
    clearTimeout(cut);
    await new Promise((r) => httpServer.close(() => r()));
    board2.close();
    try {
      const written = JSON.parse(fs8.readFileSync(stateFile, "utf8"));
      if (written.pid === state.pid && written.port === state.port) fs8.rmSync(stateFile);
    } catch {
    }
    releaseStartLock(opts.dataRoot);
    closedListeners.forEach((l) => l());
  })();
  const closedListeners = [];
  serversClosed.set(stateFile, closedListeners);
  return { url: `ws://${host}:${port}`, close };
}
function onBoardServerClosed(dataRoot, then) {
  serversClosed.get(serverStateFile(dataRoot))?.push(then);
}
async function stopBoardServer(dataRoot) {
  const file = serverStateFile(dataRoot);
  let state;
  try {
    state = JSON.parse(fs8.readFileSync(file, "utf8"));
  } catch {
    return false;
  }
  try {
    const res = await fetch(`http://127.0.0.1:${state.port}${STOP_PATH}`, { method: "POST", headers: { [SECRET_HEADER]: state.secret } });
    if (!res.ok) throw new Error(`refused ${res.status}`);
  } catch {
    fs8.rmSync(file, { force: true });
    const holder = serverLockHolder(dataRoot);
    if (holder !== null && liveStartLockHolder(dataRoot) === null) fs8.rmSync(serverStartLock(dataRoot), { force: true });
    return false;
  }
  for (let i = 0; i < 100 && fs8.existsSync(file); i++) await new Promise((r) => setTimeout(r, 50));
  return true;
}
function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (e) => {
      if (e.code === "EADDRINUSE" && port !== 0) {
        server.off("error", onError);
        resolve(listen(server, host, 0));
      } else reject(e);
    };
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve(server.address().port);
    });
  });
}
var RESULT_CACHE_MS, UPKEEP_LOOK_MS, PING_EVERY_MS, PONG_WITHIN_MS, STOP_PATH, SECRET_HEADER, CLOSE_GRACE_MS, CALLABLE, LOCK_READ_RETRY_MS, LOCK_READ_RETRIES, BREAKER_STALE_MS, serversClosed;
var init_server = __esm({
  "src/server/server.ts"() {
    "use strict";
    init_wrapper();
    init_board();
    init_wire();
    RESULT_CACHE_MS = 10 * 60 * 1e3;
    UPKEEP_LOOK_MS = 1e3;
    PING_EVERY_MS = 10 * 1e3;
    PONG_WITHIN_MS = 25 * 1e3;
    STOP_PATH = "/stop";
    SECRET_HEADER = "x-swarm-secret";
    CLOSE_GRACE_MS = 500;
    CALLABLE = new Set(RPC_METHODS);
    LOCK_READ_RETRY_MS = 50;
    LOCK_READ_RETRIES = 20;
    BREAKER_STALE_MS = 5e3;
    serversClosed = /* @__PURE__ */ new Map();
  }
});

// src/cli/index.ts
init_board();
init_kinds();
init_events();
init_home();
import { spawnSync as spawnSync3 } from "node:child_process";
import fs9 from "node:fs";
import path9 from "node:path";

// src/client/remote.ts
init_wire();
import { spawn } from "node:child_process";
import crypto3 from "node:crypto";
import fs6 from "node:fs";
import net2 from "node:net";
import path6 from "node:path";

// src/link/link.ts
init_wire();
import crypto2 from "node:crypto";
import fs5 from "node:fs";
import net from "node:net";
import os3 from "node:os";
import path5 from "node:path";

// src/link/transcripts.ts
init_liveness();
import fs4 from "node:fs";
import os2 from "node:os";
import path4 from "node:path";
var TARGET_CHARS = 50;
var SEPARATORS = /* @__PURE__ */ new Set([";", "&&", "||", "|", "&", "\n"]);
function shellWords(command, backslashEscapes = true) {
  const words = [];
  let word2 = "";
  let inWord = false;
  const flush = () => {
    if (inWord) words.push(word2);
    word2 = "";
    inWord = false;
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === "'" || c === '"') {
      const close = command.indexOf(c, i + 1);
      const end = close < 0 ? command.length : close;
      word2 += command.slice(i + 1, end);
      inWord = true;
      i = end;
    } else if (backslashEscapes && c === "\\" && i + 1 < command.length && command[i + 1] !== "\n") {
      word2 += command[++i];
      inWord = true;
    } else if (c === ";" || c === "\n" || c === "|" || c === "&") {
      flush();
      const two = command.slice(i, i + 2);
      if (two === "&&" || two === "||") {
        words.push(two);
        i++;
      } else words.push(c);
    } else if (/\s/.test(c)) flush();
    else {
      word2 += c;
      inWord = true;
    }
  }
  flush();
  return words;
}
var isSwarmTool = (word2) => /(^|[\\/])swarm(\.mjs)?$/i.test(word2) || /^\$\{?\w+\}?$/.test(word2);
function flagValue(words, names) {
  for (let i = 0; i < words.length; i++) {
    for (const n of names) {
      if (words[i] === n && i + 1 < words.length) return words[i + 1];
      if (words[i].startsWith(n + "=")) return words[i].slice(n.length + 1);
    }
  }
  return void 0;
}
function commandRunsWait(command, backslashEscapes = true) {
  return commandRunsVerb(command, "wait", backslashEscapes);
}
var toolEscapesBackslash = (toolName) => toolName === void 0 || toolName === "Bash";
function commandRunsVerb(command, verb, backslashEscapes) {
  const words = shellWords(command, backslashEscapes);
  return words.some((w, i) => w === verb && i > 0 && isSwarmTool(words[i - 1]));
}
var commandIsBoardsOwn = (command, backslashEscapes) => commandRunsVerb(command, "wait", backslashEscapes) || commandRunsVerb(command, "link", backslashEscapes);
function commandRunsBinding(command, binding, backslashEscapes = true) {
  const words = shellWords(command, backslashEscapes);
  let start = 0;
  for (let i = 0; i <= words.length; i++) {
    if (i < words.length && !SEPARATORS.has(words[i])) continue;
    const segment = words.slice(start, i);
    start = i + 1;
    const at = segment.indexOf(binding.verb);
    if (at < 1 || !isSwarmTool(segment[at - 1])) continue;
    const args2 = segment.slice(at + 1);
    if (binding.verb === "join") {
      if (flagValue(args2, ["--run"]) === String(binding.run) && flagValue(args2, ["--seat"]) === binding.seat) return true;
    } else if (flagValue(args2, ["--group", "--plan"]) === binding.group) return true;
  }
  return false;
}
function transcriptRunsBinding(file, binding) {
  let text;
  try {
    text = fs4.readFileSync(file, "utf8");
  } catch {
    return false;
  }
  const value = binding.verb === "join" ? binding.seat : binding.group;
  if (!text.includes(binding.verb) || !text.includes(value) || !text.includes('"tool_use"')) return false;
  for (const line of text.split("\n")) {
    if (!line.includes('"tool_use"') || !line.includes(binding.verb)) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.type !== "assistant" || !Array.isArray(obj.message?.content)) continue;
    for (const part of obj.message.content) {
      if (part?.type === "tool_use" && typeof part.input?.command === "string" && commandRunsBinding(part.input.command, binding, toolEscapesBackslash(part.name))) return true;
    }
  }
  return false;
}
var metaFileOf = (transcript) => transcript.replace(/\.jsonl$/, ".meta.json");
var mtimeOf = (file) => {
  try {
    return fs4.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
};
var claudeCode = {
  name: "claude-code",
  locate(binding, env) {
    const session = env.CLAUDE_CODE_SESSION_ID;
    if (!session) return null;
    const root = env.SWARM_TRANSCRIPTS_ROOT || path4.join(env.USERPROFILE || env.HOME || os2.homedir(), ".claude", "projects");
    let projects;
    try {
      projects = fs4.readdirSync(root);
    } catch {
      return null;
    }
    const candidates = [];
    for (const project of projects) {
      const main2 = path4.join(root, project, `${session}.jsonl`);
      if (fs4.existsSync(main2)) candidates.push(main2);
      const subagents = path4.join(root, project, session, "subagents");
      let names = [];
      try {
        names = fs4.readdirSync(subagents);
      } catch {
      }
      for (const n of names) if (/^agent-.*\.jsonl$/.test(n)) candidates.push(path4.join(subagents, n));
    }
    const newestFirst = candidates.map((file) => ({ file, mtime: mtimeOf(file) })).sort((a, b) => b.mtime - a.mtime);
    for (const { file } of newestFirst) {
      if (this.finished(file) === true) continue;
      if (transcriptRunsBinding(file, binding)) return file;
    }
    return null;
  },
  finished(transcript) {
    let text;
    try {
      text = fs4.readFileSync(metaFileOf(transcript), "utf8");
    } catch {
      return null;
    }
    try {
      return JSON.parse(text).finished === true;
    } catch {
      return false;
    }
  }
};
var LOCATORS = [claudeCode];
function locate(binding, env) {
  for (const l of LOCATORS) {
    const found = l.locate(binding, env);
    if (found) return found;
  }
  return null;
}
function toolTarget(input) {
  let text = "";
  if (input && typeof input === "object") {
    const fields = input;
    for (const k of ["command", "file_path", "path", "pattern", "url", "query", "description", "prompt"]) {
      if (typeof fields[k] === "string") {
        text = fields[k];
        break;
      }
    }
    if (!text) text = JSON.stringify(input);
  } else if (input !== void 0) text = String(input);
  return text.replace(/\s+/g, " ").trim().slice(0, TARGET_CHARS);
}
var timeOf = (line, fallback) => {
  const t = typeof line.timestamp === "string" ? Date.parse(line.timestamp) : NaN;
  return Number.isFinite(t) ? t : fallback;
};
var freshCursor = () => ({
  offset: 0,
  tokens: 0,
  open: /* @__PURE__ */ new Map(),
  lastTool: null,
  context: null,
  grewAt: null,
  lastLine: null,
  inTurn: false,
  endedTurns: 0,
  background: /* @__PURE__ */ new Map(),
  boardsOwn: /* @__PURE__ */ new Set(),
  breach: null
});
var KILL_HEADS = /* @__PURE__ */ new Set(["taskkill", "kill", "pkill", "killall", "stop-process", "spps", "wmic", "invoke-cimmethod", "fuser"]);
var WRAPPER = /^(sudo|xargs|cmd(\.exe)?|\/c|start|call|exec|nohup|foreach-object|%|do|then|-\S+|\d+)$/i;
var PATTERN_FEED = /\b(Get-Process|gps|Get-CimInstance|Get-WmiObject|gwmi|tasklist|pgrep|wmic)\b|(^|[\s|;&(])ps(\s|$)/i;
var PORT_FEED = /\b(Get-NetTCPConnection|netstat|lsof|fuser)\b|(^|[\s|;&(])ss\s/i;
var RUNS_QUOTED = /(?:-command|-c|(?:^|\s)(?:powershell|pwsh|bash|sh|cmd)(?:\.exe)?(?:\s+-\S+)*)\s*$/i;
function commandSegments(text) {
  const out = [];
  let cur = "";
  const flush = () => {
    if (cur.trim()) out.push(cur.trim());
    cur = "";
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const close = text.indexOf(c, i + 1);
      const end = close < 0 ? text.length : close;
      const inner = text.slice(i + 1, end);
      if (RUNS_QUOTED.test(cur)) {
        flush();
        out.push(...commandSegments(inner));
      } else cur += ` "${inner.replace(/\s+/g, " ")}" `;
      i = end;
    } else if (";|&\n(){}`".includes(c) || c === "$" && text[i + 1] === "(") flush();
    else cur += c;
  }
  flush();
  return out;
}
function headOf(segment) {
  const words = segment.split(/\s+/).filter(Boolean);
  while (words.length > 1 && WRAPPER.test(words[0])) words.shift();
  if (!words.length) return null;
  const head = words[0].replace(/^.*[\\/]/, "").replace(/\.exe$/i, "").toLowerCase();
  return { head, rest: words.slice(1).join(" ") };
}
function portsOf(command) {
  const found = /* @__PURE__ */ new Set();
  for (const m of command.matchAll(/-LocalPort\s+([\d,\s]+)/gi)) for (const n of m[1].split(/[,\s]+/)) if (n) found.add(Number(n));
  for (const m of command.matchAll(/(?::|-iTCP:)(\d{2,5})\b|\b(\d{2,5})\/tcp\b/gi)) found.add(Number(m[1] ?? m[2]));
  return [...found].filter((n) => n > 0 && n < 65536).sort((a, b) => a - b);
}
function classifyKill(command) {
  if (/(^|[\s\\/"'])swarm(\.mjs)?(["'\s]|$)/i.test(command)) return null;
  let kill = null;
  for (const segment of commandSegments(command)) {
    const h = headOf(segment);
    if (!h || !KILL_HEADS.has(h.head)) continue;
    const { head, rest } = h;
    if (head === "pkill" || head === "killall") kill = "name";
    else if (head === "taskkill") kill = /\/IM\b/i.test(rest) ? "name" : /\/PID\s+\d+(\s|$)/i.test(rest) && !/[$%]/.test(rest) ? kill ?? null : "fed";
    else if (head === "stop-process" || head === "spps") kill = /-Name\b|-ProcessName\b/i.test(rest) ? "name" : /-Id\s+[\d,\s]+$/i.test(rest) ? kill ?? null : "fed";
    else if (head === "kill") kill = rest.split(/\s+/).every((w) => /^(-\d+|-[A-Z]+|-s|\d+)$/.test(w)) ? kill ?? null : "fed";
    else if (head === "wmic") kill = /\b(delete|terminate)\b/i.test(rest) ? "name" : kill;
    else if (head === "invoke-cimmethod") kill = /terminate/i.test(rest) ? "fed" : kill;
    else if (head === "fuser") kill = /(^|\s)-k\b/.test(rest) ? "fed" : kill;
    if (kill === "name") break;
  }
  if (kill === "name") return { kind: "pattern" };
  if (kill !== "fed") return null;
  if (PATTERN_FEED.test(command)) return { kind: "pattern" };
  if (PORT_FEED.test(command)) return { kind: "port", ports: portsOf(command) };
  return null;
}
var MOVED_TO_BACKGROUND = /^\s*(Command running in background with ID:|Command did not complete within its .{0,40}?moved to the background \(ID:)/;
var OUTPUT_FILE = /Output is being written to: (.+?)(?=\.\s|\.?\s*$)/m;
var NOTIFIED_TOOL_USE = /<task-notification>[\s\S]*?<tool-use-id>([^<\s]+)<\/tool-use-id>/g;
function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((p) => typeof p === "string" ? p : p && typeof p === "object" && typeof p.text === "string" ? p.text : "").join("\n");
}
function closeNotified(cursor, text) {
  if (!text.includes("<task-notification>")) return;
  for (const m of text.matchAll(NOTIFIED_TOOL_USE)) cursor.background.delete(m[1]);
}
function awaitedBackground(cursor) {
  const latestTurn = cursor.inTurn ? cursor.endedTurns : cursor.endedTurns - 1;
  let oldest = null;
  for (const t of cursor.background.values()) if (t.turn === latestTurn && (!oldest || t.since < oldest.since)) oldest = t;
  if (!oldest) return null;
  let outputGrewAt = null;
  if (oldest.output) {
    try {
      outputGrewAt = fs4.statSync(oldest.output).mtimeMs;
    } catch {
    }
  }
  return { target: oldest.target, since: oldest.since, outputGrewAt };
}
function observe(transcript, from) {
  let cursor = from ? { ...from, open: new Map(from.open), background: new Map(from.background), boardsOwn: new Set(from.boardsOwn), breach: from.breach ?? null } : freshCursor();
  let chunk = Buffer.alloc(0);
  let mtime = Date.now();
  try {
    const fd = fs4.openSync(transcript, "r");
    try {
      const stat = fs4.fstatSync(fd);
      mtime = stat.mtimeMs;
      if (stat.size < cursor.offset) cursor = freshCursor();
      chunk = Buffer.alloc(stat.size - cursor.offset);
      fs4.readSync(fd, chunk, 0, chunk.length, cursor.offset);
    } finally {
      fs4.closeSync(fd);
    }
  } catch {
    cursor = freshCursor();
  }
  const counted = claudeCodeJsonl.read(chunk, { offset: cursor.offset, tokens: cursor.tokens });
  const consumed = (counted?.offset ?? cursor.offset) - cursor.offset;
  if (consumed > 0) {
    for (const raw of chunk.subarray(0, consumed).toString("utf8").split("\n")) {
      if (!raw.trim()) continue;
      let line;
      try {
        line = JSON.parse(raw);
      } catch {
        continue;
      }
      if (line.attachment?.commandMode === "task-notification" && typeof line.attachment.prompt === "string") closeNotified(cursor, line.attachment.prompt);
      if (line.type !== "assistant" && line.type !== "user") continue;
      const at = timeOf(line, mtime);
      const content = Array.isArray(line.message?.content) ? line.message.content : [];
      if (line.type === "assistant") {
        const usage = line.message?.usage;
        if (usage) {
          const n = (k) => typeof usage[k] === "number" ? usage[k] : 0;
          cursor.context = n("input_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens");
        }
        for (const part of content) {
          if (part?.type === "text" && typeof part.text === "string" && part.text.trim()) cursor.lastLine = part.text.replace(/\s+/g, " ").trim().slice(0, TARGET_CHARS);
          if (part?.type !== "tool_use" || typeof part.id !== "string") continue;
          const name = part.name ?? "?";
          const target = toolTarget(part.input);
          const input = part.input;
          const command = input?.command;
          const escapes = toolEscapesBackslash(name);
          const boardWait = typeof command === "string" && commandRunsWait(command, escapes);
          const shell = typeof command === "string";
          cursor.open.set(part.id, { name, target, since: at, ...boardWait ? { boardWait } : {}, ...shell ? { shell } : {} });
          cursor.lastTool = target ? `${name} ${target}` : name;
          cursor.lastLine = cursor.lastTool;
          const boardsOwn = typeof command === "string" && commandIsBoardsOwn(command, escapes);
          if (boardsOwn) cursor.boardsOwn.add(part.id);
          else if (input?.run_in_background === true) cursor.background.set(part.id, { target, since: at, turn: cursor.endedTurns, output: null });
          const kill = typeof command === "string" ? classifyKill(command) : null;
          if (kill) cursor.breach = { command: command.replace(/\s+/g, " ").trim(), ...kill, at };
        }
        const inTurn = line.message?.stop_reason === "tool_use";
        if (cursor.inTurn && !inTurn) cursor.endedTurns++;
        cursor.inTurn = inTurn;
      } else {
        if (typeof line.message?.content === "string") closeNotified(cursor, line.message.content);
        for (const part of content) {
          if (part?.type === "text" && typeof part.text === "string") closeNotified(cursor, part.text);
          if (part?.type !== "tool_result" || typeof part.tool_use_id !== "string") continue;
          const result = textOf(part.content);
          const call = cursor.open.get(part.tool_use_id);
          if (MOVED_TO_BACKGROUND.test(result)) {
            const output = OUTPUT_FILE.exec(result)?.[1]?.trim() ?? null;
            const task = cursor.background.get(part.tool_use_id);
            if (task) cursor.background.set(part.tool_use_id, { ...task, output });
            else if (call && !cursor.boardsOwn.has(part.tool_use_id))
              cursor.background.set(part.tool_use_id, { target: call.target, since: call.since, turn: cursor.endedTurns, output });
          }
          cursor.open.delete(part.tool_use_id);
          cursor.boardsOwn.delete(part.tool_use_id);
        }
        cursor.inTurn = true;
      }
    }
    cursor.offset += consumed;
    cursor.tokens = counted.tokens;
    cursor.grewAt = mtime;
  }
  let openTool = null;
  for (const t of cursor.open.values()) if (!openTool || t.since < openTool.since) openTool = t;
  let finished = false;
  for (const l of LOCATORS) {
    const said = l.finished(transcript);
    if (said !== null) {
      finished = said;
      break;
    }
  }
  return {
    activity: {
      grewAt: cursor.grewAt,
      tokens: cursor.tokens,
      context: cursor.context,
      openTool: openTool && { ...openTool },
      lastTool: cursor.lastTool,
      finished,
      inTurn: cursor.inTurn,
      lastLine: cursor.lastLine,
      background: awaitedBackground(cursor),
      breach: cursor.breach
    },
    cursor
  };
}

// src/link/link.ts
var DEFAULT_TIMING = { reconnectGiveUpMs: 6e4, reconnectEveryMs: 500, idleMs: 2 * 60 * 6e4, stateFileWaitMs: 5e3, watchEveryMs: 1e3, activityGapMs: 3e3 };
function linkPipe(dataRoot, run2, member) {
  const home = crypto2.createHash("sha256").update(path5.resolve(dataRoot)).digest("hex").slice(0, 12);
  const name = `swarm-${home}-${run2}-${member.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  return process.platform === "win32" ? `\\\\.\\pipe\\${name}` : path5.join(os3.tmpdir(), `${name}.sock`);
}
function readServerState(dataRoot) {
  try {
    return JSON.parse(fs5.readFileSync(serverStateFile(dataRoot), "utf8"));
  } catch {
    return null;
  }
}
function describeStop(stop) {
  if (stop.why === "refused") return `refused ${stop.reason}`;
  if (stop.why === "no server") return `no server for ${Math.round(stop.forMs / 1e3)} s`;
  if (stop.why === "closed") return "run closed";
  return stop.why;
}
function sayStop(dataRoot, member, stop, toServerLog) {
  const line = `link ${member}: ${describeStop(stop)}`;
  process.stderr.write(line + "\n");
  const state = toServerLog ? readServerState(dataRoot) : null;
  if (!state || !isAlive(state.pid)) return;
  try {
    fs5.appendFileSync(serverLogFile(dataRoot), line + "\n");
  } catch {
  }
}
var pause = (ms2) => new Promise((r) => setTimeout(r, ms2));
var pipeAnswers = (pipe) => new Promise((resolve) => {
  const probe = net.connect(pipe, () => (probe.destroy(), resolve(true)));
  probe.once("error", () => resolve(false));
});
async function listenOnPipe(pipe, onPipe) {
  if (await pipeAnswers(pipe)) return null;
  const tryListen = () => new Promise((resolve) => {
    const server = net.createServer(onPipe);
    server.once("error", () => resolve("taken"));
    server.listen(pipe, () => resolve(server));
  });
  const first = await tryListen();
  if (first !== "taken") return first;
  if (process.platform === "win32" || await pipeAnswers(pipe)) return null;
  fs5.rmSync(pipe, { force: true });
  const second = await tryListen();
  return second === "taken" ? null : second;
}
async function runLink(opts) {
  const timing = { ...DEFAULT_TIMING, ...opts.timing };
  const pipeTaken = () => {
    const stop = { why: "pipe taken" };
    sayStop(opts.dataRoot, opts.member, stop, false);
    return stop;
  };
  if (await pipeAnswers(linkPipe(opts.dataRoot, opts.run, opts.member))) return pipeTaken();
  let state = readServerState(opts.dataRoot);
  for (const startedAt = Date.now(); !state && Date.now() - startedAt < timing.stateFileWaitMs; ) {
    await pause(100);
    state = readServerState(opts.dataRoot);
  }
  if (!state) throw new Error(`no board server state file in ${opts.dataRoot}`);
  const unanswered = /* @__PURE__ */ new Map();
  const pipes = /* @__PURE__ */ new Set();
  let socket = null;
  let welcomed = false;
  let exiting = false;
  let lastStirAt = Date.now();
  let finish;
  const finished = new Promise((r) => finish = r);
  const sendUp = (f) => {
    if (socket && welcomed && socket.readyState === WebSocket.OPEN) socket.send(encode(f));
  };
  let queuedActivity = null;
  let lastActivitySentAt = -Infinity;
  const flushActivity = (now = false) => {
    if (!queuedActivity || !socket || !welcomed || socket.readyState !== WebSocket.OPEN) return;
    if (!now && (socket.bufferedAmount > 0 || Date.now() - lastActivitySentAt < timing.activityGapMs)) return;
    socket.send(encode(queuedActivity));
    lastActivitySentAt = Date.now();
    queuedActivity = null;
  };
  let transcript = null;
  let cursor = null;
  let lastSeen = null;
  const env = opts.env ?? process.env;
  const watchTranscript = () => {
    if (exiting) return;
    transcript ??= locate(opts.binding, env);
    if (!transcript) return;
    const read = observe(transcript, cursor);
    const grew = read.cursor.offset !== cursor?.offset;
    cursor = read.cursor;
    if (grew) lastStirAt = Date.now();
    const activity = { ...read.activity, transcript };
    const seen = JSON.stringify(activity);
    if (seen !== lastSeen) {
      lastSeen = seen;
      queuedActivity = { type: "activity", at: Date.now(), activity };
    }
    if (read.activity.finished) {
      flushActivity(true);
      return exit({ why: "finished" }, "finished");
    }
    flushActivity();
  };
  const exit = (stop, bye) => {
    if (exiting) return;
    exiting = true;
    if (bye) sendUp({ type: "bye", reason: bye });
    sayStop(opts.dataRoot, opts.member, stop, stop.why !== "no server");
    clearInterval(idleCheck);
    clearInterval(watch);
    pipeServer?.close();
    for (const p of pipes) p.end();
    socket?.close();
    finish(stop);
  };
  const onDown = (f) => {
    if (f.type === "welcome") {
      welcomed = true;
      for (const { call } of unanswered.values()) sendUp(call);
      flushActivity();
    } else if (f.type === "refused") {
      exit(f.reason === "closed" ? { why: "closed" } : { why: "refused", reason: f.reason });
    } else if (f.type === "result") {
      const asked = unanswered.get(f.id);
      if (!asked) return;
      unanswered.delete(f.id);
      if (!asked.pipe.destroyed) asked.pipe.write(encode(f) + "\n");
      if (asked.call.method === "end" && f.ok) exit({ why: "ended" }, "ended");
    }
  };
  const connectOnce = (s) => new Promise((resolve) => {
    welcomed = false;
    let wasWelcomed = false;
    let ws;
    try {
      ws = new WebSocket(`ws://127.0.0.1:${s.port}`);
    } catch {
      return resolve(false);
    }
    socket = ws;
    ws.onopen = () => ws.send(encode({ type: "hello", version: bundleVersion(), secret: s.secret, member: { name: opts.member, run: opts.run }, supersede: true }));
    ws.onmessage = (ev) => {
      try {
        onDown(decode(String(ev.data)));
      } catch {
      }
      wasWelcomed ||= welcomed;
    };
    ws.onclose = () => {
      welcomed = false;
      resolve(wasWelcomed);
    };
    ws.onerror = () => {
    };
  });
  const connectionLoop = async () => {
    let lastAnsweredAt = Date.now();
    let s = state;
    while (!exiting) {
      if (s) {
        const welcomedThisTime = await connectOnce(s);
        if (exiting) return;
        if (welcomedThisTime) lastAnsweredAt = Date.now();
      }
      if (Date.now() - lastAnsweredAt >= timing.reconnectGiveUpMs) return exit({ why: "no server", forMs: Date.now() - lastAnsweredAt });
      await pause(timing.reconnectEveryMs);
      s = readServerState(opts.dataRoot);
    }
  };
  const onPipe = (pipe) => {
    pipes.add(pipe);
    let buffered = "";
    pipe.setEncoding("utf8");
    pipe.on("data", (chunk) => {
      buffered += chunk;
      for (let nl = buffered.indexOf("\n"); nl >= 0; nl = buffered.indexOf("\n")) {
        const line = buffered.slice(0, nl).trim();
        buffered = buffered.slice(nl + 1);
        if (!line) continue;
        let f;
        try {
          f = decode(line);
        } catch {
          continue;
        }
        if (f.type === "call") {
          lastStirAt = Date.now();
          unanswered.set(f.id, { call: f, pipe });
          sendUp(f);
        } else if (f.type === "cancel") {
          unanswered.delete(f.id);
          sendUp(f);
        }
      }
    });
    pipe.on("error", () => {
    });
    pipe.on("close", () => {
      pipes.delete(pipe);
      for (const [id, asked] of unanswered) {
        if (asked.pipe !== pipe) continue;
        unanswered.delete(id);
        if (asked.call.method === "wait") sendUp({ type: "cancel", id });
      }
    });
  };
  const pipeServer = await listenOnPipe(linkPipe(opts.dataRoot, opts.run, opts.member), onPipe);
  if (!pipeServer) return pipeTaken();
  const idleCheck = setInterval(() => {
    if (unanswered.size === 0 && Date.now() - lastStirAt >= timing.idleMs) exit({ why: "idle" }, "idle");
  }, Math.min(6e4, Math.max(10, Math.floor(timing.idleMs / 4))));
  const watch = setInterval(watchTranscript, timing.watchEveryMs);
  if (state.version !== bundleVersion()) exit({ why: "server of another version" });
  if (!exiting) {
    void connectionLoop();
    watchTranscript();
  }
  return finished;
}

// src/client/remote.ts
var START_TIMEOUT_MS = 5e3;
var START_POLL_MS = 50;
var entry = () => [process.argv[1]];
var homeEnv = (dataRoot) => ({ ...process.env, SWARMSTORM_HOME: dataRoot });
var pause2 = (ms2) => new Promise((r) => setTimeout(r, ms2));
function isAlive2(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}
function readServerState2(dataRoot) {
  try {
    const s = JSON.parse(fs6.readFileSync(serverStateFile(dataRoot), "utf8"));
    return Number.isInteger(s.pid) && Number.isInteger(s.port) ? s : null;
  } catch {
    return null;
  }
}
var isCurrent = (s, swarmEntry) => !!s && s.version === bundleVersion(swarmEntry) && isAlive2(s.pid);
async function ensureServer(dataRoot, swarmEntry = entry()[0]) {
  const found = readServerState2(dataRoot);
  if (found && isCurrent(found, swarmEntry)) return found;
  if (found && found.pid !== process.pid && isAlive2(found.pid)) {
    try {
      process.kill(found.pid);
    } catch {
    }
    for (const until = Date.now() + START_TIMEOUT_MS; isAlive2(found.pid) && Date.now() < until; ) await pause2(START_POLL_MS);
  }
  const startedElsewhere = () => liveStartLockHolder(dataRoot) !== null;
  let exited = null;
  if (!startedElsewhere()) {
    let log = "ignore";
    try {
      fs6.mkdirSync(dataRoot, { recursive: true });
      fs6.writeFileSync(serverLogFile(dataRoot), "");
      log = fs6.openSync(serverLogFile(dataRoot), "a");
    } catch {
    }
    const child = spawn(process.execPath, [swarmEntry, "serve"], { detached: true, stdio: ["ignore", log, log], windowsHide: true, env: { ...homeEnv(dataRoot), [SERVER_STARTER_ENV]: process.argv.join(" ") } });
    child.on("exit", (code, signal) => exited = signal ? `it was killed by ${signal}` : `it exited with code ${code}`);
    child.on("error", (e) => exited = e.message);
    child.unref();
    if (typeof log === "number") fs6.closeSync(log);
  }
  for (const until = Date.now() + START_TIMEOUT_MS; Date.now() < until; ) {
    const s = readServerState2(dataRoot);
    if (s && isCurrent(s, swarmEntry)) return s;
    if (exited && !startedElsewhere()) break;
    await pause2(START_POLL_MS);
  }
  let said = "";
  try {
    const lines = fs6.readFileSync(serverLogFile(dataRoot), "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    said = lines.find((l) => /^(\w*Error|swarm\b)[^:]*:/.test(l)) ?? lines.filter((l) => !/^Node\.js v/.test(l)).pop() ?? "";
  } catch {
  }
  const reason = said || exited || `it did not answer within ${START_TIMEOUT_MS / 1e3} s`;
  throw new Error(`swarm: the board server did not start: ${reason}; run swarm serve to see it`);
}
function bindingOf(member) {
  const [group, id] = splitMember(member.name);
  return id === "orchestrator" ? { verb: "open", group } : { verb: "join", run: member.run, seat: id };
}
function splitMember(name) {
  const at = name.lastIndexOf("/");
  return [name.slice(0, at), name.slice(at + 1)];
}
function connectPipe(pipe) {
  return new Promise((resolve) => {
    const s = net2.createConnection(pipe);
    s.once("connect", () => {
      s.removeAllListeners("error");
      resolve(s);
    });
    s.once("error", () => resolve(null));
  });
}
var linkVerbArgs = (member) => ["link", "--run", String(member.run), "--as", member.name];
var HARNESS_LINK_WAIT_MS = 1e4;
var LINK_DOWN_WAIT_MS = 1e3;
var linkDownMarker = (dataRoot, member) => path6.join(dataRoot, "link-down", `${member.run}-${member.name.replace(/[^A-Za-z0-9_-]/g, "_")}`);
var inHarnessSession = (env = process.env) => !!env.CLAUDE_CODE_SESSION_ID;
async function openLinkPipe(dataRoot, member, harnessWaitMs, downWaitMs = LINK_DOWN_WAIT_MS) {
  const pipe = linkPipe(dataRoot, member.run, member.name);
  const marker = linkDownMarker(dataRoot, member);
  const answered = (s) => {
    try {
      fs6.rmSync(marker, { force: true });
    } catch {
    }
    return s;
  };
  const there = await connectPipe(pipe);
  if (there) return answered(there);
  if (harnessWaitMs != null) {
    const wait = fs6.existsSync(marker) ? Math.min(harnessWaitMs, downWaitMs) : harnessWaitMs;
    for (const until = Date.now() + wait; Date.now() < until; ) {
      await pause2(START_POLL_MS);
      const s = await connectPipe(pipe);
      if (s) return answered(s);
    }
    try {
      fs6.mkdirSync(path6.dirname(marker), { recursive: true });
      fs6.writeFileSync(marker, String(Date.now()));
    } catch {
    }
    return null;
  }
  const child = spawn(process.execPath, [...entry(), ...linkVerbArgs(member)], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: homeEnv(dataRoot)
  });
  child.on("error", () => {
  });
  child.unref();
  for (const until = Date.now() + START_TIMEOUT_MS; Date.now() < until; ) {
    const s = await connectPipe(pipe);
    if (s) return s;
    await pause2(START_POLL_MS);
  }
  throw new Error(`swarm: ${member.name}'s link did not start`);
}
function lineFrames(sock, onFrame) {
  let buf = "";
  sock.setEncoding("utf8");
  sock.on("data", (chunk) => {
    buf += chunk;
    for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onFrame(decode(line));
    }
  });
}
function callsOver(firstSend) {
  let send = firstSend;
  const pending = /* @__PURE__ */ new Map();
  let next = 0;
  const callPrefix = crypto3.randomUUID();
  let closed = null;
  return {
    call(method, args2) {
      if (closed) return Promise.reject(new Error(closed));
      const id = `${callPrefix}-${++next}`;
      const given = [...args2];
      while (given.length && given[given.length - 1] === void 0) given.pop();
      const frame = { type: "call", id, method, args: given };
      return new Promise((resolve, reject) => {
        pending.set(id, { call: frame, resolve, reject });
        send(frame);
      });
    },
    settle(f) {
      if (f.type === "result") {
        const p = pending.get(f.id);
        if (!p) return;
        pending.delete(f.id);
        if (f.ok) p.resolve(f.value);
        else p.reject(new Error(f.error));
      } else if (f.type === "refused") this.fail(`swarm: the board refused the connection: ${f.reason}`);
    },
    fail(why) {
      closed ??= why;
      for (const p of pending.values()) p.reject(new Error(closed));
      pending.clear();
    },
    reroute(to) {
      send = to;
      for (const p of pending.values()) send(p.call);
    }
  };
}
async function connectServer(state) {
  const ws = new WebSocket(`ws://127.0.0.1:${state.port}`);
  let handler = () => {
  };
  let closer = () => {
  };
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", () => ws.send(encode({ type: "hello", version: state.version, secret: state.secret })), { once: true });
    ws.addEventListener("message", (ev) => {
      const f = decode(String(ev.data));
      if (f.type === "welcome") resolve();
      else if (f.type === "refused") reject(new Error(`swarm: the board server refused the connection: ${f.reason}`));
      else handler(f);
    });
    ws.addEventListener("error", () => reject(new Error(`swarm: the board server at port ${state.port} does not answer; run swarm serve to see it`)), { once: true });
    ws.addEventListener("close", () => closer());
  });
  return {
    send: (f) => ws.send(encode(f)),
    onFrame: (h) => handler = h,
    onClose: (h) => closer = h,
    close: () => ws.close()
  };
}
function asRemote(call) {
  const board2 = {};
  for (const m of RPC_METHODS) board2[m] = (...a) => call(m, a);
  return board2;
}
async function connectBoard(opts) {
  const state = await ensureServer(opts.dataRoot);
  if (opts.member) {
    const member = opts.member;
    const harness = opts.harness ?? inHarnessSession();
    const sock = await openLinkPipe(opts.dataRoot, member, harness ? opts.harnessWaitMs ?? HARNESS_LINK_WAIT_MS : null);
    if (sock) {
      const calls2 = callsOver((f) => sock.write(`${encode(f)}
`));
      lineFrames(sock, (f) => calls2.settle(f));
      let direct = null;
      let closing = false;
      sock.on("close", () => {
        if (closing) return;
        connectServer(state).then(
          (conn2) => {
            direct = conn2;
            conn2.onFrame((f) => calls2.settle(f));
            conn2.onClose(() => calls2.fail("swarm: the board server closed the connection"));
            calls2.reroute(conn2.send);
          },
          () => calls2.fail(`swarm: ${member.name}'s link closed the pipe`)
        );
      });
      sock.on("error", () => {
      });
      return Object.assign(asRemote(calls2.call), {
        close: () => {
          closing = true;
          sock.destroy();
          direct?.close();
        },
        linkMissing: false
      });
    }
  }
  const conn = await connectServer(state);
  const calls = callsOver(conn.send);
  conn.onFrame((f) => calls.settle(f));
  conn.onClose(() => calls.fail("swarm: the board server closed the connection"));
  return Object.assign(asRemote(calls.call), { close: conn.close, linkMissing: !!opts.member });
}

// src/cli/args.ts
var VALUE_FLAGS = /* @__PURE__ */ new Set([
  "--plan",
  "--title",
  "--run",
  "--area",
  "--state",
  "--doing",
  "--file",
  "--as",
  "--about",
  "--with",
  "--timeout",
  "--repo",
  "--port",
  "--onto",
  "--kind",
  "--group",
  "--seats",
  "--seat",
  "--on",
  "--blockers",
  "--role",
  "--link",
  "--since",
  "--watch",
  "--person",
  "--note",
  "--busy-max",
  "--report"
]);
var LIST_FLAGS = /* @__PURE__ */ new Set(["--files"]);
function parseArgs(argv) {
  const [verb, ...rest] = argv;
  const listed = /* @__PURE__ */ new Set();
  let inList = false;
  rest.forEach((a, i) => {
    if (a.startsWith("--")) inList = LIST_FLAGS.has(a);
    else if (inList) listed.add(i);
  });
  return {
    verb,
    rest,
    positional: rest.filter((a, i) => !a.startsWith("--") && !VALUE_FLAGS.has(rest[i - 1] ?? "") && !listed.has(i)),
    flag: (name) => {
      const i = rest.indexOf(name);
      return i >= 0 ? rest[i + 1] : void 0;
    },
    flags: (name) => rest.flatMap((a, i) => a === name && rest[i + 1] ? [rest[i + 1]] : []),
    list: (name) => {
      const out = [];
      let on = false;
      for (const a of rest) {
        if (a.startsWith("--")) on = a === name;
        else if (on) out.push(...a.split(",").map((x) => x.trim()).filter(Boolean));
      }
      return out;
    },
    has: (name) => rest.includes(name)
  };
}

// src/cli/format.ts
var seqLine = (m) => `#${m.seq}`;
var fullText = (m) => {
  const kind = m.kind === "msg" ? "" : ` (${m.kind})`;
  const about = m.about ? ` about ${m.about}` : "";
  return `#${m.seq} ${m.from}${kind}${about}  ${m.at}
${m.body}${m.answer ? `
${m.answer}` : ""}`;
};

// src/cli/index.ts
init_mentions();

// src/cli/aiview-board.ts
import { spawnSync } from "node:child_process";
import fs7 from "node:fs";
import path7 from "node:path";
function aiviewLauncher(toolRoot2) {
  const file = process.env.SWARM_AIVIEW ?? path7.join(toolRoot2, "..", "aiview", "aiview.mjs");
  return fs7.existsSync(file) ? file : null;
}
var callAiview = (launcher, cwd, argv) => {
  const r = spawnSync(process.execPath, [launcher, ...argv, "--json"], { cwd, encoding: "utf8" });
  if (r.status !== 0) return { ok: false, error: `aiview ${argv[0]} failed: ${(r.stderr || r.stdout).trim()}` };
  try {
    return { ok: true, out: JSON.parse(r.stdout.trim().split("\n").pop() ?? "") };
  } catch {
    return { ok: false, error: `aiview ${argv[0]}: unreadable output ${r.stdout.trim()}` };
  }
};
function boardHome(input) {
  const launcher = aiviewLauncher(input.toolRoot);
  if (!launcher) return { found: false, reason: "aiview not found", launcher: null };
  const status = callAiview(launcher, input.cwd, ["status"]);
  if (!status.ok) return { found: false, reason: status.error, launcher: null };
  const project = status.out.cwdProject;
  if (!project) return { found: false, reason: `no aiview project for ${input.cwd}`, launcher };
  return { found: true, launcher, project };
}
function registerBoard(input) {
  const { home } = input;
  if (!home.found) return { registered: false, reason: home.reason };
  const board2 = callAiview(home.launcher, input.cwd, ["board", "--repo", input.repo, "--project", home.project]);
  if (!board2.ok) return { registered: false, reason: board2.error };
  const out = board2.out;
  return { registered: true, url: out.url, repos: out.repos };
}

// src/cli/unclaimed.ts
var SHOWN = 3;
function unclaimedEntries(paths, renames = []) {
  const left = new Set(paths);
  const entries = [];
  for (const [from, to] of renames) {
    if (!left.has(from) && !left.has(to)) continue;
    left.delete(from);
    left.delete(to);
    entries.push(`${from} \u2192 ${to}`);
  }
  return [...paths.filter((p) => left.has(p)), ...entries];
}
function unclaimedLines(paths, renames = []) {
  const entries = unclaimedEntries(paths, renames);
  if (!entries.length) return [];
  const shown = entries.slice(0, SHOWN).join(", ") + (entries.length > SHOWN ? ", \u2026" : "");
  return [`reconciled ${entries.length} written without a claim: ${shown}`];
}

// src/cli/git.ts
import { spawnSync as spawnSync2 } from "node:child_process";
var gitAnswer = (cwd, ...argv) => {
  const r = spawnSync2("git", argv, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { status: r.error ? null : r.status, stdout: r.stdout ?? "" };
};
var git = (cwd, ...argv) => {
  const r = gitAnswer(cwd, ...argv);
  return r.status === 0 ? r.stdout.trim() : null;
};
var worktreeHolding = (cwd, branch) => {
  const list = git(cwd, "worktree", "list", "--porcelain");
  if (!list) return null;
  const ref = branch.startsWith("refs/") ? branch : `refs/heads/${branch}`;
  let at = null;
  for (const line of list.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) at = line.slice("worktree ".length);
    else if (line === `branch ${ref}`) return at;
  }
  return null;
};

// src/cli/conflicts.ts
var MERGE_TREE_SINCE = [2, 38];
var REBASE_START = /^(?:pull --)?rebase(?: -[a-z]+)? \(start\):/;
function gitHasMergeTree(worktree) {
  const m = (git(worktree, "version") ?? "").match(/(\d+)\.(\d+)/);
  if (!m) return false;
  const [major, minor] = [Number(m[1]), Number(m[2])];
  return major > MERGE_TREE_SINCE[0] || major === MERGE_TREE_SINCE[0] && minor >= MERGE_TREE_SINCE[1];
}
function headReflog(worktree) {
  const r = gitAnswer(worktree, "reflog", "show", "--format=%H%x09%gs", "HEAD");
  if (r.status !== 0) return null;
  return r.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const [commit, ...subject] = line.split("	");
    return { commit, subject: subject.join("	") };
  });
}
function headReflogLength(worktree) {
  try {
    return headReflog(worktree)?.length ?? null;
  } catch {
    return null;
  }
}
function conflictsOf(worktree, onto, reflogMark) {
  try {
    if (!gitHasMergeTree(worktree)) return { unknown: "old-git" };
    const reflog = headReflog(worktree);
    if (!reflog || reflog.length < reflogMark) return { unknown: "no-reflog" };
    const start = reflog.slice(0, reflog.length - reflogMark).findIndex((e) => REBASE_START.test(e.subject));
    if (start < 0) return { files: [] };
    const before = reflog[start + 1];
    const target = reflog[start].commit || onto;
    if (!before || !target) return { unknown: "no-reflog" };
    const r = gitAnswer(worktree, "merge-tree", "--write-tree", "--name-only", "--no-messages", "-z", before.commit, target);
    if (r.status === 0) return { files: [] };
    if (r.status !== 1) return { unknown: "no-reflog" };
    const [, ...paths] = r.stdout.split("\0").filter(Boolean);
    return { files: [...new Set(paths)] };
  } catch {
    return { unknown: "no-reflog" };
  }
}

// src/cli/index.ts
var args = parseArgs(process.argv.slice(2));
var asJson = args.has("--json");
var FORGOTTEN_MS = 24 * 60 * 60 * 1e3;
var USAGE = [
  "usage: swarm <verb> [--json]        (swarm --help code: the claim and merge verbs)",
  "  open    --kind plan|brainstorm|task --group <slug> --title <t> --seats <file.json> [--link <url>] [--stall-ms <ms>] [--protocol <name>]   # opens a run, registers the project's board in aiview, prints the run id, the board's URL, then the line that starts your link (orchestrator)",
  "          # --stall-ms: no counter moved this long posts stalled, default 60000; ends on the command that starts your link",
  "          # --plan <slug> --seats <file.json>: the same as --kind plan --group <slug> --seats <file.json>",
  `          # the seats file: [{"id", "role"?, "area"?, "blockers": [...], "link"?: "<URL>", "on"?: ["agreement", \u2026], "busyMax"?: <ms, its bound on a non-shell call; a verifier's 300000>}]`,
  "  seat    <id> --run <id> --state ready|running|done|blocked     # (orchestrator)",
  "  seat    add <id> --run <id> [--role <r>] [--area <a>] [--blockers a,b] [--link <url>] [--on <events>] [--busy-max <ms>]   # adds a seat mid-run (orchestrator); --busy-max: its bound on a non-shell call (a verifier's 300000)",
  "  phase   <name> <text> [--for <seat>,\u2026] [--watch <seat>,\u2026] [--as <member>]   # opens phase <name>; the current phase ends with it: a separator on the thread that wakes every member of the run (orchestrator)",
  "          # --for: only those seats are woken and owe done (all-done counts them alone); the others read the phase as their next header",
  "  pause   [<text>] [--as <member>]                               # every member stops where it is and waits; claim and merge-lock refused, no stall, quiet or stale alert until resume (orchestrator)",
  "  resume  [<message>] [--as <member>]                             # lifts the pause; every member wakes on the message and continues (orchestrator)",
  "  done    <phase> [--as <member>]                                 # your part of the current phase is in: tells the orchestrator; when every member is done, the board tells it",
  "  close   --run <id>                                              # (orchestrator)",
  '  join    --run <id> --seat <id> --doing <t> [--files "<path>:interface,<path>:inside,\u2026"]   # a file not there yet is one you create, declared from the repository root; prints the roster, how you listen (a seat waits in the foreground, a worker listens in the background), then the command that starts your link',
  "          # --on <events>: what wakes your wait --mentions besides mentions and urgent posts, e.g. agreement,any:merged; else the seat row's on, else the kind's defaults",
  "  subscribe   [--as <member>] <events>                            # prints your subscriptions after",
  "  unsubscribe [--as <member>] <events>",
  "  doing   [--as <member>] <text>",
  "  post    [--as <member>] <body> | --file <path> [--about <path|decision id>] [--urgent]   # prints the seq; --urgent (orchestrator only) wakes every waiter of the run, a pause included; --file for a long body (tables, quotes), never through shell quoting",
  "  agree   [--as <member>] <terms> [--about <path|decision id>] [--with <seat>[,<seat>]]  # prints the seq; parties: its @-mentions, --with, else the file's other holders",
  "  endorse [--as <member>] <seq>                                   # backs an agreement; prints the endorsement's seq",
  "  read    <seq>",
  "  thread  [--as <member>] [<phase>]                               # every post of a phase in full (the current one by default): read it before you decide or add",
  "  deliver [--as <member>]                                         # what you have not had: mentions in full, the rest one line (a seat's run: every post in full)",
  "  wait    [--as <member>] [--timeout <ms>] [--mentions]           # blocks until a message for you, then says how to re-arm; nothing on timeout or end; a newer wait supersedes it",
  "          # once your run is closed, wait, deliver, read, roster --as, post, agree, endorse, doing and done answer: run <id> closed: run end \u2026",
  "          # --mentions: only a mention of you, an urgent post or an event you subscribed to ends it; the rest stays for deliver (a seat's run: the wake brings every unread post)",
  "  roster  [--repo <path>] [--as <member>]",
  "  end     [--as <member>]                                         # claims or flags what you wrote unclaimed, then releases your claims and the lock",
  "  status                                                          # data home, open runs, each run's phase and its n/m done; a run idle a day is flagged with its close command",
  "  config  retention [<days>]                                      # prints, or sets then prints, how many days closed runs and main's talk are kept",
  "  lock    <name> [--note <t>] [--as <member>]                     # a shared resource of the machine, before you use it: port:<n>, app:<name>, db:<name>, browser:<profile>; held: who, then how to wait",
  "  unlock  <name> [--as <member>]                                  # releases it; its waiters are told (end, gone and close release too)",
  "  locks                                                           # every held lock: holder, since, waiters, and for a port what listens on it now",
  `events: ${Object.keys(EVENTS).join(", ")}; any:<event> for one posted in any run`,
  "a member is <group>/<seat>, the orchestrator <group>/orchestrator; without --as, the member joined from this worktree"
].join("\n");
var CODE_USAGE = [
  "usage: swarm <verb> [--json]        the code verbs; refused on a run whose kind has no claims",
  "  claim   [--as <member>] <path> [--interface] [--new]            # before editing a file: exit 0 claimed, 3 held until you post about it (the post claims it); --new: a file you create",
  "  release [--as <member>] <path>... | --all                        # gives up a claim; --all: every claim you hold",
  "  merge-lock --onto <branch> [--as <member>]                      # one merge at a time per repository; claims or flags what your branch wrote unclaimed",
  '  merged  [--as <member>] <sha> --files <path>... --report <text>|-   # releases the lock, tells who must rebase and who was refused the lock, names whom to tell of a resolved conflict; posts "@orchestrator merged <sha>: <text>", your report and its one wake; --report - merges silently'
].join("\n");
var STATS_USAGE = [
  "usage: swarm stats [--repo <path>] [--run <id>] [--since 30d|<ISO> | --all] [--closed] [--kind plan|brainstorm|task[,\u2026]] [--json]",
  "  the figures of a repository's runs, oldest first, with the scope's totals; a figure not recorded or not computed yet is null, never 0",
  "  --since: runs open, or closed since then, default 30d, none with --run; --all: every run kept; --closed: closed runs only",
  "  without --json: one line per run; --json carries every figure, with the run ids, members and seqs to follow with swarm read <seq>"
].join("\n");
var lengthText = (ms2) => {
  if (ms2 === null) return "\u2014";
  const minutes = Math.floor(ms2 / 6e4);
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
  return minutes >= 1 ? `${minutes}m` : `${Math.round(ms2 / 1e3)}s`;
};
var statsLine = (r) => {
  const c = r.plan?.conflicts;
  const conflicts = !c || r.recorded && r.firstMergeAtMs === null ? "\u2014" : c.known === null ? "unknown" : c.unknownMerges ? `${c.known} + ${c.unknownMerges} unknown` : String(c.known);
  return `${r.code} ${r.title} \xB7 ${r.kind} \xB7 ${lengthText(r.lengthMs)} \xB7 ${r.closedAt === null ? "open" : "closed"} \xB7 conflicts ${conflicts}`;
};
var CliError = class extends Error {
};
var fail = (msg) => {
  throw new CliError(msg);
};
var emit = (json, human) => {
  if (asJson) console.log(JSON.stringify(json));
  else if (typeof human === "string") {
    if (human) console.log(human);
  } else human();
};
var refuseTranscriptFlag = (verb) => {
  if (args.has("--transcript")) fail(`${verb}: unknown flag --transcript
${USAGE}`);
};
function repoOf(dir) {
  const common = git(dir, "rev-parse", "--git-common-dir");
  if (!common) fail(`not in a git repository: ${dir}`);
  const abs = path9.resolve(dir, common);
  try {
    return fs9.realpathSync.native(abs);
  } catch {
    return abs;
  }
}
function worktreeOf(dir) {
  const top = git(dir, "rev-parse", "--show-toplevel");
  return top ? path9.resolve(top) : null;
}
function changedIn(worktree) {
  const r = spawnSync3("git", ["status", "--porcelain", "-z", "--untracked-files=all"], { cwd: worktree, encoding: "utf8" });
  if (r.status !== 0) return fail(`git status failed in ${worktree}: ${r.stderr.trim()}`);
  const parts = r.stdout.split("\0");
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    out.push(e.slice(3));
    if (/[RC]/.test(e.slice(0, 2)) && parts[i + 1]) out.push(parts[++i]);
  }
  return out;
}
function branchChangedIn(worktree, onto) {
  const base = git(worktree, "merge-base", onto, "HEAD") ?? fail(`no merge base between ${onto} and HEAD in ${worktree}: is --onto the branch you merge into?`);
  const r = spawnSync3("git", ["diff", "--name-only", "-z", "--no-renames", `${base}..HEAD`], { cwd: worktree, encoding: "utf8" });
  if (r.status !== 0) return fail(`git diff failed in ${worktree}: ${r.stderr.trim()}`);
  const committed = r.stdout.split("\0").filter(Boolean);
  return [.../* @__PURE__ */ new Set([...committed, ...changedIn(worktree)])];
}
function renamesIn(worktree, base) {
  const r = spawnSync3("git", ["diff", "--name-status", "-z", "-M", base], { cwd: worktree, encoding: "utf8" });
  if (r.status !== 0) return [];
  const parts = r.stdout.split("\0");
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    if (/^[RC]\d*$/.test(parts[i])) {
      if (parts[i].startsWith("R")) out.push([parts[i + 1], parts[i + 2]]);
      i += 2;
    } else if (/^[A-Z]$/.test(parts[i])) i += 1;
  }
  return out;
}
var printReconciled = (unclaimed, flags, renames = []) => {
  const lines = unclaimedLines(unclaimed, renames);
  for (const line of lines) console.log(line);
  if (lines.length) console.log("(not a flag: a write without a claim is allowed, and was claimed for you; only a file another member holds raises a flag, below)");
  for (const f of flags) console.log(`#${f.seq} flagged: you wrote ${f.path} outside your claim; ${f.holder} holds it. Settle it with @${f.holder} on the thread.`);
};
var toolRoot = () => process.env.SWARM_ROOT ?? path9.dirname(path9.resolve(process.argv[1]));
var need = (flag) => args.flag(flag) ?? fail(`${flag} is required
${USAGE}`);
var runArg = () => {
  const raw = need("--run");
  const id = Number(raw);
  if (!Number.isInteger(id)) fail(`--run takes a run id, got ${raw}`);
  return id;
};
var board;
var linkToStart = null;
async function caller() {
  const as = args.flag("--as");
  const wt = as ? null : worktreeOf(process.cwd());
  const p = as ? await board.participant(as) ?? fail(`unknown member ${as}`) : (wt ? await board.identify({ worktree: wt }) : null) ?? fail("who is calling? no single member joined from this worktree; pass --as <group>/<seat>");
  const direct = board;
  const member = { name: p.name, run: p.run };
  if (p.ended || !(await direct.runs()).some((r) => r.id === p.run)) return p;
  board = await connectBoard({ dataRoot: DATA_ROOT, member });
  if (board.linkMissing) linkToStart = member;
  direct.close();
  return p;
}
var ago = (at) => {
  if (at == null) return "never";
  const s = Math.max(0, Math.floor((Date.now() - at) / 1e3));
  return s < 120 ? `${s}s` : s < 7200 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
};
var stateLine = (r, ages = false) => `${r.state}${r.activity ? ` (${r.activity})` : ""}` + (ages ? `  progress ${ago(r.progressAt)}${r.progressAt == null ? "" : " ago"}, link ${ago(r.aliveAt)}${r.aliveAt == null ? "" : " ago"}` : "");
var HELD_SHOWN = 3;
var heldLine = (files) => {
  const shown = files.slice(0, HELD_SHOWN).map((f) => f.interface ? `${f.path} (interface)` : f.path).join(", ");
  return files.length > HELD_SHOWN ? `${shown} +${files.length - HELD_SHOWN} more (${files.length})` : shown;
};
var rosterLine = (r, ages = false) => {
  const files = heldLine(r.held);
  const who = r.seat === "orchestrator" ? r.name : `${r.nick} \xB7 ${r.name}`;
  const on = r.subscriptions.length ? `  on: ${formatSubscriptions(r.subscriptions)}` : "";
  const bound = r.busyMax != null ? `  busy max: ${Math.round(r.busyMax / 1e3)} s (non-shell calls)` : "";
  return `${who}${r.stale ? " (stale)" : ""}  run ${r.run}  ${stateLine(r, ages)}${r.unread ? `  ${r.unread} unread` : ""}  doing: ${r.doing || "-"}${files ? `  files: ${files}` : ""}${on}${bound}`;
};
var phaseHeader = async (run2, shownTo) => (await phaseHeaders(run2, shownTo)).printed;
var phaseHeaders = async (run2, shownTo, showPause = true) => {
  const shown = shownTo ? await board.showPhase(shownTo) : null;
  const ph = shown ? shown.phase : await board.currentPhase(run2);
  const r = (await board.runs()).find((x) => x.id === run2);
  const whole = ph ? `phase ${ph.name}: ${ph.text}` : null;
  const short = ph && shown && !shown.first ? `phase ${ph.name} (unchanged; its text: ${[...self(), "thread", "--as", shellWord(shownTo.name)].join(" ")})` : whole;
  if (r?.paused == null || !showPause) return { printed: short, full: whole };
  const why = r.pausedPerson ? `: waiting on the person: ${r.paused || "their decision"}` : r.paused ? `: ${r.paused}` : "";
  const withPause = (head) => [head, `PAUSED${why}`].filter(Boolean).join("  ");
  return { printed: withPause(short), full: withPause(whole) };
};
var phaseSuffix = (phase, progress) => phase ? `  phase ${phase.name}: ${phase.text}${progress ? `  ${progressText(progress)}` : ""}` : "";
var withNext = (me, d) => ({
  ...d,
  full: d.full.map((m) => {
    const e = eventOf(m);
    const line = e ? EVENTS[e].next?.(m, me, self().join(" ")) ?? null : null;
    return line ? { ...m, endorse: line } : m;
  })
});
var printDelivery = (d) => {
  for (const m of d.full) {
    console.log(fullText(m));
    if (m.endorse) console.log(m.endorse);
  }
  for (const l of d.lines) console.log(l);
};
var shellWord = (w) => /^[\w@%+=:,./-]+$/.test(w) ? w : `"${w.replace(/(["\\$`])/g, "\\$1")}"`;
var self = () => ["node", shellWord(process.argv[1].replace(/\\/g, "/"))];
var startLinkLine = (member) => `start your link now, in the background (your harness's background task): ${[...self(), ...linkVerbArgs(member).map(shellWord)].join(" ")}`;
var SHELL_TOOL_TIMEOUT = FOREGROUND_NOTE;
var waitCommand = (name, foreground = false) => {
  const line = [...self(), "wait", "--mentions", "--as", shellWord(name)].join(" ");
  return foreground ? `${line} --timeout ${FOREGROUND_WAIT_MS}` : line;
};
var listensInForeground = (p) => p.seat !== "orchestrator" && profileOf(p.kind).member !== "worker";
var listenNow = (p, afterPhase = false) => listensInForeground(p) ? `${afterPhase ? "only then wait" : "wait now"}, in the foreground (never a background listener: a seat that ends its turn is gone; ${SHELL_TOOL_TIMEOUT}): ${waitCommand(p.name, true)}` : `start your listener now, in the background (your harness's background task): ${waitCommand(p.name)}`;
var owedLine = async (p, thread = true) => {
  const paused = await pausedLine(p);
  if (paused) return paused;
  const ph = await board.owedPhase(p);
  if (!ph) return null;
  const read = thread && profileOf(p.kind).wholeThread ? `Read the whole phase first: ${[...self(), "thread", "--as", shellWord(p.name)].join(" ")}. ` : "";
  return `phase ${ph.name} is open and asks: ${ph.text}. ${read}Do your part now, then: ${[...self(), "done", shellWord(ph.name), "--as", shellWord(p.name)].join(" ")}`;
};
var pausedLine = async (p) => {
  if (p.seat === "orchestrator" || p.ended) return null;
  const run2 = (await board.runs()).find((r) => r.id === p.run);
  if (!run2 || run2.paused == null) return null;
  const why = run2.pausedPerson ? `: waiting on the person: ${run2.paused || "their decision"}` : run2.paused ? `: ${run2.paused}` : "";
  return `run ${p.run} is paused${why}. Stop where you are: start nothing new, claim and merge nothing; wait in the foreground for the resume (${SHELL_TOOL_TIMEOUT}): ${waitCommand(p.name, true)}`;
};
var refusedPaused = async (p, verb) => {
  const line = await pausedLine(p);
  if (!line) return false;
  process.exitCode = 4;
  emit({ run: p.run, paused: true, refused: verb, next: line }, `${verb} refused: ${line}`);
  return true;
};
var PHASELESS = "none";
var LOCK_PORT = /^port:(\d{1,5})$/;
function listenersOn(port) {
  const found = /* @__PURE__ */ new Set();
  if (process.platform === "win32") {
    const out = spawnSync3("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8", windowsHide: true }).stdout ?? "";
    for (const line of out.split(/\r?\n/)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length >= 5 && /LISTEN/i.test(cols[3]) && cols[1].endsWith(`:${port}`)) found.add(Number(cols[4]));
    }
  } else {
    const out = spawnSync3("lsof", [`-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" }).stdout ?? "";
    for (const line of out.split(/\r?\n/)) if (/^\d+$/.test(line.trim())) found.add(Number(line.trim()));
  }
  return [...found].filter((pid) => pid > 0).sort((a, b) => a - b);
}
function processStarts(pids) {
  const starts = /* @__PURE__ */ new Map();
  if (!pids.length) return starts;
  if (process.platform === "win32") {
    const filter = pids.map((pid) => `ProcessId=${pid}`).join(" or ");
    const script = `Get-CimInstance Win32_Process -Filter '${filter}' | ForEach-Object { "$($_.ProcessId) $($_.CreationDate.ToUniversalTime().ToString('o'))" }`;
    const out = spawnSync3("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true }).stdout ?? "";
    for (const line of out.split(/\r?\n/)) {
      const [pid, at] = line.trim().split(/\s+/);
      if (pid && at && Number.isFinite(Date.parse(at))) starts.set(Number(pid), Date.parse(at));
    }
  } else {
    const out = spawnSync3("ps", ["-o", "pid=,lstart=", "-p", pids.join(",")], { encoding: "utf8" }).stdout ?? "";
    for (const line of out.split(/\r?\n/)) {
      const m = /^\s*(\d+)\s+(.+)$/.exec(line);
      if (m && Number.isFinite(Date.parse(m[2]))) starts.set(Number(m[1]), Date.parse(m[2]));
    }
  }
  return starts;
}
function grantListeners(port, pids, released) {
  const starts = processStarts(pids);
  const releasedAt = released ? Date.parse(released.at) : NaN;
  const left = pids.filter((pid) => Number.isFinite(releasedAt) && (starts.get(pid) ?? -Infinity) < releasedAt);
  const without = pids.filter((pid) => !left.includes(pid));
  const lines = [
    ...left.length ? [`listening on ${port} now: ${left.join(", ")}, left running by ${released.by}'s release: stop it only if it is yours to stop`] : [],
    ...without.length ? [`listening on ${port} now: ${without.join(", ")}, started by someone without the lock: ask on the board before you stop it`] : []
  ];
  return { lines, stoppable: left };
}
var stopLine = (pids) => process.platform === "win32" ? pids.map((pid) => `taskkill /PID ${pid} /T /F`).join("; ") : `kill ${pids.join(" ")}`;
var portListeners = (name) => {
  const m = LOCK_PORT.exec(name);
  return m ? { port: Number(m[1]), pids: listenersOn(Number(m[1])) } : null;
};
var lockLine = (l, listening) => `${l.name}  held by ${l.member} (run ${l.run}) since ${l.since}${l.note ? `  note: ${l.note}` : ""}${l.waiters.length ? `  waiters: ${l.waiters.join(", ")}` : ""}${listening ? `  listening: ${listening.length ? listening.join(", ") : "none"}` : ""}`;
var firstPhaseLine = (kind, group, protocol) => {
  if (kind !== "task" && kind !== "plan") return null;
  if (protocol === PHASELESS) return "next: phaseless: the workers take tasks on call";
  const command = `${self().join(" ")} phase <name> "<its message>" --as ${shellWord(`${group}/orchestrator`)}`;
  const pointer = "(its protocol.md's phase table names them)";
  return protocol ? `next: open ${protocol}'s first phase before any task ${pointer}: ${command}` : `next: no protocol, so the workers take tasks on call with no phases; if the approved proposal names a protocol, open its first phase before any task ${pointer}: ${command}`;
};
var firstTaskPostLine = async (p) => {
  if (p.seat !== "orchestrator") return null;
  const run2 = (await board.runs()).find((r) => r.id === p.run);
  if (!run2 || run2.kind !== "task" && run2.kind !== "plan" || run2.protocol === PHASELESS || await board.currentPhase(p.run)) return null;
  const mine = (await board.stats({ repo: p.repo, run: p.run })).runs.find((r) => r.run === p.run)?.members.find((x) => x.member === p.name);
  return mine?.posts === 1 ? firstPhaseLine(run2.kind, run2.group, run2.protocol) : null;
};
var nextStep = async (p) => {
  const paused = await pausedLine(p);
  if (paused) return paused;
  const owed = await owedLine(p);
  return owed ? `${owed}
${listenNow(p, true)}` : listenNow(p);
};
var heardStep = async (p) => {
  if (p.ended || p.listening) return null;
  if (!listensInForeground(p)) return nextStep(p);
  return await pausedLine(p) ?? await owedLine(p);
};
var closedLine = (p) => `run ${p.run} closed: run end and return your summary: ${[...self(), "end", "--as", shellWord(p.name)].join(" ")}; your link and listener background tasks end on their own now, and their end notices are not news`;
var answeredClosed = async (p) => {
  if ((await board.runs()).some((r) => r.id === p.run)) return false;
  const line = closedLine(p);
  emit({ run: p.run, closed: true, next: line }, line);
  return true;
};
var unmatchedLines = async (p, body) => {
  const roster = await board.roster(p.repo);
  const members = roster.filter((r) => r.seat !== "orchestrator");
  const plans = [...new Set(roster.map((r) => r.plan))];
  const names = new Map(members.map((r) => [nameHandle(r.nick), r.name]));
  const nickOf = new Map(members.map((r) => [r.name, r.nick.replace(/\s+/g, "")]));
  const ended = new Set(await board.endedMembers(p.repo));
  return unmatchedMentions(body, p.plan, plans, names).map(({ name, closest }) => {
    const member = name.includes("/") ? name : `${p.plan}/${name}`;
    if (ended.has(member)) return `@${name} has ended: the post stays on the thread, but they will not read it`;
    const guesses = closest.map((c) => nickOf.has(c) ? `@${c} or @${nickOf.get(c)}` : `@${c}`);
    return `@${name} matched nobody on the board${guesses.length ? `: did you mean ${guesses.join(", ")}?` : ""}`;
  });
};
var emitHeard = async (p, json, human) => {
  const next = await heardStep(p);
  emit(next ? { ...json, next } : json, () => {
    if (typeof human === "string") console.log(human);
    else human();
    if (next) console.log(next);
  });
};
var DELIVERED_LINE = "these lines are delivered; the task-end notice is the same event";
function resolveClaimPath(file, about = false) {
  if (path9.isAbsolute(file)) return file;
  const here = path9.resolve(file);
  if (fs9.existsSync(here)) return here;
  const root = worktreeOf(process.cwd());
  const fromRoot = root ? path9.resolve(root, file) : null;
  if (fromRoot && fs9.existsSync(fromRoot)) return fromRoot;
  if (args.has("--new")) return here;
  return fail(`no such file: ${here}${fromRoot && fromRoot !== here ? ` nor ${fromRoot}` : ""}; pass --new if you are creating it${about ? " (--about takes a file not yet on disk with --new)" : ""}`);
}
function repoRelative(abs) {
  const root = worktreeOf(process.cwd());
  const rel = root ? path9.relative(root, abs) : abs;
  return rel.split(path9.sep).join("/");
}
function aboutArg() {
  const about = args.flag("--about");
  if (about === void 0 || !/[\\/]/.test(about)) return about;
  return repoRelative(resolveClaimPath(about, true));
}
function parseFile(spec) {
  const m = spec.match(/^(.*):(interface|inside)$/);
  const d = m ? { path: m[1], interface: m[2] === "interface" } : { path: spec, interface: false };
  return { ...d, path: repoRelative(declaredPath(d.path)) };
}
function declaredPath(file) {
  if (path9.isAbsolute(file)) return file;
  const here = path9.resolve(file);
  if (fs9.existsSync(here)) return here;
  const root = worktreeOf(process.cwd());
  return root ? path9.resolve(root, file) : here;
}
function readSeats(file) {
  let raw;
  try {
    raw = JSON.parse(fs9.readFileSync(path9.resolve(file), "utf8"));
  } catch (e) {
    return fail(`cannot read seats from ${file}: ${e.message}`);
  }
  const list = Array.isArray(raw) ? raw : raw.seats;
  if (!Array.isArray(list)) return fail(`${file}: expected an array of {id, role, area, blockers}`);
  return list.map((s) => {
    if (typeof s.id !== "string") fail(`${file}: a seat without an id`);
    if ("title" in s) fail(`${file}: unknown field title in ${s.id}; a seat has id, role, area`);
    if ("transcript" in s) fail(`${file}: unknown field transcript in ${s.id}`);
    if (s.busyMax !== void 0 && !(Number.isInteger(s.busyMax) && s.busyMax > 0)) fail(`${file}: busyMax of ${s.id} takes a positive whole number of ms, got ${JSON.stringify(s.busyMax)}`);
    return {
      ...s.busyMax !== void 0 ? { busyMax: s.busyMax } : {},
      id: String(s.id),
      ...typeof s.role === "string" && s.role ? { role: s.role } : {},
      ...typeof s.area === "string" && s.area ? { area: s.area } : {},
      blockers: Array.isArray(s.blockers) ? s.blockers.map(String) : [],
      link: typeof s.link === "string" && s.link ? s.link : null,
      ...Array.isArray(s.on) ? { on: s.on.map(String) } : {}
    };
  });
}
function openKindAndGroup() {
  const raw = args.flag("--kind") ?? "plan";
  let kind;
  try {
    kind = profileOf(raw).kind;
  } catch (e) {
    return fail(`open: ${e.message}`);
  }
  const plan = args.flag("--plan");
  if (plan !== void 0 && kind !== "plan") fail(`open: --plan means --kind plan; a ${kind} run takes --group <slug>`);
  const group = args.flag("--group") ?? plan ?? fail(`open: --group <slug> is required (or --plan <slug> for a plan run)
${USAGE}`);
  return { kind, group };
}
function joinedSeat() {
  const seat = args.flag("--seat");
  return seat ?? fail(`--seat is required
${USAGE}`);
}
var POSTS_MARKDOWN = "posts are markdown, rendered on the board: steps as a list, options as a table, a task or a report in short headed parts, a flow or a structure as a mermaid block; more than one line goes through post --file <path>";
var seatCommands = (as) => {
  const cli = self().join(" ");
  const who = `--as ${shellWord(as)}`;
  return [
    `${cli} post "\u2026" --about <D id> ${who}`,
    `${cli} agree "\u2026" --about <D id> ${who}`,
    `${cli} endorse <seq> ${who}`,
    `${cli} wait --mentions ${who} --timeout ${FOREGROUND_WAIT_MS}    # in the foreground, when waiting; ${SHELL_TOOL_TIMEOUT}`
  ];
};
var subscriptionsArg = (spec) => {
  try {
    return parseSubscriptions(spec);
  } catch (e) {
    return fail(e.message);
  }
};
var NO_MAIN = "there is no Main any more: the conversation is one; mention who you mean (@IW, @IW\xB7SL3, @swarm)";
async function main() {
  if ((args.verb === "post" || args.verb === "agree" || args.verb === "endorse") && args.has("--main")) {
    console.error(NO_MAIN);
    process.exitCode = 2;
    return;
  }
  switch (args.verb) {
    case "config": {
      const setting = args.positional[0];
      if (setting !== "retention") fail(`config: the one setting is retention
${USAGE}`);
      const raw = args.positional[1];
      const value = raw === void 0 ? void 0 : Number(raw);
      const days = await board.setting("retention-days", value);
      emit({ retention: days }, String(days));
      break;
    }
    case "open": {
      const { kind, group } = openKindAndGroup();
      const plan = group;
      const seatsFile = args.flag("--seats") ?? fail(`open: --seats <file.json> is required
${USAGE}`);
      const rawStall = args.flag("--stall-ms");
      const stallMs = rawStall === void 0 ? void 0 : Number(rawStall);
      if (stallMs !== void 0 && !(Number.isInteger(stallMs) && stallMs > 0)) fail(`--stall-ms takes a positive whole number of ms, got ${rawStall}`);
      refuseTranscriptFlag("open");
      const protocol = args.flag("--protocol");
      if (protocol !== void 0 && !/^[a-z0-9][a-z0-9-]*$/.test(protocol)) fail(`--protocol takes a name in lower case, digits and dashes (build-verify), got ${protocol}`);
      const home = boardHome({ toolRoot: toolRoot(), cwd: process.cwd() });
      if (!home.found && home.launcher)
        fail(
          `open: no aiview project covers ${process.cwd()}, so the run's board would show nowhere. Declare it, then open again:
  node ${home.launcher} project add <slug> --path ${process.cwd()}`
        );
      const run2 = await board.openRun({
        repo: repoOf(process.cwd()),
        kind,
        group,
        title: need("--title"),
        link: args.flag("--link") ?? null,
        seats: readSeats(seatsFile),
        ...stallMs !== void 0 ? { stallMs } : {},
        ...protocol !== void 0 ? { protocol } : {}
      });
      const link = startLinkLine({ name: `${run2.group}/orchestrator`, run: run2.id });
      const doc = registerBoard({ home, cwd: process.cwd(), repo: run2.repo });
      const next = firstPhaseLine(run2.kind, run2.group, protocol ?? null);
      const lines = (url) => [String(run2.id), url, link, next].filter((l) => l !== null).join("\n");
      if (!doc.registered) {
        console.error(`swarm: ${doc.reason}: the run is open; its board is read in aiview once aiview is installed and knows this project`);
        emit({ run: run2.id, repo: run2.repo, kind: run2.kind, group: run2.group, plan: run2.plan, url: null, link, ...next ? { next } : {} }, lines(null));
        break;
      }
      emit({ run: run2.id, repo: run2.repo, kind: run2.kind, group: run2.group, plan: run2.plan, url: doc.url, link, ...next ? { next } : {} }, lines(doc.url));
      break;
    }
    case "slice":
    // AGENTS rule 12: the old name of `seat`, accepted silently, never shown in --help
    case "seat": {
      if (args.positional[0] === "add") {
        const id2 = args.positional[1] ?? fail(`seat add: which id?
${USAGE}`);
        const run3 = runArg();
        const on = args.flag("--on");
        if (on !== void 0) subscriptionsArg(on);
        const role = args.flag("--role");
        const area = args.flag("--area");
        const rawBusyMax = args.flag("--busy-max");
        const busyMax = rawBusyMax === void 0 ? void 0 : Number(rawBusyMax);
        if (busyMax !== void 0 && !(Number.isInteger(busyMax) && busyMax > 0)) fail(`--busy-max takes a positive whole number of ms, got ${rawBusyMax}`);
        const added = await board.addSeat(run3, {
          id: id2,
          ...role ? { role } : {},
          ...area ? { area } : {},
          ...busyMax !== void 0 ? { busyMax } : {},
          blockers: args.list("--blockers"),
          link: args.flag("--link") ?? null,
          ...on !== void 0 ? { on: on.split(",").map((x) => x.trim()).filter(Boolean) } : {}
        });
        emit({ run: run3, seat: added }, `${id2} added`);
        break;
      }
      const id = args.positional[0] ?? fail(`seat: which seat?
${USAGE}`);
      const run2 = runArg();
      refuseTranscriptFlag("seat");
      const state = need("--state");
      await board.setSeatState(run2, id, state);
      emit({ run: run2, seat: id, state }, `${id} ${state}`);
      break;
    }
    case "close": {
      const run2 = runArg();
      await board.closeRun(run2);
      emit({ run: run2, state: "closed" }, `run ${run2} closed`);
      break;
    }
    case "phase": {
      const p = await caller();
      const [name, ...said] = args.positional;
      if (!name) fail(`phase: which phase?
${USAGE}`);
      const text = said.join(" ") || fail(`phase ${name}: what does it ask?`);
      const watch = args.list("--watch");
      const only = args.list("--for");
      const m = await board.phase(p, name, text, watch.length || only.length ? { ...watch.length ? { watch } : {}, ...only.length ? { for: only } : {} } : void 0);
      const cli = self().join(" ");
      const heard = watch.length ? `the done of ${watch.join(", ")} wakes you; every other done rides on your next wake` : `each member's done rides on your next wake; to hear one the moment it lands, open the phase with --watch <ids>`;
      const forWhom = only.length ? ` for ${only.join(", ")} alone (the others are not woken and owe no done)` : "";
      const next = `phase ${name} is open${forWhom}; ${heard}. Listen in the background: ${cli} wait --mentions --as ${shellWord(p.name)}. When the board says every member is done, open the next phase: ${cli} phase <name> "<text>" --as ${shellWord(p.name)}; after the last, ${cli} close --run ${m.run}`;
      const brief = "brief the person: the list of what is done since the session began, one short phrase each, then what comes next";
      const dormant = ((await board.phaseProgress(m.run))?.dormant ?? []).map((s) => `${s.slice(s.lastIndexOf("/") + 1)} is dormant: dispatch a member into it (join the same seat) or resume it with SendMessage`);
      emit({ seq: m.seq, run: m.run, phase: name, brief, dormant, next }, () => {
        console.log(seqLine(m));
        for (const line of dormant) console.log(line);
        console.log(brief);
        console.log(next);
      });
      break;
    }
    case "pause":
    case "resume": {
      const p = await caller();
      const person = args.verb === "pause" ? args.flag("--person") : void 0;
      const text = person ?? args.positional.join(" ");
      const cli = self().join(" ");
      if (args.verb === "pause") {
        const m2 = await board.pause(p, text, person !== void 0 ? { person: true } : void 0);
        const next2 = `every member of run ${m2.run} is told to stop and wait${person !== void 0 ? `, waiting on the person: ${text}` : ""}; nothing wakes you but an urgent post until the resume, which gives you every line held meanwhile. Resume, with a message if they need one: ${cli} resume "<message>" --as ${shellWord(p.name)}`;
        emit({ seq: m2.seq, run: m2.run, paused: true, person: person !== void 0, next: next2 }, () => {
          console.log(seqLine(m2));
          console.log(next2);
        });
        break;
      }
      const m = await board.resume(p, text);
      const next = `run ${m.run} resumed${m.held.length ? `; ${m.held.length} held while paused, above` : ""}; listen again in the background: ${cli} wait --mentions --as ${shellWord(p.name)}`;
      emit({ seq: m.seq, run: m.run, paused: false, held: m.held, next }, () => {
        console.log(seqLine(m));
        for (const line of m.held) console.log(line);
        console.log(next);
      });
      break;
    }
    case "done": {
      const p = await caller();
      if (await answeredClosed(p)) break;
      const name = args.positional[0] ?? fail(`done: which phase?
${USAGE}`);
      let r;
      try {
        r = await board.done(p, name);
      } catch (e) {
        if (!/no phase is open/.test(e.message)) throw e;
        emit({ member: p.name, phase: name, done: null, none: true }, "no phase is open: nothing to mark");
        break;
      }
      const next = `wait for the next phase, in the foreground (${SHELL_TOOL_TIMEOUT}): ${waitCommand(p.name, true)}`;
      emit({ member: p.name, phase: name, done: r.progress.done, of: r.progress.of, gone: r.progress.gone, all: r.all, already: r.already, late: r.late, next }, () => {
        const late = r.late ? `late done ${name} (not the current phase), recorded; the orchestrator is told` : null;
        console.log(late ?? `${r.already ? "already done" : "done"} ${name}: ${r.progress.done}/${r.progress.of} members done${r.progress.gone.length ? `, ${r.progress.gone.length} gone` : ""}${r.all ? "; the orchestrator is told every member is done" : ""}`);
        console.log(next);
      });
      break;
    }
    case "join": {
      const { member, roster, composition } = await board.join({
        run: runArg(),
        seat: joinedSeat(),
        doing: need("--doing"),
        files: [...args.list("--files"), ...args.flags("--file")].map(parseFile),
        worktree: worktreeOf(process.cwd()) ?? void 0,
        ...args.flag("--on") !== void 0 ? { on: subscriptionsArg(args.flag("--on")) } : {}
      });
      const link = startLinkLine({ name: member.name, run: member.run });
      const next = await nextStep(member);
      const shared = !profileOf(member.kind).worktree;
      const as = shared ? `pass --as ${member.name} on every call: this checkout is shared, the board cannot tell you apart` : null;
      const commands = shared ? seatCommands(member.name) : null;
      const drawing = POSTS_MARKDOWN;
      const phase = await phaseHeader(member.run);
      emit({ member: member.name, nick: member.nick, roster, composition, phase, ...shared ? { as: member.name, commands } : {}, ...drawing ? { drawing } : {}, link, next }, () => {
        console.log(`you are ${member.name}, ${member.nick}: @${member.seat} or @${member.nick.replace(/\s+/g, "")} mentions you`);
        for (const l of composition.lines) console.log(l);
        for (const r of roster) console.log(rosterLine(r));
        if (phase) console.log(phase);
        if (as) console.log(as);
        for (const c of commands ?? []) console.log(c);
        if (drawing) console.log(drawing);
        console.log(link);
        if (next) console.log(next);
      });
      break;
    }
    case "subscribe":
    case "unsubscribe": {
      const p = await caller();
      const subs = subscriptionsArg(args.positional.join(",") || fail(`${args.verb}: which events?`));
      const after = args.verb === "subscribe" ? await board.subscribe(p, subs) : await board.unsubscribe(p, subs);
      await emitHeard(p, { member: p.name, subscriptions: after }, `${p.name} wakes on: ${formatSubscriptions(after) || "mentions and urgent posts only"}`);
      break;
    }
    case "doing": {
      const p = await caller();
      if (await answeredClosed(p)) break;
      const text = args.positional.join(" ") || fail("doing: what?");
      await board.setDoing(p, text);
      await emitHeard(p, { member: p.name, doing: text }, `${p.name} doing: ${text}`);
      break;
    }
    case "post":
    case "agree": {
      const p = await caller();
      if (await answeredClosed(p)) break;
      const file = args.flag("--file");
      const body = (file ? fs9.readFileSync(file, "utf8").trim() : args.positional.join(" ")) || fail(`${args.verb}: nothing to say`);
      const urgent = args.has("--urgent");
      if (urgent && args.verb !== "post") fail("--urgent is for post");
      if (args.verb !== "agree" && args.has("--with")) fail("--with is for agree");
      if (urgent && p.seat !== "orchestrator") fail("--urgent is the orchestrator's: it wakes every waiter of the run, even in a pause; ask @orchestrator on the thread instead");
      const m = await board.post(p, body, {
        about: aboutArg(),
        kind: args.verb === "agree" ? "agreement" : urgent ? "urgent" : "msg",
        ...args.verb === "agree" && args.flag("--with") ? { with: args.flag("--with").split(",") } : {}
      });
      const unmatched = await unmatchedLines(p, body);
      const phaseNext = args.verb === "post" ? await firstTaskPostLine(p) : null;
      const json = { seq: m.seq, mentions: m.mentions, run: m.run, ...unmatched.length ? { unmatched } : {}, ...m.claimed ? { claimed: m.claimed } : {} };
      const human = () => {
        console.log(seqLine(m));
        if (m.claimed) console.log(`claimed ${m.claimed.path}, shared with ${m.claimed.sharedWith.join(", ")}`);
        for (const line of unmatched) console.log(line);
        if (args.verb === "agree" && m.mentions?.length) console.log(`parties: ${m.mentions.join(", ")}, woken when its file merges`);
      };
      if (phaseNext) {
        const listen2 = await heardStep(p);
        emit({ ...json, ...listen2 ? { listen: listen2 } : {}, next: phaseNext }, () => {
          human();
          if (listen2) console.log(listen2);
          console.log(phaseNext);
        });
      } else await emitHeard(p, json, human);
      break;
    }
    case "endorse": {
      const p = await caller();
      if (await answeredClosed(p)) break;
      const raw = (args.positional[0] ?? fail("endorse: which seq?")).replace(/^#/, "");
      const seq = Number(raw);
      if (!Number.isInteger(seq)) fail(`endorse takes a seq, got ${raw}`);
      const m = await board.endorse(p, seq);
      await emitHeard(p, { seq: m.seq, endorses: m.endorses, run: m.run }, seqLine(m));
      break;
    }
    case "read": {
      const raw = (args.positional[0] ?? fail("read: which seq?")).replace(/^#/, "");
      const seq = Number(raw);
      if (!Number.isInteger(seq)) fail(`read takes a seq, got ${raw}`);
      let by;
      try {
        by = await caller();
      } catch (e) {
        if (!(e instanceof CliError)) throw e;
      }
      if (by && await answeredClosed(by)) break;
      const m = await board.read(seq, by);
      const { printed: phase, full: phaseFull } = await phaseHeaders(by?.run ?? m.run, by);
      const owes = by ? await owedLine(by) : null;
      emit({ ...m, phase: phaseFull, ...owes ? { next: owes } : {} }, () => {
        if (phase) console.log(phase);
        console.log(fullText(m));
        if (owes) console.log(owes);
      });
      break;
    }
    case "thread": {
      const me = await caller();
      if (await answeredClosed(me)) break;
      const name = args.positional[0];
      const posts = await board.thread(me, name);
      const current = name === void 0 && !posts.length ? await board.currentPhase(me.run) : null;
      const phase = await phaseHeader(me.run);
      const owes = await owedLine(me, false);
      emit({ phase, posts, ...owes ? { next: owes } : {} }, () => {
        if (phase) console.log(phase);
        if (!posts.length) console.log(`no post yet in phase ${name ?? current?.name ?? "-"}`);
        for (const m of posts) console.log(fullText(m));
        if (owes) console.log(owes);
      });
      break;
    }
    case "deliver": {
      const me = await caller();
      if (await answeredClosed(me)) break;
      const mentionsOnly = args.has("--mentions");
      const d = withNext(me, await (mentionsOnly ? board.deliverMentions(me) : board.deliver(me)));
      const { printed: phase, full: phaseFull } = d.full.length || d.lines.length ? await phaseHeaders(me.run, me) : { printed: null, full: null };
      const owes = mentionsOnly ? null : await owedLine(me);
      emit({ phase: phaseFull, ...d, ...owes ? { next: owes } : {} }, () => {
        if (phase) console.log(phase);
        printDelivery(d);
        if (owes) console.log(owes);
      });
      break;
    }
    case "wait": {
      const p = await caller();
      if (await answeredClosed(p)) break;
      const raw = args.flag("--timeout");
      const timeout = raw === void 0 ? void 0 : Number(raw);
      if (timeout !== void 0 && !(timeout >= 0)) fail(`--timeout takes milliseconds, got ${raw}`);
      const mentionsOnly = args.has("--mentions");
      const d = withNext(p, await board.wait(p, { timeoutMs: timeout, mentionsOnly }));
      if (await answeredClosed(p)) break;
      if (d.superseded) {
        emit(d, "superseded by a newer wait");
        break;
      }
      const again = [...self(), "wait"];
      if (mentionsOnly) again.push("--mentions");
      if (args.flag("--as")) again.push("--as", shellWord(args.flag("--as")));
      if (raw !== void 0) again.push("--timeout", raw);
      if (asJson) again.push("--json");
      const foregroundLine = [...again.filter((w, i) => w !== "--timeout" && again[i - 1] !== "--timeout"), "--timeout", String(FOREGROUND_WAIT_MS)].join(" ");
      if (!d.full.length && !d.lines.length) {
        const ended = (await board.participant(p.name))?.ended ?? true;
        if (ended) emit(d, "");
        else if (mentionsOnly && await board.idle(p)) {
          const next2 = `nothing for you: run ${[...self(), "end", "--as", shellWord(p.name)].join(" ")} and return; the orchestrator dispatches you again when it has work`;
          emit({ ...d, idle: true, next: next2 }, next2);
        } else {
          const next2 = await pausedLine(p) ?? (p.seat === "orchestrator" ? `nothing yet; wait again: ${again.join(" ")}` : `nothing yet; wait again (${SHELL_TOOL_TIMEOUT}): ${foregroundLine}`);
          emit({ ...d, next: next2 }, next2);
        }
        break;
      }
      const owes = await owedLine(p);
      const pausedNow = await pausedLine(p);
      const rearm = pausedNow ? pausedNow : listensInForeground(p) ? owes ? `${owes}
only then wait again, in the foreground (${SHELL_TOOL_TIMEOUT}): ${foregroundLine}` : `wait again, in the foreground (${SHELL_TOOL_TIMEOUT}): ${foregroundLine}` : p.seat === "orchestrator" ? `act on it, then start this listener again, in the background: ${again.join(" ")}` : `start this listener again, in the background while you work, in the foreground when you are waiting (${SHELL_TOOL_TIMEOUT}): ${foregroundLine}`;
      const next = owes && !pausedNow && !listensInForeground(p) ? `${owes}
${rearm}` : rearm;
      const { printed: phase, full: phaseFull } = await phaseHeaders(p.run, p, !pausedNow);
      const delivered = mentionsOnly ? DELIVERED_LINE : null;
      emit({ phase: phaseFull, next, ...d, ...delivered ? { delivered } : {} }, () => {
        if (phase) console.log(phase);
        console.log(next);
        printDelivery(d);
        if (delivered) console.log(delivered);
      });
      break;
    }
    case "roster": {
      if (args.flag("--as") && await answeredClosed(await caller())) break;
      const repo = repoOf(path9.resolve(args.flag("--repo") ?? process.cwd()));
      const roster = await board.roster(repo);
      const runs = new Map((await board.runs()).filter((r) => r.repo === repo).map((r) => [r.id, r]));
      const progress = new Map(await Promise.all([...runs.keys()].map(async (id) => [id, await board.phaseProgress(id)])));
      const names = new Set(roster.map((r) => r.name));
      const held = (await board.locks()).filter((l) => names.has(l.member) || l.waiters.some((w) => names.has(w)));
      const compositions = new Map(await Promise.all([...runs.keys()].map(async (id) => [id, await board.composition(id)])));
      emit({ repo, roster, compositions: [...compositions.values()], runs: [...runs.values()].map((r) => ({ run: r.id, title: r.title, phase: r.phase, progress: progress.get(r.id) ?? null })), locks: held }, () => {
        for (const l of held) console.log(`lock ${lockLine(l, null)}`);
        let shown = null;
        for (const r of roster) {
          const run2 = runs.get(r.run);
          if (run2 && r.run !== shown) console.log(`run ${run2.id}  ${run2.title}${phaseSuffix(run2.phase, progress.get(run2.id) ?? null)}`);
          shown = r.run;
          console.log(rosterLine(r, true));
          if (roster.filter((x) => x.run === r.run).at(-1) === r) for (const l of compositions.get(r.run)?.lines ?? []) console.log(`  seat ${l}`);
        }
      });
      break;
    }
    case "claim": {
      const p = await caller();
      if (await refusedPaused(p, "claim")) break;
      const file = args.positional[0] ?? fail("claim: which path?");
      const abs = resolveClaimPath(file);
      const rel = repoRelative(abs);
      const verdict = await board.checkEdit(p, abs, { interface: args.has("--interface") });
      if (!verdict.allowed) process.exitCode = 3;
      const also = verdict.allowed && verdict.notice ? (await Promise.all(verdict.sharedWith.map(async (o) => `${o.member} \xB7 ${(await board.participant(o.member))?.nick ?? "?"}: ${o.doing}`))).join("; ") : "";
      await emitHeard(p, verdict, () => {
        if (!verdict.allowed) return console.log(verdict.refusal);
        console.log(also ? `claimed ${rel}, also held by ${also}` : `claimed ${rel}`);
      });
      break;
    }
    case "release": {
      const p = await caller();
      const all = args.has("--all");
      if (!all && !args.positional.length) fail("release: which path? (or --all, every claim you hold)");
      const released = [];
      const targets = all ? (await board.heldBy(p)).map((f) => path9.resolve(worktreeOf(process.cwd()) ?? process.cwd(), f)) : args.positional.map((f) => resolveClaimPath(f));
      if (all && !targets.length) {
        emit({ member: p.name, released: [] }, `${p.name} holds no claim`);
        break;
      }
      for (const abs of targets) {
        await board.release(p, abs);
        released.push(repoRelative(abs));
      }
      emit({ member: p.name, released: released.length === 1 ? released[0] : released }, released.map((r) => `${p.name} released ${r}`).join("\n"));
      break;
    }
    case "merge-lock": {
      const p = await caller();
      if (await refusedPaused(p, "merge-lock")) break;
      const onto = need("--onto");
      const holding = p.worktree ? worktreeHolding(p.worktree, onto) : null;
      if (holding) {
        process.exitCode = 5;
        const line = `${onto} is checked out at ${holding}: ask the orchestrator to detach it, then run merge-lock again`;
        emit({ member: p.name, granted: false, checkedOutAt: holding, next: line }, line);
        break;
      }
      const reconciled = p.worktree ? branchChangedIn(p.worktree, onto) : [];
      const held = new Set(await board.heldBy(p));
      const unclaimed = reconciled.filter((f) => !held.has(f));
      const flags = reconciled.length ? await board.reconcileWrites(p, reconciled) : [];
      const renames = p.worktree && unclaimed.length ? renamesIn(p.worktree, git(p.worktree, "merge-base", onto, "HEAD") ?? "HEAD") : [];
      const reflogMark = p.worktree ? headReflogLength(p.worktree) ?? void 0 : void 0;
      const r = await board.lockMerge(p, onto, reflogMark);
      emit({ member: p.name, ...r, reconciled, flags }, () => {
        printReconciled(unclaimed, flags, renames);
        console.log(r.granted ? "granted: merge, then swarm merged <sha> --files <path>..." : `held by ${r.holder}: swarm wait --mentions for its merged event`);
      });
      break;
    }
    case "merged": {
      const p = await caller();
      const sha = args.positional[0] ?? fail("merged: which sha?");
      const report = args.flag("--report")?.trim() || fail('merged: --report "<what you did>" is your report to the orchestrator, its one wake; --report - merges silently');
      const files = args.list("--files");
      const lock = await board.heldMergeLock(p);
      const conflicts = p.worktree && lock && lock.reflogMark !== null ? conflictsOf(p.worktree, lock.onto ?? "", lock.reflogMark) : void 0;
      const sharers = await board.merged(p, sha, files.map((f) => path9.resolve(f)), conflicts);
      const reported = report === "-" ? null : await board.post(p, `@orchestrator merged ${sha}: ${report}`, { kind: "msg" });
      const ended = new Set(await board.endedMembers(p.repo));
      const tell = sharers.map(
        (o) => ended.has(o.member) ? `if you resolved a conflict in ${o.path}: ${o.member} has ended, so say how in your report` : `if you resolved a conflict in ${o.path}, tell them: swarm post "@${o.member} I resolved ${o.path}: <how>" --about ${o.path}`
      );
      emit({ member: p.name, sha, files, tell, ...reported ? { reported: reported.seq } : {} }, () => {
        console.log(`merged ${sha}: lock released${reported ? `; reported as #${reported.seq}` : ""}`);
        for (const line of tell) console.log(line);
      });
      break;
    }
    case "end": {
      const p = await caller();
      if ((await board.runs()).every((r) => r.id !== p.run)) {
        const line = `run ${p.run} closed: ${p.name} ended; return your summary now (your link and listener background tasks end on their own, and their end notices are not news)`;
        emit({ member: p.name, ended: true, closed: true, next: line }, line);
        break;
      }
      if (p.ended) break;
      const unread = await board.unreadMentions(p);
      if (unread > 0) fail(`you have ${unread} unread mention${unread === 1 ? "" : "s"}: run \`${[...self(), "deliver", "--as", shellWord(p.name)].join(" ")}\` first`);
      const reconciled = p.worktree ? changedIn(p.worktree) : [];
      const held = new Set(await board.heldBy(p));
      const unclaimed = reconciled.filter((f) => !held.has(f));
      const flags = reconciled.length ? await board.reconcileWrites(p, reconciled) : [];
      const renames = p.worktree && unclaimed.length ? renamesIn(p.worktree, "HEAD") : [];
      await board.end(p);
      emit({ member: p.name, ended: true, reconciled, flags }, () => {
        printReconciled(unclaimed, flags, renames);
        console.log(`${p.name} ended`);
      });
      break;
    }
    case "stats": {
      const raw = args.flag("--run");
      const run2 = raw === void 0 ? void 0 : Number(raw);
      if (run2 !== void 0 && !Number.isInteger(run2)) fail(`--run takes a run id, got ${raw}`);
      const all = args.has("--all");
      const since = args.flag("--since");
      if (all && args.has("--since")) fail("stats: --since or --all, not both");
      const kinds = args.list("--kind").map((k) => {
        try {
          return profileOf(k).kind;
        } catch (e) {
          return fail(`stats: ${e.message}`);
        }
      });
      const stats = await board.stats({
        repo: repoOf(path9.resolve(args.flag("--repo") ?? process.cwd())),
        ...run2 !== void 0 ? { run: run2 } : {},
        // a named run is read whatever its age: no default period (plan D40)
        ...all ? {} : since !== void 0 ? { since } : run2 !== void 0 ? {} : { since: "30d" },
        ...kinds.length ? { kinds } : {},
        ...args.has("--closed") ? { closedOnly: true } : {}
      });
      emit(stats, () => {
        if (!stats.runs.length) console.log("no run in this scope");
        for (const r of stats.runs) console.log(statsLine(r));
        console.log("swarm stats --json for every figure");
      });
      break;
    }
    case "lock": {
      const p = await caller();
      if (await refusedPaused(p, "lock")) break;
      const name = args.positional[0] ?? fail(`lock: which resource? port:<n>, app:<name>, db:<name>, browser:<profile>
${USAGE}`);
      const r = await board.lock(p, name, args.flag("--note"));
      const cli = self().join(" ");
      const who = shellWord(p.name);
      if (!r.granted) {
        process.exitCode = 3;
        const h = r.holder;
        const held = `held by ${h.nick} (${h.code}\xB7${h.member.split("/").pop()}, ${h.state}) since ${h.since}${h.doing ? `, doing: ${h.doing}` : ""}`;
        const next2 = `next: wait for its unlocked event, then lock again (${cli} lock ${shellWord(name)} --as ${who}); in the foreground (${SHELL_TOOL_TIMEOUT}): ${waitCommand(p.name, true)}`;
        emit({ name, granted: false, holder: h, next: next2 }, () => {
          console.log(held);
          console.log(next2);
        });
        break;
      }
      const port = portListeners(name);
      const told = port && port.pids.length ? grantListeners(port.port, port.pids, r.released) : null;
      const next = told && told.stoppable.length ? `next: to restart what listens on ${port.port}, stop exactly these: ${stopLine(told.stoppable)}` : `next: unlock it once you are done: ${cli} unlock ${shellWord(name)} --as ${who}`;
      emit({ name, granted: true, ...port ? { port: port.port, listening: port.pids } : {}, ...r.released ? { released: r.released } : {}, next }, () => {
        console.log(`granted ${name}`);
        for (const line of told?.lines ?? []) console.log(line);
        console.log(next);
      });
      break;
    }
    case "unlock": {
      const p = await caller();
      const name = args.positional[0] ?? fail(`unlock: which resource?
${USAGE}`);
      const r = await board.unlock(p, name);
      emit({ name, ...r }, r.released ? `released ${name}${r.waiters.length ? `; told its waiters: ${r.waiters.join(", ")}` : ""}` : `you hold no lock ${name}`);
      break;
    }
    case "locks": {
      const held = await board.locks();
      const listening = new Map(held.map((l) => [l.name, portListeners(l.name)?.pids ?? null]));
      emit({ locks: held.map((l) => ({ ...l, listening: listening.get(l.name) ?? null })) }, () => {
        if (!held.length) console.log("no lock held");
        for (const l of held) console.log(lockLine(l, listening.get(l.name) ?? null));
      });
      break;
    }
    case "status": {
      const runs = await board.runs();
      const membersOf = async (r) => (await board.roster(r.repo)).filter((m) => m.run === r.id).map((m) => ({ name: m.name, nick: m.nick, worktree: m.worktree, state: m.state, activity: m.activity, progressAt: m.progressAt, aliveAt: m.aliveAt, files: m.held }));
      const cli = self().join(" ");
      const open = await Promise.all(
        runs.map(async (r) => {
          const lastActivity = await board.lastActivity(r.id);
          const idleMs = Date.now() - Date.parse(lastActivity);
          return { run: r.id, kind: r.kind, protocol: r.protocol ?? null, group: r.plan, title: r.title, phase: r.phase, progress: await board.phaseProgress(r.id), members: await membersOf(r), lastActivity, forgotten: idleMs >= FORGOTTEN_MS, idleMs };
        })
      );
      const held = await board.locks();
      emit({ home: DATA_ROOT, sqlite: SQLITE_PATH, runs: runs.length, open: open.map(({ idleMs: _, ...o }) => o), locks: held }, () => {
        console.log(`home    ${DATA_ROOT}`);
        console.log(`sqlite  ${SQLITE_PATH}`);
        for (const l of held) console.log(`lock    ${lockLine(l, null)}`);
        if (!runs.length) console.log("no open run");
        for (const [i, r] of runs.entries()) {
          console.log(`run ${r.id}  ${r.kind}  ${r.plan}  ${r.title}${phaseSuffix(r.phase, open[i].progress)}  ${r.repo}`);
          for (const s of r.seats) console.log(`  ${s.id} ${s.state}${s.role ? `  ${s.role}` : ""}${s.blockers.length ? `  blocked by ${s.blockers.join(", ")}` : ""}`);
          for (const m of open[i].members) {
            const files = heldLine(m.files);
            console.log(`  ${m.name}  ${stateLine(m, true)}${files ? `  files: ${files}` : ""}`);
          }
          const idle = open[i].idleMs;
          if (idle >= FORGOTTEN_MS)
            console.log(`  no activity for ${Math.floor(idle / 864e5)} d: likely left open; ask the person, then archive it: ${cli} close --run ${r.id}`);
        }
      });
      break;
    }
    default:
      fail(USAGE);
  }
}
if (!args.verb) {
  console.error(USAGE);
  process.exit(1);
}
if (args.verb === "stats" && args.has("--help")) {
  console.log(STATS_USAGE);
  process.exit(0);
}
if ((args.verb === "serve" || args.verb === "link") && (args.has("--help") || args.has("-h"))) {
  console.log(
    args.verb === "serve" ? "usage: swarm serve [stop]   # the board server of the data home, started on demand by any verb; `serve stop` ends it" : "usage: swarm link --run <id> --as <member>   # a member's link, started by its agent from the line join or open prints"
  );
  process.exit(0);
}
if (args.verb === "--help") {
  console.log(args.positional[0] === "code" ? CODE_USAGE : USAGE);
  process.exit(0);
}
if (args.verb === "link") {
  try {
    const member = { name: args.flag("--as") ?? "", run: Number(args.flag("--run")) };
    await runLink({ dataRoot: DATA_ROOT, member: member.name, run: member.run, binding: bindingOf(member) });
    process.exit(0);
  } catch (e) {
    console.error(`swarm link: ${e.message}`);
    process.exit(1);
  }
}
if (args.verb === "serve") {
  const { startBoardServer: startBoardServer2, stopBoardServer: stopBoardServer2, onBoardServerClosed: onBoardServerClosed2 } = await Promise.resolve().then(() => (init_server(), server_exports));
  if (args.positional[0] === "stop") process.exit(await stopBoardServer2(DATA_ROOT) ? 0 : 1);
  const server = await startBoardServer2({ dataRoot: DATA_ROOT });
  onBoardServerClosed2(DATA_ROOT, () => process.exit(0));
  console.log(server.url);
} else {
  try {
    if (args.verb !== "poll") board = await connectBoard({ dataRoot: DATA_ROOT });
    await main();
    if (linkToStart) (asJson ? console.error : console.log)(startLinkLine(linkToStart));
  } catch (e) {
    const said = e.message;
    console.error(e instanceof CliError || said.startsWith("swarm: ") ? said : `swarm: ${said}`);
    process.exitCode = 1;
  } finally {
    board?.close();
  }
}
export {
  DELIVERED_LINE
};
