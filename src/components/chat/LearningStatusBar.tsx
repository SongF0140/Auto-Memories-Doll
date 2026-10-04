"use client";

import React from "react";
import Link from "next/link";
import type { LearningTaskView } from "./useLearningTasks";

/**
 * LearningStatusBar — 会话内知识处理状态条（第 16 块）。
 * 聊天/知识状态分区：流式回答完成后，知识沉淀是异步后台任务，
 * 状态条如实展示排队/分析/完成/失败，绝不把 queued 说成已保存。
 * 有待确认卡时给出 /audit 入口。
 */
export default function LearningStatusBar({ tasks }: { tasks: LearningTaskView[] }) {
  if (tasks.length === 0) return null;
  const latest = tasks[tasks.length - 1];

  let content: React.ReactNode;
  let tone: "idle" | "active" | "done" | "error";

  switch (latest.status) {
    case "queued":
      content = <>知识任务排队中，等待后台分析…</>;
      tone = "active";
      break;
    case "processing":
      content = <>正在分析本轮对话，提炼候选知识…</>;
      tone = "active";
      break;
    case "completed": {
      const accepted = latest.reconciliation?.accepted ?? 0;
      const pending = latest.reconciliation?.pending ?? 0;
      const duplicates = latest.reconciliation?.duplicates ?? 0;
      const parts: string[] = [];
      if (accepted > 0) parts.push(`已沉淀 ${accepted} 张知识卡`);
      if (pending > 0) parts.push(`${pending} 张待人工确认`);
      if (duplicates > 0) parts.push(`${duplicates} 条与既有知识重复`);
      if (parts.length === 0) parts.push("本轮对话已完成分析");
      content = (
        <>
          <span>{parts.join(" · ")}</span>
          {pending > 0 && (
            <Link
              href="/audit"
              className="ml-2 underline decoration-dotted underline-offset-4 hover:decoration-solid"
            >
              前往审核
            </Link>
          )}
        </>
      );
      tone = "done";
      break;
    }
    case "failed":
      content = <span>知识分析失败：{latest.resultSummary}</span>;
      tone = "error";
      break;
  }

  const toneClass = {
    idle: "bg-surface/60 text-text-tertiary border-border",
    active: "bg-accent-soft text-text-secondary border-border",
    done: "bg-success-bg text-text-secondary border-border",
    error: "bg-error-bg text-text-secondary border-border",
  }[tone];

  return (
    <div className="mx-auto max-w-3xl px-4 pb-2 sm:px-6">
      <div
        className={`flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs ${toneClass}`}
        role="status"
        aria-live="polite"
      >
        {tone === "active" && (
          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
        )}
        {content}
      </div>
    </div>
  );
}
