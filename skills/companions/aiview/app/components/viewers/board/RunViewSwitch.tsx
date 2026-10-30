import { useEffect, useState } from "react";
import type { Phase } from "../../../../../swarm-board/src/client/reader.ts";
import type { RunView } from "../../../lib/board/analytics.ts";
import type { PauseChip } from "../../../lib/board/view.ts";

/** A run tab's head (plan D31, prototype #677 `run`, `brun`, `conv`): Conversation / Analytics, the run's
 *  line, and on Analytics "Copy as JSON", the run's answer as the server sent it, equal to
 *  `swarm stats --run <id> --all --json` (D34). `json` null hides the button. `phase`: the run's current
 *  phase (`swarm phase`), shown after the line; none before the first. */
/** The phases drawn one by one at the strip's end; the earlier fold into one segment. */
const PHASES_SHOWN = 6;

/** Each phase's label: its name, and the nth time it opened when the run opened it more than once
 *  (a build-verify loop reads "build 1", "verify 1", "build 2"…); a name opened once stays bare. */
export function phaseLabels(phases: { name: string }[]): string[] {
  const total = new Map<string, number>();
  for (const p of phases) total.set(p.name, (total.get(p.name) ?? 0) + 1);
  const seen = new Map<string, number>();
  return phases.map((p) => {
    const nth = (seen.get(p.name) ?? 0) + 1;
    seen.set(p.name, nth);
    return (total.get(p.name) ?? 0) > 1 ? `${p.name} ${nth}` : p.name;
  });
}

/** The run's Analytics pill: pressed shows the run's analytics, pressed again its conversation. */
export function RunAnalyticsButton({ view, onView }: { view: RunView; onView: (view: RunView) => void }) {
  return (
    <button
      className="abtn"
      data-component="RunAnalyticsButton"
      aria-pressed={view === "analytics"}
      title="This run's analytics"
      onClick={() => onView(view === "analytics" ? "conversation" : "analytics")}
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d="M2 14V9M6 14V4M10 14V7M14 14V2" />
      </svg>
      Analytics
    </button>
  );
}

export function RunViewSwitch({
  view,
  line,
  json,
  onView,
  phase = null,
  phases = [],
  pause = null,
}: {
  view: RunView;
  line: string;
  json: string | null;
  onView: (view: RunView) => void;
  phase?: Phase | null;
  /** Every phase the run opened, in order: drawn as a strip, the last one current. Empty: the current phase alone. */
  phases?: { name: string; text: string }[];
  /** The run's pause (`On you` or `Paused`, its reason), null when it runs: shown on both views (D57). */
  pause?: PauseChip | null;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = (): void => {
    if (json === null) return;
    void navigator.clipboard?.writeText(json).then(() => setCopied(true));
  };
  const labels = phaseLabels(phases);
  // the conversation's head holds the pause and the phases alone: neither, no head
  if (view === "conversation" && phases.length <= 1 && !phase && !pause) return null;
  return (
    <div className="runhead" data-component="RunViewSwitch" data-state={view === "analytics" && copied ? "analytics+copied" : view}>
      {pause && (
        <span
          className="runpause"
          data-component="RunPause"
          data-pause={pause.label === "On you" ? "person" : "orchestrator"}
          title={pause.reason ?? (pause.label === "On you" ? "The run waits on you" : "The orchestrator paused the run")}
        >
          <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <rect x="4" y="3" width="3" height="10" rx="1" />
            <rect x="9" y="3" width="3" height="10" rx="1" />
          </svg>
          <span className="name">{pause.label}</span>
        </span>
      )}
      {phases.length > 1 ? (
        <span className="phases" data-component="PhaseStrip">
          {phases.length > PHASES_SHOWN && (
            <span
              className="pseg done earlier"
              title={phases
                .slice(0, phases.length - PHASES_SHOWN)
                .map((p, i) => `${i + 1}. ${labels[i]}${p.text ? `: ${p.text}` : ""}`)
                .join("\n")}
            >
              <span className="name">{phases.length - PHASES_SHOWN} earlier</span>
            </span>
          )}
          {phases.slice(-PHASES_SHOWN).map((p, k, shownPhases) => {
            const now = k === shownPhases.length - 1;
            const label = labels[phases.length - shownPhases.length + k];
            return (
              <span key={`${k}-${p.name}`} className={now ? "pseg now" : "pseg done"} data-phase={p.name} title={p.text ? `${label}: ${p.text}` : label}>
                <span className="name">{label}</span>
                {now && p.text && <span className="said">{p.text}</span>}
                {!now && <span className="ok" aria-label="done">✓</span>}
              </span>
            );
          })}
        </span>
      ) : phase && (
        <span className="runphase" data-component="RunPhase" data-phase={phase.name} title={`The run's current phase: ${phase.name}`}>
          <span className="name">{phase.name}</span>
          {phase.text && <span className="said" title={phase.text}>{phase.text}</span>}
        </span>
      )}
      <span className="runtools" role="group" aria-label="This run">
        {view === "analytics" && <span className="runline" title={line}>{line}</span>}
        {view === "analytics" && json !== null && (
          <button className="ghost" onClick={copy}>
            {copied ? "Copied" : "Copy as JSON"}
          </button>
        )}
        {/* on the conversation, the pill sits at the filters' right end instead */}
        {view === "analytics" && <RunAnalyticsButton view={view} onView={onView} />}
        {view === "analytics" && (
          <button className="abtn close" data-component="CloseAnalytics" aria-label="Close analytics" title="Back to the conversation" onClick={() => onView("conversation")}>
            ×
          </button>
        )}
      </span>
    </div>
  );
}
