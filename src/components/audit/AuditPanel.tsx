"use client";

/* eslint-disable no-console -- 审计操作失败需要保留浏览器端诊断信息。 */

import { useState, useEffect, useCallback } from "react";

type ConflictRecord = {
  conflictId: string;
  memoryId: string;
  eventId: string;
  field: string;
  existingValue: string;
  candidateValue: string;
  status: string;
  createdAt: string;
};

type AuditReport = {
  totalMemories: number;
  pendingEvents: number;
  conflicts: number;
};

type ReviewEvent = {
  eventId: string;
  memoryId: string | null;
  sourceType: string;
  createdAt: string;
  retryCount: number;
  candidate: {
    title: string;
    summary: string | null;
    contentPreview: string;
    tags: string[];
  } | null;
};

export default function AuditPanel() {
  const [report, setReport] = useState<AuditReport | null>(null);
  const [conflicts, setConflicts] = useState<ConflictRecord[]>([]);
  const [reviewEvents, setReviewEvents] = useState<ReviewEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [replaying, setReplaying] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [manualValues, setManualValues] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<"report" | "conflicts" | "review">("report");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [reportRes, conflictRes, reviewRes] = await Promise.all([
        fetch("/api/audit"),
        fetch("/api/audit/conflicts"),
        fetch("/api/audit/review-events"),
      ]);
      if (reportRes.ok) setReport(await reportRes.json());
      if (conflictRes.ok) setConflicts(await conflictRes.json());
      if (reviewRes.ok) {
        const data = await reviewRes.json();
        setReviewEvents(data.items || []);
      }
    } catch (e) {
      console.error("获取审计数据失败:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleReplay = async () => {
    setReplaying(true);
    try {
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "replay" }),
      });
      if (res.ok) {
        await fetchData();
      }
    } catch (e) {
      console.error("重放失败:", e);
    } finally {
      setReplaying(false);
    }
  };

  const handleResolve = async (conflictId: string, resolution: "accept" | "keep" | "manual") => {
    setResolvingId(conflictId);
    try {
      const res = await fetch("/api/audit/conflicts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conflictId,
          resolution,
          ...(resolution === "manual" ? { manualValue: manualValues[conflictId] ?? "" } : {}),
        }),
      });
      if (res.ok) {
        setConflicts((prev) => prev.filter((c) => c.conflictId !== conflictId));
        setManualValues((prev) => {
          const next = { ...prev };
          delete next[conflictId];
          return next;
        });
      }
    } catch (e) {
      console.error("解决冲突失败:", e);
    } finally {
      setResolvingId(null);
    }
  };

  const handleReviewDecision = async (eventId: string, action: "accept" | "reject") => {
    setResolvingId(eventId);
    try {
      const res = await fetch("/api/audit/review-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, action }),
      });
      if (res.ok) {
        setReviewEvents((prev) => prev.filter((e) => e.eventId !== eventId));
      }
    } catch (e) {
      console.error("人工裁决失败:", e);
    } finally {
      setResolvingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="loading-dots">
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2
              className="text-xl font-semibold tracking-tight"
              style={{ color: "var(--color-text-primary)" }}
            >
              审计与冲突
            </h2>
            <p className="text-xs mt-1" style={{ color: "var(--color-text-tertiary)" }}>
              管理记忆版本冲突和待处理事件
            </p>
          </div>
        </div>

        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab("report")}
            className={`text-sm px-4 py-2 rounded-lg transition-colors ${
              activeTab === "report"
                ? "bg-[rgba(166,124,0,0.08)] text-[#A67C00] font-semibold"
                : "hover:bg-[#FAF7F2]"
            }`}
            style={activeTab === "report" ? {} : { color: "#8B7355" }}
          >
            总览
          </button>
          <button
            onClick={() => setActiveTab("conflicts")}
            className={`text-sm px-4 py-2 rounded-lg transition-colors ${
              activeTab === "conflicts"
                ? "bg-[rgba(166,124,0,0.08)] text-[#A67C00] font-semibold"
                : "hover:bg-[#FAF7F2]"
            }`}
            style={activeTab === "conflicts" ? {} : { color: "#8B7355" }}
          >
            冲突 ({conflicts.length})
          </button>
          <button
            onClick={() => setActiveTab("review")}
            className={`text-sm px-4 py-2 rounded-lg transition-colors ${
              activeTab === "review"
                ? "bg-[rgba(166,124,0,0.08)] text-[#A67C00] font-semibold"
                : "hover:bg-[#FAF7F2]"
            }`}
            style={activeTab === "review" ? {} : { color: "#8B7355" }}
          >
            人工裁决 ({reviewEvents.length})
          </button>
        </div>

        {activeTab === "report" && (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-4">
              <div
                className="bg-white border rounded-xl p-5 text-center"
                style={{
                  borderColor: "var(--color-border-default)",
                  boxShadow: "var(--shadow-card)",
                }}
              >
                <div
                  className="text-3xl font-bold mb-1"
                  style={{ color: "var(--color-brand-blue)" }}
                >
                  {report?.totalMemories ?? 0}
                </div>
                <div className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
                  记忆总数
                </div>
              </div>
              <div
                className="bg-white border rounded-xl p-5 text-center"
                style={{
                  borderColor: "var(--color-border-default)",
                  boxShadow: "var(--shadow-card)",
                }}
              >
                <div
                  className="text-3xl font-bold mb-1"
                  style={{ color: "var(--color-brand-orange)" }}
                >
                  {report?.pendingEvents ?? 0}
                </div>
                <div className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
                  待处理事件
                </div>
              </div>
              <div
                className="bg-white border rounded-xl p-5 text-center"
                style={{
                  borderColor: "var(--color-border-default)",
                  boxShadow: "var(--shadow-card)",
                }}
              >
                <div className="text-3xl font-bold mb-1 text-red-600">{report?.conflicts ?? 0}</div>
                <div className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
                  待解决冲突
                </div>
              </div>
            </div>

            <div
              className="bg-white border rounded-xl p-5"
              style={{
                borderColor: "var(--color-border-default)",
                boxShadow: "var(--shadow-card)",
              }}
            >
              <h3
                className="text-base font-semibold mb-3"
                style={{ color: "var(--color-text-primary)" }}
              >
                操作
              </h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
                      重放待处理事件
                    </p>
                    <p className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
                      重新处理所有 pending 状态的记忆事件
                    </p>
                  </div>
                  <button
                    onClick={handleReplay}
                    disabled={replaying}
                    className="btn h-9 px-4 text-sm"
                  >
                    {replaying ? "处理中..." : "执行重放"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "conflicts" && (
          <div>
            {conflicts.length === 0 ? (
              <div className="py-16 text-center" style={{ color: "var(--color-text-tertiary)" }}>
                暂无待解决的冲突
              </div>
            ) : (
              <div className="space-y-4">
                {conflicts.map((conflict) => (
                  <div
                    key={conflict.conflictId}
                    className="bg-white border rounded-xl p-5"
                    style={{
                      borderColor: "var(--color-border-default)",
                      boxShadow: "var(--shadow-card)",
                    }}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span
                          className="text-xs font-mono"
                          style={{ color: "var(--color-text-tertiary)" }}
                        >
                          {conflict.conflictId.slice(0, 12)}...
                        </span>
                        <span className="tag">字段: {conflict.field}</span>
                        <span className="tag">{conflict.status}</span>
                      </div>
                      <span className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
                        {new Date(conflict.createdAt).toLocaleString("zh-CN")}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div>
                        <p
                          className="text-xs font-medium mb-1"
                          style={{ color: "var(--color-text-tertiary)" }}
                        >
                          现有值
                        </p>
                        <div
                          className="rounded-lg p-3 text-sm font-mono whitespace-pre-wrap"
                          style={{
                            background: "var(--color-bg-secondary)",
                            color: "var(--color-text-secondary)",
                          }}
                        >
                          {conflict.existingValue}
                        </div>
                      </div>
                      <div>
                        <p
                          className="text-xs font-medium mb-1"
                          style={{ color: "var(--color-text-tertiary)" }}
                        >
                          候选值
                        </p>
                        <div
                          className="rounded-lg p-3 text-sm font-mono whitespace-pre-wrap"
                          style={{
                            background: "var(--color-bg-secondary)",
                            color: "var(--color-text-secondary)",
                          }}
                        >
                          {conflict.candidateValue}
                        </div>
                      </div>
                    </div>

                    <label className="block mb-3">
                      <span
                        className="block text-xs font-medium mb-1"
                        style={{ color: "var(--color-text-tertiary)" }}
                      >
                        手动编辑值（字符串可直接输入；数组或对象请使用 JSON）
                      </span>
                      <textarea
                        value={manualValues[conflict.conflictId] ?? ""}
                        onChange={(event) =>
                          setManualValues((prev) => ({
                            ...prev,
                            [conflict.conflictId]: event.target.value,
                          }))
                        }
                        rows={3}
                        className="w-full bg-gray-50 rounded-lg p-3 text-sm font-mono border"
                        style={{ borderColor: "var(--color-border-default)" }}
                      />
                    </label>

                    <div
                      className="flex gap-2 pt-3 border-t"
                      style={{ borderColor: "var(--color-border-default)" }}
                    >
                      <button
                        onClick={() => handleResolve(conflict.conflictId, "accept")}
                        disabled={resolvingId === conflict.conflictId}
                        className="btn h-8 px-4 text-xs"
                      >
                        接受候选值
                      </button>
                      <button
                        onClick={() => handleResolve(conflict.conflictId, "keep")}
                        disabled={resolvingId === conflict.conflictId}
                        className="btn btn-secondary h-8 px-4 text-xs"
                      >
                        保留现有值
                      </button>
                      <button
                        onClick={() => handleResolve(conflict.conflictId, "manual")}
                        disabled={resolvingId === conflict.conflictId}
                        className="btn btn-secondary h-8 px-4 text-xs"
                      >
                        应用手动值
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "review" && (
          <div>
            {reviewEvents.length === 0 ? (
              <div className="py-16 text-center" style={{ color: "var(--color-text-tertiary)" }}>
                暂无待人工裁决的事件
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
                  以下事件被质量闸门标记为需人工判断（评分 4-6 或降级）：
                  「接受」将跳过闸门直接入库，「拒绝」为终态拒绝不再重试。
                </p>
                {reviewEvents.map((event) => (
                  <div
                    key={event.eventId}
                    className="bg-white border rounded-xl p-5"
                    style={{
                      borderColor: "var(--color-border-default)",
                      boxShadow: "var(--shadow-card)",
                    }}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span
                          className="text-xs font-mono"
                          style={{ color: "var(--color-text-tertiary)" }}
                        >
                          {event.eventId.slice(0, 12)}...
                        </span>
                        <span className="tag">{event.sourceType}</span>
                        <span className="tag">重试 {event.retryCount} 次</span>
                      </div>
                      <span className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
                        {new Date(event.createdAt).toLocaleString("zh-CN")}
                      </span>
                    </div>

                    {event.candidate ? (
                      <div className="mb-4">
                        <p
                          className="text-sm font-medium mb-1"
                          style={{ color: "var(--color-text-primary)" }}
                        >
                          {event.candidate.title}
                        </p>
                        {event.candidate.summary && (
                          <p className="text-xs mb-2" style={{ color: "var(--color-text-tertiary)" }}>
                            {event.candidate.summary}
                          </p>
                        )}
                        <div
                          className="rounded-lg p-3 text-sm whitespace-pre-wrap"
                          style={{
                            background: "var(--color-bg-secondary)",
                            color: "var(--color-text-secondary)",
                          }}
                        >
                          {event.candidate.contentPreview}
                        </div>
                        {event.candidate.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {event.candidate.tags.map((tag) => (
                              <span key={tag} className="tag">
                                #{tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs mb-4" style={{ color: "var(--color-text-tertiary)" }}>
                        候选内容已损坏，无法预览
                      </p>
                    )}

                    <div
                      className="flex gap-2 pt-3 border-t"
                      style={{ borderColor: "var(--color-border-default)" }}
                    >
                      <button
                        onClick={() => handleReviewDecision(event.eventId, "accept")}
                        disabled={resolvingId === event.eventId}
                        className="btn h-8 px-4 text-xs"
                      >
                        接受入库
                      </button>
                      <button
                        onClick={() => handleReviewDecision(event.eventId, "reject")}
                        disabled={resolvingId === event.eventId}
                        className="btn btn-secondary h-8 px-4 text-xs"
                      >
                        拒绝
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
