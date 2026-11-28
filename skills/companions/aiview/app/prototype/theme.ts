// Forcing a prototype's colour scheme from the viewer.
//
// The frame is sandboxed with an opaque origin, so the viewer cannot reach into its
// document and flip a class. It cannot change `prefers-color-scheme` either: that follows
// the reader's own machine, and no API overrides it for an embedded document.
//
// So the served html is rewritten instead, and the rewrite is on the MEDIA CONDITION
// rather than on the rules inside it: `(prefers-color-scheme: dark)` becomes a condition
// that is always true, or one that is never true. This works on every prototype ever written,
// including the ones that predate any convention, because a prototype that supports a dark
// theme at all expresses it that way. `(prefers-color-scheme: light)` is inverted with it,
// for the files that write both.
//
// `data-theme` is set on the root as well, for prototypes that also offer their own switch
// (`:root[data-theme="dark"]`). Setting both means the viewer's choice wins whichever
// convention the file follows, and the two never disagree.

export const THEME_MARK = "data-aiview-theme";

export type Theme = "system" | "light" | "dark";
export const THEMES: Theme[] = ["system", "light", "dark"];

/** A media condition that always matches, and one that never does. */
const ALWAYS = "(min-width: 0px)";
const NEVER = "(max-width: 0px)";

const DARK = /\(\s*prefers-color-scheme\s*:\s*dark\s*\)/gi;
const LIGHT = /\(\s*prefers-color-scheme\s*:\s*light\s*\)/gi;

/**
 * The served html with the reader's chosen scheme forced. `system` returns the html
 * untouched, so a prototype behaves exactly as it does on disk unless a choice was made.
 */
export function withTheme(html: string, theme: Theme): string {
  if (theme === "system") return html;
  const dark = theme === "dark";
  const forced = html.replace(DARK, dark ? ALWAYS : NEVER).replace(LIGHT, dark ? NEVER : ALWAYS);
  const snippet = `<script ${THEME_MARK}>document.documentElement.setAttribute("data-theme",${JSON.stringify(theme)})</script>`;
  const i = forced.lastIndexOf("</body>");
  return i < 0 ? forced + snippet : forced.slice(0, i) + snippet + forced.slice(i);
}
