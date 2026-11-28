// Pointing: the agent shows the person which components of a prototype a question is about.
// The pointer is the viewer's URL and nothing else: `#doc=12&show=Strip,Menu&variant=step-2`.
// `aiview show` validates it, prints it and asks the server to move every open tab to it,
// so the same link works an hour later from the chat, with no tab listening when it was
// made. Pure text, no node and no DOM: the CLI, the server and the app all read it.

export interface Pointer {
  /** The document. */
  readonly id: number;
  /** The `data-component` names to highlight, in the order given. Empty: the document alone. */
  readonly components: readonly string[];
  /** The variant to switch the prototype to first, when the components live in one. */
  readonly variant?: string;
}

/** Names travel in a URL and into a selector, so they are held to what a component name is. */
const NAME = /^[\w.-]+$/;
export const isName = (s: string): boolean => NAME.test(s);

/** The hash for a pointer, without the leading `#`. */
export function pointerHash(p: Pointer): string {
  const parts = [`doc=${p.id}`];
  if (p.components.length) parts.push(`show=${p.components.join(",")}`);
  if (p.variant) parts.push(`variant=${p.variant}`);
  return parts.join("&");
}

/** The pointer a hash holds, or null when it names no document. Unknown keys and
 *  malformed names are dropped, never an error: a hash is typed and pasted by people. */
export function readPointer(hash: string): Pointer | null {
  const fields = new Map<string, string>();
  for (const part of hash.replace(/^#/, "").split("&")) {
    const i = part.indexOf("=");
    if (i > 0) fields.set(part.slice(0, i), decodeURIComponent(part.slice(i + 1)));
  }
  const id = Number(fields.get("doc"));
  if (!Number.isInteger(id) || id <= 0) return null;
  const components = (fields.get("show") ?? "").split(",").filter(isName);
  const variant = fields.get("variant");
  return variant && isName(variant) ? { id, components, variant } : { id, components };
}

/** What `aiview show` was asked for that the prototype does not have, as the sentence the
 *  agent reads. An agent that names a region in its own words is stopped here, before
 *  the person is asked about something they cannot find on the page. */
export function unknownNames(asked: readonly string[], known: readonly string[], what: string): string | undefined {
  const missing = asked.filter((n) => !known.includes(n));
  if (!missing.length) return undefined;
  const has = known.length ? `it has: ${known.join(", ")}` : `it declares none`;
  return `no ${what} named ${missing.join(", ")} in this prototype; ${has}`;
}
