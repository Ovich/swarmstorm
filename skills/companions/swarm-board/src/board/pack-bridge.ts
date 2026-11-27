// The board's one way to its packs (codebase-rework#D8, D7): the only importer of packs/registry.ts. A member's pack,
// its run's context for a call, and the registry's answers the board reads.
import { registry } from "../packs/registry.ts";
import type { PackCtx, MemberFact } from "../packs/types.ts";
import type { Participant, RunId } from "../contract/board.ts";
import type { Rows } from "./rows.ts";
import type { Messages } from "./messages.ts";
import type { Paths } from "./paths.ts";
import type { Store } from "./store/store.ts";

/** The pack a run of `kind` gives a member by default (D22): an orchestrator,
 *  a run's close. A member's verbs read its own `pack` (D11, D12). */
export const kindPackOf = (kind: string): string | null => registry.forMember(kind, null).pack?.name ?? null;
/** Whether a run of `kind` gives a member by default the verify setting (D11, D22). */
export const kindVerifyOf = (kind: string): boolean => registry.forMember(kind, null).verify;

export function makePackBridge(store: Store, rows: Rows, messages: Messages, paths: Paths) {
  const { db, now } = store;
  const transaction = store.tx;
  const bump = store.changes.bump;
  const { runRow, participantById, lastSeq, isLive } = rows;
  const { insertMessage } = messages;
  const { fold, slashes, relPath } = paths;
  // the code pack's tables, opened through the registry (board-split#D20)
  const packTables = registry.openTables({ db, transaction, bump, now, lastSeq, participantById, isLive, insertMessage, relPath, fold, slashes });
  /** One run's context for a pack call (D10). */
  const runPackCtx = (runId: RunId): PackCtx => {
    const r = runRow(runId);
    return {
      run: runId,
      repo: String(r.repo),
      group: String(r.plan),
      base: r.base == null ? null : String(r.base),
      tables: packTables,
      insertMessage: (author, body, about) => insertMessage(author, body, about, "msg"),
    };
  };
  /** The member's own pack, chosen at its join (D11), and its run's context for one call (D9, D10). */
  const packOf = (p: Participant) => registry.packNamed(p.pack);
  const packCtxOf = (p: Participant): PackCtx => runPackCtx(p.run);
  /** What the member's pack says of it now (D36), as the roster's `fact`; nothing when the pack says nothing. */
  const factEntry = (p: Participant): { fact?: MemberFact } => {
    const fact = packOf(p)?.memberFact?.(p, packCtxOf(p)) ?? null;
    return fact ? { fact } : {};
  };
  /** What a cause that wakes a waiting task reads as on `p`'s pack (board-fixes#D4); the cause itself when it says nothing. */
  const awaitedWording = (p: Participant, cause: string): string => packOf(p)?.awaitedWording?.(cause) ?? cause;
  /** The registry's answers the board reads; opening the packs' tables stays here. */
  const registryReads: Pick<typeof registry, "forMember" | "declaredRefused" | "packNamed" | "all" | "snapshot" | "heldOf" | "forgetMember" | "forgetRun"> = registry;
  return { packTables, runPackCtx, packOf, packCtxOf, factEntry, awaitedWording, registry: registryReads };
}
export type PackBridge = ReturnType<typeof makePackBridge>;
