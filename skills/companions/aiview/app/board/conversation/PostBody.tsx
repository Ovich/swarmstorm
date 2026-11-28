import { Children, type ComponentProps, type ReactElement, type ReactNode } from "react";
import type { Components } from "react-markdown";
import { RenderedMarkdown } from "../../ui/viewers/MarkdownView.tsx";
import { RichText } from "../chips.tsx";

type MdNode = { type: string; value?: string; children?: MdNode[] };

/** Raw HTML in a post is shown as the text it is, never rendered. */
function remarkHtmlAsText() {
  const walk = (node: MdNode) => {
    if (node.type === "html") node.type = "text";
    node.children?.forEach(walk);
  };
  return (tree: MdNode) => walk(tree);
}

type TextTag = "p" | "li" | "td" | "th" | "strong" | "em" | "del" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
const TEXT_TAGS: TextTag[] = ["p", "li", "td", "th", "strong", "em", "del", "h1", "h2", "h3", "h4", "h5", "h6"];

/** The board's own decorations on aiview's markdown: mentions and `#<seq>` links in the text of
 *  these elements, never inside code, which renders through aiview's fences or as <code>. */
function textDecorations(mentions: boolean | undefined, shown: ReadonlySet<number>): Components {
  const decorate = (children: ReactNode) =>
    Children.map(children, (c) => (typeof c === "string" ? <RichText text={c} mentions={mentions} shown={shown} /> : c));
  const decorated =
    <T extends TextTag>(Tag: T) =>
    ({ node: _node, children, ...rest }: ComponentProps<T> & { node?: unknown }) => {
      const Element = Tag as unknown as (p: Record<string, unknown>) => ReactElement;
      return <Element {...rest}>{decorate(children)}</Element>;
    };
  return Object.fromEntries(TEXT_TAGS.map((tag) => [tag, decorated(tag)]));
}

/** A row's body, rendered as an aiview document renders markdown (diagrams, code), with the board's
 *  mentions and `#<seq>` links on top and raw HTML as text. */
export function PostBody({ body, mentions, shown }: { body: string; mentions?: boolean; shown: ReadonlySet<number> }) {
  return (
    <div className="post-md" data-component="PostBody">
      <RenderedMarkdown source={body} components={textDecorations(mentions, shown)} remarkPlugins={[remarkHtmlAsText]} />
    </div>
  );
}
