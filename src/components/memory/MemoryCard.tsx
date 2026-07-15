"use client";

import { MemoryRecord } from "../../types/memory";

interface MemoryCardProps {
  memory: MemoryRecord;
}

export default function MemoryCard({ memory }: MemoryCardProps) {
  return (
    <article className="card">
      <h3 className="text-base font-semibold text-text-primary leading-tight mb-2">
        {memory.title}
      </h3>
      <p className="text-sm text-text-secondary leading-relaxed mb-4">
        {memory.summary}
      </p>

      {memory.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {memory.tags.map(tag => (
            <span key={tag} className="tag">
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-text-tertiary pt-3 border-t border-border">
        <span className="font-medium uppercase tracking-wide">{memory.sourceType}</span>
        <time dateTime={memory.updatedAt}>
          {new Date(memory.updatedAt).toLocaleDateString()}
        </time>
      </div>
    </article>
  );
}
