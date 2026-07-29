"use client";

import { useState, useCallback, useEffect } from "react";
import { ChatMessage, ChatMode } from "../../types/api";
import { MemoryRecord } from "../../types/memory";
import ChatMessageItem from "./ChatMessageItem";
import ChatInput from "./ChatInput";
import ChatModeSelector from "./ChatModeSelector";
import MemoryCard from "../memory/MemoryCard";
import EmptyState from "../common/EmptyState";
import { MagicCard } from "../ui/magic-card";
import { AppError } from "../../lib/errors";

// Photo by RetroSupply on Unsplash (free to use, no attribution required)
const chatGardenImage = "https://images.unsplash.com/photo-1432821596592-e2c18b78144f?w=1200&q=80";

const display = (memory: MemoryRecord) => ({
  title: memory.titleZh || memory.title,
  tags: memory.tagsZh && memory.tagsZh.length > 0 ? memory.tagsZh : memory.tags,
});

function parseDataStreamLine(line: string): { type: "text" | "error" | "unknown"; value: string } {
  const separatorIndex = line.indexOf(":");
  if (separatorIndex === -1) return { type: "unknown", value: "" };

  const type = line.slice(0, separatorIndex);
  const raw = line.slice(separatorIndex + 1);

  if (type === "0") {
    try {
      return { type: "text", value: JSON.parse(raw) as string };
    } catch {
      return { type: "text", value: raw };
    }
  }

  if (type === "3") {
    try {
      return { type: "error", value: JSON.parse(raw) as string };
    } catch {
      return { type: "error", value: raw };
    }
  }

  return { type: "unknown", value: "" };
}

export default function ChatInterface() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [mode, setMode] = useState<ChatMode>("chat");
  const [loading, setLoading] = useState(false);
  const [relatedMemories, setRelatedMemories] = useState<MemoryRecord[]>([]);
  const [availableMemories, setAvailableMemories] = useState<MemoryRecord[]>([]);
  const [selectedMemoryIds, setSelectedMemoryIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchAvailableMemories();
  }, []);

  const fetchAvailableMemories = async () => {
    try {
      const res = await fetch("/api/memory?pageSize=100");
      if (res.ok) {
        const data = await res.json();
        setAvailableMemories(data.items || []);
      }
    } catch (e) {
      console.error("Failed to fetch available memories:", e);
    }
  };

  const handleSend = useCallback(
    async (content: string) => {
      if (!content.trim()) return;

      const newMessage: ChatMessage = { role: "user", content };
      const currentMessages = [...messages, newMessage];
      setMessages(currentMessages);
      setLoading(true);

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: currentMessages,
            mode,
            sessionId: "default",
            memoryIds: selectedMemoryIds.size > 0 ? Array.from(selectedMemoryIds) : undefined,
          }),
        });

        const contentType = response.headers.get("content-type") || "";

        // 非 2xx 或 JSON 响应按错误/记忆保存处理
        if (!response.ok || contentType.includes("application/json")) {
          const result = await response.json();
          if (response.ok) {
            setMessages((prev) => [...prev, { role: "assistant", content: result.content }]);

            if (mode === "memory" && result.memoryReferences?.length > 0) {
              fetchRelatedMemories(result.memoryReferences);
            }
          } else {
            setMessages((prev) => [
              ...prev,
              { role: "system", content: `错误: ${result.error || "未知错误"}` },
            ]);
          }
          setLoading(false);
          return;
        }

        // 流式响应（Vercel AI SDK 数据流格式）
        if (!response.body) {
          throw new AppError("NO_RESPONSE_BODY", "无响应体");
        }

        setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let done = false;
        let streamError = "";

        while (!done) {
          const { value, done: readerDone } = await reader.read();
          done = readerDone;
          if (value) {
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (!line) continue;
              const parsed = parseDataStreamLine(line);
              if (parsed.type === "text") {
                setMessages((prev) => {
                  const updated = [...prev];
                  const lastIdx = updated.length - 1;
                  const last = updated[lastIdx];
                  if (last && last.role === "assistant") {
                    updated[lastIdx] = {
                      ...last,
                      content: last.content + parsed.value,
                    };
                  }
                  return updated;
                });
              } else if (parsed.type === "error" && parsed.value) {
                streamError += parsed.value;
              }
            }
          }
        }

        // 若流中包含错误，将空 assistant 消息替换为 system 错误
        if (streamError) {
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last && last.role === "assistant" && !last.content.trim()) {
              updated[updated.length - 1] = {
                role: "system",
                content: `流式响应错误: ${streamError}`,
              };
            }
            return updated;
          });
        }
      } catch (error) {
        setMessages((prev) => [
          ...prev,
          { role: "system", content: `网络错误: ${(error as Error).message}` },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [messages, mode, selectedMemoryIds],
  );

  const fetchRelatedMemories = async (ids: string[]) => {
    try {
      const memories = await Promise.all(
        ids.map((id) => fetch(`/api/memory/${id}`).then((r) => (r.ok ? r.json() : null))),
      );
      setRelatedMemories(memories.filter(Boolean) as MemoryRecord[]);
    } catch (error) {
      console.error("Failed to fetch related memories:", error);
    }
  };

  return (
    <div className="flex h-full flex-col bg-transparent">
      <div className="px-6 py-5">
        <MagicCard className="mx-auto max-w-6xl overflow-hidden p-0">
          <div className="grid items-stretch gap-0 lg:grid-cols-[1fr_320px]">
            <div className="flex items-center justify-between gap-6 p-5">
              <div className="flex items-center gap-4">
                <div className="violet-letter-mark hidden h-20 w-28 shrink-0 md:block">
                  <div className="absolute left-5 top-5 h-1.5 w-12 rounded-full bg-accent/25" />
                  <div className="absolute left-5 top-9 h-1.5 w-16 rounded-full bg-[#b88735]/25" />
                  <div className="absolute left-5 top-[52px] h-1.5 w-10 rounded-full bg-accent/20" />
                </div>
                <div>
                  <h2 className="section-title text-gradient">对话</h2>
                  <p className="section-subtitle mt-1">
                    {mode === "memory" ? "提取并保存有意义的记忆" : "与你的 AI 伙伴对话"}
                  </p>
                </div>
              </div>
              <ChatModeSelector mode={mode} onModeChange={setMode} />
            </div>
            <div className="relative hidden min-h-[132px] overflow-hidden lg:block">
              <img
                src={chatGardenImage}
                alt="淡紫花园、信件与打字机的动漫感背景"
                className="h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-[#f6f0df]/72 via-[#f6f0df]/18 to-transparent" />
            </div>
          </div>
        </MagicCard>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto px-6 py-8">
            <div className="max-w-3xl mx-auto space-y-6">
              {messages.length === 0 ? (
                <EmptyState
                  title="开始对话"
                  description="随意提问，或切换到记忆模式提取并保存重要信息。"
                />
              ) : (
                messages.map((message, index) => <ChatMessageItem key={index} message={message} />)
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
            placeholder={mode === "memory" ? "分享值得记住的内容..." : "输入你的消息..."}
          />
        </div>

        {mode === "memory" && (
          <div className="w-80 lg:w-96 bg-surface border-l border-border flex flex-col">
            <div className="px-5 py-4 border-b border-border">
              <h3 className="text-sm font-semibold text-text-primary">
                选择记忆
                {selectedMemoryIds.size > 0 && (
                  <span className="ml-2 text-xs font-normal text-accent">
                    已选 {selectedMemoryIds.size} 条
                  </span>
                )}
              </h3>
              <p className="text-xs text-text-tertiary mt-0.5">
                {availableMemories.length > 0
                  ? `共 ${availableMemories.length} 条，勾选后作为对话上下文`
                  : "暂无记忆，先去导入一些吧"}
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {availableMemories.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-text-secondary">暂无记忆</p>
                  <p className="text-xs text-text-tertiary mt-1">切换到记忆页面导入内容</p>
                </div>
              ) : (
                availableMemories.map((memory) => {
                  const isSelected = selectedMemoryIds.has(memory.id);
                  return (
                    <label
                      key={memory.id}
                      className={`flex items-start gap-3 p-2.5 rounded-lg cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-accent/10 border border-accent/30"
                          : "hover:bg-muted border border-transparent"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {
                          setSelectedMemoryIds((prev) => {
                            const next = new Set(prev);
                            if (isSelected) {
                              next.delete(memory.id);
                            } else {
                              next.add(memory.id);
                            }
                            return next;
                          });
                        }}
                        className="mt-0.5 h-4 w-4 rounded accent-accent"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-text-primary truncate">
                          {display(memory).title}
                        </p>
                        <p className="text-xs text-text-tertiary mt-0.5 line-clamp-2">
                          {memory.summaryZh || memory.summary}
                        </p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {display(memory).tags.slice(0, 3).map((tag) => (
                            <span
                              key={tag}
                              className="inline-block px-1.5 py-0.5 text-[10px] rounded bg-muted text-text-tertiary"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </label>
                  );
                })
              )}
            </div>

            {relatedMemories.length > 0 && (
              <div className="border-t border-border">
                <div className="px-5 py-3">
                  <h3 className="text-sm font-semibold text-text-primary">相关记忆</h3>
                  <p className="text-xs text-text-tertiary mt-0.5">
                    {relatedMemories.length} 条关联记忆
                  </p>
                </div>
                <div className="px-3 pb-3 space-y-2">
                  {relatedMemories.map((memory) => (
                    <MemoryCard key={memory.id} memory={memory} compact />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
