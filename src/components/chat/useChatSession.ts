"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { ChatMessage, ChatMode } from "../../types/api";

/** 存储键名 */
const STORAGE_KEY_PREFIX = "amd_session_";
const STORAGE_MODE_KEY = "amd_chat_mode";

/** 生成唯一 sessionId */
function generateSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 从 localStorage 恢复会话 */
function loadSession(sessionId: string): ChatMessage[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + sessionId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed as ChatMessage[];
  } catch {
    return null;
  }
}

/** 保存会话到 localStorage */
function saveSession(sessionId: string, messages: ChatMessage[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + sessionId, JSON.stringify(messages));
  } catch {
    // localStorage 满时静默失败
  }
}

/** 获取所有已保存的会话 ID 列表 */
function listSessionIds(): string[] {
  try {
    const ids: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(STORAGE_KEY_PREFIX)) {
        ids.push(key.slice(STORAGE_KEY_PREFIX.length));
      }
    }
    return ids.sort().reverse(); // 最新的在前
  } catch {
    return [];
  }
}

/** 删除指定会话 */
function deleteSession(sessionId: string): void {
  try {
    localStorage.removeItem(STORAGE_KEY_PREFIX + sessionId);
  } catch {
    // 静默失败
  }
}

export interface ChatSessionState {
  sessionId: string;
  messages: ChatMessage[];
  mode: ChatMode;
  loading: boolean;
  sessionIds: string[];
}

export function useChatSession() {
  const [state, setState] = useState<ChatSessionState>(() => {
    const savedMode = (localStorage.getItem(STORAGE_MODE_KEY) as ChatMode) || "chat";
    const existingIds = listSessionIds();
    // 尝试恢复最近的会话
    if (existingIds.length > 0) {
      const msgs = loadSession(existingIds[0]);
      if (msgs && msgs.length > 0) {
        return {
          sessionId: existingIds[0],
          messages: msgs,
          mode: savedMode,
          loading: false,
          sessionIds: existingIds,
        };
      }
    }
    // 无已保存会话，创建新的
    const newId = generateSessionId();
    return {
      sessionId: newId,
      messages: [],
      mode: savedMode,
      loading: false,
      sessionIds: existingIds,
    };
  });

  // 消息变更时自动保存（节流 500ms）
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveSession(state.sessionId, state.messages);
      // 刷新会话列表
      setState((prev) => ({ ...prev, sessionIds: listSessionIds() }));
    }, 500);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [state.messages, state.sessionId]);

  // 模式变更时保存
  const setMode = useCallback((mode: ChatMode) => {
    setState((prev) => ({ ...prev, mode }));
    localStorage.setItem(STORAGE_MODE_KEY, mode);
  }, []);

  const setMessages = useCallback(
    (messagesOrFn: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      setState((prev) => ({
        ...prev,
        messages:
          typeof messagesOrFn === "function"
            ? messagesOrFn(prev.messages)
            : messagesOrFn,
      }));
    },
    [],
  );

  const setLoading = useCallback((loading: boolean) => {
    setState((prev) => ({ ...prev, loading }));
  }, []);

  /** 新建会话 */
  const newSession = useCallback(() => {
    // 先保存当前会话
    if (state.messages.length > 0) {
      saveSession(state.sessionId, state.messages);
    }
    const newId = generateSessionId();
    setState((prev) => ({
      ...prev,
      sessionId: newId,
      messages: [],
      sessionIds: listSessionIds(),
    }));
  }, [state.messages, state.sessionId]);

  /** 切换到指定会话 */
  const switchSession = useCallback(
    (targetId: string) => {
      // 保存当前
      if (state.messages.length > 0) {
        saveSession(state.sessionId, state.messages);
      }
      const msgs = loadSession(targetId) || [];
      setState((prev) => ({
        ...prev,
        sessionId: targetId,
        messages: msgs,
        sessionIds: listSessionIds(),
      }));
    },
    [state.messages, state.sessionId],
  );

  /** 删除会话 */
  const removeSession = useCallback(
    (targetId: string) => {
      deleteSession(targetId);
      const remainingIds = listSessionIds();
      if (targetId === state.sessionId) {
        // 正在删除当前会话，切换到最近的或新建
        if (remainingIds.length > 0) {
          const msgs = loadSession(remainingIds[0]) || [];
          setState((prev) => ({
            ...prev,
            sessionId: remainingIds[0],
            messages: msgs,
            sessionIds: remainingIds,
          }));
        } else {
          const newId = generateSessionId();
          setState((prev) => ({
            ...prev,
            sessionId: newId,
            messages: [],
            sessionIds: [],
          }));
        }
      } else {
        setState((prev) => ({ ...prev, sessionIds: remainingIds }));
      }
    },
    [state.sessionId],
  );

  return {
    ...state,
    setMessages,
    setMode,
    setLoading,
    newSession,
    switchSession,
    removeSession,
  };
}
