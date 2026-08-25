"use client";

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

export default function AuditPanel() {
  const [report, setReport] = useState<AuditReport | null>(null);
  const [conflicts, setConflicts] = useState<ConflictRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [replaying, setReplaying] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [manualValues, setManualValues] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<"report" | "conflicts">("report");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [reportRes, conflictRes] = await Promise.all([
        fetch("/api/audit"),
        fetch("/api/audit/conflicts"),
      ]);
      if (reportRes.ok) setReport(await reportRes.json());
      if (conflictRes.ok) setConflicts(await conflictRes.json());
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

  const handleResolve = async (
    conflictId: string,
    resolution: "accept" | "keep" | "manual",
  ) => {
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
            <h2 className="text-xl font-semibold tracking-tight" style={{ color: "var(--color-text-primary)" }}>
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
              activeTab === "report" ? "bg-[rgba(166,124,0,0.08)] text-[#A67C00] font-semibold" : "hover:bg-[#FAF7F2]"
            }`}
            style={activeTab === "report" ? {} : { color: "#8B7355" }}
          >
            总览
          </button>
          <button
            onClick={() => setActiveTab("conflicts")}
            className={`text-sm px-4 py-2 rounded-lg transition-colors ${
              activeTab === "conflicts" ? "bg-[rgba(166,124,0,0.08)] text-[#A67C00] font-semibold" : "hover:bg-[#FAF7F2]"
            }`}
            style={activeTab === "conflicts" ? {} : { color: "#8B7355" }}
          >
            冲突 ({conflicts.length})
          </button>
        </div>

        {activeTab === "report" && (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-white border rounded-xl p-5 text-center" style={{ borderColor: "var(--color-border-default)", boxShadow: "var(--shadow-card)" }}>
                <div className="text-3xl font-bold mb-1" style={{ color: "var(--color-brand-blue)" }}>
                  {report?.totalMemories ?? 0}
                </div>
                <div className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>记忆总数</div>
              </div>
              <div className="bg-white border rounded-xl p-5 text-center" style={{ borderColor: "var(--color-border-default)", boxShadow: "var(--shadow-card)" }}>
                <div className="text-3xl font-bold mb-1" style={{ color: "var(--color-brand-orange)" }}>
                  {report?.pendingEvents ?? 0}
                </div>
                <div className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>待处理事件</div>
              </div>
              <div className="bg-white border rounded-xl p-5 text-center" style={{ borderColor: "var(--color-border-default)", boxShadow: "var(--shadow-card)" }}>
                <div className="text-3xl font-bold mb-1 text-red-600">{report?.conflicts ?? 0}</div>
                <div className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>待解决冲突</div>
              </div>
            </div>

            <div className="bg-white border rounded-xl p-5" style={{ borderColor: "var(--color-border-default)", boxShadow: "var(--shadow-card)" }}>
              <h3 className="text-base font-semibold mb-3" style={{ color: "var(--color-text-primary)" }}>操作</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>重放待处理事件</p>
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
                    style={{ borderColor: "var(--color-border-default)", boxShadow: "var(--shadow-card)" }}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono" style={{ color: "var(--color-text-tertiary)" }}>
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
                        <p className="text-xs font-medium mb-1" style={{ color: "var(--color-text-tertiary)" }}>现有值</p>
                        <div
                          className="rounded-lg p-3 text-sm font-mono whitespace-pre-wrap"
                          style={{ background: "var(--color-bg-secondary)", color: "var(--color-text-secondary)" }}
                        >
                          {conflict.existingValue}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-medium mb-1" style={{ color: "var(--color-text-tertiary)" }}>候选值</p>
                        <div
                          className="rounded-lg p-3 text-sm font-mono whitespace-pre-wrap"
                          style={{ background: "var(--color-bg-secondary)", color: "var(--color-text-secondary)" }}
                        >
                          {conflict.candidateValue}
                        </div>
                      </div>
                    </div>

                    <label className="block mb-3">
                      <span className="block text-xs font-medium mb-1" style={{ color: "var(--color-text-tertiary)" }}>
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

                    <div className="flex gap-2 pt-3 border-t" style={{ borderColor: "var(--color-border-default)" }}>
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
      </div>
    </div>
  );
}
