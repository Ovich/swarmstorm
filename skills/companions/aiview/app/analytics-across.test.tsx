// The across-runs view (board D10, plan D28, D32-D35; prototype #677 `across` and `empty`): useStats stood
// in for with a `Stats` fixture whose totals disagree with its runs, useBoard with the board fixtures.
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LIVE } from "./board-fixtures.ts";
import type { BoardSnapshot } from "../../swarm-board/src/client/reader.ts";
import { ACROSS, ACROSS_ALL_KNOWN, ACROSS_EMPTY, PLAN_RUN, bodyOf } from "./stats-fixtures.ts";
import { source, standIn } from "./stats-stand-in.ts";
import type { Stats } from "../../swarm-board/src/client/reader.ts";

vi.mock("./hooks/useBoard.ts", async () => ({ useBoard: (await import("./stats-stand-in.ts")).useBoardStandIn }));
vi.mock("./hooks/useStats.ts", async () => ({ useStats: (await import("./stats-stand-in.ts")).useStatsStandIn }));

import { BoardView } from "./components/viewers/board/BoardView.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The board on All, then the Analytics pill beside the merge lock. */
const openAcross = (across = ACROSS) => {
  standIn([LIVE], across, [PLAN_RUN]);
  const view = render(<BoardView repos={[LIVE.repo]} run={null} />);
  fireEvent.click(within(screen.getByRole("navigation", { name: "Runs" })).getByRole("button", { name: "All runs" }));
  return view;
};
const across = () => screen.getByText("Across runs").closest('[data-component="AcrossRunsView"]') as HTMLElement;
const tile = (label: string): HTMLElement => {
  const found = [...across().querySelectorAll<HTMLElement>('[data-component="KpiTile"]')].find((t) => t.querySelector(".k")?.textContent?.startsWith(label));
  if (!found) throw new Error(`no tile ${label}`);
  return found;
};
const valueOf = (label: string): string => tile(label).querySelector(".v")!.textContent!;

test("the page counts nothing (D28, D34, D35)", () => {
  openAcross();
  // summing the runs' flags gives 1, their known conflicts 1, counting them 3 plan runs; the totals say 7, 5 and 11
  expect(valueOf("Flags")).toBe("7edits outside a claim");
  expect(valueOf("Rebase conflicts")).toMatch(/^5/);
  expect(tile("Rebase conflicts").textContent).toContain("3 in shared files");
  expect(valueOf("Slices merged")).toBe("29of 33");
  expect(tile("Slices merged").textContent).toContain("11 plan runs");
  expect(valueOf("Lock wait")).toBe("4m 10sp50");
  expect(screen.getByText("14 runs · 37 members · swarmstorm-app")).toBeTruthy();
  // the funnel's four steps, from totals.shared: 9, 8, 6, 4 (the runs' perFile hold 2 files)
  const funnel = across().querySelector('[data-component="SharingFunnel"]') as HTMLElement;
  expect([...funnel.querySelectorAll(".step .num")].map((n) => n.textContent)).toEqual(["9", "8", "6", "4"]);
  // the lock panel: totals.lockWait, its bins as written
  const lock = across().querySelector('[data-component="MergeLockPanel"]') as HTMLElement;
  expect(lock.textContent).toContain("23 merges · p50 4m 10s · p90 9m");
  expect([...lock.querySelectorAll(".hist .col span")].map((n) => n.textContent)).toEqual(["6", "5", "7", "3", "2"]);
});

test("the funnel's conflict line reads only when both its figures are recorded, left out when either is null (D43)", () => {
  const foot = (): string => across().querySelector('[data-component="SharingFunnel"] .foot')!.textContent!;
  openAcross();
  expect(foot()).toContain("At merge, 3 of the 9 met a conflict.");
  const notRecorded: [string, Stats][] = [
    ["conflicts in shared files", { ...ACROSS, totals: { ...ACROSS.totals, conflicts: { ...ACROSS.totals.conflicts, inShared: null } } }],
    ["shared files", { ...ACROSS, totals: { ...ACROSS.totals, shared: { ...ACROSS.totals.shared, files: null } } }],
  ];
  for (const [missing, stats] of notRecorded) {
    cleanup();
    openAcross(stats);
    expect(foot(), missing).toMatch(/[Ee]ach step counts the files that made it that far\./);
    expect(foot(), missing).not.toContain("At merge");
    expect(foot(), missing).not.toContain("conflict");
  }
});

test("a null figure reads not recorded, never 0; a tile over runs some unrecorded says N runs not recorded; the sparkline has a gap at the unrecorded run (US1, D32, D33, D44)", () => {
  openAcross();
  expect(valueOf("Silent members")).toBe("not recorded");
  expect(tile("Silent members").querySelector(".v")!.textContent).not.toMatch(/0/);
  // only what no run kept: slices and shared files are estimated (D44), flags known for every run (D43)
  for (const label of ["Lock wait", "Rebase conflicts", "Silent members"]) {
    expect(within(tile(label)).getByText("1 run not recorded")).toBeTruthy();
  }
  // [2, null, 4, 5]: three points, the line broken at the null, one line through the last two
  const spark = tile("Lock wait").querySelector("svg")!;
  expect(spark.querySelectorAll("circle")).toHaveLength(3);
  const lines = spark.querySelectorAll("polyline");
  expect(lines).toHaveLength(1);
  expect(lines[0].getAttribute("points")!.split(" ")).toHaveLength(2);
});

test("unknown merges: the amber chip and + N unknown; with no unknown merge, no chip (US4, board D16)", () => {
  const { container } = openAcross();
  const chip = container.querySelector('[data-part="git-chip"]') as HTMLElement;
  expect(chip.textContent).toBe("⚠ git 2.38+ needed · 2 merges with conflicts unknown");
  expect(chip.classList.contains("warnchip")).toBe(true);
  expect(tile("Rebase conflicts").textContent).toContain("+ 2 unknown");
  cleanup();
  const known = openAcross(ACROSS_ALL_KNOWN);
  expect(known.container.querySelector('[data-part="git-chip"]')).toBeNull();
  expect(tile("Rebase conflicts").textContent).not.toContain("unknown");
});

test("no closed run: the empty state, verbatim (SL4)", () => {
  openAcross(ACROSS_EMPTY);
  expect(across().dataset.state).toBe("empty");
  expect(screen.getByText("No run has closed on this board yet.")).toBeTruthy();
  const why = screen.getByText(/^Analytics read closed runs\./);
  expect(why.textContent).toBe("Analytics read closed runs. Open one with swarm open; its figures appear here when it closes.");
  expect(within(why).getByText("swarm open").tagName).toBe("CODE");
  expect(across().querySelector('[data-component="KpiTile"]')).toBeNull();
});

test("the periods Last 7 days, Last 30 days, Every run kept; the last kind chip on cannot be turned off (D33)", () => {
  openAcross();
  const period = screen.getByRole("combobox", { name: "Period" }) as HTMLSelectElement;
  expect([...period.options].map((o) => o.textContent).sort()).toEqual(["Every run kept", "Last 30 days", "Last 7 days"]);
  fireEvent.change(period, { target: { value: "7d" } });
  expect(source.asks.at(-1)).toEqual({ period: "7d", kinds: ["plan", "brainstorm"] });
  fireEvent.change(period, { target: { value: "all" } });
  expect(source.asks.at(-1)).toEqual({ period: "all", kinds: ["plan", "brainstorm"] });
  const chip = (k: string) => within(across()).getByRole("button", { name: k });
  fireEvent.click(chip("plan"));
  expect(chip("plan").getAttribute("aria-pressed")).toBe("false");
  expect(source.asks.at(-1)).toEqual({ period: "all", kinds: ["brainstorm"] });
  // brainstorm is the last one on: it stays on
  fireEvent.click(chip("brainstorm"));
  expect(chip("brainstorm").getAttribute("aria-pressed")).toBe("true");
  expect(source.asks.at(-1)).toEqual({ period: "all", kinds: ["brainstorm"] });
});

test("Copy as JSON puts the response body on the clipboard, unchanged (US3, D34)", async () => {
  openAcross();
  fireEvent.click(within(across()).getByRole("button", { name: "Copy as JSON" }));
  await waitFor(() => expect(source.copied).toHaveLength(1));
  expect(source.copied[0]).toBe(bodyOf(ACROSS));
});

test("a runs-table row opens its run's tab on Analytics (D33, SL5)", () => {
  openAcross();
  const table = across().querySelector('[data-component="RunsTable"]') as HTMLElement;
  const row = within(table).getByText("The login page").closest("tr")!;
  fireEvent.click(row);
  expect(screen.queryByText("Across runs")).toBeNull();
  // run 4 is closed: its tab is the archived one, pressed, on Analytics
  const tab = screen.getByText("The login page", { selector: ".t" }).closest('[data-component="ArchivedTab"]') as HTMLElement;
  expect(tab.getAttribute("aria-pressed")).toBe("true");
  const view = within(screen.getByRole("group", { name: "This run" }));
  expect(view.getByRole("button", { name: "Analytics" }).getAttribute("aria-pressed")).toBe("true");
  expect(source.asks.at(-1)).toEqual({ run: 4 });
  expect(location.hash).toContain("run=4&view=analytics");
});

test("an estimated figure: the Slice time and Shared files settled tiles and the funnel drawn as inferred with the estimate's tip and N runs estimated; Slices merged, exact, and Flags are not (D43, D44, SL9, round 2)", () => {
  openAcross();
  const tip = "Estimated: this run closed before analytics recorded it; read from its claims and members.";
  // the merged count is read from the members' rows, exact for every run: only its times were estimated
  expect(tile("Slices merged").dataset.state).toBe("filled");
  expect(tile("Slices merged").classList.contains("inferred")).toBe(false);
  expect(tile("Slices merged").textContent).not.toContain("estimated");
  for (const label of ["Slice time", "Shared files settled"]) {
    expect(tile(label).dataset.state, label).toBe("estimated");
    expect(tile(label).classList.contains("inferred"), label).toBe(true);
    expect(tile(label).dataset.tip, label).toBe(tip);
    expect(within(tile(label)).getByText("1 run estimated")).toBeTruthy();
    expect(tile(label).textContent, label).not.toContain("not recorded");
  }
  expect(tile("Flags").textContent).not.toContain("not recorded");
  expect(tile("Flags").classList.contains("inferred")).toBe(false);
  const funnel = across().querySelector('[data-component="SharingFunnel"]') as HTMLElement;
  expect(funnel.classList.contains("inferred")).toBe(true);
  expect(funnel.dataset.tip).toBe(tip);
  expect(funnel.querySelector(".foot")!.textContent).toContain("1 run estimated.");
});

test("a runs-table cell whose two figures are null reads not recorded once; an estimated one carries the estimate's tip (D34, D44, SL9)", () => {
  const [recorded, old] = ACROSS.runs;
  const unknown = { ...recorded, run: 21, title: "Nothing kept", plan: { ...recorded.plan!, shared: { ...recorded.plan!.shared, files: null, agreed: null, perFile: [] } } };
  openAcross({ ...ACROSS, runs: [...ACROSS.runs, unknown] });
  const table = across().querySelector('[data-component="RunsTable"]') as HTMLElement;
  const settledOf = (title: string): HTMLElement => within(table).getByText(title).closest("tr")!.querySelectorAll("td")[4] as HTMLElement;
  expect(settledOf("Nothing kept").textContent!.trim()).toBe("not recorded");
  expect(settledOf(old.title).classList.contains("inferred")).toBe(true);
  expect(settledOf(old.title).title).toMatch(/^Estimated: /);
  expect(settledOf(old.title).textContent).toContain("0 of 1");
  expect(settledOf(recorded.title).classList.contains("inferred")).toBe(false);
});

test("the funnel's footnote over an estimated scope says what an estimated shared file is; a recorded scope keeps the held-at-once rule (D44, D45, D46, SL10, SL11)", () => {
  openAcross();
  const foot = () => across().querySelector('[data-component="SharingFunnel"] .foot')!.textContent!;
  expect(foot()).toContain("Estimated: a shared file is one two members claimed while both were members of the run.");
  expect(foot()).not.toContain("claimed while another held it");
  cleanup();
  openAcross({ ...ACROSS, totals: { ...ACROSS.totals, shared: { ...ACROSS.totals.shared, estimatedRuns: 0 } } });
  expect(foot()).toContain("A shared file is one a second member claimed while another held it");
});

test("the funnel's first drop reads not every holder told (D38, D46, SL11)", () => {
  openAcross();
  const funnel = across().querySelector('[data-component="SharingFunnel"]') as HTMLElement;
  expect([...funnel.querySelectorAll(".drop")].map((d) => d.textContent)).toContain("−1 not every holder told");
  expect(funnel.textContent).not.toContain("tagged one holder only");
});

/** The across view over brainstorm runs too: its debate figures filled. */
const DEBATED: Stats = {
  ...ACROSS,
  // 2 brainstorm runs not recorded, where the scope has 1 run not recorded in all: the tile reads its own (round 2)
  totals: {
    ...ACROSS.totals,
    brainstorm: { notRecorded: 2, questionsSettled: 7, questions: 8, exchangesMedian: 5, objectedThenAgreed: 2, sourcedShare: 0.75, claimsWithSource: { n: 18, of: 24 }, silentSeats: null },
  },
};
const PLAN_TILES = ["Slices merged", "Slice time", "Lock wait", "Shared files settled", "Flags", "Rebase conflicts", "Silent members"];
const BRAINSTORM_TILES = ["Questions settled", "Exchanges to agree", "Objected, then agreed again", "Claims with a source", "Silent seats"];
const tileLabels = (): string[] => [...across().querySelectorAll<HTMLElement>('[data-component="KpiTile"] .k')].map((k) => k.firstChild!.textContent!);

test("brainstorm chosen: a row of brainstorm tiles from totals.brainstorm; the plan tiles only while plan is chosen (D35, D46, SL11)", () => {
  openAcross(DEBATED);
  expect(tileLabels()).toEqual([...PLAN_TILES, ...BRAINSTORM_TILES]);
  fireEvent.click(within(across()).getByRole("button", { name: "plan" }));
  expect(tileLabels()).toEqual(BRAINSTORM_TILES);
  const row = across().querySelector('[data-component="BrainstormTiles"]') as HTMLElement;
  expect([...row.querySelectorAll(".v")].map((v) => v.textContent)).toEqual(["7of 8", "5median", "2questions", "75%18 of 24", "not recorded"]);
  expect(tile("Claims with a source").classList.contains("inferred")).toBe(true);
  // Silent seats counts the brainstorm runs not recorded, never the plan runs' (round 2)
  expect(within(tile("Silent seats")).getByText("2 runs not recorded")).toBeTruthy();
  expect(tile("Silent seats").textContent).not.toContain("1 run not recorded");
  // plan alone: no brainstorm row
  fireEvent.click(within(across()).getByRole("button", { name: "plan" }));
  fireEvent.click(within(across()).getByRole("button", { name: "brainstorm" }));
  expect(tileLabels()).toEqual(PLAN_TILES);
});

test("brainstorm alone: no shared-files funnel, merge lock or hot files, and the runs table without its plan columns; with plan, a brainstorm row reads — in each (round 2)", () => {
  const hot = { path: "src/session.ts", runs: [4, 9], holders: 3, agreements: 1, conflicts: 0, declaredInterface: 0, perRun: [{ run: 4, holders: 2, conflict: false }, { run: 9, holders: 2, conflict: false }] };
  openAcross({ ...DEBATED, files: [hot] });
  const panel = (name: string) => across().querySelector(`[data-component="${name}"]`);
  const headings = () => [...across().querySelectorAll('[data-component="RunsTable"] th')].map((th) => th.textContent);
  for (const name of ["SharingFunnel", "MergeLockPanel", "HotFiles"]) expect(panel(name), name).toBeTruthy();
  expect(headings()).toEqual(["Run", "Members", "Length", "Lock wait p50", "Shared files settled", "Flags", "Conflicts", "Stale"]);
  // the brainstorm row: — in every plan column, never a sentence in one of them
  const table = panel("RunsTable") as HTMLElement;
  const cells = [...within(table).getByText("Theme tokens").closest("tr")!.querySelectorAll("td")].map((td) => td.textContent);
  expect(cells.slice(3, 7)).toEqual(["—", "—", "—", "—"]);
  fireEvent.click(within(across()).getByRole("button", { name: "plan" }));
  for (const name of ["SharingFunnel", "MergeLockPanel", "HotFiles"]) expect(panel(name), name).toBeNull();
  expect(headings()).toEqual(["Run", "Members", "Length", "Stale"]);
});

// U-F33 (D57): All runs shows each open paused run's chip, as a run tab's head does, its code before the label
const FIRST_OPEN = LIVE.runs.find((r) => r.open)!;
const withPause = (paused: { text: string; person: boolean } | null): BoardSnapshot =>
  ({ ...LIVE, runs: LIVE.runs.map((r) => (r === FIRST_OPEN ? { ...r, paused } : r)) }) as BoardSnapshot;
const openAcrossOn = (board: BoardSnapshot) => {
  standIn([board], ACROSS, [PLAN_RUN]);
  render(<BoardView repos={[board.repo]} run={null} />);
  fireEvent.click(within(screen.getByRole("navigation", { name: "Runs" })).getByRole("button", { name: "All runs" }));
};

test.each([
  [{ text: "approve the mockup", person: true }, "On you", "person"],
  [{ text: "hold for the review", person: false }, "Paused", "orchestrator"],
])("All runs shows a paused run's chip: %o", (paused, label, by) => {
  openAcrossOn(withPause(paused));
  const pause = document.querySelector('[data-component="AllRunsPauses"] [data-component="RunPause"]')!;
  expect(pause.querySelector(".name")!.textContent).toBe(label);
  expect(pause.getAttribute("data-pause")).toBe(by);
  expect(pause.getAttribute("title")).toContain(paused.text);
  expect(pause.querySelector(".code")!.textContent).toBe(FIRST_OPEN.code);
});

test("All runs with no paused run shows no pause chip", () => {
  openAcrossOn(withPause(null));
  expect(document.querySelector('[data-component="RunPause"]')).toBeNull();
});
