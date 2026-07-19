"use client";

import { ChatMode } from "../../types/api";

interface ChatModeSelectorProps {
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
}

export default function ChatModeSelector({ mode, onModeChange }: ChatModeSelectorProps) {
  const modes: { value: ChatMode; label: string; description: string }[] = [
    { value: "chat", label: "Chat", description: "General conversation" },
    { value: "memory", label: "Memory", description: "Extract & save memories" },
  ];

  return (
    <div className="flex gap-2">
      {modes.map(({ value, label, description }) => (
        <button
          key={value}
          onClick={() => onModeChange(value)}
          className={`flex flex-col items-start px-4 py-2.5 rounded-xl border text-left transition-all ${
            mode === value
              ? "bg-surface border-border-strong shadow-sm"
              : "bg-transparent border-transparent hover:bg-surface hover:border-border"
          }`}
          title={description}
        >
          <span className={`text-sm font-semibold ${mode === value ? "text-text-primary" : "text-text-secondary"}`}>
            {label}
          </span>
          <span className="text-xs text-text-tertiary mt-0.5">
            {description}
          </span>
        </button>
      ))}
    </div>
  );
}
