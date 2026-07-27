/**
 * 提示词前缀缓存 —— 系统 prompt 的静态部分只计算一次，动态部分每次构建。
 *
 * 缓存策略：
 * - 模板内容变更 → 清缓存
 * - profile.md 修改 → 清缓存
 * - 记忆库变化 → 只清动态部分
 */
import { readFileSync, existsSync, statSync } from "fs";
import { getProfilePath } from "../storage/path-resolver";

interface CacheEntry {
  content: string;
  createdAt: number;
  profileMtime: number;
  templateHash: string;
}

export class PromptCache {
  private cache = new Map<string, CacheEntry>();
  private static instance: PromptCache;
  private profileMtime = 0;

  static getInstance(): PromptCache {
    if (!this.instance) {
      this.instance = new PromptCache();
    }
    return this.instance;
  }

  /** 获取缓存的系统前缀，若缓存失效则重建 */
  getOrBuild(
    key: string,
    builder: () => string,
    templateHash: string
  ): string {
    const cached = this.cache.get(key);
    const currentProfileMtime = this.getProfileMtime();

    if (
      cached &&
      cached.templateHash === templateHash &&
      cached.profileMtime === currentProfileMtime
    ) {
      return cached.content;
    }

    const content = builder();
    this.cache.set(key, {
      content,
      createdAt: Date.now(),
      profileMtime: currentProfileMtime,
      templateHash,
    });

    return content;
  }

  /** 使指定 key 的缓存失效 */
  invalidate(key: string): void {
    this.cache.delete(key);
  }

  /** 使所有缓存失效 */
  invalidateAll(): void {
    this.cache.clear();
  }

  /** 获取缓存的系统提示词前缀（包含用户画像） */
  getSystemPrefix(templateHash: string): string {
    return this.getOrBuild("system-prefix", () => {
      const profileContent = this.readProfile();
      return `你是 Auto-Memories-Doll，一个智能记忆伴侣助手。

## 用户画像
${profileContent || "暂无用户画像，在对话中将逐步了解用户偏好。"}

## 核心能力
- 基于用户的长期记忆库提供个性化对话
- 在对话中自动识别值得保存的信息
- 支持记忆的创建、查询、更新和关联

## 行为准则
- 亲切、温暖、简洁，像朋友一样自然交流
- 优先参考记忆内容回答问题，若记忆与问题相关则明确指出来源
- 若记忆库中没有相关信息，诚实说明而非编造
- 对用户说"记住""保存""记录"等内容时，确认并帮助整理记忆
- 根据用户画像调整回答风格和关注重点`;
    }, templateHash);
  }

  /** 获取相关记忆部分的缓存 */
  getMemoryCache(memoryContent: string): string {
    if (!memoryContent) return "暂无相关记忆";

    const key = `memory-${this.hashString(memoryContent)}`;
    const cached = this.cache.get(key);
    if (cached) return cached.content;

    const content = `## 相关记忆\n${memoryContent}\n\n## 回答格式\n- 使用 Markdown 格式使回答更清晰易读\n- 若引用了某条记忆，用引用块标注 [来自记忆]\n- 保持回答简洁，避免冗长，重点突出`;
    
    this.cache.set(key, {
      content,
      createdAt: Date.now(),
      profileMtime: 0,
      templateHash: "memory",
    });

    return content;
  }

  private readProfile(): string {
    try {
      const profilePath = getProfilePath();
      if (existsSync(profilePath)) {
        const content = readFileSync(profilePath, "utf-8").trim();
        return content || "正在构建用户画像中...";
      }
    } catch { /* ignore */ }
    return "正在构建用户画像中...";
  }

  private getProfileMtime(): number {
    try {
      const profilePath = getProfilePath();
      if (existsSync(profilePath)) {
        return statSync(profilePath).mtimeMs;
      }
    } catch { /* ignore */ }
    return this.profileMtime;
  }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }
}
