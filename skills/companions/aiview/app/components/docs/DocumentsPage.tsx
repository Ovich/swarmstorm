import { useState } from "react";
import { ListFilter, Search } from "lucide-react";
import { cn } from "../../lib/utils.ts";
import type { DocumentWithState } from "../../lib/api.ts";
import { useFilters } from "../../hooks/useFilters.ts";
import { sidebarEntries } from "../../hooks/useSidebarEntries.ts";
import { Input } from "../ui/input.tsx";
import { Badge } from "../ui/badge.tsx";
import { KindChip } from "./KindChip.tsx";
import { DocItem } from "./DocItem.tsx";
import { DocGroup } from "./DocGroup.tsx";

/** How many tags show before the rest fold behind "+ n more": the most recent ones. */
export const TAGS_SHOWN = 12;
/** Whether the kind and tag chips are shown, remembered in this browser. */
export const FILTERS_OPEN_KEY = "aiview.filtersOpen";

function FilterLabel({ children }: { children: string }) {
  return <div className="mb-1 mt-2.5 px-0.5 text-[12px] font-medium text-muted-foreground">{children}</div>;
}

function readFiltersOpen(): boolean {
  try {
    return localStorage.getItem(FILTERS_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

/** The Documents view's list, a panel left of the open document: find, the kind and tag
 *  filters folded behind a button, then the groups and documents. */
export function DocumentsPanel({
  docs,
  groups,
  activeProject,
  currentId,
  onOpen,
}: {
  docs: DocumentWithState[];
  groups: Record<string, string>;
  activeProject: string;
  currentId: number | null;
  onOpen: (id: number) => void;
}) {
  // project scope first, so the kind and tag chips below are themselves scoped
  const f = useFilters(docs, activeProject);
  const listed = f.shown.filter((d) => d.kind !== "swarm"); // the board is the menu's Board
  // grouping happens after filtering, so a group shows only its matching members
  const entries = sidebarEntries(listed, groups);
  const kinds = f.allKinds.filter((k) => k !== "swarm");
  const [allTagsOpen, setAllTagsOpen] = useState(false);
  const hidden = Math.max(0, f.allTags.length - TAGS_SHOWN);
  const tagsShown = allTagsOpen ? f.allTags : f.allTags.filter((t, i) => i < TAGS_SHOWN || f.tags.has(t));
  const filtering = f.query !== "" || f.kinds.size > 0 || f.tags.size > 0;
  const [filtersOpen, setFiltersOpen] = useState(readFiltersOpen);
  const toggleFilters = () => {
    const next = !filtersOpen;
    setFiltersOpen(next);
    try {
      localStorage.setItem(FILTERS_OPEN_KEY, next ? "1" : "0");
    } catch {
      // storage unavailable: the choice lasts this page only
    }
  };
  const chosen = f.kinds.size + f.tags.size;
  // at ≤860 an open document comes first: the list folds to one line above it until asked for
  const [narrowListOpen, setNarrowListOpen] = useState(false);
  const foldOnNarrow = currentId !== null && !narrowListOpen ? "max-[860px]:hidden" : "";
  return (
    <section
      data-component="DocumentsPanel"
      aria-label="Documents"
      className="sticky top-12 flex h-[calc(100vh-48px)] w-[300px] shrink-0 flex-col border-r border-border bg-surface max-[860px]:static max-[860px]:h-auto max-[860px]:max-h-[50vh] max-[860px]:w-full max-[860px]:border-b max-[860px]:border-r-0"
    >
      {currentId !== null && (
        <button
          type="button"
          data-component="DocumentsFold"
          aria-expanded={narrowListOpen}
          onClick={() => setNarrowListOpen((o) => !o)}
          className="hidden h-9 w-full cursor-pointer items-center gap-1.5 px-3 text-left text-[13px] text-muted-foreground hover:bg-surface-2 max-[860px]:flex"
        >
          <span className="font-medium text-foreground">Documents</span> · {listed.length} · <span className="text-accent">{narrowListOpen ? "hide" : "show"}</span>
        </button>
      )}
      <div className={cn("px-3 pb-2.5 pt-3", foldOnNarrow)}>
        <div className="flex items-center gap-1.5">
          <div className="relative min-w-0 flex-1">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder={`Find in ${listed.length} documents`} className="pl-8" value={f.query} onChange={(e) => f.setQuery(e.target.value)} />
          </div>
          <button
            type="button"
            data-component="FiltersToggle"
            aria-expanded={filtersOpen}
            aria-label="Kinds and tags"
            title={filtersOpen ? "Hide kinds and tags" : "Filter by kind and tag"}
            onClick={toggleFilters}
            className={cn(
              "flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-md border px-2 text-[12px]",
              filtersOpen || chosen > 0 ? "border-accent/40 bg-accent-soft text-accent" : "border-border text-muted-foreground hover:bg-surface-2 hover:text-foreground",
            )}
          >
            <ListFilter size={14} />
            {chosen > 0 && <span className="font-medium">{chosen}</span>}
          </button>
        </div>
        {filtersOpen && (
          <>
            <FilterLabel>Kind</FilterLabel>
            <div className="flex flex-wrap gap-1" data-component="KindChips">
              {kinds.map((k) => (
                <KindChip key={k} kind={k} dim={f.kinds.size > 0 && !f.kinds.has(k)} onClick={() => f.toggleKind(k)} />
              ))}
            </div>
            {f.allTags.length > 0 && (
              <>
                <FilterLabel>Tags</FilterLabel>
                <div className="flex flex-wrap gap-1" data-component="TagChips">
                  {tagsShown.map((t) => (
                    <Badge key={t} active={f.tags.has(t)} onClick={() => f.toggleTag(t)} role="button" className="cursor-pointer">
                      {t}
                    </Badge>
                  ))}
                  {hidden > 0 && (
                    <button type="button" data-component="TagsMore" className="h-6 cursor-pointer px-2 text-[12px] text-accent hover:underline" onClick={() => setAllTagsOpen((o) => !o)}>
                      {allTagsOpen ? "fewer" : `+ ${hidden} more`}
                    </button>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>

      <div className={cn("flex-1 overflow-y-auto border-t border-border px-2 py-2", foldOnNarrow)} data-component="DocList">
        {listed.length === 0 && (
          <div className="px-2 py-3 text-[12px] text-muted-foreground">
            {docs.length === 0 ? (
              <>
                No documents yet: your agent registers them with
                <code className="mt-1 block rounded bg-surface-2 px-1.5 py-1 font-mono text-[11px]">aiview open &lt;file&gt;</code>
              </>
            ) : filtering ? (
              "No documents match: clear filters?"
            ) : (
              "No documents in this project yet."
            )}
          </div>
        )}
        {entries.map((e) =>
          e.type === "doc" ? (
            <DocItem key={`d${e.doc.id}`} doc={e.doc} active={e.doc.id === currentId} showProject={false} onOpen={onOpen} />
          ) : (
            <DocGroup key={`g${e.slug}`} title={e.title} docs={e.docs} currentId={currentId} showProject={false} onOpen={onOpen} />
          ),
        )}
      </div>
    </section>
  );
}
