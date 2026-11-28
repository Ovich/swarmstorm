// Phases (codebase-rework#D8): the orchestrator opens them; a member is done with one. Pausing is the run's (run/pause.ts).
import type { Participant } from "../../contract/board.ts";
import { EVENTS } from "../../contract/events.ts";
import { everyOwingDone, owesPhase, phaseIsForSeat, type PhaseProgress } from "./owing.ts";
import type { NotOwed, Board } from "../types.ts";
import { ORCHESTRATOR, type Row, type Rows } from "../rows.ts";
import type { Messages } from "../conversation/messages.ts";
import type { PhaseReads } from "./phase-reads.ts";
import type { Deliveries } from "../conversation/delivery.ts";
import type { Store } from "../../store/store.ts";

/** The lost members as a line's suffix: ` (1 lost: idea/b)`, empty when none (D41). */
const goneSuffix = (gone: string[]): string => (gone.length ? ` (${gone.length} lost: ${gone.join(", ")})` : "");

/** A phase's name: one word. */
const PHASE_NAME = /^[\w.-]+$/;

export function makePhases(store: Store, rows: Rows, messages: Messages, owing: PhaseReads, delivery: Deliveries, allDoneOnce: AllDoneOnce) {
  const { db, now } = store;
  const transaction = store.tx;
  const { runRowOrNone, runRow, phaseOf, participantById, live } = rows;
  const { insertMessage } = messages;
  const { phaseScopeOf, phaseOpenedSeqOf, phaseMembersOf, owedNameOf, progressOf } = owing;
  const { markPhaseOpenDelivered } = delivery;
  /** Idea 2: why `p`'s `done` of the current phase `name` wakes the orchestrator, the case as its body names it; null
   *  when none holds and the done wakes nobody (all-done tells the orchestrator). The person's cases: a watched member (`phase --watch`), a done without
   *  its deliverable (the orchestrator mentioned the member in this phase and it posted nothing since), the straggler. */
  const doneWakeCase = (p: Participant, name: string, progress: PhaseProgress): string | null => {
    const r = runRow(p.run);
    const watch = r.phase_watch == null ? [] : (JSON.parse(String(r.phase_watch)) as string[]);
    if (watch.includes(p.seat)) return "watched";
    const orch = db.prepare("SELECT id FROM participants WHERE run = ? AND seat = ?").get(p.run, ORCHESTRATOR) as Row | undefined;
    if (orch) {
      const asked = (db.prepare("SELECT seq, mentions FROM messages WHERE run = ? AND author = ? AND seq > ? AND kind != 'event' ORDER BY seq DESC").all(p.run, Number(orch.id), phaseOpenedSeqOf(p.run)) as Row[]).find(
        (m) => (JSON.parse(String(m.mentions)) as string[]).includes(p.name),
      );
      if (asked) {
        const answered = db.prepare("SELECT 1 FROM messages WHERE author = ? AND seq > ? AND kind != 'event' LIMIT 1").get(p.id, Number(asked.seq));
        if (!answered) return `no post since the orchestrator's #${Number(asked.seq)}`;
      }
    }
    if (progress.of - progress.done === 1) {
      const scope = phaseScopeOf(r, name);
      const straggler = phaseMembersOf(p.run, name).find((m) => owesPhase(m, scope) && !progress.gone.includes(m.member));
      if (straggler) return `all but ${straggler.seat}`;
    }
    return null;
  };
  const verbs: Pick<Board, "phase" | "currentPhase" | "showPhase" | "done" | "lastActivity" | "phaseProgress" | "owedPhase"> = {
    phase(p, name, text, opts = {}) {
      const fresh = live(p);
      if (fresh.seat !== ORCHESTRATOR) throw new Error(`phase: only the orchestrator opens a phase; ${fresh.name} is not ${fresh.plan}/${ORCHESTRATOR}`);
      if (!PHASE_NAME.test(name)) throw new Error(`phase: a phase name is one word, got ${JSON.stringify(name)}`);
      const said = text.trim();
      if (!said) throw new Error(`phase ${name}: what does it ask?`);
      if (runRow(fresh.run).state !== "open") throw new Error(`run ${fresh.run} is closed`);
      return transaction(() => {
        // the run's current phase, the header of every delivery from now on
        // idea 2: the members whose `done` wakes the orchestrator in this phase (`--watch`), by id
        const seatOf = (w: string): string => w.slice(w.lastIndexOf("/") + 1).replace(/^@/, "");
        const watch = (opts.watch ?? []).map(seatOf).filter(Boolean);
        // `--for`: only these seats are woken and owe their done; the others read the phase as their next header
        const only = [...new Set((opts.for ?? []).map(seatOf).filter(Boolean))];
        const unknown = only.filter((s) => s === ORCHESTRATOR || (!db.prepare("SELECT 1 FROM seats WHERE run = ? AND id = ?").get(fresh.run, s) && !db.prepare("SELECT 1 FROM participants WHERE run = ? AND seat = ?").get(fresh.run, s)));
        if (unknown.length) throw new Error(`phase ${name}: --for names no seat of run ${fresh.run}: ${unknown.join(", ")}`);
        // board-split D62 (V-6): who owed the phase this one replaces, read before it is replaced
        const before = runRow(fresh.run);
        const stillOwed = before.phase == null ? [] : (() => {
          const scope = phaseScopeOf(before, String(before.phase));
          return phaseMembersOf(fresh.run, String(before.phase)).filter((m) => owesPhase(m, scope)).map((m) => m.member);
        })();
        // the names of the run's phases opened before this one, in order: the answer reads a loop from them
        const earlier = (db.prepare("SELECT meta FROM messages WHERE run = ? AND event = ? ORDER BY seq").all(fresh.run, EVENTS.phase.name) as Row[]).map((r) => String(JSON.parse(String(r.meta ?? "{}")).phase ?? ""));
        db.prepare("UPDATE runs SET phase = ?, phase_text = ?, phase_watch = ?, phase_for = ?, phase_at = ? WHERE id = ?").run(name, said, watch.length ? JSON.stringify(watch) : null, only.length ? JSON.stringify(only) : null, now(), fresh.run);
        // a phase opened again starts with no member done
        db.prepare("DELETE FROM phase_done WHERE run = ? AND phase = ?").run(fresh.run, name);
        // D41: its all-done told once per opening
        db.prepare("DELETE FROM liveness_warned WHERE run = ? AND member = ? AND cond = ?").run(fresh.run, ORCHESTRATOR, `all-done ${name}`);
        const woken = only.length ? only.map((s) => `${fresh.plan}/${s}`) : [`${fresh.plan}/*`];
        return { ...insertMessage(fresh, `phase ${name}: ${said}`, null, "event", woken, { event: EVENTS.phase.name, meta: { phase: name } }), stillOwed, earlier };
      });
    },

    currentPhase(run) {
      return phaseOf(runRow(run));
    },

    showPhase(p) {
      const fresh = participantById(p.id);
      const phase = phaseOf(runRow(fresh.run));
      if (!phase) return null;
      // the phase is "shown" per opening: the phase event's seq, so a phase opened again is shown in full once more
      const key = `${phase.name}#${phaseOpenedSeqOf(fresh.run)}`;
      const shown = db.prepare("SELECT phase_shown FROM participants WHERE id = ?").get(fresh.id) as Row;
      if (shown.phase_shown === key) return { phase, first: false };
      db.prepare("UPDATE participants SET phase_shown = ? WHERE id = ?").run(key, fresh.id);
      return { phase, first: true };
    },

    done(p, name, opts = {}) {
      const fresh = live(p);
      // board-split D63: the orchestrator's done line carries the branch still holding work not merged
      const unmergedSuffix = opts.unmerged ? `; unmerged ${opts.unmerged}` : "";
      if (fresh.seat === ORCHESTRATOR) throw new Error("done: the orchestrator opens phases; a member runs done");
      const current = phaseOf(runRow(fresh.run));
      if (!current) throw new Error(`done ${name}: no phase is open in run ${fresh.run}`);
      const orch = `${fresh.plan}/${ORCHESTRATOR}`;
      // board-split D62 (V-5): what the member owes once this done is recorded, so its answer names it
      // V-28: a seat the count leaves out is told so, never shown a count it is not in
      const notOwedOf = (): NotOwed => {
        const r = runRow(fresh.run);
        const scope = phaseScopeOf(r, name);
        return phaseIsForSeat(scope, fresh.seat) ? null : { forSeats: scope.forSeats ?? [] };
      };
      const owesNow = (): string | null => owedNameOf(db.prepare("SELECT * FROM participants WHERE id = ?").get(fresh.id) as Row, runRow(fresh.run));
      // idea 2: a done for a phase opened earlier in the run, not the current one, is accepted, recorded, and wakes
      if (current.name !== name) {
        const opened = (db.prepare("SELECT meta FROM messages WHERE run = ? AND event = ?").all(fresh.run, EVENTS.phase.name) as Row[]).some(
          (r) => r.meta != null && (JSON.parse(String(r.meta)) as { phase?: string }).phase === name,
        );
        if (!opened) throw new Error(`done ${name}: the current phase is ${current.name}`);
        return transaction(() => {
          const added = Number(db.prepare("INSERT OR IGNORE INTO phase_done (run, participant, phase, at) VALUES (?, ?, ?, ?)").run(fresh.run, fresh.id, name, now()).changes) > 0;
          const progress = progressOf(fresh.run, name)!;
          if (!added) return { progress, all: false, already: true, late: true, owesNow: owesNow(), notOwed: null, message: null };
          const message = insertMessage(fresh, `late done ${name}; the current phase is ${current.name}${unmergedSuffix}`, null, "event", [orch], { event: EVENTS.done.name, meta: { phase: name } });
          return { progress, all: false, already: false, late: true, owesNow: owesNow(), notOwed: null, message };
        });
      }
      return transaction(() => {
        const added = Number(db.prepare("INSERT OR IGNORE INTO phase_done (run, participant, phase, at) VALUES (?, ?, ?, ?)").run(fresh.run, fresh.id, name, now()).changes) > 0;
        const progress = progressOf(fresh.run, name)!;
        const all = everyOwingDone(progress);
        if (!added) return { progress, all, already: true, late: false, owesNow: null, notOwed: notOwedOf(), message: null };
        // board-split D33 (S35): the done is the member's latest fact, shown over an older doing
        db.prepare("UPDATE participants SET doing = ? WHERE id = ?").run(`done ${name}`, fresh.id);
        // idea 2: the done wakes the orchestrator only in the person's cases, named in its body; otherwise it wakes nobody
        const wakeCase = doneWakeCase(fresh, name, progress);
        // V-27: the count and who still owes it together, the unmerged branch last
        const body = `done ${name} (${progress.done}/${progress.of})${goneSuffix(progress.gone)}${wakeCase ? `: ${wakeCase}` : ""}${unmergedSuffix}`;
        const message = insertMessage(fresh, body, null, "event", wakeCase ? [orch] : [], { event: EVENTS.done.name, meta: { phase: name } });
        markPhaseOpenDelivered(fresh, name);
        allDoneOnce(fresh, progress);
        return { progress, all, already: false, late: false, owesNow: null, notOwed: notOwedOf(), message };
      });
    },

    lastActivity(run) {
      // what the board posts on its own clock (stopped, lost) is no member's activity: counted, a forgotten run's
      // stale flag would unforget it (S31)
      const r = runRow(run);
      const row = db
        .prepare("SELECT MAX(COALESCE(p.last_call, p.joined_at)) AS calls, (SELECT MAX(m.at) FROM messages m JOIN participants q ON q.id = m.author WHERE q.run = ? AND m.by_board = 0) AS posts FROM participants p WHERE p.run = ?")
        .get(run, run) as Row | undefined;
      return [String(r.opened_at), row?.calls, row?.posts].filter((v): v is string => typeof v === "string").sort().at(-1)!;
    },

    phaseProgress(run) {
      const r = runRow(run);
      return progressOf(run, r.phase == null ? null : String(r.phase));
    },

    owedPhase(p) {
      // board-split D62: the one owing rule, owedNameOf's
      const row = db.prepare("SELECT * FROM participants WHERE id = ?").get(p.id) as Row | undefined;
      if (!row || row.ended_at != null) return null;
      const r = runRowOrNone(Number(row.run));
      return r && owedNameOf(row, r) != null ? phaseOf(r) : null;
    },
  };
  return verbs;
}

/** The `all-done` event, once per run and phase: the last `done`'s and the tick's (board-split D62, D41). */
export function makeAllDone(store: Store, messages: Messages) {
  const { db } = store;
  const { insertMessage } = messages;
  /** `all-done` to the orchestrator, once per run and phase whoever reaches it first: the last `done`, or the tick
   *  that finds the last member not done gone (D41). */
  const allDoneOnce = (author: Participant, progress: PhaseProgress): boolean => {
    if (!everyOwingDone(progress)) return false;
    if (Number(db.prepare("INSERT OR IGNORE INTO liveness_warned (run, member, cond) VALUES (?, ?, ?)").run(author.run, ORCHESTRATOR, `all-done ${progress.phase}`).changes) !== 1) return false;
    // V-35: "every member" only when no member owing the phase is lost; a lost one is named with the move it needs
    const body = progress.gone.length
      ? `all done ${progress.phase} but the lost: ${progress.done}/${progress.of} done; lost, not done: ${progress.gone.join(", ")}: dispatch each again or end its seat, then open the next phase`
      : `all done ${progress.phase}: every member is done (${progress.done}/${progress.of}); open the next phase`;
    insertMessage(author, body, null, "event", [`${author.plan}/${ORCHESTRATOR}`], {
      event: EVENTS["all-done"].name,
      meta: { phase: progress.phase },
    });
    return true;
  };
  return allDoneOnce;
}
export type AllDoneOnce = ReturnType<typeof makeAllDone>;
