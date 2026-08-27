"use client";

import React from "react";
import { useState, KeyboardEvent } from "react";

interface ChatInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export default function ChatInput({
  onSend,
  disabled,
  placeholder = "输入消息...",
}: ChatInputProps) {
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
    <div className="border-t border-border bg-white p-5">
      <div className="max-w-3xl mx-auto flex gap-3 items-end">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          className="input flex-1 resize-none"
          rows={1}
          style={{ minHeight: "52px", maxHeight: "180px" }}
        />
        <button
          onClick={handleSubmit}
          disabled={disabled || !content.trim()}
          className="btn h-[52px] px-6"
        >
          发送
        </button>
      </div>
    </div>
  );
}
