"use client";

import PromptList from "@/components/prompt/PromptList";

export default function PromptsSettingsPage() {
  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#3E3224] mb-2 font-mono">提示词模板</h1>
        <p className="text-sm text-[#8B7D6B]">管理系统提示词和自定义模板，控制 AI 行为风格</p>
      </div>
      <div className="card p-6">
        <PromptList />
      </div>
    </div>
  );
}
