import { MemoryRecord } from "../../types/memory";
import { ModelAdapter } from "../../lib/ai/model-adapter";
import { COMPILE_MAX_REFINEMENT_ROUNDS } from "../../config/constants";
import { logger } from "../../lib/logger";

/**
 * WiCER 式编译验证（I-7）。
 *
 * 论文数据：盲编译的灾难性失败率 53-60%（score-1 率），质量仅 2.14-2.32 vs 原始 3.46；
 * 用"诊断探针 → 精准重编译"1-2 轮可恢复 80% 丢失质量，失败率降到 24.8%。
 * 消融实验更关键：targeted diagnosis 贡献 +0.95，random pinning 仅 +0.16 ——
 * **必须精准定位失败事实，不能随机往 prompt 里加约束**。
 *
 * 流程：编译产物 W₀ → 对每张来源卡生成 1 个探针 → 用 W₀ 回答并与来源摘要比对
 *      → 未命中的事实作为"必须保留"约束重新编译（至多 COMPILE_MAX_REFINEMENT_ROUNDS 轮）
 *      → 仍失败则该簇进 review 队列，不落盘。
 */
export type CompiledDraft = {
  title: string;
  summary: string;
  content: string;
  tags: string[];
};

export type VerificationOutcome = {
  passed: boolean;
  /** 编译过程中丢失的关键事实（来源卡摘要），下一轮作为"必须保留"约束 */
  missingFacts: string[];
  /** 实际执行的验证轮次（1 基） */
  round: number;
};

export class CompileVerifier {
  /** 单簇最多使用的来源卡数：既是编译输入上限，也把夜间 token 成本封顶 */
  private readonly MAX_SOURCES = 8;

  /**
   * 对草稿执行一轮诊断，返回是否通过以及丢失的事实清单。
   * 探针与判定都用 budget 模型——验证要便宜，否则不如不验证。
   */
  async diagnose(
    draft: CompiledDraft,
    sources: MemoryRecord[],
  ): Promise<Omit<VerificationOutcome, "round">> {
    const targets = sources.slice(0, this.MAX_SOURCES);
    const missingFacts: string[] = [];

    for (const source of targets) {
      const probe = await this.generateProbe(source);
      // 探针生成失败 → 该来源卡未被验证，必须按"未命中"处理（fail-closed）：
      // 静默跳过会让编译产物在验证环节裸奔，正是 WiCER 要防的灾难性失败
      if (!probe) {
        missingFacts.push(source.summaryZh || source.summary || source.title);
        continue;
      }

      const retained = await this.probeRetained(draft, source, probe);
      // 判定失败时保守判为"未命中"，让人工兜底而不是静默放行
      if (retained !== true) {
        missingFacts.push(source.summaryZh || source.summary || source.title);
      }
    }

    return { passed: missingFacts.length === 0, missingFacts };
  }

  /** 为单张来源卡生成 1 个诊断探针问题：针对它的核心事实 */
  private async generateProbe(source: MemoryRecord): Promise<string | null> {
    const prompt = `下面是知识库中的一条记忆。请针对它的**核心事实**设计 1 个诊断问题，用于检验一份综合文档是否保留了该事实。

标题：${source.title}
摘要：${source.summaryZh || source.summary}

只输出一行问题，不要解释，不要编号。`;

    try {
      const response = await ModelAdapter.generate(prompt, "budget");
      if (!response.content || response.finishReason === "degraded") return null;
      const question = response.content.trim().split("\n")[0].trim();
      return question.length > 0 ? question : null;
    } catch (e) {
      logger.nightly.warn("诊断探针生成失败", { error: (e as Error).message });
      return null;
    }
  }

  /** 用草稿回答探针，并判断是否真的保留了来源事实 */
  private async probeRetained(
    draft: CompiledDraft,
    source: MemoryRecord,
    probe: string,
  ): Promise<boolean | null> {
    const prompt = `请判断下面的综合文档是否保留了该事实。只回复 YES 或 NO，不要解释。

诊断问题：${probe}
来源事实：${(source.summaryZh || source.summary).slice(0, 300)}

综合文档标题：${draft.title}
综合文档摘要：${draft.summary}
综合文档正文：
${draft.content.slice(0, 2000)}`;

    try {
      const response = await ModelAdapter.generate(prompt, "budget");
      if (!response.content || response.finishReason === "degraded") return null;
      return /\bYES\b|是/i.test(response.content.trim().slice(0, 10));
    } catch (e) {
      logger.nightly.warn("探针判定失败", { error: (e as Error).message });
      return null;
    }
  }

  /** 最大重编译轮次（对外暴露，供编译器与测试断言硬上限） */
  static get maxRounds(): number {
    return COMPILE_MAX_REFINEMENT_ROUNDS;
  }
}
