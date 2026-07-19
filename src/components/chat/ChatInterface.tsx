"use client";

import { useState, useCallback } from "react";
import { ChatMessage, ChatMode } from "../../types/api";
import { MemoryRecord } from "../../types/memory";
import ChatMessageItem from "./ChatMessageItem";
import ChatInput from "./ChatInput";
import ChatModeSelector from "./ChatModeSelector";
import MemoryCard from "../memory/MemoryCard";
import EmptyState from "../common/EmptyState";

export default function ChatInterface() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [mode, setMode] = useState<ChatMode>("chat");
  const [loading, setLoading] = useState(false);
  const [relatedMemories, setRelatedMemories] = useState<MemoryRecord[]>([]);

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

        if (mode === "memory" && result.memoryReferences?.length > 0) {
          fetchRelatedMemories(result.memoryReferences);
        }
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

  const fetchRelatedMemories = async (ids: string[]) => {
    try {
      const memories = await Promise.all(
        ids.map(id => fetch(`/api/memory/${id}`).then(r => r.ok ? r.json() : null))
      );
      setRelatedMemories(memories.filter(Boolean) as MemoryRecord[]);
    } catch (error) {
      console.error("Failed to fetch related memories:", error);
    }
  };

  return (
    <div className="flex flex-col h-full bg-bg">
      <div className="bg-surface border-b border-border px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h2 className="section-title">Conversation</h2>
            <p className="section-subtitle mt-1">
              {mode === "memory" ? "Extract and store meaningful memories" : "Chat with your AI companion"}
            </p>
          </div>
          <ChatModeSelector mode={mode} onModeChange={setMode} />
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto px-6 py-8">
            <div className="max-w-3xl mx-auto space-y-6">
              {messages.length === 0 ? (
                <EmptyState
                  title="Start a conversation"
                  description="Ask anything or switch to Memory mode to extract and save important details."
                />
              ) : (
                messages.map((message, index) => (
                  <ChatMessageItem key={index} message={message} />
                ))
              )}

              {loading && (
                <div className="flex gap-3 animate-fade-in">
                  <div className="avatar">AI</div>
                  <div className="bg-surface border border-border rounded-2xl rounded-tl-sm px-5 py-3 shadow-sm">
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

          <ChatInput
            onSend={handleSend}
            disabled={loading}
            placeholder={mode === "memory" ? "Share something worth remembering..." : "Type your message..."}
          />
        </div>

        {mode === "memory" && (
          <div className="w-96 bg-surface border-l border-border flex flex-col hidden xl:flex">
            <div className="px-5 py-4 border-b border-border">
              <h3 className="text-sm font-semibold text-text-primary">Related Memories</h3>
              <p className="text-xs text-text-tertiary mt-0.5">
                {relatedMemories.length > 0 ? `${relatedMemories.length} memory connected` : "Memories will appear here"}
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {relatedMemories.length === 0 ? (
                <div className="text-center py-8">
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                    <span className="text-text-tertiary text-lg">+</span>
                  </div>
                  <p className="text-sm text-text-secondary">No related memories yet</p>
                  <p className="text-xs text-text-tertiary mt-1">Send a message to extract memories</p>
                </div>
              ) : (
                relatedMemories.map(memory => (
                  <MemoryCard key={memory.id} memory={memory} compact />
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
