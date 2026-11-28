// The board (codebase-rework#D8): runs, their seats and members, the thread of each project, who has had what, who is
// calling, and waking a `wait`. `openBoard` composes it from the store and the board's modules, each reaching the others
// only through what it is given; SQL, the prepare cache, the transaction and waking stay inside them. Callers hold the
// typed Board it returns. The code pack's claims and merge lock live in its own tables, behind this Board.
import { SQLITE_PATH } from "../store/home.ts";
import { openStore } from "../store/store.ts";
import type { Participant } from "../contract/board.ts";
import type { Board } from "./types.ts";
import { makeRows } from "./rows.ts";
import { makePaths } from "./paths.ts";
import { makeMessages } from "./conversation/messages.ts";
import { makePackBridge, type PackBridge } from "./pack-bridge.ts";
import { makePhaseReads } from "./phases/phase-reads.ts";
import { makeMemberView } from "./members/member-view.ts";
import { makeDelivery } from "./conversation/delivery.ts";
import { makeRuns } from "./run/runs.ts";
import { makeMembers } from "./members/members.ts";
import { makeAllDone, makePhases } from "./phases/phases.ts";
import { makeTalk } from "./conversation/talk.ts";
import { makeTick } from "./members/tick.ts";
import { makeUpkeep } from "./run/upkeep.ts";
import { makePage } from "./page.ts";
import { makeThreadRead } from "./conversation/thread-read.ts";
import { makeCalls } from "./members/calls.ts";

export type * from "./types.ts";
export { progressText } from "./phases/owing.ts";
export { BOARD_AUTHOR } from "./conversation/mentions.ts";
export { projectFolderName } from "./page.ts";
export { THREAD_LIMIT } from "./conversation/thread-read.ts";
export { UPKEEP_EVERY_MS } from "./run/upkeep.ts";

export async function openBoard(dbPath: string = SQLITE_PATH): Promise<Board> {
  const store = await openStore(dbPath);
  const rows = makeRows(store);
  const paths = makePaths(store);
  // late-bound: a message that wakes a waiting task is worded by the waker's pack, made after the messages it writes
  let packs: PackBridge | null = null;
  const messages = makeMessages(store, rows, { awaitedWording: (p, cause) => packs!.awaitedWording(p, cause) });
  packs = makePackBridge(store, rows, messages, paths);
  const owing = makePhaseReads(store, rows);
  const view = makeMemberView(store, rows, owing, messages, packs);
  const delivery = makeDelivery(store, rows, messages, packs, view);
  const allDoneOnce = makeAllDone(store, messages);
  const calls = makeCalls(store, rows, packs);
  const board: Board = {
    ...makeRuns(store, rows, messages, packs, view),
    ...makeMembers(store, rows, messages, packs, owing, view, delivery),
    ...makePhases(store, rows, messages, owing, delivery, allDoneOnce),
    ...makeTalk(store, rows, messages, packs),
    ...makeTick(store, rows, messages, packs, owing, view, allDoneOnce),
    ...makeUpkeep(store, packs, delivery),
    ...makePage(store, rows, paths, packs, owing, view, delivery),
    ...makeThreadRead(store, rows),
    deliverMentions: delivery.deliverMentions,
    unreadMentions: delivery.unreadMentions,
    wait: delivery.wait,
    packCall: calls.packCall,
    onChange: (listener) => store.changes.onChange(listener),
    close: () => store.close(),
  };
  const { countCall } = calls;
  const transaction = store.tx;
  // the verb and its count in one transaction: the page sees one change, and a refused call
  // (an ended member, an unknown path) counts none
  const counted = <A extends unknown[], R>(name: string, verb: (p: Participant, ...rest: A) => R) =>
    (p: Participant, ...rest: A): R =>
      transaction(() => {
        const out = verb(p, ...rest);
        countCall(p, name);
        return out;
      });
  board.setDoing = counted("setDoing", board.setDoing);
  board.end = counted("end", board.end);
  board.post = counted("post", board.post);
  board.phase = counted("phase", board.phase);
  board.pause = counted("pause", board.pause);
  board.resume = counted("resume", board.resume);
  board.done = counted("done", board.done);
  board.endorse = counted("endorse", board.endorse);
  board.wait = counted("wait", board.wait);
  return board;
}
