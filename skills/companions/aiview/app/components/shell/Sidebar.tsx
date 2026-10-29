import { useEffect, useRef, useState, type ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen, Star } from "lucide-react";
import { cn } from "../../lib/utils.ts";
import type { DocumentWithState } from "../../lib/api.ts";
import { type ConnectionState } from "../../hooks/useDocuments.ts";
import { LiveIndicator } from "../docs/LiveIndicator.tsx";
import { PinnedNav } from "./PinnedNav.tsx";

export { TAGS_SHOWN } from "../docs/DocumentsPage.tsx";

/** Whether the menu is kept open beside the content, remembered in this browser. */
export const MENU_KEPT_KEY = "aiview.menuKept";
/** A pointer resting this long opens the menu; one passing across it does not. */
export const OPEN_DELAY_MS = 150;
/** A pointer away this long closes it; a slip off the edge does not. */
export const CLOSE_DELAY_MS = 300;

/** The Swarmstorm mark: three agents, linked. */
export function Logo() {
  return (
    <span aria-hidden="true" className="grid h-6 w-6 shrink-0 place-items-center rounded-[7px] bg-accent">
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round">
        <circle cx="4" cy="5" r="1.6" />
        <circle cx="12" cy="4" r="1.6" />
        <circle cx="8" cy="11.5" r="1.6" />
        <path d="M5.4 5.6 6.9 10M10.7 5 9 10.2M5.6 4.8l4.8-.6" />
      </svg>
    </span>
  );
}

function BoardIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0">
      <rect x="2" y="2.5" width="3.5" height="11" rx="1" />
      <rect x="6.5" y="2.5" width="3.5" height="7" rx="1" />
      <rect x="11" y="2.5" width="3" height="9" rx="1" />
    </svg>
  );
}

function DocumentsIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0">
      <path d="M4 1.8h5.5L12.5 5v9.2H4z" />
      <path d="M9.3 1.8V5h3.2M6 8h4.5M6 10.6h4.5" />
    </svg>
  );
}

/** A menu entry: its icon always, its label and count while the menu is open. */
export function NavItem({
  icon,
  label,
  count,
  active,
  onClick,
  title,
  component,
}: {
  icon: ReactNode;
  label: string;
  count?: ReactNode;
  active: boolean;
  onClick: () => void;
  title?: string;
  component: string;
}) {
  return (
    <button
      data-component={component}
      onClick={onClick}
      aria-current={active}
      aria-label={label}
      title={title ?? label}
      className={cn(
        "flex h-8 w-full shrink-0 max-md:w-auto cursor-pointer items-center gap-2.5 overflow-hidden rounded-md px-2 text-left whitespace-nowrap text-muted-foreground hover:bg-surface-2 hover:text-foreground",
        active && "bg-accent-soft font-medium text-accent hover:bg-accent-soft hover:text-accent",
      )}
    >
      {icon}
      <span className="nav-text">{label}</span>
      {count !== undefined && <span className="nav-text ml-auto text-[12px] font-normal">{count}</span>}
    </button>
  );
}

function readKept(): boolean {
  try {
    return localStorage.getItem(MENU_KEPT_KEY) === "1";
  } catch {
    return false;
  }
}

/** The menu: a rail of icons that opens over the content on a resting pointer, or kept open beside it. */
export function Sidebar({
  docs,
  projects,
  activeProject,
  connection,
  version,
  currentId,
  onOpen,
  onBoard,
  boardShown = false,
  documentsShown = false,
  onDocuments,
}: {
  docs: DocumentWithState[];
  groups?: Record<string, string>;
  projects: Record<string, string>;
  activeProject: string;
  connection: ConnectionState;
  version?: string | null;
  currentId: number | null;
  onOpen: (id: number) => void;
  /** Kept for callers; the project is picked in the top bar. */
  onPickProject?: (slug: string) => void;
  /** The Board page is asked for. */
  onBoard?: () => void;
  /** The Board page is what is shown. */
  boardShown?: boolean;
  /** The Documents page is what is shown. */
  documentsShown?: boolean;
  onDocuments?: () => void;
}) {
  // the tab's project alone (board-split#D41): there is no All projects
  const inScope = docs.filter((d) => d.project === activeProject);
  const listed = inScope.filter((d) => d.kind !== "swarm").length;

  const [kept, setKept] = useState(readKept);
  const [hovered, setHovered] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const open = kept || hovered;
  const later = (fn: () => void, ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(fn, ms);
  };
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  // touch has no hover: remember how the last press came, so a tap opens the rail instead
  const lastPointerType = useRef<string>("mouse");
  const menuRef = useRef<HTMLElement | null>(null);
  // a menu opened by a tap closes on a tap outside it
  useEffect(() => {
    if (!hovered || kept || lastPointerType.current === "mouse") return;
    const closeOnTapOutside = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setHovered(false);
    };
    document.addEventListener("pointerdown", closeOnTapOutside);
    return () => document.removeEventListener("pointerdown", closeOnTapOutside);
  }, [hovered, kept]);
  const keep = (next: boolean) => {
    setKept(next);
    setHovered(false);
    try {
      localStorage.setItem(MENU_KEPT_KEY, next ? "1" : "0");
    } catch {
      // storage unavailable: the choice lasts this page only
    }
  };
  // a click in the menu that opens something closes the hovered menu, so the page is seen
  const go = (fn: () => void) => () => {
    fn();
    if (!kept) {
      if (timer.current) clearTimeout(timer.current);
      setHovered(false);
    }
  };

  return (
    <div className={cn("relative shrink-0 max-md:w-full", kept ? "w-[248px]" : "w-14")} data-component="SidebarSlot">
      <aside
        ref={menuRef}
        data-component="Sidebar"
        data-open={open}
        onPointerEnter={(e) => e.pointerType === "mouse" && !kept && later(() => setHovered(true), OPEN_DELAY_MS)}
        onPointerLeave={(e) => e.pointerType === "mouse" && !kept && later(() => setHovered(false), CLOSE_DELAY_MS)}
        onPointerDown={(e) => {
          lastPointerType.current = e.pointerType;
        }}
        onClickCapture={(e) => {
          // a tap on the folded rail opens it, and does not also open what was under the finger
          if (lastPointerType.current === "mouse" || kept || open) return;
          e.preventDefault();
          e.stopPropagation();
          setHovered(true);
        }}
        className={cn(
          "group/menu sticky top-0 z-40 flex h-screen flex-col overflow-hidden border-r border-border bg-surface transition-[width,box-shadow] duration-150 motion-reduce:transition-none max-md:static max-md:h-12 max-md:w-full max-md:flex-row max-md:items-center max-md:border-r-0 max-md:border-b max-md:shadow-none",
          open ? "w-[248px]" : "w-14 [&_.nav-text]:hidden",
          open && !kept && "shadow-(--shadow-pop)",
        )}
      >
        <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-4 font-semibold max-md:border-b-0 max-md:px-3">
          <Logo />
          <span className="nav-text">aiview</span>
          <span className="nav-text ml-auto flex items-center gap-1">
            <LiveIndicator state={connection} />
            <button
              data-component="KeepMenu"
              aria-pressed={kept}
              aria-label={kept ? "Let the menu fold" : "Keep the menu open"}
              title={kept ? "Let the menu fold" : "Keep the menu open"}
              onClick={() => keep(!kept)}
              className="ml-1 grid h-7 w-7 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground"
            >
              {kept ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
            </button>
          </span>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden px-2 pt-3 max-md:flex-row max-md:items-center max-md:overflow-x-auto max-md:overflow-y-hidden max-md:pt-0 max-md:[&>div[aria-hidden]]:hidden" aria-label="Views">
          <NavItem
            component="BoardNav"
            icon={<BoardIcon />}
            label="Board"
            active={boardShown}
            title="The project's swarm board"
            onClick={go(() => onBoard?.())}
          />
          <NavItem
            component="DocumentsNav"
            icon={<DocumentsIcon />}
            label="Documents"
            count={listed}
            active={documentsShown}
            onClick={go(() => onDocuments?.())}
          />
          <PinnedNav docs={inScope} currentId={documentsShown || boardShown ? null : currentId} onOpen={(id) => go(() => onOpen(id))()} folded={!open} />
        </nav>

        <div data-component="SidebarFooter" className="flex h-10 shrink-0 items-center gap-1.5 border-t border-border px-4 text-[12px] max-md:border-t-0 max-md:px-3 text-muted-foreground">
          <span className="nav-text min-w-0 truncate">
            {listed} documents
          </span>
          <span className="flex items-center gap-1.5 whitespace-nowrap group-data-[open=true]/menu:ml-auto">
            {version && (
              <>
                <span className="nav-text tabular-nums" data-component="Version">
                  v{version}
                </span>
                <span className="nav-text" aria-hidden="true">
                  ·
                </span>
              </>
            )}
            <a
              data-component="GitHubLink"
              href="https://github.com/Ovich/swarmstorm"
              target="_blank"
              rel="noreferrer"
              title="Swarmstorm on GitHub. A star helps others find it."
              className="-mx-[3px] -my-0.5 inline-flex items-center gap-[5px] rounded px-[3px] py-0.5 hover:text-foreground focus-visible:text-foreground"
            >
              <Star size={14} aria-hidden="true" className="star-glow fill-star text-star" />
              <span className="nav-text">Star on GitHub</span>
            </a>
          </span>
        </div>
      </aside>
    </div>
  );
}
