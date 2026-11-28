// How the board's messages read in a terminal: one place for the CLI's verbs.
import type { Message } from "../contract/board.ts";

/** A posted message's seq. */
export const seqLine = (m: Message): string => `#${m.seq}`;

export const fullText = (m: Message): string => {
  const kind = m.kind === "msg" ? "" : ` (${m.kind})`;
  const about = m.about ? ` about ${m.about}` : "";
  return `#${m.seq} ${m.from}${kind}${about}  ${m.at}\n${m.body}${m.answer ? `\n${m.answer}` : ""}`;
};
