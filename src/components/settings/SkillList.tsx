"use client";

import { useState } from "react";
import { SkillConfig } from "../../types/config";

interface SkillListProps {
  skills: SkillConfig[];
  onChange: (skills: SkillConfig[]) => void;
}

export default function SkillList({ skills, onChange }: SkillListProps) {
  const [editing, setEditing] = useState<Partial<SkillConfig> | null>(null);

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

  return (
    <div className="space-y-4">
      {skills.map(skill => (
        <div key={skill.id} className="card card-hover p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-3 mb-1">
                <h4 className="text-base font-semibold text-text-primary truncate">{skill.name}</h4>
                <span className="tag">{skill.trigger}</span>
                <span className={`badge ${skill.enabled ? "bg-success-bg text-success" : "bg-muted text-text-secondary"}`}>
                  {skill.enabled ? "Enabled" : "Disabled"}
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
                Edit
              </button>
              <button
                onClick={() => remove(skill.id)}
                className="btn btn-ghost px-3 py-1.5 text-sm text-error hover:text-error hover:bg-error-bg"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ))}

      {editing && (
        <SkillEditor
          skill={editing}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}

      {!editing && (
        <button
          onClick={() => setEditing({ name: "", trigger: "", prompt: "", enabled: true })}
          className="w-full py-4 border-2 border-dashed border-border rounded-xl text-text-secondary hover:border-border-strong hover:text-text-primary transition-colors"
        >
          + Add Skill
        </button>
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
          placeholder="Skill name"
          value={form.name || ""}
          onChange={e => setForm({ ...form, name: e.target.value })}
          className="input"
        />
        <input
          type="text"
          placeholder="Trigger keyword"
          value={form.trigger || ""}
          onChange={e => setForm({ ...form, trigger: e.target.value })}
          className="input"
        />
      </div>
      <input
        type="text"
        placeholder="Description"
        value={form.description || ""}
        onChange={e => setForm({ ...form, description: e.target.value })}
        className="input"
      />
      <textarea
        placeholder="System prompt applied when trigger matches"
        value={form.prompt || ""}
        onChange={e => setForm({ ...form, prompt: e.target.value })}
        className="input min-h-[120px]"
      />
      <label className="flex items-center gap-2 text-sm text-text-secondary">
        <input
          type="checkbox"
          checked={form.enabled !== false}
          onChange={e => setForm({ ...form, enabled: e.target.checked })}
          className="w-4 h-4 rounded border-border-strong"
        />
        Enabled
      </label>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn btn-secondary">Cancel</button>
        <button onClick={() => onSave(form)} className="btn">Save</button>
      </div>
    </div>
  );
}
