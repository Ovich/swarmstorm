import { Pin, PinOff } from "lucide-react";
import { cn } from "../lib/utils.ts";
import { setPinned } from "../lib/api.ts";

/** Pins a document to the menu, or takes it off. The server tells every tab; nothing local to keep. */
export function PinToggle({ id, pinned, className, label = false }: { id: number; pinned: boolean; className?: string; label?: boolean }) {
  const Icon = pinned ? PinOff : Pin;
  return (
    <button
      type="button"
      data-component="PinToggle"
      aria-pressed={pinned}
      aria-label={pinned ? "Unpin from the menu" : "Pin to the menu"}
      title={pinned ? "Unpin from the menu" : "Pin to the menu"}
      onClick={(e) => {
        e.stopPropagation(); // on a row, the click pins; it does not open
        setPinned(id, !pinned).catch(() => {});
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className={cn("inline-flex cursor-pointer items-center gap-1.5 rounded-md text-muted-foreground hover:text-foreground", className)}
    >
      <Icon size={14} strokeWidth={1.75} />
      {label && (pinned ? "Unpin" : "Pin")}
    </button>
  );
}
