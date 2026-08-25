"use client";

import { ChatMode } from "../../types/api";

interface ChatModeSelectorProps {
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
}

/** 12x12 SVG 图标，与项目淡紫金色调保持一致 */
const Icons = {
  chat: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  ),
  memory: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  ),
  prompt: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  ),
};

export default function ChatModeSelector({ mode, onModeChange }: ChatModeSelectorProps) {
  const modes: { value: ChatMode; label: string; description: string; iconKey: keyof typeof Icons }[] = [
    { value: "chat", label: "对话", description: "通用对话", iconKey: "chat" },
    { value: "memory", label: "记忆", description: "提取并保存记忆", iconKey: "memory" },
    { value: "prompt", label: "提示词", description: "使用提示词模板", iconKey: "prompt" },
  ];

  return (
    <div className="relative flex gap-1 p-1 rounded-2xl bg-muted/50 border border-border">
      {modes.map(({ value, label, description, iconKey }) => {
        const active = mode === value;
        return (
          <button
            key={value}
            onClick={() => onModeChange(value)}
            className={`group relative flex flex-col items-start px-4 py-2.5 rounded-xl text-left transition-all duration-300 ${
              active
                ? "bg-surface shadow-sm border border-border-strong"
                : "bg-transparent border border-transparent hover:bg-surface/60 hover:border-border"
            }`}
            title={description}
          >
            {active && (
              <span className="absolute inset-0 rounded-xl bg-gradient-to-br from-accent/5 to-brand-orange/5 pointer-events-none" />
            )}
            <span
              className={`relative z-10 flex items-center gap-1.5 text-sm font-semibold transition-colors ${
                active ? "text-text-primary" : "text-text-secondary group-hover:text-text-primary"
              }`}
            >
              <span className={active ? "text-accent" : "text-text-tertiary group-hover:text-accent transition-colors"}>
                {Icons[iconKey]}
              </span>
              {label}
            </span>
            <span className="relative z-10 text-[11px] text-text-tertiary mt-0.5 leading-tight">{description}</span>
          </button>
        );
      })}
    </div>
  );
}
