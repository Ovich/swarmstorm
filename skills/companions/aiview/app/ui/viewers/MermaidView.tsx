import { useEffect, useId, useState } from "react";

/** Mermaid from the CDN, its version pinned to package.json's, loaded only when a doc contains a diagram.
 *  Not bundled: its 3.5 MB of minified chunks made the plugin directory's validation time out. */
export const MERMAID_URL = "https://cdn.jsdelivr.net/npm/mermaid@11.17.0/dist/mermaid.esm.min.mjs";
let mermaidPromise: Promise<typeof import("mermaid")> | null = null;
// the tests mock the package; a build drops that branch, so dist carries no mermaid
const loadMermaid = () => (mermaidPromise ??= import.meta.env.MODE === "test" ? import("mermaid") : import(/* @vite-ignore */ MERMAID_URL));

/** A tracker's nodes are read down a column, line by line: the title, then its fields.
 *  Carried by the diagram's own init directive, so mermaid measures the labels as they
 *  will be drawn, and never through `initialize`: that is global, and the next diagram
 *  on the page would overwrite it mid-render. */
const TRACKER = /^\s*%%\s*(aiview:)?tracker\b/im;
const TRACKER_CSS =
  ".node foreignObject div, .node .nodeLabel, .node .nodeLabel p { text-align: left !important; } " +
  ".node .nodeLabel p::first-line { font-weight: 600; }";
/** Wide enough that a step's 80-character line stays one row (mermaid wraps at 200). */
const TRACKER_WIDTH = 560;
const TRACKER_INIT = `%%{init: ${JSON.stringify({ themeCSS: TRACKER_CSS, flowchart: { wrappingWidth: TRACKER_WIDTH } })}}%%\n`;
/** `done when:`, `seen:`, `branch:`: a field's name opening a line steps back from its value. */
const dimFields = (svg: string) =>
  svg.replace(/(<br\s*\/?>)\s*([a-z][a-z ]{1,14}:)/g, '$1<span style="opacity:.55">$2</span>');

export function MermaidView({ source }: { source: string }) {
  const id = useId().replaceAll(":", "_");
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setError(null);
    loadMermaid()
      .then(async ({ default: mermaid }) => {
        const dark = matchMedia("(prefers-color-scheme: dark)").matches;
        const tracker = TRACKER.test(source);
        mermaid.initialize({ startOnLoad: false, theme: dark ? "dark" : "neutral", securityLevel: "antiscript" });
        const { svg } = await mermaid.render(`mmd_${id}`, tracker ? TRACKER_INIT + source : source);
        if (!cancelled) setSvg(tracker ? dimFields(svg) : svg);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [source, id]);

  // Never a blank region: source + error until (or instead of) the render.
  if (error)
    return (
      <div className="mermaid-box" data-component="MermaidView">
        <div className="min-w-0">
          <div className="mb-2 text-[11px] text-muted-foreground">mermaid failed: {error}</div>
          <pre>
            <code>{source}</code>
          </pre>
        </div>
      </div>
    );
  if (!svg)
    return (
      <div className="mermaid-box text-[11px] text-muted-foreground" data-component="MermaidView">
        rendering diagram…
      </div>
    );
  return <div className="mermaid-box" data-component="MermaidView" dangerouslySetInnerHTML={{ __html: svg }} />;
}
