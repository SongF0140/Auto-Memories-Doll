"use client";

/* eslint-disable no-console -- 聊天网络异常需要保留浏览器端诊断信息。 */

import React from "react";
import { useState, useCallback, useEffect } from "react";
import { ChatMessage, MemoryListResponse } from "../../types/api";
import { MemoryRecord } from "../../types/memory";
import ChatMessageItem from "./ChatMessageItem";
import ChatInput from "./ChatInput";
import ChatModeSelector from "./ChatModeSelector";
import MemoryCard from "../memory/MemoryCard";
import EmptyState from "../common/EmptyState";
import { AppError } from "../../lib/errors";
import { requestApi } from "../../lib/api-client";
import { AiEvent } from "../../lib/ai/ai-events";
import { getMemoryClient } from "../../lib/memory-api-client";
import { useChatSession } from "./useChatSession";

type ChatJsonResult = {
  content?: unknown;
  memoryReferences?: Array<string | { memoryId?: string }>;
  error?: string | { message?: string };
};

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
    hydrating,
    sessionError,
    sessionIds,
    setMessages,
    setMode,
    setLoading,
    refreshSessions,
    newSession,
    switchSession,
    removeSession,
  } = useChatSession();

  const [relatedMemories, setRelatedMemories] = useState<MemoryRecord[]>([]);
  const [availableMemories, setAvailableMemories] = useState<MemoryRecord[]>([]);
  const [selectedMemoryIds, setSelectedMemoryIds] = useState<Set<string>>(new Set());
  const [degraded, setDegraded] = useState(false);
  const [memoryPickerOpen, setMemoryPickerOpen] = useState(false);

  useEffect(() => {
    fetchAvailableMemories();
  }, []);

  const fetchAvailableMemories = async () => {
    try {
      const response = await requestApi<MemoryListResponse>("/api/memory?pageSize=100");
      setAvailableMemories(response.data.items);
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
          const result = (await response.json()) as ChatJsonResult;
          if (response.ok) {
            const assistantContent =
              typeof result.content === "string" ? result.content : "请求已处理。";
            setMessages((prev) => [...prev, { role: "assistant", content: assistantContent }]);

            const memoryReferences = result.memoryReferences ?? [];
            if (mode === "memory" && memoryReferences.length > 0) {
              const referenceIds = memoryReferences.flatMap((reference) => {
                if (typeof reference === "string") return [reference];
                return reference.memoryId ? [reference.memoryId] : [];
              });
              void fetchRelatedMemories(referenceIds);
            }
          } else {
            const errorMessage =
              typeof result.error === "string" ? result.error : result.error?.message || "未知错误";
            setMessages((prev) => [...prev, { role: "system", content: `错误: ${errorMessage}` }]);
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
        void refreshSessions();
      }
    },
    [messages, mode, sessionId, selectedMemoryIds, setMessages, setLoading, refreshSessions],
  );

  const fetchRelatedMemories = async (ids: string[]) => {
    try {
      const memories = await Promise.all(ids.map((id) => getMemoryClient(id).catch(() => null)));
      setRelatedMemories(memories.filter(Boolean) as MemoryRecord[]);
    } catch (error) {
      console.error("Failed to fetch related memories:", error);
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-col bg-white">
      <div className="px-4 py-4 sm:px-6 sm:py-5">
        <div
          className="mx-auto max-w-6xl overflow-hidden rounded-xl border p-0"
          style={{
            borderColor: "var(--color-border-default)",
            background: "var(--color-bg)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <div className="grid items-stretch gap-0 lg:grid-cols-1">
            <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between lg:gap-6 lg:p-5">
              <div className="flex min-w-0 items-center gap-4">
                <div>
                  <h2
                    className="text-xl font-semibold tracking-tight"
                    style={{ color: "var(--color-text-primary)" }}
                  >
                    对话
                  </h2>
                  <p className="text-sm mt-1" style={{ color: "var(--color-text-tertiary)" }}>
                    {mode === "memory" ? "提取并保存有意义的记忆" : "与你的 AI 伙伴对话"}
                  </p>
                </div>
              </div>
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                <ChatModeSelector mode={mode} onModeChange={setMode} />
                <div className={`grid gap-2 ${mode === "memory" ? "grid-cols-2" : "grid-cols-1"}`}>
                  {mode === "memory" && (
                    <button
                      type="button"
                      onClick={() => setMemoryPickerOpen((open) => !open)}
                      className="btn h-9 px-3.5 text-xs lg:hidden"
                      aria-expanded={memoryPickerOpen}
                      aria-controls="mobile-memory-picker"
                    >
                      {memoryPickerOpen ? "收起记忆" : "选择记忆"}
                      {selectedMemoryIds.size > 0 ? ` · ${selectedMemoryIds.size}` : ""}
                    </button>
                  )}
                  <button
                    onClick={newSession}
                    disabled={loading || hydrating}
                    className="btn h-9 px-3.5 text-xs"
                    title="新建会话"
                  >
                    新会话
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
        <div className="flex-1 flex flex-col min-w-0">
          {/* 会话历史栏 */}
          {sessionIds.length > 1 && (
            <div className="flex items-center gap-1.5 overflow-x-auto border-b border-border/60 px-4 py-2.5 sm:px-6">
              {sessionIds.slice(0, 8).map((id) => {
                const isActive = id === sessionId;
                return (
                  <div key={id} className="flex items-center gap-0 shrink-0">
                    <button
                      onClick={() => void switchSession(id)}
                      disabled={loading || hydrating}
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
                        void removeSession(id);
                      }}
                      disabled={loading || hydrating}
                      className="ml-0.5 w-5 h-5 flex items-center justify-center rounded-full text-[11px] text-text-tertiary hover:bg-error-bg hover:text-error transition-colors"
                      title="删除会话"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8">
            {/* 降级模式提示 */}
            {degraded && (
              <div className="max-w-3xl mx-auto mb-5 rounded-xl border border-warning-bg bg-warning-bg px-4 py-3 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="relative flex-shrink-0 mt-0.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warning opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-warning" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-warning">离线模式</p>
                    <p className="text-xs text-warning/80 mt-0.5 leading-relaxed">
                      当前 AI API
                      连接异常，已切换为离线模式。系统会自动重试恢复连接，恢复后将解除此提示。
                    </p>
                  </div>
                </div>
              </div>
            )}
            {sessionError && (
              <div className="max-w-3xl mx-auto mb-5 rounded-2xl border border-error/30 bg-error-bg px-4 py-3 text-sm text-error">
                {sessionError}
              </div>
            )}
            <div className="max-w-3xl mx-auto space-y-6">
              {hydrating ? (
                <EmptyState
                  title="正在恢复会话"
                  description="正在从本地 JSONL 会话记录读取历史消息。"
                />
              ) : messages.length === 0 ? (
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
            disabled={loading || hydrating}
            placeholder={mode === "memory" ? "分享值得记住的内容..." : "输入你的消息..."}
          />
        </div>

        {mode === "memory" && (
          <div
            id="mobile-memory-picker"
            className={`order-first max-h-64 w-full shrink-0 flex-col border-b bg-gray-50 lg:order-none lg:flex lg:max-h-none lg:w-96 lg:border-b-0 lg:border-l ${
              memoryPickerOpen ? "flex" : "hidden"
            }`}
            style={{ borderColor: "var(--color-border-default)" }}
          >
            <div
              className="px-5 py-4 border-b"
              style={{ borderColor: "var(--color-border-default)" }}
            >
              <h3
                className="text-sm font-semibold flex items-center gap-2"
                style={{ color: "var(--color-text-primary)" }}
              >
                选择记忆
                {selectedMemoryIds.size > 0 && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-[rgba(166,124,0,0.10)] text-[#A67C00] border border-[rgba(166,124,0,0.25)]">
                    已选 {selectedMemoryIds.size} 条
                  </span>
                )}
              </h3>
              <p className="text-xs mt-1" style={{ color: "var(--color-text-tertiary)" }}>
                {availableMemories.length > 0
                  ? `共 ${availableMemories.length} 条，勾选后作为对话上下文`
                  : "暂无记忆，先去导入一些吧"}
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {availableMemories.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
                    暂无记忆
                  </p>
                  <p className="text-xs mt-1" style={{ color: "var(--color-text-tertiary)" }}>
                    切换到记忆页面导入内容
                  </p>
                </div>
              ) : (
                availableMemories.map((memory) => {
                  const isSelected = selectedMemoryIds.has(memory.id);
                  return (
                    <div
                      key={memory.id}
                      className={`p-0 cursor-pointer transition-all duration-200 rounded-xl border ${
                        isSelected
                          ? "border-[#D4B84A] bg-[rgba(166,124,0,0.06)]"
                          : "border-[#E8E0D4] hover:border-[#D4C8B5] bg-white"
                      }`}
                      style={{ boxShadow: "var(--shadow-card)" }}
                    >
                      <label className="flex items-start gap-3 p-3 cursor-pointer">
                        <span
                          className={`mt-0.5 h-4 w-4 shrink-0 rounded border transition-all duration-200 flex items-center justify-center ${
                            isSelected
                              ? "bg-[#A67C00] border-[#A67C00]"
                              : "border-[#E8E0D4] bg-white hover:border-[#C9A227]"
                          }`}
                        >
                          {isSelected && (
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="3"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="w-3 h-3 text-white"
                            >
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
                          <p
                            className="text-sm font-medium truncate"
                            style={{ color: "var(--color-text-primary)" }}
                          >
                            {display(memory).title}
                          </p>
                          <p
                            className="text-xs mt-0.5 line-clamp-2"
                            style={{ color: "var(--color-text-tertiary)" }}
                          >
                            {memory.summaryZh || memory.summary}
                          </p>
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {display(memory)
                              .tags.slice(0, 3)
                              .map((tag) => (
                                <span
                                  key={tag}
                                  className="inline-block px-1.5 py-0.5 text-[10px] rounded-full bg-gray-100 text-gray-500 border border-gray-200"
                                >
                                  {tag}
                                </span>
                              ))}
                          </div>
                        </div>
                      </label>
                    </div>
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
