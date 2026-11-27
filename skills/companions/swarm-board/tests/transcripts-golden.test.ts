// The transcripts golden (codebase-rework#D23): `observe` over the yardstick scenarios' transcripts, on a fixed clock,
// the activity and the cursor after each second something was written, compared to one golden.
// SWARM_UPDATE_GOLDEN=1 rewrites the golden.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { observe, type TranscriptCursor } from "../src/link/transcripts.ts";
import { writeSubagent } from "./fixtures/transcripts.ts";
import { PROJECT, SCENARIOS, SESSION } from "./fixtures/yardstick.ts";

const GOLDEN = path.join(import.meta.dirname, "fixtures", "transcripts-golden.jsonl");
const BASE = Date.UTC(2026, 0, 1);

/** JSON with sorted keys, Maps as their entries and Sets as arrays: the same state reads as the same bytes. */
function stable(value: unknown): string {
  if (value instanceof Map) return stable([...value.entries()]);
  if (value instanceof Set) return stable([...value]);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** One scenario's transcript written second by second; a line per second something was written to it. */
function observedLines(sc: (typeof SCENARIOS)[number]): string[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swarm-transcripts-golden-"));
  try {
    const file = writeSubagent(dir, PROJECT, SESSION, "x", [], { finished: false });
    fs.writeFileSync(file, "");
    const written = sc.steps.filter((st) => "line" in st || "output" in st || "finished" in st);
    const seconds = [...new Set(written.map((st) => st.s))].sort((a, b) => a - b);
    let cursor: TranscriptCursor | null = null;
    const lines: string[] = [];
    for (const s of seconds) {
      const at = new Date(BASE + s * 1000);
      for (const st of written.filter((w) => w.s === s)) {
        if ("line" in st) {
          fs.appendFileSync(file, JSON.stringify(st.line(BASE, s, dir)) + "\n");
          fs.utimesSync(file, at, at);
        } else if ("output" in st) {
          const out = path.join(dir, st.output);
          fs.appendFileSync(out, `output at ${s}\n`);
          fs.utimesSync(out, at, at);
        } else fs.writeFileSync(file.replace(/\.jsonl$/, ".meta.json"), JSON.stringify({ agentType: "general-purpose", finished: true }));
      }
      const read = observe(file, cursor);
      cursor = read.cursor;
      const text = stable({ s, activity: read.activity, cursor: read.cursor });
      // the scenario's folder, and the separator after it, read the same on every OS
      const placed = text.split(JSON.stringify(dir).slice(1, -1)).join("<dir>").split(dir).join("<dir>").replace(/<dir>(\\\\|\/)/g, "<dir>/");
      lines.push(`${sc.id} ${placed}`);
    }
    return lines;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("observe reads every yardstick transcript as its golden", () => {
  const observed = SCENARIOS.filter((sc) => !sc.blind).flatMap(observedLines).join("\n") + "\n";
  if (process.env.SWARM_UPDATE_GOLDEN === "1") fs.writeFileSync(GOLDEN, observed);
  assert.equal(observed, fs.readFileSync(GOLDEN, "utf8"));
});
