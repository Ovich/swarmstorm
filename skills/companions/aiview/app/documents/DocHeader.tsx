import { fmtStart, fmtUpdated, projectName } from "../lib/utils.ts";
import type { Document } from "../lib/api.ts";
import { KindChip } from "./KindChip.tsx";

export function DocHeader({ doc }: { doc: Document }) {
  return (
    <div data-component="DocHeader" className="mb-6">
      <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
        <KindChip kind={doc.kind} />
        <span className="tabular-nums">started {fmtStart(doc.created_at)}</span>
        <span className="text-faint-foreground">·</span>
        {doc.tags.map((t) => (
          <span key={t} className="rounded-full bg-surface-2 px-2 text-[12px] leading-5">{t}</span>
        ))}
        {doc.tags.length > 0 && <span className="text-faint-foreground">·</span>}
        <span>{projectName(doc.project)}</span>
        <span className="text-faint-foreground">·</span>
        <span >updated {fmtUpdated(doc.last_seen_at)}</span>
      </div>
    </div>
  );
}
