"use client";

import { useState, useCallback } from "react";
import { ChatMessage, ChatMode } from "../../types/api";
import ChatMessageItem from "./ChatMessageItem";
import ChatInput from "./ChatInput";
import ChatModeSelector from "./ChatModeSelector";

export default function ChatInterface() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [mode, setMode] = useState<ChatMode>("chat");
  const [loading, setLoading] = useState(false);

  const handleSend = useCallback(async (content: string) => {
    if (!content.trim()) return;

    const newMessage: ChatMessage = { role: "user", content };
    setMessages(prev => [...prev, newMessage]);
    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, newMessage],
          mode,
          sessionId: "default",
        }),
      });

      const result = await response.json();

      if (response.ok) {
        setMessages(prev => [
          ...prev,
          { role: "assistant", content: result.content },
        ]);
      } else {
        setMessages(prev => [
          ...prev,
          { role: "system", content: `Error: ${result.error}` },
        ]);
      }
    } catch (error) {
      setMessages(prev => [
        ...prev,
        { role: "system", content: `Network error: ${(error as Error).message}` },
      ]);
    } finally {
      setLoading(false);
    }
  }, [messages, mode]);

  return (
    <div className="flex flex-col h-full">
      <ChatModeSelector mode={mode} onModeChange={setMode} />

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto space-y-5">
          {messages.length === 0 ? (
            <div className="empty-state min-h-[200px]">
              <p>Start a conversation</p>
            </div>
          ) : (
            messages.map((message, index) => (
              <ChatMessageItem key={index} message={message} />
            ))
          )}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-surface border border-border px-4 py-3 rounded">
                <div className="loading-dots">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <ChatInput onSend={handleSend} disabled={loading} />
    </div>
  );
}
