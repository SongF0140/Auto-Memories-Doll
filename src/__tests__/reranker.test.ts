import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "path";
import { tmpdir } from "os";
import { rmSync } from "fs";
import { env } from "../config/env";
import { RERANK_TEXT_MAX_CHARS, RERANK_WAIT_MODEL_MS } from "../config/constants";
import { CrossEncoderReranker } from "../lib/vector/reranker";

// ─────────────────────────────────────────────────────────────
// 可控的 @huggingface/transformers mock：每个用例通过 hf.xxx 定制行为
// ─────────────────────────────────────────────────────────────
const hf = vi.hoisted(() => ({
  /** from_pretrained 调用计数（每次 load 触发 tokenizer+model 两次） */
  loadAttempts: 0,
  /** 阻塞模型加载的闸门 promise（非 null 时模拟"下载中"） */
  gate: null as Promise<void> | null,
  /** 模型加载失败（from_pretrained 抛错，也用于模拟可选依赖缺失） */
  loadError: null as Error | null,
  /** 推理失败（model 调用抛错） */
  inferError: null as Error | null,
  tokenizer: vi.fn(),
  model: vi.fn(),
  modelCalls: 0,
}));

vi.mock("@huggingface/transformers", () => {
  const gatedLoad = async <T>(value: T): Promise<T> => {
    hf.loadAttempts += 1;
    if (hf.gate) await hf.gate;
    if (hf.loadError) throw hf.loadError;
    return value;
  };
  return {
    env: { cacheDir: "", remoteHost: "", allowLocalModels: true },
    AutoTokenizer: {
      from_pretrained: async () => gatedLoad(hf.tokenizer),
    },
    AutoModelForSequenceClassification: {
      from_pretrained: async () => gatedLoad(hf.model),
    },
  };
});

vi.mock("../lib/logger", () => ({
  logger: { vector: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

describe("CrossEncoderReranker", () => {
  let reranker: CrossEncoderReranker;
  let savedEnv: { RERANK_DISABLED: boolean; MEMORY_ROOT: string };
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = join(tmpdir(), `amd-rerank-test-${Date.now()}`);
    savedEnv = { RERANK_DISABLED: env.RERANK_DISABLED, MEMORY_ROOT: env.MEMORY_ROOT };
    env.MEMORY_ROOT = tempRoot;
    env.RERANK_DISABLED = false;

    hf.loadAttempts = 0;
    hf.gate = null;
    hf.loadError = null;
    hf.inferError = null;
    hf.modelCalls = 0;
    hf.tokenizer.mockReset().mockImplementation((pairs: [string, string][]) => ({
      input_ids: pairs.map(() => [1, 2, 3]),
    }));
    hf.model
      .mockReset()
      .mockImplementation(async () => {
        hf.modelCalls += 1;
        if (hf.inferError) throw hf.inferError;
        return { logits: { data: [2.0, -2.0], dims: [2, 1] } };
      });

    reranker = new CrossEncoderReranker();
  });

  afterEach(() => {
    env.RERANK_DISABLED = savedEnv.RERANK_DISABLED;
    env.MEMORY_ROOT = savedEnv.MEMORY_ROOT;
    vi.useRealTimers();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  const candidates = [
    { memoryId: "m1", text: "卡片一" },
    { memoryId: "m2", text: "卡片二" },
  ];

  it("正常精排：返回 memoryId → sigmoid(logit) 分数表", async () => {
    const scores = await reranker.rerank("查询", candidates);
    expect(scores).not.toBeNull();
    expect(scores!.get("m1")).toBeCloseTo(sigmoid(2.0), 8);
    expect(scores!.get("m2")).toBeCloseTo(sigmoid(-2.0), 8);
    // cross-encoder 应收到 [query, doc] 文本对
    expect(hf.tokenizer).toHaveBeenCalledWith(
      [
        ["查询", "卡片一"],
        ["查询", "卡片二"],
      ],
      { padding: true, truncation: true },
    );
  });

  it("超长文本在送入模型前截断", async () => {
    await reranker.rerank("查询", [{ memoryId: "m1", text: "长".repeat(5000) }]);
    const pairs = hf.tokenizer.mock.calls[0][0] as [string, string][];
    expect(pairs[0][1].length).toBe(RERANK_TEXT_MAX_CHARS);
  });

  it("空候选直接返回 null，不触发加载", async () => {
    expect(await reranker.rerank("查询", [])).toBeNull();
    expect(hf.loadAttempts).toBe(0);
  });

  it("RERANK_DISABLED=1 时停用", async () => {
    env.RERANK_DISABLED = true;
    expect(await reranker.rerank("查询", candidates)).toBeNull();
    expect(hf.loadAttempts).toBe(0);
  });

  it("加载失败（如可选依赖缺失）：返回 null 且三次后熔断不再重试加载", async () => {
    hf.loadError = new Error("Cannot find package '@huggingface/transformers'");
    for (let i = 0; i < 3; i++) {
      expect(await reranker.rerank("查询", candidates)).toBeNull();
    }
    // tokenizer 加载先失败，model 的 from_pretrained 不会执行 → 每次 load 计 1 次
    expect(hf.loadAttempts).toBe(3);
    // 熔断后不再产生新的加载尝试
    expect(await reranker.rerank("查询", candidates)).toBeNull();
    expect(hf.loadAttempts).toBe(3);
  });

  it("模型加载失败：本次返回 null，恢复后下次调用可重试成功", async () => {
    hf.loadError = new Error("download failed");
    expect(await reranker.rerank("查询", candidates)).toBeNull();

    hf.loadError = null;
    const scores = await reranker.rerank("查询", candidates);
    expect(scores).not.toBeNull();
    expect(scores!.get("m1")).toBeCloseTo(sigmoid(2.0), 8);
  });

  it("推理失败累计三次后熔断，不再调用模型", async () => {
    hf.inferError = new Error("ONNX abort");
    for (let i = 0; i < 3; i++) {
      expect(await reranker.rerank("查询", candidates)).toBeNull();
    }
    expect(hf.modelCalls).toBe(3);

    hf.inferError = null;
    expect(await reranker.rerank("查询", candidates)).toBeNull();
    expect(hf.modelCalls).toBe(3);
  });

  it("模型下载中不阻塞检索：等待超时放行，下载完成后恢复精排", async () => {
    vi.useFakeTimers();
    let openGate!: () => void;
    hf.gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });

    // 首次调用：模型还在"下载"，最多等待 RERANK_WAIT_MODEL_MS 后放行
    const pending = reranker.rerank("查询", candidates);
    await vi.advanceTimersByTimeAsync(RERANK_WAIT_MODEL_MS);
    expect(await pending).toBeNull();

    // 下载完成，后续调用正常精排
    openGate();
    const scores = await reranker.rerank("查询", candidates);
    expect(scores).not.toBeNull();
  });
});
