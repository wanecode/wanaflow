import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius)] text-[0.8125rem] font-semibold tracking-[-0.01em] transition-[background,color,box-shadow,transform] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--paper)] disabled:pointer-events-none disabled:opacity-45 active:translate-y-px [&_svg]:pointer-events-none [&_svg]:size-4",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--ink)] px-4 py-2.5 text-[var(--paper)] shadow-[0_1px_0_rgba(255,255,255,0.16)_inset,0_8px_24px_rgba(26,25,22,0.12)] hover:bg-[var(--ink-soft)]",
        signal:
          "bg-[var(--signal)] px-4 py-2.5 text-white shadow-[var(--shadow-signal)] hover:bg-[var(--signal-strong)]",
        quiet:
          "px-3 py-2 text-[var(--muted-ink)] hover:bg-[var(--wash-strong)] hover:text-[var(--ink)]",
        outline:
          "border border-[var(--line-strong)] bg-[var(--paper)] px-4 py-2.5 text-[var(--ink)] hover:bg-[var(--wash)]",
        danger:
          "bg-[var(--danger-wash)] px-4 py-2.5 text-[var(--danger)] hover:bg-[var(--danger)] hover:text-white",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10",
        lg: "h-12 px-5 text-sm",
        icon: "size-10 p-0",
        "icon-sm": "size-8 p-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
