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
import { SpotlightCard } from "../ui/spotlight-card";
import { MagneticButton } from "../ui/magnetic-button";
import { AppError } from "../../lib/errors";
import { AiEvent } from "../../lib/ai/ai-events";
import { useChatSession } from "./useChatSession";

// Photo by RetroSupply on Unsplash (free to use, no attribution required)
const chatGardenImage = "https://images.unsplash.com/photo-1432821596592-e2c18b78144f?w=1200&q=80";

const display = (memory: MemoryRecord) => ({
  title: memory.titleZh || memory.title,
  tags: memory.tagsZh && memory.tagsZh.length > 0 ? memory.tagsZh : memory.tags,
});

/**
 * 解析 AiEvent SSE 行：data: {"type":"text_delta","content":"..."}\n\n
 */
function parseAiEventLine(line: string): AiEvent | null {
  if (!line.startsWith("data: ")) return null;
  try {
    return JSON.parse(line.slice(6)) as AiEvent;
  } catch {
    return null;
  }
}

export default function ChatInterface() {
  const {
    sessionId,
    messages,
    mode,
    loading,
    sessionIds,
    setMessages,
    setMode,
    setLoading,
    newSession,
    switchSession,
    removeSession,
  } = useChatSession();

  const [relatedMemories, setRelatedMemories] = useState<MemoryRecord[]>([]);
  const [availableMemories, setAvailableMemories] = useState<MemoryRecord[]>([]);
  const [selectedMemoryIds, setSelectedMemoryIds] = useState<Set<string>>(new Set());
  const [degraded, setDegraded] = useState(false);

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
            sessionId,
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

        // 流式响应（AiEvent SSE 格式）
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
              const event = parseAiEventLine(line);
              if (!event) continue;

              switch (event.type) {
                case "text_delta":
                  setMessages((prev) => {
                    const updated = [...prev];
                    const lastIdx = updated.length - 1;
                    const last = updated[lastIdx];
                    if (last && last.role === "assistant") {
                      updated[lastIdx] = {
                        ...last,
                        content: last.content + event.content,
                      };
                    }
                    return updated;
                  });
                  break;
                case "tool_call_start":
                  // 工具调用通知：在消息末尾追加系统提示
                  setMessages((prev) => {
                    const updated = [...prev];
                    const lastIdx = updated.length - 1;
                    const last = updated[lastIdx];
                    if (last && last.role === "assistant") {
                      updated[lastIdx] = {
                        ...last,
                        content: last.content + `\n\n> 正在调用工具: ${event.toolName}...`,
                      };
                    }
                    return updated;
                  });
                  break;
                case "tool_call_result":
                  // 工具结果追加
                  setMessages((prev) => {
                    const updated = [...prev];
                    const lastIdx = updated.length - 1;
                    const last = updated[lastIdx];
                    if (last && last.role === "assistant") {
                      updated[lastIdx] = {
                        ...last,
                        content: last.content + `\n> 工具 ${event.toolName} 完成`,
                      };
                    }
                    return updated;
                  });
                  break;
                case "round_start":
                  // Agent 循环新轮次：追加分隔标记
                  setMessages((prev) => {
                    const updated = [...prev];
                    const lastIdx = updated.length - 1;
                    const last = updated[lastIdx];
                    if (last && last.role === "assistant") {
                      updated[lastIdx] = {
                        ...last,
                        content: last.content + `\n---\n`,
                      };
                    }
                    return updated;
                  });
                  break;
                case "error":
                  streamError += event.message;
                  setDegraded(true);
                  break;
                case "done":
                  if (event.finishReason !== "error") {
                    setDegraded(false);
                  }
                  break;
              }
            }
          }
        }

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
    [messages, mode, sessionId, selectedMemoryIds, setMessages, setLoading],
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
              <div className="flex items-center gap-2">
                <ChatModeSelector mode={mode} onModeChange={setMode} />
                <MagneticButton
                  onClick={newSession}
                  className="h-9 px-3.5 text-xs"
                  title="新建会话"
                >
                  新会话
                </MagneticButton>
              </div>
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
          {/* 会话历史栏 */}
          {sessionIds.length > 1 && (
            <div className="flex items-center gap-1.5 overflow-x-auto px-6 py-2.5 border-b border-border/60">
              {sessionIds.slice(0, 8).map((id) => {
                const isActive = id === sessionId;
                return (
                  <div key={id} className="flex items-center gap-0 shrink-0">
                    <button
                      onClick={() => switchSession(id)}
                      className={`group relative flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full transition-all duration-300 ${
                        isActive
                          ? "bg-accent text-accent-text shadow-md shadow-accent/20"
                          : "bg-surface/60 text-text-tertiary hover:text-text-primary hover:bg-surface border border-transparent hover:border-border"
                      }`}
                      title={id}
                    >
                      {isActive && (
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-text/60 opacity-75" />
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-accent-text" />
                        </span>
                      )}
                      <span className="truncate max-w-[120px]">{id.slice(5, 13)}</span>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeSession(id);
                      }}
                      className="ml-0.5 w-5 h-5 flex items-center justify-center rounded-full text-[11px] text-text-tertiary hover:bg-red-50 hover:text-red-500 transition-colors"
                      title="删除会话"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-6 py-8">
            {/* 降级模式提示 */}
            {degraded && (
              <div className="max-w-3xl mx-auto mb-5 rounded-2xl border border-amber-200/60 bg-amber-50/80 backdrop-blur-xl px-4 py-3 shadow-sm">
                <div className="flex items-start gap-3">
                  <span className="relative flex h-2.5 w-2.5 mt-1.5 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-amber-900">离线模式</p>
                    <p className="text-xs text-amber-700/80 mt-0.5 leading-relaxed">
                      当前 AI API 连接异常，已切换为离线模式。系统会自动重试恢复连接，恢复后将解除此提示。
                    </p>
                  </div>
                </div>
              </div>
            )}
            <div className="max-w-3xl mx-auto space-y-6">
              {messages.length === 0 ? (
                <EmptyState
                  title="开始对话"
                  description="随意提问，或切换到记忆模式提取并保存重要信息。刷新页面后对话历史不会丢失。"
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
          <div className="w-80 lg:w-96 bg-surface/70 border-l border-border/60 backdrop-blur-xl flex flex-col">
            <div className="px-5 py-4 border-b border-border/60">
              <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                选择记忆
                {selectedMemoryIds.size > 0 && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-accent/10 text-accent border border-accent/20">
                    已选 {selectedMemoryIds.size} 条
                  </span>
                )}
              </h3>
              <p className="text-xs text-text-tertiary mt-1">
                {availableMemories.length > 0
                  ? `共 ${availableMemories.length} 条，勾选后作为对话上下文`
                  : "暂无记忆，先去导入一些吧"}
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {availableMemories.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-text-secondary">暂无记忆</p>
                  <p className="text-xs text-text-tertiary mt-1">切换到记忆页面导入内容</p>
                </div>
              ) : (
                availableMemories.map((memory) => {
                  const isSelected = selectedMemoryIds.has(memory.id);
                  return (
                    <SpotlightCard
                      key={memory.id}
                      spotlightColor="rgba(142, 113, 166, 0.10)"
                      className={`p-0 cursor-pointer transition-all duration-300 ${
                        isSelected
                          ? "border-accent/30 bg-accent/[0.04]"
                          : "hover:border-border-strong"
                      }`}
                    >
                      <label className="flex items-start gap-3 p-3 cursor-pointer">
                        <span
                          className={`mt-0.5 h-4 w-4 shrink-0 rounded border transition-all duration-200 flex items-center justify-center ${
                            isSelected
                              ? "bg-accent border-accent"
                              : "border-border bg-surface hover:border-accent/50"
                          }`}
                        >
                          {isSelected && (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 text-accent-text">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </span>
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
                          className="sr-only"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-text-primary truncate">
                            {display(memory).title}
                          </p>
                          <p className="text-xs text-text-tertiary mt-0.5 line-clamp-2">
                            {memory.summaryZh || memory.summary}
                          </p>
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {display(memory).tags.slice(0, 3).map((tag) => (
                              <span
                                key={tag}
                                className="inline-block px-1.5 py-0.5 text-[10px] rounded-full bg-muted/70 text-text-tertiary border border-border/60"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      </label>
                    </SpotlightCard>
                  );
                })
              )}
            </div>

            {relatedMemories.length > 0 && (
              <div className="border-t border-border/60 bg-surface/40">
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
