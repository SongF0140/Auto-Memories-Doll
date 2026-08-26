"use client";

import { useState } from "react";
import { SkillConfig } from "../../types/config";

interface SkillListProps {
  skills: SkillConfig[];
  onChange: (skills: SkillConfig[]) => void;
}

export default function SkillList({ skills, onChange }: SkillListProps) {
  const [editing, setEditing] = useState<Partial<SkillConfig> | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importUrl, setImportUrl] = useState("");
  const [importMode, setImportMode] = useState<"json" | "url">("json");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");

  const save = async (skill: Partial<SkillConfig>) => {
    const isNew = !skill.id;
    const method = isNew ? "POST" : "PUT";
    const url = isNew ? "/api/config/skills" : `/api/config/skills/${skill.id}`;

    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: skill.name,
        trigger: skill.trigger,
        prompt: skill.prompt,
        enabled: skill.enabled,
        description: skill.description,
      }),
    });

    if (response.ok) {
      setEditing(null);
      refresh();
    }
  };

  const remove = async (id: string) => {
    const response = await fetch(`/api/config/skills/${id}`, { method: "DELETE" });
    if (response.ok) refresh();
  };

  const refresh = async () => {
    const response = await fetch("/api/config/skills");
    const data = await response.json();
    onChange(data);
  };

  // JSON 导入
  const handleJsonImport = async () => {
    setImporting(true);
    setImportError("");

    try {
      let parsed;
      try {
        parsed = JSON.parse(importText);
      } catch {
        setImportError("JSON 格式错误，请检查语法");
        setImporting(false);
        return;
      }

      const items = Array.isArray(parsed) ? parsed : [parsed];
      let imported = 0;

      for (const item of items) {
        if (!item.name || !item.trigger || !item.prompt) continue;

        const response = await fetch("/api/config/skills", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: item.name,
            trigger: item.trigger,
            prompt: item.prompt,
            enabled: item.enabled !== false,
            description: item.description || "",
          }),
        });

        if (response.ok) imported++;
      }

      if (imported > 0) {
        setShowImport(false);
        setImportText("");
        refresh();
      } else {
        setImportError("没有成功导入任何技能，请确保每项都有 name、trigger 和 prompt");
      }
    } catch (e) {
      setImportError(`导入失败: ${(e as Error).message}`);
    } finally {
      setImporting(false);
    }
  };

  // URL 导入
  const handleUrlImport = async () => {
    setImporting(true);
    setImportError("");

    try {
      new URL(importUrl); // 验证 URL 格式

      const response = await fetch("/api/config/skills/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: importUrl }),
      });

      const data = await response.json();

      if (response.ok && data.success !== false) {
        setShowImport(false);
        setImportUrl("");
        refresh();
      } else {
        setImportError(data.error || "从 URL 导入失败");
      }
    } catch (e) {
      if ((e as Error).message.includes("Invalid URL")) {
        setImportError("请输入有效的 URL 地址");
      } else {
        setImportError(`导入失败: ${(e as Error).message}`);
      }
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 操作栏 */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-tertiary">
          已配置 {skills.length} 个技能
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="btn btn-secondary text-sm px-3 py-1.5"
          >
            导入
          </button>
          <button
            onClick={() => setEditing({ name: "", trigger: "", prompt: "", enabled: true })}
            className="btn text-sm px-3 py-1.5"
          >
            + 添加
          </button>
        </div>
      </div>

      {/* 导入面板 */}
      {showImport && (
        <div className="card p-5 space-y-4">
          <div>
            <h4 className="text-sm font-semibold text-text-primary mb-1">导入技能包</h4>
            <p className="text-xs text-text-secondary">
              通过 JSON 配置或 URL 链接导入技能
            </p>
          </div>

          {/* 导入模式切换 */}
          <div className="flex gap-2">
            <button
              onClick={() => setImportMode("json")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                importMode === "json"
                  ? "bg-[#A67C00] text-white"
                  : "bg-[#F5F0E8] text-[#5D4E37] hover:bg-[#E8E0D4]"
              }`}
            >
              JSON 粘贴
            </button>
            <button
              onClick={() => setImportMode("url")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                importMode === "url"
                  ? "bg-[#A67C00] text-white"
                  : "bg-[#F5F0E8] text-[#5D4E37] hover:bg-[#E8E0D4]"
              }`}
            >
              URL 导入
            </button>
          </div>

          {importMode === "json" ? (
            <>
              {/* 示例提示 */}
              <div
                className="rounded-lg p-3 text-xs font-mono overflow-x-auto"
                style={{ background: "#FAF8F5", border: "1px dashed #E8E0D4", color: "#8B7355" }}
              >
{`[
  {
    "name": "代码审查",
    "trigger": "review|审查|code review",
    "prompt": "你是一个专业的代码审查助手...",
    "description": "自动审查代码质量"
  },
  {
    "name": "文档生成",
    "trigger": "doc|文档|generate doc",
    "prompt": "根据代码生成清晰的文档...",
    "description": "从代码生成文档"
  }
]`}
              </div>

              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder="粘贴技能配置 JSON..."
                className="input min-h-[140px] font-mono text-xs"
              />
            </>
          ) : (
            <div className="space-y-3">
              <input
                type="url"
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                placeholder="https://example.com/skill-pack.json"
                className="input"
              />
              <p className="text-xs text-text-tertiary">
                支持 JSON 文件或 GitHub Raw 链接
              </p>
            </div>
          )}

          {importError && (
            <p className="text-sm text-error">{importError}</p>
          )}

          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setShowImport(false);
                setImportText("");
                setImportUrl("");
                setImportError("");
              }}
              className="btn btn-secondary"
            >
              取消
            </button>
            <button
              onClick={importMode === "json" ? handleJsonImport : handleUrlImport}
              disabled={
                importing ||
                (importMode === "json" ? !importText.trim() : !importUrl.trim())
              }
              className="btn disabled:opacity-50"
            >
              {importing ? "导入中..." : importMode === "json" ? "导入 JSON" : "从 URL 导入"}
            </button>
          </div>
        </div>
      )}

      {/* 技能列表 */}
      {skills.map((skill) => (
        <div key={skill.id} className="card card-hover p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-3 mb-1">
                <h4 className="text-base font-semibold text-text-primary truncate">{skill.name}</h4>
                <span className="tag">{skill.trigger}</span>
                <span
                  className={`badge ${skill.enabled ? "bg-success-bg text-success" : "bg-muted text-text-secondary"}`}
                >
                  {skill.enabled ? "已启用" : "已禁用"}
                </span>
              </div>
              {skill.description && (
                <p className="text-sm text-text-tertiary mb-2">{skill.description}</p>
              )}
              <div className="bg-bg border border-border rounded-lg p-3 mt-3">
                <pre className="text-xs font-mono text-text-secondary whitespace-pre-wrap line-clamp-3">
                  <code>{skill.prompt}</code>
                </pre>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setEditing(skill)}
                className="btn btn-secondary px-3 py-1.5 text-sm"
              >
                编辑
              </button>
              <button
                onClick={() => remove(skill.id)}
                className="btn btn-ghost px-3 py-1.5 text-sm text-error hover:text-error hover:bg-error-bg"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      ))}

      {editing && <SkillEditor skill={editing} onSave={save} onCancel={() => setEditing(null)} />}

      {/* 空状态 */}
      {skills.length === 0 && !editing && !showImport && (
        <div className="text-center py-12 bg-white rounded-xl border border-dashed border-[#E8E0D4]">
          <p className="text-text-secondary mb-2">尚未配置任何技能</p>
          <p className="text-xs text-text-tertiary mb-4">通过导入或手动添加来创建对话前置处理规则</p>
          <button
            onClick={() => setShowImport(true)}
            className="btn btn-secondary text-sm"
          >
            导入技能包
          </button>
        </div>
      )}
    </div>
  );
}

function SkillEditor({
  skill,
  onSave,
  onCancel,
}: {
  skill: Partial<SkillConfig>;
  onSave: (skill: Partial<SkillConfig>) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState(skill);

  return (
    <div className="card p-5 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <input
          type="text"
          placeholder="Skill 名称"
          value={form.name || ""}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="input"
        />
        <input
          type="text"
          placeholder="触发关键词"
          value={form.trigger || ""}
          onChange={(e) => setForm({ ...form, trigger: e.target.value })}
          className="input"
        />
      </div>
      <input
        type="text"
        placeholder="描述"
        value={form.description || ""}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
        className="input"
      />
      <textarea
        placeholder="触发匹配时应用的系统提示词"
        value={form.prompt || ""}
        onChange={(e) => setForm({ ...form, prompt: e.target.value })}
        className="input min-h-[120px]"
      />
      <label className="flex items-center gap-2 text-sm text-text-secondary">
        <input
          type="checkbox"
          checked={form.enabled !== false}
          onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          className="w-4 h-4 rounded border-border-strong"
        />
        已启用
      </label>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn btn-secondary">
          取消
        </button>
        <button onClick={() => onSave(form)} className="btn">
          保存
        </button>
      </div>
    </div>
  );
}
