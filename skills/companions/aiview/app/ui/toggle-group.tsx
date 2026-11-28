import * as React from "react";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cn } from "../lib/utils.ts";

export function ToggleGroup({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  );
}

export function ToggleGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      className={cn(
        "rounded-md border border-border bg-background px-2 py-0.5 text-[11px] text-foreground cursor-pointer",
        "data-[state=on]:bg-accent data-[state=on]:text-white data-[state=on]:border-accent",
        className,
      )}
      {...props}
    />
  );
}
