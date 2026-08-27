"use client";

/* eslint-disable no-console -- 提示词请求失败需要保留浏览器端诊断信息。 */

import { useState, useEffect } from "react";
import { PromptTemplate } from "../../lib/prompt/template-manager";
import PromptEditor from "./PromptEditor";
import PromptPreview from "./PromptPreview";

export default function PromptList() {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PromptTemplate | null | "new">(null);
  const [previewing, setPreviewing] = useState<PromptTemplate | null>(null);

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/prompt");
      const data = await response.json();
      const templates = Array.isArray(data) ? data : data.data || [];
      setTemplates(Array.isArray(templates) ? templates : []);
    } catch (error) {
      console.error("获取模板失败:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (data: {
    name: string;
    content: string;
    variables: string[];
    description?: string;
  }) => {
    try {
      const res = await fetch("/api/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        setEditing(null);
        fetchTemplates();
      }
    } catch (e) {
      console.error("创建失败:", e);
    }
  };

  const handleUpdate = async (data: {
    name: string;
    content: string;
    variables: string[];
    description?: string;
  }) => {
    if (!editing || editing === "new") return;
    try {
      const res = await fetch(`/api/prompt/${editing.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        setEditing(null);
        fetchTemplates();
      }
    } catch (e) {
      console.error("更新失败:", e);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定要删除这个模板吗？")) return;
    try {
      const res = await fetch(`/api/prompt/${id}`, { method: "DELETE" });
      if (res.ok) {
        fetchTemplates();
      }
    } catch (e) {
      console.error("删除失败:", e);
    }
  };

  if (editing) {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto">
          <PromptEditor
            template={editing === "new" ? null : editing}
            onSave={editing === "new" ? handleCreate : handleUpdate}
            onCancel={() => setEditing(null)}
          />
        </div>
      </div>
    );
  }

  if (previewing) {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto">
          <PromptPreview template={previewing} />
          <div className="mt-4 flex justify-center">
            <button onClick={() => setPreviewing(null)} className="btn-secondary h-10 px-6 text-sm">
              返回
            </button>
          </div>
        </div>
      </div>
    );
  }

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

  if (templates.length === 0 && editing !== "new") {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">提示词</h2>
              <p className="text-sm text-text-tertiary mt-1">暂无模板</p>
            </div>
            <button onClick={() => setEditing("new")} className="btn h-10 px-5 text-sm">
              新建模板
            </button>
          </div>
          <div className="empty-state py-16">
            <p className="text-text-tertiary">点击"新建模板"创建第一个提示词模板</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-baseline justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">提示词</h2>
            <p className="text-xs text-text-tertiary mt-1">{templates.length} 个模板</p>
          </div>
          <button onClick={() => setEditing("new")} className="btn h-10 px-5 text-sm">
            新建模板
          </button>
        </div>

        <div className="space-y-4 stagger-list">
          {templates.map((template) => (
            <article key={template.id} className="card card-hover animate-slide-up">
              <div className="flex items-baseline justify-between gap-4 mb-2">
                <h3 className="text-base font-semibold text-text-primary">{template.name}</h3>
                <span className="text-xs text-text-tertiary font-mono shrink-0">{template.id}</span>
              </div>

              {template.description && (
                <p className="text-sm text-text-secondary mb-3">{template.description}</p>
              )}

              <pre className="bg-bg border border-border rounded p-3 text-sm font-mono text-text-secondary overflow-x-auto max-h-32">
                <code>
                  {template.content.slice(0, 300)}
                  {template.content.length > 300 ? "..." : ""}
                </code>
              </pre>

              {template.variables.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border">
                  <span className="text-xs text-text-tertiary mr-2">变量:</span>
                  {template.variables.map((v) => (
                    <span key={v} className="tag mr-1.5">{`{{${v}}}`}</span>
                  ))}
                </div>
              )}

              <div className="mt-3 pt-3 border-t border-border flex gap-2">
                <button
                  onClick={() => setEditing(template)}
                  className="text-xs text-accent hover:underline"
                >
                  编辑
                </button>
                <button
                  onClick={() => setPreviewing(template)}
                  className="text-xs text-accent hover:underline"
                >
                  预览
                </button>
                <button
                  onClick={() => handleDelete(template.id)}
                  className="text-xs text-error hover:underline"
                >
                  删除
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
