"use client";

import { useState, KeyboardEvent } from "react";

interface ChatInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
}

export default function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [content, setContent] = useState("");

  const handleSubmit = () => {
    const trimmed = content.trim();
    if (!disabled && trimmed) {
      onSend(trimmed);
      setContent("");
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="border-t border-border bg-surface p-4">
      <div className="flex gap-3 max-w-3xl mx-auto items-end">
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder="Type a message..."
          className="input flex-1 resize-none"
          rows={1}
          style={{ minHeight: "44px", maxHeight: "160px" }}
        />
        <button
          onClick={handleSubmit}
          disabled={disabled || !content.trim()}
          className="btn h-[44px] px-5"
        >
          Send
        </button>
      </div>
    </div>
  );
}
