// board-split D53: lost needs no board call and no seating within LOST_MS; a test that wants a member lost dates
// its seating and its last calls back, through the raw store, as a member that went silent long ago.
import { openRawStore } from "./raw-store.ts";

/** Dates `seat`'s seating and its last board calls (every run's) `agoMs` back in the store at `file`. */
export const quietMember = (file: string, seat: string, agoMs = 10 * 60_000): void => {
  const db = openRawStore(file);
  try {
    const at = new Date(Date.now() - agoMs).toISOString();
    db.prepare("UPDATE participants SET joined_at = ?, seated_at = ?, last_call = ?, board_call_at = ? WHERE seat = ?").run(at, at, at, at, seat);
  } finally {
    db.close();
  }
};
