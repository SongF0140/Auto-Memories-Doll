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
import { readFileSync, writeFileSync, existsSync } from "fs";
import { getProfilePath } from "../../lib/storage/path-resolver";
import { PromptCache } from "../../lib/prompt/cache";
import { withLock } from "../../lib/storage/lock";

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
   * 立即执行画像分析并更新 profile.md
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
        await withLock(async () => {
          this.writeProfile(updatedProfile);
        });
        // 画像更新后，让前缀缓存失效
        PromptCache.getInstance().invalidate("system-prefix");
        console.log("[ProfileUpdater] 用户画像已更新");
      }
    } catch (error) {
      console.error("[ProfileUpdater] 分析失败:", (error as Error).message);
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

  private writeProfile(content: string): void {
    try {
      const profilePath = getProfilePath();
      const formatted = content.startsWith("#") ? content : `# 用户画像\n\n${content}`;
      writeFileSync(profilePath, formatted, "utf-8");
    } catch (error) {
      console.error("[ProfileUpdater] 写入失败:", (error as Error).message);
    }
  }
}
