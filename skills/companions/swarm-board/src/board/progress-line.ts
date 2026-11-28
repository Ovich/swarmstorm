// A phase's done count as one line, shared by the phase that counts it and the members' alarms that name it.
import type { PhaseProgress } from "./phases/owing.ts";

/** Members as their seats, short: `w2, w3`. */
const seatsOf = (members: string[]): string => members.map((m) => m.slice(m.lastIndexOf("/") + 1)).join(", ");

/** The count as every line prints it: `3/3 done`, `, 1 lost: w2` naming each member left out of it (D41, D62). */
export const progressText = (p: PhaseProgress): string =>
  `${p.done}/${p.of} done${p.gone.length ? `, ${p.gone.length} lost: ${seatsOf(p.gone)}` : ""}`;
