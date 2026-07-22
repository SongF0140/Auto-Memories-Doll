"use client";

import { cn } from "../../lib/utils";

interface AuroraBackgroundProps {
  className?: string;
  children?: React.ReactNode;
}

export function AuroraBackground({ className, children }: AuroraBackgroundProps) {
  return (
    <div
      className={cn(
        "relative flex flex-col min-h-screen overflow-hidden bg-bg",
        className
      )}
    >
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute -top-[40%] -left-[20%] w-[80%] h-[80%] rounded-full opacity-40 animate-glow-pulse"
          style={{
            background: "radial-gradient(circle, rgba(200, 185, 160, 0.35) 0%, transparent 60%)",
            filter: "blur(80px)",
            animationDuration: "10s",
          }}
        />
        <div
          className="absolute top-[30%] -right-[20%] w-[70%] h-[70%] rounded-full opacity-30 animate-glow-pulse"
          style={{
            background: "radial-gradient(circle, rgba(180, 165, 140, 0.3) 0%, transparent 60%)",
            filter: "blur(100px)",
            animationDuration: "12s",
            animationDelay: "2s",
          }}
        />
        <div
          className="absolute -bottom-[20%] left-[20%] w-[60%] h-[60%] rounded-full opacity-30 animate-glow-pulse"
          style={{
            background: "radial-gradient(circle, rgba(220, 205, 180, 0.25) 0%, transparent 60%)",
            filter: "blur(90px)",
            animationDuration: "14s",
            animationDelay: "4s",
          }}
        />
      </div>
      {children}
    </div>
  );
}
