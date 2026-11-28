// Talk (codebase-rework#D8): a member's post, an agreement, an endorsement.
import { parseMentions } from "./mentions.ts";
import { ORCHESTRATOR, type Row, type Rows } from "../rows.ts";
import type { Messages } from "./messages.ts";
import type { PackBridge } from "../pack-bridge.ts";
import type { Board } from "../types.ts";
import type { Store } from "../../store/store.ts";

export function makeTalk(store: Store, rows: Rows, messages: Messages, packs: PackBridge) {
  const { db } = store;
  const transaction = store.tx;
  const { participantById, openPlans, activeNames, live } = rows;
  const { insertMessage } = messages;
  const { packOf, packCtxOf } = packs;
  const verbs: Pick<Board, "post" | "endorse"> = {
    post(p, body, opts = {}) {
      const fresh = live(p);
      let named: string[] | undefined;
      if (opts.kind === "agreement") {
        // an agreement's parties (F25): its mentions, then --with, else the other holders of the file it is about
        const parsed = parseMentions(body, fresh.plan, openPlans(fresh.repo), activeNames(fresh.repo));
        const extra = (opts.with ?? []).map((w) => w.trim().replace(/^@/, "")).filter(Boolean);
        const given = extra.length ? parseMentions(extra.map((w) => `@${w}`).join(" "), fresh.plan, openPlans(fresh.repo), activeNames(fresh.repo)) : [];
        const holders = !parsed.length && !given.length && opts.about ? (packOf(fresh)?.defaultParties?.(opts.about, packCtxOf(fresh)) ?? []).filter((n) => n !== fresh.name) : [];
        named = [...new Set([...parsed, ...given, ...holders])].filter((n) => n !== fresh.name);
        // on a code run an agreement binds two: with no other party it is refused (F25); a brainswarm agreement binds the room
        if (!named.length && fresh.pack !== null) throw new Error("agree needs another party: @<seat> or --with <seat>; to inform, use post");
      }
      const after = [...new Set((opts.after ?? []).map((w) => w.trim().replace(/^@/, "")).map((w) => w.slice(w.lastIndexOf("/") + 1)).filter(Boolean))];
      const task = opts.task || after.length > 0;
      if (task) {
        // board-fixes#D13: a task is the orchestrator's, to exactly one seat of its run
        if (fresh.seat !== ORCHESTRATOR) throw new Error(`post --task: only the orchestrator posts a task; ${fresh.name} is not ${fresh.plan}/${ORCHESTRATOR}`);
        if (opts.kind && opts.kind !== "msg") throw new Error("post --task: a task is a plain post");
        const mentioned = parseMentions(body, fresh.plan, openPlans(fresh.repo), activeNames(fresh.repo));
        const isSeat = (s: string): boolean => s !== ORCHESTRATOR && (db.prepare("SELECT 1 FROM seats WHERE run = ? AND id = ?").get(fresh.run, s) != null || db.prepare("SELECT 1 FROM participants WHERE run = ? AND seat = ?").get(fresh.run, s) != null);
        const target = mentioned.length === 1 && mentioned[0].startsWith(`${fresh.plan}/`) ? mentioned[0].slice(fresh.plan.length + 1) : null;
        if (!target || !isSeat(target)) throw new Error(`post --task: a task mentions exactly one seat of run ${fresh.run}; this one mentions ${mentioned.join(", ") || "none"}`);
        const unknown = after.filter((s) => !isSeat(s) || s === target);
        if (unknown.length) throw new Error(`post --after: names no other seat of run ${fresh.run}: ${unknown.join(", ")}`);
      }
      return transaction(() => {
        const message = insertMessage(fresh, body, opts.about ?? null, opts.kind ?? "msg", undefined, named ? { parties: named } : {});
        if (task) db.prepare("UPDATE messages SET task = 1, after = ? WHERE seq = ?").run(after.length ? JSON.stringify(after) : null, message.seq);
        return message;
      });
    },

    endorse(p, seq) {
      const fresh = live(p);
      const r = db.prepare("SELECT * FROM messages WHERE seq = ?").get(seq) as Row | undefined;
      if (!r) throw new Error(`unknown message #${seq}`);
      if (r.kind !== "agreement") throw new Error(`#${seq} is not an agreement`);
      if (Number(r.author) === fresh.id) throw new Error(`#${seq} is your own agreement`);
      const author = participantById(Number(r.author));
      const about = r.about == null ? null : String(r.about);
      return insertMessage(fresh, `endorses #${seq}`, about, "endorsement", [author.name], { endorses: seq });
    },
  };
  return verbs;
}
