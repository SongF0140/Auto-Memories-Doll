"use client";

interface EmptyStateProps {
  title: string;
  description?: string;
}

export default function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="empty-state animate-scale-in">
      <div className="relative w-20 h-20 mb-4">
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-border-strong/40 to-border/20 animate-glow-pulse" />
        <div className="absolute inset-0 flex items-center justify-center">
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-text-tertiary"
          >
            <path d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z" />
            <circle cx="12" cy="12" r="3" className="text-text-secondary" />
            <path d="M12 7v-2" />
            <path d="M12 19v-2" />
            <path d="M7 12h-2" />
            <path d="M19 12h-2" />
          </svg>
        </div>
        <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-accent/10 animate-float" />
        <div className="absolute -bottom-2 -left-2 w-4 h-4 rounded-full bg-border-strong/50 animate-float" style={{ animationDelay: "1s" }} />
      </div>
      <p className="empty-state-title">{title}</p>
      {description && <p className="empty-state-desc">{description}</p>}
    </div>
  );
}
