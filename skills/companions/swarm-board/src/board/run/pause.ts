// Pausing a run (codebase-rework#D8): the orchestrator pauses and resumes it; the state is the run's (`runs.paused`).
import type { Message } from "../../contract/board.ts";
import { EVENTS, wakes } from "../../contract/events.ts";
import type { Board } from "../types.ts";
import { ORCHESTRATOR, type Rows } from "../rows.ts";
import type { Messages } from "../conversation/messages.ts";
import type { Deliveries } from "../conversation/delivery.ts";
import type { Store } from "../../store/store.ts";

const LINE_WIDTH = 100;

/** One line for a message, as resume lists what the pause held. */
function messageLine(m: Message): string {
  const first = m.body.split(/\r?\n/)[0];
  const text = first.length > LINE_WIDTH ? `${first.slice(0, LINE_WIDTH - 1)}…` : first;
  const kind = m.kind === "msg" ? "" : ` (${m.kind})`;
  const about = m.about ? ` about ${m.about}` : "";
  return `#${m.seq} ${m.from}${kind}${about}: ${text}`;
}

export function makePause(store: Store, rows: Rows, messages: Messages, delivery: Deliveries) {
  const { db, now } = store;
  const transaction = store.tx;
  const { runRow, memoizedParticipants, participantById, toMessage, live } = rows;
  const { insertMessage } = messages;
  const { unseenRows } = delivery;
  const verbs: Pick<Board, "pause" | "resume" | "pausedOf"> = {
    pause(p, text = "", opts = {}) {
      const fresh = live(p);
      if (fresh.seat !== ORCHESTRATOR) throw new Error(`pause: only the orchestrator pauses its run; ${fresh.name} is not ${fresh.plan}/${ORCHESTRATOR}`);
      const r = runRow(fresh.run);
      if (r.state !== "open") throw new Error(`run ${fresh.run} is closed`);
      if (r.paused != null) throw new Error(`run ${fresh.run} is already paused`);
      const said = text.trim();
      return transaction(() => {
        const person = opts.person === true;
        db.prepare("UPDATE runs SET paused = ?, paused_person = ? WHERE id = ?").run(said, person ? 1 : 0, fresh.run);
        const why = person ? `: waiting on the person${said ? `: ${said}` : ""}` : said ? `: ${said}` : "";
        return insertMessage(fresh, `pause: stop where you are and wait for the resume${why}`, null, "event", [`${fresh.plan}/*`], { event: EVENTS.pause.name, meta: { person, text: said } });
      });
    },

    resume(p, text = "") {
      const fresh = live(p);
      if (fresh.seat !== ORCHESTRATOR) throw new Error(`resume: only the orchestrator resumes its run; ${fresh.name} is not ${fresh.plan}/${ORCHESTRATOR}`);
      const r = runRow(fresh.run);
      if (r.state !== "open") throw new Error(`run ${fresh.run} is closed`);
      if (r.paused == null) throw new Error(`run ${fresh.run} is not paused`);
      const said = text.trim();
      return transaction(() => {
        // idea 2: what the pause held from the orchestrator (what would have woken it) comes in resume's answer, one
        // line each, and is delivered with it
        const me = participantById(fresh.id);
        const authorOf = memoizedParticipants();
        const held = unseenRows(me)
          .map((r) => toMessage(r, authorOf))
          .filter((m) => m.run === me.run && wakes(m, me));
        const mark = db.prepare("INSERT OR IGNORE INTO deliveries (participant, seq, at) VALUES (?, ?, ?)");
        for (const m of held) mark.run(me.id, m.seq, now());
        db.prepare("UPDATE runs SET paused = NULL, paused_person = 0, resumed_at = ?, stall_posts = 0 WHERE id = ?").run(now(), fresh.run);
        const message = insertMessage(fresh, `resume: continue${said ? `: ${said}` : ""}`, null, "event", [`${fresh.plan}/*`], { event: EVENTS.resume.name });
        return { ...message, held: held.map(messageLine) };
      });
    },

    pausedOf(run) {
      const r = runRow(run);
      return r.paused == null ? null : String(r.paused);
    },
  };
  return verbs;
}
