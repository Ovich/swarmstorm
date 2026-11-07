// Claims and the merge lock (D35): the code pack's tables (board-split#D20), opened by the board through the
// registry, the second module that sees SQL. The Board's verbs of the same names delegate here after the
// member's pack gate; behaviour and wording are the board's, moved, not rewritten.
import type { DatabaseSync } from "node:sqlite";
import type { Conflicts, Declared, Message, MessageKind, Participant, RunId, Sharer } from "../../board/board.ts";
import type { DriftedFile, Flag, MemberWorktree, MergedMeta } from "./types.ts";
import type { EventName } from "../../board/events.ts";
import type { PackMessageMeta } from "../registry.ts";
import { CODE_EVENTS } from "./events.ts";
import { trace } from "../../board/trace.ts";
import { CODE_WORDING } from "../../cli/answer/code-wording.ts";

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
  /** spec §7, claims-phase: `files` is `p`'s worktree's changed set as its link read it: a new path is held, active, until
   *  the phase ends (a path leaving the set keeps its claim); a merged path changed again after it left the set is active
   *  again. Each new active path another member actively holds is posted once to both, unless they agreed on it.
   *  `drifted`: paths of `files` its target changed past its branch; one merged this phase by another member is told
   *  to `p` once per path and phase, to rebase. */
  setHoldings(p: Participant, files: string[], drifted: DriftedFile[]): Flag[];
  /** `onto`: the branch the merge lands in, recorded with the lock for the merged event (D9). */
  lockMerge(p: Participant, onto?: string, reflogMark?: number, guides?: string[]): { granted: true } | { granted: false; holder: string };
  /** board-split V-26: the holder of the merge lock `p` was refused and still waits on; null when it waits on none. */
  mergeLockQueuedBehind(p: Participant): string | null;
  /** The merge lock `p` holds: when it was granted and the branch it lands in (D33); null when `p` holds none. */
  heldMergeLock(p: Participant): HeldMergeLock | null;
  /** `conflicts` absent: unknown. Known conflicts narrow the sharers to the conflicted paths (D5, D25). */
  merged(p: Participant, sha: string, files: string[], conflicts?: Conflicts): Sharer[];
  /** At a join or re-join: its record of merging starts fresh (D66). */
  seated(p: Participant): void;
  /** `p` called `merged` since it joined (D66). */
  mergedSinceJoin(participant: number): boolean;
  /** closeRun: every claim, the merge lock and the claim requests of `participant` go. */
  releaseAll(participant: number): void;
  /** At `p`'s end: the merge lock it holds and its claim requests go; its claims stay, read as ended, until the phase ends. */
  releaseLockOf(participant: number): void;
  /** claims-phase: a phase of `run` opens: every claim of its members goes, with its flags, overlap posts and drift notices;
   *  their links claim again from their worktrees' changes. */
  phaseOpened(run: RunId): void;
  clearFlags(): void;
  /** board-fixes#D8: `author` agreed with `parties` (names) about `about`: their flags and notices on its paths go. */
  settleOverlaps(author: Participant, parties: string[], about: string): void;
  /** board-split D59: `p` went lost holding the merge lock: the lock is released at once and the live members refused
   *  it are returned (cleared), as at a release; null when `p` held none. */
  releaseLockOfLost(p: Participant): { waiters: string[] } | null;
  /** At `p`'s end: when `p` holds the merge lock, the members refused it, cleared (D65); else none. */
  lockWaitersFreedBy(p: Participant): string[];
  /** The path `m` asks `me` about, when `me` held it before `m` and its author did not (D62). */
  askedAbout(me: Participant, author: number, m: Message): string | null;
  /** `p` holds the merge lock, or an active claim on a path still in its changes: mid-work, never idle. */
  holdsAny(p: Participant): boolean;
  /** The active holders of `about` (a path, or its tail), as `<plan>/<seat>`. */
  holderNames(repo: string, about: string): string[];
  /** Every worktree a member joined from, of `run` or of every run, closed ones included. */
  seatWorktrees(run?: RunId): MemberWorktree[];
}

/** `grantedAt` ISO; `onto` null for a lock taken without a branch; `reflogMark` the holder's HEAD reflog
 *  length at the grant, null when none was given (D36). */
export type HeldMergeLock = { grantedAt: string; onto: string | null; reflogMark: number | null; guides: string[] };

type Row = Record<string, unknown>;

export function claimsOf(deps: ClaimsDeps): Claims {
  const { db, transaction, bump, now, lastSeq, participantById, isLive, insertMessage, relPath, fold, slashes, kindHasPack } = deps;

  /** claims-phase: a claim `c` (the alias) its holder still works on: active, its member not ended. */
  const ACTIVE = "c.state = 'active' AND EXISTS (SELECT 1 FROM participants q WHERE q.id = c.participant AND q.ended_at IS NULL)";
  /** A flag lives while an active claim on its path does; a notice while both its holders' active claims do. */
  const clearFlags = (): void => {
    db.prepare(`DELETE FROM flags WHERE NOT EXISTS (SELECT 1 FROM claims c WHERE c.repo = flags.repo AND c.path = flags.path AND ${ACTIVE})`).run();
    db.prepare(
      `DELETE FROM notices WHERE NOT EXISTS (SELECT 1 FROM claims c WHERE c.repo = notices.repo AND c.path = notices.path AND c.participant = notices.participant AND ${ACTIVE})
         OR NOT EXISTS (SELECT 1 FROM claims c WHERE c.repo = notices.repo AND c.path = notices.path AND c.participant = notices.other AND ${ACTIVE})`,
    ).run();
  };

  /** Every active, live holder of `rel` by id, in claim order: of the path itself, or of a directory it is under (G42). */
  const activeHoldersOf = (repo: string, rel: string): number[] =>
    (db.prepare("SELECT participant FROM claims WHERE repo = ? AND state = 'active' AND (path = ? OR substr(?, 1, length(path) + 1) = path || '/') ORDER BY rowid").all(repo, rel, rel) as Row[])
      .map((r) => Number(r.participant))
      .filter(isLive);
  /** `p`'s worktree changes `rel`: held, active. True when the claim is new, or a merged one made active again because
   *  the path had left the changes since the merge (a frame read before the merge and sent after never reopens it).
   *  A claim made active again keeps its last merge's sha (v1-5): it was merged this phase, and drift still finds it. */
  const hold = (p: Participant, rel: string): boolean =>
    transaction(() => {
      const made = db
        .prepare(`INSERT INTO claims (repo, path, participant, since_seq) VALUES (?, ?, ?, ?) ON CONFLICT (repo, path, participant) DO NOTHING`)
        .run(p.repo, rel, p.id, lastSeq());
      const reopened =
        Number(made.changes) === 0 &&
        Number(
          db
            .prepare("UPDATE claims SET state = 'active', since_seq = ? WHERE repo = ? AND path = ? AND participant = ? AND state = 'merged' AND in_changes = 0")
            .run(lastSeq(), p.repo, rel, p.id).changes,
        ) > 0;
      db.prepare("UPDATE claims SET in_changes = 1 WHERE repo = ? AND path = ? AND participant = ? AND in_changes = 0").run(p.repo, rel, p.id);
      if (Number(made.changes) === 0 && !reopened) return false;
      bump(p.repo);
      return true;
    });
  const markToldOfDrift = (repo: string, rel: string, id: number): boolean => Number(db.prepare("INSERT OR IGNORE INTO drift_notices (repo, path, participant) VALUES (?, ?, ?)").run(repo, rel, id).changes) > 0;
  /** claims-phase: `p`'s branch lacks the target's change to `rel`; when another member merged `rel` this phase, `p` is
   *  told once per path and phase to rebase. The merger is not told, nor a member the merge's event mentioned (v1-6). */
  const tellDrift = (p: Participant, rel: string, drifted: DriftedFile): void => {
    // a claim merged this phase carries its merge's sha, active again or not (v1-5)
    const merges = db
      .prepare("SELECT participant, sha FROM claims WHERE repo = ? AND path = ? AND sha IS NOT NULL AND participant != ? ORDER BY rowid DESC")
      .all(p.repo, rel, p.id) as Row[];
    if (!merges.length) return;
    // the merge whose commit is the target's last change to the path, else the latest claim merged
    const merge = merges.find((m) => String(m.sha) === drifted.sha) ?? merges[0];
    if (!markToldOfDrift(p.repo, rel, p.id)) return;
    const sha = String(merge.sha);
    insertMessage(p, CODE_WORDING.driftNotice(p.name, rel, participantById(Number(merge.participant)).name, sha), rel, "event", [p.name], {
      event: CODE_EVENTS.drift.name,
      meta: { sha },
    });
  };
  /** An agreement about `rel` between `a` and `b`, made by either and naming the other. */
  const agreedOn = (a: Participant, b: Participant, rel: string): boolean =>
    (db.prepare("SELECT author, about, mentions FROM messages WHERE repo = ? AND kind = 'agreement' AND author IN (?, ?)").all(a.repo, a.id, b.id) as Row[]).some((r) => {
      const about = r.about == null ? "" : fold(slashes(String(r.about)));
      const other = Number(r.author) === a.id ? b : a;
      return about !== "" && (fold(rel) === about || fold(rel).endsWith(`/${about}`)) && (JSON.parse(String(r.mentions)) as string[]).includes(other.name);
    });
  /** `id`'s merge lock and claim requests go; its flags and notices too, and the page is told, only when something it
   *  held changed (`changedBefore`: rows its caller already removed). */
  /** The trace: members queued on the lock, and a release with how long it was held. */
  const lockQueue = (repo: string): number => Number((db.prepare("SELECT COUNT(*) AS n FROM lock_waiters WHERE repo = ?").get(repo) as Row).n);
  const traceRelease = (p: Participant, cause: string): void => {
    const l = db.prepare("SELECT at FROM merge_locks WHERE participant = ?").get(p.id) as Row | undefined;
    trace().event("lock", { action: "released", run: p.run, member: p.name, cause, heldMs: l ? Date.now() - Date.parse(String(l.at)) : null, waiting: lockQueue(p.repo) });
  };
  const releaseLockOf = (id: number, changedBefore = 0): void => {
    if (db.prepare("SELECT 1 FROM merge_locks WHERE participant = ?").get(id)) traceRelease(participantById(id), "ended");
    const owner = db.prepare("SELECT r.repo FROM participants p JOIN runs r ON r.id = p.run WHERE p.id = ?").get(id) as Row | undefined;
    const locks = Number(db.prepare("DELETE FROM merge_locks WHERE participant = ?").run(id).changes);
    db.prepare("DELETE FROM claim_requests WHERE participant = ?").run(id);
    // at an end its active claims read as ended from now on
    const active = Number((db.prepare("SELECT COUNT(*) AS n FROM claims WHERE participant = ? AND state = 'active'").get(id) as Row).n);
    if (changedBefore + locks + active === 0) return;
    clearFlags();
    if (owner) bump(String(owner.repo));
  };
  const releaseAll = (id: number): void => {
    const claims = Number(db.prepare("DELETE FROM claims WHERE participant = ?").run(id).changes);
    db.prepare("DELETE FROM drift_notices WHERE participant = ?").run(id);
    releaseLockOf(id, claims);
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

  /** The live members of `repo` named `names` (`<group>/<seat>`), by id. */
  const liveIdsNamed = (repo: string, names: string[]): number[] =>
    (db.prepare("SELECT p.id, p.seat, r.plan FROM participants p JOIN runs r ON r.id = p.run WHERE r.repo = ? AND p.ended_at IS NULL").all(repo) as Row[])
      .filter((r) => names.includes(`${r.plan}/${r.seat}`))
      .map((r) => Number(r.id));

  return {
    clearFlags,
    releaseAll,
    releaseLockOf,

    phaseOpened(run) {
      const owner = db.prepare("SELECT repo FROM runs WHERE id = ?").get(run) as Row | undefined;
      let dropped = 0;
      for (const table of ["claims", "drift_notices", "flag_posts"])
        dropped += Number(db.prepare(`DELETE FROM ${table} WHERE participant IN (SELECT id FROM participants WHERE run = ?)`).run(run).changes);
      clearFlags();
      if (owner && dropped > 0) bump(String(owner.repo));
    },

    settleOverlaps(author, parties, about) {
      const want = fold(relPath(author.repo, about) ?? slashes(about));
      if (!want) return;
      const pair = new Set([author.id, ...liveIdsNamed(author.repo, parties)]);
      if (pair.size < 2) return;
      const onPath = (x: string): boolean => fold(x) === want || fold(x).endsWith(`/${want}`);
      let cleared = 0;
      for (const r of db.prepare("SELECT path, participant FROM flags WHERE repo = ?").all(author.repo) as Row[]) {
        if (!onPath(String(r.path)) || !pair.has(Number(r.participant))) continue;
        cleared += Number(db.prepare("DELETE FROM flags WHERE repo = ? AND path = ? AND participant = ?").run(author.repo, String(r.path), Number(r.participant)).changes);
      }
      for (const r of db.prepare("SELECT path, participant, other FROM notices WHERE repo = ?").all(author.repo) as Row[]) {
        if (!onPath(String(r.path)) || !pair.has(Number(r.participant)) || !pair.has(Number(r.other))) continue;
        cleared += Number(db.prepare("DELETE FROM notices WHERE repo = ? AND path = ? AND participant = ? AND other = ?").run(author.repo, String(r.path), Number(r.participant), Number(r.other)).changes);
      }
      if (cleared) bump(author.repo);
    },

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
      const rows = db.prepare("SELECT participant, path FROM claims WHERE repo = ? AND state = 'active'").all(repo) as Row[];
      return [...new Set(rows
        .filter((r) => { const x = fold(String(r.path)); return x === f || x.endsWith(`/${f}`); })
        .map((r) => Number(r.participant)).filter(isLive).map((id) => participantById(id).name))];
    },

    holdsAny(p) {
      return (
        db.prepare("SELECT 1 FROM merge_locks WHERE participant = ? UNION ALL SELECT 1 FROM claims WHERE participant = ? AND state = 'active' AND in_changes = 1 LIMIT 1").get(p.id, p.id) !==
        undefined
      );
    },

    setHoldings(me, files, drifted) {
      return transaction(() => {
        const relOf = (f: string): string => relPath(me.repo, f) ?? slashes(f);
        const now = new Set(files.map(relOf));
        // a path out of the changes keeps its claim (claims-phase): only its in_changes falls
        const inChanges = (db.prepare("SELECT path FROM claims WHERE repo = ? AND participant = ? AND in_changes = 1").all(me.repo, me.id) as Row[]).map((r) => String(r.path));
        const left = inChanges.filter((x) => !now.has(x));
        for (const x of left) db.prepare("UPDATE claims SET in_changes = 0 WHERE repo = ? AND path = ? AND participant = ?").run(me.repo, x, me.id);
        if (left.length) bump(me.repo);
        const fresh = [...now].filter((x) => hold(me, x));
        // once per path and pair (flag_posts); the post mentions the other holder, then the member (the flag's order, D10)
        const posted = db.prepare("INSERT OR IGNORE INTO flag_posts (repo, path, participant, holder) VALUES (?, ?, ?, ?)");
        const overlaps: Flag[] = [];
        for (const rel of fresh)
          for (const holder of activeHoldersOf(me.repo, rel).filter((id) => id !== me.id)) {
            const other = participantById(holder);
            if (agreedOn(me, other, rel) || Number(posted.run(me.repo, rel, me.id, other.id).changes) === 0) continue;
            const m = insertMessage(me, `@${other.name} @${me.name} overlap: ${me.name} changes ${rel}, which ${other.name} changes too. Settle it here.`, rel, "event", [other.name, me.name], {
              event: CODE_EVENTS.flag.name,
            });
            overlaps.push({ path: rel, holder: other.name, seq: m.seq });
          }
        for (const d of drifted) {
          const rel = relOf(d.path);
          if (now.has(rel)) tellDrift(me, rel, d);
        }
        return overlaps;
      });
    },

    lockMerge(me, onto, reflogMark, guides) {
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
          if (guides) db.prepare("UPDATE merge_locks SET guides = ? WHERE repo = ?").run(JSON.stringify(guides), me.repo);
          // a lock granted before the records began has no turn yet: it gets one, at the grant
          grantTurn(me, String((db.prepare("SELECT at FROM merge_locks WHERE repo = ?").get(me.repo) as Row).at), false);
          return { granted: true as const };
        }
        // a new holder: the waiters on the one before are not this one's (D65)
        db.prepare("DELETE FROM lock_waiters WHERE repo = ?").run(me.repo);
        // the mark is the grant's: a holder asking again keeps it, as it keeps the grant's time (D36)
        const at = now();
        db.prepare("INSERT OR REPLACE INTO merge_locks (repo, participant, at, onto, reflog_mark, guides) VALUES (?, ?, ?, ?, ?, ?)").run(me.repo, me.id, at, onto ?? null, reflogMark ?? null, guides ? JSON.stringify(guides) : null);
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
      const r = db.prepare("SELECT at, onto, reflog_mark, guides FROM merge_locks WHERE repo = ? AND participant = ?").get(me.repo, me.id) as Row | undefined;
      return r
        ? { grantedAt: String(r.at), onto: r.onto == null ? null : String(r.onto), reflogMark: r.reflog_mark == null ? null : Number(r.reflog_mark), guides: r.guides == null ? [] : (JSON.parse(String(r.guides)) as string[]) }
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
        // every active holder of a merged path, a shared one included (D40)
        for (const rel of rels) {
          for (const holder of activeHoldersOf(me.repo, rel)) if (holder !== me.id) told.add(participantById(holder).name);
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
        const lines = [`merged ${sha}${onto ? ` into ${onto}` : ""}: rebase your branch onto it.`];
        if (told.size) lines.push(`${[...told].map((n) => `@${n}`).join(" ")}: you hold or declared a file it changed.`);
        if (agreed.size) lines.push(`${[...agreed].map((n) => `@${n}`).join(" ")}: you agreed on a file it changed.`);
        if (waiters.length) lines.push(`the merge lock is free: ${waiters.map((n) => `@${n}`).join(" ")}`);
        lines.push(`files: ${rels.join(", ") || "-"}`);
        // whom to tell of a resolved conflict (D63): an active holder from any run, or one of this run that held it this
        // phase; once the conflicts are known, of a conflicted path only (D5)
        for (const rel of rels) {
          if (conflicted && !conflicted.has(fold(rel))) continue;
          const ids = new Set(activeHoldersOf(me.repo, rel));
          const held = db
            .prepare("SELECT c.participant FROM claims c JOIN participants p ON p.id = c.participant WHERE c.repo = ? AND c.path = ? AND p.run = ? ORDER BY c.rowid")
            .all(me.repo, rel, me.run) as Row[];
          for (const r of held) ids.add(Number(r.participant));
          ids.delete(me.id);
          for (const id of ids) sharers.push({ path: rel, member: participantById(id).name });
        }
        const meta: MergedMeta = { rebase: [...told], tell: [...new Set(sharers.map((o) => o.member))], ...(waiters.length ? { free: waiters } : {}) };
        const mentioned = [...new Set([...told, ...agreed, ...waiters])];
        insertMessage(me, lines.join("\n"), null, "event", mentioned, { event: CODE_EVENTS.merged.name, meta });
        // v1-6: a member this merge's event mentioned was told to rebase: no drift notice for its files this phase
        for (const id of liveIdsNamed(me.repo, mentioned)) for (const rel of rels) markToldOfDrift(me.repo, rel, id);
        // claims-phase: the merger's claims on the merged files are merged, with the sha, kept until the phase ends;
        // a merged file it never claimed is claimed so, for the drift notice, out of its changes: a later edit makes it
        // active again (v1-4)
        const markMerged = db.prepare(
          `INSERT INTO claims (repo, path, participant, since_seq, state, sha, in_changes) VALUES (?, ?, ?, ?, 'merged', ?, 0)
             ON CONFLICT (repo, path, participant) DO UPDATE SET state = 'merged', sha = excluded.sha`,
        );
        for (const rel of rels) markMerged.run(me.repo, rel, me.id, lastSeq(), sha);
        clearFlags();
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
