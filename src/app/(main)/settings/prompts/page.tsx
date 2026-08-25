"use client";

import PromptList from "@/components/prompt/PromptList";

export default function PromptsSettingsPage() {
  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto">
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-1">提示词模板</h2>
        <p className="text-xs text-text-tertiary mb-6">管理系统提示词和模板</p>
        <PromptList />
      </div>
    </div>
  );
}
