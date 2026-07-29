"use client";

import { useState, useEffect } from "react";
import { MemoryRecord } from "../../types/memory";
import MemoryCard from "./MemoryCard";
import Badge from "../common/Badge";
import { getTopicLabelClient } from "../../config/topics.config";

const display = (memory: MemoryRecord) => ({
  title: memory.titleZh || memory.title,
  summary: memory.summaryZh || memory.summary,
  tags: memory.tagsZh && memory.tagsZh.length > 0 ? memory.tagsZh : memory.tags,
  topic: memory.topicZh || getTopicLabelClient(memory.topic),
});

interface MemoryViewerProps {
  memoryId: string;
  onClose: () => void;
  onDeleted?: () => void;
  onUpdated?: () => void;
}

export default function MemoryViewer({
  memoryId,
  onClose,
  onDeleted,
  onUpdated,
}: MemoryViewerProps) {
  const [memory, setMemory] = useState<MemoryRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ title: "", content: "", tags: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchMemory();
  }, [memoryId]);

  const fetchMemory = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/memory/${memoryId}`);
      if (res.ok) {
        const data = await res.json();
        setMemory(data);
        setForm({ title: data.title, content: data.content, tags: data.tags.join(", ") });
      }
    } catch (e) {
      console.error("Failed to fetch memory:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/memory/${memoryId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          content: form.content,
          tags: form.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      if (res.ok) {
        setEditing(false);
        fetchMemory();
        onUpdated?.();
      }
    } catch (e) {
      console.error("Failed to update memory:", e);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("确定要删除这条记忆吗？")) return;
    try {
      const res = await fetch(`/api/memory/${memoryId}`, { method: "DELETE" });
      if (res.ok) {
        onClose();
        onDeleted?.();
      }
    } catch (e) {
      console.error("Failed to delete memory:", e);
    }
  };

  if (loading) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          className="violet-letter-mark w-full max-w-2xl mx-4 p-8"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="loading-dots flex justify-center py-8">
            <span />
            <span />
            <span />
          </div>
        </div>
      </div>
    );
  }

  if (!memory) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          className="violet-letter-mark w-full max-w-2xl mx-4 p-8 text-center"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-text-secondary">记忆未找到</p>
          <button onClick={onClose} className="mt-4 text-sm text-accent underline">
            关闭
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 backdrop-blur-sm py-12"
      onClick={onClose}
    >
      <div
        className="violet-letter-mark w-full max-w-2xl mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h3 className="text-lg font-semibold text-text-primary">记忆详情</h3>
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary text-xl leading-none"
          >
            &times;
          </button>
        </div>

        <div className="p-6">
          {editing ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">标题</label>
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="card-input w-full"
                  placeholder="记忆标题"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">内容</label>
                <textarea
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  className="card-input w-full min-h-[200px]"
                  placeholder="记忆内容"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  标签（逗号分隔）
                </label>
                <input
                  value={form.tags}
                  onChange={(e) => setForm({ ...form, tags: e.target.value })}
                  className="card-input w-full"
                  placeholder="标签1, 标签2"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="shimmer-button h-10 px-6 text-sm"
                >
                  {saving ? "保存中..." : "保存"}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="btn-secondary h-10 px-6 text-sm"
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <>
              <MemoryCard memory={memory} />

              <div className="mt-5 space-y-4">
                {memory.content && (
                  <div>
                    <p className="text-xs font-medium text-text-tertiary mb-1">完整内容</p>
                    <div className="bg-muted rounded-lg p-4 text-sm leading-relaxed text-text-secondary whitespace-pre-wrap">
                      {memory.content}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-4 text-xs text-text-tertiary pt-3 border-t border-border">
                  <span>ID: {memory.id}</span>
                  <span>版本: {memory.version}</span>
                  <span>
                    话题:{" "}
                    <Badge className="bg-[#e8dcc8] text-[#6b5a3e]">{display(memory).topic}</Badge>
                  </span>
                  <span>
                    来源:{" "}
                    <Badge>{memory.sourceType === "listen" ? "监听导入" : memory.sourceType}</Badge>
                  </span>
                  {memory.heatScore > 0 && <span>热度: {memory.heatScore.toFixed(1)}</span>}
                  <span>创建: {new Date(memory.createdAt).toLocaleString("zh-CN")}</span>
                </div>

                {memory.graphLinks.length > 0 && (
                  <div className="pt-3 border-t border-border">
                    <p className="text-xs font-medium text-text-tertiary mb-2">关联记忆</p>
                    <div className="flex flex-wrap gap-2">
                      {memory.graphLinks.map((link) => (
                        <span key={link} className="tag text-xs">
                          {link.slice(0, 12)}...
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-6 flex gap-3 pt-4 border-t border-border">
                <button
                  onClick={() => setEditing(true)}
                  className="shimmer-button h-10 px-6 text-sm"
                >
                  编辑
                </button>
                <button onClick={handleDelete} className="btn-danger h-10 px-6 text-sm">
                  删除
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
