// Component + pure-logic tests (vitest, jsdom). Visual acceptance runs against the prototype.
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

afterEach(cleanup);
import { applyFilters, applyScope } from "./hooks/useFilters.ts";
import { truncatePath, kindHue } from "./lib/utils.ts";
import { DocPath } from "./components/docs/DocPath.tsx";
import { shouldLoad } from "./App.tsx";
import { docActivity, sidebarEntries } from "./hooks/useSidebarEntries.ts";
import { DocItem } from "./components/docs/DocItem.tsx";
import { ProjectSelector } from "./components/shell/ProjectSelector.tsx";
import { Sidebar } from "./components/shell/Sidebar.tsx";
import { DocumentsPanel as DocumentsPage } from "./components/docs/DocumentsPage.tsx";
import type { DocumentWithState } from "./lib/api.ts";
import { readFileSync } from "node:fs";

const doc = (over: Partial<DocumentWithState>): DocumentWithState => ({
  id: 1,
  file_path: "docs/x.brainstorm.md",
  abs_path: "C:\\JOBS\\docs\\x.brainstorm.md",
  project: "JOBS",
  title: "Board X",
  pinned: false,
  kind: "brainstorm",
  tags: ["aiview"],
  group_slug: null,
  created_at: "2026-08-23T09:00:00Z",
  last_seen_at: "2026-08-23T10:00:00Z",
  updated_at: "2026-08-23T10:00:00Z",
  exists: true,
  format: "markdown",
  ...over,
});

describe("applyFilters", () => {
  const docs = [
    doc({ id: 1, kind: "brainstorm", tags: ["aiview", "webapp"], title: "Board" }),
    doc({ id: 2, kind: "spec", tags: ["aiview"], title: "Spec", file_path: "docs/x.spec.md" }),
    doc({ id: 3, kind: "pdf", tags: ["itech"], title: "cv-live.pdf", file_path: "out/cv.pdf" }),
  ];
  test("no filters returns everything", () => {
    expect(applyFilters(docs, { query: "", kinds: new Set(), tags: new Set() })).toHaveLength(3);
  });
  test("kind filter is a union, tag filter an intersection", () => {
    expect(applyFilters(docs, { query: "", kinds: new Set(["spec", "pdf"]), tags: new Set() }).map((d) => d.id)).toEqual([2, 3]);
    expect(applyFilters(docs, { query: "", kinds: new Set(), tags: new Set(["aiview", "webapp"]) }).map((d) => d.id)).toEqual([1]);
  });
  test("query matches title or path, case-insensitive", () => {
    expect(applyFilters(docs, { query: "SPEC", kinds: new Set(), tags: new Set() }).map((d) => d.id)).toEqual([2]);
    expect(applyFilters(docs, { query: "out/cv", kinds: new Set(), tags: new Set() }).map((d) => d.id)).toEqual([3]);
  });
});

describe("utils", () => {
  test("truncatePath keeps the filename visible", () => {
    const p = "C:\\very\\long\\path\\that\\goes\\on\\and\\on\\forever\\until\\it\\must\\be\\cut\\file.spec.md";
    const t = truncatePath(p, 40);
    expect(t.length).toBeLessThanOrEqual(41);
    expect(t.endsWith("file.spec.md")).toBe(true);
    expect(t).toContain("…");
    expect(truncatePath("short.md", 40)).toBe("short.md");
  });
  test("kindHue is deterministic and in range", () => {
    expect(kindHue("brainstorm")).toBe(kindHue("brainstorm"));
    expect(kindHue("spec")).toBeGreaterThanOrEqual(0);
    expect(kindHue("spec")).toBeLessThan(360);
  });
});

describe("sidebarEntries", () => {
  test("groups collapse into containers, members oldest-first, entries by latest activity", async () => {
    const { sidebarEntries } = await import("./hooks/useSidebarEntries.ts");
    // activity is the file's mtime (updated_at), not the index's last_seen_at
    const docs = [
      doc({ id: 1, group_slug: "g", created_at: "2026-08-20T00:00:00Z", updated_at: "2026-08-23T00:00:00Z" }),
      doc({ id: 2, group_slug: "g", created_at: "2026-08-19T00:00:00Z", updated_at: "2026-08-21T00:00:00Z" }),
      doc({ id: 3, group_slug: null, created_at: "2026-08-22T00:00:00Z", updated_at: "2026-08-22T00:00:00Z" }),
      doc({ id: 4, group_slug: null, created_at: "2026-08-10T00:00:00Z", updated_at: "2026-08-24T00:00:00Z" }),
    ];
    const entries = sidebarEntries(docs, { g: "Group G" });
    // order: doc 4 (activity 24th), group g (23rd), doc 3 (22nd)
    expect(entries.map((e) => (e.type === "doc" ? e.doc.id : e.slug))).toEqual([4, "g", 3]);
    const group = entries[1];
    if (group.type !== "group") throw new Error("expected group");
    expect(group.title).toBe("Group G");
    expect(group.docs.map((d) => d.id)).toEqual([2, 1]); // oldest-first inside
  });
  test("unknown group title falls back to slug", async () => {
    const { sidebarEntries } = await import("./hooks/useSidebarEntries.ts");
    const entries = sidebarEntries([doc({ id: 1, group_slug: "x" })], {});
    expect(entries[0].type === "group" && entries[0].title).toBe("x");
  });
});

describe("DocPath", () => {
  test("click copies the absolute path and confirms", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const p = "C:\\JOBS\\docs\\x.md";
    render(<DocPath path={p} />);
    fireEvent.click(screen.getByRole("button"));
    expect(writeText).toHaveBeenCalledWith(p);
    expect(await screen.findByText("Path copied")).toBeTruthy();
  });
});

describe("DocItem", () => {
  test("carries the path as tooltip and opens on click", () => {
    const onOpen = vi.fn();
    const d = doc({});
    render(<DocItem doc={d} active={false} onOpen={onOpen} />);
    const item = document.querySelector('[data-component="DocItem"]') as HTMLElement;
    expect(item.getAttribute("title")).toBe(d.abs_path);
    fireEvent.click(item);
    expect(onOpen).toHaveBeenCalledWith(1);
  });
  test("missing file renders struck through", () => {
    render(<DocItem doc={doc({ exists: false })} active={false} onOpen={() => {}} />);
    expect(screen.getByText("Board X").className).toContain("line-through");
  });
});

describe("project scope", () => {
  const docs = [
    doc({ id: 1, project: "CIIP", kind: "pr-analysis", tags: ["portail"], title: "POR-3410" }),
    doc({ id: 2, project: "JOBS", kind: "spec", tags: ["cv"], title: "Spec" }),
    doc({ id: 3, project: "JOBS", kind: "brainstorm", tags: ["cv"], title: "Board" }),
  ];

  test("scope narrows to one project; '*' is no project, so it keeps nothing (board-split D41)", () => {
    expect(applyScope(docs, "JOBS").map((d) => d.id)).toEqual([2, 3]);
    expect(applyScope(docs, "CIIP").map((d) => d.id)).toEqual([1]);
    expect(applyScope(docs, "*")).toHaveLength(0);
  });

  test("scope runs before the chips, so the chip lists are themselves scoped (D16)", () => {
    // This is what makes "everything below is scoped" true rather than decorative:
    // JOBS must not offer a pr-analysis chip that can only match a CIIP document.
    const scoped = applyScope(docs, "JOBS");
    expect([...new Set(scoped.map((d) => d.kind))].sort()).toEqual(["brainstorm", "spec"]);
    expect([...new Set(scoped.flatMap((d) => d.tags))]).toEqual(["cv"]);
  });
});

describe("ProjectSelector", () => {
  const projects = { CIIP: "CIIP", JOBS: "JOBS" };
  const docs = [doc({ id: 1, project: "CIIP" }), doc({ id: 2, project: "JOBS" }), doc({ id: 3, project: "JOBS" })];

  test("shows the active project and its document count", () => {
    render(<ProjectSelector projects={projects} active="JOBS" docs={docs} onPick={() => {}} />);
    expect(screen.getByLabelText("Project: JOBS")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy(); // JOBS holds 2 of the 3
  });

  test("the menu offers each project and no All projects (board-split D41)", () => {
    render(<ProjectSelector projects={projects} active="JOBS" docs={docs} onPick={() => {}} />);
    fireEvent.click(screen.getByLabelText("Project: JOBS"));
    expect(screen.queryByText("All projects")).toBeNull();
    expect(screen.getAllByRole("button").filter((b) => b.getAttribute("aria-current") !== null)).toHaveLength(2);
  });

  test("picking another project reports it; picking the active one is a no-op", () => {
    const onPick = vi.fn();
    render(<ProjectSelector projects={projects} active="JOBS" docs={docs} onPick={onPick} />);
    fireEvent.click(screen.getByLabelText("Project: JOBS")); // open the menu
    fireEvent.click(screen.getByText("CIIP"));
    expect(onPick).toHaveBeenCalledWith("CIIP");

    onPick.mockClear();
    fireEvent.click(screen.getByLabelText("Project: JOBS"));
    fireEvent.click(screen.getAllByText("JOBS")[1]!); // the menu row, not the trigger
    expect(onPick).not.toHaveBeenCalled();
  });
});

describe("DocItem project line", () => {
  test("hidden when scoped, shown in All-projects mode", () => {
    const d = doc({ project: "JOBS" });
    const { queryByText } = render(<DocItem doc={d} active={false} showProject={false} onOpen={() => {}} />);
    expect(queryByText("JOBS")).toBeNull();
    cleanup();
    render(<DocItem doc={d} active={false} showProject onOpen={() => {}} />);
    expect(screen.getByText("JOBS")).toBeTruthy();
  });
});

describe("shouldLoad — the reading pane's fetch rule", () => {
  test("nothing selected: never loads", () => {
    expect(shouldLoad(null, null, 0, null)).toBe(false);
  });

  test("a new selection always loads, even mid-stream of other documents' changes", () => {
    // the regression: doc 16 changed on disk, then the user clicks doc 19.
    expect(shouldLoad(19, 16, 5, 16)).toBe(true);
  });

  test("the same document reloads only when the change event names it", () => {
    expect(shouldLoad(19, 19, 5, 19)).toBe(true); // this one changed -> reload
    expect(shouldLoad(19, 19, 5, 16)).toBe(false); // a different one -> leave it alone
  });

  test("before any change event, the selected document loads", () => {
    expect(shouldLoad(19, null, 0, null)).toBe(true);
    expect(shouldLoad(19, 19, 0, null)).toBe(true);
  });
});

describe("tag chips", () => {
  const at = (day: number) => `2026-09-${String(day).padStart(2, "0")}T10:00:00Z`;

  test("the most recently active tags come first, and the project's own slug is left out", async () => {
    const { recentTags } = await import("./hooks/useFilters.ts");
    const docs = [
      doc({ id: 1, tags: ["JOBS", "old", "shared"], updated_at: at(1) }),
      doc({ id: 2, tags: ["jobs", "new"], updated_at: at(9) }),
      doc({ id: 3, tags: ["shared"], updated_at: at(5) }),
    ];
    expect(recentTags(docs, "JOBS")).toEqual(["new", "shared", "old"]);
    expect(recentTags(docs)).toEqual(["jobs", "new", "shared", "JOBS", "old"]);
  });

  test("with a document open, the list folds on a narrow screen behind one line (v1-F6)", () => {
    const docs = [doc({ id: 1, updated_at: at(1) }), doc({ id: 2, updated_at: at(2) })];
    render(<DocumentsPage docs={docs} groups={{}} activeProject="JOBS" currentId={1} onOpen={() => {}} />);
    const fold = document.querySelector('[data-component="DocumentsFold"]') as HTMLElement;
    const list = document.querySelector('[data-component="DocList"]') as HTMLElement;
    expect(fold.textContent).toBe("Documents · 2 · show");
    expect(list.className).toContain("max-[860px]:hidden");
    fireEvent.click(fold);
    expect(fold.textContent).toBe("Documents · 2 · hide");
    expect(list.className).not.toContain("max-[860px]:hidden");
    cleanup();
    render(<DocumentsPage docs={docs} groups={{}} activeProject="JOBS" currentId={null} onOpen={() => {}} />);
    expect(document.querySelector('[data-component="DocumentsFold"]')).toBeNull();
  });

  test("past the first twelve the rest fold behind a count, and a chosen tag stays in sight", async () => {
    const { TAGS_SHOWN } = await import("./components/shell/Sidebar.tsx");
    const docs = Array.from({ length: TAGS_SHOWN + 3 }, (_, i) =>
      doc({ id: i + 1, tags: [`t${i}`], updated_at: at(i + 1) }),
    );
    render(
      <DocumentsPage docs={docs} groups={{}} activeProject="JOBS" currentId={null} onOpen={() => {}} />,
    );
    fireEvent.click(screen.getByLabelText("Kinds and tags"));
    const chips = () => [...document.querySelectorAll('[data-component="TagChips"] [role="button"]')].map((b) => b.textContent);
    expect(chips()).toHaveLength(TAGS_SHOWN);
    expect(chips()[0]).toBe(`t${TAGS_SHOWN + 2}`);
    fireEvent.click(screen.getByText("+ 3 more"));
    expect(chips()).toHaveLength(TAGS_SHOWN + 3);
    fireEvent.click(within(document.querySelector('[data-component="TagChips"]') as HTMLElement).getByText("t0"));
    fireEvent.click(screen.getByText("fewer"));
    expect(chips()).toHaveLength(TAGS_SHOWN + 1);
    expect(chips()).toContain("t0");
  });
});

describe("sidebar ordering", () => {
  const g = { "aiview-webapp": "aiview web app", "project-selector": "aiview project selector" };
  // The regression: four old documents were MOVED, which stamped last_seen_at to now.
  // Bookkeeping must not float a year-old group above what is actually being edited.
  const docs = [
    doc({ id: 11, group_slug: "aiview-webapp", created_at: "2026-08-23T11:28:00Z",
          last_seen_at: "2026-08-24T11:21:00Z", updated_at: "2026-08-23T14:30:00Z", title: "old board" }),
    doc({ id: 14, group_slug: "aiview-webapp", created_at: "2026-08-23T11:51:00Z",
          last_seen_at: "2026-08-24T11:21:00Z", updated_at: "2026-08-23T14:30:00Z", title: "old plan" }),
    doc({ id: 16, group_slug: "project-selector", created_at: "2026-08-24T09:49:00Z",
          last_seen_at: "2026-08-24T11:23:00Z", updated_at: "2026-08-24T11:23:00Z", title: "live board" }),
  ];

  test("the group holding the most recently changed document is first", () => {
    const entries = sidebarEntries(docs, g);
    expect(entries[0]!.type).toBe("group");
    expect((entries[0] as { slug: string }).slug).toBe("project-selector");
  });

  test("moving old documents does not reorder the sidebar", () => {
    // same documents, but last_seen_at says the old ones were just touched
    const touched = docs.map((d) =>
      d.group_slug === "aiview-webapp" ? { ...d, last_seen_at: "2026-08-24T23:59:00Z" } : d,
    );
    const entries = sidebarEntries(touched, g);
    expect((entries[0] as { slug: string }).slug).toBe("project-selector");
  });

  test("a missing file falls back to last_seen_at rather than sorting last forever", () => {
    const gone = doc({ id: 99, group_slug: null, exists: false, updated_at: null, last_seen_at: "2026-08-25T08:00:00Z" });
    expect(docActivity(gone)).toBe("2026-08-25T08:00:00Z");
    expect(sidebarEntries([...docs, gone], g)[0]).toMatchObject({ type: "doc" });
  });

  test("a swarm document older than every other entry is first; the rest keep today's order (swarm D17)", () => {
    const board = doc({ id: 50, kind: "swarm", group_slug: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" });
    const flat = doc({ id: 51, group_slug: null, created_at: "2026-08-24T00:00:00Z", updated_at: "2026-08-24T12:00:00Z" });
    const entries = sidebarEntries([...docs, flat, board], g);
    expect(entries.map((e) => (e.type === "doc" ? e.doc.id : e.slug))).toEqual([50, 51, "project-selector", "aiview-webapp"]);
  });

  test("two swarm documents keep activity order between them, both first", () => {
    const older = doc({ id: 60, kind: "swarm", group_slug: null, updated_at: "2026-02-01T00:00:00Z" });
    const newer = doc({ id: 61, kind: "swarm", group_slug: null, updated_at: "2026-03-01T00:00:00Z" });
    const entries = sidebarEntries([older, ...docs, newer], g);
    expect(entries.slice(0, 2).map((e) => e.type === "doc" && e.doc.id)).toEqual([61, 60]);
  });

  test("members inside a group still read oldest-first", () => {
    const group = sidebarEntries(docs, g).find((e) => e.type === "group" && e.slug === "aiview-webapp");
    expect((group as { docs: { id: number }[] }).docs.map((d) => d.id)).toEqual([11, 14]);
  });
});

describe("kind chip inside a document row", () => {
  test("clicking the chip still opens the document (the click must reach the row)", () => {
    const onOpen = vi.fn();
    render(<DocItem doc={doc({ id: 7 })} active={false} onOpen={onOpen} />);
    const chip = document.querySelector('[data-component="KindChip"]')!;
    fireEvent.click(chip);
    expect(onOpen).toHaveBeenCalledWith(7);
  });
});

describe("Sidebar — clicking a row's kind chip", () => {
  const docs = [
    doc({ id: 5, kind: "spec", title: "Spec five", group_slug: null }),
    doc({ id: 6, kind: "plan", title: "Plan six", group_slug: "g" }),
  ];
  const render_ = (onOpen: (id: number) => void) =>
    render(
      <DocumentsPage docs={docs} groups={{ g: "Group G" }} activeProject="JOBS" currentId={null} onOpen={onOpen} />,
    );

  test("a flat row: clicking its kind chip opens the document", () => {
    const onOpen = vi.fn();
    render_(onOpen);
    const row = screen.getByText("Spec five").closest('[data-component="DocItem"]')!;
    fireEvent.click(row.querySelector('[data-component="KindChip"]')!);
    expect(onOpen).toHaveBeenCalledWith(5);
  });

  test("a row inside a group: clicking its kind chip opens the document", () => {
    const onOpen = vi.fn();
    render_(onOpen);
    fireEvent.click(screen.getByText("Group G")); // groups start collapsed
    const row = screen.getByText("Plan six").closest('[data-component="DocItem"]')!;
    fireEvent.click(row.querySelector('[data-component="KindChip"]')!);
    expect(onOpen).toHaveBeenCalledWith(6);
  });

  test("a decorative kind chip is not an event target; a filter chip is", () => {
    render_(() => {});
    const rowChip = screen.getByText("Spec five").closest('[data-component="DocItem"]')!
      .querySelector('[data-component="KindChip"]')!;
    expect(rowChip.tagName).toBe("SPAN");
    expect(rowChip.className).toContain("pointer-events-none");

    const filterChip = document.querySelector('[data-component="KindChips"] [data-component="KindChip"]')!;
    expect(filterChip.tagName).toBe("BUTTON");
    expect(filterChip.className).not.toContain("pointer-events-none");
  });
});

describe("composition overlay", () => {
  test("withOverlay appends the layer before </body> with the summary and target", async () => {
    const { withOverlay, OVERLAY_MARK, shortName } = await import("./lib/overlay.ts");
    const summary = { sources: ["2026-09-03-dock-tools.prototype.html"], errors: [{ ref: "a#B", message: 'Not "found"' }], warnings: [] };
    const out = withOverlay("<html><body><p>host</p></body></html>", { bindings: summary, target: "ToolPrefix" });
    expect(out.indexOf(OVERLAY_MARK)).toBeGreaterThan(out.indexOf("<p>host</p>"));
    expect(out.indexOf(OVERLAY_MARK)).toBeLessThan(out.indexOf("</body>"));
    expect(out).toContain('data-target="ToolPrefix"');
    // the summary rides on an attribute, escaped, and comes back intact
    const raw = out.match(/data-summary="([^"]*)"/)![1];
    const unescaped = raw.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&amp;/g, "&");
    expect(JSON.parse(unescaped)).toEqual(summary);
    expect(out).toContain("<script " + OVERLAY_MARK + ">");
    expect(withOverlay("<p>no body</p>")).toContain(OVERLAY_MARK);
    // the layer takes the mouse: the prototype is looked at, not operated, in Composition
    expect(out).toMatch(/#__aiview\{[^}]*pointer-events:auto/);
    expect(out).toMatch(/#__aiview \.av-box\{[^}]*pointer-events:auto;cursor:pointer/);
    expect(out).toMatch(/#__aiview \.av-box\.av-err\{[^}]*pointer-events:none/);
    // offered components get their own colour
    expect(out).toMatch(/#__aiview \.av-box\.av-decl\{[^}]*#15803d/);
    expect(out).toMatch(/#__aiview \.av-lbl\{[^}]*pointer-events:auto/);
    // every class the layer uses is namespaced: a prototype's own .box or .row rule must never style the layer
    const layerCss = out.slice(out.indexOf("<style " + OVERLAY_MARK), out.indexOf("</style>", out.indexOf("<style " + OVERLAY_MARK)));
    expect(layerCss).not.toMatch(/#__aiview \.(box|lbl|legend|row|pv|pvh|pvb)\b/);
    // no legend, no preview panel: the mode is outlines, labels and the veil
    expect(layerCss).not.toMatch(/av-legend|av-pv/);
    expect(shortName("2026-09-03-dock-tools.prototype.html")).toBe("dock-tools");
    expect(shortName("2026-09-03-dock-tools.mockup.html")).toBe("dock-tools"); // legacy suffix
  });

  test("sourceDocFor matches by base name inside the host's folder only", async () => {
    const { sourceDocFor } = await import("./App.tsx");
    const host = doc({ id: 1, abs_path: "C:\\home\\docs\\JOBS\\host.prototype.html" });
    const docs = [
      host,
      doc({ id: 2, abs_path: "C:\\home\\docs\\JOBS\\tools.prototype.html" }),
      doc({ id: 3, abs_path: "C:\\home\\docs\\OTHER\\tools.prototype.html" }),
      doc({ id: 4, abs_path: "/home/docs/JOBS/posix.prototype.html" }),
    ];
    expect(sourceDocFor(docs, host, "tools.prototype.html")?.id).toBe(2);
    expect(sourceDocFor(docs, host, "missing.prototype.html")).toBeUndefined();
    const posixHost = doc({ id: 5, abs_path: "/home/docs/JOBS/host.prototype.html" });
    expect(sourceDocFor(docs, posixHost, "posix.prototype.html")?.id).toBe(4);
  });
});

describe("PrototypeFrame modes", () => {
  afterEach(() => localStorage.clear());

  test("the mode toggle persists and Composition injects the overlay", async () => {
    const { PrototypeFrame } = await import("./components/viewers/PrototypeFrame.tsx");
    const { OVERLAY_MARK } = await import("./lib/overlay.ts");
    const bindings = { sources: ["tools.prototype.html"], errors: [], warnings: [] };
    render(<PrototypeFrame html="<html><body><p>h</p></body></html>" bindings={bindings} />);
    const frame = () => document.querySelector("iframe")!;
    expect(frame().getAttribute("srcdoc")).not.toContain(OVERLAY_MARK);
    expect(screen.getByText("1 source")).toBeTruthy();
    fireEvent.click(screen.getByText("composition"));
    expect(localStorage.getItem("aiview.prototypeMode")).toBe("composition");
    expect(frame().getAttribute("srcdoc")).toContain(OVERLAY_MARK);
    fireEvent.click(screen.getByText("rendered"));
    expect(frame().getAttribute("srcdoc")).not.toContain(OVERLAY_MARK);
  });

  test("a message from the frame's own window opens the source; others are ignored", async () => {
    const { PrototypeFrame } = await import("./components/viewers/PrototypeFrame.tsx");
    const onOpenSource = vi.fn();
    render(<PrototypeFrame html="<html><body></body></html>" onOpenSource={onOpenSource} />);
    const frame = document.querySelector("iframe")!;
    const data = { type: "aiview:open", file: "tools.prototype.html", component: "ToolPrefix" };
    window.dispatchEvent(new MessageEvent("message", { data, source: null }));
    expect(onOpenSource).not.toHaveBeenCalled();
    window.dispatchEvent(new MessageEvent("message", { data, source: frame.contentWindow }));
    expect(onOpenSource).toHaveBeenCalledWith("tools.prototype.html", "ToolPrefix");
  });

  test("a workbench has no toggle at all (the OS theme), fills the page, and leaves the stored choices for the next prototype", async () => {
    const { PrototypeFrame } = await import("./components/viewers/PrototypeFrame.tsx");
    const { OVERLAY_MARK } = await import("./lib/overlay.ts");
    localStorage.setItem("aiview.viewport", "mobile");
    localStorage.setItem("aiview.prototypeMode", "composition");
    const bindings = { sources: ["tools.prototype.html"], errors: [], warnings: [] };
    render(<PrototypeFrame html="<html><body><p>h</p></body></html>" bindings={bindings} workbench />);
    expect(document.querySelector('[data-component="PrototypeViewportToggle"]')).toBeNull();
    expect(document.querySelector('[data-component="PrototypeModeToggle"]')).toBeNull();
    expect(document.querySelector('[data-component="PrototypeThemeToggle"]')).toBeNull();
    expect(document.querySelector("iframe")!.getAttribute("srcdoc")).not.toContain(OVERLAY_MARK);
    expect((document.querySelector('[data-component="PrototypeStage"] > div') as HTMLElement).style.width).toBe("");
    expect(localStorage.getItem("aiview.viewport")).toBe("mobile");
    expect(localStorage.getItem("aiview.prototypeMode")).toBe("composition");
  });
});

describe("the board page", () => {
  afterEach(() => vi.unstubAllGlobals());

  // aiview's own routes stood in for: /api/board answers an empty board of the repository asked
  const REPO = "C:/repos/one/.git";
  const standInBoard = () => {
    const fetchMock = vi.fn(async (url: string) => {
      const repo = new URL(url, "http://aiview").searchParams.get("repo") ?? REPO;
      const snapshot = { repo, name: "one", runs: [], lock: null, roster: [], events: [], queues: {}, files: [], flags: [] };
      return { ok: true, status: 200, json: async () => ({ repos: [{ repo, name: "one", runs: [] }], snapshot }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const streams: string[] = [];
    vi.stubGlobal(
      "EventSource",
      class {
        onopen = null;
        onerror = null;
        onmessage = null;
        constructor(url: string) {
          streams.push(url);
        }
        close(): void {}
      },
    );
    return { fetchMock, streams };
  };

  test("the board page renders the project's board natively, from aiview's own routes; nothing framed", async () => {
    const { fetchMock, streams } = standInBoard();
    const { BoardPage } = await import("./App.tsx");
    render(<BoardPage repos={[REPO, "C:/repos/two/.git"]} />);
    expect(await screen.findByText("No run on one yet.")).toBeTruthy();
    expect(document.querySelector('[data-component="BoardView"]')!.getAttribute("data-state")).toBe("no run yet");
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/board?project=${encodeURIComponent(REPO)}`);
    expect(streams).toEqual(["/events"]);
    expect(document.querySelector("iframe")).toBeNull();
  });

  test("a project with no repository on its board: No board yet, and nothing asked", async () => {
    const { fetchMock } = standInBoard();
    const { BoardPage } = await import("./App.tsx");
    render(<BoardPage repos={[]} />);
    expect(screen.getByText("No board yet")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // jsdom resolves no stylesheet: the seam is board.css's source, read from disk
  const boardCss = () => readFileSync(`${import.meta.dirname}/components/viewers/board/board.css`, "utf8");

  test("the board takes aiview's theme: no toggle of its own, no ?theme=, no token of aiview's redefined (D12)", async () => {
    standInBoard();
    const { BoardPage } = await import("./App.tsx");
    render(<BoardPage repos={[REPO]} />);
    await screen.findByText("No run on one yet.");
    expect(document.querySelector('[data-component$="ThemeToggle"]')).toBeNull();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    const css = boardCss();
    expect(css).not.toMatch(/data-theme|:root/);
    const aiviewTokens = [...readFileSync(`${import.meta.dirname}/styles.css`, "utf8").matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]);
    for (const token of new Set(aiviewTokens)) expect(css, token).not.toMatch(new RegExp(`(?:^|[{;\\s])${token}\\s*:`));
  });

  test("the board's styles reach only the board: every rule sits under .board", () => {
    // comments and keyframe steps out; what is left before each `{` is a selector or an at-rule
    const css = boardCss()
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/@keyframes[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, "");
    const preludes = [...css.matchAll(/([^{};]+)\{/g)].map((m) => m[1].trim()).filter((p) => !p.startsWith("@"));
    expect(preludes.length).toBeGreaterThan(50);
    for (const prelude of preludes)
      for (const selector of prelude.split(",")) expect(selector.trim(), prelude).toMatch(/^\.board(?:$|[\s.:#[])/);
    expect(css).not.toMatch(/@keyframes (?!board-)/);
  });

  test("the swarm chip has its own placed colour", () => {
    expect(kindHue("swarm")).toBe(110);
  });
});

describe("prototype full screen", () => {
  afterEach(() => {
    delete (HTMLElement.prototype as { requestFullscreen?: unknown }).requestFullscreen;
    delete (document as { exitFullscreen?: unknown }).exitFullscreen;
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
  });

  test("the hover bar asks the browser for full screen on the stage, and leaves it again", async () => {
    const { PrototypeFrame } = await import("./components/viewers/PrototypeFrame.tsx");
    const request = vi.fn(() => Promise.resolve());
    const exit = vi.fn(() => Promise.resolve());
    (HTMLElement.prototype as { requestFullscreen?: unknown }).requestFullscreen = request;
    (document as { exitFullscreen?: unknown }).exitFullscreen = exit;
    render(<PrototypeFrame html="<html><body><p>h</p></body></html>" />);
    const stage = document.querySelector('[data-component="PrototypeStage"]')!;
    const frameBefore = document.querySelector("iframe");

    fireEvent.click(screen.getByLabelText("Full screen"));
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.contexts[0]).toBe(stage);

    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: stage });
    fireEvent(document, new Event("fullscreenchange"));
    expect(stage.getAttribute("data-full")).toBe("native");
    // the same frame, not a new one: the prototype keeps its state
    expect(document.querySelector("iframe")).toBe(frameBefore);

    fireEvent.click(screen.getByLabelText("Exit full screen"));
    expect(exit).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
    fireEvent(document, new Event("fullscreenchange"));
    expect(stage.getAttribute("data-full")).toBeNull();
  });

  test("without the API the stage covers the window, and Escape leaves it", async () => {
    const { PrototypeFrame } = await import("./components/viewers/PrototypeFrame.tsx");
    render(<PrototypeFrame html="<html><body><p>h</p></body></html>" />);
    const stage = document.querySelector('[data-component="PrototypeStage"]')!;
    fireEvent.click(screen.getByLabelText("Full screen"));
    expect(stage.getAttribute("data-full")).toBe("cover");
    expect(stage.className).toContain("fixed");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(stage.getAttribute("data-full")).toBeNull();
  });
});

describe("prototype theme", () => {
  afterEach(() => localStorage.clear());

  const themed = `<html><head><style>:root{--bg:#fff}@media (prefers-color-scheme: dark){:root{--bg:#000}}@media (prefers-color-scheme: light){:root{--bg:#eee}}</style></head><body><p>screen</p></body></html>`;

  test("withTheme rewrites the media condition, never the rules inside it", async () => {
    const { withTheme, THEME_MARK } = await import("./lib/theme.ts");

    // system is a true no-op: a prototype behaves exactly as it does on disk
    expect(withTheme(themed, "system")).toBe(themed);

    const dark = withTheme(themed, "dark");
    expect(dark).toContain("@media (min-width: 0px){:root{--bg:#000}}");
    expect(dark).toContain("@media (max-width: 0px){:root{--bg:#eee}}");
    expect(dark).toContain(THEME_MARK);
    expect(dark).toContain('setAttribute("data-theme","dark")');

    const light = withTheme(themed, "light");
    expect(light).toContain("@media (max-width: 0px){:root{--bg:#000}}");
    expect(light).toContain("@media (min-width: 0px){:root{--bg:#eee}}");

    // the declarations themselves are untouched, whichever way it went
    expect(dark).toContain("--bg:#000");
    expect(light).toContain("--bg:#000");
  });

  test("spacing and case in the media query do not matter, and a file with no body still gets the script", async () => {
    const { withTheme, THEME_MARK } = await import("./lib/theme.ts");
    const odd = `<style>@media (PREFERS-COLOR-SCHEME : dark){b{color:red}}</style>`;
    const out = withTheme(odd, "dark");
    expect(out).toContain("@media (min-width: 0px){b{color:red}}");
    expect(out).toContain(THEME_MARK);
  });

  test("the toggle sits in the toolbar, persists, and forces the frame", async () => {
    const { PrototypeFrame } = await import("./components/viewers/PrototypeFrame.tsx");
    render(<PrototypeFrame html={themed} />);
    const frame = () => document.querySelector("iframe")!;

    // system by default, so the html reaches the frame as written
    expect(frame().getAttribute("srcdoc")).toContain("(prefers-color-scheme: dark)");

    fireEvent.click(screen.getByText("dark"));
    expect(localStorage.getItem("aiview.theme")).toBe("dark");
    expect(frame().getAttribute("srcdoc")).not.toContain("(prefers-color-scheme: dark)");
    expect(frame().getAttribute("srcdoc")).toContain('setAttribute("data-theme","dark")');

    fireEvent.click(screen.getByText("system"));
    expect(frame().getAttribute("srcdoc")).toContain("(prefers-color-scheme: dark)");
  });
});

describe("prototype variants", () => {
  const page = `<html><body><p>screen</p><div class="prototype-bar" data-component="PrototypeBar"><button data-aiview-variant="documents" aria-pressed="true">documents</button><button data-aiview-variant="profile">your profile</button><button data-aiview-action="reset">reset</button></div></body></html>`;

  test("prototypeControls reads variants, the pressed one, and actions from static markup", async () => {
    const { prototypeControls, withBridge, BRIDGE_MARK } = await import("./lib/bridge.ts");
    const c = prototypeControls(page);
    expect(c.variants).toEqual([{ name: "documents", label: "documents" }, { name: "profile", label: "your profile" }]);
    expect(c.initial).toBe("documents");
    expect(c.actions).toEqual([{ name: "reset", label: "reset" }]);
    expect(prototypeControls("<p>plain</p>")).toEqual({ variants: [], initial: null, actions: [] });
    const out = withBridge(page);
    expect(out).toContain(BRIDGE_MARK);
    expect(out).toContain('[data-component="PrototypeBar"],[data-component="MockupBar"]{display:none !important}'); // the legacy bar hides too
    expect(withBridge("<p>plain</p>")).not.toContain(BRIDGE_MARK);
  });

  test("the frame mirrors the variants, drives the page by message, and keeps the choice across a reload", async () => {
    const { PrototypeFrame } = await import("./components/viewers/PrototypeFrame.tsx");
    render(<PrototypeFrame html={page} />);
    const frame = document.querySelector("iframe")!;
    const posted: unknown[] = [];
    vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation((msg: unknown) => { posted.push(msg); });
    expect(screen.getByText("your profile")).toBeTruthy();
    fireEvent.click(screen.getByText("your profile"));
    expect(posted).toEqual([{ type: "aiview:variant", name: "profile" }]);
    fireEvent.click(screen.getByText("reset"));
    expect(posted[1]).toEqual({ type: "aiview:action", name: "reset" });
    // the page reloads (a save on disk): the chosen variant is posted again, the default one is not
    fireEvent.load(frame);
    expect(posted[2]).toEqual({ type: "aiview:variant", name: "profile" });
    fireEvent.click(screen.getByText("documents"));
    posted.length = 0;
    fireEvent.load(frame);
    expect(posted).toEqual([]);
  });

  test("a prototype without controls shows no variant toolbar", async () => {
    const { PrototypeFrame } = await import("./components/viewers/PrototypeFrame.tsx");
    render(<PrototypeFrame html="<html><body><p>h</p></body></html>" />);
    expect(document.querySelector('[data-component="VariantToggle"]')).toBeNull();
    expect(document.querySelector('[data-component="PrototypeActions"]')).toBeNull();
  });
});

describe("useDocuments: the stream is watched, not trusted", () => {
  // A stream that broke without a FIN: still `OPEN`, no error, nothing arriving. The
  // fake stands in for that state, which jsdom's EventSource cannot be put into.
  class FakeEventSource {
    static opened: FakeEventSource[] = [];
    closed = false;
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    url: string;
    constructor(url: string) {
      this.url = url;
      FakeEventSource.opened.push(this);
    }
    close() {
      this.closed = true;
    }
    say(event: unknown) {
      this.onmessage?.({ data: JSON.stringify(event) });
    }
  }

  const documents = { documents: [], groups: {}, projects: {}, recentProject: null, start: null };

  const mount = async () => {
    FakeEventSource.opened = [];
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => documents }) as unknown as Response));
    const { renderHook } = await import("@testing-library/react");
    const { useDocuments } = await import("./hooks/useDocuments.ts");
    return renderHook(() => useDocuments());
  };

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("silence past three heartbeats reconnects, and the open document is reloaded", async () => {
    const { result } = await mount();
    expect(FakeEventSource.opened).toHaveLength(1);
    act(() => { FakeEventSource.opened[0]!.say({ type: "hello" }); });
    expect(result.current.connection).toBe("live");

    act(() => { vi.advanceTimersByTime(46_000); });
    expect(FakeEventSource.opened).toHaveLength(2);
    expect(FakeEventSource.opened[0]!.closed).toBe(true);
    expect(result.current.connection).toBe("reconnecting");
    // a null id reloads whatever document is open: everything missed while it was dead
    expect(result.current.changedTick).toBe(1);
    expect(result.current.changedId).toBeNull();
  });

  test("a heartbeat is what keeps the stream alive, and it says live", async () => {
    const { result } = await mount();
    for (let i = 0; i < 4; i++) {
      act(() => { vi.advanceTimersByTime(14_000); });
      act(() => { FakeEventSource.opened.at(-1)!.say({ type: "ping" }); });
    }
    expect(FakeEventSource.opened).toHaveLength(1);
    expect(result.current.connection).toBe("live");
    expect(result.current.changedTick).toBe(0);
  });
});

// board-split#D41: each tab has its own project, declared on /events; no other tab's switch moves it
describe("useDocuments: the tab's own project", () => {
  class FakeEventSource {
    static opened: FakeEventSource[] = [];
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    url: string;
    constructor(url: string) {
      this.url = url;
      FakeEventSource.opened.push(this);
    }
    close() {}
    say(event: unknown) {
      this.onmessage?.({ data: JSON.stringify(event) });
    }
  }
  const fetchMock = vi.fn(async (url: string) => ({ ok: true, json: async () => (url === "/api/recent-project" ? { project: "beta" } : { documents: [], groups: {}, projects: { alpha: "alpha", beta: "beta" }, recentProject: "alpha", start: null }) }) as unknown as Response);

  const mount = async () => {
    FakeEventSource.opened = [];
    fetchMock.mockClear();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("fetch", fetchMock);
    const { renderHook, waitFor } = await import("@testing-library/react");
    const { useDocuments } = await import("./hooks/useDocuments.ts");
    const hook = renderHook(() => useDocuments());
    await waitFor(() => expect(hook.result.current.projectKnown).toBe(true));
    return hook;
  };
  afterEach(() => vi.unstubAllGlobals());

  test("a new tab takes the most recently active project once and declares it on /events", async () => {
    const { result } = await mount();
    expect(result.current.activeProject).toBe("alpha");
    expect(FakeEventSource.opened.at(-1)!.url).toBe("/events?project=alpha");
  });

  test("another tab's switch moves nothing; the tab's own choice moves it, declared again and recorded", async () => {
    const { result } = await mount();
    act(() => FakeEventSource.opened.at(-1)!.say({ type: "project", slug: "beta" }));
    expect(result.current.activeProject).toBe("alpha");
    act(() => result.current.chooseProject("beta"));
    expect(result.current.activeProject).toBe("beta");
    expect(FakeEventSource.opened.at(-1)!.url).toBe("/events?project=beta");
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/recent-project")).toBe(true);
  });

  test("the agent's open on this tab's project is heard", async () => {
    const { result } = await mount();
    act(() => FakeEventSource.opened.at(-1)!.say({ type: "open", id: 12 }));
    expect(result.current.openTick).toBe(1);
    expect(result.current.openedId).toBe(12);
  });
});

describe("Sidebar footer: the way to the repository", () => {
  const footer = (version?: string | null) => {
    render(
      <Sidebar docs={[doc({ id: 1 })]} groups={{}} projects={{ JOBS: "JOBS" }} activeProject="JOBS"
        connection="live" version={version} currentId={null} onOpen={() => {}} onPickProject={() => {}} />,
    );
    return document.querySelector('[data-component="SidebarFooter"]')!;
  };

  test("the link opens the repository in a new tab and says what a star is for", () => {
    const link = footer("2.0.0").querySelector('[data-component="GitHubLink"]') as HTMLAnchorElement;
    expect(link.textContent).toContain("Star on GitHub");
    expect(link.href).toBe("https://github.com/Ovich/swarmstorm");
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noreferrer");
    expect(link.title).toBe("Swarmstorm on GitHub. A star helps others find it.");
  });

  test("the version is the server's, and is left out when the server has none", () => {
    expect(footer("2.0.0").querySelector('[data-component="Version"]')!.textContent).toBe("v2.0.0");
    cleanup();
    const bare = footer(null);
    expect(bare.querySelector('[data-component="Version"]')).toBeNull();
    expect(bare.querySelector('[data-component="GitHubLink"]')).not.toBeNull();
    expect(bare.textContent).toContain("1 documents");
  });
});

describe("pointing at a prototype's components", () => {
  test("the spotlight is installed once, idle, inside the body", async () => {
    const { withSpotlight, pointMessage, SPOTLIGHT_MARK } = await import("./lib/spotlight.ts");
    const once = withSpotlight("<html><body><p>x</p></body></html>");
    expect(once.indexOf(SPOTLIGHT_MARK)).toBeLessThan(once.indexOf("</body>"));
    expect(withSpotlight(once)).toBe(once);
    expect(pointMessage(["Pill", "Dock"])).toEqual({ type: "aiview:point", names: ["Pill", "Dock"] });
  });

  test("the toolbar says what the agent is pointing at, and the person can stop it", async () => {
    const { PrototypeFrame } = await import("./components/viewers/PrototypeFrame.tsx");
    const onClear = vi.fn();
    const { container, rerender } = render(
      <PrototypeFrame html="<html><body></body></html>" pointed={["ApplicationStrip", "MenuSquare"]} onClearPointer={onClear} />,
    );
    const chip = container.querySelector('[data-component="PointerChip"]')!;
    expect(chip.textContent).toContain("pointing at ApplicationStrip, MenuSquare");
    fireEvent.click(screen.getByLabelText("Stop pointing"));
    expect(onClear).toHaveBeenCalledTimes(1);

    rerender(<PrototypeFrame html="<html><body></body></html>" />);
    expect(container.querySelector('[data-component="PointerChip"]')).toBeNull();
  });
});

// jsdom resolves neither `color-scheme` nor `light-dark()`, so the seam is the stylesheet's
// source: the root declares both schemes, or every light-dark() (the kind chips) reads light
// on a dark OS theme. Read from disk: vitest serves a stylesheet import, `?raw` included, empty.
describe("color scheme", () => {
  test("the root declares both schemes, so light-dark() follows the OS theme", () => {
    const stylesheet = readFileSync(`${import.meta.dirname}/styles.css`, "utf8");
    const root = stylesheet.match(/(?:^|\n):root\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(root).toMatch(/(?:^|[;\s])color-scheme\s*:\s*light\s+dark\s*;/);
  });
});

describe("pinned documents in the menu", () => {
  test("one menu item per kind holding a pin, its documents by title; nothing pinned, nothing shown", async () => {
    const { pinnedByKind, kindPlural } = await import("./components/shell/PinnedNav.tsx");
    const docs = [
      doc({ id: 1, kind: "workbench", title: "B bench", pinned: true }),
      doc({ id: 2, kind: "workbench", title: "A bench", pinned: true }),
      doc({ id: 3, kind: "prototype", title: "Shell", pinned: true }),
      doc({ id: 4, kind: "plan", title: "Not pinned" }),
    ];
    expect(pinnedByKind(docs).map((k) => [k.kind, k.docs.map((d) => d.id)])).toEqual([["prototype", [3]], ["workbench", [2, 1]]]);
    expect(pinnedByKind([doc({})])).toEqual([]);
    expect(kindPlural("workbench")).toBe("Workbenches");
    expect(kindPlural("prototype")).toBe("Prototypes");
  });

  test("the sidebar shows the pinned bench under its kind and opens it on click; the row's pin does not open the row", () => {
    const onOpen = vi.fn();
    const docs = [doc({ id: 9, kind: "workbench", title: "AI bench", pinned: true }), doc({ id: 10, title: "Other" })];
    render(
      <Sidebar docs={docs} groups={{}} projects={{ JOBS: "JOBS" }} activeProject="JOBS"
        connection="live" currentId={null} onOpen={onOpen} onPickProject={() => {}} />,
    );
    fireEvent.click(screen.getByLabelText("Keep the menu open")); // the rail shows icons only
    fireEvent.click(screen.getByLabelText("Workbenches")); // pinned kinds start closed
    const pinnedRow = document.querySelector('[data-component="PinnedDoc"]') as HTMLElement;
    expect(pinnedRow.textContent).toBe("AI bench");
    fireEvent.click(pinnedRow);
    expect(onOpen).toHaveBeenCalledWith(9);
    onOpen.mockClear();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    cleanup();
    render(<DocumentsPage docs={docs} groups={{}} activeProject="JOBS" currentId={null} onOpen={onOpen} />);
    const other = screen.getByText("Other").closest('[data-component="DocItem"]')!;
    fireEvent.click(other.querySelector('[data-component="PinToggle"]')!);
    expect(onOpen).not.toHaveBeenCalled();
    expect((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0]).toBe("/api/pin");
    vi.unstubAllGlobals();
  });
});
