// A member's calls (codebase-rework#D8, D66): each verb counted once, and a pack verb's server side.
import type { PackRefusal, Pack } from "../../packs/types.ts";
import type { Participant } from "../../contract/board.ts";
import type { Row, Rows } from "../rows.ts";
import { kindPackOf, type PackBridge } from "../pack-bridge.ts";
import type { Board } from "../types.ts";
import type { Store } from "../../store/store.ts";

export function makeCalls(store: Store, rows: Rows, packs: PackBridge) {
  const { db, now } = store;
  const transaction = store.tx;
  const bump = store.changes.bump;
  const { runRow, participantById, live } = rows;
  const { packTables, runPackCtx, registry } = packs;
  // Every verb a member calls is one call to the board, counted here and nowhere else (D66):
  // what the card's call count shows, and the last sign of life "stale" is measured from.
  // `reconcileWrites` is part of `merge-lock` and `end`, not a call.
  /** The verbs that are a member's progress (swarm-relay D36). */
  const PROGRESS_VERBS: ReadonlySet<string> = new Set(["post", "done", "setDoing", "endorse"]);
  /** board-split D49: the verbs where a member reports on itself; they never reset its stall. */
  const SELF_REPORT_VERBS: ReadonlySet<string> = new Set(["post", "setDoing", "endorse"]);
  /** `progress`: a pack's verb that is progress of its own (D36), beside the core's PROGRESS_VERBS. */
  const countCall = (p: Participant, verb: string, progress = false): void => {
    const at = now();
    db.prepare("UPDATE participants SET calls = calls + 1, last_call = ? WHERE id = ?").run(at, p.id);
    // D36: a post, `done` or `doing` is progress, a look at the board is not
    if (progress || PROGRESS_VERBS.has(verb)) db.prepare("UPDATE participants SET progress_at = ? WHERE id = ?").run(at, p.id);
    // board-split D49: a self-report never resets a stall
    if (!SELF_REPORT_VERBS.has(verb)) db.prepare("UPDATE participants SET board_call_at = ? WHERE id = ?").run(at, p.id);
    // the call itself, for the member's timeline (D25)
    db.prepare("INSERT INTO call_log (participant, at, verb) VALUES (?, ?, ?)").run(p.id, at, verb);
    bump(participantById(p.id).repo);
  };
  const verbs: Pick<Board, "packCall"> = {
    packCall(p, verb, input) {
      const member = p ? participantById(p.id) : null;
      // an ended member's verb has nothing for its pack to do (the verb itself answers it); afterEnd runs once it has
      if (member?.ended && verb !== "afterEnd") {
        // a write to an ended member's name is refused, as any verb of an ended member is
        if (registry.all().some((k) => Object.hasOwn(k.writes ?? {}, verb))) live(member);
        return null;
      }
      // whose pack answers: the member's own; a seat not joined yet, its seat's row; a run's call, its kind's; else every pack
      const runId = member ? member.run : typeof input.run === "number" ? input.run : null;
      const packs = member
        ? [registry.packNamed(member.pack)]
        : runId !== null && typeof input.seat === "string"
          ? [registry.forMember(String(runRow(runId).kind ?? "plan"), (db.prepare("SELECT role FROM seats WHERE run = ? AND id = ?").get(runId, input.seat) as Row | undefined)?.role as string | null ?? null).pack]
          : runId !== null
            ? [registry.packNamed(kindPackOf(String(runRow(runId).kind ?? "plan")))]
            : registry.all();
      const ctx = runId !== null ? runPackCtx(runId) : null;
      // a pack verb called by a member whose pack lacks it: the refusal fact the answer module words (D12)
      const offers = (k: Pack | null | undefined): boolean => !!k && (k.verbs.some((v) => v.name === verb) || Object.hasOwn(k.writes ?? {}, verb));
      const known = registry.all().some(offers);
      const own = packs[0];
      if (member && known && !offers(own)) {
        const refusal: PackRefusal = { refused: { reason: "no-pack", verb, seatKind: member.verify ? "verifier" : "seat" } };
        return refusal;
      }
      if (member && ctx && own && verb === "beforeEnd") return own.beforeEnd?.(member, ctx) ?? null;
      if (member && ctx && own && verb === "afterEnd") return own.afterEnd?.(member, ctx) ?? {};
      // a member's write: the pack's tables, in the core's transaction with the call counted (D9, D19)
      const write = member && own?.writes && Object.hasOwn(own.writes, verb) ? own.writes[verb] : null;
      if (member && write && own && ctx)
        return transaction(() => {
          const out = write.apply(live(member), input, ctx);
          if (write.countedAs !== null) countCall(member, write.countedAs, write.progress);
          return out;
        });
      const answers = packs.filter((k): k is NonNullable<typeof k> => !!k?.run).map((k) => k.run!(verb, member, input, ctx, packTables));
      return answers.length <= 1 ? (answers[0] ?? null) : answers.flat();
    },
  };
  return { ...verbs, countCall };
}
