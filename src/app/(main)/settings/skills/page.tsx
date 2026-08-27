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
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#3E3224] mb-2 font-mono">技能配置</h1>
        <p className="text-sm text-[#8B7D6B]">管理触发式技能和自动化规则，扩展系统能力</p>
      </div>
      <div className="card p-6">
        <SkillList skills={skills} onChange={handleChange} />
      </div>
    </div>
  );
}
