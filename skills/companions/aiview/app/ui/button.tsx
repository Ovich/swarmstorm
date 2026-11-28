import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils.ts";

const buttonVariants = cva(
  "inline-flex h-7 items-center gap-1.5 rounded-md text-[12px] font-medium border cursor-pointer transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        outline: "bg-card text-foreground border-border hover:bg-surface-2",
        primary: "bg-accent text-accent-foreground border-accent hover:opacity-90",
        ghost: "border-transparent shadow-none hover:bg-surface-2",
      },
      size: {
        sm: "px-2.5",
        md: "h-8 px-3",
        icon: "w-7 justify-center",
      },
    },
    defaultVariants: { variant: "outline", size: "sm" },
  },
);

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
