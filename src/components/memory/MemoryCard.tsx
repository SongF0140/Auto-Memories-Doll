"use client";

import { MemoryRecord } from "../../types/memory";
import { MagicCard } from "../ui/magic-card";
import Badge from "../common/Badge";

interface MemoryCardProps {
  memory: MemoryRecord;
  compact?: boolean;
  className?: string;
}

export default function MemoryCard({ memory, compact = false, className = "" }: MemoryCardProps) {
  if (compact) {
    return (
      <MagicCard className={`p-4 ${className}`}>
        <div className="flex items-start gap-3">
          <div className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[radial-gradient(circle,#b88735_0%,#8a6aa4_70%)] shadow-[0_0_18px_rgba(184,135,53,0.45)]" />
          <div className="min-w-0">
            <h4 className="mb-1 truncate text-sm font-semibold leading-tight text-text-primary">
              {memory.title}
            </h4>
            <p className="line-clamp-2 text-xs leading-relaxed text-text-secondary">
              {memory.summary}
            </p>
            {memory.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {memory.tags.slice(0, 3).map(tag => (
                  <span key={tag} className="tag px-2 py-0.5 text-[10px]">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </MagicCard>
    );
  }

  return (
    <MagicCard className={`p-5 ${className}`}>
      <div className="mb-3 flex items-start justify-between gap-4">
        <h3 className="text-lg font-semibold leading-tight text-text-primary">
          {memory.title}
        </h3>
        <Badge>{memory.sourceType}</Badge>
      </div>

      <p className="mb-4 text-base leading-relaxed text-text-secondary">
        {memory.summary}
      </p>

      {memory.tags.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-2">
          {memory.tags.map(tag => (
            <span key={tag} className="tag">
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border pt-4 text-sm text-text-tertiary">
        <div className="flex items-center gap-2">
          <span>版本 {memory.version}</span>
          {memory.heatScore > 0 && (
            <>
              <span className="h-1 w-1 rounded-full bg-text-tertiary" />
              <span>热度 {memory.heatScore.toFixed(1)}</span>
            </>
          )}
        </div>
        <time dateTime={memory.updatedAt}>
          {new Date(memory.updatedAt).toLocaleDateString("zh-CN", {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </time>
      </div>
    </MagicCard>
  );
}
