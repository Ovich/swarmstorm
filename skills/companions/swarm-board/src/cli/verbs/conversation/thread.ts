import type { ThreadQuery } from "../../../board/board.ts";
import { shellWord, WORDING } from "../../answer/index.ts";
import type { VerbContext } from "../../context.ts";
import { shortAt } from "../../lines.ts";

/** How much of a post a thread line shows; `read <seq>` shows it whole. */
const THREAD_EXCERPT = 100;

export async function threadVerb(ctx: VerbContext): Promise<void> {
  const run = await ctx.readRun("thread");
  const q: ThreadQuery = {
    phase: ctx.args.flag("--phase"),
    from: ctx.seqFlag("--from"),
    before: ctx.seqFlag("--before"),
    limit: ctx.seqFlag("--limit"),
    by: ctx.args.flag("--by"),
    to: ctx.args.flag("--to"),
    with: ctx.args.flag("--with"),
    about: ctx.args.flag("--about"),
    events: ctx.args.has("--events"),
  };
  const page = await ctx.board.thread(ctx.projectRepo(), run, q);
  const cli = ctx.cli;
  // the next page's query: this one's, its phase pinned, so a phase opened meanwhile never moves it
  const words = [
    `--run ${run}`,
    `--phase ${page.phase?.name ?? "all"}`,
    ...(["--by", "--to", "--with", "--about", "--limit"] as const).flatMap((f) => (ctx.args.flag(f) === undefined ? [] : [`${f} ${shellWord(ctx.args.flag(f)!)}`])),
    ...(q.events ? ["--events"] : []),
  ].join(" ");
  ctx.emit(page, () => {
    console.log(`run ${run}  ${page.title}  ·  ${page.phase ? `phase ${page.phase.name} from #${page.phase.seq}` : "the whole run"}  ·  ${page.posts.length} of ${page.matched} post${page.matched === 1 ? "" : "s"}`);
    if (!page.posts.length) console.log(WORDING.threadNone);
    const group = `${page.group}/`;
    const short = (n: string): string => (n === `${group}*` ? "all" : n.startsWith(group) ? n.slice(group.length) : n);
    for (const m of page.posts) {
      const to = m.mentions.length ? ` → ${m.mentions.map(short).join(",")}` : "";
      const tag = m.kind === "agreement" ? "agree: " : m.kind === "urgent" ? "URGENT: " : m.kind === "event" ? `(${m.event ?? "event"}) ` : "";
      const text = m.body.replace(/\s+/g, " ").trim();
      console.log(`#${m.seq} ${shortAt(m.at)}  ${short(m.from)}${to}${m.about ? ` [${m.about}]` : ""}  ${tag}${text.length > THREAD_EXCERPT ? `${text.slice(0, THREAD_EXCERPT)}…` : text}`);
    }
    if (page.earlier !== null) console.log(WORDING.threadEarlier(cli, words, page.earlier));
    if (page.later !== null) console.log(WORDING.threadLater(cli, words, page.later));
    if (page.posts.length) console.log(WORDING.readPost(cli));
  });
}
