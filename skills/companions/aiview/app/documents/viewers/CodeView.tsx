import { useEffect, useState } from "react";
import type { HighlighterCore } from "shiki/core";

/**
 * Lazy shiki, on the mermaid pattern: the grammars load only when a document
 * actually contains a fenced block in a language we highlight.
 *
 * Two themes are baked into one render (`defaultColor: false`), so each token
 * carries `--shiki-light` and `--shiki-dark` and the CSS in styles.css picks by
 * `prefers-color-scheme`. Switching the OS theme needs no re-render, which is
 * what makes this safe to cache across documents.
 */
/** Shiki from the CDN, its version pinned to package.json's, loaded only when a document holds a fence
 *  we highlight. Not bundled: its grammars' text reads to the plugin directory's scan as shell commands. */
export const SHIKI_URL = "https://cdn.jsdelivr.net/npm/shiki@4.4.3/dist/";
// the tests use the package; a build drops that branch, so dist carries no shiki
const TEST = import.meta.env.MODE === "test";
const cdn = (file: string) => import(/* @vite-ignore */ `${SHIKI_URL}${file}/+esm`);
const GRAMMARS = { ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", json: "json", jsonc: "jsonc", sh: "shellscript", sql: "sql", html: "html", css: "css", yaml: "yaml", md: "markdown", python: "python", diff: "diff" } as const;

/** Each fence language's grammar loader: the package's in the tests, the CDN's in a build (the branch dropped). */
const LANGS: Record<keyof typeof GRAMMARS, () => Promise<any>> = TEST
  ? {
      ts: () => import("shiki/langs/typescript.mjs"),
      tsx: () => import("shiki/langs/tsx.mjs"),
      js: () => import("shiki/langs/javascript.mjs"),
      jsx: () => import("shiki/langs/jsx.mjs"),
      json: () => import("shiki/langs/json.mjs"),
      jsonc: () => import("shiki/langs/jsonc.mjs"),
      sh: () => import("shiki/langs/shellscript.mjs"),
      sql: () => import("shiki/langs/sql.mjs"),
      html: () => import("shiki/langs/html.mjs"),
      css: () => import("shiki/langs/css.mjs"),
      yaml: () => import("shiki/langs/yaml.mjs"),
      md: () => import("shiki/langs/markdown.mjs"),
      python: () => import("shiki/langs/python.mjs"),
      diff: () => import("shiki/langs/diff.mjs"),
    }
  : (Object.fromEntries(Object.entries(GRAMMARS).map(([k, name]) => [k, () => cdn(`langs/${name}.mjs`)])) as Record<keyof typeof GRAMMARS, () => Promise<any>>);

/** What a fence may be called, mapped to the grammar that renders it. */
const ALIASES: Record<string, keyof typeof LANGS> = {
  ts: "ts", typescript: "ts", tsx: "tsx",
  js: "js", javascript: "js", mjs: "js", jsx: "jsx",
  json: "json", jsonc: "jsonc",
  sh: "sh", bash: "sh", shell: "sh", zsh: "sh", console: "sh",
  sql: "sql", html: "html", css: "css",
  yaml: "yaml", yml: "yaml", md: "md", markdown: "md",
  py: "python", python: "python", diff: "diff",
};

let highlighterPromise: Promise<HighlighterCore> | null = null;

const loadHighlighter = () =>
  (highlighterPromise ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, light, dark] = await Promise.all([
      TEST ? import("shiki/core") : cdn("core.mjs"),
      TEST ? import("shiki/engine/javascript") : cdn("engine-javascript.mjs"),
      TEST ? import("shiki/themes/github-light.mjs") : cdn("themes/github-light.mjs"),
      TEST ? import("shiki/themes/github-dark.mjs") : cdn("themes/github-dark.mjs"),
    ]);
    return createHighlighterCore({
      themes: [light.default, dark.default],
      langs: await Promise.all(Object.values(LANGS).map((load) => load())),
      engine: createJavaScriptRegexEngine(),
    });
  })());

export function CodeView({ source, lang }: { source: string; lang: string }) {
  const grammar = ALIASES[lang.toLowerCase()];
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    if (!grammar) return;
    let cancelled = false;
    setHtml(null);
    loadHighlighter()
      .then((hl) => {
        const out = hl.codeToHtml(source, {
          lang: grammar,
          themes: { light: "github-light", dark: "github-dark" },
          defaultColor: false,
        });
        if (!cancelled) setHtml(out);
      })
      // A missing grammar or a broken theme must never cost the reader the code
      // itself: the plain block below stays on screen.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [source, grammar]);

  // Plain first, highlighted when it arrives — the code is readable throughout.
  if (!html)
    return (
      <pre data-component="CodeView">
        <code>{source}</code>
      </pre>
    );
  return <div className="shiki-box" data-component="CodeView" dangerouslySetInnerHTML={{ __html: html }} />;
}
