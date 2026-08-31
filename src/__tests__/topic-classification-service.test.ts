import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/ai/model-adapter", () => ({
  ModelAdapter: {
    generate: vi.fn(),
    isDegradedMode: false,
  },
}));

vi.mock("../config/topics.config", async () => {
  const actual =
    await vi.importActual<typeof import("../config/topics.config")>("../config/topics.config");
  return {
    ...actual,
    getAvailableTopics: vi.fn(() => [
      "ai-coding",
      "daily-notes",
      "project-planning",
      "learning",
      "meetings",
      "reading",
      "ideas",
      "uncategorized",
    ]),
  };
});

import { ModelAdapter } from "../lib/ai/model-adapter";
import { TopicClassificationService } from "../server/services/topic-classification-service";

const llmReply = (json: unknown) => ({
  content: typeof json === "string" ? json : JSON.stringify(json),
  finishReason: "stop",
  model: "standard-test",
  timestamp: "2026-01-01T00:00:00Z",
});

describe("TopicClassificationService", () => {
  let service: TopicClassificationService;

  beforeEach(() => {
    vi.clearAllMocks();
    (ModelAdapter as any).isDegradedMode = false;
    service = new TopicClassificationService();
  });

  it("uses the standard model to correct a rule-suggested topic to another allowed topic", async () => {
    (ModelAdapter.generate as any).mockResolvedValue(
      llmReply({ topic: "meetings", confidence: 0.88, reason: "内容是项目例会纪要" }),
    );

    const result = await service.classify({
      title: "React 项目周会纪要",
      summary: "讨论排期、负责人和下周决策",
      content: "这是一段包含 React 字样的会议纪要，重点是项目同步、决策和行动项。",
      suggestedTopic: "ai-coding",
    });

    expect(result).toMatchObject({
      topic: "meetings",
      confidence: 0.88,
      source: "model",
    });
    expect(ModelAdapter.generate).toHaveBeenCalledWith(expect.any(String), "standard");
    const prompt = (ModelAdapter.generate as any).mock.calls[0][0] as string;
    expect(prompt).toContain("ai-coding");
    expect(prompt).toContain("meetings");
    expect(prompt).toContain("React 项目周会纪要");
  });

  it("falls back to the suggested topic when model classification is unavailable", async () => {
    (ModelAdapter.generate as any).mockRejectedValue(new Error("model down"));

    const result = await service.classify({
      title: "标题",
      summary: "摘要",
      content: "正文",
      suggestedTopic: "learning",
    });

    expect(result).toMatchObject({ topic: "learning", source: "rules" });
  });

  it("does not call the model in degraded mode and falls back to rules", async () => {
    (ModelAdapter as any).isDegradedMode = true;

    const result = await service.classify({
      title: "标题",
      summary: "摘要",
      content: "正文",
      suggestedTopic: "reading",
    });

    expect(result).toMatchObject({ topic: "reading", source: "rules" });
    expect(ModelAdapter.generate).not.toHaveBeenCalled();
  });

  it("rejects unknown model topics and falls back to the suggested topic", async () => {
    (ModelAdapter.generate as any).mockResolvedValue(
      llmReply({ topic: "random-new-folder", confidence: 0.99, reason: "bad output" }),
    );

    const result = await service.classify({
      title: "标题",
      summary: "摘要",
      content: "正文",
      suggestedTopic: "project-planning",
    });

    expect(result).toMatchObject({ topic: "project-planning", source: "rules" });
  });

  it("routes low-confidence model decisions to uncategorized", async () => {
    (ModelAdapter.generate as any).mockResolvedValue(
      llmReply({ topic: "ai-coding", confidence: 0.3, reason: "信息不足" }),
    );

    const result = await service.classify({
      title: "零散记录",
      summary: "缺少上下文",
      content: "这段内容不足以判断明确话题。",
      suggestedTopic: "ai-coding",
    });

    expect(result).toMatchObject({ topic: "uncategorized", source: "model" });
  });
});
