import { useCallback, useEffect, useRef, useState } from "react";
import { fetchBoardOfKey, fetchDocument, fetchProjectBoard, type DocumentResponse } from "./lib/api.ts";
import { boardHash, hashWithBoardRepo, readBoardHash } from "../src/core/boardhash.ts";
import { ALL_PROJECTS, useDocuments } from "./hooks/useDocuments.ts";
import { pointerHash, readPointer, type Pointer } from "../src/core/pointer.ts";
import { Sidebar } from "./components/shell/Sidebar.tsx";
import { TopBar } from "./components/shell/TopBar.tsx";
import { DocumentsPanel } from "./components/docs/DocumentsPage.tsx";
import { DocHeader } from "./components/docs/DocHeader.tsx";
import { MarkdownView } from "./components/viewers/MarkdownView.tsx";
import { PendingCards } from "./components/docs/PendingCards.tsx";
import { PrototypeFrame } from "./components/viewers/PrototypeFrame.tsx";
import { PdfFrame } from "./components/viewers/PdfFrame.tsx";
import { BoardView } from "./components/viewers/board/BoardView.tsx";
import { readRunInHash } from "./lib/board/analytics.ts";

/** The board page's older address, still read; the board's own is its hash, `#board&repo=<key>` (board-split#D41). */
export const BOARD_PATH = "/board";

/** The board page: the project's board, over the repositories its runs were opened in, or that it has none. */
export function BoardPage({ repos }: { repos: string[] | null }) {
  if (repos === null) return null; // still asking
  if (repos.length === 0)
    return (
      <div data-component="EmptyBoard" className="grid place-items-center px-6 py-24 text-center text-muted-foreground">
        <div>
          <div className="mb-1 text-[15px] font-medium text-foreground">No board yet</div>
          Your agent opens one when a plan or a swarm starts in this project.
        </div>
      </div>
    );
  // a link naming a run (`/board#run=<n>`) opens that run's tab, never the latest one
  return <BoardView key={repos.join("\n")} repos={repos} run={readRunInHash(location.hash)} />;
}

/** The hash is the pointer: the document, and what the agent is pointing at in it. */
const hashPointer = (): Pointer | null => readPointer(location.hash);

const folderOf = (p: string): string => p.replace(/[\\/][^\\/]*$/, "");
const baseOf = (p: string): string => p.replace(/^.*[\\/]/, "");

/** The registered document a binding's source file name points at: same folder as the
 *  host, matched by base name. Undefined when the source is not registered. */
export function sourceDocFor<D extends { abs_path: string }>(docs: D[], host: D, file: string): D | undefined {
  const folder = folderOf(host.abs_path);
  return docs.find((d) => folderOf(d.abs_path) === folder && baseOf(d.abs_path) === file);
}

/** Does the reading pane need to fetch?
 *
 *  Two different reasons to load, and they must not be confused:
 *  selecting a different document ALWAYS loads, while a file-change event only
 *  reloads the document it names. The bug this replaced applied the change-event
 *  test to selections too, so once any other document changed on disk, clicking a
 *  new one left the pane showing the old content. */
export function shouldLoad(
  currentId: number | null,
  loadedId: number | null,
  changedTick: number,
  changedId: number | null,
): boolean {
  if (currentId === null) return false;
  if (loadedId !== currentId) return true; // a new selection: always
  return changedTick === 0 || changedId === null || changedId === currentId;
}

/** The Documents view is on, for this tab. */
export const DOCUMENTS_VIEW_KEY = "aiview.documentsView";

export function App() {
  const { docs, groups, projects, activeProject, projectKnown, chooseProject, openTick, openedId, startId, version, connection, changedTick, changedId, dataTick, dataId, shownTick, shown, showDoneTick } = useDocuments();
  const [pointer, setPointer] = useState<Pointer | null>(hashPointer);
  const [currentId, setCurrentId] = useState<number | null>(() => hashPointer()?.id ?? null);
  const [response, setResponse] = useState<DocumentResponse | null>(null);
  const [loading, setLoading] = useState(false);
  /** Which document the pane is actually showing, so a selection is never mistaken
   *  for a refetch of the same one. */
  const loadedId = useRef<number | null>(null);
  /** Set when a document was opened from a Composition label: which component to scroll to. */
  const [sourceTarget, setSourceTarget] = useState<{ id: number; component: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** The page: /board is the active project's board, anything else the documents. */
  const [path, setPath] = useState(() => location.pathname);
  /** The board as the hash names it (D41): null when the hash does not open the board. */
  const [boardKey, setBoardKey] = useState(() => readBoardHash(location.hash));
  useEffect(() => {
    const onPop = () => {
      setPath(location.pathname);
      setBoardKey(readBoardHash(location.hash));
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("hashchange", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("hashchange", onPop);
    };
  }, []);
  const onBoard = path === BOARD_PATH || boardKey !== null;
  const boardRepoKey = boardKey?.repo ?? null;
  // a board tab without a project takes the tab's (the most recently active, at its first load) once, into its hash
  useEffect(() => {
    if (!onBoard || boardRepoKey !== null || !projectKnown || activeProject === ALL_PROJECTS) return;
    history.replaceState(history.state, "", `${location.pathname}${hashWithBoardRepo(location.hash, activeProject)}`);
    setBoardKey({ repo: activeProject });
  }, [onBoard, boardRepoKey, projectKnown, activeProject]);
  /** The board's repositories, asked of the server for the project the hash names (the tab's project follows it);
   *  null while asking. */
  const [boardRepos, setBoardRepos] = useState<string[] | null>(null);
  useEffect(() => {
    if (!onBoard || (boardRepoKey === null && !projectKnown)) return;
    let cancelled = false;
    setBoardRepos(null);
    const asked =
      boardRepoKey !== null
        ? fetchBoardOfKey(boardRepoKey).then((b) => {
            if (!cancelled) chooseProject(b.project);
            return b.repos;
          })
        : fetchProjectBoard(activeProject);
    asked.then((repos) => !cancelled && setBoardRepos(repos)).catch(() => !cancelled && setBoardRepos([]));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onBoard, boardRepoKey, boardRepoKey === null ? activeProject : "", projectKnown]);
  /** The board of `slug`, this tab's project by default, at its scoped address (D41). */
  const showBoard = (slug: string = activeProject) => {
    setDocumentsShown(false);
    history.pushState(null, "", `/${boardHash(slug)}`);
    setPath("/");
    setBoardKey({ repo: slug });
  };
  /** Off the board to `/` with `hash`, as a new history entry. */
  const leaveBoard = (hash: string) => {
    history.pushState(null, "", `/${hash}`);
    setPath("/");
    setBoardKey(null);
  };
  /** The Documents view: the list panel left of the open document. Opening a document from the
   *  panel keeps it; Board or a pinned item from the menu leaves it. Remembered for this tab. */
  const [documentsShown, setDocumentsShownState] = useState(() => {
    try {
      return sessionStorage.getItem(DOCUMENTS_VIEW_KEY) === "1";
    } catch {
      return false;
    }
  });
  const setDocumentsShown = (on: boolean) => {
    setDocumentsShownState(on);
    try {
      sessionStorage.setItem(DOCUMENTS_VIEW_KEY, on ? "1" : "0");
    } catch {
      // storage unavailable: the view lasts this page only
    }
  };
  const showDocuments = () => {
    // a document of another project is not this project's: the view opens on its list alone
    const current = docs.find((d) => d.id === currentId);
    if (current && activeProject !== "*" && current.project !== activeProject) {
      setCurrentId(null);
      setResponse(null);
      loadedId.current = null;
      if (onBoard) leaveBoard("");
      else history.replaceState(null, "", "/");
      setPath("/");
      setDocumentsShown(true);
      return;
    }
    if (onBoard) leaveBoard(currentId !== null ? `#doc=${currentId}` : "");
    setPath("/");
    setDocumentsShown(true);
  };
  /** Where this tab was before the agent's pointer moved it, as a hash: what the person
   *  was reading, and where they go back to once the question is answered. Set by the
   *  first pointer only, so a run of questions returns to the start and not to the
   *  previous question. null: the pointer moved nothing, or the person has moved on. */
  const returnTo = useRef<string | null>(null);

  // The tab owns its project (D41): picking moves this tab alone, and the server hears it.
  const pickProject = useCallback((slug: string) => chooseProject(slug), [chooseProject]);

  const open = useCallback(
    (id: number) => {
      returnTo.current = null; // the person chose where to be: nothing to go back to
      setCurrentId(id);
      if (onBoard) leaveBoard(`#doc=${id}`);
      else location.hash = `doc=${id}`;
      // Opening a document outside the active project moves the mode to it (D9),
      // so the selector never disagrees with what is on screen.
      const target = docs.find((d) => d.id === id);
      if (target && activeProject !== "*" && target.project !== activeProject) pickProject(target.project);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docs, activeProject, pickProject, onBoard],
  );

  // The agent opened a document on this tab's project (`aiview open`, D41): the tab goes to it.
  useEffect(() => {
    if (openTick > 0 && openedId !== null) open(openedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTick]);

  // A Composition label was clicked in the frame: open the source prototype at that component.
  // The source is looked up by base name in the host's folder; an unregistered file gets
  // a toast rather than a silent nothing.
  const openSource = useCallback(
    (file: string, component: string) => {
      const host = response?.document;
      const source = host ? sourceDocFor(docs, host, file) : undefined;
      if (!source) {
        setToast(`${file} is not registered. Register it with: aiview open <path>`);
        return;
      }
      setSourceTarget({ id: source.id, component });
      open(source.id);
    },
    [docs, response, open],
  );

  useEffect(() => {
    if (toast === null) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  // initial doc, on the first load only: hash wins, then the serve --open start doc, then the
  // newest of the active project. Later, an empty pane stays empty until the person picks.
  const initialised = useRef(currentId !== null);
  useEffect(() => {
    if (initialised.current || (startId === null && docs.length === 0)) return;
    initialised.current = true;
    if (currentId !== null) return;
    const id = startId ?? docs.find((d) => d.kind !== "swarm" && (activeProject === "*" || d.project === activeProject))?.id;
    if (id != null) setCurrentId(id);
  }, [startId, docs, currentId, activeProject]);

  useEffect(() => {
    const onHash = () => {
      const p = hashPointer();
      setPointer(p);
      if (p !== null && p.id !== currentId) setCurrentId(p.id);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [currentId]);

  /** Move this tab by its hash, the project following the document as it does for any
   *  document opened from outside the active one. */
  const goTo = (hash: string): void => {
    location.hash = hash;
    const target = docs.find((d) => d.id === readPointer(hash)?.id);
    if (target && activeProject !== "*" && target.project !== activeProject) pickProject(target.project);
  };

  // The agent pointed (`aiview show`): go where the link it printed goes. The hash is the
  // one way in, so a pasted link and a broadcast can never disagree; the project follows
  // as it does for any document opened from outside the active one.
  useEffect(() => {
    if (shownTick === 0 || shown === null) return;
    if (returnTo.current === null) returnTo.current = location.hash.replace(/^#/, "");
    goTo(pointerHash(shown));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownTick]);

  // The question is answered, by the agent's word (`aiview show --done`) or the person's
  // (the chip's cross): back to what they were reading, or the document alone when the
  // pointer moved nothing. A tab the person has since taken elsewhere stays where it is.
  const stopPointing = useCallback(() => {
    const back = returnTo.current;
    returnTo.current = null;
    const here = hashPointer();
    if (back === null && !here?.components.length) return;
    goTo(back || (here ? `doc=${here.id}` : ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, activeProject]);

  useEffect(() => {
    if (showDoneTick > 0) stopPointing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDoneTick]);

  // (re)load the open document — also when the SSE says it changed on disk
  useEffect(() => {
    if (!shouldLoad(currentId, loadedId.current, changedTick, changedId)) return;
    let cancelled = false;
    setLoading(true);
    fetchDocument(currentId!)
      .then((r) => {
        if (cancelled) return;
        setResponse(r);
        loadedId.current = currentId;
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentId, changedTick, changedId]);

  useEffect(() => {
    document.title = response?.document.title ?? "aiview";
  }, [response]);

  // A document reached by a link or on load, outside the active project: the project
  // follows it, as it does when the person opens one (D9). Only on a new document, so
  // picking another project afterwards is not undone.
  const shownDoc = response?.document;
  useEffect(() => {
    if (!onBoard && shownDoc && activeProject !== "*" && activeProject !== "" && shownDoc.project !== activeProject) pickProject(shownDoc.project);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownDoc?.id]);

  const doc = response?.document ?? null;
  const format = response?.format;

  return (
    <div className="flex min-h-screen max-md:flex-col">
      <Sidebar
        docs={docs}
        groups={groups}
        projects={projects}
        activeProject={activeProject}
        connection={connection}
        version={version}
        currentId={currentId}
        onOpen={(id) => {
          setDocumentsShown(false); // Board and the pinned items leave the Documents view
          open(id);
        }}
        onPickProject={pickProject}
        onBoard={() => showBoard()}
        boardShown={onBoard}
        documentsShown={!onBoard && documentsShown}
        onDocuments={showDocuments}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          doc={onBoard ? null : doc}
          here={onBoard ? "Board" : undefined}
          groups={groups}
          printable={!onBoard && format === "markdown"}
          projects={projects}
          activeProject={activeProject}
          allDocs={docs}
          onPickProject={(slug) => {
            // the person switched this tab's project: land on its Board page (D41: no other tab moves)
            pickProject(slug);
            showBoard(slug);
          }}
        />
        <div className="flex min-w-0 flex-1 max-[860px]:flex-col">
        {!onBoard && documentsShown && <DocumentsPanel docs={docs} groups={groups} activeProject={activeProject} currentId={currentId} onOpen={open} />}
        <main
          className={
            onBoard || doc?.kind === "workbench"
              ? "min-w-0 flex-1"
              : format === "markdown"
                ? "mx-auto w-full min-w-0 max-w-[1040px] flex-1 px-10 pb-20 pt-7 max-md:px-4 max-md:pt-5"
                : "min-w-0 flex-1 px-10 pb-20 pt-7 max-md:px-4 max-md:pt-5"
          }
        >
          {onBoard && <BoardPage repos={boardRepos} />}
          {!onBoard && doc === null && !loading && (
            <p className="text-muted-foreground">Pick a document on the left.</p>
          )}
          {!onBoard && doc && (
            <>
              {format === "markdown" && <DocHeader doc={doc} />}
              <PendingCards items={response!.pending ?? []} />
              {response!.content === null && format !== "pdf" && (
                <p className="text-muted-foreground">
                  File is missing on disk: <code className="font-mono text-[12px]">{doc.abs_path}</code>
                </p>
              )}
              {format === "pdf" && <PdfFrame docId={doc.id} changedTick={changedTick} />}
              {format === "html" && response!.content !== null && (
                <PrototypeFrame
                  html={response!.content}
                  bindings={response!.bindings}
                  target={sourceTarget?.id === doc.id ? sourceTarget.component : undefined}
                  onOpenSource={openSource}
                  pointed={pointer?.id === doc.id ? pointer.components : undefined}
                  pointedVariant={pointer?.id === doc.id ? pointer.variant : undefined}
                  onClearPointer={stopPointing}
                  workbench={doc.kind === "workbench"}
                  doc={doc}
                  dataTick={dataId === doc.id ? dataTick : 0}
                />
              )}
              {format === "markdown" && response!.content !== null && (
                <MarkdownView content={response!.content} docId={doc.id} />
              )}
            </>
          )}
        </main>
        </div>
      </div>
      {toast !== null && (
        <div
          data-component="Toast"
          role="status"
          className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-md border border-border bg-background px-4 py-2 text-[12px] text-foreground shadow-lg"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
