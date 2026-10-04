"use client";

import { useEffect, useState } from "react";

export type LearningTaskView = {
  turnId: string;
  status: "queued" | "processing" | "completed" | "failed";
  resultSummary: string;
  knowledgeCount: number;
  reconciliation: { accepted?: number; pending?: number; duplicates?: number } | null;
};

const POLL_INTERVAL_MS = 5000;

/**
 * useLearningTasks — 当前会话的知识处理任务状态（第 16 块反馈链路）。
 * 有非终态任务（queued/processing）时每 5s 轮询；全部终态后停止。
 * 查询失败静默处理：状态条是辅助反馈，不阻塞聊天主链路。
 */
export function useLearningTasks(sessionId: string | null): LearningTaskView[] {
  const [tasks, setTasks] = useState<LearningTaskView[]>([]);

  useEffect(() => {
    if (!sessionId) {
      setTasks([]);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
      try {
        const response = await fetch(
          `/api/chat/learning-tasks?sessionId=${encodeURIComponent(sessionId)}`,
        );
        const payload = (await response.json()) as {
          success: boolean;
          data?: { tasks: LearningTaskView[] };
        };
        if (cancelled || !payload.success || !payload.data) return;
        setTasks(payload.data.tasks);
        const hasActive = payload.data.tasks.some(
          (task) => task.status === "queued" || task.status === "processing",
        );
        if (hasActive) timer = setTimeout(() => void load(), POLL_INTERVAL_MS);
      } catch {
        /* 静默：状态查询失败不影响聊天 */
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId]);

  return tasks;
}
