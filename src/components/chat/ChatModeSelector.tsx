"use client";

import { ChatMode } from "../../types/api";

interface ChatModeSelectorProps {
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
}

export default function ChatModeSelector({ mode, onModeChange }: ChatModeSelectorProps) {
  const modes: { value: ChatMode; label: string; description: string; icon: string }[] = [
    { value: "chat", label: "对话", description: "通用对话", icon: "💬" },
    { value: "memory", label: "记忆", description: "提取并保存记忆", icon: "✦" },
  ];

  return (
    <div className="flex gap-2 p-1 rounded-2xl bg-muted/50 border border-border">
      {modes.map(({ value, label, description, icon }) => {
        const active = mode === value;
        return (
          <button
            key={value}
            onClick={() => onModeChange(value)}
            className={`relative flex flex-col items-start px-4 py-2.5 rounded-xl text-left transition-all duration-300 ${
              active
                ? "bg-surface shadow-sm border border-border-strong"
                : "bg-transparent border border-transparent hover:bg-surface/60 hover:border-border"
            }`}
            title={description}
          >
            <span
              className={`text-sm font-semibold ${active ? "text-text-primary" : "text-text-secondary"}`}
            >
              <span className="mr-1.5">{icon}</span>
              {label}
            </span>
            <span className="text-xs text-text-tertiary mt-0.5">{description}</span>
          </button>
        );
      })}
    </div>
  );
}
