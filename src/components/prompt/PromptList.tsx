"use client";

import { useState, useEffect } from "react";
import { PromptTemplate } from "../../lib/prompt/template-manager";

export default function PromptList() {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/prompt");
      const data = await response.json();
      setTemplates(data);
    } catch (error) {
      console.error("Failed to fetch templates:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="empty-state">
        <div className="loading-dots">
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <div className="empty-state">
        <p>暂无提示词模板</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-baseline justify-between mb-6">
          <h2 className="text-xl font-semibold tracking-tight text-gradient">提示词</h2>
          <span className="text-sm text-text-tertiary">{templates.length} 个模板</span>
        </div>

        <div className="space-y-4 stagger-list">
          {templates.map(template => (
            <article key={template.id} className="card card-hover animate-slide-up">
              <div className="flex items-baseline justify-between gap-4 mb-2">
                <h3 className="text-base font-semibold text-text-primary">{template.name}</h3>
                <span className="text-xs text-text-tertiary font-mono shrink-0">{template.id}</span>
              </div>

              {template.description && (
                <p className="text-sm text-text-secondary mb-3">{template.description}</p>
              )}

              <pre className="bg-bg border border-border rounded p-3 text-sm font-mono text-text-secondary overflow-x-auto">
                <code>{template.content}</code>
              </pre>

              {template.variables.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border">
                  <span className="text-xs text-text-tertiary mr-2">变量:</span>
                  {template.variables.map(v => (
                    <span key={v} className="tag mr-1.5">
                      {v}
                    </span>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
