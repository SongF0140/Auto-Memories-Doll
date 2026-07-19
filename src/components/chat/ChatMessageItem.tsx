"use client";

import { ChatMessage } from "../../types/api";
import Avatar from "../common/Avatar";

interface ChatMessageItemProps {
  message: ChatMessage;
}

export default function ChatMessageItem({ message }: ChatMessageItemProps) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  if (isSystem) {
    return (
      <div className="flex justify-center py-2">
        <div className="bg-error-bg border border-error-bg text-error px-4 py-2 rounded-lg text-sm">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""} animate-fade-in`}>
      <Avatar name={isUser ? "You" : "AI"} size="md" />
      <div className={`max-w-[80%] ${isUser ? "items-end" : "items-start"} flex flex-col gap-1`}>
        <div
          className={`px-5 py-3 rounded-2xl text-base leading-relaxed ${
            isUser
              ? "bg-accent text-accent-text rounded-tr-sm"
              : "bg-surface border border-border rounded-tl-sm shadow-sm"
          }`}
        >
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
        <span className="text-xs text-text-tertiary px-1">
          {isUser ? "You" : "Assistant"}
        </span>
      </div>
    </div>
  );
}
