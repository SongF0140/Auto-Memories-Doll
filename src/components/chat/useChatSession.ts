"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { ChatMessage, ChatMode } from "../../types/api";

const LEGACY_SESSION_PREFIX = "amd_session_";
const STORAGE_MODE_KEY = "amd_chat_mode";
const MIGRATION_KEY = "amd_session_migration_v1";
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

type ApiEnvelope<T> = {
  success: boolean;
  data?: T;
  error?: { message: string };
};

type SessionSummary = {
  sessionId: string;
  mode: ChatMode;
  title: string;
  messageCount: number;
  updatedAt: string;
};

type SessionSnapshot = {
  sessionId: string;
  mode: ChatMode;
  messages: ChatMessage[];
  createdAt: string;
};

function generateSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function requestApi<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error?.message || `请求失败 (${response.status})`);
  }
  return payload.data;
}

async function listServerSessions(): Promise<SessionSummary[]> {
  const data = await requestApi<{ sessions: SessionSummary[] }>("/api/chat/sessions");
  return data.sessions;
}

async function loadServerSession(sessionId: string): Promise<SessionSnapshot> {
  const data = await requestApi<{ session: SessionSnapshot }>(
    `/api/chat/sessions/${encodeURIComponent(sessionId)}`,
  );
  return data.session;
}

function readLegacySessions(mode: ChatMode) {
  if (localStorage.getItem(MIGRATION_KEY) === "done") return [];

  const sessions: Array<{ sessionId: string; mode: ChatMode; messages: ChatMessage[] }> = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(LEGACY_SESSION_PREFIX)) continue;
    const sessionId = key.slice(LEGACY_SESSION_PREFIX.length);
    if (!SESSION_ID_PATTERN.test(sessionId)) continue;

    try {
      const messages = JSON.parse(localStorage.getItem(key) || "null") as unknown;
      if (
        !Array.isArray(messages) ||
        !messages.every(
          (message) =>
            typeof message === "object" &&
            message !== null &&
            ["user", "assistant", "system"].includes(message.role) &&
            typeof message.content === "string",
        )
      ) {
        continue;
      }
      sessions.push({
        sessionId,
        mode,
        messages: messages as ChatMessage[],
      });
    } catch {
      // 保留无法解析的旧数据，避免迁移失败时误删。
    }
  }
  return sessions;
}

async function migrateLegacySessions(mode: ChatMode): Promise<void> {
  if (localStorage.getItem(MIGRATION_KEY) === "done") return;
  const sessions = readLegacySessions(mode);

  if (sessions.length > 0) {
    await requestApi<{ imported: number; skipped: number }>("/api/chat/sessions/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessions }),
    });
    for (const session of sessions) {
      localStorage.removeItem(LEGACY_SESSION_PREFIX + session.sessionId);
    }
  }

  localStorage.setItem(MIGRATION_KEY, "done");
}

export interface ChatSessionState {
  sessionId: string;
  messages: ChatMessage[];
  mode: ChatMode;
  loading: boolean;
  hydrating: boolean;
  sessionError: string;
  sessionIds: string[];
}

export function useChatSession() {
  const [state, setState] = useState<ChatSessionState>(() => ({
    sessionId: generateSessionId(),
    messages: [],
    mode: "chat",
    loading: false,
    hydrating: true,
    sessionError: "",
    sessionIds: [],
  }));
  const sessionRequestRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      const storedMode = localStorage.getItem(STORAGE_MODE_KEY);
      const savedMode: ChatMode =
        storedMode === "memory" || storedMode === "prompt" ? storedMode : "chat";
      try {
        await migrateLegacySessions(savedMode);
        const sessions = await listServerSessions();
        if (cancelled) return;

        if (sessions.length === 0) {
          setState((previous) => ({
            ...previous,
            mode: savedMode,
            hydrating: false,
            sessionIds: [],
          }));
          return;
        }

        const session = await loadServerSession(sessions[0].sessionId);
        if (cancelled) return;
        setState((previous) => ({
          ...previous,
          sessionId: session.sessionId,
          messages: session.messages,
          mode: session.mode,
          hydrating: false,
          sessionError: "",
          sessionIds: sessions.map((item) => item.sessionId),
        }));
      } catch (error) {
        if (cancelled) return;
        setState((previous) => ({
          ...previous,
          mode: savedMode,
          hydrating: false,
          sessionError: `会话恢复失败: ${(error as Error).message}`,
        }));
      }
    }

    void restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshSessions = useCallback(async () => {
    try {
      const sessions = await listServerSessions();
      setState((previous) => ({
        ...previous,
        sessionIds: sessions.map((item) => item.sessionId),
        sessionError: "",
      }));
      return sessions;
    } catch (error) {
      setState((previous) => ({
        ...previous,
        sessionError: `会话列表刷新失败: ${(error as Error).message}`,
      }));
      return [];
    }
  }, []);

  const setMode = useCallback((mode: ChatMode) => {
    setState((previous) => ({ ...previous, mode }));
    localStorage.setItem(STORAGE_MODE_KEY, mode);
  }, []);

  const setMessages = useCallback(
    (messagesOrFn: ChatMessage[] | ((previous: ChatMessage[]) => ChatMessage[])) => {
      setState((previous) => ({
        ...previous,
        messages:
          typeof messagesOrFn === "function" ? messagesOrFn(previous.messages) : messagesOrFn,
      }));
    },
    [],
  );

  const setLoading = useCallback((loading: boolean) => {
    setState((previous) => ({ ...previous, loading }));
  }, []);

  const newSession = useCallback(() => {
    sessionRequestRef.current += 1;
    setState((previous) => ({
      ...previous,
      sessionId: generateSessionId(),
      messages: [],
      hydrating: false,
      sessionError: "",
    }));
  }, []);

  const switchSession = useCallback(async (targetId: string) => {
    const requestId = ++sessionRequestRef.current;
    setState((previous) => ({ ...previous, hydrating: true, sessionError: "" }));

    try {
      const session = await loadServerSession(targetId);
      if (requestId !== sessionRequestRef.current) return;
      setState((previous) => ({
        ...previous,
        sessionId: session.sessionId,
        messages: session.messages,
        mode: session.mode,
        hydrating: false,
      }));
    } catch (error) {
      if (requestId !== sessionRequestRef.current) return;
      setState((previous) => ({
        ...previous,
        hydrating: false,
        sessionError: `会话加载失败: ${(error as Error).message}`,
      }));
    }
  }, []);

  const removeSession = useCallback(
    async (targetId: string) => {
      const requestId = ++sessionRequestRef.current;
      const deletingActiveSession = targetId === state.sessionId;
      if (deletingActiveSession) {
        setState((previous) => ({ ...previous, hydrating: true, sessionError: "" }));
      }

      try {
        await requestApi<{ sessionId: string; deleted: boolean }>(
          `/api/chat/sessions/${encodeURIComponent(targetId)}`,
          { method: "DELETE" },
        );
        const sessions = await listServerSessions();
        if (requestId !== sessionRequestRef.current) return;
        const remainingIds = sessions.map((item) => item.sessionId);

        if (!deletingActiveSession) {
          setState((previous) => ({
            ...previous,
            sessionIds: remainingIds,
            sessionError: "",
          }));
          return;
        }

        if (sessions.length === 0) {
          setState((previous) => ({
            ...previous,
            sessionId: generateSessionId(),
            messages: [],
            hydrating: false,
            sessionError: "",
            sessionIds: [],
          }));
          return;
        }

        const session = await loadServerSession(sessions[0].sessionId);
        if (requestId !== sessionRequestRef.current) return;
        setState((previous) => ({
          ...previous,
          sessionId: session.sessionId,
          messages: session.messages,
          mode: session.mode,
          hydrating: false,
          sessionError: "",
          sessionIds: remainingIds,
        }));
      } catch (error) {
        if (requestId !== sessionRequestRef.current) return;
        setState((previous) => ({
          ...previous,
          hydrating: false,
          sessionError: `会话删除失败: ${(error as Error).message}`,
        }));
      }
    },
    [state.sessionId],
  );

  return {
    ...state,
    setMessages,
    setMode,
    setLoading,
    refreshSessions,
    newSession,
    switchSession,
    removeSession,
  };
}
