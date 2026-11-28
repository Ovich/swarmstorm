import * as React from "react";
import { cn } from "../lib/utils.ts";

/** Tag chip base: the quiet pill. Kind chips are the coloured KindChip component. */
export function Badge({
  className,
  active = false,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { active?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center whitespace-nowrap rounded-full border px-2 text-[12px]",
        active ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-surface-2 hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}
