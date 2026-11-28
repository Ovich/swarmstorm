// The server's sockets (plan 2026-11-27-codebase-rework#D14): the hello and its refusals, the frame table, the
// close and the ping that keeps a link honest (D10), and what the board tells every connection (closed, changed).
import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
import type { Board, LinkDropCause } from "../board/board.ts";
import type { Authority } from "./authority.ts";
import { callerName, type Caller, type CallTable } from "./calls.ts";
import type { PresenceLedger } from "./presence.ts";
import { guarded } from "./guarded.ts";
import { decode, encode, type Frame, type Hello } from "../contract/wire.ts";

/** The ping that keeps a link's socket honest (D10). */
export const PING_EVERY_MS = 10 * 1000;
const PONG_WITHIN_MS = 25 * 1000;
/** A ping round this much later than due means the server's loop was blocked (board-fixes#D1). */
const LOOP_LAG_FORGIVEN_MS = 2 * 1000;
/** How long an ended member's link must carry no call before the server tells it so (T53b); under stopLinks' grace. */
const ENDED_LINK_QUIET_MS = 1000;

/** board-fixes#D1: whether a ping round at `now` cuts a socket last heard from at `heardAt`: silent past PONG_WITHIN_MS,
 *  and the round on time (one run late after `lastRound` finds the server's own loop was blocked, the pongs unread). */
export function silentTooLong(now: number, lastRound: number, heardAt: number): boolean {
  const loopBlocked = now - lastRound > PING_EVERY_MS + LOOP_LAG_FORGIVEN_MS;
  return !loopBlocked && now - heardAt > PONG_WITHIN_MS;
}

/** Why a socket closed, as swarm-server.log says it (board-fixes#D1): finer than the stored drop cause. */
type ClosedForLog = "ping timeout" | "link ended" | "run closed" | `error: ${string}`;
/** `member`: the member whose link this is, its presence written. `subscribed`: a reader that sent `subscribe`, told
 *  `changed` after each commit (D23). `dropCause`: why its socket closes, the link's stored drop cause (board-split
 *  D55), set through dropAs; `logCause`: the finer cause swarm-server.log gives instead, when there is one
 *  (board-fixes#D1). `lastPong`: when it was last heard from, any frame or pong (board-fixes#D1). */
type Speaker = Caller & { member: Hello["member"] | null; lastPong: number; subscribed: boolean; dropCause?: LinkDropCause; endedPending?: boolean; logCause?: ClosedForLog };
/** A welcomed connection's frames, by type; a member's own frames do nothing on a connection of no member. */
type FrameOf<T extends Frame["type"]> = Extract<Frame, { type: T }>;
type FrameTable = { [T in Frame["type"]]?: (s: Speaker, f: FrameOf<T>) => void };

export type Connections = {
  /** A socket the WebSocket server accepted, with the upgrade request it came on. */
  accept(socket: WebSocket, upgrade: IncomingMessage): void;
  /** D30: a closed run's links are told so. */
  closeRun(run: number): void;
  /** V-17 (D56): an ended member's link is told so, once it has carried no call for ENDED_LINK_QUIET_MS. */
  ended(member: string | undefined): void;
  /** D23: a commit, told to the readers that subscribed. */
  tellChanged(repo: string): void;
  /** One ping round: a socket silent too long cut, every other pinged. */
  pingRound(): void;
  /** The server going down: every connection refused with shutdown, a link's drop a restart. */
  shutdown(): void;
};

export function makeConnections(d: {
  board: Board; authority: Authority; calls: CallTable; presence: PresenceLedger; ticket: string; version: string; log(l: string): void;
  /** U-F14: a refusal for a version, the server's evidence of which hello it refused. */
  logVersionRefused(theirs: string, from: string): void;
}): Connections {
  const { board, calls, presence } = d;
  const speakers = new Set<Speaker>();
  let connectionsSeen = 0;
  let lastPingRound = Date.now();

  const send = (s: Speaker, f: Frame): void => {
    if (s.socket.readyState === s.socket.OPEN) s.socket.send(encode(f));
  };
  const refuse = (s: Speaker, reason: FrameOf<"refused">["reason"]): void => {
    send(s, { type: "refused", reason });
    s.socket.close();
  };
  /** board-split D55: a take-over stays the drop's cause; a later cause of a superseded link's close does not replace it. */
  const dropAs = (s: Speaker, cause: LinkDropCause): void => {
    if (s.dropCause !== "superseded") s.dropCause = cause;
  };
  /** Whether another welcomed link of the same member lives. */
  const otherLinkOf = (m: { name: string; run: number }): boolean => [...speakers].some((o) => o.member?.run === m.run && o.member.name === m.name);

  /** The hello: refused, or welcomed with what a member's link watches. */
  function greet(s: Speaker, f: Frame): boolean {
    if (f.type !== "hello") {
      s.socket.close();
      return false;
    }
    if (f.ticket !== d.ticket) return refused(s, "ticket");
    if (f.version !== d.version) {
      d.logVersionRefused(f.version, f.member?.name ?? "a reader");
      // board-split D55: a member's link refused for its version is a drop of that cause, unless another link of it lives
      if (f.member && !otherLinkOf(f.member)) presence.linked(f.member, false, "version");
      return refused(s, "version");
    }
    // D5: a direct or fallback connection (`presence: false`) is bound, and writes no presence: no closed refusal
    // (the board's own rules decide what an ended member may still do), no supersede, no linked, no drop
    const isLink = f.presence !== false;
    // break-flow V-30: a link started for a closed run, or for a member that has ended, is told so at once
    const known = isLink && f.member ? board.participant(f.member.name) : null;
    if (known && (known.ended || !board.runs().some((r) => r.id === known.run))) return refused(s, "closed");
    const bound = d.authority.bind(f);
    if (bound === "unknown member") return refused(s, "member");
    s.bound = bound;
    if (isLink && f.member) {
      const member = f.member;
      for (const other of speakers)
        if (f.supersede && other.member && other.member.name === member.name && other.member.run === member.run) {
          // board-split D55: the old link's drop is the new one's take-over, never a loss
          dropAs(other, "superseded");
          refuse(other, "superseded");
        }
      s.member = member;
      presence.linked(member, true);
    }
    speakers.add(s);
    // spec §7: a member's link reads its worktree's changes against the branch its run merges into
    const seat = s.member ? board.participant(s.member.name) : null;
    const against = seat ? board.runs().find((r) => r.id === seat.run)?.base : null;
    send(s, { type: "welcome", version: d.version, ...(seat?.place && against ? { watched: { dir: seat.place, against } } : {}) });
    return true;
  }
  const refused = (s: Speaker, reason: FrameOf<"refused">["reason"]): false => {
    refuse(s, reason);
    return false;
  };

  const FRAMES: FrameTable = {
    call: (s, f) => calls.run(s, f),
    cancel: (s, f) => calls.cancel(s, f.id),
    bye: (s) => {
      dropAs(s, "member-closed");
      s.socket.close();
    },
    beat: (s) => s.member && presence.beat(s.member),
    activity: (s, f) => s.member && presence.activity(s.member, f.activity),
    changes: (s, f) => {
      // spec §7: the member's holdings become its worktree's changed set; an overlap is posted to both
      const seat = s.member ? board.participant(s.member.name) : null;
      if (seat) guarded("changes", () => board.packCall(seat, "changes", { files: f.files }));
    },
    subscribe: (s) => {
      s.subscribed = true;
    },
  };

  function closedSocket(s: Speaker): void {
    speakers.delete(s);
    const dropCause = s.dropCause ?? "socket";
    // board-fixes#D1: one line per member's socket closed, or any socket closed with a cause of its own: who, why, how
    // many of its calls were still unanswered
    if (s.member || s.logCause) d.log(`close: ${callerName(s)}, cause ${s.logCause ?? dropCause}, ${calls.openCount(s)} call(s) open`);
    // its link lost, unless another link of the same member took over (superseded)
    const m = s.member;
    if (m && !otherLinkOf(m)) presence.linked(m, false, dropCause);
    // D16: a wait whose link went is cancelled at once; resent after a reconnect, it runs again
    calls.dropWaits(s);
  }

  function refuseEndedOnceAnswered(s: Speaker): void {
    if (calls.busy(s, ENDED_LINK_QUIET_MS)) {
      setTimeout(() => s.endedPending && refuseEndedOnceAnswered(s), ENDED_LINK_QUIET_MS);
      return;
    }
    s.endedPending = false;
    s.logCause = "link ended";
    refuse(s, "closed");
  }

  return {
    accept(socket, upgrade) {
      const s: Speaker = { socket, member: null, bound: null, anonymousScope: `connection ${++connectionsSeen}`, lastPong: Date.now(), subscribed: false, readAt: Date.now() };
      // ahead of ws's own reader: the time the bytes came in, before the calls queued in them are run one by one
      upgrade.socket.prependListener("data", () => (s.readAt = Date.now()));
      let welcomed = false;
      socket.on("error", (e) => (s.logCause = `error: ${e.message}`));
      socket.on("pong", () => (s.lastPong = Date.now()));
      socket.on("message", (data) => {
        s.lastPong = Date.now();
        let f: Frame;
        try {
          f = decode(String(data));
        } catch {
          return socket.close();
        }
        if (!welcomed) {
          welcomed = greet(s, f);
          return;
        }
        (FRAMES[f.type] as ((s: Speaker, f: Frame) => void) | undefined)?.(s, f);
      });
      socket.on("close", () => closedSocket(s));
    },
    closeRun(run) {
      for (const s of speakers)
        if (s.member?.run === run) {
          s.logCause = "run closed";
          refuse(s, "closed");
        }
    },
    ended(member) {
      // its own end, or the orchestrator's end --seat: the member's link is done as at a close, once it has carried no
      // call for ENDED_LINK_QUIET_MS: the wait the end released reaches its CLI, and that CLI's follow-up calls are answered (T53b)
      for (const s of speakers)
        if (member && s.member?.name === member) {
          s.endedPending = true;
          refuseEndedOnceAnswered(s);
        }
    },
    tellChanged(repo) {
      for (const s of speakers) if (s.subscribed) send(s, { type: "changed", repo });
    },
    pingRound() {
      const t = Date.now();
      // board-fixes#D1: a round run late finds this server's own loop was blocked; the pongs it held back are not read
      // yet, so no one is cut for that silence this round
      const lastRound = lastPingRound;
      lastPingRound = t;
      for (const s of speakers) {
        if (silentTooLong(t, lastRound, s.lastPong)) {
          s.logCause = "ping timeout";
          s.socket.terminate();
        } else s.socket.ping();
      }
    },
    shutdown() {
      for (const s of speakers) {
        // board-split D55: a link this server drops on its way down is a restart, never a socket loss
        dropAs(s, "server-restart");
        refuse(s, "shutdown");
      }
    },
  };
}
