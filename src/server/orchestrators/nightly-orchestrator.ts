import { MemoryService } from "../services/memory-service";
import { MemoryRecord } from "../../types/memory";
import { ProfileUpdater } from "../services/profile-updater";
import { ContradictionDetector, ContradictionReport } from "./contradiction-detector";
import { LinkSupplementer, LinkSupplementReport } from "./link-supplementer";
import { RouteOptimizer, RouteOptimizationReport } from "./route-optimizer";
import { DailyReporter } from "./daily-reporter";
import { StructureLintService, LintIssue } from "../services/structure-lint-service";
import { ControlPlaneService } from "../services/control-plane-service";
import { SynthesisCompiler, SynthesisReport } from "./synthesis-compiler";
import { logger } from "../../lib/logger";
import { ModelAdapter } from "../../lib/ai/model-adapter";

/** 一次深夜督查运行的所有结果 */
export interface NightlyReport {
  date: string;
  startedAt: string;
  completedAt: string;
  /** 当日新增/修改的记忆数 */
  todaysMemoryCount: number;
  /** 各子任务结果 */
  contradiction: ContradictionReport | null;
  links: LinkSupplementReport | null;
  routing: RouteOptimizationReport | null;
  /** I-1 结构化 Lint：死链 / 孤儿页 / 残缺卡 / 重复来源 */
  lint?: { issues: LintIssue[]; added: number } | null;
  /** I-6/I-7 编译层：综合页产出与验证结果 */
  synthesis?: SynthesisReport | null;
  /** I-5 控制面：生成的控制面文件名列表 */
  controlPlane?: string[] | null;
  /** 所有任务是否成功 */
  allSucceeded: boolean;
  errors: string[];
}

/**
 * 深夜督查编排器（旗舰模型驱动）。
 *
 * 每天凌晨执行一次，负责：
 * 1. 知识矛盾检测 — 扫描今天新增 vs 已有记忆，发现语义矛盾
 * 2. wikilink 关联补充 — 发现内容相关但未链接的记忆对
 * 3. 路由表优化 — 分析模型使用情况，建议调整 TaskRouter
 * 4. 用户画像更新 — 聚合今日对话，旗舰模型重新分析
 * 5. 日报生成 — 汇总所有结果写入 archive/daily/
 *
 * 所有需要深度推理的子任务使用 flagship 模型，
 * 编排在深夜执行以避免影响白天的用户交互延迟。
 */
export class NightlyOrchestrator {
  private memoryService: MemoryService;
  private contradictionDetector: ContradictionDetector;
  private linkSupplementer: LinkSupplementer;
  private routeOptimizer: RouteOptimizer;
  private dailyReporter: DailyReporter;
  private lintService: StructureLintService;
  private synthesisCompiler: SynthesisCompiler;
  private controlPlaneService: ControlPlaneService;

  constructor() {
    this.memoryService = new MemoryService();
    this.contradictionDetector = new ContradictionDetector();
    this.linkSupplementer = new LinkSupplementer();
    this.routeOptimizer = new RouteOptimizer();
    this.dailyReporter = new DailyReporter();
    this.lintService = new StructureLintService();
    this.synthesisCompiler = new SynthesisCompiler();
    this.controlPlaneService = new ControlPlaneService();
  }

  /** 执行完整深夜督查流程 */
  async run(): Promise<NightlyReport> {
    const startedAt = new Date().toISOString();
    const date = new Date().toISOString().split("T")[0];
    const errors: string[] = [];

    logger.nightly.info("深夜督查开始", { date });

    // 获取当日记忆
    const todaysMemories = this.getTodaysMemories();
    const allMemories = this.memoryService.listMemories({
      sortBy: "updatedAt",
      sortOrder: "desc",
      limit: 200,
    });
    logger.nightly.info(`当日记忆: ${todaysMemories.length}，全量: ${allMemories.length}`);

    // ── 0. 结构化 Lint（I-1，零 LLM）──
    // 放在最前：lint 结果供后续步骤跳过死链，且它最便宜、失败不影响主流程。
    let lint: { issues: LintIssue[]; added: number } | null = null;
    try {
      const allForLint = this.memoryService.listMemories({ includeSuperseded: true });
      lint = this.lintService.scanAndPersist(allForLint);
      logger.nightly.info("结构化 Lint 完成", {
        issues: lint.issues.length,
        added: lint.added,
      });
    } catch (e) {
      const msg = `结构化 Lint 失败: ${(e as Error).message}`;
      logger.nightly.error(msg);
      errors.push(msg);
    }

    // ── 1. 知识矛盾检测 ──
    let contradiction: ContradictionReport | null = null;
    try {
      contradiction = await this.contradictionDetector.detect(todaysMemories, allMemories);
      logger.nightly.info("矛盾检测完成", {
        contradictionsFound: contradiction.contradictions.length,
      });
    } catch (e) {
      const msg = `矛盾检测失败: ${(e as Error).message}`;
      logger.nightly.error(msg);
      errors.push(msg);
    }

    // ── 2. wikilink 关联补充 ──
    let links: LinkSupplementReport | null = null;
    try {
      links = await this.linkSupplementer.supplement(todaysMemories, allMemories);
      logger.nightly.info("wikilink 补充完成", { linksAdded: links.addedCount });
    } catch (e) {
      const msg = `wikilink 补充失败: ${(e as Error).message}`;
      logger.nightly.error(msg);
      errors.push(msg);
    }

    // ── 3. 路由表优化 ──
    let routing: RouteOptimizationReport | null = null;
    try {
      routing = await this.routeOptimizer.optimize(todaysMemories, allMemories);
      logger.nightly.info("路由优化完成", { suggestions: routing.suggestions.length });
    } catch (e) {
      const msg = `路由优化失败: ${(e as Error).message}`;
      logger.nightly.error(msg);
      errors.push(msg);
    }

    // ── 4. 用户画像更新（旗舰模型） ──
    if (ModelAdapter.isDegradedMode) {
      logger.nightly.info("模型降级中，跳过旗舰模型画像更新");
    } else {
      try {
        logger.nightly.info("开始旗舰模型画像更新");
        await ProfileUpdater.getInstance().runAnalysisWithFlagship();
        logger.nightly.info("画像更新完成");
      } catch (e) {
        const msg = `画像更新失败: ${(e as Error).message}`;
        logger.nightly.error(msg);
        errors.push(msg);
      }
    }

    // ── 5. Synthesis 编译 + WiCER 验证（I-6 / I-7）──
    let synthesis: SynthesisReport | null = null;
    try {
      synthesis = await this.synthesisCompiler.compile(allMemories);
      logger.nightly.info("知识编译完成", {
        clusters: synthesis.clusters,
        created: synthesis.created.length,
        failed: synthesis.failed.length,
      });
    } catch (e) {
      const msg = `知识编译失败: ${(e as Error).message}`;
      logger.nightly.error(msg);
      errors.push(msg);
    }

    // ── 6. 控制面刷新（I-5）──
    let controlPlane: string[] | null = null;
    try {
      controlPlane = await this.controlPlaneService.writeAll({
        memories: allMemories,
        lintIssues: lint?.issues ?? [],
        contradictions: contradiction?.contradictions ?? [],
        synthesis,
      });
      logger.nightly.info("控制面已刷新", { files: controlPlane.length });
    } catch (e) {
      const msg = `控制面刷新失败: ${(e as Error).message}`;
      logger.nightly.error(msg);
      errors.push(msg);
    }

    // ── 7. 生成日报 ──
    const completedAt = new Date().toISOString();
    const report: NightlyReport = {
      date,
      startedAt,
      completedAt,
      todaysMemoryCount: todaysMemories.length,
      contradiction,
      links,
      routing,
      lint,
      synthesis,
      controlPlane,
      allSucceeded: errors.length === 0,
      errors,
    };

    try {
      await this.dailyReporter.write(report);
      logger.nightly.info("日报已生成", { date });
    } catch (e) {
      const msg = `日报生成失败: ${(e as Error).message}`;
      logger.nightly.error(msg);
      errors.push(msg);
    }

    logger.nightly.info("深夜督查完成", {
      allSucceeded: errors.length === 0,
      errorCount: errors.length,
    });
    return report;
  }

  /** 获取当日创建或更新的记忆 */
  private getTodaysMemories(): MemoryRecord[] {
    const today = new Date().toISOString().split("T")[0];
    const all = this.memoryService.listMemories({
      sortBy: "updatedAt",
      sortOrder: "desc",
      limit: 500,
    });

    // 过滤当日更新或创建的记忆
    return all.filter((m) => {
      return m.updatedAt?.startsWith(today) || m.createdAt?.startsWith(today);
    });
  }

  close(): void {
    this.memoryService.close();
    this.contradictionDetector.close();
    this.linkSupplementer.close();
    this.routeOptimizer.close();
    this.lintService.close();
    this.synthesisCompiler.close();
  }
}
