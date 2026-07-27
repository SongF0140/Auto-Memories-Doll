"use client";

import { useState, useEffect } from "react";
import { PromptTemplate } from "../../lib/prompt/template-manager";

interface PromptEditorProps {
  template?: PromptTemplate | null;
  onSave: (data: { name: string; content: string; variables: string[]; description?: string }) => void;
  onCancel: () => void;
}

export default function PromptEditor({ template, onSave, onCancel }: PromptEditorProps) {
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [variables, setVariables] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (template) {
      setName(template.name);
      setContent(template.content);
      setVariables(template.variables.join(", "));
      setDescription(template.description || "");
    }
  }, [template]);

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = "名称不能为空";
    if (!content.trim()) errs.content = "内容不能为空";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    onSave({
      name: name.trim(),
      content: content.trim(),
      variables: variables.split(",").map((v) => v.trim()).filter(Boolean),
      description: description.trim() || undefined,
    });
  };

  return (
    <div className="violet-letter-mark p-6 space-y-4">
      <h3 className="text-lg font-semibold text-text-primary">
        {template ? "编辑模板" : "新建模板"}
      </h3>

      <div>
        <label className="block text-sm font-medium text-text-secondary mb-1">名称</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="card-input w-full"
          placeholder="模板名称"
        />
        {errors.name && <p className="text-xs text-error mt-1">{errors.name}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-text-secondary mb-1">提示词内容</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="card-input w-full min-h-[200px] font-mono text-sm"
          placeholder="输入提示词模板内容，使用 {{variable}} 语法..."
        />
        {errors.content && <p className="text-xs text-error mt-1">{errors.content}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-text-secondary mb-1">变量（逗号分隔）</label>
        <input
          value={variables}
          onChange={(e) => setVariables(e.target.value)}
          className="card-input w-full"
          placeholder="topic, context, memory"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-text-secondary mb-1">描述</label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="card-input w-full"
          placeholder="简要描述模板用途"
        />
      </div>

      <div className="flex gap-3 pt-2">
        <button onClick={handleSubmit} className="shimmer-button h-10 px-6 text-sm">
          保存
        </button>
        <button onClick={onCancel} className="btn-secondary h-10 px-6 text-sm">取消</button>
      </div>
    </div>
  );
}
