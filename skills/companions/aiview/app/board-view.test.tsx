// The board page (plan D7, D9, D14, D20, D22; prototype #643): useBoard is stood in for with the
// fixtures; each call's selection is recorded, and the snapshot answered is the repository it asks for.
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { BoardSnapshot } from "../../swarm-board/src/client/reader.ts";
import type { BoardState } from "./hooks/useBoard.ts";
import { ALL_CLOSED, APP, BRAINSTORM, CLOSED, LIVE, NICKS, OTHER, PHASED, REPOS, SITE } from "./board-fixtures.ts";

const source = vi.hoisted(() => ({
  calls: [] as { repo: string | null; run: number | null }[],
  boards: {} as Record<string, BoardSnapshot>,
}));
vi.mock("./hooks/useBoard.ts", () => ({
  useBoard: (q: { repo: string | null; run: number | null }): BoardState => {
    source.calls.push(q);
    const all = Object.values(source.boards);
    const snapshot = q.run !== null ? (all.find((b) => b.runs.some((r) => r.run === q.run)) ?? null) : (source.boards[q.repo ?? APP] ?? all[0] ?? null);
    const repos = REPOS.filter((r) => source.boards[r.repo]);
    return snapshot ? { repos, snapshot, error: null, connection: "live" } : { repos, snapshot: null, error: `no run ${q.run} on the board`, connection: "live" };
  },
}));

import { BoardView } from "./components/viewers/board/BoardView.tsx";
import { CLAIMS_EXPANDED_KEY } from "./components/viewers/board/ClaimsRow.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  try {
    localStorage.clear();
  } catch {
    /* none */
  }
  source.calls = [];
});

const show = (repos: string[], run: number | null, boards: BoardSnapshot[] = [LIVE]) => {
  source.boards = Object.fromEntries(boards.map((b) => [b.repo, b]));
  return render(<BoardView repos={repos} run={run} />);
};
const tabs = () => within(screen.getByRole("navigation", { name: "Runs" }));
const pressed = () => tabs().getAllByRole("button").find((b) => b.getAttribute("aria-pressed") === "true");
const convo = () => within(screen.getByRole("region", { name: "The conversation" }));
const strip = () => screen.queryByRole("region", { name: "Agents" });
const tabOf = (title: string) => tabs().getByText(title).closest("button")!;

// ── RunTabs ────────────────────────────────────────────────────────────────────────

test("the tab row: the Archive icon, then each open run with its code, title and slices done/total, a brainstorm its seats; no closed run, no All (SL10)", () => {
  show([APP], null);
  const names = tabs().getAllByRole("button").map((b) => b.textContent);
  expect(names[0]).toBe("");
  expect(tabs().getAllByRole("button")[0].getAttribute("aria-label")).toBe("Archive");
  expect(tabs().queryByText("All")).toBeNull();
  // the run tabs, then the Analytics pill drawn beside the merge lock at the row's end (SL4)
  // a brainstorm's seat rows are seats, never slices to merge: never "0/1"
  expect(names.slice(1, -2)).toEqual(["RTSessions with refresh tokens", "ALAudit log", "NMNaming the kinds"]);
  expect(names.slice(-2)).toEqual(["All runs", "merge lock free"]);
  for (const r of CLOSED) expect(tabs().queryByText(r.title)).toBeNull();
  expect(pressed()).toBe(tabOf("Naming the kinds"));
});

test("a run in the URL picks its tab; the tab keeps its items and those naming its members (D14)", () => {
  show([APP], 1);
  expect(pressed()).toBe(tabOf("Sessions with refresh tokens"));
  expect(convo().getByText(/staying a number/)).toBeTruthy();
  // audit-log's post naming RT·S4 shows under RT
  expect(convo().getByText(/I need one call at the top/)).toBeTruthy();
  expect(convo().queryByText(/reads better than/)).toBeNull();
});

test("picking a tab narrows the conversation to that run", () => {
  show([APP], null);
  fireEvent.click(tabOf("Naming the kinds"));
  expect(pressed()).toBe(tabOf("Naming the kinds"));
  expect(convo().getByText(/reads better than/)).toBeTruthy();
  expect(convo().queryByText(/staying a number/)).toBeNull();
  fireEvent.click(tabOf("Sessions with refresh tokens"));
  expect(convo().getByText(/staying a number/)).toBeTruthy();
});

test("a run's code in its tab carries no tip (D9)", () => {
  show([APP], null);
  const code = tabOf("Audit log").querySelector(".code") as HTMLElement;
  expect(code.textContent).toBe("AL");
  expect(code.closest("[data-tip]")).toBeNull();
});

test("a closed run in the URL opens as an archived tab, read only, × back to the first open run", () => {
  show([APP], 4);
  const archived = screen.getByText("The login page").closest('[data-component="ArchivedTab"]') as HTMLElement;
  expect(archived.getAttribute("aria-pressed")).toBe("true");
  expect(archived.getAttribute("title")).toMatch(/· archived$/);
  expect(convo().getByText(/read only · 4 of 4 slices/)).toBeTruthy();
  expect(convo().getByText(/merged 9f0c1d2/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close the archived run" }));
  expect(pressed()).toBe(tabOf("Sessions with refresh tokens"));
});

test("an unknown run picks no tab and says so", () => {
  show([APP], 99);
  expect(pressed()).toBeUndefined();
  expect(screen.getByText("run 99 is not on this board")).toBeTruthy();
});

// ── ArchivePanel ─────────────────────────────────────────────────────────────────

test("☰ opens the archive: every closed run, newest first; a row picks it as an archived tab", () => {
  show([APP], null);
  fireEvent.click(screen.getByRole("button", { name: "Archive" }));
  const panel = within(screen.getByRole("dialog", { name: "Archive" }));
  expect(panel.getByText(/· 2 closed runs/)).toBeTruthy();
  const rows = panel.getAllByRole("button").filter((b) => b.classList.contains("arow"));
  expect(rows.map((r) => r.querySelector(".code")?.textContent)).toEqual(["TT", "LP"]);
  fireEvent.click(rows[1]);
  expect(screen.queryByRole("dialog", { name: "Archive" })).toBeNull();
  expect(screen.getByText("The login page").closest('[data-component="ArchivedTab"]')).toBeTruthy();
});

test("the archive's search matches title, code and orchestrator", () => {
  show([APP], null);
  fireEvent.click(screen.getByRole("button", { name: "Archive" }));
  const panel = within(screen.getByRole("dialog", { name: "Archive" }));
  const search = panel.getByRole("searchbox");
  const codes = () => panel.queryAllByRole("button").filter((b) => b.classList.contains("arow")).map((r) => r.querySelector(".code")?.textContent);
  fireEvent.change(search, { target: { value: "login" } });
  expect(codes()).toEqual(["LP"]);
  fireEvent.change(search, { target: { value: "tt" } });
  expect(codes()).toEqual(["TT"]);
  fireEvent.change(search, { target: { value: "nothing like it" } });
  expect(panel.getByText("No archived run matches.")).toBeTruthy();
});

test("an archive row carries its kind as a chip: a brainstorm counts seats, a plan its slices", () => {
  show([APP], null);
  fireEvent.click(screen.getByRole("button", { name: "Archive" }));
  const panel = within(screen.getByRole("dialog", { name: "Archive" }));
  const row = (code: string) => panel.getAllByRole("button").find((b) => b.classList.contains("arow") && b.querySelector(".code")?.textContent === code)!;
  const brainstorm = row("TT");
  const chip = brainstorm.querySelector('[data-component="KindChip"]') as HTMLElement;
  expect(chip.textContent).toBe("brainstorm");
  expect(chip.classList.contains("brainstorm")).toBe(true);
  expect(brainstorm.querySelector(".am")?.textContent).toMatch(/^2 seats · /);
  expect(brainstorm.textContent).not.toMatch(/slices/);
  const plan = row("LP");
  const planChip = plan.querySelector('[data-component="KindChip"]') as HTMLElement;
  expect(planChip.textContent).toBe("plan");
  expect(planChip.classList.contains("plan")).toBe(true);
  expect(plan.querySelector(".am")?.textContent).toMatch(/^4\/4 slices · /);
});

test("the archive's search matches the kind", () => {
  show([APP], null);
  fireEvent.click(screen.getByRole("button", { name: "Archive" }));
  const panel = within(screen.getByRole("dialog", { name: "Archive" }));
  const search = panel.getByRole("searchbox");
  const codes = () => panel.queryAllByRole("button").filter((b) => b.classList.contains("arow")).map((r) => r.querySelector(".code")?.textContent);
  fireEvent.change(search, { target: { value: "brainstorm" } });
  expect(codes()).toEqual(["TT"]);
  fireEvent.change(search, { target: { value: "Plan" } });
  expect(codes()).toEqual(["LP"]);
});

test("Escape closes the archive", () => {
  show([APP], null);
  fireEvent.click(screen.getByRole("button", { name: "Archive" }));
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "Archive" })).toBeNull();
});

test("a click outside closes the archive; one inside does not", () => {
  show([APP], null);
  fireEvent.click(screen.getByRole("button", { name: "Archive" }));
  fireEvent.mouseDown(screen.getByRole("searchbox"));
  expect(screen.getByRole("dialog", { name: "Archive" })).toBeTruthy();
  fireEvent.mouseDown(screen.getByRole("region", { name: "The conversation" }));
  expect(screen.queryByRole("dialog", { name: "Archive" })).toBeNull();
});

// ── AgentStrip ───────────────────────────────────────────────────────────────────

test("under a closed run, its members as they ended, a card still followed", () => {
  const was = LIVE.roster.find((r) => r.state === "ended")!;
  const member = (seat: string, state: "ended") => ({ ...was, member: `login-page/${seat}`, nick: `LP ${seat}`, plan: "login-page", seat, state });
  show([APP], 4, [{ ...LIVE, roster: [...LIVE.roster, member("S1", "ended"), member("orchestrator", "ended")] }]);
  const cards = within(strip()!).getAllByRole("button");
  expect(cards.map((c) => c.querySelector(".seat")?.textContent)).toEqual(["orchestrator", `S1 · ${was.role}`]);
  expect(cards.every((c) => c.textContent?.includes("ended"))).toBe(true);
  fireEvent.click(cards[1]);
  expect(cards[1].getAttribute("aria-pressed")).toBe("true");
});

test("under a picked run, its members, orchestrator first, each its mark then its nick, the code·seat its tooltip", () => {
  show([APP], 1);
  const cards = within(strip()!).getAllByRole("button");
  expect(cards[0].querySelector('[data-component="AgentMark"]')?.textContent).toBe("OR");
  expect(cards[0].querySelector('[data-component="AgentLabel"]')?.getAttribute("title")).toBe("RT·orchestrator");
  expect(cards[0].textContent).toContain(NICKS["refresh-tokens/orchestrator"]);
  expect(cards[0].classList.contains("orch")).toBe(true);
  expect(cards.every((c) => c.querySelector('[data-component="MemberTag"]') === null)).toBe(true);
  expect(cards.some((c) => c.textContent?.includes("Sleepy Otter"))).toBe(true);
});

test("a card followed narrows the conversation to its member; clicked again, released", () => {
  show([APP], 1);
  const s5 = within(strip()!).getAllByRole("button").find((c) => c.textContent?.includes("Dizzy Puffin"))!;
  fireEvent.click(s5);
  expect(s5.getAttribute("aria-pressed")).toBe("true");
  expect(convo().getByText(/staying a number/)).toBeTruthy();
  expect(convo().queryByText(/return the new token/)).toBeNull();
  fireEvent.click(s5);
  expect(convo().getByText(/return the new token/)).toBeTruthy();
});

// ── a swarm of hundreds ──────────────────────────────────────────────────────────

const SEAT = LIVE.roster.find((r) => r.member === "refresh-tokens/S4")!;
/** The refresh-tokens run with n more members: every fifth ended, every seventh gone. */
const swarmOf = (n: number): BoardSnapshot => {
  const extra = Array.from({ length: n }, (_, i) => ({
    ...SEAT,
    member: `refresh-tokens/W${i + 1}`,
    seat: `W${i + 1}`,
    role: `worker ${i + 1}`,
    state: (i % 5 === 4 ? "ended" : "working") as typeof SEAT.state,
    badge: i % 7 === 6 ? { name: "lost" as const, reason: "its link was lost", since: null } : null,
  }));
  return { ...LIVE, roster: [...LIVE.roster, ...extra] } as BoardSnapshot;
};

test("up to twelve members every one is a card; past it, a row each, the orchestrator still a card", () => {
  show([APP], 1);
  expect(strip()!.querySelectorAll('[data-component="AgentRow"]')).toHaveLength(0);
  cleanup();
  show([APP], 1, [swarmOf(200)]);
  const cards = strip()!.querySelectorAll('[data-component="AgentCard"]');
  expect(cards).toHaveLength(1);
  expect(cards[0].classList.contains("orch")).toBe(true);
  expect(strip()!.querySelectorAll('[data-component="AgentRow"]').length).toBeGreaterThan(100);
});

test("a large swarm: lost members under Needs attention, the ended folded until opened", () => {
  show([APP], 1, [swarmOf(200)]);
  const groups = Array.from(strip()!.querySelectorAll('[data-component="RosterGroup"]'));
  expect(groups[0].className).toContain("attention");
  const ended = groups.find((g) => g.className.includes("ended"))!;
  expect(ended.querySelectorAll('[data-component="AgentRow"]')).toHaveLength(0);
  fireEvent.click(within(ended as HTMLElement).getByRole("button", { name: /Ended/ }));
  // the forty ended workers and the fixture's own S2
  expect(ended.querySelectorAll('[data-component="AgentRow"]').length).toBe(41);
});

test("a large swarm: the search and a state chip narrow the rows; a row clicked becomes its card, followed", () => {
  show([APP], 1, [swarmOf(200)]);
  fireEvent.change(within(strip()!).getByRole("searchbox"), { target: { value: "worker 13" } });
  const rows = strip()!.querySelectorAll('[data-component="AgentRow"]');
  const slices = Array.from(rows).map((r) => r.querySelector(".rseat")!.textContent!);
  expect(slices).toHaveLength(11);
  expect(slices.every((t) => t.includes("worker 13"))).toBe(true);
  fireEvent.click(Array.from(rows).find((r) => r.querySelector(".rseat")!.textContent === "worker 13")!);
  const followed = strip()!.querySelector('[data-component="AgentCard"][aria-pressed="true"]')!;
  expect(followed.textContent).toContain("W13 · worker 13");
  fireEvent.change(within(strip()!).getByRole("searchbox"), { target: { value: "" } });
  fireEvent.click(within(strip()!).getByRole("button", { name: /Needs attention/ }));
  expect(strip()!.querySelectorAll('[data-component="RosterGroup"]')).toHaveLength(1);
});

// ── the member's activity (swarm-relay S24, D9, D20) ─────────────────────────────

const ACTIVE = LIVE.roster.find((r) => r.member.startsWith("refresh-tokens/") && r.seat !== "orchestrator" && r.state !== "ended")!;
// an older board's member: its liveness, and no badge (board-split#D36)
const withActivity = (liveness: object | undefined) => ({ ...LIVE, roster: LIVE.roster.map((r) => (r.member === ACTIVE.member ? { ...r, liveness, badge: undefined } : r)) }) as BoardSnapshot;
const activeCard = () => within(strip()!).getAllByRole("button").find((c) => c.textContent?.includes(ACTIVE.nick))!;
/** The fixture member's word while working (D49): the task posted to it, never its doing. */
const WORKING_WORD = ACTIVE.owes?.task != null ? `working on #${ACTIVE.owes.task}` : "working";
const minutesAgo = (m: number) => Date.now() - m * 60000;

const withMember = (patch: object) => ({ ...LIVE, roster: LIVE.roster.map((r) => (r.member === ACTIVE.member ? { ...r, ...patch } : r)) }) as BoardSnapshot;
const badgeOf = (card: HTMLElement) => card.querySelector('[data-component="TroubleBadge"]') as HTMLElement | null;
const activityOfCard = (card: HTMLElement) => card.querySelector('[data-component="MemberActivity"]')?.textContent ?? null;

// board-split#D35: the state word is the board's alone; trouble is a badge, its reason on hover
test.each([
  ["working", {}, WORKING_WORD],
  ["merging", { state: "merging" }, "merging"],
  ["waiting", { state: "waiting" }, "waiting on the board"],
  ["an older board's watching", { state: "watching" }, "waiting on the board"],
  ["parked", { state: "parked" }, "parked"],
  ["parked until a phase", { state: "parked", parkedUntil: "P5" }, "parked until P5"],
  ["working on a posted task", { state: "working", owes: { phase: "P3", task: 917 }, doing: "reading the plan" }, "working on #917"],
  ["working with no task posted", { state: "working", owes: { phase: null, task: null }, doing: "reading the plan" }, "working"],
  ["ended", { state: "ended", ended: "2026-10-29T14:09:00.000Z" }, /^ended \d\d:\d\d$/],
])("a %s member's card reads the board's word", (_name, patch, word) => {
  show([APP], 1, [withMember(patch)]);
  const status = activeCard().querySelector(".state")!;
  if (typeof word === "string") expect(status.textContent).toBe(word);
  else expect(status.textContent).toMatch(word);
  expect(badgeOf(activeCard())).toBeNull();
});

test("the liveness never takes the word: a busy or waiting activity leaves the board's working", () => {
  for (const state of ["busy", "waiting"]) {
    show([APP], 1, [withActivity({ state, doing: "Bash", since: minutesAgo(3), tokens: null, movedAt: null })]);
    expect(activeCard().querySelector(".state")!.textContent).toBe(WORKING_WORD);
    cleanup();
  }
});

test("a stalled member keeps its word and carries a stalled badge, its reason on hover, never the word", () => {
  show([APP], 1, [withActivity({ state: "quiet", doing: "Bash", since: minutesAgo(16), reason: "no progress for 960s, link alive; last Bash", tokens: null, movedAt: null, progressAt: minutesAgo(16), aliveAt: Date.now() - 5000 })]);
  const card = activeCard();
  expect(card.querySelector(".state")!.textContent).toBe(WORKING_WORD);
  expect(card.querySelector(".state")!.className).not.toMatch(/stalled/);
  const badge = badgeOf(card)!;
  expect(badge.textContent).toBe("stalled");
  expect(badge.title).toBe("stalled for 16 min: no progress for 960s, link alive; last Bash");
  expect(agesOf(card)!.textContent).toBe("progress 16 min · alive 5 s");
});

test.each([
  ["ended", "quiet"],
  ["call", "busy"],
  ["owing", "quiet"],
])("a member stalled under rule %s reads by the rule: a stalled badge", (rule, state) => {
  show([APP], 1, [withActivity({ state, rule, doing: "Bash npm test", since: minutesAgo(2), reason: "anything at all", tokens: null, movedAt: null })]);
  expect(badgeOf(activeCard())!.textContent).toBe("stalled");
});

test("an older board's gone reads as a lost badge, its quiet as stalled; a working member whose link is down carries none", () => {
  show([APP], 1, [withActivity({ state: "gone", doing: "Read", since: null, reason: "link lost", tokens: null, movedAt: null })]);
  expect(badgeOf(activeCard())!.textContent).toBe("lost");
  expect(activeCard().classList.contains("lost")).toBe(true);
  cleanup();
  show([APP], 1, [withActivity({ state: "quiet", doing: "Read", since: minutesAgo(2), reason: "no activity yet", tokens: null, movedAt: null })]);
  expect(badgeOf(activeCard())!.textContent).toBe("stalled");
  cleanup();
  show([APP], 1, [withActivity({ state: "working", doing: "Edit", since: null, reason: "link down", tokens: null, movedAt: null })]);
  expect(badgeOf(activeCard())).toBeNull();
});

// board-split#D36: the board's own badge, its reason on hover, beside the word; none on a parked or ended member
test.each([
  ["stalled", "no progress for 16 min"],
  ["lost", "its agent finished without end"],
  ["blocked", "waits on the person: the API key"],
] as const)("the board's %s badge reads beside the word, its reason on hover, the member under Needs attention", (name, reason) => {
  show([APP], 1, [withMember({ badge: { name, reason, since: minutesAgo(3) } })]);
  const card = activeCard();
  expect(card.querySelector(".state")!.textContent).toBe(WORKING_WORD);
  expect(badgeOf(card)!.textContent).toBe(name);
  expect(badgeOf(card)!.title).toBe(`${name} for 3 min: ${reason}`);
  expect(card.classList.contains("lost")).toBe(name === "lost");
});

test("the board's badge wins over the liveness words: a null badge on a quiet liveness shows none", () => {
  show([APP], 1, [withMember({ badge: null, liveness: { state: "quiet", doing: "Read", since: minutesAgo(2), reason: "x", tokens: null, movedAt: null } })]);
  expect(badgeOf(activeCard())).toBeNull();
});

test("a parked member carries no badge, whatever the board sends (D30)", () => {
  show([APP], 1, [withMember({ state: "parked", badge: { name: "lost", reason: "x", since: null } })]);
  expect(badgeOf(activeCard())).toBeNull();
});

// board-split#D45: one short line, `▸ <label>  <N>m` (◌ in the background); the call's own description first, else a
// short command form; the whole command on hover; the board's own wait and nothing open: no line
test("the activity line is one short line: the call's description, its minutes, the whole command on hover", () => {
  const activity = {
    open: { name: "Bash", target: "npm run build", since: minutesAgo(9), boardWait: false, label: "Build the viewer", command: "cd app && CI=1 npm run build -- --mode production" },
    background: { target: "npm test", since: minutesAgo(7), outputGrewAt: null, label: null, command: "npm test" },
  };
  show([APP], 1, [withMember({ activity })]);
  const line = activeCard().querySelector('[data-component="MemberActivity"]') as HTMLElement;
  expect(line.textContent).toBe("▸ Build the viewer  9m");
  expect(line.title).toContain("cd app && CI=1 npm run build -- --mode production");
  expect(line.title).toContain("foreground since");
});

test("no description: a short command form; a background call reads ◌; the board's own wait is no line", () => {
  show([APP], 1, [withMember({ activity: { open: { name: "Bash", target: "x", since: minutesAgo(3), boardWait: false, label: null, command: "SWARMSTORM_HOME=/h node /x/skills/swarm.mjs merge-lock --onto main --as g/w1" }, background: null } })]);
  expect(activityOfCard(activeCard())).toBe("▸ board merge-lock  3m");
  cleanup();
  show([APP], 1, [withMember({ activity: { open: { name: "Bash", target: "x", since: minutesAgo(2), boardWait: true, label: null, command: "node swarm.mjs wait" }, background: { target: "node scripts/check-all.mjs --fast", since: minutesAgo(5), outputGrewAt: null, label: null, command: null } } })]);
  expect(activityOfCard(activeCard())).toBe("◌ check-all.mjs  5m");
  cleanup();
  show([APP], 1, [withMember({ activity: { open: { name: "Read", target: "C:/r/src/board/board.ts", since: minutesAgo(1), boardWait: false, label: null, command: "C:/r/src/board/board.ts" }, background: null } })]);
  expect(activityOfCard(activeCard())).toBe("▸ Read · board.ts  1m");
});

test("a long label is cut to the card's line", () => {
  show([APP], 1, [withMember({ activity: { open: { name: "Bash", target: "x", since: minutesAgo(12), boardWait: false, label: "Run the whole swarm-board suite in the foreground now", command: "npm test" }, background: null } })]);
  const text = activityOfCard(activeCard())!;
  expect(text.length).toBeLessThanOrEqual(32);
  expect(text).toMatch(/^▸ Run the whole .*…  12m$/);
});

test("nothing open: no activity line; an older board's busy activity, the call it runs", () => {
  show([APP], 1, [withActivity({ state: "working", doing: "Edit", since: null, tokens: null, movedAt: null })]);
  expect(activityOfCard(activeCard())).toBeNull();
  cleanup();
  show([APP], 1, [withActivity({ state: "busy", doing: "browser_click /jobs", since: minutesAgo(3), tokens: null, movedAt: null })]);
  expect(activityOfCard(activeCard())).toBe("▸ browser_click /jobs  3m");
});

test("a member with no activity renders its word and no activity line", () => {
  show([APP], 1, [withActivity(undefined)]);
  const card = activeCard();
  expect(card.querySelector('[data-component="MemberActivity"]')).toBeNull();
  expect(card.classList.contains("lost")).toBe(false);
});

// ── the member's two ages (swarm-relay S43, D36, D38) ──────────────────────────

const agesOf = (card: HTMLElement) => card.querySelector('[data-component="MemberAges"]');

test("each card shows progress <age> and alive <age>, also in its hover title with the activity", () => {
  show([APP], 1, [withActivity({ state: "busy", doing: "Bash", since: minutesAgo(3), tokens: null, movedAt: null, progressAt: minutesAgo(4), aliveAt: Date.now() - 20000 })]);
  const card = activeCard();
  expect(agesOf(card)!.textContent).toBe("progress 4 min · alive 20 s");
  expect(card.title).toContain("progress 4 min · alive 20 s");
  expect(card.title).toContain("▸ Bash  3m");
});

test("a card without the two ages renders without them", () => {
  show([APP], 1, [withActivity({ state: "working", doing: "Edit", since: null, tokens: null, movedAt: null })]);
  expect(agesOf(activeCard())).toBeNull();
});

test("a waiting card keeps its doing line on its face", () => {
  show([APP], 1, [withMember({ state: "waiting" })]);
  expect(activeCard().querySelector(".doing")).toBeTruthy();
});

// ── ClaimsRow ────────────────────────────────────────────────────────────────────

const SHARED: BoardSnapshot = { ...LIVE, files: [...LIVE.files, { path: "src/shared.ts", holders: ["refresh-tokens/S3", "audit-log/S1"], interface: true }] };

test("the claims row is collapsed, counting files and those shared", () => {
  show([APP], 1, [SHARED]);
  const toggle = screen.getByRole("button", { name: /Claims/ });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(toggle.textContent).toContain("7 files · 1 shared");
  expect(screen.queryByText("src/shared.ts")).toBeNull();
});

test("opened, a plain list: one file per line with its holders, a shared one marked shared and uncoloured", () => {
  show([APP], 1, [SHARED]);
  fireEvent.click(screen.getByRole("button", { name: /Claims/ }));
  const row = screen.getByText("src/shared.ts").closest("li")!;
  expect(row.querySelectorAll('[data-component="MemberTag"]').length).toBe(2);
  const mark = within(row).getByText("shared");
  expect(mark.getAttribute("style")).toBeNull();
  expect(row.getAttribute("style")).toBeNull();
  expect(row.querySelector("[style*='danger'], [style*='amber']")).toBeNull();
  expect(localStorage.getItem(CLAIMS_EXPANDED_KEY)).toBe("1");
});

test("the claims row falls back to collapsed when storage throws, and still opens", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  show([APP], null);
  const toggle = screen.getByRole("button", { name: /Claims/ });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
});

test("under a closed run, no claims row", () => {
  show([APP], 4);
  expect(screen.queryByRole("region", { name: "Claims" })).toBeNull();
});

// ── MergeLock ────────────────────────────────────────────────────────────────────

test("the merge lock sits at the tab row's end, free or held, with its tip on hover and focus (D22)", () => {
  show([APP], null, [{ ...LIVE, lock: { holder: "refresh-tokens/S4", since: LIVE.events[0].at } }]);
  const lock = tabs().getByText("merge lock").closest('[data-component="MergeLock"]') as HTMLElement;
  expect(lock.tagName).toBe("BUTTON");
  expect(lock.dataset.tip).toMatch(/^Merge lock: one member merges at a time, across every run\./);
  expect(within(lock).getByText("S4")).toBeTruthy();
  fireEvent.focusIn(lock);
  expect(screen.getByRole("tooltip", { hidden: true }).textContent).toBe(lock.dataset.tip);
  cleanup();
  show([APP], null);
  expect(screen.getByText("merge lock free")).toBeTruthy();
});

test("clicking the merge lock opens its history, newest first; Escape closes it", () => {
  const at = LIVE.events[0].at;
  const lockHistory = [
    { member: "refresh-tokens/S4", askedAt: at, grantedAt: at, mergedAt: null, refused: 0 },
    { member: "refresh-tokens/S2", askedAt: at, grantedAt: at, mergedAt: at, refused: 2 },
  ];
  show([APP], null, [{ ...LIVE, lockHistory }]);
  fireEvent.click(tabs().getByText("merge lock free").closest("button")!);
  const dialog = screen.getByRole("dialog", { name: "Merge lock history" });
  const rows = dialog.querySelectorAll("tbody tr");
  expect(rows.length).toBe(2);
  expect(rows[0].className).toBe("holding");
  expect(rows[1].className).toBe("merged");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "Merge lock history" })).toBeNull();
});

// ── The tab the board opens on by itself (D17) ──────────────────────────────────────

test("one open run: the board opens on its tab", () => {
  show([OTHER], null, [SITE]);
  expect(pressed()).toBe(tabOf("The landing page"));
});

test("two or more open runs: the board opens on the newest", () => {
  show([APP], null);
  expect(pressed()).toBe(tabOf("Naming the kinds"));
});

test("no open run: the board opens on the most recently closed, as its archived tab, a brainstorm counting its seats, in its tab and its archived line (SL10, SL11)", () => {
  show([APP], null, [ALL_CLOSED]);
  const archived = screen.getByText("Theme tokens").closest('[data-component="ArchivedTab"]') as HTMLElement;
  expect(archived.getAttribute("aria-pressed")).toBe("true");
  expect(archived.getAttribute("title")).toContain("2 seats");
  expect(archived.getAttribute("title")).not.toContain("2/2");
  expect(convo().getByText(/read only · 2 seats$/)).toBeTruthy();
  expect(convo().queryByText(/slices/)).toBeNull();
});

test("no run at all: no tab, and the board says it has none yet", () => {
  show([OTHER], null, [{ ...SITE, runs: [], events: [], roster: [] }]);
  expect(pressed()).toBeUndefined();
  expect(screen.getByText("No run on swarmstorm-site yet.")).toBeTruthy();
});

test("a run from the URL wins over the opening rule", () => {
  show([OTHER, APP], 4, [SITE, LIVE]);
  expect(screen.getByText("The login page").closest('[data-component="ArchivedTab"]')!.getAttribute("aria-pressed")).toBe("true");
});

test("the person's pick wins: a board that changes later does not move the tab", () => {
  const { rerender } = show([APP], null);
  fireEvent.click(tabOf("Audit log"));
  source.boards = { [APP]: { ...LIVE, events: [...LIVE.events] } };
  rerender(<BoardView repos={[APP]} run={null} />);
  expect(pressed()).toBe(tabOf("Audit log"));
});

test("the run's head shows its current phase, name and text; a run with no phase yet shows none", () => {
  show([APP], BRAINSTORM.run, [PHASED]);
  const phase = document.querySelector('[data-component="RunPhase"]')!;
  expect(phase.getAttribute("data-phase")).toBe("diverge");
  expect(phase.querySelector(".name")?.textContent).toBe("diverge");
  expect(phase.querySelector(".said")?.textContent).toBe("every name a run could carry, no judgment yet");
  cleanup();
  show([APP], BRAINSTORM.run, [LIVE]);
  expect(document.querySelector('[data-component="RunViewSwitch"]')).toBeNull();
  expect(document.querySelector('[data-component="RunPhase"]')).toBeNull();
});

test("a phase opened more than once reads its iteration: build 1, verify 1, build 2, verify 2; a phase opened once stays bare", async () => {
  const { phaseLabels, RunViewSwitch } = await import("./components/viewers/board/RunViewSwitch.tsx");
  const loop = [{ name: "build", text: "" }, { name: "verify", text: "" }, { name: "build", text: "" }, { name: "verify", text: "walk again" }];
  expect(phaseLabels(loop)).toEqual(["build 1", "verify 1", "build 2", "verify 2"]);
  expect(phaseLabels([{ name: "diverge" }, { name: "converge" }])).toEqual(["diverge", "converge"]);
  render(<RunViewSwitch view="conversation" line="" json={null} onView={() => {}} phases={loop} />);
  const names = [...document.querySelectorAll('[data-component="PhaseStrip"] .name')].map((n) => n.textContent);
  expect(names).toEqual(["build 1", "verify 1", "build 2", "verify 2"]);
});

test("a run that names a protocol shows it on its tab's hover, the kind otherwise; the tab prints only dot, code, title", () => {
  const withProtocol = { ...LIVE, runs: LIVE.runs.map((r) => (r.run === 1 ? { ...r, protocol: "build-verify" } : r)) };
  show([APP], null, [withProtocol]);
  expect(tabOf("Sessions with refresh tokens").getAttribute("title")).toBe("Sessions with refresh tokens · build-verify · plan run · 2/7 merged · live");
  expect(tabOf("Audit log").getAttribute("title")).toContain("· plan run ·");
  expect(tabOf("Audit log").querySelector(".kind")).toBeNull();
  expect(tabOf("Audit log").querySelector('[data-component="RunState"]')!.getAttribute("aria-label")).toBe("live");
});

// ── idea 2, B12 (F10): a paused run says so on the conversation's head ──────────────

const pausedRun = (paused: { text: string; person: boolean } | null) => ({ ...LIVE, runs: LIVE.runs.map((r) => (r.run === 1 ? { ...r, paused } : r)) }) as BoardSnapshot;

test.each([
  [{ text: "approve the mockup", person: true }, "waiting on the person: approve the mockup"],
  [{ text: "hold for the review", person: false }, "paused: hold for the review"],
])("the conversation's head shows the run's pause: %o", (paused, said) => {
  show([APP], 1, [pausedRun(paused)]);
  const pause = document.querySelector('[data-component="RunPause"]');
  expect(pause?.textContent).toBe(said);
});

test("a run that is not paused shows no pause on its head", () => {
  show([APP], 1, [pausedRun(null)]);
  expect(document.querySelector('[data-component="RunPause"]')).toBeNull();
});

// board-split#D48, D49 (A1-7, A1-8, A1-9): the word never carries doing; a parked seat's unread is held, not alarmed
test("a working member's doing never reaches the word, and no card says dormant", () => {
  show([APP], 1, [withMember({ state: "working", owes: { phase: "P3", task: null }, doing: "unparked" })]);
  expect(activeCard().querySelector(".state")!.textContent).toBe("working");
  expect(strip()!.textContent).not.toMatch(/dormant/);
});

test("a parked seat's unread reads held, quiet: no alarm, no attention bucket, no rail dot", () => {
  show([APP], 1, [withMember({ state: "parked", parkedUntil: "P5", unread: 4, doing: "parked until P5", badge: null })]);
  const card = activeCard();
  const unread = card.querySelector('[data-component="UnreadCount"]')!;
  expect(unread.textContent).toBe("4 held");
  expect(unread.classList.contains("held")).toBe(true);
  expect(card.querySelector(".doing")).toBeNull();
  expect(badgeOf(card)).toBeNull();
  cleanup();
  show([APP], 1, [withMember({ state: "working", unread: 4 })]);
  expect(activeCard().querySelector('[data-component="UnreadCount"]')!.textContent).toBe("4 unread");
});
