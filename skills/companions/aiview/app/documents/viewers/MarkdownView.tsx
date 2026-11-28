import type { ComponentProps, ReactElement } from "react";
import Markdown, { type Components, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import { assetUrl } from "../../lib/api.ts";
import { CodeView } from "./CodeView.tsx";
import { MermaidView } from "./MermaidView.tsx";

const isRelative = (src: string) => !/^([a-z][a-z0-9+.-]*:|\/)/i.test(src);

type FencedCode = ReactElement<{ className?: string; children?: unknown }> | undefined;

const mermaidSource = (children: unknown): string | null => {
  const el = children as FencedCode;
  if (el?.props?.className?.includes("language-mermaid")) return String(el.props.children ?? "");
  return null;
};

/** The `language-x` a fence carries, plus its text — null for an unfenced <pre>. */
const fenced = (children: unknown): { lang: string; source: string } | null => {
  const el = children as FencedCode;
  const lang = /language-([\w-]+)/.exec(el?.props?.className ?? "")?.[1];
  return lang ? { lang, source: String(el?.props?.children ?? "") } : null;
};

/** A fenced block as aiview shows it: ```mermaid a diagram, other fences highlighted code, without the surrounding <pre>. */
function FencedBlock({ node: _node, ...props }: ComponentProps<"pre"> & { node?: unknown }) {
  const src = mermaidSource(props.children);
  if (src !== null) return <MermaidView source={src} />;
  const code = fenced(props.children);
  if (code) return <CodeView source={code.source} lang={code.lang} />;
  return <pre {...props} />;
}

/** aiview's markdown rendering, shared by documents and board posts: GitHub-flavoured, fences through
 *  `FencedBlock`. A caller adds its own elements and remark plugins on top; the fences stay aiview's. */
export function RenderedMarkdown({
  source,
  components,
  remarkPlugins = [],
}: {
  source: string;
  components?: Components;
  remarkPlugins?: Options["remarkPlugins"];
}) {
  return (
    <Markdown remarkPlugins={[remarkGfm, ...(remarkPlugins ?? [])]} components={{ ...components, pre: FencedBlock }}>
      {source}
    </Markdown>
  );
}

/** Doc-relative images resolve through the asset route, keyed to this document. */
const documentImages = (docId: number): Components => ({
  img: ({ node: _node, src, ...rest }) => (
    <img src={typeof src === "string" && isRelative(src) ? assetUrl(docId, src) : src} {...rest} />
  ),
});

export function MarkdownView({ content, docId }: { content: string; docId: number }) {
  return (
    <article className="md" data-component="MarkdownView">
      <RenderedMarkdown source={content} components={documentImages(docId)} />
    </article>
  );
}
