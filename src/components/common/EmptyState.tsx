"use client";

interface EmptyStateProps {
  title: string;
  description?: string;
}

export default function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="empty-state animate-scale-in">
      <div className="card mb-4 mx-auto flex h-24 w-32 items-center justify-center overflow-hidden bg-muted/50">
        <div className="text-4xl text-brand-blue/30">📝</div>
      </div>
      <p className="empty-state-title">{title}</p>
      {description && <p className="empty-state-desc">{description}</p>}
    </div>
  );
}
