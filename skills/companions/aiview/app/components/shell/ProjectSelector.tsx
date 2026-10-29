import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils.ts";
import type { DocumentWithState } from "../../lib/api.ts";

/** The project's colour square: a stable hue from its slug. */
export function ProjectDot({ slug }: { slug: string }) {
  let h = 0;
  for (const c of slug) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <span
      aria-hidden="true"
      className="h-2 w-2 shrink-0 rounded-[2px]"
      style={{ background: `hsl(${h} 62% 52%)` }}
    />
  );
}

/** The topbar's first crumb: what everything on screen is scoped to, and the menu to change it. */
export function ProjectSelector({
  projects,
  active,
  docs,
  onPick,
}: {
  /** slug -> display title. */
  projects: Record<string, string>;
  active: string;
  /** Every document, unscoped: the counts are the point of the menu. */
  docs: DocumentWithState[];
  onPick: (slug: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [find, setFind] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const slugs = Object.keys(projects).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  // one project at a time (board-split#D41): there is no All projects
  const count = (slug: string) => docs.filter((d) => d.project === slug).length;
  const label = (slug: string) => projects[slug] ?? slug;
  const rows = slugs.filter((s) => !find || label(s).toLowerCase().includes(find.toLowerCase()));

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const pick = (slug: string) => {
    setOpen(false);
    setFind("");
    if (slug !== active) onPick(slug);
  };

  return (
    <div ref={box} className="relative" data-component="ProjectSelector">
      <button
        className={cn(
          "flex h-[30px] max-w-[260px] cursor-pointer items-center gap-2 rounded-md px-2 font-medium hover:bg-surface-2",
          open && "bg-surface-2",
        )}
        aria-label={`Project: ${label(active)}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <ProjectDot slug={active} />
        <span className="min-w-0 truncate">{label(active)}</span>
        <span className="text-[12px] font-normal text-muted-foreground">{count(active)}</span>
        <ChevronDown size={13} className="shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div
          data-component="ProjectMenu"
          className="absolute left-0 top-[calc(100%+6px)] z-30 w-[280px] rounded-lg border border-border bg-card p-2.5 font-normal shadow-(--shadow-pop)"
        >
          <input
            type="search"
            autoFocus
            placeholder="Find a project"
            aria-label="Find a project"
            value={find}
            onChange={(e) => setFind(e.target.value)}
            className="mb-1.5 h-[30px] w-full rounded-md border border-border bg-background px-2 text-[13px] outline-none focus:border-accent"
          />
          <div className="max-h-[60vh] overflow-y-auto">
            {rows.map((slug) => (
              <button
                key={slug}
                onClick={() => pick(slug)}
                aria-current={slug === active}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-md p-1.5 text-left hover:bg-surface-2",
                  slug === active && "bg-accent-soft text-accent hover:bg-accent-soft",
                )}
              >
                <ProjectDot slug={slug} />
                <span className="min-w-0 truncate">{label(slug)}</span>
                <span className="ml-auto text-[12px] text-muted-foreground">{count(slug)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
