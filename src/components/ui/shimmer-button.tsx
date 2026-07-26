"use client";

import { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/utils";

interface ShimmerButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

export function ShimmerButton({ children, className, ...props }: ShimmerButtonProps) {
  return (
    <button className={cn("shimmer-button", className)} {...props}>
      <span className="relative z-10">{children}</span>
    </button>
  );
}
