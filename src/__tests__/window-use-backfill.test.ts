import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * windowUse 存量回填服务单测（I-11 迁移）。
 * 验证：分批生成 → DB 更新 → Markdown 同步 → 向量重建的完整链路，
 * 以及降级跳过、非法输出跳过、单卡失败不中断批次的容错语义。
 */

const { store, generateMock, updateVectorMock } = vi.hoisted(() => ({
  store: {
    degraded: false,
    memories: [] as Array<Record<string, unknown>>,
  },
  generateMock: vi.fn(),
  updateVectorMock: vi.fn(),
}));

vi.mock("../lib/ai/model-adapter", () => ({
  ModelAdapter: {
    get isDegradedMode() {
      return store.degraded;
    },
    generate: generateMock,
  },
}));

vi.mock("../server/services/memory-service", () => ({
  MemoryService: class {
    countMissingWindowUse(): number {
      return store.memories.filter((m) => !m.windowUse).length;
    }
    getMemoriesMissingWindowUse(limit: number): Array<Record<string, unknown>> {
      return store.memories.filter((m) => !m.windowUse).slice(0, limit);
    }
    updateMemory(id: string, updates: Record<string, unknown>): void {
      const memory = store.memories.find((m) => m.id === id);
      if (memory) Object.assign(memory, updates);
    }
    close(): void {}
  },
}));

vi.mock("../server/workers/vector-worker", () => ({
  VectorWorker: class {
    updateVector = updateVectorMock;
    close(): void {}
  },
}));

vi.mock("../lib/storage/memory-writer", () => ({
  writeMemoryMarkdown: vi.fn().mockResolvedValue(undefined),
}));

import { WindowUseBackfillService } from "../server/services/window-use-backfill-service";
import { writeMemoryMarkdown } from "../lib/storage/memory-writer";

function seedMemories(): void {
  store.memories = [
    { id: "mem-a", title: "卡A", summary: "摘要A", content: "正文A", topic: "t", tags: [] },
    { id: "mem-b", title: "卡B", summary: "摘要B", content: "正文B", topic: "t", tags: [] },
    {
      id: "mem-c",
      title: "卡C",
      summary: "摘要C",
      content: "正文C",
      topic: "t",
      tags: [],
      windowUse: "已有场景说明",
    },
  ];
}

beforeEach(() => {
  store.degraded = false;
  seedMemories();
  generateMock.mockReset();
  updateVectorMock.mockReset();
  updateVectorMock.mockResolvedValue(undefined);
  vi.mocked(writeMemoryMarkdown).mockClear();
});

describe("WindowUseBackfillService（I-11 存量迁移）", () => {
  it("回填一批：生成 windowUse 并完成 DB + Markdown + 向量三步更新", async () => {
    generateMock.mockResolvedValue({ content: '{"windowUse": "当用户问 X 时有用"}' });

    const service = new WindowUseBackfillService();
    const result = await service.processBatch();

    expect(result).toEqual({ processed: 2, remaining: false });
    // DB 已更新
    expect(store.memories.find((m) => m.id === "mem-a")?.windowUse).toBe("当用户问 X 时有用");
    // Markdown 已同步（带上新 windowUse 全量重写）
    expect(writeMemoryMarkdown).toHaveBeenCalledWith(
      expect.objectContaining({ id: "mem-a", windowUse: "当用户问 X 时有用" }),
    );
    // 向量已用新键（summary + windowUse）重建
    expect(updateVectorMock).toHaveBeenCalledWith("mem-a", "摘要A\n当用户问 X 时有用");
    expect(updateVectorMock).toHaveBeenCalledWith("mem-b", "摘要B\n当用户问 X 时有用");
    // 已有 windowUse 的卡片不被重复处理
    expect(updateVectorMock).not.toHaveBeenCalledWith("mem-c", expect.anything());
  });

  it("模型降级时跳过本轮，不产生 LLM 调用", async () => {
    store.degraded = true;

    const service = new WindowUseBackfillService();
    const result = await service.processBatch();

    expect(result.processed).toBe(0);
    expect(result.remaining).toBe(true);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("LLM 输出非法 JSON 时跳过该卡，不误写空值", async () => {
    generateMock.mockResolvedValue({ content: "这不是 JSON" });

    const service = new WindowUseBackfillService();
    const result = await service.processBatch();

    expect(result.processed).toBe(0);
    expect(result.remaining).toBe(true);
    expect(store.memories.find((m) => m.id === "mem-a")?.windowUse).toBeUndefined();
    expect(writeMemoryMarkdown).not.toHaveBeenCalled();
  });

  it("能从带杂质文本中提取 JSON 窗口", async () => {
    generateMock.mockResolvedValue({ content: '好的，结果如下：{"windowUse": "排查 Z 问题时"}' });

    const service = new WindowUseBackfillService();
    const result = await service.processBatch();

    expect(result.processed).toBe(2);
    expect(store.memories.find((m) => m.id === "mem-a")?.windowUse).toBe("排查 Z 问题时");
  });

  it("单卡生成失败不中断批次，其余卡片继续", async () => {
    generateMock
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValue({ content: '{"windowUse": "当用户问 Y 时"}' });

    const service = new WindowUseBackfillService();
    const result = await service.processBatch();

    expect(result.processed).toBe(1);
    expect(store.memories.find((m) => m.id === "mem-a")?.windowUse).toBeUndefined();
    expect(store.memories.find((m) => m.id === "mem-b")?.windowUse).toBe("当用户问 Y 时");
    // 失败卡留待下轮
    expect(result.remaining).toBe(true);
  });
});
