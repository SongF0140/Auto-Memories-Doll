import { cn } from "../../lib/utils";

interface AnimatedGridPatternProps {
  className?: string;
}

export function AnimatedGridPattern({ className }: AnimatedGridPatternProps) {
  return (
    <div
      className={cn("pointer-events-none absolute inset-0 overflow-hidden opacity-70", className)}
      aria-hidden="true"
    >
      {/* 波普点阵：暗金色主点 + 棕色副点 */}
      <div
        className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(166,124,0,0.10)_1.5px,transparent_1.5px),radial-gradient(circle_at_12px_12px,rgba(139,115,85,0.07)_1px,transparent_1px)] bg-[size:24px_24px] [mask-image:radial-gradient(ellipse_at_center,black_0%,transparent_75%)]"
      />
      {/* 漂移动画层 */}
      <div className="absolute inset-0 animate-grid-drift bg-[radial-gradient(circle_at_2px_2px,rgba(201,162,39,0.12)_1.5px,transparent_1.5px)] bg-[size:32px_32px] [mask-image:linear-gradient(to_bottom,transparent,black_20%,black_65%,transparent)]" />
    </div>
  );
}
