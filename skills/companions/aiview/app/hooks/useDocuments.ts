import { useCallback, useEffect, useRef, useState } from "react";
import { fetchDocuments, setActiveProject as postActiveProject, type DocumentWithState } from "../lib/api.ts";
import type { Pointer } from "../../src/core/pointer.ts";
import { reloadOnNewBuild } from "../lib/build.ts";

export type ConnectionState = "connecting" | "live" | "reconnecting";

export const ALL_PROJECTS = "*";

/** Nothing heard for this long means the stream is dead, whatever the browser thinks.
 *  Three server heartbeats (src/server/sse.ts), so one lost beat is not a reconnect. */
export const SILENCE_MS = 45_000;

/** Has the stream gone quiet? An EventSource whose socket broke without a FIN stays
 *  `OPEN` and fires no error, so silence is the only evidence there is. */
export const isSilent = (lastSeenMs: number, nowMs: number, timeoutMs = SILENCE_MS): boolean =>
  nowMs - lastSeenMs >= timeoutMs;

export interface DocumentsState {
  docs: DocumentWithState[];
  groups: Record<string, string>;
  projects: Record<string, string>;
  /** This tab's project (board-split#D41): the most recently active one at its first load, then what the tab
   *  chose; another tab's switch never moves it. `*` = All projects. */
  activeProject: string;
  /** Sets this tab's project: it declares it on `/events`, and the server records it as the most recently active. */
  chooseProject: (slug: string) => void;
  /** The tab has its project: false until the first list or the tab's own choice. */
  projectKnown: boolean;
  startId: number | null;
  /** The collection's version, or null when the server could not read one. */
  version: string | null;
  connection: ConnectionState;
  /** Bumped whenever the given doc id changed on disk — viewers key refetches off it. */
  changedTick: number;
  changedId: number | null;
  /** Bumped when a workbench's sidecar data was committed; never refetches the document. */
  dataTick: number;
  dataId: number | null;
  /** Bumped whenever the agent points at a prototype's components (`aiview show`). */
  shownTick: number;
  shown: Pointer | null;
  /** Bumped when the agent says the pointing is over (`aiview show --done`). */
  showDoneTick: number;
  /** Bumped when the agent opened a document on this tab's project (`aiview open`, D41). */
  openTick: number;
  openedId: number | null;
  reload: () => void;
}

export function useDocuments(): DocumentsState {
  const [docs, setDocs] = useState<DocumentWithState[]>([]);
  const [groups, setGroups] = useState<Record<string, string>>({});
  const [projects, setProjects] = useState<Record<string, string>>({});
  const [activeProject, setActiveProject] = useState<string>(ALL_PROJECTS);
  const [projectKnown, setProjectKnown] = useState(false);
  const [startId, setStartId] = useState<number | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [changed, setChanged] = useState<{ tick: number; id: number | null }>({ tick: 0, id: null });
  const [dataChanged, setDataChanged] = useState<{ tick: number; id: number | null }>({ tick: 0, id: null });
  const [shown, setShown] = useState<{ tick: number; pointer: Pointer | null }>({ tick: 0, pointer: null });
  const [showDoneTick, setShowDoneTick] = useState(0);
  const [opened, setOpened] = useState<{ tick: number; id: number | null }>({ tick: 0, id: null });
  const loadedOnce = useRef(false);
  /** The tab's project as the stream declares it; null until the tab has one. */
  const tabProject = useRef<string | null>(null);
  /** Reconnects the stream, declaring the tab's project anew. */
  const reconnect = useRef<() => void>(() => {});

  const chooseProject = useCallback((slug: string) => {
    if (tabProject.current === slug) return;
    tabProject.current = slug;
    setActiveProject(slug);
    setProjectKnown(true);
    reconnect.current();
    postActiveProject(slug).catch(() => {});
  }, []);

  const reload = useCallback(() => {
    fetchDocuments()
      .then((data) => {
        setDocs(data.documents);
        setGroups(data.groups);
        setProjects(data.projects);
        // a new tab takes the most recently active project, once (D41); its own choice holds after
        if (tabProject.current === null) {
          tabProject.current = data.activeProject;
          setActiveProject(data.activeProject);
          setProjectKnown(true);
          reconnect.current();
        }
        setVersion(data.version ?? null);
        if (!loadedOnce.current) {
          setStartId(data.start);
          loadedOnce.current = true;
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    reload();
    let es: EventSource | null = null;
    let lastSeen = Date.now();

    const connect = (): void => {
      es?.close();
      lastSeen = Date.now();
      const project = tabProject.current;
      es = new EventSource(project ? `/events?project=${encodeURIComponent(project)}` : "/events");
      es.onopen = () => setConnection("live");
      es.onerror = () => setConnection("reconnecting");
      es.onmessage = (e) => {
        lastSeen = Date.now();
        const ev = JSON.parse(e.data) as { type: string; id?: number; slug?: string; components?: string[]; variant?: string; build?: string };
        if (ev.type === "hello") reloadOnNewBuild(ev.build);
        if (ev.type === "hello" || ev.type === "ping") setConnection("live");
        if (ev.type === "changed") {
          reload();
          setChanged((c) => ({ tick: c.tick + 1, id: ev.id ?? null }));
        }
        // A document was registered, moved, re-tagged or dropped by the CLI: the list
        // itself moved, so refetch it. This is what makes a new document appear without
        // a manual refresh — `changed` only fires for files already being watched.
        if (ev.type === "index") reload();
        // A workbench's data moved, not its page: the bench refreshes itself, no reload.
        if (ev.type === "data-changed") setDataChanged((d) => ({ tick: d.tick + 1, id: ev.id ?? null }));
        // The agent is pointing at a prototype's components: this tab goes there.
        if (ev.type === "show" && typeof ev.id === "number") {
          const pointer: Pointer = { id: ev.id, components: ev.components ?? [], ...(ev.variant ? { variant: ev.variant } : {}) };
          setShown((s) => ({ tick: s.tick + 1, pointer }));
        }
        if (ev.type === "show-done") setShowDoneTick((t) => t + 1);
        // The agent opened a document on this tab's project (D41); the server sends it to no other tab.
        if (ev.type === "open" && typeof ev.id === "number") setOpened((o) => ({ tick: o.tick + 1, id: ev.id! }));
        // `project` (another tab's or the CLI's switch) moves no tab (D41): each tab keeps its own.
      };
    };
    reconnect.current = () => {
      setConnection("reconnecting");
      connect();
    };
    connect();

    // The watchdog. A broken socket that never sent a FIN leaves the EventSource `OPEN`
    // and silent, so no error ever fires and the tab shows stale documents while the
    // sidebar says "live". Silence past three heartbeats is taken as death: reconnect,
    // and catch up on everything missed — the list, and the open document, which a null
    // `id` reloads whatever it is.
    const watchdog = setInterval(() => {
      if (!isSilent(lastSeen, Date.now())) return;
      setConnection("reconnecting");
      reconnect.current = () => {
      setConnection("reconnecting");
      connect();
    };
    connect();
      reload();
      setChanged((c) => ({ tick: c.tick + 1, id: null }));
    }, SILENCE_MS / 3);

    return () => {
      clearInterval(watchdog);
      es?.close();
    };
  }, [reload]);

  return {
    docs,
    groups,
    projects,
    activeProject,
    chooseProject,
    projectKnown,
    startId,
    version,
    connection,
    changedTick: changed.tick,
    changedId: changed.id,
    dataTick: dataChanged.tick,
    dataId: dataChanged.id,
    shownTick: shown.tick,
    shown: shown.pointer,
    showDoneTick,
    openTick: opened.tick,
    openedId: opened.id,
    reload,
  };
}
