import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
}));

vi.mock("../lib/ai/model-adapter", () => ({
  ModelAdapter: { generate: mocks.generate },
}));

import { rewriteQueryVariants, parseVariants } from "../lib/vector/query-rewriter";

describe("parseVariants", () => {
  it("提取 JSON 中的合法变体：裁剪并限制数量", () => {
    const raw = '好的，改写如下：{"variants": [" 树莓派部署 ", "Raspberry Pi 推理"] }';
    expect(parseVariants(raw, "边缘计算部署")).toEqual(["树莓派部署", "Raspberry Pi 推理"]);
  });

  it("与原句完全相同的变体会被去重", () => {
    const raw = '{"variants": ["边缘计算部署", "边缘部署方案"]}';
    expect(parseVariants(raw, "边缘计算部署")).toEqual(["边缘部署方案"]);
  });

  it("过滤空串、过短、超长与非字符串元素", () => {
    const tooLong = "x".repeat(200);
    const raw = JSON.stringify({ variants: ["", "a", tooLong, 42, null, "合法变体"] });
    expect(parseVariants(raw, "查询")).toEqual(["合法变体"]);
  });

  it("非法 JSON 或结构异常时返回空数组", () => {
    expect(parseVariants("这不是 JSON", "q")).toEqual([]);
    expect(parseVariants('{"variants": "不是数组"}', "q")).toEqual([]);
    expect(parseVariants("", "q")).toEqual([]);
    expect(parseVariants('{"broken": ', "q")).toEqual([]);
  });
});

describe("rewriteQueryVariants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("query 过短时直接返回空数组，不调用模型", async () => {
    await expect(rewriteQueryVariants("你好")).resolves.toEqual([]);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("模型降级（无 Key / API 失败）时返回空数组", async () => {
    mocks.generate.mockResolvedValue({
      content: "降级兜底文案",
      finishReason: "degraded",
      model: "fallback",
      timestamp: "2026-08-23T00:00:00.000Z",
    });

    await expect(rewriteQueryVariants("帮我回忆一下昨天的会议内容")).resolves.toEqual([]);
  });

  it("模型抛异常时返回空数组而不向上抛", async () => {
    mocks.generate.mockRejectedValue(new Error("network down"));
    await expect(rewriteQueryVariants("帮我回忆一下昨天的会议内容")).resolves.toEqual([]);
  });

  it("正常时返回解析出的变体", async () => {
    mocks.generate.mockResolvedValue({
      content: '{"variants": ["会议纪要回顾", "昨天讨论要点"]}',
      finishReason: "stop",
      model: "budget-model",
      timestamp: "2026-08-23T00:00:00.000Z",
    });

    await expect(rewriteQueryVariants("帮我回忆一下昨天的会议内容")).resolves.toEqual([
      "会议纪要回顾",
      "昨天讨论要点",
    ]);
    // 使用 budget 档位模型
    expect(mocks.generate.mock.calls[0][1]).toBe("budget");
  });
});
