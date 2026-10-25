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
  // a brainstorm's slice rows are seats, never slices to merge: never "0/1"
  expect(names.slice(1, -2)).toEqual(["RTSessions with refresh tokensplanlive · 2/7", "ALAudit logplanlive · 0/3", "NMNaming the kindsbrainstormlive · 1 seat"]);
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
  expect(within(archived).getByText(/^archived/)).toBeTruthy();
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
  const member = (slice: string, state: "done" | "ended") => ({ ...was, runner: `login-page/${slice}`, nick: `LP ${slice}`, plan: "login-page", slice, state });
  show([APP], 4, [{ ...LIVE, roster: [...LIVE.roster, member("S1", "ended"), member("orchestrator", "done")] }]);
  const cards = within(strip()!).getAllByRole("button");
  expect(cards.map((c) => c.querySelector(".slice")?.textContent)).toEqual(["orchestrator", `S1 · ${was.title}`]);
  expect(cards.every((c) => c.textContent?.includes("ended"))).toBe(true);
  fireEvent.click(cards[1]);
  expect(cards[1].getAttribute("aria-pressed")).toBe("true");
});

test("under a picked run, its members, orchestrator first, each its mark then its nick, the code·slice its tooltip", () => {
  show([APP], 1);
  const cards = within(strip()!).getAllByRole("button");
  expect(cards[0].querySelector('[data-component="AgentMark"]')?.textContent).toBe("OR");
  expect(cards[0].querySelector('[data-component="AgentLabel"]')?.getAttribute("title")).toBe("RT·orchestrator");
  expect(cards[0].textContent).toContain(NICKS["refresh-tokens/orchestrator"]);
  expect(cards[0].classList.contains("orch")).toBe(true);
  expect(cards.every((c) => c.querySelector('[data-component="RunnerTag"]') === null)).toBe(true);
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

const SEAT = LIVE.roster.find((r) => r.runner === "refresh-tokens/S4")!;
/** The refresh-tokens run with n more members: every fifth ended, every seventh gone. */
const swarmOf = (n: number): BoardSnapshot => {
  const extra = Array.from({ length: n }, (_, i) => ({
    ...SEAT,
    runner: `refresh-tokens/W${i + 1}`,
    slice: `W${i + 1}`,
    title: `worker ${i + 1}`,
    state: (i % 5 === 4 ? "ended" : "working") as typeof SEAT.state,
    liveness: i % 7 === 6 ? { state: "gone", doing: null, since: null, tokens: null, movedAt: null } : undefined,
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

test("a large swarm: gone members first under Needs attention, the ended folded until opened", () => {
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
  const slices = Array.from(rows).map((r) => r.querySelector(".rslice")!.textContent!);
  expect(slices).toHaveLength(11);
  expect(slices.every((t) => t.includes("worker 13"))).toBe(true);
  fireEvent.click(Array.from(rows).find((r) => r.querySelector(".rslice")!.textContent === "worker 13")!);
  const followed = strip()!.querySelector('[data-component="AgentCard"][aria-pressed="true"]')!;
  expect(followed.textContent).toContain("W13 · worker 13");
  fireEvent.change(within(strip()!).getByRole("searchbox"), { target: { value: "" } });
  fireEvent.click(within(strip()!).getByRole("button", { name: /Needs attention/ }));
  expect(strip()!.querySelectorAll('[data-component="RosterGroup"]')).toHaveLength(1);
});

// ── the member's activity (swarm-relay S24, D9, D20) ─────────────────────────────

const ACTIVE = LIVE.roster.find((r) => r.runner.startsWith("refresh-tokens/") && r.slice !== "orchestrator" && r.state !== "ended" && r.state !== "done")!;
const withActivity = (liveness: object | undefined) => ({ ...LIVE, roster: LIVE.roster.map((r) => (r.runner === ACTIVE.runner ? { ...r, liveness } : r)) }) as BoardSnapshot;
const activeCard = () => within(strip()!).getAllByRole("button").find((c) => c.textContent?.includes(ACTIVE.nick))!;
const minutesAgo = (m: number) => Date.now() - m * 60000;

test.each([
  ["working", { state: "working", doing: "Edit", since: null }, /^working$/, "last: Edit"],
  ["busy", { state: "busy", doing: "browser_click /jobs", since: minutesAgo(3) }, /^busy · 3 min$/, "browser_click /jobs"],
  ["waiting", { state: "waiting", doing: "swarm wait", since: null }, /^waiting$/, "last: swarm wait"],
  ["quiet", { state: "quiet", doing: "Bash", since: minutesAgo(12), reason: "no call since 12 min" }, /^quiet · 12 min$/, "last: Bash · no call since 12 min"],
  ["gone", { state: "gone", doing: "Read", since: null }, /^gone$/, "last: Read"],
])("a %s member shows its own label and its tool beside it", (state, liveness, label, tool) => {
  show([APP], 1, [withActivity({ tokens: null, movedAt: null, ...liveness })]);
  const card = activeCard();
  const status = card.querySelector(".state")!;
  expect(status.className).toBe(`state ${state}`);
  expect(status.textContent).toMatch(label);
  const line = card.querySelector('[data-component="MemberActivity"]')!;
  expect(line.getAttribute("data-state")).toBe(state);
  expect(line.textContent).toBe(tool);
});

test("a gone member stays in the roster, its card marked gone", () => {
  show([APP], 1, [withActivity({ state: "gone", doing: null, since: null, tokens: null, movedAt: null })]);
  const card = activeCard();
  expect(card).toBeTruthy();
  expect(card.classList.contains("gone")).toBe(true);
});

test("a member with no activity state renders as before it", () => {
  show([APP], 1, [withActivity(undefined)]);
  const card = activeCard();
  expect(card.querySelector('[data-component="MemberActivity"]')).toBeNull();
  expect(card.classList.contains("gone")).toBe(false);
  expect(card.querySelector(".state")!.className).not.toMatch(/\b(busy|gone)\b/);
});

// ── the member's two ages (swarm-relay S43, D36, D38) ──────────────────────────

const agesOf = (card: HTMLElement) => card.querySelector('[data-component="MemberAges"]');

test("each card shows progress <age> and alive <age> beside the state", () => {
  show([APP], 1, [withActivity({ state: "working", doing: "Edit", since: null, tokens: null, movedAt: null, progressAt: minutesAgo(4), aliveAt: Date.now() - 20000 })]);
  const card = activeCard();
  expect(card.querySelector(".state")!.textContent).toMatch(/^working$/);
  expect(agesOf(card)!.textContent).toBe("progress 4 min · alive 20 s");
});

test("a card without the two ages renders as before", () => {
  show([APP], 1, [withActivity({ state: "working", doing: "Edit", since: null, tokens: null, movedAt: null })]);
  expect(agesOf(activeCard())).toBeNull();
});

test("a stalled member's card reads as stalled with its missing signal", () => {
  show([APP], 1, [withActivity({ state: "quiet", doing: "Bash", since: minutesAgo(16), reason: "no progress for 960s, link alive; last Bash",tokens: null, movedAt: null, progressAt: minutesAgo(16), aliveAt: Date.now() - 5000 })]);
  const card = activeCard();
  const status = card.querySelector(".state")!;
  expect(status.className).toBe("state stalled");
  expect(status.textContent).toMatch(/^stalled · 16 min$/);
  expect(card.querySelector('[data-component="MemberActivity"]')!.textContent).toBe("last: Bash · no progress for 960s, link alive; last Bash");
  expect(agesOf(card)!.textContent).toBe("progress 16 min · alive 5 s");
});

test("a gone member's card reads as gone, its lost link named", () => {
  show([APP], 1, [withActivity({ state: "gone", doing: "Read", since: null, reason: "no progress for 120s, link lost; last Read", tokens: null, movedAt: null, progressAt: minutesAgo(2), aliveAt: Date.now() - 40000 })]);
  const card = activeCard();
  expect(card.classList.contains("gone")).toBe(true);
  expect(card.querySelector(".state")!.textContent).toMatch(/^gone$/);
  expect(card.querySelector('[data-component="MemberActivity"]')!.textContent).toBe("last: Read · no progress for 120s, link lost; last Read");
  expect(agesOf(card)!.textContent).toBe("progress 2 min · alive 40 s");
});

test("a card shows its state's duration, ages and tool on its face, and in its hover title", () => {
  show([APP], 1, [withActivity({ state: "busy", doing: "Bash", since: minutesAgo(3), tokens: null, movedAt: null, progressAt: minutesAgo(4), aliveAt: Date.now() - 20000 })]);
  const card = activeCard();
  expect((agesOf(card) as HTMLElement).hidden).toBe(false);
  expect((card.querySelector('[data-component="MemberActivity"]') as HTMLElement).hidden).toBe(false);
  expect(card.title).toContain("progress 4 min · alive 20 s");
  expect(card.title).toContain("Bash");
  expect(card.querySelector(".state")!.textContent).toBe("busy · 3 min");
  expect(card.querySelector(".doing")).toBeTruthy();
});

test("a waiting card keeps its doing line on its face", () => {
  show([APP], 1, [withActivity({ state: "waiting", doing: "swarm wait", since: null, tokens: null, movedAt: null })]);
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
  expect(row.querySelectorAll('[data-component="RunnerTag"]').length).toBe(2);
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
    { runner: "refresh-tokens/S4", askedAt: at, grantedAt: at, mergedAt: null, refused: 0 },
    { runner: "refresh-tokens/S2", askedAt: at, grantedAt: at, mergedAt: at, refused: 2 },
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
  expect(archived.textContent).toContain("2 seats");
  expect(archived.textContent).not.toContain("2/2");
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

test("a run that names a protocol shows it in its tab's chip, the kind otherwise", () => {
  const withProtocol = { ...LIVE, runs: LIVE.runs.map((r) => (r.run === 1 ? { ...r, protocol: "build-verify" } : r)) };
  show([APP], null, [withProtocol]);
  expect(tabOf("Sessions with refresh tokens").querySelector(".kind")?.textContent).toBe("build-verify");
  expect(tabOf("Audit log").querySelector(".kind")?.textContent).toBe("plan");
});

// ── idea 1: a stall named by its rule (agent-ergonomics, build 1.4: V1, V3) ──────────

test.each([
  ["ended", "quiet", 'turn ended; last: "I will report once the build is green"'],
  ["in-turn", "quiet", 'in turn, no line for 2 min (its model may be hung); last: "Bash ls"'],
  ["background", "quiet", 'background npm test silent 60 s; last: "working"'],
  ["call", "busy", 'call open 15 min, may be long or hung; last: "mcp__browser__browser_wait_for"'],
  ["owing", "quiet", 'waiting, not done p1; last: "Bash node swarm.mjs wait"'],
])("a member stalled under rule %s reads stalled, its reason once, one last: on the card", (rule, state, reason) => {
  show([APP], 1, [withActivity({ state, rule, doing: "Bash npm test", since: minutesAgo(2), reason, tokens: null, movedAt: null })]);
  const card = activeCard();
  expect(card.querySelector(".state")!.className).toBe("state stalled");
  const said = card.querySelector('[data-component="MemberActivity"]')!.textContent!;
  expect(said).toBe(reason);
  expect(said.match(/last:/g)).toHaveLength(1);
});

test("the stall is read from the rule, not the wording: a reworded reason under a rule is still stalled", () => {
  show([APP], 1, [withActivity({ state: "quiet", rule: "ended", doing: "Read", since: minutesAgo(2), reason: "anything at all", tokens: null, movedAt: null })]);
  expect(activeCard().querySelector(".state")!.className).toBe("state stalled");
});

test("a quiet member with no rule and no 'link alive' is quiet, not stalled; its last tool is shown", () => {
  show([APP], 1, [withActivity({ state: "quiet", doing: "Read", since: minutesAgo(2), reason: "no activity yet", tokens: null, movedAt: null })]);
  const card = activeCard();
  expect(card.querySelector(".state")!.className).not.toMatch(/stalled/);
  expect(card.querySelector('[data-component="MemberActivity"]')!.textContent).toBe("last: Read · no activity yet");
});

test("a working member whose link is down reads working, not stalled nor gone", () => {
  show([APP], 1, [withActivity({ state: "working", doing: "Edit", since: null, reason: "link down", tokens: null, movedAt: null })]);
  const card = activeCard();
  expect(card.querySelector(".state")!.textContent).toMatch(/^working$/);
  expect(card.classList.contains("gone")).toBe(false);
});
