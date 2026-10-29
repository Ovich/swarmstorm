// Claims and the merge lock (D35): internal to the board, imported by board.ts only. The
// second module that sees SQL. The Board's verbs of the same names delegate here after the
// kind gate; behaviour and wording are the board's, moved, not rewritten.
import type { DatabaseSync } from "node:sqlite";
import type { Conflicts, Declared, EditAllowed, MergedMeta, EditHeld, Flag, Message, MessageKind, Participant, Sharer } from "./board.ts";
import { type EventName, EVENTS } from "./events.ts";
import { profileOf } from "./kinds.ts";

export interface ClaimsDeps {
  db: DatabaseSync;
  transaction<T>(fn: () => T): T;
  bump(repo: string): void;
  now(): string;
  lastSeq(): number;
  participantById(id: number): Participant;
  isLive(id: number): boolean;
  insertMessage(p: Participant, body: string, about: string | null, kind: MessageKind, named?: string[], extra?: { event?: EventName; meta?: MergedMeta }): Message;
  relPath(repo: string, file: string): string | null;
  fold(s: string): string;
  slashes(rel: string): string;
  doingOf(id: number): string;
}

export interface Claims {
  checkEdit(p: Participant, file: string, opts?: { interface?: boolean }): EditAllowed | EditHeld;
  reconcileWrites(p: Participant, changed: string[]): Flag[];
  release(p: Participant, file: string): void;
  /** `onto`: the branch the merge lands in, recorded with the lock for the merged event (D9). */
  lockMerge(p: Participant, onto?: string, reflogMark?: number, guides?: string[]): { granted: true } | { granted: false; holder: string };
  /** After a refused claim, `m` (by `p`, about the path, mentioning every holder, in it or before it) makes `p` a sharer, as the second claim would (D7). */
  claimByPost(p: Participant, m: Message): PostClaim | null;
  /** The merge lock `p` holds: when it was granted and the branch it lands in (D33); null when `p` holds none. */
  heldMergeLock(p: Participant): HeldMergeLock | null;
  /** `conflicts` absent: unknown. Writes the merge's row; known conflicts narrow the sharers to the conflicted paths (D5, D25). */
  merged(p: Participant, sha: string, files: string[], conflicts?: Conflicts): Sharer[];
  /** join's declared files, claimed where free */
  claimDeclared(p: Participant, files: Declared[]): void;
  /** end, closeRun, seat done */
  releaseAll(participant: number): void;
  clearFlags(): void;
  /** At `p`'s end: when `p` holds the merge lock, the members refused it, cleared (D65); else none. */
  lockWaitersFreedBy(p: Participant): string[];
  /** The path `m` asks `me` about, when `me` held it before `m` and its author did not (D62). */
  askedAbout(me: Participant, author: number, m: Message): string | null;
  /** `rel` is held, or was held during the run, by a member of a run other than `p`'s. */
  heldInOtherRun(p: Participant, rel: string): boolean;
  /** `p` holds `about` (a path, or its tail) now. */
  holds(p: Participant, about: string): boolean;
  /** The live holders of `about` (a path, or its tail), as `<plan>/<seat>`. */
  holderNames(repo: string, about: string): string[];
}

/** What a post settled: the claimed path and its other holders' names. */
export type PostClaim = { path: string; sharedWith: string[] };
/** `grantedAt` ISO; `onto` null for a lock taken without a branch; `reflogMark` the holder's HEAD reflog
 *  length at the grant, null when none was given (D36). */
export type HeldMergeLock = { grantedAt: string; onto: string | null; reflogMark: number | null; guides: string[] };

type Row = Record<string, unknown>;
type ClaimRow = { participant: number; kind: string; since: number };

export function claimsOf(deps: ClaimsDeps): Claims {
  const { db, transaction, bump, now, lastSeq, participantById, isLive, insertMessage, relPath, fold, slashes, doingOf } = deps;

  /** A flag lives while a claim on its path does; a notice while both its holders' claims do. */
  const clearFlags = (): void => {
    db.prepare("DELETE FROM flags WHERE NOT EXISTS (SELECT 1 FROM claims c WHERE c.repo = flags.repo AND c.path = flags.path)").run();
    db.prepare(
      `DELETE FROM notices WHERE NOT EXISTS (SELECT 1 FROM claims c WHERE c.repo = notices.repo AND c.path = notices.path AND c.participant = notices.participant)
         OR NOT EXISTS (SELECT 1 FROM claims c WHERE c.repo = notices.repo AND c.path = notices.path AND c.participant = notices.other)`,
    ).run();
  };

  /** Every live holder of `rel`, in claim order: of the path itself, or of a directory it is under (G42). */
  const holdersOf = (repo: string, rel: string): ClaimRow[] =>
    (
      db
        .prepare("SELECT participant, kind, since_seq FROM claims WHERE repo = ? AND (path = ? OR substr(?, 1, length(path) + 1) = path || '/') ORDER BY rowid")
        .all(repo, rel, rel) as Row[]
    )
      .map((r) => ({ participant: Number(r.participant), kind: String(r.kind), since: Number(r.since_seq) }))
      .filter((c) => isLive(c.participant));
  /** `p` holds `rel` (alongside whoever else does); `interface` widens an inside claim, never the reverse.
   *  True when the claim was made or widened here. */
  const hold = (p: Participant, rel: string, kind: "interface" | "inside"): boolean =>
    transaction(() => {
      const r = db
        .prepare(
          `INSERT INTO claims (repo, path, participant, kind, since_seq) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (repo, path, participant) DO UPDATE SET kind = excluded.kind WHERE claims.kind = 'inside' AND excluded.kind = 'interface'`,
        )
        .run(p.repo, rel, p.id, kind, lastSeq());
      db.prepare(
        `INSERT INTO claim_log (repo, path, participant, kind) VALUES (?, ?, ?, ?)
         ON CONFLICT (repo, path, participant) DO UPDATE SET kind = 'interface' WHERE excluded.kind = 'interface'`,
      ).run(p.repo, rel, p.id, kind);
      if (Number(r.changes) === 0) return false;
      bump(p.repo);
      return true;
    });
  /** Claims `rel` for `p` unless another live member holds it: `held` is the other holders,
   *  `taken` says whether the claim was made or widened here. */
  const take = (p: Participant, rel: string, kind: "interface" | "inside"): { held: ClaimRow[]; taken: boolean } =>
    transaction(() => {
      const held = holdersOf(p.repo, rel).filter((c) => c.participant !== p.id);
      if (held.length) return { held, taken: false };
      return { held, taken: hold(p, rel, kind) };
    });
  /** Whether `p` has posted about `rel` mentioning every one of `holders` since that holder claimed it (D41),
   *  in one post or several: the message's `about` is the path (or its tail), or its body names the path or its file name. */
  const hasPostedAbout = (p: Participant, rel: string, holders: ClaimRow[]): boolean => {
    const since = Math.min(...holders.map((h) => h.since));
    const rows = db.prepare("SELECT seq, body, about, mentions FROM messages WHERE repo = ? AND author = ? AND seq > ? AND kind != 'event' AND by_board = 0").all(p.repo, p.id, since) as Row[];
    const base = rel.split("/").pop()!;
    const names = (r: Row): boolean => {
      const about = r.about == null ? "" : fold(slashes(String(r.about)));
      const f = fold(rel);
      if (about && (about === f || f.endsWith(`/${about}`))) return true;
      const body = fold(String(r.body));
      return body.includes(f) || body.includes(fold(base));
    };
    const told = rows.filter(names).map((r) => ({ seq: Number(r.seq), mentions: JSON.parse(String(r.mentions)) as string[] }));
    return holders.every((h) => {
      const o = participantById(h.participant);
      return told.some((r) => r.seq > h.since && (r.mentions.includes(o.name) || r.mentions.includes(`${o.plan}/*`)));
    });
  };
  /** `me` was granted `rel` beside each of `people`, live holders of it: kept for the run's figures (D39). */
  const recordShares = (me: Participant, rel: string, people: Participant[]): void => {
    const share = db.prepare("INSERT OR IGNORE INTO shares (repo, path, participant, other, seq) VALUES (?, ?, ?, ?, ?)");
    for (const o of people) share.run(me.repo, rel, me.id, o.id, lastSeq());
  };
  /** The other holders `me` is told of, once per member and path (D40). */
  const noticeOf = (me: Participant, rel: string, people: Participant[]): string | null => {
    const told = db.prepare("INSERT OR IGNORE INTO notices (repo, path, participant, other) VALUES (?, ?, ?, ?)");
    const fresh = people.filter((o) => Number(told.run(me.repo, rel, me.id, o.id).changes) > 0);
    return fresh.length ? fresh.map((o) => `${rel} is also held by ${o.name}: ${doingOf(o.id)}`).join("; ") : null;
  };
  const releaseAll = (id: number): void => {
    const owner = db.prepare("SELECT r.repo FROM participants p JOIN runs r ON r.id = p.run WHERE p.id = ?").get(id) as Row | undefined;
    const claims = Number(db.prepare("DELETE FROM claims WHERE participant = ?").run(id).changes);
    const locks = Number(db.prepare("DELETE FROM merge_locks WHERE participant = ?").run(id).changes);
    db.prepare("DELETE FROM claim_requests WHERE participant = ?").run(id);
    clearFlags();
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
    clearFlags,
    releaseAll,

    lockWaitersFreedBy(p) {
      const held = db.prepare("SELECT 1 FROM merge_locks WHERE repo = ? AND participant = ?").get(p.repo, p.id) !== undefined;
      return held ? takeLockWaiters(p.repo).filter((n) => n !== p.name) : [];
    },

    claimByPost(me, m) {
      if ((m.kind !== "msg" && m.kind !== "agreement") || !m.about) return null;
      const about = fold(relPath(me.repo, m.about) ?? slashes(m.about));
      return transaction((): PostClaim | null => {
        const asked = (db.prepare("SELECT path, kind FROM claim_requests WHERE repo = ? AND participant = ?").all(me.repo, me.id) as Row[]).find((r) => {
          const x = fold(String(r.path));
          return x === about || x.endsWith(`/${about}`);
        });
        if (!asked) return null;
        const rel = String(asked.path);
        const others = holdersOf(me.repo, rel).filter((c) => c.participant !== me.id);
        // the holder gone: the request stands for the next claim, which finds the path free
        if (!others.length || !hasPostedAbout(me, rel, others)) return null;
        hold(me, rel, String(asked.kind) === "interface" ? "interface" : "inside");
        db.prepare("DELETE FROM claim_requests WHERE repo = ? AND path = ? AND participant = ?").run(me.repo, rel, me.id);
        const people = others.map((c) => participantById(c.participant));
        recordShares(me, rel, people);
        return { path: rel, sharedWith: people.map((o) => o.name) };
      });
    },

    claimDeclared(p, files) {
      transaction(() => {
        for (const f of files) {
          const rel = relPath(p.repo, f.path);
          if (rel) take(p, rel, f.interface ? "interface" : "inside");
        }
      });
    },

    askedAbout(me, author, m) {
      const about = fold(relPath(me.repo, m.about!) ?? slashes(m.about!));
      const mine = db.prepare("SELECT path FROM claims WHERE repo = ? AND participant = ? AND since_seq < ?").all(me.repo, me.id, m.seq) as Row[];
      const rel = mine.map((r) => String(r.path)).find((x) => fold(x) === about || fold(x).endsWith(`/${about}`));
      if (!rel) return null;
      const theirs = db.prepare("SELECT 1 FROM claims WHERE repo = ? AND path = ? AND participant = ? AND since_seq < ?").get(me.repo, rel, author, m.seq);
      return theirs ? null : rel;
    },

    heldInOtherRun(p, rel) {
      const f = fold(rel);
      const rows = db
        .prepare("SELECT l.path FROM claim_log l JOIN participants q ON q.id = l.participant WHERE l.repo = ? AND q.run != ?")
        .all(p.repo, p.run) as Row[];
      return rows.some((r) => {
        const x = fold(String(r.path));
        return x === f || x.endsWith(`/${f}`);
      });
    },

    holderNames(repo, about) {
      const f = fold(relPath(repo, about) ?? slashes(about));
      if (!f) return [];
      const rows = db.prepare("SELECT participant, path FROM claims WHERE repo = ?").all(repo) as Row[];
      return [...new Set(rows
        .filter((r) => { const x = fold(String(r.path)); return x === f || x.endsWith(`/${f}`); })
        .map((r) => Number(r.participant)).filter(isLive).map((id) => participantById(id).name))];
    },

    holds(p, about) {
      const f = fold(relPath(p.repo, about) ?? slashes(about));
      if (!f) return false;
      const rows = db.prepare("SELECT path FROM claims WHERE repo = ? AND participant = ?").all(p.repo, p.id) as Row[];
      return rows.some((r) => {
        const x = fold(String(r.path));
        return x === f || x.endsWith(`/${f}`);
      });
    },

    checkEdit(me, file, opts = {}) {
      const kind = opts.interface ? "interface" : "inside";
      const rel = relPath(me.repo, file);
      if (!rel) return { allowed: true, sharedWith: [], notice: null }; // outside the repository: no claim
      return transaction((): EditAllowed | EditHeld => {
        const all = holdersOf(me.repo, rel);
        const others = all.filter((c) => c.participant !== me.id);
        if (!others.length) {
          hold(me, rel, kind); // a free file: claimed, silently
          return { allowed: true, sharedWith: [], notice: null };
        }
        const people = others.map((c) => participantById(c.participant));
        if (!all.some((c) => c.participant === me.id)) {
          // the first edit of a file another member holds: held until the member has said what it changes (D41)
          if (!hasPostedAbout(me, rel, others)) {
            // the refused request: a post that settles it claims it (D7)
            db.prepare(
              `INSERT INTO claim_requests (repo, path, participant, kind) VALUES (?, ?, ?, ?)
               ON CONFLICT (repo, path, participant) DO UPDATE SET kind = CASE WHEN claim_requests.kind = 'interface' THEN 'interface' ELSE excluded.kind END`,
            ).run(me.repo, rel, me.id, kind);
            const who = people.map((o) => `${o.name} (${o.nick}: ${doingOf(o.id)})`).join(", ");
            const at = people.map((o) => `@${o.name}`).join(" ");
            return {
              allowed: false,
              refusal:
                `${rel} is also held by ${who}. You may share it, but first tell ${people.length > 1 ? "them" : "its holder"} what you change in it: ` +
                `\`swarm post "${at} …" --about ${rel}\`; ${people.length > 1 ? "they answer" : "its holder answers"} with an agreement on who changes what ` +
                `(\`swarm agree … --about ${rel}\`), and that agreement goes. Claim again once posted; do not wait for the agreement.`,
            };
          }
        }
        hold(me, rel, kind); // a new holder, or an `inside` claim widened to an interface
        db.prepare("DELETE FROM claim_requests WHERE repo = ? AND path = ? AND participant = ?").run(me.repo, rel, me.id);
        recordShares(me, rel, people);
        const sharedWith = people.map((o) => ({ member: o.name, doing: doingOf(o.id) }));
        return { allowed: true, sharedWith, notice: noticeOf(me, rel, people) };
      });
    },

    reconcileWrites(me, changed) {
      const flags: Flag[] = [];
      // one transaction: the page sees one change however many files
      return transaction(() => {
        const flag = db.prepare("INSERT OR IGNORE INTO flags (repo, path, participant) VALUES (?, ?, ?)");
        // one flag post per writer, path and holder, whichever of merge-lock or end finds it first (D8)
        const posted = db.prepare("INSERT OR IGNORE INTO flag_posts (repo, path, participant, holder) VALUES (?, ?, ?, ?)");
        for (const file of changed) {
          const rel = relPath(me.repo, file);
          if (!rel) continue;
          // a file the writer shares with others is its own: nothing to flag (D40)
          if (holdersOf(me.repo, rel).some((c) => c.participant === me.id)) {
            take(me, rel, "inside");
            continue;
          }
          const { held: others, taken } = take(me, rel, "inside");
          // written outside the writer's claim: free and claimed now, or held by another (D39)
          if (taken || others.length) flag.run(me.repo, rel, me.id);
          if (!others.length) continue;
          const holder = participantById(others[0].participant);
          if (Number(posted.run(me.repo, rel, me.id, holder.id).changes) === 0) continue;
          // a board event, so the page shows it as one (D10); mentions: the holder, then the writer
          const m = insertMessage(
            me,
            `@${holder.name} @${me.name} flag: ${me.name} wrote ${rel} outside its claim; ${holder.name} holds it. Settle it here.`,
            rel,
            "event",
            [holder.name, me.name],
            { event: EVENTS.flag.name },
          );
          flags.push({ path: rel, holder: holder.name, seq: m.seq });
        }
        return flags;
      });
    },

    release(me, file) {
      const rel = relPath(me.repo, file);
      if (!rel) return;
      transaction(() => {
        const r = db.prepare("DELETE FROM claims WHERE repo = ? AND path = ? AND participant = ?").run(me.repo, rel, me.id);
        if (Number(r.changes) === 0) return;
        clearFlags();
        bump(me.repo);
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
          return { granted: false as const, holder: participantById(Number(r.participant)).name };
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
        return { granted: true as const };
      });
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
      const iface = new Set<string>();
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
          db.prepare("DELETE FROM merge_locks WHERE repo = ?").run(me.repo);
          db.prepare("UPDATE participants SET merged = 1 WHERE id = ?").run(me.id);
          // the holder's lock turn ends with the merge (D25)
          const turn = openTurn(me);
          if (turn) db.prepare("UPDATE lock_requests SET merged_at = ? WHERE rowid = ?").run(now(), Number(turn.id));
          waiters = takeLockWaiters(me.repo).filter((n) => n !== me.name);
        });
        // every holder of a merged path, a shared one included (D40)
        for (const rel of rels) {
          for (const c of holdersOf(me.repo, rel)) {
            if (c.kind === "interface") iface.add(rel);
            if (c.participant !== me.id) told.add(participantById(c.participant).name);
          }
        }
        // declarers, the merger's own declarations counting toward *interface*
        const everyone = db
          .prepare("SELECT p.id, p.seat, r.plan FROM participants p JOIN runs r ON r.id = p.run WHERE r.repo = ? AND r.state = 'open' AND p.ended_at IS NULL")
          .all(me.repo) as Row[];
        for (const o of everyone) {
          for (const f of declared(Number(o.id))) {
            const rel = relPath(me.repo, f.path);
            if (!rel || !wanted.has(rel)) continue;
            if (f.interface) iface.add(rel);
            if (Number(o.id) !== me.id) told.add(`${o.plan}/${o.seat}`);
          }
        }
        // D7: the other party of an agreement about a merged file hears of the merge, claim or not
        const agreed = new Set<string>();
        const foldedWanted = new Set(rels.map(fold));
        const live = new Set((db.prepare("SELECT p.id, p.seat, r.plan FROM participants p JOIN runs r ON r.id = p.run WHERE r.repo = ? AND r.state = 'open' AND p.ended_at IS NULL").all(me.repo) as Row[]).map((o) => `${o.plan}/${o.seat}`));
        for (const a of db.prepare("SELECT author, about, mentions FROM messages WHERE repo = ? AND kind = 'agreement' AND about IS NOT NULL").all(me.repo) as Row[]) {
          if (!foldedWanted.has(fold(slashes(String(a.about))))) continue;
          const parties = [participantById(Number(a.author)).name, ...(JSON.parse(String(a.mentions)) as string[])];
          for (const n of parties) if (n !== me.name && live.has(n) && !told.has(n)) agreed.add(n);
        }
        // an interface change is announced to every member on the repository (D26), never to a kind without claims (D70)
        const openPlans = (db.prepare("SELECT DISTINCT plan, kind FROM runs WHERE repo = ? AND state = 'open'").all(me.repo) as Row[])
          .filter((r) => profileOf(String(r.kind)).claims)
          .map((r) => String(r.plan));
        const all = iface.size ? openPlans.map((plan) => `${plan}/*`) : [];
        const lines = [`merged ${sha}${onto ? ` into ${onto}` : ""}: rebase your branch onto it.`];
        if (told.size) lines.push(`${[...told].map((n) => `@${n}`).join(" ")}: you hold or declared a file it changed.`);
        if (agreed.size) lines.push(`${[...agreed].map((n) => `@${n}`).join(" ")}: you agreed on a file it changed.`);
        if (iface.size) lines.push(`@swarm interface changed: ${[...iface].join(", ")}.`);
        if (waiters.length) lines.push(`the merge lock is free: ${waiters.map((n) => `@${n}`).join(" ")}`);
        lines.push(`files: ${rels.join(", ") || "-"}`);
        // whom to tell of a resolved conflict (D63): a holder from any run, or one of this run that held it;
        // once the conflicts are known, of a conflicted path only (D5)
        for (const rel of rels) {
          if (conflicted && !conflicted.has(fold(rel))) continue;
          const ids = new Set(holdersOf(me.repo, rel).map((c) => c.participant));
          const held = db
            .prepare("SELECT l.participant FROM claim_log l JOIN participants p ON p.id = l.participant WHERE l.repo = ? AND l.path = ? AND p.run = ? ORDER BY l.rowid")
            .all(me.repo, rel, me.run) as Row[];
          for (const r of held) ids.add(Number(r.participant));
          ids.delete(me.id);
          for (const id of ids) sharers.push({ path: rel, member: participantById(id).name });
        }
        const meta: MergedMeta = { rebase: [...told], tell: [...new Set(sharers.map((o) => o.member))] };
        insertMessage(me, lines.join("\n"), null, "event", [...new Set([...told, ...agreed, ...waiters, ...all])], { event: EVENTS.merged.name, meta });
        // the merge, for the stats: its files and conflicts, null for unknown (D25)
        db.prepare("INSERT INTO merges (participant, run, sha, at, files, conflicts) VALUES (?, ?, ?, ?, ?, ?)").run(
          me.id,
          me.run,
          sha,
          now(),
          JSON.stringify(rels),
          conflicts && "files" in conflicts ? JSON.stringify(conflicts.files.map(slashes)) : null,
        );
      });
      return sharers;
    },
  };
}
