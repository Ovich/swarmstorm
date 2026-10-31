import type { Phase } from "../../../../../swarm-board/src/client/reader.ts";
import { phaseCountText, type PauseChip, type PhaseCount } from "../../../lib/board/view.ts";

/** A run tab's head (plan D31): its pause, its phases (`swarm phase`) and the open phase's done count; none before
 *  the first phase and while it runs unpaused. */
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

/** A paused run's chip (board-split#D57): the phase chip's shape, amber, a pause icon, `On you` or `Paused`, the reason
 *  on hover; `code`: the run's code before the label, where several runs show side by side (All runs, U-F33). */
export function RunPause({ pause, code = null }: { pause: PauseChip; code?: string | null }) {
  const reason = pause.reason ?? (pause.label === "On you" ? "The run waits on you" : "The orchestrator paused the run");
  return (
    <span className="runpause" data-component="RunPause" data-pause={pause.label === "On you" ? "person" : "orchestrator"} title={code ? `${code}: ${reason}` : reason}>
      <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <rect x="4" y="3" width="3" height="10" rx="1" />
        <rect x="9" y="3" width="3" height="10" rx="1" />
      </svg>
      {code && <span className="code">{code}</span>}
      <span className="name">{pause.label}</span>
    </span>
  );
}

export function RunViewSwitch({
  phase = null,
  phases = [],
  pause = null,
  progress = null,
}: {
  phase?: Phase | null;
  /** Every phase the run opened, in order: drawn as a strip, the last one current. Empty: the current phase alone. */
  phases?: { name: string; text: string }[];
  /** The run's pause (`On you` or `Paused`, its reason), null when it runs: shown in the head (D57). */
  pause?: PauseChip | null;
  /** The open phase's one done count (board-split D62), the lost named on hover; null before the first phase. */
  progress?: PhaseCount | null;
}) {
  const labels = phaseLabels(phases);
  // the conversation's head holds the pause and the phases alone: neither, no head
  if (phases.length <= 1 && !phase && !pause) return null;
  return (
    <div className="runhead" data-component="RunViewSwitch" data-state="conversation">
      {pause && (
        <RunPause pause={pause} />
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
      {progress && <PhaseCountChip progress={progress} />}
    </div>
  );
}

/** The open phase's done count beside its chip (board-split D62): `2/7 done`, the lost members named on hover. */
function PhaseCountChip({ progress }: { progress: PhaseCount }) {
  const lost = (progress.gone ?? []).map((m) => m.slice(m.lastIndexOf("/") + 1));
  const tip = `phase ${progress.phase}: ${phaseCountText(progress)}${lost.length ? " (lost members are out of the count)" : ""}`;
  return (
    <span className="runcount" data-component="PhaseCount" title={tip}>
      {progress.done}/{progress.of} done{lost.length ? `, ${lost.length} lost` : ""}
    </span>
  );
}
