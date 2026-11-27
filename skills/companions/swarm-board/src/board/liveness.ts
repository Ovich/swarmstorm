// Liveness from token counters: a member's link reads its transcript (link/adapters.ts) and reports one number that
// moves while the member works. The board stores the readings; the stall rule reads only them, never board calls.
/** A member whose link has sent no activity this long after its join has no transcript: a card note, never an alarm (board-split D55). */
// SWARM_NO_TRANSCRIPT_MS: a test scene with no link sets it past its own length, so the notice cannot land mid-scene (board-split T21, S31)
export const NO_TRANSCRIPT_MS = Number(process.env.SWARM_NO_TRANSCRIPT_MS) || 30 * 1000;
/** The default stall window of a run (simple-states: 10 min): a member whose tokens did not move this long reads
 *  stopped, and a swarm none of whose members moved is told stopped. */
export const STALL_MS_DEFAULT = 10 * 60 * 1000;
/** The stall window is never shorter, whatever a run stored (runs opened before keep an older default) or `open
 *  --stall-ms` asked. SWARM_STALL_FLOOR_MS: a scaled test scene lowers it; read at each use. */
/** board-split D55 (amended, U-F27): a lost or stalled episode opens once its predicate held this long, and an open one
 *  closes once it held false this long: time, never a count of ticks. SWARM_BADGE_CONFIRM_MS: the suite's older
 *  scenes, which confirm in two ticks, set it short (tests/fixtures/outside-harness.ts); read at each use. */
export const BADGE_CONFIRM_MS = 10 * 1000;
export const badgeConfirmMs = (): number => Number(process.env.SWARM_BADGE_CONFIRM_MS) || BADGE_CONFIRM_MS;
export const stallMsFloor = (): number => Number(process.env.SWARM_STALL_FLOOR_MS) || STALL_MS_DEFAULT;
/** Readings older than this are pruned. */
export const READINGS_KEPT_MS = 10 * 60 * 1000;
/** board-split D55: lost needs its link unseen, its last sign, the server's start and its seating all this old: twelve
 *  missed heartbeats, longer than a server restart plus every link's reconnect, and the time a harness takes to start a
 *  member's link after `join` or a restart (D55 (6)). */
export const LOST_MS = 60 * 1000;

/** A member's one state (simple-states), from three facts: is its link up, are its tokens moving, did it owe the open
 *  phase when its link dropped (the orchestrator always owes). Link up: `working` moving, `stopped` not. Link down:
 *  `lost` owing at the drop (needs action), `away` not (handed back, resumable). `ended`: it left,
 *  or its run closed. What it is on (a call, a merge) is its `doing`, never a state. */
export type CoreMemberState = "working" | "stopped" | "away" | "lost" | "ended";

type CoreStateFacts = { runOpen: boolean; ended: boolean; linkDown: boolean; owedAtDrop: boolean; moving: boolean };

/** The one derivation of a member's state, read by snapshot, roster, status, seats and reader alike. */
export function coreStateOf(m: CoreStateFacts): CoreMemberState {
  if (!m.runOpen || m.ended) return "ended";
  if (m.linkDown) return m.owedAtDrop ? "lost" : "away";
  return m.moving ? "working" : "stopped";
}

/** A seat's state: its member's, or `empty` while nobody has sat in it. */
export type SeatState = CoreMemberState | "empty";
