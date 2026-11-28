import { cn } from "../lib/utils.ts";
import type { ConnectionState } from "./useDocuments.ts";

/** Green dot while live reload is connected. */
export function LiveIndicator({ state }: { state: ConnectionState }) {
  const live = state === "live";
  return (
    <span
      data-component="LiveIndicator"
      className="ml-auto flex items-center gap-1.5 text-[12px] font-normal text-muted-foreground"
      title={live ? "live reload connected" : "reconnecting…"}
    >
      <span className={cn("h-2 w-2 rounded-full", live ? "bg-ok" : "bg-warn")} />
      {live ? "live" : "reconnecting…"}
    </span>
  );
}
