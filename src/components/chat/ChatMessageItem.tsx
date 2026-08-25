"use client";

import { ChatMessage } from "../../types/api";
import Avatar from "../common/Avatar";

interface ChatMessageItemProps {
  message: ChatMessage;
}

/** 18x18 系统错误图标 */
const AlertIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

export default function ChatMessageItem({ message }: ChatMessageItemProps) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  if (isSystem) {
    return (
      <div className="flex justify-center py-2 animate-fade-in">
        <div className="flex items-center gap-2.5 bg-error-bg/80 border border-error/10 text-error px-4 py-2.5 rounded-2xl text-sm shadow-sm">
          <AlertIcon />
          <span>{message.content}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""} animate-fade-in`}>
      <Avatar name={isUser ? "You" : "AI"} size="md" className={isUser ? "ring-2 ring-accent/20" : "ring-2 ring-brand-blue/20"} />
      <div className={`max-w-[80%] ${isUser ? "items-end" : "items-start"} flex flex-col gap-1`}>
        <div
          className={`relative px-5 py-3.5 rounded-2xl text-base leading-relaxed transition-shadow duration-300 ${
            isUser
              ? "bg-gradient-to-br from-accent to-accent-hover text-accent-text rounded-tr-sm shadow-md shadow-accent/15"
              : "bg-surface border border-border rounded-tl-sm shadow-sm hover:shadow-md"
          }`}
        >
          {!isUser && (
            <span className="absolute -top-px -left-px h-full w-full rounded-2xl rounded-tl-sm pointer-events-none bg-gradient-to-br from-accent/5 via-transparent to-brand-orange/5 opacity-60" />
          )}
          <p className="whitespace-pre-wrap relative z-10">{message.content}</p>
        </div>
        <span className="text-[11px] text-text-tertiary px-1 font-medium">{isUser ? "你" : "助手"}</span>
      </div>
    </div>
  );
}
