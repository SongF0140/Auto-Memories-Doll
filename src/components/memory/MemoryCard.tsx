"use client";

import { MemoryRecord } from "../../types/memory";
import { SpotlightCard } from "../ui/spotlight-card";
import Badge from "../common/Badge";

interface MemoryCardProps {
  memory: MemoryRecord;
  compact?: boolean;
  className?: string;
}

export default function MemoryCard({ memory, compact = false, className = "" }: MemoryCardProps) {
  if (compact) {
    return (
      <SpotlightCard className={`p-4 ${className}`}>
        <div className="flex items-start gap-3">
          <div className="w-1.5 h-1.5 rounded-full bg-text-tertiary mt-2 shrink-0" />
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-text-primary leading-tight mb-1 truncate">
              {memory.title}
            </h4>
            <p className="text-xs text-text-secondary line-clamp-2 leading-relaxed">
              {memory.summary}
            </p>
            {memory.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {memory.tags.slice(0, 3).map(tag => (
                  <span key={tag} className="tag text-[10px] px-2 py-0.5">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </SpotlightCard>
    );
  }

  return (
    <SpotlightCard className={className}>
      <div className="flex items-start justify-between gap-4 mb-3">
        <h3 className="text-lg font-semibold text-text-primary leading-tight">
          {memory.title}
        </h3>
        <Badge>{memory.sourceType}</Badge>
      </div>

      <p className="text-base text-text-secondary leading-relaxed mb-4">
        {memory.summary}
      </p>

      {memory.tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          {memory.tags.map(tag => (
            <span key={tag} className="tag">
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between pt-4 border-t border-border text-sm text-text-tertiary">
        <div className="flex items-center gap-2">
          <span>Version {memory.version}</span>
          {memory.heatScore > 0 && (
            <>
              <span className="w-1 h-1 rounded-full bg-text-tertiary" />
              <span>Heat {memory.heatScore.toFixed(1)}</span>
            </>
          )}
        </div>
        <time dateTime={memory.updatedAt}>
          {new Date(memory.updatedAt).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </time>
      </div>
    </SpotlightCard>
  );
}
