// The conversation's filters, rendered (SL11): the kind chips narrow and count; the File menu
// lists, searches, picks and clears; kind and file combine.
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import type { BoardSnapshot, RunSummary, SnapshotEvent, SnapshotMember } from "../../swarm-board/src/client/reader.ts";
import { conversation, narrow, type Narrow } from "./lib/board/view.ts";
import { Conversation } from "./components/viewers/board/Conversation.tsx";
import { ConversationFilters } from "./components/viewers/board/ConversationFilters.tsx";

vi.mock("mermaid", () => ({
  default: { initialize: () => {}, render: async () => ({ svg: "<svg></svg>" }) },
}));

afterEach(cleanup);

const AT = "2026-10-14T10:00:00Z";
const RUN: RunSummary = { run: 1, kind: "plan", plan: "alpha", group: "alpha", code: "AL", title: "Alpha", link: null, open: true, members: 2, done: 0, of: 2 };
const member = (seat: string, nick: string): SnapshotMember => ({
  member: `alpha/${seat}`, nick, plan: "alpha", seat, role: seat, doing: "", state: "working", stale: false,
  files: [], joined: AT, ended: null, calls: 0, listening: false, on: [], lastCall: AT,
});
let seq = 0;
const post = (from: string, body: string, over: Partial<SnapshotEvent> = {}): SnapshotEvent => ({
  seq: ++seq, at: AT, kind: "msg", from, body, about: null, run: 1, channel: 1, ...over,
});
const SNAP: BoardSnapshot = {
  repo: "/r/.git", name: "r", runs: [RUN], lock: null, lockHistory: [], roster: [member("S1", "Sleepy Otter"), member("S2", "Brave Badger")],
  events: [
    post("alpha/S1", "flag", { kind: "event", event: "flag", about: "src/b.ts", mentions: ["alpha/S2", "alpha/S1"] }),
    post("alpha/S2", "a word on b", { about: "src/b.ts" }),
    post("alpha/S1", "a call in a", { about: "lib/a.ts" }),
    post("alpha/S2", "S1 the top of a", { kind: "agreement", about: "lib/a.ts" }),
    post("alpha/orchestrator", "phase build: the seats", { kind: "event", event: "phase", mentions: ["alpha/*"], meta: { phase: "build" } }),
    post("alpha/S1", "plain talk"),
    post("alpha/S1", "merged abc: rebase your branch onto it.", { kind: "event", event: "merged" }),
  ],
  queues: {}, files: [], flags: [],
};

function Harness() {
  const items = conversation(SNAP, { run: null, follow: null });
  const [n, setN] = useState<Narrow>({ kind: "all", file: null });
  return (
    <>
      <ConversationFilters items={items} narrow={n} onNarrow={setN} />
      <Conversation items={narrow(items, n)} archived={null} fresh={new Set()} />
    </>
  );
}

const bar = () => within(screen.getByRole("toolbar", { name: "Filters" }));
const chip = (name: RegExp) => bar().getByRole("button", { name });
const shows = (text: string) => screen.queryByText(text) !== null;

test("the kind chips count within the items and narrow to one kind at a time", () => {
  render(<Harness />);
  expect(chip(/^All$/).getAttribute("aria-pressed")).toBe("true");
  expect(chip(/^Messages/).textContent).toBe("Messages3");
  expect(chip(/^Agreements/).textContent).toBe("Agreements1");
  expect(chip(/^Flags/).textContent).toBe("Flags1");

  fireEvent.click(chip(/^Agreements/));
  expect(chip(/^Agreements/).getAttribute("aria-pressed")).toBe("true");
  expect(chip(/^All$/).getAttribute("aria-pressed")).toBe("false");
  expect(shows("S1 the top of a")).toBe(true);
  expect(shows("plain talk")).toBe(false);

  fireEvent.click(chip(/^Messages/));
  expect(shows("plain talk")).toBe(true);
  expect(shows("S1 the top of a")).toBe(false);

  // Flags: the flag and the post answering it about its file, nothing else
  fireEvent.click(chip(/^Flags/));
  expect(shows("a word on b")).toBe(true);
  expect(shows("plain talk")).toBe(false);
  expect(shows("a call in a")).toBe(false);

  fireEvent.click(chip(/^All$/));
  expect(shows("plain talk")).toBe(true);
});

test("File ▾ lists every file sorted with its count, searches, picks, and × clears", () => {
  render(<Harness />);
  fireEvent.click(chip(/File ▾/));
  const menu = within(screen.getByRole("dialog", { name: "Files" }));
  const search = menu.getByPlaceholderText("Find a file");
  expect(document.activeElement).toBe(search);
  expect(menu.getAllByRole("button", { name: /\.ts/ }).map((b) => b.textContent)).toEqual(["lib/a.ts2", "src/b.ts2"]);

  fireEvent.change(search, { target: { value: "src" } });
  expect(menu.getAllByRole("button", { name: /\.ts/ }).map((b) => b.textContent)).toEqual(["src/b.ts2"]);
  fireEvent.change(search, { target: { value: "nothing" } });
  expect(menu.getByText("No file matches.")).toBeTruthy();
  fireEvent.change(search, { target: { value: "" } });

  fireEvent.click(menu.getByRole("button", { name: /lib\/a\.ts/ }));
  expect(screen.queryByRole("dialog", { name: "Files" })).toBeNull();
  expect(bar().getByText("a.ts")).toBeTruthy();
  expect(shows("a call in a")).toBe(true);
  expect(shows("plain talk")).toBe(false);
  expect(shows("a word on b")).toBe(false);

  // kind and file combine
  fireEvent.click(chip(/^Agreements/));
  expect(shows("S1 the top of a")).toBe(true);
  expect(shows("a call in a")).toBe(false);

  fireEvent.click(bar().getByRole("button", { name: "Clear the file" }));
  expect(chip(/File ▾/)).toBeTruthy();
  fireEvent.click(chip(/^All$/));
  expect(shows("plain talk")).toBe(true);
});

test("Escape, × and a click outside close the File menu", () => {
  render(<Harness />);
  const isOpen = () => screen.queryByRole("dialog", { name: "Files" }) !== null;
  fireEvent.click(chip(/File ▾/));
  fireEvent.keyDown(document, { key: "Escape" });
  expect(isOpen()).toBe(false);
  fireEvent.click(chip(/File ▾/));
  fireEvent.click(screen.getByRole("button", { name: "Close the files" }));
  expect(isOpen()).toBe(false);
  fireEvent.click(chip(/File ▾/));
  fireEvent.mouseDown(document.body);
  expect(isOpen()).toBe(false);
});

test("a phase separator stays under every kind chip and a file", () => {
  render(<Harness />);
  const separator = () => screen.queryByRole("separator", { name: "Phase build: the seats" });
  expect(separator()).not.toBeNull();
  for (const name of [/^Messages/, /^Agreements/, /^Flags/]) {
    fireEvent.click(chip(name));
    expect(separator(), String(name)).not.toBeNull();
  }
});
