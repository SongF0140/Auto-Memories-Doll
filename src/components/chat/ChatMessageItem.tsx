"use client";

import { ChatMessage } from "../../types/api";

interface ChatMessageItemProps {
  message: ChatMessage;
}

export default function ChatMessageItem({ message }: ChatMessageItemProps) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] sm:max-w-[75%] px-4 py-3 rounded text-sm leading-relaxed ${
          isUser
            ? "bg-accent text-accent-text"
            : isSystem
            ? "bg-error-bg text-error border border-error-bg"
            : "bg-surface border border-border text-text-primary"
        }`}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>
      </div>
    </div>
  );
}
