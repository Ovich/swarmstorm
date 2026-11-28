import { cn, fmtStart, fmtUpdated, projectName } from "../lib/utils.ts";
import { docActivity } from "../shell/useSidebarEntries.ts";
import type { DocumentWithState } from "../lib/api.ts";
import { KindChip } from "./KindChip.tsx";
import { PinToggle } from "./PinToggle.tsx";

export function DocItem({
  doc,
  active,
  grouped = false,
  showProject = true,
  onOpen,
}: {
  doc: DocumentWithState;
  active: boolean;
  /** Rendered inside a DocGroup, under its rule. */
  grouped?: boolean;
  /** Only in All-projects mode: scoped, it is the same string on every row. */
  showProject?: boolean;
  onOpen: (id: number) => void;
}) {
  return (
    <div
      data-component="DocItem"
      data-grouped={grouped || undefined}
      title={doc.abs_path}
      onClick={() => onOpen(doc.id)}
      onKeyDown={(e) => e.key === "Enter" && onOpen(doc.id)}
      role="button"
      tabIndex={0}
      aria-current={active}
      className={cn(
        "group/doc mb-px flex min-w-0 cursor-pointer flex-col gap-1 rounded-md px-2 py-[7px]",
        active ? "bg-accent-soft" : "hover:bg-surface-2",
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        <span
          className={cn(
            "line-clamp-2 min-w-0 leading-snug",
            active ? "font-medium text-accent" : "text-foreground",
            !doc.exists && "text-muted-foreground line-through",
          )}
        >
          {doc.title ?? "(untitled)"}
        </span>
        <span className="ml-auto mt-px flex shrink-0 items-center gap-1.5">
          <PinToggle
            id={doc.id}
            pinned={doc.pinned}
            className={cn("h-[18px] w-[18px] justify-center", doc.pinned ? "text-accent" : "opacity-0 focus-visible:opacity-100 group-hover/doc:opacity-100")}
          />
          <KindChip kind={doc.kind} />
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-2 text-[12px] text-muted-foreground">
        {showProject && <span className="truncate text-accent">{projectName(doc.project)}</span>}
        <span className="whitespace-nowrap tabular-nums" title={`started ${fmtStart(doc.created_at)}`}>
          updated {fmtUpdated(docActivity(doc))}
        </span>
      </div>
    </div>
  );
}
