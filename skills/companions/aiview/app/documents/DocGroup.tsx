import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "../lib/utils.ts";
import type { DocumentWithState } from "../lib/api.ts";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible.tsx";
import { DocItem } from "./DocItem.tsx";

/** A piece of work: its title and count as one row, its documents under a rule. No card. */
export function DocGroup({
  title,
  docs,
  currentId,
  showProject = true,
  onOpen,
}: {
  title: string;
  docs: DocumentWithState[];
  currentId: number | null;
  showProject?: boolean;
  onOpen: (id: number) => void;
}) {
  const containsCurrent = docs.some((d) => d.id === currentId);
  const [open, setOpen] = useState(containsCurrent);
  const shown = open || containsCurrent;
  return (
    <Collapsible open={shown} onOpenChange={setOpen} data-component="DocGroup" asChild>
      <div className="mb-px">
        <CollapsibleTrigger asChild>
          <button className="flex h-8 w-full cursor-pointer select-none items-center gap-1.5 rounded-md px-1.5 text-left font-medium hover:bg-surface-2">
            <ChevronRight
              size={14}
              className={cn("shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none", shown && "rotate-90")}
            />
            <span className="min-w-0 truncate">{title}</span>
            <span className="ml-auto pl-2 text-[12px] font-normal text-muted-foreground">{docs.length}</span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mb-1 ml-[13px] border-l border-border pl-1.5">
            {docs.map((d) => (
              <DocItem key={d.id} doc={d} active={d.id === currentId} grouped showProject={showProject} onOpen={onOpen} />
            ))}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
