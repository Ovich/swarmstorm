// The verbs of pending cards: work the reader is waiting on, added, done, listed, cleared.
import type { Document } from "../../core/db.ts";
import { fail, resolveRef, type VerbContext } from "../context.ts";
import { notifyPendingChanged } from "../server.ts";
import { subVerbUsage, verbUsage } from "../usage.ts";
import type { Verb } from "../dispatch.ts";

/** The document a sub-verb names, which must be registered. */
function documentOf(ref: string | undefined): Document {
  const named = ref || fail(verbUsage("pending"));
  return resolveRef(named) ?? fail(`no such document: ${named}`);
}

function addPending(ctx: VerbContext): void {
  const { args, emit } = ctx;
  const index = ctx.index();
  const doc = documentOf(args.positional[1]);
  const label = args.flag("--label") || fail(subVerbUsage("pending", "add"));
  const id = index.addPending(doc.id, label, args.flag("--note") ?? "");
  notifyPendingChanged(doc.id);
  emit({ id, document: doc.id, label }, `pending #${id}  ${label}  (doc #${doc.id})`);
}

function donePending(ctx: VerbContext): void {
  const { args, emit } = ctx;
  const index = ctx.index();
  const raw = (args.positional[1] ?? "").replace(/^#/, "");
  const id = Number(raw);
  if (!raw || Number.isNaN(id)) fail(subVerbUsage("pending", "done"));
  const docId = index.donePending(id) ?? fail(`no such pending item: #${id}`);
  notifyPendingChanged(docId);
  emit({ id, document: docId }, `done #${id}`);
}

function clearPending(ctx: VerbContext): void {
  const { args, emit } = ctx;
  const index = ctx.index();
  const doc = documentOf(args.positional[1]);
  index.clearPending(doc.id);
  notifyPendingChanged(doc.id);
  emit({ document: doc.id, cleared: true }, `cleared pending for #${doc.id}`);
}

function listPending(ctx: VerbContext): void {
  const { args, emit } = ctx;
  const index = ctx.index();
  const ref = args.positional[1];
  const rows = ref ? index.pendingFor(documentOf(ref).id) : index.allPending();
  emit(rows, () => {
    if (!rows.length) return console.log("nothing pending");
    for (const r of rows) console.log(`#${r.id}  doc #${r.document_id}  ${r.label}${r.note ? ` — ${r.note}` : ""}  since ${r.started_at}`);
  });
}

/** Each sub-verb; anything else lists. */
const PENDING_SUB_VERBS: Record<string, (ctx: VerbContext) => void> = { add: addPending, done: donePending, clear: clearPending };

function runPending(ctx: VerbContext): void {
  const sub = ctx.args.positional[0] ?? "";
  (Object.hasOwn(PENDING_SUB_VERBS, sub) ? PENDING_SUB_VERBS[sub] : listPending)(ctx);
}

export const PENDING_VERBS: Verb[] = [{ name: "pending", help: "listed", needs: { index: true }, run: runPending }];
