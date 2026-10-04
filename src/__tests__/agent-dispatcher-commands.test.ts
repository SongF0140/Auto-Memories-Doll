import { beforeEach, describe, expect, it, vi } from "vitest";

// 记忆操作全部 mock：验证调度与定位约束，不做真实写入
const memoryState = {
  stagedCreates: [] as Array<Record<string, unknown>>,
  stagedDeletes: [] as string[],
  memories: new Map<string, { id: string; title: string; summary: string; content: string }>(),
};

vi.mock("../server/services/memory-service", () => ({
  MemoryService: vi.fn().mockImplementation(() => ({
    stageCreateMemory: (...args: unknown[]) => {
      memoryState.stagedCreates.push(
        Object.fromEntries(
          ["source", "sourceType", "title", "content", "summary", "tags"].map((k, i) => [
            k,
            args[i],
          ]),
        ),
      );
      return `mem-${memoryState.stagedCreates.length}`;
    },
    stageDeleteMemory: (id: string) => {
      memoryState.stagedDeletes.push(id);
    },
    getMemory: (id: string) => memoryState.memories.get(id) ?? null,
    close: vi.fn(),
  })),
}));

vi.mock("../lib/vector/retriever", () => ({
  VectorRetriever: vi.fn().mockImplementation(() => ({
    search: vi.fn().mockResolvedValue([]),
    close: vi.fn(),
  })),
}));

const correctMock = vi.fn().mockResolvedValue({ success: false, error: "未找到要纠错的记忆" });
vi.mock("../lib/memory/correction", () => ({
  MemoryCorrectionService: vi.fn().mockImplementation(() => ({
    correct: correctMock,
  })),
}));

const streamResponseMock = vi
  .fn()
  .mockResolvedValue(new ReadableStream<import("../lib/ai/ai-events").AiEvent>());
vi.mock("../features/chat/handler", () => ({
  ChatHandler: vi.fn().mockImplementation(() => ({
    streamResponse: streamResponseMock,
    close: vi.fn(),
  })),
}));

import { AgentDispatcher } from "../features/agent/dispatcher";
import type { ChatMessage } from "../types/api";

const user = (content: string): ChatMessage[] => [{ role: "user", content }];

/** DispatchResult 联合收窄：断言 json 结果并返回 data（避免对联合类型的不安全 as 强转） */
function expectJson(
  result: Awaited<ReturnType<AgentDispatcher["dispatch"]>>,
): Record<string, unknown> {
  if (result.type !== "json") throw new Error("期望 json 结果，实际得到 stream");
  return result.data;
}

describe("AgentDispatcher — 显式命令与误触防护", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    correctMock.mockClear();
    correctMock.mockResolvedValue({ success: false, error: "未找到要纠错的记忆" });
    memoryState.stagedCreates.length = 0;
    memoryState.stagedDeletes.length = 0;
    memoryState.memories.set("mem-abc", {
      id: "mem-abc",
      title: "既有记忆",
      summary: "摘要",
      content: "正文",
    });
  });

  it("含删除字样的普通文本不触发删除，走对话流分支", async () => {
    const dispatcher = new AgentDispatcher();
    try {
      const result = await dispatcher.dispatch(
        user("今天学习了删除文件的命令 rm -rf"),
        "chat",
        "s1",
      );
      expect(result.type).toBe("stream");
      expect(memoryState.stagedDeletes).toHaveLength(0);
      expect(streamResponseMock).toHaveBeenCalledOnce();
    } finally {
      dispatcher.close();
    }
  });

  it("含记录字样的普通文本不触发创建，走对话流分支", async () => {
    const dispatcher = new AgentDispatcher();
    try {
      const result = await dispatcher.dispatch(user("记录功能怎么用？"), "chat", "s1");
      expect(result.type).toBe("stream");
      expect(memoryState.stagedCreates).toHaveLength(0);
    } finally {
      dispatcher.close();
    }
  });

  it("/delete 缺少 ID 时拒绝执行，不自动定位 top1 删除", async () => {
    const dispatcher = new AgentDispatcher();
    try {
      const result = await dispatcher.dispatch(user("/delete"), "chat", "s1");
      expect(result.type).toBe("json");
      expect(String(expectJson(result).content)).toContain("ID");
      expect(memoryState.stagedDeletes).toHaveLength(0);
    } finally {
      dispatcher.close();
    }
  });

  it("/delete <id> 仅删除指定 ID 的记忆", async () => {
    const dispatcher = new AgentDispatcher();
    try {
      const result = await dispatcher.dispatch(user("/delete mem-abc"), "chat", "s1");
      expect(result.type).toBe("json");
      expect(memoryState.stagedDeletes).toEqual(["mem-abc"]);
    } finally {
      dispatcher.close();
    }
  });

  it("/delete <不存在的id> 返回未找到且不删除", async () => {
    const dispatcher = new AgentDispatcher();
    try {
      const result = await dispatcher.dispatch(user("/delete mem-nope"), "chat", "s1");
      expect(result.type).toBe("json");
      expect(String(expectJson(result).content)).toContain("未找到");
      expect(memoryState.stagedDeletes).toHaveLength(0);
    } finally {
      dispatcher.close();
    }
  });

  it("/remember <内容> 显式创建记忆（走待审计 stage）", async () => {
    const dispatcher = new AgentDispatcher();
    try {
      const result = await dispatcher.dispatch(
        user("/remember Vue 的 watchEffect 会立即执行一次"),
        "chat",
        "s1",
      );
      expect(result.type).toBe("json");
      expect(memoryState.stagedCreates).toHaveLength(1);
      expect(memoryState.stagedCreates[0]).toMatchObject({ sourceType: "chat" });
      expect(JSON.stringify(memoryState.stagedCreates[0])).toContain("watchEffect");
    } finally {
      dispatcher.close();
    }
  });

  it("/correct <id> <指令> 按 ID 定位纠错，不允许无 ID 的语义定位", async () => {
    correctMock.mockResolvedValue({
      success: true,
      title: "既有记忆",
      memoryId: "mem-abc",
      eventId: "evt-1",
      changedFields: ["content"],
    });
    const dispatcher = new AgentDispatcher();
    try {
      const result = await dispatcher.dispatch(
        user("/correct mem-abc 把正文改成 watchEffect 说明"),
        "chat",
        "s1",
      );
      expect(result.type).toBe("json");
      expect(correctMock).toHaveBeenCalledWith(
        expect.objectContaining({
          memoryId: "mem-abc",
          instruction: "把正文改成 watchEffect 说明",
        }),
      );
      // 缺 ID 的 /correct 被拒绝
      const noId = await dispatcher.dispatch(user("/correct 改一下内容"), "chat", "s1");
      expect(String(expectJson(noId).content)).toContain("ID");
    } finally {
      dispatcher.close();
    }
  });

  it("UI 结构化 action:delete 按指定 ID 执行", async () => {
    const dispatcher = new AgentDispatcher();
    try {
      const result = await dispatcher.dispatch(
        user("删掉这个"),
        "chat",
        "s1",
        undefined,
        undefined,
        {
          type: "delete",
          memoryId: "mem-abc",
        },
      );
      expect(result.type).toBe("json");
      expect(memoryState.stagedDeletes).toEqual(["mem-abc"]);
    } finally {
      dispatcher.close();
    }
  });
});
