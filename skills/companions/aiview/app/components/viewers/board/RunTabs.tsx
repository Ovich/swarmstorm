// The board's top row (D7, prototype #643): Archive first, opening the closed runs, then one tab per open run, an
// archived run picked as a tab with ×, and the merge lock at the row's end, always visible.
// Analytics, beside the lock, opens the across-runs view; while it shows, no run tab is pressed.
import type { BoardSnapshot } from "../../../../../swarm-board/src/client/reader.ts";
import { phaseCountText, runHue, seatCount, type RunId, type RunTab } from "../../../lib/board/view.ts";
import { AnalyticsButton } from "./AnalyticsButton.tsx";
import { MergeLock } from "./MergeLock.tsx";

/** A tab's count, as words: a plan's slices merged of its slices, a brainstorm's or a task's seats (rule 12); null for none. */
export function countText(tab: RunTab): string | null {
  // board-split D62: with a phase open, the phase's one count
  if (tab.progress) return `phase ${tab.progress.phase} ${phaseCountText(tab.progress)}`;
  if (tab.of === 0) return null;
  return tab.kind === "brainstorm" || tab.kind === "task" ? seatCount(tab.of) : `${tab.done}/${tab.of} merged`;
}

/** What the tab no longer prints, said on hover: the protocol or kind, the count and the state. */
function tabTip(tab: RunTab, state: string): string {
  return [tab.title, tab.protocol ? `${tab.protocol} · ${tab.kind} run` : `${tab.kind} run`, countText(tab), state].filter(Boolean).join(" · ");
}

/** The tab's state as a dot alone: live, quiet or closed in its colour, named for a screen reader. */
function StateDot({ state }: { state: string }) {
  return <span className={`dot s-${state}`} data-component="RunState" role="img" aria-label={state} />;
}

/** The run's code, in its colour. */
function Code({ tab }: { tab: RunTab }) {
  return (
    <span className="code" style={{ color: `hsl(${runHue(tab.code)} 55% 45%)` }}>
      {tab.code}
    </span>
  );
}

/** One open run: its state dot, its code and its title; the rest on hover (simpler tab, 2026-10-29). */
function RunTabButton({ tab, picked, onPick }: { tab: RunTab; picked: boolean; onPick: () => void }) {
  return (
    <button className={tab.state === "closed" ? "run closed" : "run"} data-component="RunTab" aria-pressed={picked} title={tabTip(tab, tab.state)} onClick={onPick}>
      <StateDot state={tab.state} />
      <Code tab={tab} />
      <span className="t">{tab.title}</span>
    </button>
  );
}

export function RunTabs({
  tabs,
  archived,
  pick,
  lock,
  lockHistory,
  menuOpen,
  onMenu,
  onPick,
  analytics,
  onAnalytics,
  closedCount = 0,
}: {
  tabs: RunTab[];
  archived: RunTab | null;
  pick: RunId | null;
  lock: BoardSnapshot["lock"];
  lockHistory: BoardSnapshot["lockHistory"];
  menuOpen: boolean;
  onMenu: (open: boolean) => void;
  onPick: (run: RunId | null) => void;
  /** The across-runs view is shown. */
  analytics: boolean;
  onAnalytics: () => void;
  /** How many closed runs the archive holds, on its pill. */
  closedCount?: number;
}) {
  return (
    <nav className="runs" data-component="RunTabs" aria-label="Runs">
      {/* the tabs scroll in their own strip, so the tools beside them never cover one */}
      <span className="tabstrip">
      <button
        className="run menu"
        aria-label="Archive"
        title={`Archive: ${closedCount} closed runs`}
        aria-expanded={menuOpen}
        onClick={(e) => {
          e.stopPropagation();
          onMenu(!menuOpen);
        }}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
        </svg>
      </button>
      {tabs.map((t) => (
        <RunTabButton key={t.run} tab={t} picked={!analytics && pick === t.run} onPick={() => onPick(t.run)} />
      ))}
      {archived && (
        <span className="run archived" data-component="ArchivedTab" aria-pressed={!analytics && pick === archived.run} title={tabTip(archived, "archived")}>
          <StateDot state="closed" />
          <Code tab={archived} />
          <span className="t">{archived.title}</span>
          <button className="x" aria-label="Close the archived run" onClick={() => onPick(tabs[0]?.run ?? null)}>
            ×
          </button>
        </span>
      )}
      </span>
      <span className="lockwrap">
        <AnalyticsButton pressed={analytics} onPress={onAnalytics} />
        <MergeLock lock={lock} history={lockHistory} />
      </span>
    </nav>
  );
}
