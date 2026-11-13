// Claims and the merge lock (D35): the code pack's tables (board-split#D20), opened by the board through the
// registry, the second module that sees SQL. The Board's verbs of the same names delegate here after the
// member's pack gate; behaviour and wording are the board's, moved, not rewritten.
import type { DatabaseSync } from "node:sqlite";
import type { Conflicts, Declared, Message, MessageKind, Participant, RunId, Sharer } from "../../board/board.ts";
import type { Flag, MemberWorktree, MergedMeta } from "./types.ts";
import type { EventName } from "../../board/events.ts";
import type { PackMessageMeta } from "../registry.ts";
import { CODE_EVENTS } from "./events.ts";
import { trace } from "../../board/trace.ts";

export interface ClaimsDeps {
  db: DatabaseSync;
  transaction<T>(fn: () => T): T;
  bump(repo: string): void;
  now(): string;
  lastSeq(): number;
  participantById(id: number): Participant;
  isLive(id: number): boolean;
  insertMessage(p: Participant, body: string, about: string | null, kind: MessageKind, named?: string[], extra?: { event?: EventName; meta?: PackMessageMeta }): Message;
  relPath(repo: string, file: string): string | null;
  fold(s: string): string;
  slashes(rel: string): string;
  /** A run of `kind` gives its members claims by default (D22): an interface change is announced to those runs. */
  kindHasPack(kind: string): boolean;
}

export interface Claims {
  /** spec §7: `p`'s claims become `files`, its worktree's changed set as its link read it: a path that left the set is
   *  released, a new one held. Each new path another live member holds is posted once per pair and path, to `p`, unless
   *  they agreed on it. */
  setHoldings(p: Participant, files: string[]): Flag[];
  /** `onto`: the branch the merge lands in, recorded with the lock for the merged event (D9). `files`: the paths the
   *  holder's branch changed, read from git by its CLI: kept with the lock as the files of its merge, a later ask adding to them. */
  lockMerge(p: Participant, onto?: string, reflogMark?: number, files?: string[]): { granted: true } | { granted: false; holder: string };
  /** board-split V-26: the holder of the merge lock `p` was refused and still waits on; null when it waits on none. */
  mergeLockQueuedBehind(p: Participant): string | null;
  /** The merge lock `p` holds: when it was granted and the branch it lands in (D33); null when `p` holds none. */
  heldMergeLock(p: Participant): HeldMergeLock | null;
  /** `files`: the paths the merge changed, as the caller's CLI derived them (the lock's, else its claims), never typed by
   *  a member; the merger's claims on them go. `conflicts` absent: unknown. Known conflicts narrow the sharers to the conflicted paths (D5, D25). */
  merged(p: Participant, sha: string, files: string[], conflicts?: Conflicts): Sharer[];
  /** At a join or re-join: its record of merging starts fresh (D66). */
  seated(p: Participant): void;
  /** `p` called `merged` since it joined (D66). */
  mergedSinceJoin(participant: number): boolean;
  /** At `p`'s end and at closeRun: every claim and the merge lock of `participant` go. */
  releaseAll(participant: number): void;
  /** board-split D59: `p` went lost holding the merge lock: the lock is released at once and the live members refused
   *  it are returned (cleared), as at a release; null when `p` held none. */
  releaseLockOfLost(p: Participant): { waiters: string[] } | null;
  /** At `p`'s end: when `p` holds the merge lock, the members refused it, cleared (D65); else none. */
  lockWaitersFreedBy(p: Participant): string[];
  /** The path `m` asks `me` about, when `me` held it before `m` and its author did not (D62). */
  askedAbout(me: Participant, author: number, m: Message): string | null;
  /** `p` holds the merge lock, or its worktree changes a path: mid-work, never idle. */
  holdsAny(p: Participant): boolean;
  /** The live holders of `about` (a path, or its tail), as `<plan>/<seat>`. */
  holderNames(repo: string, about: string): string[];
  /** Every worktree a member joined from, of `run` or of every run, closed ones included. */
  seatWorktrees(run?: RunId): MemberWorktree[];
}

/** `grantedAt` ISO; `onto` null for a lock taken without a branch; `reflogMark` the holder's HEAD reflog
 *  length at the grant, null when none was given (D36); `files` the paths its branch changed, null when its CLI
 *  read none from git (no worktree). */
export type HeldMergeLock = { grantedAt: string; onto: string | null; reflogMark: number | null; files: string[] | null };

type Row = Record<string, unknown>;

export function claimsOf(deps: ClaimsDeps): Claims {
  const { db, transaction, bump, now, lastSeq, participantById, isLive, insertMessage, relPath, fold, slashes, kindHasPack } = deps;

  /** Every live holder of `rel` by id, in claim order: of the path itself, or of a directory it is under (G42). */
  const holdersOf = (repo: string, rel: string): number[] =>
    (db.prepare("SELECT participant FROM claims WHERE repo = ? AND (path = ? OR substr(?, 1, length(path) + 1) = path || '/') ORDER BY rowid").all(repo, rel, rel) as Row[])
      .map((r) => Number(r.participant))
      .filter(isLive);
  /** An agreement about `rel` between `a` and `b`, made by either and naming the other. */
  const agreedOn = (a: Participant, b: Participant, rel: string): boolean =>
    (db.prepare("SELECT author, about, mentions FROM messages WHERE repo = ? AND kind = 'agreement' AND author IN (?, ?)").all(a.repo, a.id, b.id) as Row[]).some((r) => {
      const about = r.about == null ? "" : fold(slashes(String(r.about)));
      const other = Number(r.author) === a.id ? b : a;
      return about !== "" && (fold(rel) === about || fold(rel).endsWith(`/${about}`)) && (JSON.parse(String(r.mentions)) as string[]).includes(other.name);
    });
  /** The trace: members queued on the lock, and a release with how long it was held. */
  const lockQueue = (repo: string): number => Number((db.prepare("SELECT COUNT(*) AS n FROM lock_waiters WHERE repo = ?").get(repo) as Row).n);
  const traceRelease = (p: Participant, cause: string): void => {
    const l = db.prepare("SELECT at FROM merge_locks WHERE participant = ?").get(p.id) as Row | undefined;
    trace().event("lock", { action: "released", run: p.run, member: p.name, cause, heldMs: l ? Date.now() - Date.parse(String(l.at)) : null, waiting: lockQueue(p.repo) });
  };
  const releaseAll = (id: number): void => {
    if (db.prepare("SELECT 1 FROM merge_locks WHERE participant = ?").get(id)) traceRelease(participantById(id), "ended");
    const owner = db.prepare("SELECT r.repo FROM participants p JOIN runs r ON r.id = p.run WHERE p.id = ?").get(id) as Row | undefined;
    const claims = Number(db.prepare("DELETE FROM claims WHERE participant = ?").run(id).changes);
    const locks = Number(db.prepare("DELETE FROM merge_locks WHERE participant = ?").run(id).changes);
    // the page is told only when something it held went
    if (owner && claims + locks > 0) bump(String(owner.repo));
  };
  /** The live members refused the lock since its holder took it, as mentions name them; the record is cleared (D65). */
  const takeLockWaiters = (repo: string): string[] => {
    const rows = db.prepare("SELECT participant FROM lock_waiters WHERE repo = ? ORDER BY rowid").all(repo) as Row[];
    db.prepare("DELETE FROM lock_waiters WHERE repo = ?").run(repo);
    return rows.map((r) => Number(r.participant)).filter(isLive).map((id) => participantById(id).name);
  };
  /** `p`'s lock turn still going (D25): its latest, not merged, and not closed by an `end` since it was asked,
   *  the end's call row being what closes it. Undefined when it has none. */
  const openTurn = (p: Participant): Row | undefined =>
    db
      .prepare(
        `SELECT rowid AS id, granted_at FROM lock_requests t WHERE participant = ? AND merged_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM call_log c WHERE c.participant = t.participant AND c.verb = 'end' AND c.at >= t.asked_at)
         ORDER BY rowid DESC LIMIT 1`,
      )
      .get(p.id) as Row | undefined;
  /** The turn granted at `at`: the open one stamped when it waited, else a new one asked and granted at once.
   *  `anew`: a new grant, so a turn granted before and lost since (a seat set done) is over. */
  const grantTurn = (p: Participant, at: string, anew: boolean): void => {
    const turn = openTurn(p);
    if (turn && turn.granted_at == null) db.prepare("UPDATE lock_requests SET granted_at = ? WHERE rowid = ?").run(at, Number(turn.id));
    else if (!turn || anew) db.prepare("INSERT INTO lock_requests (repo, participant, asked_at, granted_at) VALUES (?, ?, ?, ?)").run(p.repo, p.id, at, at);
  };
  const declared = (id: number): Declared[] => JSON.parse(String((db.prepare("SELECT files FROM participants WHERE id = ?").get(id) as Row).files)) as Declared[];

  return {
    releaseAll,

    releaseLockOfLost(p) {
      const held = db.prepare("SELECT 1 FROM merge_locks WHERE repo = ? AND participant = ?").get(p.repo, p.id) !== undefined;
      if (!held) return null;
      const waiters = takeLockWaiters(p.repo).filter((n) => n !== p.name);
      traceRelease(p, "given back");
      db.prepare("DELETE FROM merge_locks WHERE repo = ? AND participant = ?").run(p.repo, p.id);
      bump(p.repo);
      return { waiters };
    },

    lockWaitersFreedBy(p) {
      const held = db.prepare("SELECT 1 FROM merge_locks WHERE repo = ? AND participant = ?").get(p.repo, p.id) !== undefined;
      return held ? takeLockWaiters(p.repo).filter((n) => n !== p.name) : [];
    },

    seated(p) {
      db.prepare("UPDATE participants SET merged = 0 WHERE id = ?").run(p.id);
    },

    mergedSinceJoin(participant) {
      return (db.prepare("SELECT merged FROM participants WHERE id = ?").get(participant) as Row | undefined)?.merged === 1;
    },

    askedAbout(me, author, m) {
      const about = fold(relPath(me.repo, m.about!) ?? slashes(m.about!));
      const mine = db.prepare("SELECT path FROM claims WHERE repo = ? AND participant = ? AND since_seq < ?").all(me.repo, me.id, m.seq) as Row[];
      const rel = mine.map((r) => String(r.path)).find((x) => fold(x) === about || fold(x).endsWith(`/${about}`));
      if (!rel) return null;
      const theirs = db.prepare("SELECT 1 FROM claims WHERE repo = ? AND path = ? AND participant = ? AND since_seq < ?").get(me.repo, rel, author, m.seq);
      return theirs ? null : rel;
    },

    holderNames(repo, about) {
      const f = fold(relPath(repo, about) ?? slashes(about));
      if (!f) return [];
      const rows = db.prepare("SELECT participant, path FROM claims WHERE repo = ?").all(repo) as Row[];
      return [...new Set(rows
        .filter((r) => { const x = fold(String(r.path)); return x === f || x.endsWith(`/${f}`); })
        .map((r) => Number(r.participant)).filter(isLive).map((id) => participantById(id).name))];
    },

    holdsAny(p) {
      return db.prepare("SELECT 1 FROM merge_locks WHERE participant = ? UNION ALL SELECT 1 FROM claims WHERE participant = ? LIMIT 1").get(p.id, p.id) !== undefined;
    },

    setHoldings(me, files) {
      return transaction(() => {
        const now = new Set(files.map((f) => relPath(me.repo, f) ?? slashes(f)));
        const held = (db.prepare("SELECT path FROM claims WHERE repo = ? AND participant = ?").all(me.repo, me.id) as Row[]).map((r) => String(r.path));
        const left = held.filter((x) => !now.has(x));
        for (const x of left) db.prepare("DELETE FROM claims WHERE repo = ? AND path = ? AND participant = ?").run(me.repo, x, me.id);
        const fresh = [...now].filter((x) => !held.includes(x));
        for (const x of fresh) db.prepare("INSERT INTO claims (repo, path, participant, since_seq) VALUES (?, ?, ?, ?)").run(me.repo, x, me.id, lastSeq());
        if (left.length + fresh.length) bump(me.repo);
        // once per path and pair (flag_posts), a path that left the changes and came back included; posted to the member
        // whose change came second, who settles it: the holder hears through the agreement (its parties, and a path it holds)
        const posted = db.prepare("INSERT OR IGNORE INTO flag_posts (repo, path, participant, holder) VALUES (?, ?, ?, ?)");
        const overlaps: Flag[] = [];
        for (const rel of fresh)
          for (const holder of holdersOf(me.repo, rel).filter((id) => id !== me.id)) {
            const other = participantById(holder);
            if (agreedOn(me, other, rel) || Number(posted.run(me.repo, rel, me.id, other.id).changes) === 0) continue;
            const m = insertMessage(me, `@${me.name} overlap: ${me.name} changes ${rel}, which ${other.name} changes too. Settle it here.`, rel, "event", [me.name], {
              event: CODE_EVENTS.flag.name,
              meta: { holder: other.name, writer: me.name },
            });
            overlaps.push({ path: rel, holder: other.name, seq: m.seq });
          }
        return overlaps;
      });
    },

    lockMerge(me, onto, reflogMark, files) {
      return transaction(() => {
        const r = db.prepare("SELECT participant FROM merge_locks WHERE repo = ?").get(me.repo) as Row | undefined;
        if (r && Number(r.participant) !== me.id && isLive(Number(r.participant))) {
          db.prepare("INSERT OR IGNORE INTO lock_waiters (repo, participant) VALUES (?, ?)").run(me.repo, me.id);
          // the turn opens at the first ask and counts each refusal; a turn granted once and lost since is over
          const turn = openTurn(me);
          if (turn && turn.granted_at == null) db.prepare("UPDATE lock_requests SET refused = refused + 1 WHERE rowid = ?").run(Number(turn.id));
          else db.prepare("INSERT INTO lock_requests (repo, participant, asked_at, refused) VALUES (?, ?, ?, 1)").run(me.repo, me.id, now());
          const holder = participantById(Number(r.participant)).name;
          trace().event("lock", { action: "refused", run: me.run, member: me.name, holder, waiting: lockQueue(me.repo) });
          return { granted: false as const, holder };
        }
        if (r && Number(r.participant) === me.id) {
          if (onto) db.prepare("UPDATE merge_locks SET onto = ? WHERE repo = ?").run(onto, me.repo);
          // asked again (after a conflict, mid-rebase): what git shows now is added, never taken for the whole
          if (files) {
            const kept = (db.prepare("SELECT files FROM merge_locks WHERE repo = ?").get(me.repo) as Row).files;
            db.prepare("UPDATE merge_locks SET files = ? WHERE repo = ?").run(JSON.stringify([...new Set([...(kept == null ? [] : (JSON.parse(String(kept)) as string[])), ...files])]), me.repo);
          }
          // a lock granted before the records began has no turn yet: it gets one, at the grant
          grantTurn(me, String((db.prepare("SELECT at FROM merge_locks WHERE repo = ?").get(me.repo) as Row).at), false);
          return { granted: true as const };
        }
        // a new holder: the waiters on the one before are not this one's (D65)
        db.prepare("DELETE FROM lock_waiters WHERE repo = ?").run(me.repo);
        // the mark is the grant's: a holder asking again keeps it, as it keeps the grant's time (D36)
        const at = now();
        db.prepare("INSERT OR REPLACE INTO merge_locks (repo, participant, at, onto, reflog_mark, files) VALUES (?, ?, ?, ?, ?, ?)").run(me.repo, me.id, at, onto ?? null, reflogMark ?? null, files ? JSON.stringify(files) : null);
        grantTurn(me, at, true);
        bump(me.repo);
        const asked = db.prepare("SELECT asked_at FROM lock_requests WHERE participant = ? ORDER BY rowid DESC LIMIT 1").get(me.id) as Row | undefined;
        trace().event("lock", { action: "granted", run: me.run, member: me.name, waitedMs: asked ? Date.parse(at) - Date.parse(String(asked.asked_at)) : 0, waiting: lockQueue(me.repo) });
        return { granted: true as const };
      });
    },

    mergeLockQueuedBehind(me) {
      if (db.prepare("SELECT 1 FROM lock_waiters WHERE repo = ? AND participant = ?").get(me.repo, me.id) === undefined) return null;
      const lock = db.prepare("SELECT participant FROM merge_locks WHERE repo = ?").get(me.repo) as Row | undefined;
      return lock && Number(lock.participant) !== me.id ? participantById(Number(lock.participant)).name : null;
    },

    heldMergeLock(me) {
      const r = db.prepare("SELECT at, onto, reflog_mark, files FROM merge_locks WHERE repo = ? AND participant = ?").get(me.repo, me.id) as Row | undefined;
      return r
        ? {
            grantedAt: String(r.at),
            onto: r.onto == null ? null : String(r.onto),
            reflogMark: r.reflog_mark == null ? null : Number(r.reflog_mark),
            files: r.files == null ? null : (JSON.parse(String(r.files)) as string[]),
          }
        : null;
    },

    merged(me, sha, files, conflicts) {
      const rels = [...new Set(files.map((f) => relPath(me.repo, f)).filter((x): x is string => x !== null))];
      // known: the conflicted paths, as the claims key them; null: unknown, every shared path told as before (D5)
      const conflicted = conflicts && "files" in conflicts ? new Set(conflicts.files.map((f) => fold(slashes(f)))) : null;
      const wanted = new Set(rels);
      const told = new Set<string>();
      const sharers: Sharer[] = [];
      let waiters: string[] = [];
      let onto: string | null = null;
      // one transaction: the page sees the merge as one change
      transaction(() => {
        transaction(() => {
          const lock = db.prepare("SELECT participant, onto FROM merge_locks WHERE repo = ?").get(me.repo) as Row | undefined;
          if (lock && Number(lock.participant) !== me.id && isLive(Number(lock.participant))) {
            throw new Error(`the merge lock is held by ${participantById(Number(lock.participant)).name}, not ${me.name}`);
          }
          if (lock && Number(lock.participant) === me.id && lock.onto != null) onto = String(lock.onto);
          if (lock && Number(lock.participant) === me.id) traceRelease(me, "merged");
          db.prepare("DELETE FROM merge_locks WHERE repo = ?").run(me.repo);
          // board-split D33 (S35): the merge is the member's latest fact, shown over an older doing
          db.prepare("UPDATE participants SET merged = 1, doing = ? WHERE id = ?").run(`merged ${sha.slice(0, 7)}`, me.id);
          // the holder's lock turn ends with the merge (D25)
          const turn = openTurn(me);
          if (turn) db.prepare("UPDATE lock_requests SET merged_at = ? WHERE rowid = ?").run(now(), Number(turn.id));
          waiters = takeLockWaiters(me.repo).filter((n) => n !== me.name);
        });
        // every holder of a merged path, a shared one included (D40)
        for (const rel of rels) {
          for (const holder of holdersOf(me.repo, rel)) if (holder !== me.id) told.add(participantById(holder).name);
        }
        // declarers
        const everyone = db
          .prepare("SELECT p.id, p.seat, r.plan FROM participants p JOIN runs r ON r.id = p.run WHERE r.repo = ? AND r.state = 'open' AND p.ended_at IS NULL")
          .all(me.repo) as Row[];
        for (const o of everyone) {
          for (const f of declared(Number(o.id))) {
            const rel = relPath(me.repo, f.path);
            if (!rel || !wanted.has(rel)) continue;
            if (Number(o.id) !== me.id) told.add(`${o.plan}/${o.seat}`);
          }
        }
        // D7: the other party of an agreement about a merged file hears of the merge, claim or not
        const agreed = new Set<string>();
        const foldedWanted = new Set(rels.map(fold));
        // S25: a live member by name, with the seq it joined at: an agreement made before it joined was another member's
        // of the same name (a seat's earlier run), never its own
        const joinedAt = new Map((db.prepare("SELECT p.since_seq, p.seat, r.plan FROM participants p JOIN runs r ON r.id = p.run WHERE r.repo = ? AND r.state = 'open' AND p.ended_at IS NULL").all(me.repo) as Row[]).map((o) => [`${o.plan}/${o.seat}`, Number(o.since_seq)]));
        for (const a of db.prepare("SELECT seq, author, about, mentions FROM messages WHERE repo = ? AND kind = 'agreement' AND about IS NOT NULL").all(me.repo) as Row[]) {
          if (!foldedWanted.has(fold(slashes(String(a.about))))) continue;
          const parties = [participantById(Number(a.author)).name, ...(JSON.parse(String(a.mentions)) as string[])];
          for (const n of parties) if (n !== me.name && (joinedAt.get(n) ?? Infinity) < Number(a.seq) && !told.has(n)) agreed.add(n);
        }
        // nobody has to rebase for it: a member's own delivery rebases its branch
        const lines = [`merged ${sha}${onto ? ` into ${onto}` : ""}: your delivery brings it in; rebase now only if you need it.`];
        if (told.size) lines.push(`${[...told].map((n) => `@${n}`).join(" ")}: you hold or declared a file it changed.`);
        if (agreed.size) lines.push(`${[...agreed].map((n) => `@${n}`).join(" ")}: you agreed on a file it changed.`);
        if (waiters.length) lines.push(`the merge lock is free: ${waiters.map((n) => `@${n}`).join(" ")}`);
        lines.push(`files: ${rels.join(", ") || "-"}`);
        // whom to tell of a resolved conflict (D63): who changes the path now, from any run, and who of this run merged it
        // since `me`'s branch last met the target (its last merge, else its join); once the conflicts are known, of a
        // conflicted path only (D5)
        const metTarget = Number(
          (db.prepare("SELECT COALESCE((SELECT MAX(seq) FROM messages WHERE run = ? AND author = ? AND event = ?), (SELECT since_seq FROM participants WHERE id = ?), 0) AS seq").get(me.run, me.id, CODE_EVENTS.merged.name, me.id) as Row).seq,
        );
        const mergedSince = (db.prepare("SELECT author, meta FROM messages WHERE run = ? AND event = ? AND seq > ? AND author != ? ORDER BY seq").all(me.run, CODE_EVENTS.merged.name, metTarget, me.id) as Row[]).map((r) => ({
          author: Number(r.author),
          files: new Set((JSON.parse(String(r.meta ?? "{}")) as Partial<MergedMeta>).files ?? []),
        }));
        for (const rel of rels) {
          if (conflicted && !conflicted.has(fold(rel))) continue;
          const ids = new Set(holdersOf(me.repo, rel));
          for (const m of mergedSince) if (m.files.has(rel)) ids.add(m.author);
          ids.delete(me.id);
          for (const id of ids) sharers.push({ path: rel, member: participantById(id).name });
        }
        const meta: MergedMeta = { rebase: [...told], tell: [...new Set(sharers.map((o) => o.member))], ...(waiters.length ? { free: waiters } : {}), files: rels };
        const mentioned = [...new Set([...told, ...agreed, ...waiters])];
        insertMessage(me, lines.join("\n"), null, "event", mentioned, { event: CODE_EVENTS.merged.name, meta });
        // what merged is no longer a change of its worktree; its link's next look says the same
        for (const rel of rels) db.prepare("DELETE FROM claims WHERE repo = ? AND path = ? AND participant = ?").run(me.repo, rel, me.id);
      });
      return sharers;
    },

    seatWorktrees(run) {
      const rows = db
        .prepare(`SELECT p.run, r.plan, p.seat, p.place, r.repo, r.base, r.state FROM participants p JOIN runs r ON r.id = p.run WHERE p.place IS NOT NULL${run === undefined ? "" : " AND p.run = ?"} ORDER BY p.id`)
        .all(...(run === undefined ? [] : [run])) as Row[];
      return rows.map((r) => ({ run: Number(r.run), member: `${r.plan}/${r.seat}`, worktree: String(r.place), repo: String(r.repo), base: r.base == null ? null : String(r.base), open: r.state === "open" }));
    },
  };
}
