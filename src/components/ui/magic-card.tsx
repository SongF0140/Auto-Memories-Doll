"use client";

import { ReactNode, useState } from "react";
import { cn } from "../../lib/utils";

interface MagicCardProps {
  children: ReactNode;
  className?: string;
  glowClassName?: string;
}

export function MagicCard({ children, className, glowClassName }: MagicCardProps) {
  const [position, setPosition] = useState({ x: 50, y: 50 });

  return (
    <div
      className={cn("magic-card group", className)}
      onMouseMove={event => {
        const rect = event.currentTarget.getBoundingClientRect();
        setPosition({
          x: ((event.clientX - rect.left) / rect.width) * 100,
          y: ((event.clientY - rect.top) / rect.height) * 100,
        });
      }}
      style={{
        "--magic-x": `${position.x}%`,
        "--magic-y": `${position.y}%`,
      } as React.CSSProperties}
    >
      <div className={cn("magic-card-glow", glowClassName)} />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
