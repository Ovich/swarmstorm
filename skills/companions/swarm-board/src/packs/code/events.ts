// The code pack's events (board-split D18): declared here, contributed to the board's events by the registry, so a
// pack's events come with its folder. A leaf: it imports nothing at runtime, so the core reaches it without a cycle.
import type { EventDef } from "../../board/events.ts";

export const CODE_EVENTS = {
  merged: { name: "merged", lands: true },
  // a write outside the writer's claim on a path another holds (D10); mentions: the holder, then the writer
  // posted in the writer's name, it reaches the writer too (v1-7)
  flag: { name: "flag", toAuthor: true },
  // claims-phase: a path the member changed that another member merged this phase and its branch lacks; mentions: the member
  // posted in the member's name, to the member: it reaches its author (v1-1)
  drift: { name: "drift", toAuthor: true },
} as const satisfies Record<string, EventDef<string>>;

/** board-split V-22: the merge lock's name in an `unlocked` event, when the board frees it from a lost holder. */
export const MERGE_LOCK = "merge-lock";

export type CodeEventName = keyof typeof CODE_EVENTS;
