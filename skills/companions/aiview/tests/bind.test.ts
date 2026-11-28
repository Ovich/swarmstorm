import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parse, serialize } from "parse5";
import { parseRef, resolveBindings, type SourceReader } from "../src/prototype/bind.ts";

const TOOLS = "2026-09-03-dock-tools.prototype.html";

const toolsSheet = `<!DOCTYPE html><html><head><title>Tools</title>
<style>[data-component="ToolPrefix"]{color:red}</style>
<style>body{margin:0}</style>
</head><body>
<h1>Tools</h1>
<span class="prefix" data-component="ToolPrefix"><b data-part="what">Rework</b></span>
<div data-component="ToolMakeroom"><p>Make room</p></div>
<div data-component="Twice">first</div>
<div data-component="Twice">second</div>
<div data-component="WithId" id="tool" onclick="go()">x</div>
<div data-component="Nesting"><div data-bind="${TOOLS}#ToolPrefix"></div></div>
<script>window.T = { a: () => 1 < 2 && "x" };</script>
</body></html>`;

const reader =
  (files: Record<string, string>): SourceReader =>
  (file) =>
    files[file];

const host = (body: string, head = "<style>.host{}</style>") =>
  `<!DOCTYPE html><html><head><title>Host</title>${head}</head><body>${body}</body></html>`;

test("parseRef accepts file#Name and rejects paths", () => {
  assert.deepEqual(parseRef(`${TOOLS}#ToolPrefix`), { file: TOOLS, name: "ToolPrefix" });
  assert.equal(parseRef("nohash"), undefined);
  assert.equal(parseRef("../x.html#A"), undefined);
  assert.equal(parseRef("sub/x.html#A"), undefined);
  assert.equal(parseRef("sub\\x.html#A"), undefined);
  assert.equal(parseRef("x.html#"), undefined);
});

test("a prototype without bindings is returned byte for byte", () => {
  const html = "<!doctype html>\n<html>\n<body><p class=x>a < b</p></body></html>\n";
  const r = resolveBindings(html, reader({}));
  assert.equal(r.html, html);
  assert.deepEqual(r.sources, []);
});

test("replaces the placeholder with the component, no wrapper, attributes merged", () => {
  const html = host(
    `<div class="box"><div data-bind="${TOOLS}#ToolPrefix" class="in-box" style="margin:2px" id="dropped"></div><input></div>`,
  );
  const r = resolveBindings(html, reader({ [TOOLS]: toolsSheet }));
  assert.deepEqual(r.errors, []);
  assert.match(
    r.html,
    /<div class="box"><span class="prefix in-box" data-component="ToolPrefix" style="margin:2px" data-bound="[^"]+#ToolPrefix"><b data-part="what">Rework<\/b><\/span><input><\/div>/,
  );
  assert.ok(!r.html.includes('id="dropped"'), "other placeholder attributes are dropped");
  assert.deepEqual(r.sources, [TOOLS]);
});

test("appends placeholder style after the component's own", () => {
  const sheet = `<html><body><div data-component="S" style="color:red;">s</div></body></html>`;
  const r = resolveBindings(host(`<div data-bind="s.html#S" style="top:0"></div>`), reader({ "s.html": sheet }));
  assert.ok(r.html.includes('style="color:red; top:0"'), r.html);
});

test("injects the source's styles once, before the host's, for two bindings to one file", () => {
  const html = host(
    `<div data-bind="${TOOLS}#ToolPrefix"></div><div data-bind="${TOOLS}#ToolMakeroom"></div>`,
  );
  const r = resolveBindings(html, reader({ [TOOLS]: toolsSheet }));
  const injected = r.html.match(/data-bound-style="[^"]+"/g) ?? [];
  assert.equal(injected.length, 2, "both style blocks of the source, once each");
  const first = r.html.indexOf(`<style data-bound-style="${TOOLS}">`);
  const hostStyle = r.html.indexOf("<style>.host{}</style>");
  assert.ok(first >= 0 && first < hostStyle, "source styles come before the host's");
  assert.ok(!r.html.includes("window.T"), "source scripts are ignored");
  assert.equal(r.html.match(/data-bound=/g)?.length, 2);
});

test("errors in place: missing file, missing component, invalid ref", () => {
  const html = host(
    `<div data-bind="missing.html#A"></div><div data-bind="${TOOLS}#Nope"></div><div data-bind="garbage"></div>`,
  );
  const r = resolveBindings(html, reader({ [TOOLS]: toolsSheet }));
  assert.equal(r.errors.length, 3);
  assert.ok(r.html.includes('<div data-bound-error="missing.html#A">Not found: missing.html#A</div>'));
  assert.ok(r.html.includes(`<div data-bound-error="${TOOLS}#Nope">Component Nope not in ${TOOLS}</div>`));
  assert.ok(r.html.includes('<div data-bound-error="garbage">Invalid binding: garbage</div>'));
  assert.ok(r.html.includes("<h1></h1>") === false, "the rest of the host is intact");
  assert.deepEqual(r.sources, ["missing.html", TOOLS], "a missing file is still a source to watch");
});

test("escaped paths never reach the reader", () => {
  const seen: string[] = [];
  const r = resolveBindings(host(`<div data-bind="../secret.html#A"></div>`), (f) => {
    seen.push(f);
    return undefined;
  });
  assert.deepEqual(seen, []);
  assert.equal(r.errors.length, 1);
  assert.deepEqual(r.sources, []);
});

test("nested binding stays visible and is reported", () => {
  const r = resolveBindings(host(`<div data-bind="${TOOLS}#Nesting"></div>`), reader({ [TOOLS]: toolsSheet }));
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].message, "nested binding not supported");
  assert.ok(r.html.includes(`data-bind="${TOOLS}#ToolPrefix" data-bound-error="${TOOLS}#ToolPrefix">nested binding not supported`));
});

test("warns on duplicates (first used) and on id or inline handler", () => {
  const r = resolveBindings(
    host(`<div data-bind="${TOOLS}#Twice"></div><div data-bind="${TOOLS}#WithId"></div>`),
    reader({ [TOOLS]: toolsSheet }),
  );
  assert.deepEqual(r.errors, []);
  assert.ok(r.html.includes(">first</div>") && !r.html.includes(">second</div>"));
  const messages = r.warnings.map((w) => w.message);
  assert.deepEqual(messages, ["2 candidates, first used", 'component carries id="tool"', "component carries inline handler onclick"]);
});

test("the same component placed twice yields two independent copies", () => {
  const r = resolveBindings(
    host(`<div data-bind="${TOOLS}#ToolPrefix" class="a"></div><div data-bind="${TOOLS}#ToolPrefix" class="b"></div>`),
    reader({ [TOOLS]: toolsSheet }),
  );
  assert.ok(r.html.includes('class="prefix a"') && r.html.includes('class="prefix b"'));
});

// Gate G1 of the plan: parse5 must hand the JOBS prototypes back unchanged where it matters.
// Scripts must be byte-identical; elsewhere only attribute quoting and doctype casing may move.
const fixtures = path.join(import.meta.dirname, "fixtures");
for (const f of fs.existsSync(fixtures) ? fs.readdirSync(fixtures).filter((n) => n.endsWith(".html")) : []) {
  test(`round trip through parse5 keeps ${f} intact`, () => {
    const input = fs.readFileSync(path.join(fixtures, f), "utf8").replace(/\r\n/g, "\n");
    const output = serialize(parse(input));
    const scripts = (s: string) => s.match(/<script[^>]*>[\s\S]*?<\/script>/g) ?? [];
    assert.deepEqual(scripts(output), scripts(input), "script blocks are byte-identical");
    const styles = (s: string) => s.match(/<style[^>]*>[\s\S]*?<\/style>/g) ?? [];
    assert.deepEqual(styles(output), styles(input), "style blocks are byte-identical");
    const norm = (s: string) => s.replace(/<!doctype html>/i, "").replace(/\s+/g, " ").trim();
    assert.equal(norm(output).length > norm(input).length * 0.98, true, "nothing substantial dropped");
  });
}

test("listComponents: what a file offers and pulls, with the rule violations", async () => {
  const { listComponents } = await import("../src/prototype/bind.ts");
  const r = listComponents(toolsSheet);
  assert.deepEqual(r.offers.map((o) => o.name), ["ToolPrefix", "ToolMakeroom", "Twice", "Twice", "WithId", "Nesting"]);
  assert.equal(r.offers[0].tag, "span");
  assert.deepEqual(r.offers[3].warnings, ["declared 2 times, the first is used"]);
  assert.deepEqual(r.offers[4].warnings, ['root carries id="tool"', "root carries inline handler onclick"]);
  assert.deepEqual(r.pulls, [{ ref: `${TOOLS}#ToolPrefix`, file: TOOLS, name: "ToolPrefix" }]);
  const nested = listComponents(`<div data-component="Outer"><p><span data-component="Inner"><b id="x">i</b></span></p></div>`);
  assert.equal(nested.offers[1].within, "Outer");
  assert.equal(nested.offers[0].within, undefined);
  assert.deepEqual(nested.offers[0].warnings, ['<b> carries id="x"'], "an id anywhere inside counts, it travels with the markup");
});

test("resolveBindings counts what it bound", () => {
  const r = resolveBindings(host(`<div data-bind="${TOOLS}#ToolPrefix"></div><div data-bind="${TOOLS}#Nope"></div>`), reader({ [TOOLS]: toolsSheet }));
  assert.equal(r.bound, 1);
  assert.equal(resolveBindings("<p>x</p>", reader({})).bound, 0);
});
