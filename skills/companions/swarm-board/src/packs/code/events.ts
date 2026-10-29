// The code pack's events (board-split D18): declared here, contributed to the board's events by the registry, so a
// pack's events come with its folder. A leaf: it imports nothing at runtime, so the core reaches it without a cycle.
import type { EventDef } from "../../board/events.ts";

export const CODE_EVENTS = {
  merged: { name: "merged" },
  // a write outside the writer's claim on a path another holds (D10); mentions: the holder, then the writer
  flag: { name: "flag" },
} as const satisfies Record<string, EventDef<string>>;

export type CodeEventName = keyof typeof CODE_EVENTS;
