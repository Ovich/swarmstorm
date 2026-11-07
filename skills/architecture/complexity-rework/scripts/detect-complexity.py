#!/usr/bin/env python3
"""Cross-language scanner for loaded functions.

Uses lizard (pip install lizard) for function boundaries and cyclomatic
complexity, then scores each function on language-specific fingerprints
(see references/measure.md) and groups findings into candidate families.
Heuristic: results are leads to confirm by reading the code.

Usage: detect-complexity.py <dir-or-file> [--min-score N] [--lang a,b] [--json PATH] [--top N]
"""
import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

try:
    import lizard
except ImportError:
    sys.exit("lizard is required: pip install lizard (add --break-system-packages if needed)")

LANG_BY_EXT = {
    ".ts": "ts", ".tsx": "ts", ".mts": "ts", ".cts": "ts",
    ".js": "js", ".jsx": "js", ".mjs": "js", ".cjs": "js", ".vue": "js",
    ".py": "python", ".java": "java", ".kt": "kotlin", ".kts": "kotlin", ".scala": "scala",
    ".cs": "csharp", ".go": "go", ".rs": "rust", ".php": "php", ".rb": "ruby",
    ".swift": "swift", ".c": "c", ".h": "c", ".cpp": "cpp", ".cc": "cpp", ".hpp": "cpp",
}
SKIP_DIRS = {"node_modules", "dist", "build", "target", "vendor", ".git", ".venv", "venv",
             "__pycache__", ".next", "coverage", ".turbo", "bin", "obj", "generated", "gen"}

R = re.compile
# Type tests / parse attempts. Group 1, when present, captures the type or schema name.
TYPE_TESTS = {
    "ts": [R(r"(\w+)\.safeParse\("), R(r"instanceof\s+(\w+)"), R(r"typeof\s+[\w.\[\]\"']+\s*[!=]=="),
           R(r"[\"'](\w+)[\"']\s+in\s+\w+"), R(r"\b(is\w+)\(\w+\)")],
    "python": [R(r"isinstance\(\s*\w+\s*,\s*\(?([\w.]+)"), R(r"type\(\w+\)\s*(?:is|==)\s*([\w.]+)"),
               R(r"hasattr\(\s*\w+\s*,\s*[\"'](\w+)"), R(r"(\w+)\.(?:model_validate|parse_obj)\(")],
    "java": [R(r"instanceof\s+([\w.]+)"), R(r"getClass\(\)"), R(r"([\w.]+)\.class\.isInstance\(")],
    "kotlin": [R(r"\bis\s+([A-Z][\w.]*)"), R(r"as\?\s*([A-Z][\w.]*)")],
    "scala": [R(r"isInstanceOf\[([\w.]+)\]"), R(r"case\s+\w+\s*:\s*([A-Z][\w.]*)")],
    "csharp": [R(r"\bis\s+(?:not\s+)?([A-Z][\w.]*)"), R(r"\bas\s+([A-Z][\w.]*)"), R(r"GetType\(\)"), R(r"(\w+)\.TryParse\(")],
    "go": [R(r"\.\(type\)"), R(r",\s*ok\s*:?=\s*\w+\.\(\*?([\w.]+)\)"), R(r"case\s+\*?([A-Z][\w.]*)\s*[:,]")],
    "rust": [R(r"downcast_ref::<([\w:]+)>"), R(r"Value::(\w+)\(")],
    "php": [R(r"instanceof\s+([\w\\]+)"), R(r"\bis_(array|string|int|object|numeric|bool)\("), R(r"gettype\(")],
    "ruby": [R(r"\.(?:is_a|kind_of|instance_of)\?\(?\s*([\w:]+)"), R(r"respond_to\?\(?\s*:(\w+)")],
    "swift": [R(r"\bis\s+([A-Z]\w*)"), R(r"as\?\s*([A-Z]\w*)")],
    "c": [], "cpp": [R(r"dynamic_cast<([\w:*]+)>"), R(r"holds_alternative<([\w:]+)>")],
}
TYPE_TESTS["js"] = TYPE_TESTS["ts"]

# Field access compared to a string literal. Group 1 captures the field name.
Q = r"[\"'`]"
FIELD_CMP_COMMON = [
    R(r"\[\s*" + Q + r"(\w+)" + Q + r"\s*\]\s*(?:===?|!==?)\s*" + Q),     # x["kind"] == "..."
    R(r"\.(\w+)\s*(?:===?|!==?)\s*" + Q),                                   # x.kind == "..."
    R(r"\.get\(\s*" + Q + r"(\w+)" + Q + r"\s*\)\s*(?:===?|!=)\s*" + Q),    # x.get("kind") == "..."
    R(r"\.(?:get)?(\w+)\(\)\s*\.equals\(\s*\""),                            # x.getType().equals("...")
    R(r"\"\w*\"\.equals\(\s*\w+\.(?:get)?(\w+)"),                           # "x".equals(o.type)
    R(r"\[\s*:(\w+)\s*\]\s*==\s*" + Q),                                     # x[:kind] == "..."
    R(r"\$\w+\[\s*" + Q + r"(\w+)" + Q + r"\s*\]\s*[!=]==?\s*" + Q),      # $x['kind'] === "..."
    R(r"(?<![.\w\]])(\w+)\s*(?:===?|!==?)\s*" + Q),                          # kind == "..."
]
CASE_LABEL = R(r"^\s*(?:case|when)\s+" + Q + r"|^\s*" + Q + r"[\w.\-]*" + Q + r"\s*(?:=>|->)", re.M)

UNTYPED = {
    "ts": R(r"\w+\??\s*:\s*(?:unknown|any|Record<string,\s*(?:unknown|any)>|object)(?!\w)"),
    "python": R(r"\w+\s*:\s*(?:Any|dict|Dict\[str,\s*Any\]|dict\[str,\s*Any\]|Mapping\[str,\s*Any\]|object)(?!\w)"),
    "java": R(r"\b(?:Object|Map<String,\s*Object>|JsonNode|JSONObject)\s+\w+"),
    "kotlin": R(r"\w+\s*:\s*(?:Any\??|Map<String,\s*Any\??>|JsonElement|JsonObject)(?!\w)"),
    "csharp": R(r"\b(?:object|dynamic|Dictionary<string,\s*object>|JObject|JsonElement|JToken)\s+\w+"),
    "go": R(r"\w+\s+(?:interface\{\}|any|map\[string\](?:interface\{\}|any))"),
    "rust": R(r"\w+\s*:\s*&?(?:serde_json::)?Value\b|&?dyn\s+Any"),
    "php": R(r"(?:array|mixed)\s+\$\w+"),
    "scala": R(r"\w+\s*:\s*(?:Any|Map\[String,\s*Any\])(?!\w)"),
    "swift": R(r"\w+\s*:\s*(?:Any|\[String:\s*Any\])(?!\w)"),
    "cpp": R(r"(?:void\s*\*|std::any)\s*\w+"), "c": R(r"void\s*\*\s*\w+"),
    "ruby": None, "js": None,
}
BOOL_PARAM = {
    "ts": R(r"\w+\??\s*:\s*boolean\b"), "python": R(r"\w+\s*:\s*bool\b|\w+\s*=\s*(?:True|False)\b"),
    "java": R(r"\bboolean\s+\w+"), "kotlin": R(r"\w+\s*:\s*Boolean\b"), "csharp": R(r"\bbool\s+\w+"),
    "go": R(r"\w+\s+bool\b"), "rust": R(r"\w+\s*:\s*bool\b"), "php": R(r"\bbool\s+\$\w+"),
    "scala": R(r"\w+\s*:\s*Boolean\b"), "swift": R(r"\w+\s*:\s*Bool\b"), "cpp": R(r"\bbool\s+\w+"),
    "c": R(r"\bbool\s+\w+"), "ruby": R(r"\w+\s*[:=]\s*(?:true|false)\b"), "js": R(r"\w+\s*=\s*(?:true|false)\b"),
}
CASTS = {
    "ts": R(r"\bas\s+(?!const\b)[\w{\[<]"), "js": None, "python": R(r"\bcast\("),
    "java": R(r"\(\s*[A-Z][\w.<>,\s]*\)\s*\w"), "kotlin": R(r"\bas\??\s+[A-Z]"), "csharp": R(r"\(\s*[A-Z]\w*\s*\)\s*\w|\bas\s+[A-Z]"),
    "go": R(r"\.\(\*?[\w.]+\)"), "rust": R(r"\.as_(?:str|i64|u64|f64|bool|object|array)\(\)"), "php": R(r"\((?:int|string|array|bool|float)\)"),
    "scala": R(r"asInstanceOf\["), "swift": R(r"\bas!\s"), "cpp": R(r"(?:static|reinterpret)_cast<"), "c": R(r"\(\s*\w+\s*\*\s*\)"), "ruby": None,
}
DEFAULTS = R(r"\?\?\s*(?:0|\[\]|\"\"|''|\{\})|\bor\s+(?:0|\[\]|\{\}|\"\"|'')|getOrDefault\(|\.get\(\s*[\"']\w+[\"']\s*,\s*(?:0|\[\]|\{\}|\"\"|''|None)\)|\|\|\s*(?:0|\[\]|\{\}|\"\"|'')|unwrap_or(?:_default)?\(")
HEADER_END = R(r"(?m)(?:\{|:|=>|\bdo|=)\s*$")
# subject of a switch/match/when/case, e.g. switch m["kind"], match event.type, case x[:kind]
SWITCH_SUBJECT = R(r"\b(?:switch|match|when|case)\s*\(?\s*\$?\w+(?:\.(?:get)?(\w+)(?:\(\))?|\[\s*[\"':]?(\w+)[\"']?\s*\])\s*\)?\s*(?:\{|:|$|\bof\b)", re.M)
# words that look like fields but are control flow or noise
FIELD_NOISE = {"return", "if", "else", "case", "when", "typeof", "not", "and", "or", "in", "is", "value", "length"}


def lang_of(path: Path):
    return LANG_BY_EXT.get(path.suffix.lower())


def strip_line_comments(text: str, lang: str) -> str:
    if lang in ("python", "ruby"):
        return re.sub(r"(?m)#[^\n]*", "", text)
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return re.sub(r"(?m)(?<!:)//[^\n]*", "", text)


def max_depth(lines, lang):
    """Nesting depth estimated from indentation relative to the function's first body line."""
    widths = []
    for ln in lines[1:]:
        if ln.strip():
            widths.append(len(ln.expandtabs(4)) - len(ln.expandtabs(4).lstrip()))
    if not widths:
        return 0
    base = min(widths)
    steps = sorted({w - base for w in widths if w > base})
    unit = steps[0] if steps else 4
    unit = unit if unit in (2, 3, 4, 8) else 4
    return (max(widths) - base) // unit + 1


def score_function(fn, src_lines, lang):
    raw = src_lines[fn.start_line - 1: fn.end_line]
    text = strip_line_comments("\n".join(raw), lang)
    opener = HEADER_END.search(text)
    header = text[: opener.end()] if opener and opener.end() < 800 else text[:400]
    signals, total = {}, 0

    ccn = fn.cyclomatic_complexity
    if ccn >= 10:
        signals["complexity"] = ccn
        total += 4 if ccn >= 20 else 2

    tested = []
    for pat in TYPE_TESTS.get(lang, []):
        for m in pat.finditer(text):
            tested.append(m.group(1) if pat.groups else pat.pattern[:12])
    if len(tested) >= 2:
        signals["type_tests"] = len(tested)
        total += 3 + min(len(tested) - 2, 3)

    fields = defaultdict(int)
    for pat in FIELD_CMP_COMMON:
        for m in pat.finditer(text):
            f = m.group(1)
            if f.lower() not in FIELD_NOISE:
                fields[f] += 1
    labels = len(CASE_LABEL.findall(text))
    subject_found = False
    if labels >= 2:
        for m in SWITCH_SUBJECT.finditer(text):
            f = m.group(1) or m.group(2)
            if f and f.lower() not in FIELD_NOISE:
                fields[f] += labels
                subject_found = True
    repeated = {f: n for f, n in fields.items() if n >= 2}
    if labels >= 3 and not subject_found:
        repeated["<literal labels>"] = labels
    if repeated:
        signals["literal_compares"] = repeated
        total += 3 * min(len(repeated), 2)

    untyped = UNTYPED.get(lang)
    if untyped and untyped.search(header):
        signals["untyped_input"] = True
        total += 3
    flag = BOOL_PARAM.get(lang)
    if flag and flag.search(header):
        signals["flag_param"] = True
        total += 2

    cast = CASTS.get(lang)
    if cast:
        n = len(cast.findall(text))
        if n:
            signals["casts"] = n
            total += min(n, 3)
    n = len(DEFAULTS.findall(text))
    if n:
        signals["implicit_defaults"] = n
        total += min(n, 2)

    depth = max_depth(raw, lang)
    if depth >= 4:
        signals["nesting"] = depth
        total += 2
    if fn.nloc >= 60:
        signals["long"] = fn.nloc
        total += 1

    type_names = sorted({t for t in tested if re.fullmatch(r"[\w.:\\]+", t)})
    return total, signals, type_names, sorted(f for f in repeated if not f.startswith("<"))


def iter_files(root: Path, langs):
    paths = [root] if root.is_file() else root.rglob("*")
    for p in paths:
        if not p.is_file() or any(part in SKIP_DIRS for part in p.parts):
            continue
        if p.name.endswith((".d.ts", ".min.js", "_pb2.py", ".pb.go", ".g.cs", ".generated.ts")):
            continue
        lang = lang_of(p)
        if lang and (not langs or lang in langs):
            yield p, lang


def group(findings, key, min_overlap):
    items = [f for f in findings if len(f[key]) >= (min_overlap if key == "types" else 1)]
    parent = list(range(len(items)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            if items[i]["lang"] == items[j]["lang"] and len(set(items[i][key]) & set(items[j][key])) >= min_overlap:
                parent[find(i)] = find(j)
    groups = defaultdict(list)
    for i, f in enumerate(items):
        groups[find(i)].append(f)
    fams = []
    for fs in groups.values():
        if len(fs) >= 2 or (key == "types" and fs and len(fs[0]["types"]) >= 3):
            shared = set(fs[0][key]).intersection(*[set(f[key]) for f in fs[1:]]) if len(fs) > 1 else set(fs[0][key])
            fams.append((sorted(shared or {x for f in fs for x in f[key]}), fs))
    return sorted(fams, key=lambda kv: -len(kv[1]))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("root")
    ap.add_argument("--min-score", type=int, default=6)
    ap.add_argument("--lang", help="comma-separated: ts,js,python,java,kotlin,scala,csharp,go,rust,php,ruby,swift,c,cpp")
    ap.add_argument("--top", type=int, default=50, help="max functions to print")
    ap.add_argument("--json", help="write full results to this path")
    args = ap.parse_args()

    root = Path(args.root)
    if not root.exists():
        sys.exit(f"not found: {root}")
    langs = set(args.lang.split(",")) if args.lang else None

    findings, scanned = [], 0
    for path, lang in iter_files(root, langs):
        try:
            source = path.read_text(encoding="utf-8", errors="replace")
            analysis = lizard.analyze_file.analyze_source_code(str(path), source)
        except Exception as exc:  # noqa: BLE001 - keep scanning other files
            print(f"skip {path}: {exc}", file=sys.stderr)
            continue
        scanned += 1
        lines = source.splitlines()
        for fn in analysis.function_list:
            total, signals, types, fields = score_function(fn, lines, lang)
            if total >= args.min_score:
                findings.append({
                    "file": str(path), "line": fn.start_line, "function": fn.name, "lang": lang,
                    "score": total, "nloc": fn.nloc, "signals": signals, "types": types, "fields": fields,
                })
    findings.sort(key=lambda f: -f["score"])

    print(f"# {len(findings)} loaded function candidates in {scanned} files (min score {args.min_score})\n")
    for f in findings[: args.top]:
        sig = ", ".join(k if v is True else f"{k}={v}" for k, v in f["signals"].items())
        print(f"{f['score']:>3}  {f['file']}:{f['line']}  {f['function']}  [{f['lang']}, {f['nloc']} loc]")
        print(f"     {sig}")
    if len(findings) > args.top:
        print(f"... {len(findings) - args.top} more (use --top or --json)")

    by_types = group(findings, "types", 2)
    by_fields = group(findings, "fields", 1)
    print("\n# Candidate families by types/schemas tested")
    for shared, fs in by_types:
        print(f"- {{{', '.join(shared)}}}: " + ", ".join(f"{x['function']} ({Path(x['file']).name}:{x['line']})" for x in fs))
    print("\n# Candidate families by field compared to literals")
    for shared, fs in by_fields:
        print(f"- {', '.join(shared)}: " + ", ".join(f"{x['function']} ({Path(x['file']).name}:{x['line']})" for x in fs))

    if args.json:
        Path(args.json).write_text(json.dumps({
            "findings": findings,
            "families_by_types": [{"shared": s, "members": [f"{x['file']}:{x['line']}" for x in fs]} for s, fs in by_types],
            "families_by_fields": [{"shared": s, "members": [f"{x['file']}:{x['line']}" for x in fs]} for s, fs in by_fields],
        }, indent=2))
        print(f"\nwrote {args.json}")


if __name__ == "__main__":
    main()
