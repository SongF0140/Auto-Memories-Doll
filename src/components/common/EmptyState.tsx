"use client";

interface EmptyStateProps {
  title: string;
  description?: string;
}

export default function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="empty-state animate-scale-in">
      <div className="violet-letter-mark mb-4 h-24 w-32 overflow-hidden">
        <div className="absolute left-5 top-6 h-1.5 w-14 rounded-full bg-accent/25" />
        <div className="absolute left-5 top-10 h-1.5 w-20 rounded-full bg-[#b88735]/25" />
        <div className="absolute left-5 top-14 h-1.5 w-12 rounded-full bg-accent/20" />
        <div className="absolute -right-3 -top-3 h-12 w-12 rounded-full bg-[radial-gradient(circle,rgba(184,135,53,0.36),transparent_68%)]" />
        <div className="absolute bottom-4 left-5 h-8 w-8 rounded-full border border-[#b88735]/35 bg-[#f7ead0]/70 shadow-[0_0_22px_rgba(184,135,53,0.22)]" />
        <div className="absolute bottom-6 left-8 h-4 w-10 rounded-full bg-accent/10 blur-sm" />
      </div>
      <p className="empty-state-title">{title}</p>
      {description && <p className="empty-state-desc">{description}</p>}
    </div>
  );
}
