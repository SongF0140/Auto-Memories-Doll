import { cn } from "../../lib/utils";

interface AnimatedGridPatternProps {
  className?: string;
}

export function AnimatedGridPattern({ className }: AnimatedGridPatternProps) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden opacity-60",
        className
      )}
      aria-hidden="true"
    >
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(137,110,164,0.12)_1px,transparent_1px),linear-gradient(to_bottom,rgba(137,110,164,0.10)_1px,transparent_1px)] bg-[size:54px_54px] [mask-image:radial-gradient(ellipse_at_center,black_0%,transparent_72%)]" />
      <div className="absolute inset-0 animate-grid-drift bg-[radial-gradient(circle_at_1px_1px,rgba(190,149,72,0.22)_1px,transparent_0)] bg-[size:28px_28px] [mask-image:linear-gradient(to_bottom,transparent,black_18%,black_70%,transparent)]" />
    </div>
  );
}
