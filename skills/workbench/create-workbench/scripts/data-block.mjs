// The one writer of a workbench page's data block, `<script id="data" type="application/json">`.
// Copied into the bench's own skill, `scripts/data-block.mjs`, and imported by its feed.
//
//   derived feed  writeData(page, data)              the whole block, rebuilt from the sources
//   log feed      appendEntry(page, entry) -> index  one entry, never rewritten
//                 annotate(page, index, notes)       notes beside an entry, the entry untouched
//
// A log page is the only record of what it holds, so a log is never passed to writeData.
import { readFileSync, writeFileSync } from "node:fs";

const BLOCK = /(<script id="data" type="application\/json">)([\s\S]*?)(<\/script>)/;

const fail = (page, message) => {
  throw new Error(`data block, ${page}: ${message}`);
};

export function readData(page) {
  const m = readFileSync(page, "utf8").match(BLOCK);
  if (!m) fail(page, 'no <script id="data" type="application/json"> in the page');
  return JSON.parse(m[2]);
}

export function writeData(page, data) {
  const html = readFileSync(page, "utf8");
  if (!BLOCK.test(html)) fail(page, 'no <script id="data" type="application/json"> in the page');
  if (readData(page)?.log === true) fail(page, "a log page is appended to, never rewritten");
  // `<` escaped so nothing in the data can close the script element.
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  writeFileSync(page, html.replace(BLOCK, (_, open, _old, close) => open + json + close));
}

const writeLog = (page, log) => {
  const html = readFileSync(page, "utf8");
  const json = JSON.stringify(log).replace(/</g, "\\u003c");
  writeFileSync(page, html.replace(BLOCK, (_, open, _old, close) => open + json + close));
};

const readLog = (page) => {
  const data = readData(page);
  if (data === null) return { log: true, entries: [] };
  if (data?.log !== true) fail(page, "not a log page; a derived page is rewritten with writeData");
  return data;
};

/** Appends one entry exactly as given, with an empty `notes`; returns its index. */
export function appendEntry(page, entry) {
  const log = readLog(page);
  log.entries.push({ at: new Date().toISOString(), entry, notes: {} });
  writeLog(page, log);
  return log.entries.length - 1;
}

/** Sets notes beside an entry (a verdict, a proposal); the entry itself never moves. */
export function annotate(page, index, notes) {
  const log = readLog(page);
  if (!log.entries[index]) fail(page, `no entry ${index}; the log holds ${log.entries.length}`);
  Object.assign(log.entries[index].notes, notes);
  writeLog(page, log);
}
