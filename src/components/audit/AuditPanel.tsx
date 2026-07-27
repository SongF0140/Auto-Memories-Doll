"use client";

import { useState, useEffect, useCallback } from "react";

type ConflictRecord = {
  id: string;
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

  const handleResolve = async (conflictId: string, resolution: "accept" | "keep") => {
    try {
      const res = await fetch("/api/audit/conflicts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conflictId, resolution }),
      });
      if (res.ok) {
        setConflicts((prev) => prev.filter((c) => c.id !== conflictId));
      }
    } catch (e) {
      console.error("解决冲突失败:", e);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="loading-dots"><span /><span /><span /></div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-gradient">审计与冲突</h2>
            <p className="text-xs text-text-tertiary mt-1">管理记忆版本冲突和待处理事件</p>
          </div>
        </div>

        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab("report")}
            className={`text-sm px-4 py-2 rounded-lg transition-colors ${activeTab === "report" ? "card-active" : "card-hover"}`}
          >
            总览
          </button>
          <button
            onClick={() => setActiveTab("conflicts")}
            className={`text-sm px-4 py-2 rounded-lg transition-colors ${activeTab === "conflicts" ? "card-active" : "card-hover"}`}
          >
            冲突 ({conflicts.length})
          </button>
        </div>

        {activeTab === "report" && (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-4">
              <div className="card p-5 text-center">
                <div className="text-3xl font-bold text-gradient mb-1">{report?.totalMemories ?? 0}</div>
                <div className="text-xs text-text-tertiary">记忆总数</div>
              </div>
              <div className="card p-5 text-center">
                <div className="text-3xl font-bold text-gradient mb-1">{report?.pendingEvents ?? 0}</div>
                <div className="text-xs text-text-tertiary">待处理事件</div>
              </div>
              <div className="card p-5 text-center">
                <div className="text-3xl font-bold text-error mb-1">{report?.conflicts ?? 0}</div>
                <div className="text-xs text-text-tertiary">待解决冲突</div>
              </div>
            </div>

            <div className="card p-5">
              <h3 className="text-base font-semibold text-text-primary mb-3">操作</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-text-secondary">重放待处理事件</p>
                    <p className="text-xs text-text-tertiary">重新处理所有 pending 状态的记忆事件</p>
                  </div>
                  <button
                    onClick={handleReplay}
                    disabled={replaying}
                    className="shimmer-button h-9 px-4 text-sm"
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
              <div className="empty-state py-16">
                <p className="text-text-tertiary">暂无待解决的冲突</p>
              </div>
            ) : (
              <div className="space-y-4">
                {conflicts.map((conflict) => (
                  <div key={conflict.id} className="card p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-text-tertiary font-mono">{conflict.id.slice(0, 12)}...</span>
                        <span className="tag">字段: {conflict.field}</span>
                        <span className="tag">{conflict.status}</span>
                      </div>
                      <span className="text-xs text-text-tertiary">
                        {new Date(conflict.createdAt).toLocaleString("zh-CN")}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div>
                        <p className="text-xs font-medium text-text-tertiary mb-1">现有值</p>
                        <div className="bg-muted rounded-lg p-3 text-sm text-text-secondary whitespace-pre-wrap font-mono">
                          {conflict.existingValue}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-text-tertiary mb-1">候选值</p>
                        <div className="bg-muted rounded-lg p-3 text-sm text-text-secondary whitespace-pre-wrap font-mono">
                          {conflict.candidateValue}
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2 border-t border-border pt-3">
                      <button
                        onClick={() => handleResolve(conflict.id, "accept")}
                        className="shimmer-button h-8 px-4 text-xs"
                      >
                        接受候选值
                      </button>
                      <button
                        onClick={() => handleResolve(conflict.id, "keep")}
                        className="btn-secondary h-8 px-4 text-xs"
                      >
                        保留现有值
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
