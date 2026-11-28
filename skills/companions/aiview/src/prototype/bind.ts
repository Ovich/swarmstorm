// Prototype binding: a host prototype places `<div data-bind="file#Name"></div>` and the viewer
// replaces it with the first `[data-component="Name"]` element of `file`, a sibling prototype.
// Pure: sources come through the reader it is given, and the result is a string. Nothing
// here touches the file system or the index, so it is testable on in-memory fixtures.
import {
  parse,
  parseFragment,
  serialize,
  serializeOuter,
  defaultTreeAdapter as ta,
  html as spec,
} from "parse5";
import type { DefaultTreeAdapterTypes as T } from "parse5";

type El = T.Element;
type Parent = T.ParentNode;

export interface BindingIssue {
  /** The `file#Name` reference the issue is about. */
  ref: string;
  message: string;
}

export interface BindResult {
  html: string;
  /** How many placeholders were replaced by a component. */
  bound: number;
  /** Every source file the host refers to, found or not, so a source created later still refreshes the host. */
  sources: string[];
  errors: BindingIssue[];
  warnings: BindingIssue[];
}

/** Returns the source file's text, or undefined when it does not exist or is not allowed. */
export type SourceReader = (file: string) => string | undefined;

const BIND = "data-bind";
const COMPONENT = "data-component";
const BOUND = "data-bound";
const BOUND_ERROR = "data-bound-error";
const BOUND_STYLE = "data-bound-style";

const attr = (el: El, name: string): string | undefined =>
  el.attrs.find((a) => a.name === name)?.value;

function setAttr(el: El, name: string, value: string): void {
  const a = el.attrs.find((x) => x.name === name);
  if (a) a.value = value;
  else el.attrs.push({ name, value });
}

function* elements(node: Parent): Generator<El> {
  for (const c of ta.getChildNodes(node)) {
    if (!ta.isElementNode(c)) continue;
    yield c;
    yield* elements(c);
  }
}

/** A `file#Name` reference, or undefined when malformed. The file must be a bare name. */
export function parseRef(ref: string): { file: string; name: string } | undefined {
  const m = /^([^#]+)#([^#]+)$/.exec(ref.trim());
  if (!m) return undefined;
  const [, file, name] = m;
  if (/[\\/]/.test(file) || file.includes("..") || !name.trim()) return undefined;
  return { file, name: name.trim() };
}

interface Source {
  styles: El[];
  components: Map<string, { el: El; count: number }>;
}

function loadSource(text: string): Source {
  const doc = parse(text);
  const styles: El[] = [];
  const components = new Map<string, { el: El; count: number }>();
  for (const el of elements(doc)) {
    if (ta.getTagName(el) === "style") styles.push(el);
    const name = attr(el, COMPONENT);
    if (name === undefined) continue;
    const hit = components.get(name);
    if (hit) hit.count += 1;
    else components.set(name, { el, count: 1 });
  }
  return { styles, components };
}

/** A fresh element from an existing one, so one component can be placed more than once. */
function copyOf(el: El): El {
  const frag = parseFragment(serializeOuter(el));
  const copy = ta.getChildNodes(frag).find((n) => ta.isElementNode(n));
  if (!copy) throw new Error("copy of an element produced no element");
  return copy;
}

function errorBox(ref: string, message: string): El {
  const box = ta.createElement("div", spec.NS.HTML, [{ name: BOUND_ERROR, value: ref }]);
  ta.insertText(box, message);
  return box;
}

function replace(placeholder: El, by: El): void {
  const parent = ta.getParentNode(placeholder);
  if (!parent) return;
  ta.insertBefore(parent, by, placeholder);
  ta.detachNode(placeholder);
}

/** Placeholder `class` is appended to the component's, `style` after its own, and the ref is recorded. */
function mergeAttributes(placeholder: El, into: El, ref: string): void {
  const cls = attr(placeholder, "class");
  if (cls) setAttr(into, "class", [attr(into, "class"), cls].filter(Boolean).join(" "));
  const style = attr(placeholder, "style");
  if (style) {
    const own = attr(into, "style")?.trim();
    setAttr(into, "style", own ? `${own.replace(/;?\s*$/, "")}; ${style}` : style);
  }
  setAttr(into, BOUND, ref);
}

function warnOnComponent(el: El, ref: string, warnings: BindingIssue[]): void {
  for (const a of el.attrs) {
    if (a.name === "id") warnings.push({ ref, message: `component carries id="${a.value}"` });
    else if (a.name.startsWith("on"))
      warnings.push({ ref, message: `component carries inline handler ${a.name}` });
  }
}

/** Bindings inside a placed component are not resolved: they stay visible and are reported. */
function refuseNested(placed: El, errors: BindingIssue[]): void {
  for (const el of elements(placed)) {
    const ref = attr(el, BIND);
    if (ref === undefined) continue;
    const message = "nested binding not supported";
    errors.push({ ref, message });
    setAttr(el, BOUND_ERROR, ref);
    ta.insertText(el, `${message}: ${ref}`);
  }
}

function childElement(parent: Parent, tag: string): El | undefined {
  for (const c of ta.getChildNodes(parent)) if (ta.isElementNode(c) && ta.getTagName(c) === tag) return c;
  return undefined;
}

function injectStyles(doc: T.Document, used: Map<string, Source>): void {
  const html = childElement(doc, "html");
  const head = html && childElement(html, "head");
  if (!head) return;
  const cursor = ta.getFirstChild(head);
  for (const [file, source] of used) {
    for (const style of source.styles) {
      const copy = copyOf(style);
      setAttr(copy, BOUND_STYLE, file);
      if (cursor) ta.insertBefore(head, copy, cursor);
      else ta.appendChild(head, copy);
    }
  }
}

export function resolveBindings(html: string, readSource: SourceReader): BindResult {
  const none: BindResult = { html, bound: 0, sources: [], errors: [], warnings: [] };
  // A prototype without bindings is returned as written: no parse, no serialisation drift.
  if (!html.includes(BIND)) return none;

  const doc = parse(html);
  const placeholders = [...elements(doc)].filter((el) => attr(el, BIND) !== undefined);
  if (placeholders.length === 0) return none;

  const errors: BindingIssue[] = [];
  const warnings: BindingIssue[] = [];
  const sources: string[] = [];
  const loaded = new Map<string, Source | undefined>();
  const used = new Map<string, Source>();
  let bound = 0;

  for (const ph of placeholders) {
    const ref = attr(ph, BIND) ?? "";
    const parsed = parseRef(ref);
    if (!parsed) {
      errors.push({ ref, message: "invalid binding, expected file#Name" });
      replace(ph, errorBox(ref, `Invalid binding: ${ref}`));
      continue;
    }
    const { file, name } = parsed;
    if (!sources.includes(file)) sources.push(file);
    if (!loaded.has(file)) {
      const text = readSource(file);
      loaded.set(file, text === undefined ? undefined : loadSource(text));
    }
    const source = loaded.get(file);
    if (!source) {
      errors.push({ ref, message: `Not found: ${file}` });
      replace(ph, errorBox(ref, `Not found: ${ref}`));
      continue;
    }
    const hit = source.components.get(name);
    if (!hit) {
      errors.push({ ref, message: `Component ${name} not in ${file}` });
      replace(ph, errorBox(ref, `Component ${name} not in ${file}`));
      continue;
    }
    if (hit.count > 1) warnings.push({ ref, message: `${hit.count} candidates, first used` });
    warnOnComponent(hit.el, ref, warnings);
    if (!used.has(file)) used.set(file, source);
    const placed = copyOf(hit.el);
    mergeAttributes(ph, placed, ref);
    refuseNested(placed, errors);
    replace(ph, placed);
    bound += 1;
  }

  injectStyles(doc, used);
  return { html: serialize(doc), bound, sources, errors, warnings };
}

export interface OfferedComponent {
  name: string;
  tag: string;
  /** The nearest enclosing component, when this one sits inside another. */
  within?: string;
  /** Rule violations that would make the component misbehave once bound: ids, inline handlers, duplicates. */
  warnings: string[];
}

export interface PulledRef {
  ref: string;
  file: string;
  name: string;
}

export interface ComponentsReport {
  /** Every data-component declared in the file, in document order. */
  offers: OfferedComponent[];
  /** Every data-bind placeholder in the file. */
  pulls: PulledRef[];
}

function enclosingComponent(el: El): string | undefined {
  for (let p = ta.getParentNode(el); p; p = ta.getParentNode(p as El)) {
    if (!ta.isElementNode(p)) return undefined;
    const name = attr(p, COMPONENT);
    if (name !== undefined) return name;
  }
  return undefined;
}

/** What a prototype offers to its siblings and what it pulls from them, read from the file alone. */
export function listComponents(html: string): ComponentsReport {
  const doc = parse(html);
  const offers: OfferedComponent[] = [];
  const pulls: PulledRef[] = [];
  const seen = new Map<string, number>();
  for (const el of elements(doc)) {
    const bind = attr(el, BIND);
    if (bind !== undefined) {
      const p = parseRef(bind);
      pulls.push({ ref: bind, file: p?.file ?? "", name: p?.name ?? "" });
      continue;
    }
    const name = attr(el, COMPONENT);
    if (name === undefined) continue;
    const warnings: string[] = [];
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    if (n > 1) warnings.push(`declared ${n} times, the first is used`);
    for (const x of [el, ...elements(el)]) {
      const where = x === el ? "root" : `<${ta.getTagName(x)}>`;
      for (const a of x.attrs) {
        if (a.name === "id") warnings.push(`${where} carries id="${a.value}"`);
        else if (a.name.startsWith("on")) warnings.push(`${where} carries inline handler ${a.name}`);
      }
    }
    const within = enclosingComponent(el);
    offers.push(within ? { name, tag: ta.getTagName(el), within, warnings } : { name, tag: ta.getTagName(el), warnings });
  }
  return { offers, pulls };
}
