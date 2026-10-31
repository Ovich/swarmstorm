// The board page's view model (plan D1, D7, D8, D13-D16, D18, D20), on snapshots built here.
import { describe, expect, test } from "vitest";
import type { BoardSnapshot, RunSummary, SnapshotEvent, SnapshotMember } from "../../swarm-board/src/client/reader.ts";
import { agents, archive, claimRows, conversation, feed, filters, flagAnswer, flagOf, mentionCtx, mergedFileRows, mergedRecipients, narrow, pauseChip, runTabs, type Item } from "./lib/board/view.ts";
import { PHASE, PHASED } from "./board-fixtures.ts";

const AT = "2026-10-14T10:00:00Z";
const run = (id: number, group: string, code: string, open = true): RunSummary => ({
  run: id, kind: "plan", plan: group, group, code, title: `${group} title`, link: null, open, members: 0, done: 1, of: 3,
});
const member = (group: string, seat: string, nick: string, state: SnapshotMember["state"] = "working"): SnapshotMember => ({ badge: undefined as unknown as null /* an older board: no badge, its liveness says the trouble */,
  member: `${group}/${seat}`, nick, plan: group, seat, role: seat, doing: "", state, stale: false,
  files: [], joined: AT, ended: null, calls: 0, listening: false, lastCall: AT,
});
let seq = 0;
const item = (runId: number, from: string, body: string, over: Partial<SnapshotEvent> = {}): SnapshotEvent => ({
  seq: ++seq, at: AT, kind: "msg", from, body, about: null, run: runId, channel: runId, ...over,
});
const board = (runs: RunSummary[], roster: SnapshotMember[] = [], events: SnapshotEvent[] = [], files: BoardSnapshot["files"] = []): BoardSnapshot => ({
  repo: "/r/.git", name: "r", runs, lock: null, lockHistory: [], roster, events, queues: {}, files, flags: [],
});

// alpha (AL, run 1) and beta (BE, run 2) open, gamma (GA, run 3) closed
const RUNS = [run(1, "alpha", "AL"), run(2, "beta", "BE"), run(3, "gamma", "GA", false)];
const ROSTER = [
  member("alpha", "S1", "Sleepy Otter"),
  member("alpha", "orchestrator", "Calm Owl"),
  member("beta", "S2", "Brave Badger"),
  member("beta", "orchestrator", "Proud Lynx"),
  member("gamma", "orchestrator", "Wise Crow", "ended"),
];
const bodies = (items: Item[]): string[] => items.map((i) => i.text);
const one = (items: Item[], text: string): Item => {
  const found = items.find((i) => i.text === text);
  if (!found) throw new Error(`no item ${text}`);
  return found;
};

/** plan D55: a stall or lost row holds while the board's badge says so; the roster with those badges set. */
const badged = (badges: Record<string, string>) =>
  [...ROSTER, ...(badges["alpha/S9"] ? [member("alpha", "S9", "Tidy Wombat")] : [])].map((r) => (badges[r.member] ? { ...r, badge: { name: badges[r.member], reason: "x", since: null } } : r)) as SnapshotMember[];

describe("runTabs", () => {
  test("the open runs in opening order; a closed run has none", () => {
    expect(runTabs(board([run(5, "e", "EE"), ...RUNS])).map((t) => [t.run, t.code, t.state])).toEqual([
      [1, "AL", "live"],
      [2, "BE", "live"],
      [5, "EE", "live"],
    ]);
  });

  test("a run whose orchestrator is quiet reads quiet until it is back (D15)", () => {
    const quiet = item(1, "alpha/orchestrator", "quiet 12 min", { kind: "event", event: "quiet" } as unknown as Partial<SnapshotEvent>);
    expect(runTabs(board(RUNS, ROSTER, [quiet]))[0].state).toBe("quiet");
    const back = item(1, "alpha/orchestrator", "back", { kind: "event", event: "back" } as unknown as Partial<SnapshotEvent>);
    expect(runTabs(board(RUNS, ROSTER, [quiet, back]))[0].state).toBe("live");
  });
});

describe("conversation: the pick (D1, D14)", () => {
  const events = [
    item(1, "alpha/S1", "alpha talk"),
    item(2, "beta/S2", "beta talk"),
    item(2, "beta/S2", "@AL·S1 your schema"),
    item(2, "beta/S2", "the flag", { kind: "event", event: "flag", about: "a.ts", mentions: ["alpha/S1", "beta/S2"] }),
    item(3, "gamma/orchestrator", "gamma talk"),
  ];
  const snap = board(RUNS, ROSTER, events);

  test("All: every open run's items, none of a closed run", () => {
    expect(bodies(conversation(snap, { run: null, follow: null }))).toEqual(["alpha talk", "beta talk", "@AL·S1 your schema", "the flag"]);
  });

  test("a run's tab: its items and the items naming its members, a flag naming one included", () => {
    expect(bodies(conversation(snap, { run: 1, follow: null }))).toEqual(["alpha talk", "@AL·S1 your schema", "the flag"]);
    expect(bodies(conversation(snap, { run: 2, follow: null }))).toEqual(["beta talk", "@AL·S1 your schema", "the flag"]);
  });

  test("a closed run's tab shows its own items", () => {
    expect(bodies(conversation(snap, { run: 3, follow: null }))).toEqual(["gamma talk"]);
  });

  test("following a member narrows to its items and those naming it", () => {
    expect(bodies(conversation(snap, { run: 1, follow: "alpha/S1" }))).toEqual(["alpha talk", "@AL·S1 your schema"]);
  });

  test("an item carries its stored run, labelled by it", () => {
    expect(conversation(snap, { run: null, follow: null }).map((i) => i.run)).toEqual([1, 2, 2, 2]);
  });
});

describe("conversation: what an item is (D8, D16)", () => {
  const FILES = [{ path: "a.ts", holders: ["alpha/S1"], interface: false }];

  test("a held file: a post --about a path mentioning its holder, by a member not holding it; answered once the holder posts about it", () => {
    const ask = item(2, "beta/S2", "@AL·S1 I add one call in a.ts", { about: "a.ts" });
    const open = conversation(board(RUNS, ROSTER, [ask], FILES), { run: null, follow: null });
    expect(open[0]).toMatchObject({ kind: "held", tier: "wait", word: "held file", state: null });
    const answer = item(1, "alpha/S1", "@BE·S2 fine, after mine", { about: "a.ts" });
    const answered = conversation(board(RUNS, ROSTER, [ask, answer], FILES), { run: null, follow: null });
    expect(answered[0]).toMatchObject({ kind: "held", word: "held file · answered", state: "answered" });
  });

  test("a swarm stopped shows only while live, as one row, the latest; one something came after leaves the thread", () => {
    const stall = (s: number) => item(1, "alpha/orchestrator", `stopped alpha: no member's tokens moved for ${s} min; phase draft 1/2 done`, { kind: "event", event: "stopped" } as Partial<SnapshotEvent>);
    const live = conversation(board(RUNS, ROSTER, [item(1, "alpha/S1", "a post"), stall(10), stall(20), stall(30)]), { run: 1, follow: null });
    expect(live.map((i) => i.kind)).toEqual(["message", "stalled"]);
    expect(live[1].text).toBe("stopped alpha: no member's tokens moved for 30 min; phase draft 1/2 done");
    expect(live[1]).toMatchObject({ word: "◷ swarm stopped" });
    const passed = conversation(board(RUNS, ROSTER, [stall(5), stall(10), item(1, "alpha/S1", "back")]), { run: 1, follow: null });
    expect(passed.map((i) => i.kind)).toEqual(["message"]);
  });

  /** An item's word; a phase row has none. */
  const wordOf = (i: Item): string | null => ("word" in i ? i.word : null);

  test("idea 1: an older board's gone renders as its own row while the badge says lost (I2)", () => {
    const gone = item(1, "alpha/orchestrator", "gone alpha/S1: its link was lost", { kind: "event", event: "gone" } as unknown as Partial<SnapshotEvent>);
    const alone = conversation(board(RUNS, badged({ "alpha/S1": "lost" }), [gone]), { run: 1, follow: null });
    expect(alone.map((i) => [i.kind, wordOf(i)])).toEqual([["gone", "✕ S1 gone"]]);
  });

  test("D51 (U-F11): a board alarm is the board's, about its subject: its header names the member, following the orchestrator leaves it out", () => {
    const alarm = item(1, "swarm", "lost alpha/S9: its link was lost", { kind: "event", event: "lost", subject: "alpha/S9" } as Partial<SnapshotEvent>);
    const said = item(1, "alpha/orchestrator", "@S1 rebase");
    const all = conversation(board(RUNS, badged({ "alpha/S9": "lost" }), [alarm, said]), { run: 1, follow: null });
    expect(all.map((i) => [i.kind, i.from, wordOf(i)])).toEqual([["gone", "swarm", "✕ S9 lost"], ["message", "alpha/orchestrator", null]]);
    expect(conversation(board(RUNS, badged({ "alpha/S9": "lost" }), [alarm, said]), { run: 1, follow: "alpha/orchestrator" }).map((i) => i.kind)).toEqual(["message"]);
    expect(conversation(board(RUNS, badged({ "alpha/S9": "lost" }), [alarm, said]), { run: 1, follow: "alpha/S9" }).map((i) => i.kind)).toEqual(["gone"]);
  });

  test("a post about a path by its holder, or naming no holder, is a plain message", () => {
    const own = item(1, "alpha/S1", "@BE·S2 I change a.ts", { about: "a.ts" });
    const nobody = item(2, "beta/S2", "about a.ts in general", { about: "a.ts" });
    const items = conversation(board(RUNS, ROSTER, [own, nobody], FILES), { run: null, follow: null });
    expect(items.map((i) => i.kind)).toEqual(["message", "message"]);
  });

  test("a question: a post opening @orchestrator new question:, answered once the orchestrator answers its author", () => {
    const q = item(1, "alpha/S1", "@orchestrator new question: keep the old route?");
    const open = conversation(board(RUNS, ROSTER, [q]), { run: null, follow: null });
    expect(open[0]).toMatchObject({ kind: "question", tier: "wait", word: "? question for AL·orchestrator Calm Owl", state: null });
    const a = item(1, "alpha/orchestrator", "@S1 keep it");
    expect(conversation(board(RUNS, ROSTER, [q, a]), { run: null, follow: null })[0]).toMatchObject({ state: "answered" });
  });

  test("the tiers and their words: act now, waiting, decided, talk, and a board event", () => {
    const events = [
      item(1, "alpha/orchestrator", "do this first", { kind: "urgent" }),
      item(1, "alpha/S1", "flag", { kind: "event", event: "flag", about: "a.ts", mentions: ["beta/S2", "alpha/S1"] }),
      item(1, "alpha/orchestrator", "quiet 12 min", { kind: "event", event: "quiet" } as unknown as Partial<SnapshotEvent>),
      item(2, "beta/S2", "@AL·S1 S1 the top, S2 the bottom", { kind: "agreement" }),
      item(1, "alpha/S1", "just talk"),
      item(1, "alpha/S1", "merged abc: rebase your branch onto it.", { kind: "event", event: "merged" }),
    ];
    const items = conversation(board(RUNS, ROSTER, events), { run: null, follow: null });
    expect(items.map((i) => (i.kind === "event" || i.kind === "phase" ? [i.kind, null, null] : [i.kind, i.tier, i.word]))).toEqual([
      ["urgent", "act", "! urgent"],
      ["flag", "act", "⚑ flag · open"],
      ["quiet", "wait", "◷ quiet 12 min"],
      ["agreement", "decided", "✔ agreed with AL·S1 Sleepy Otter"],
      ["message", "talk", null],
      ["event", null, null],
    ]);
    expect(items.every((i) => i.kind === "phase" || i.tip !== null || i.kind === "message")).toBe(true);
  });

  test("a flag settled by an agreement about its path reads decided; an endorsed agreement says so", () => {
    const flag = item(1, "alpha/S1", "flag", { kind: "event", event: "flag", about: "a.ts", mentions: ["beta/S2", "alpha/S1"] });
    const agreed = item(2, "beta/S2", "@AL·S1 S1 the top", { kind: "agreement", about: "a.ts" });
    const endorsed = item(1, "alpha/orchestrator", `endorses #${agreed.seq}`, { kind: "endorsement", about: "a.ts" });
    const items = conversation(board(RUNS, ROSTER, [flag, agreed, endorsed]), { run: null, follow: null });
    expect(items[0]).toMatchObject({ kind: "settled", tier: "decided", word: `⚑ flag settled by #${agreed.seq}` });
    expect(items[1]).toMatchObject({ kind: "agreement", word: "✔ agreed with AL·S1 Sleepy Otter, endorsed", state: "endorsed" });
  });

  test("consecutive messages of one member join; another member between them breaks the run", () => {
    const events = [item(1, "alpha/S1", "one"), item(1, "alpha/S1", "two"), item(2, "beta/S2", "three"), item(1, "alpha/S1", "four")];
    const items = conversation(board(RUNS, ROSTER, events), { run: null, follow: null });
    expect(items.map((i) => (i.kind === "event" || i.kind === "phase" ? null : i.joined))).toEqual([false, true, false, false]);
  });
});

describe("archive (D18)", () => {
  const closed = [run(3, "gamma", "GA", false), run(4, "delta", "DE", false)];
  const snap = board([...RUNS.slice(0, 2), ...closed], ROSTER, [
    item(3, "gamma/orchestrator", "run 3 closed", { kind: "event", event: "closed", at: "2026-10-14T09:00:00Z" }),
    item(4, "delta/orchestrator", "run 4 closed", { kind: "event", event: "closed", at: "2026-10-14T11:00:00Z" }),
  ]);

  test("every closed run, newest first, with its closing time, seats and orchestrator", () => {
    const a = archive(snap, "");
    expect(a.map((r) => r.run)).toEqual([4, 3]);
    expect(a[1]).toMatchObject({ code: "GA", closed: "2026-10-14T09:00:00Z", done: 1, of: 3, orchestrator: "Wise Crow", outcome: null });
  });

  test("matched on title, code and orchestrator, without case", () => {
    expect(archive(snap, "DELTA").map((r) => r.run)).toEqual([4]);
    expect(archive(snap, "ga").map((r) => r.run)).toEqual([3]);
    expect(archive(snap, "wise").map((r) => r.run)).toEqual([3]);
    expect(archive(snap, "nothing")).toEqual([]);
  });
});

describe("agents (D7, D20)", () => {
  test("a run's members, orchestrator first; a closed run's too", () => {
    expect(agents(board(RUNS, ROSTER), 1).map((m) => m.member)).toEqual(["alpha/orchestrator", "alpha/S1"]);
    expect(agents(board(RUNS, ROSTER), 3).map((m) => m.member)).toEqual(["gamma/orchestrator"]);
    expect(agents(board(RUNS, ROSTER), 9)).toEqual([]);
  });

  test("two runs of one group: each shows its own members, never the other's ended ones", () => {
    const runs = [run(5, "same", "SA", false), run(6, "same", "SA")];
    const roster = [
      { ...member("same", "orchestrator", "Old Owl", "ended"), run: 5 },
      { ...member("same", "judge", "Old Hare", "ended"), run: 5 },
      { ...member("same", "orchestrator", "New Owl", "working"), run: 6 },
    ];
    expect(agents(board(runs, roster), 6).map((m) => m.nick)).toEqual(["New Owl"]);
    expect(agents(board(runs, roster), 5).map((m) => m.nick)).toEqual(["Old Owl", "Old Hare"]);
  });
});

describe("claimRows (D7)", () => {
  const files = [
    { path: "a.ts", holders: ["alpha/S1", "beta/S2"], interface: true },
    { path: "b.ts", holders: ["beta/S2"], interface: false },
  ];
  test("every held file under All, a run's under its tab; a file of two holders is shared", () => {
    const snap = board(RUNS, ROSTER, [], files);
    expect(claimRows(snap, null)).toEqual([
      { path: "a.ts", holders: ["alpha/S1", "beta/S2"], shared: true },
      { path: "b.ts", holders: ["beta/S2"], shared: false },
    ]);
    expect(claimRows(snap, 1)!.map((r) => r.path)).toEqual(["a.ts"]);
    expect(claimRows(snap, 99)).toEqual([]);
  });

  test("V-19: a brainswarm run has no claims row; a code run keeps it", () => {
    const roster = [member("alpha", "S1", "Old Owl", "working")];
    const held = [{ path: "a.ts", holders: ["alpha/S1"], interface: false }];
    expect(claimRows(board([{ ...run(1, "alpha", "AL"), kind: "brainstorm" }], roster, [], held), 1)).toBeNull();
    expect(claimRows(board([run(1, "alpha", "AL")], roster, [], held), 1)!.map((r) => r.path)).toEqual(["a.ts"]);
  });

  test("two runs of one group: a run's tab shows only what its own members hold", () => {
    const runs = [run(5, "same", "SA"), run(6, "same", "SA")];
    const roster = [
      { ...member("same", "S1", "Old Owl", "working"), run: 5 },
      { ...member("same", "S2", "New Owl", "working"), run: 6 },
    ];
    const held = [
      { path: "old.ts", holders: ["same/S1"], interface: false },
      { path: "new.ts", holders: ["same/S2"], interface: false },
    ];
    expect(claimRows(board(runs, roster, [], held), 6)!.map((r) => r.path)).toEqual(["new.ts"]);
    expect(claimRows(board(runs, roster, [], held), 5)!.map((r) => r.path)).toEqual(["old.ts"]);
  });
});

describe("flags (D10)", () => {
  const P = "a.ts";
  const at = (s: number, kind: SnapshotEvent["kind"], from: string, body: string, about: string | null = P): SnapshotEvent => ({
    seq: s, at: AT, kind, from, body, about, run: 1, channel: 1,
  });
  const flagBody = "@p/S2 @p/S1 flag: p/S1 wrote a.ts outside its claim; p/S2 holds it. Settle it here.";
  const oldFlag = at(10, "msg", "p/S1", flagBody);
  const newFlag = at(20, "event", "p/S1", flagBody);
  const events = [
    at(5, "msg", "p/S1", "before the flag"),
    oldFlag,
    at(11, "msg", "p/S9", "a bystander on a.ts"),
    at(12, "msg", "p/S2", "@S1 I keep the top half"),
    at(13, "agreement", "p/S2", "S1 the bottom, S2 the top"),
    at(14, "msg", "p/S1", "elsewhere", "b.ts"),
    newFlag,
  ];

  test("a flag is read from its body, as an old message or the flag event", () => {
    expect(flagOf(oldFlag)).toEqual({ writer: "p/S1", path: P, holder: "p/S2" });
    expect(flagOf(newFlag)).toEqual({ writer: "p/S1", path: P, holder: "p/S2" });
    expect(flagOf(events[0])).toBeNull();
  });

  test("a flag event is read from its event name and mentions first, whatever its body (D11)", () => {
    const named: SnapshotEvent = { ...at(30, "event", "p/S1", "reworded"), event: "flag", mentions: ["p/S2", "p/S1"] };
    expect(flagOf(named)).toEqual({ writer: "p/S1", path: P, holder: "p/S2" });
    expect(flagOf({ ...at(31, "event", "p/S1", "merged x: rebase your branch onto it."), event: "merged", mentions: [] })).toBeNull();
  });

  test("Flags shows the flags and the posts answering them, and counts the flags", () => {
    const f = filters(events).find((x) => x.id === "flags")!;
    expect(f.label).toBe("Flags");
    expect(events.filter(f.test).map((e) => e.seq)).toEqual([10, 12, 13, 20]);
    expect(events.filter(f.counts!).length).toBe(2);
    expect(filters(events.slice(0, 1)).some((x) => x.id === "flags")).toBe(false);
  });

  test("settled by an agreement, answered by a post, open otherwise", () => {
    expect(flagAnswer(oldFlag, events)).toEqual({ state: "settled", seq: 13 });
    expect(flagAnswer(oldFlag, events.filter((e) => e.kind !== "agreement"))).toEqual({ state: "answered", seq: 12 });
    expect(flagAnswer(newFlag, events)).toEqual({ state: "open" });
  });
});

describe("the filters and the feed (kept for the filter row's return)", () => {
  test("Everything shows all, Messages only drops board events, Agreements keeps agreements; following narrows", () => {
    const events = [
      item(1, "alpha/S1", "talk"),
      item(1, "alpha/S1", "joined: x", { kind: "event" }),
      item(2, "beta/S2", "@AL·S1 agreed", { kind: "agreement" }),
      item(2, "beta/S2", "beta alone"),
    ];
    const ctx = mentionCtx(board(RUNS, ROSTER, events));
    expect(feed(events, "all", null, ctx).length).toBe(4);
    expect(feed(events, "talk", null, ctx).map((e) => e.body)).toEqual(["talk", "@AL·S1 agreed", "beta alone"]);
    expect(feed(events, "agreements", null, ctx).map((e) => e.body)).toEqual(["@AL·S1 agreed"]);
    expect(feed(events, "all", "alpha/S1", ctx).map((e) => e.body)).toEqual(["talk", "joined: x", "@AL·S1 agreed"]);
  });
});

describe("mergedFileRows: a closed run's files", () => {
  const merged = (runId: number, from: string, files: string): SnapshotEvent =>
    item(runId, from, `merged abc: rebase your branch onto it.\nfiles: ${files}`, { kind: "event", event: "merged" });

  test("each path once, first-merged order, with every member that merged it", () => {
    const events = [
      merged(3, "gamma/S1", "a.ts, b.ts"),
      merged(3, "gamma/S2", "b.ts, c.ts"),
      merged(3, "gamma/S1", "a.ts"),
      merged(1, "alpha/S1", "z.ts"),
      merged(3, "gamma/S3", "-"),
      item(3, "gamma/S1", "files: not.ts"),
    ];
    expect(mergedFileRows(board(RUNS, ROSTER, events), 3)).toEqual([
      { path: "a.ts", mergers: ["gamma/S1"] },
      { path: "b.ts", mergers: ["gamma/S1", "gamma/S2"] },
      { path: "c.ts", mergers: ["gamma/S2"] },
    ]);
  });

  test("a run with no merge has none", () => {
    expect(mergedFileRows(board(RUNS, ROSTER, []), 3)).toEqual([]);
  });
});

describe("a merged event's recipients", () => {
  test("rebase from the holders line, tell from the author's resolved-conflict posts before its next merge", () => {
    const merged: SnapshotEvent = {
      seq: 1, at: AT, kind: "event", from: "p/S1", run: 1, channel: 1, about: null,
      body: "merged abc: rebase onto abc.\n@p/S2 @p/S3: you hold or declared a file it changed.\nfiles: a.ts",
    };
    const after = (s: number, from: string, body: string, kind: SnapshotEvent["kind"] = "msg"): SnapshotEvent => ({ ...merged, seq: s, from, body, kind });
    const events = [
      merged,
      after(2, "p/S1", "@p/S2 I resolved a.ts: kept both"),
      after(3, "p/S9", "@p/S4 I resolved b.ts: x"),
      after(4, "p/S1", "merged def: rebase onto def.", "event"),
      after(5, "p/S1", "@p/S3 I resolved c.ts: y"),
    ];
    const ctx = mentionCtx(board([run(1, "p", "PP")]));
    expect(mergedRecipients(merged, events, ctx)).toEqual({ rebase: ["p/S2", "p/S3"], tell: ["p/S2"] });
  });

  test("the recipients stored with the event win over the thread (D11)", () => {
    const merged: SnapshotEvent = {
      seq: 1, at: AT, kind: "event", from: "p/S1", run: 1, channel: 1, about: null, event: "merged", mentions: ["p/S2"],
      body: "merged abc into main: rebase your branch onto it.\n@p/S2: you hold or declared a file it changed.\nfiles: a.ts",
      meta: { rebase: ["p/S2"], tell: ["p/S7"] },
    };
    const ctx = mentionCtx(board([run(1, "p", "PP")]));
    expect(mergedRecipients(merged, [merged], ctx)).toEqual({ rebase: ["p/S2"], tell: ["p/S7"] });
  });
});

describe("a phase separator (swarm phase)", () => {
  const NM = PHASED.runs.find((r) => r.code === "NM")!;

  test("a phase event is a phase item: its name from the meta, its text after the colon", () => {
    const items = conversation(PHASED, { run: NM.run, follow: null });
    const phase = items.find((i) => i.kind === "phase");
    expect(phase).toMatchObject({ kind: "phase", seq: PHASE.seq, name: "diverge", text: "every name a run could carry, no judgment yet", from: "naming/orchestrator" });
  });

  test("a phase from a row with no meta reads its name from the body", () => {
    const old = { ...PHASE, meta: null };
    const items = conversation({ ...PHASED, events: [old] }, { run: NM.run, follow: null });
    expect(items[0]).toMatchObject({ kind: "phase", name: "diverge" });
  });

  test("every kind chip and a file keep the separator", () => {
    const items = conversation(PHASED, { run: NM.run, follow: null });
    for (const kind of ["messages", "agreements", "flags"] as const) expect(narrow(items, { kind, file: null }).some((i) => i.kind === "phase"), kind).toBe(true);
    expect(narrow(items, { kind: "all", file: "src/nowhere.ts" }).map((i) => i.kind)).toEqual(["phase"]);
  });

  test("following a member of the run keeps its separator; a member of another run does not see it", () => {
    expect(conversation(PHASED, { run: null, follow: "naming/critic" }).some((i) => i.kind === "phase")).toBe(true);
    const other = { ...PHASED, runs: [...PHASED.runs, run(9, "beta", "BE")], roster: [...PHASED.roster, member("beta", "S2", "Brave Badger")] };
    expect(conversation(other, { run: null, follow: "beta/S2" }).some((i) => i.kind === "phase")).toBe(false);
    expect(conversation(other, { run: 9, follow: null }).some((i) => i.kind === "phase")).toBe(false);
  });
});

test("idea 2, B12: the run header's chip says On you for a pause --person, Paused for the orchestrator's (D57)", () => {
  expect(pauseChip({ ...run(1, "alpha", "AL"), paused: { text: "approve idea 1", person: true } })).toEqual({ label: "On you", reason: "approve idea 1" });
  expect(pauseChip({ ...run(1, "alpha", "AL"), paused: { text: "hold on", person: false } })).toEqual({ label: "Paused", reason: "hold on" });
  expect(pauseChip({ ...run(1, "alpha", "AL"), paused: { text: "", person: false } })).toEqual({ label: "Paused", reason: null });
  expect(pauseChip(run(1, "alpha", "AL"))).toBeNull();
});

describe("idea 2, B13 (F9): a member's lost row leaves once its badge does", () => {
  const kinds = (roster: SnapshotMember[], events: SnapshotEvent[]) => conversation(board(RUNS, roster, events), { run: 1, follow: null }).map((i) => i.kind);

  // board-split#D36: the board's `lost` event and badge; the badge, when sent, says whether the member is still lost
  test("a lost row stays while the board's badge says lost, and leaves once the badge is gone", () => {
    const lost = () => item(1, "alpha/orchestrator", "lost alpha/S1: its link was lost", { kind: "event", event: "lost" } as Partial<SnapshotEvent>);
    const withBadge = (badge: object | null) => ROSTER.map((r) => (r.member === "alpha/S1" ? { ...r, badge } : r)) as SnapshotMember[];
    expect(kinds(withBadge({ name: "lost", reason: "its link was lost", since: null }), [lost()])).toEqual(["gone"]);
    expect(kinds(withBadge(null), [lost()])).toEqual([]);
  });
});
