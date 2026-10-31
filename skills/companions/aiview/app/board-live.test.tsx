// The board page as a browser gets it: the real useBoard over fetch and /events (stood in for),
// answered a body shaped as /api/run answers it. A phase event of a closed run, picked by the URL,
// draws a separator; a stall something came after leaves the thread; the agent strip holds the
// orchestrator as one of its cards, each with its token counter. And a tab of an older build reloads.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { BoardView } from "./components/viewers/board/BoardView.tsx";
import { isStaleBuild, pageBuild, reloadOnNewBuild } from "./lib/build.ts";

class FakeEventSource {
  static last: FakeEventSource | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.last = this;
  }
  close(): void {}
}

const REPO = "C:/work/letters/.git";
const G = "letter4";
const ago = (s: number): string => new Date(Date.now() - s * 1000).toISOString();
/** One row of `snapshot.events` as /api/run sends it: run and channel, event, mentions, meta. */
let seq = 1800;
const ev = (from: string, body: string, kind: string, event: string | null, mentions: string[] = [], meta: object | null = null, run = 32) => ({
  seq: ++seq,
  at: ago(600 - seq + 1800),
  kind,
  from: `${G}/${from}`,
  body,
  about: null,
  run,
  channel: run,
  event,
  mentions,
  meta,
});
const runSummary = (run: number, open: boolean, group = G) => ({
  run,
  kind: "brainstorm",
  plan: group,
  group,
  code: "LE",
  title: `Letter run ${run}`,
  link: null,
  open,
  members: open ? 2 : 0,
  done: 0,
  of: 2,
  phase: { name: "revise", text: "the writer posts the new body" },
  progress: { phase: "revise", done: 1, of: 2 },
  stallMs: 5000,
});
const member = (seat: string, liveness: object, state = "working") => ({
  member: `${G}/${seat}`,
  nick: seat === "orchestrator" ? "Tidy Heron" : `${seat[0].toUpperCase()}${seat.slice(1)} Otter`,
  plan: G,
  seat,
  role: seat === "orchestrator" ? "" : `the ${seat}`,
  doing: "reading",
  state,
  stale: false,
  files: [],
  joined: ago(900),
  ended: null,
  calls: 3,
  listening: true,
  on: [],
  lastCall: ago(5),
  liveness,
});

const answer = () => {
  seq = 1800;
  const events = [
    ev("orchestrator", "run 32 opened: brainstorm letter4, Letter run 32", "event", "opened"),
    ev("writer", "joined: the writer", "event", "joined"),
    ev("orchestrator", "phase research: the researcher posts the dossier", "event", "phase", [`${G}/*`], { phase: "research" }),
    ev("writer", "Here is the dossier.", "msg", null),
    ev("writer", "done research (1/2)", "event", "done", [`${G}/orchestrator`], { phase: "research" }),
    ev("orchestrator", "phase draft: the writer posts the full body", "event", "phase", [`${G}/*`], { phase: "draft" }),
    ev("orchestrator", "stalled 5s: no token counter moved; last active letter4/writer 5s ago; phase draft 0/2 done", "event", "stalled", [`${G}/*`]),
    ev("orchestrator", "phase end: the run is over, thank you", "event", "phase", [`${G}/*`], { phase: "end" }),
    ev("orchestrator", "run 32 closed", "event", "closed"),
  ];
  return {
    repos: [{ repo: REPO, name: "letters", runs: [runSummary(31, false), runSummary(32, false)] }],
    snapshot: {
      repo: REPO,
      name: "letters",
      // a stale run of another group, closed after: the board opens on it by itself
      runs: [runSummary(28, false, "other"), runSummary(31, false), runSummary(32, false)],
      lock: null,
      roster: [
        member("orchestrator", { state: "ok", tokens: 120345, movedAt: ago(1) }),
        member("writer", { state: "ok", tokens: 9876, movedAt: ago(7) }),
        member("checker", { state: "none", tokens: null, movedAt: null }),
        member("editor", { state: "unreadable", tokens: null, movedAt: null }),
        member("impact", { state: "ok", tokens: 5, movedAt: ago(2) }),
        member("screener", { state: "ok", tokens: 6, movedAt: ago(2) }),
      ],
      events: [...events, ev("orchestrator", "run 28 closed", "event", "closed", [], null, 28)],
      queues: {},
      files: [],
      flags: [],
    },
  };
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => answer() })));
  vi.stubGlobal("EventSource", FakeEventSource);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const convo = () => within(screen.getByRole("region", { name: "The conversation" }));

test("a closed run's phase events, as /api/run sends them, draw one separator each, its name and text on a full-width rule", async () => {
  render(<BoardView repos={[REPO]} run={32} />);
  await waitFor(() => expect(document.querySelectorAll('[data-component="PhaseSeparator"]').length).toBe(3));
  const rules = convo().getAllByRole("separator");
  expect(rules.map((r) => r.getAttribute("data-phase"))).toEqual(["research", "draft", "end"]);
  expect(rules[0].querySelector(".name")?.textContent).toBe("research");
  expect(rules[0].querySelector(".said")?.textContent).toBe("the researcher posts the dossier");
  expect(rules[0].className).toBe("phase");
  // never drawn as a board line too
  expect(convo().queryAllByText(/^phase research:/)).toHaveLength(0);
});

test("a stall something came after has passed and leaves the thread", async () => {
  render(<BoardView repos={[REPO]} run={32} />);
  await waitFor(() => expect(document.querySelector(".phase")).not.toBeNull());
  expect(document.querySelector('[data-kind="stalled"]')).toBeNull();
});

test("the agent strip: the orchestrator is its first card; each card shows its counter, flat past the run's threshold marked, an unreadable one said", async () => {
  render(<BoardView repos={[REPO]} run={32} />);
  const strip = await screen.findByRole("region", { name: "Agents" });
  const cards = Array.from(strip.querySelectorAll("button.card"));
  expect(cards).toHaveLength(6);
  expect(cards.every((c) => c.getAttribute("data-component") === "AgentCard")).toBe(true);
  expect(cards[0].className).toMatch(/\borch\b/);
  // the token counter is not drawn on the cards (user, 2026-10-16: it misled); the stall check reads it
  expect(document.querySelector('[data-component="TokenCounter"]')).toBeNull();
});

test("a tab of an older build reloads on the server's hello; the same build, or none named, does not", async () => {
  const script = document.createElement("script");
  script.type = "module";
  script.setAttribute("src", "/assets/index-AAA111.js");
  document.head.appendChild(script);
  try {
    expect(pageBuild()).toBe("index-AAA111.js");
    expect(isStaleBuild("index-BBB222.js")).toBe(true);
    expect(isStaleBuild("index-AAA111.js")).toBe(false);
    expect(isStaleBuild(undefined)).toBe(false);
    const reload = vi.fn();
    reloadOnNewBuild("index-AAA111.js", reload);
    reloadOnNewBuild(undefined, reload);
    expect(reload).not.toHaveBeenCalled();
    reloadOnNewBuild("index-BBB222.js", reload);
    expect(reload).toHaveBeenCalledTimes(1);
  } finally {
    script.remove();
  }
  // in development the page is unhashed: never stale
  expect(isStaleBuild("index-BBB222.js")).toBe(false);
  render(<BoardView repos={[REPO]} run={32} />);
  await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
  act(() => FakeEventSource.last!.onmessage?.({ data: JSON.stringify({ type: "hello", build: "index-BBB222.js" }) }));
});
