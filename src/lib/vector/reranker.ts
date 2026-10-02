import { join, resolve, isAbsolute } from "path";
import { mkdirSync } from "fs";
import { env } from "../../config/env";
import { RERANK_TEXT_MAX_CHARS, RERANK_WAIT_MODEL_MS } from "../../config/constants";
import { logger } from "../logger";

/**
 * 本地 Cross-Encoder 精排器（对标 Hindsight engine/search/reranking.py 的神经精排层）。
 *
 * 选型与降级策略：
 * - 推理由可选依赖 @huggingface/transformers（onnxruntime-node 后端）完成，
 *   模型默认 Xenova/bge-reranker-base（BAAI 中英双语，int8 ≈ 279MB），首次使用时
 *   后台下载到 <MEMORY_ROOT>/models/，之后完全离线推理。
 * - 模型未就绪时每次调用最多等待 RERANK_WAIT_MODEL_MS，超时返回 null——
 *   调用方走原排序，绝不阻塞检索主链路。
 * - 任何失败（可选依赖缺失 / 下载失败 / 推理异常）累计 RERANK_BREAK_AFTER_STRIKES
 *   次后本进程内永久停用（熔断），不再产生等待开销。
 */

export type RerankCandidate = {
  memoryId: string;
  /** 参与精排的卡片文本（title/summary/content 拼接） */
  text: string;
};

/** @huggingface/transformers 的最小类型面（只声明用到的部分） */
type TokenizerLike = (
  pairs: [string, string][],
  options: { padding: boolean; truncation: boolean },
) => Record<string, unknown>;

type RerankModelLike = (inputs: Record<string, unknown>) => Promise<{
  logits: { data: ArrayLike<number>; dims: number[] };
}>;

type TransformersLike = {
  env: { cacheDir: string; remoteHost: string; allowLocalModels: boolean };
  AutoTokenizer: { from_pretrained: (id: string) => Promise<TokenizerLike> };
  AutoModelForSequenceClassification: {
    from_pretrained: (id: string, options: { dtype: string }) => Promise<RerankModelLike>;
  };
};

/** 连续失败多少次后熔断（本进程内永久停用） */
const RERANK_BREAK_AFTER_STRIKES = 3;

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

export class CrossEncoderReranker {
  private loadPromise: Promise<void> | null = null;
  private ready = false;
  private strikes = 0;
  private tokenizer: TokenizerLike | null = null;
  private model: RerankModelLike | null = null;

  /**
   * 对候选做 cross-encoder 精排。
   *
   * @returns memoryId → 相关性分数（0..1）；不可用或超时返回 null，调用方保持原排序
   */
  async rerank(query: string, candidates: RerankCandidate[]): Promise<Map<string, number> | null> {
    if (
      candidates.length === 0 ||
      env.RERANK_DISABLED ||
      this.strikes >= RERANK_BREAK_AFTER_STRIKES
    ) {
      return null;
    }

    // 首次调用触发后台加载（下载/编译在后台继续，本轮只等有限时间）
    if (!this.loadPromise) this.loadPromise = this.load();
    if (!this.ready) {
      try {
        await this.waitFor(this.loadPromise, RERANK_WAIT_MODEL_MS);
      } catch {
        return this.recordFailure("模型加载失败");
      }
    }

    try {
      const texts = candidates.map((c) => c.text.slice(0, RERANK_TEXT_MAX_CHARS));
      const inputs = this.tokenizer!(
        texts.map((t) => [query, t] as [string, string]),
        { padding: true, truncation: true },
      );
      const output = await this.waitFor(this.model!(inputs), RERANK_WAIT_MODEL_MS * 5);
      const logits = output.logits;
      if (logits.data.length < candidates.length) {
        return this.recordFailure("推理输出长度异常");
      }
      const scores = new Map<string, number>();
      candidates.forEach((c, i) => scores.set(c.memoryId, sigmoid(Number(logits.data[i]))));
      return scores;
    } catch (error) {
      return this.recordFailure("推理失败", error);
    }
  }

  /**
   * 加载 transformers.js 与模型（惰性、单飞）。
   * 失败时清空 loadPromise，允许后续调用重新尝试（如网络恢复后重下模型）。
   */
  private async load(): Promise<void> {
    try {
      const {
        AutoTokenizer,
        AutoModelForSequenceClassification,
        env: hfEnv,
      } = (await import("@huggingface/transformers")) as unknown as TransformersLike;

      hfEnv.cacheDir = this.modelsDir();
      hfEnv.remoteHost = env.RERANK_HF_ENDPOINT;
      hfEnv.allowLocalModels = false;

      this.tokenizer = await AutoTokenizer.from_pretrained(env.RERANK_MODEL);
      this.model = await AutoModelForSequenceClassification.from_pretrained(env.RERANK_MODEL, {
        dtype: "int8",
      });
      this.ready = true;
      logger.vector.info("Cross-Encoder 精排模型就绪", { model: env.RERANK_MODEL });
    } catch (error) {
      this.loadPromise = null;
      throw error;
    }
  }

  private modelsDir(): string {
    const root = isAbsolute(env.MEMORY_ROOT)
      ? env.MEMORY_ROOT
      : resolve(process.cwd(), env.MEMORY_ROOT);
    const dir = join(root, "models");
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // 目录创建失败时交给 transformers.js 报错
    }
    return dir;
  }

  private waitFor<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => rejectPromise(new Error("rerank 等待超时")), timeoutMs);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolvePromise(value);
        },
        (error) => {
          clearTimeout(timer);
          rejectPromise(error);
        },
      );
    });
  }

  /** 失败计一次（达到阈值熔断），返回 null 供调用方直接透传 */
  private recordFailure(reason: string, error?: unknown): null {
    this.strikes += 1;
    const message = error instanceof Error ? error.message : String(error ?? "");
    logger.vector.warn(`Cross-Encoder 精排不可用（${reason}），本次走原排序`, {
      model: env.RERANK_MODEL,
      strikes: `${this.strikes}/${RERANK_BREAK_AFTER_STRIKES}`,
      error: message,
    });
    return null;
  }
}
