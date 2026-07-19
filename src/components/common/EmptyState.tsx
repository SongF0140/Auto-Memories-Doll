"use client";

interface EmptyStateProps {
  title: string;
  description?: string;
}

export default function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-2">
        <div className="w-5 h-5 rounded-full border-2 border-border-strong border-t-text-tertiary animate-spin" />
      </div>
      <p className="empty-state-title">{title}</p>
      {description && <p className="empty-state-desc">{description}</p>}
    </div>
  );
}
