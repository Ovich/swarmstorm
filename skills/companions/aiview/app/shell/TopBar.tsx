import type { Document, DocumentWithState } from "../lib/api.ts";
import { Button } from "../ui/button.tsx";
import { cn } from "../lib/utils.ts";
import { DocPath } from "../documents/DocPath.tsx";
import { ProjectSelector } from "./ProjectSelector.tsx";
import { PinToggle } from "../documents/PinToggle.tsx";

/** The 48px bar over the content: project / group / document, then the document's tools. */
export function TopBar({
  doc,
  here: hereOverride,
  groups,
  printable,
  projects,
  activeProject,
  allDocs,
  onPickProject,
}: {
  doc: Document | null;
  /** The crumb when no document is shown (the empty board). */
  here?: string;
  groups: Record<string, string>;
  printable: boolean;
  projects: Record<string, string>;
  activeProject: string;
  allDocs: DocumentWithState[];
  onPickProject: (slug: string) => void;
}) {
  const groupTitle = doc?.group_slug ? (groups[doc.group_slug] ?? doc.group_slug) : null;
  const here = hereOverride ?? (doc ? (doc.kind === "swarm" ? "Board" : (doc.title ?? "(untitled)")) : null);
  return (
    <header
      data-component="TopBar"
      className="topbar sticky top-0 z-20 flex h-12 min-w-0 shrink-0 items-center gap-2 border-b border-border bg-card px-4 max-md:px-3"
    >
      <div className="min-w-0 shrink max-sm:min-w-[112px] max-sm:max-w-[45%] [&_button]:max-w-full">
        <ProjectSelector projects={projects} active={activeProject} docs={allDocs} onPick={onPickProject} />
      </div>
      <span className="flex min-w-0 shrink items-center gap-2 font-medium max-md:flex-1 max-md:overflow-hidden">
        {groupTitle && (
          <>
            <span className="text-muted-foreground">/</span>
            <span className="truncate text-muted-foreground max-lg:hidden">{groupTitle}</span>
          </>
        )}
        {here && (
          <>
            <span className="text-muted-foreground">/</span>
            <span className="truncate">{here}</span>
          </>
        )}
      </span>
      <div className="ml-auto flex min-w-0 items-center gap-1.5 max-md:shrink-0">
        {doc && doc.kind !== "swarm" && (
          <PinToggle id={doc.id} pinned={doc.pinned} label className={cn("h-7 shrink-0 px-2 text-[12px] hover:bg-surface-2 max-sm:gap-0 max-sm:text-[0px]", doc.pinned && "text-accent")} />
        )}
        {doc && doc.kind !== "swarm" && (
          <span className="flex min-w-0 max-md:w-7 max-md:shrink-0 max-md:overflow-hidden">
            <DocPath path={doc.abs_path} />
          </span>
        )}
        {printable && (
          <Button variant="outline" className="max-sm:hidden" onClick={() => window.print()} title="Export to PDF via the browser print dialog">
            Export PDF
          </Button>
        )}
      </div>
    </header>
  );
}
