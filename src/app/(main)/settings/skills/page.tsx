"use client";

import { useEffect, useState } from "react";
import { SkillConfig } from "@/types/config";
import SkillList from "@/components/settings/SkillList";

const API_BASE = "/api/config";

export default function SkillsSettingsPage() {
  const [skills, setSkills] = useState<SkillConfig[]>([]);

  useEffect(() => {
    fetch(`${API_BASE}/skills`)
      .then((r) => r.json())
      .then((d) => setSkills(d.skills || d))
      .catch(() => {});
  }, []);

  const handleChange = () => {
    fetch(`${API_BASE}/skills`)
      .then((r) => r.json())
      .then((d) => setSkills(d.skills || d))
      .catch(() => {});
  };

  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto">
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-1">技能管理</h2>
        <p className="text-xs text-text-tertiary mb-6">配置对话前置处理规则</p>
        <SkillList skills={skills} onChange={handleChange} />
      </div>
    </div>
  );
}
