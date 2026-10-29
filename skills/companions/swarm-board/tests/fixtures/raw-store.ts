// The store opened raw by a test, for what the board's interface cannot do (dating rows in the past, a trigger).
// A board server of the test may be writing it at the same moment: the raw connection waits that write out
// (SQLite's busy timeout) instead of failing with "database is locked" (S31).
import { DatabaseSync } from "node:sqlite";

/** How long a raw statement waits for the server's write to finish: far above any one write, under any test's timeout. */
const RAW_BUSY_WAIT_MS = 10_000;

export const openRawStore = (file: string, opts: { readOnly?: boolean } = {}): DatabaseSync => new DatabaseSync(file, { ...opts, timeout: RAW_BUSY_WAIT_MS });
