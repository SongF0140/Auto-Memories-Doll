/**
 * 用户画像维护服务 —— 分析对话、提取用户特征、更新 profile.md。
 *
 * 工作流：
 * 1. 每次对话结束后（或定期），提取最近 N 条消息
 * 2. 用 Vercel AI SDK generateText 分析特征（偏好、知识领域、风格等）
 * 3. 差分合并到 memory-root/profile.md
 * 4. 下次对话自动注入更新后的画像到系统提示词
 */
import { generateText } from "ai";
import { createLanguageModel } from "../../lib/ai/provider";
import { ModelAdapter } from "../../lib/ai/model-adapter";
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "fs";
import { getProfilePath, getMemoryRoot } from "../../lib/storage/path-resolver";
import { join } from "path";
import { PromptCache } from "../../lib/prompt/cache";
import { withLock } from "../../lib/storage/lock";
import { logger } from "../../lib/logger";

const PROFILE_ANALYSIS_PROMPT = `You are a user profile analyzer. Based on the conversation below, extract the user's characteristics.

## Existing Profile
{existing}

## Recent Conversation
{conversation}

## Instructions
Analyze the conversation and update ONLY the following sections in the profile:

### 技术偏好
- Programming languages, frameworks, tools the user mentions or uses
- Technical skill level indicators

### 兴趣领域  
- Topics they ask about or discuss frequently
- Domains they show curiosity about

### 学习中的领域
- New domains/skills the user is actively learning (very important — track learning progress)
- Specific concepts they're struggling with or exploring
- Learning resources they reference (books, courses, docs)

### 沟通风格
- Preferred interaction style (concise vs detailed, formal vs casual)
- Language preference indicators

### 当前项目
- What they are currently working on
- Goals and challenges they mention

### 习惯与偏好
- Repeated patterns or habits
- Learning or working preferences

Output ONLY the updated profile in Chinese, using this format exactly:
# 用户画像

## 技术偏好
- item

## 兴趣领域
- item

## 学习中的领域
- item

## 沟通风格
- item

## 当前项目
- item

## 习惯与偏好
- item

If a section has no new information, keep the existing items. You MUST maintain all existing information and only ADD or REFINE, never remove.`;

export class ProfileUpdater {
  private static instance: ProfileUpdater;
  private analysisQueue: string[] = [];
  private analysisTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly DEBOUNCE_MS = 30000; // 30 秒防抖，避免频繁分析
  /** 画像相似度阈值：新旧画像 Jaccard 相似度高于此值则跳过回写，防止回写震荡（对应《架构检查文档.md》6.3） */
  private readonly UPDATE_SIMILARITY_THRESHOLD = 0.85;

  static getInstance(): ProfileUpdater {
    if (!this.instance) {
      this.instance = new ProfileUpdater();
    }
    return this.instance;
  }

  /**
   * 将一段对话加入分析队列（防抖）
   * 保留最近 200 条对话，确保画像基于长期数据而非短期快照
   */
  enqueueAnalysis(conversation: string): void {
    this.analysisQueue.push(conversation);

    // 保留最近 200 条（长期累积）
    if (this.analysisQueue.length > 200) {
      this.analysisQueue = this.analysisQueue.slice(-200);
    }

    // 防抖：等待对话稳定后再分析
    if (this.analysisTimer) clearTimeout(this.analysisTimer);
    this.analysisTimer = setTimeout(() => {
      this.runAnalysis();
    }, this.DEBOUNCE_MS);
  }

  /**
   * 深夜督查专用：使用旗舰模型进行深度画像分析。
   *
   * 与标准 runAnalysis() 的区别：
   * - 使用 flagship 模型（更强推理能力）
   * - 分析全部累积队列（不是只取前 30 条）
   * - 温度更低（0.3），分析更精准
   * - 关注知识演进方向、技能成长路径等长期趋势
   */
  async runAnalysisWithFlagship(): Promise<void> {
    if (this.analysisQueue.length === 0) return;
    if (ModelAdapter.isDegradedMode) return;

    const conversation = this.analysisQueue.join("\n\n---\n\n");
    this.analysisQueue = [];

    const existingProfile = this.readExistingProfile();

    try {
      const model = createLanguageModel("flagship");
      const result = await generateText({
        model,
        messages: [
          {
            role: "user",
            content: PROFILE_ANALYSIS_PROMPT.replace(
              "{existing}",
              existingProfile || "暂无画像",
            ).replace("{conversation}", conversation),
          },
        ],
        maxOutputTokens: 1200,
        temperature: 0.3,
      });

      const updatedProfile = result.text.trim();
      if (updatedProfile && updatedProfile.length > 20) {
        const similarity = this.lineJaccardSimilarity(existingProfile, updatedProfile);
        if (similarity >= this.UPDATE_SIMILARITY_THRESHOLD) {
          logger.memory.info("[ProfileUpdater:flagship] 画像变化不显著，跳过回写", { similarity: similarity.toFixed(3) });
          return;
        }

        const addedLines = this.computeAddedLines(existingProfile, updatedProfile);
        await withLock(async () => {
          this.writeProfile(updatedProfile);
          this.appendChangelog(similarity, addedLines);
        });
        PromptCache.getInstance().invalidate("system-prefix");
        logger.memory.info("[ProfileUpdater:flagship] 用户画像已更新", {
          similarity: similarity.toFixed(3),
          addedLines: addedLines.length,
        });
      }
    } catch (error) {
      logger.memory.error("[ProfileUpdater:flagship] 旗舰模型分析失败:", { error: (error as Error).message });
    }
  }

  /**
   * 立即执行画像分析并更新 profile.md（标准模型）
   */
  async runAnalysis(): Promise<void> {
    if (this.analysisQueue.length === 0) return;
    if (ModelAdapter.isDegradedMode) return;

    // 取全部队列内容做长期画像分析（不清空，只移除已分析的前 N 条）
    const analysisCount = Math.min(this.analysisQueue.length, 30);
    const conversation = this.analysisQueue.slice(0, analysisCount).join("\n\n---\n\n");
    this.analysisQueue = this.analysisQueue.slice(analysisCount);

    const existingProfile = this.readExistingProfile();

    try {
      const model = createLanguageModel();
      const result = await generateText({
        model,
        messages: [
          {
            role: "user",
            content: PROFILE_ANALYSIS_PROMPT.replace(
              "{existing}",
              existingProfile || "暂无画像",
            ).replace("{conversation}", conversation),
          },
        ],
        maxOutputTokens: 800,
        temperature: 0.5,
      });

      const updatedProfile = result.text.trim();
      if (updatedProfile && updatedProfile.length > 20) {
        // 相似度阈值检查：避免画像无明显变化时反复回写导致 prompt 缓存震荡
        const similarity = this.lineJaccardSimilarity(existingProfile, updatedProfile);
        if (similarity >= this.UPDATE_SIMILARITY_THRESHOLD) {
          logger.memory.info("[ProfileUpdater] 画像变化不显著，跳过回写", { similarity: similarity.toFixed(3) });
          return;
        }

        // 计算变更摘要（新增了哪些行）
        const addedLines = this.computeAddedLines(existingProfile, updatedProfile);

        await withLock(async () => {
          this.writeProfile(updatedProfile);
          this.appendChangelog(similarity, addedLines);
        });
        // 画像更新后，让前缀缓存失效
        PromptCache.getInstance().invalidate("system-prefix");
        logger.memory.info("[ProfileUpdater] 用户画像已更新", {
          similarity: similarity.toFixed(3),
          addedLines: addedLines.length,
        });
      }
    } catch (error) {
      logger.memory.error("[ProfileUpdater] 分析失败:", { error: (error as Error).message });
    }
  }

  /**
   * 获取当前画像内容（供系统提示词使用）
   */
  getProfileContent(): string {
    return this.readExistingProfile() || "暂无用户画像";
  }

  private readExistingProfile(): string {
    try {
      const profilePath = getProfilePath();
      if (existsSync(profilePath)) {
        return readFileSync(profilePath, "utf-8").trim();
      }
    } catch {
      /* ignore */
    }
    return "";
  }

  /**
   * 新旧画像的行级 Jaccard 相似度：|交集| / |并集|
   * 用于判断 LLM 输出是否带来显著变化；完全空画像时返回 0（强制写入）。
   */
  private lineJaccardSimilarity(existing: string, updated: string): number {
    if (!existing) return 0;
    const setA = new Set(existing.split(/\n+/).map((l) => l.trim()).filter(Boolean));
    const setB = new Set(updated.split(/\n+/).map((l) => l.trim()).filter(Boolean));
    if (setA.size === 0 && setB.size === 0) return 1;
    let intersection = 0;
    for (const line of setA) {
      if (setB.has(line)) intersection++;
    }
    const union = setA.size + setB.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  private writeProfile(content: string): void {
    try {
      const profilePath = getProfilePath();
      const formatted = content.startsWith("#") ? content : `# 用户画像\n\n${content}`;
      writeFileSync(profilePath, formatted, "utf-8");
    } catch (error) {
      logger.memory.error("[ProfileUpdater] 写入失败:", { error: (error as Error).message });
    }
  }

  /**
   * 计算新旧画像之间新增的行（用于变更摘要）。
   */
  private computeAddedLines(existing: string, updated: string): string[] {
    const existingLines = new Set(
      existing.split(/\n+/).map((l) => l.trim()).filter(Boolean),
    );
    const updatedLines = updated.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    return updatedLines.filter((line) => !existingLines.has(line) && !line.startsWith("#"));
  }

  /**
   * 追加一条变更记录到 profile-changelog.jsonl。
   * 每行一个 JSON 对象，便于流式读取和追加。
   */
  private appendChangelog(similarity: number, addedLines: string[]): void {
    try {
      const changelogPath = join(getMemoryRoot(), "profile-changelog.jsonl");
      const entry = {
        timestamp: new Date().toISOString(),
        similarity: Number(similarity.toFixed(3)),
        addedCount: addedLines.length,
        addedHighlights: addedLines.slice(0, 5), // 最多记录前 5 条新增行作为摘要
      };
      appendFileSync(changelogPath, JSON.stringify(entry) + "\n", "utf-8");
    } catch (error) {
      logger.memory.error("[ProfileUpdater] 写入变更日志失败:", { error: (error as Error).message });
    }
  }

  /**
   * 读取最近的画像变更历史（供前端可视化）。
   * @param limit 最多返回条数，默认 20
   */
  getChangelog(limit = 20): Array<{
    timestamp: string;
    similarity: number;
    addedCount: number;
    addedHighlights: string[];
  }> {
    try {
      const changelogPath = join(getMemoryRoot(), "profile-changelog.jsonl");
      if (!existsSync(changelogPath)) return [];
      const content = readFileSync(changelogPath, "utf-8");
      const lines = content.split("\n").filter(Boolean);
      // 取最后 limit 条
      const recent = lines.slice(-limit);
      return recent
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean) as Array<{
        timestamp: string;
        similarity: number;
        addedCount: number;
        addedHighlights: string[];
      }>;
    } catch {
      return [];
    }
  }
}
