"use client";

import { ChatMode } from "../../types/api";

interface ChatModeSelectorProps {
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
}

export default function ChatModeSelector({ mode, onModeChange }: ChatModeSelectorProps) {
  const modes: { value: ChatMode; label: string; description: string }[] = [
    { value: "chat", label: "Chat", description: "Ask anything" },
    { value: "memory", label: "Memory", description: "Extract and save" },
  ];

  return (
    <div className="border-b border-border bg-surface px-4 py-3">
      <div className="max-w-3xl mx-auto flex gap-2">
        {modes.map(({ value, label, description }) => (
          <button
            key={value}
            onClick={() => onModeChange(value)}
            className={`flex flex-col items-start px-3 py-2 rounded border text-left transition-colors ${
              mode === value
                ? "bg-bg border-border-strong"
                : "bg-surface border-transparent hover:bg-bg"
            }`}
            title={description}
          >
            <span className={`text-sm font-medium ${mode === value ? "text-text-primary" : "text-text-secondary"}`}>
              {label}
            </span>
            <span className="text-xs text-text-tertiary">
              {description}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
