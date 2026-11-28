import * as React from "react";
import { cn } from "../lib/utils.ts";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-8 w-full rounded-md border border-border bg-background px-2.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-accent",
        className,
      )}
      {...props}
    />
  );
}
