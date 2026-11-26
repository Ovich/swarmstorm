// The verbs that find code which no longer fits what the system has become, each read exactly from the
// syntax and the import graph: words of retired concepts, barrels that only pass names on, exports read by
// one file, types with a single implementation, and `kind` variants nothing writes.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { headShaOf, inScope, scopeOf, stateAt } from "./comparison.mjs";

/** The parts of an identifier or a path, lower-cased: `coachVoiceReply` → coach, voice, reply. */
const partsOf = (word) =>
  word
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((p) => p.toLowerCase());

export const FIT_VERBS = {
  retired: {
    help: "retired <word>… [--in <scope>]   every path, name and line holding a word of a retired concept (whole word parts: voice matches coachVoice, not invoice), comments apart from code",
    run(root, words, flags = {}) {
      if (!words.length) throw new Error("name the retired words: retired voice coach …");
      const wanted = new Set(words.map((w) => w.toLowerCase()));
      const s = stateAt(root, headShaOf(root, flags), false), keep = inScope(scopeOf(s, flags.in));
      const hits = { paths: [], code: [], comments: [] };
      for (const path of s.model.files.keys()) {
        if (!keep(path)) continue;
        if (partsOf(path).some((p) => wanted.has(p))) hits.paths.push(path);
        let text;
        try { text = readFileSync(join(root, path), "utf8"); } catch { continue; }
        text.split("\n").forEach((line, i) => {
          const tokens = line.match(/[A-Za-z_$][\w$]*/g) ?? [];
          if (!tokens.some((t) => partsOf(t).some((p) => wanted.has(p)))) return;
          const trimmed = line.trim();
          (/^(\/\/|\/\*|\*)/.test(trimmed) ? hits.comments : hits.code).push(`${path}:${i + 1}  ${trimmed.slice(0, 120)}`);
        });
      }
      const lines = [`paths · ${hits.paths.length}`, ...hits.paths.map((p) => `  ${p}`), `code · ${hits.code.length}`, ...hits.code.map((l) => `  ${l}`), `comments · ${hits.comments.length}`, ...hits.comments.map((l) => `  ${l}`)];
      return { title: `retired ${words.join(" ")}`, lines, count: `retired ${words.join(", ")}: ${hits.paths.length} paths, ${hits.code.length} code lines, ${hits.comments.length} comment lines`, data: hits };
    },
  },
  barrels: {
    help: "barrels [scope]   files that only re-export (every statement an `export … from`), with who reads through each",
    run(root, [asked], flags = {}) {
      const s = stateAt(root, headShaOf(root, flags), false), keep = inScope(scopeOf(s, asked));
      const list = [...s.model.files].filter(([p, f]) => !f.test && f.onlyReexports && keep(p)).map(([path, f]) => ({ path, passes: f.imports.filter((i) => i.reexport).length, readers: new Set(s.model.edges.filter((e) => e.to === path).map((e) => e.from)).size }));
      return { title: "barrels", lines: list.map((b) => `${b.path}  passes ${b.passes} · read by ${b.readers} files`), count: `barrels: ${list.length} files that only re-export`, data: list };
    },
  },
  "single-use": {
    help: "single-use [scope]   exports exactly one other file imports (by name), with that file",
    run(root, [asked], flags = {}) {
      const s = stateAt(root, headShaOf(root, flags), false), keep = inScope(scopeOf(s, asked));
      const readers = new Map();
      for (const e of s.model.edges) if (!e.reexport) for (const n of e.names) if (n !== "*") { const k = `${e.to}#${n}`; (readers.get(k) ?? readers.set(k, new Set()).get(k)).add(e.from); }
      const list = [];
      for (const [path, f] of s.model.files) if (!f.test && keep(path)) for (const ex of f.exports) { const r = readers.get(`${path}#${ex.name}`); if (r?.size === 1) list.push({ path, name: ex.name, line: ex.line, by: [...r][0] }); }
      return { title: "single-use", lines: list.map((x) => `${x.name}  ${x.path}:${x.line}  ← ${x.by}`), count: `single-use: ${list.length} exports read by exactly one file`, data: list };
    },
  },
  "one-impl": {
    help: "one-impl [scope]   interfaces and types that exactly one class implements or one object satisfies, with that site",
    run(root, [asked], flags = {}) {
      const s = stateAt(root, headShaOf(root, flags), false), keep = inScope(scopeOf(s, asked));
      const impls = new Map();
      for (const [path, f] of s.model.files) if (!f.test) for (const x of [...(f.implementsOf ?? []), ...(f.satisfiesOf ?? [])]) (impls.get(x.name) ?? impls.set(x.name, []).get(x.name)).push(`${path}:${x.line}`);
      const list = [];
      for (const [path, f] of s.model.files) if (!f.test && keep(path)) for (const ex of f.exports) if ((ex.declKind === "interface" || ex.declKind === "type") && impls.get(ex.name)?.length === 1) list.push({ path, name: ex.name, line: ex.line, by: impls.get(ex.name)[0] });
      return { title: "one-impl", lines: list.map((x) => `${x.name}  ${x.path}:${x.line}  ← ${x.by}`), count: `one-impl: ${list.length} types with a single implementation (implements / satisfies)`, data: list };
    },
  },
  unproduced: {
    help: "unproduced [scope]   `kind` variants a type declares that no object literal in the code writes (a value parsed from storage or a model is not seen: check those sources)",
    run(root, [asked], flags = {}) {
      const s = stateAt(root, headShaOf(root, flags), false), keep = inScope(scopeOf(s, asked));
      const produced = new Set();
      for (const [, f] of s.model.files) for (const v of f.kindProduced ?? []) produced.add(v);
      const list = [];
      for (const [path, f] of s.model.files) if (!f.test && keep(path)) for (const d of f.kindDeclared ?? []) if (!produced.has(d.value)) list.push({ value: d.value, at: `${path}:${d.line}` });
      return { title: "unproduced", lines: list.map((x) => `"${x.value}"  ${x.at}`), count: `unproduced: ${list.length} kind variants no object literal writes`, data: list };
    },
  },
};
