"use client";

import { useMemo } from "react";
import { PromptTemplate } from "../../lib/prompt/template-manager";

interface PromptPreviewProps {
  template: PromptTemplate;
}

export default function PromptPreview({ template }: PromptPreviewProps) {
  const preview = useMemo(() => {
    let text = template.content;
    const sampleValues: Record<string, string> = {
      question: "今天天气怎么样？",
      context: "用户当前在编写代码",
      memory: "用户偏好简洁的回答",
      topic: "编程",
    };

    for (const v of template.variables) {
      const val = sampleValues[v] || `[${v}]`;
      text = text.replace(new RegExp(`\\{\\{${v}\\}\\}`, "g"), val);
    }

    return text;
  }, [template]);

  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold text-text-primary mb-4">预览: {template.name}</h3>

      {template.variables.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {template.variables.map((v) => (
            <span key={v} className="tag">{`{{${v}}}`}</span>
          ))}
        </div>
      )}

      <div className="bg-muted border border-border rounded-lg p-4 text-sm leading-relaxed text-text-secondary whitespace-pre-wrap font-mono max-h-[500px] overflow-y-auto">
        {preview}
      </div>
    </div>
  );
}
