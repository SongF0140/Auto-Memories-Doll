import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_LOG_DETAIL_TARGET,
  KNOWLEDGE_LOG_MAX_CHARS,
  buildKnowledgeLog,
} from "../features/ingest/knowledge-log";

describe("knowledge log", () => {
  it("保留笔记、坑点和 Q&A 结构，而不是只返回摘要", () => {
    const log = buildKnowledgeLog([
      { role: "user", content: "目标是使用 YOLOv8 训练停车位检测模型。" },
      { role: "assistant", content: "训练环境是 Windows CPU，配置 workers=0 和 device=cpu。" },
      { role: "user", content: "坑点是 CUDA 不可用时不能继续使用 device=0。" },
    ]);

    expect(log.summary.length).toBeLessThan(300);
    expect(log.content).toContain("## 遇到的问题与坑");
    expect(log.content).toContain("## Q&A");
    expect(log.content).toContain("YOLOv8");
    expect(log.content).toContain("workers=0");
    expect(log.content).toContain("device=cpu");
  });

  it("长内容最多保留 10000 字，且保留结构化前部", () => {
    const log = buildKnowledgeLog([
      { role: "user", content: "原始需求\n" + "训练记录 ".repeat(4_000) },
    ]);

    expect(log.content.length).toBeLessThanOrEqual(KNOWLEDGE_LOG_MAX_CHARS);
    expect(log.content).toContain("## 工作背景");
    expect(log.content).toContain("## 原始对话记录（截取）");
  });

  it("短来源不凭空生成事实", () => {
    const log = buildKnowledgeLog([{ role: "user", content: "只记录这句话。" }]);

    expect(log.content).toContain("只记录这句话。");
    expect(log.content).not.toContain("mAP50");
    expect(KNOWLEDGE_LOG_DETAIL_TARGET).toBe(1_500);
  });
});
