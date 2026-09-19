import { getDatabase } from "../../lib/storage/database";
import {
  AiConfig,
  McpServerConfig,
  SkillConfig,
  StorageConfig,
  ToolWatchSource,
  ToolType,
} from "../../types/config";
import { env } from "../../config/env";
import { expandSourcePath, getToolPresets } from "../../config/tool-presets";
import { existsSync } from "fs";
import Database from "better-sqlite3";

/**
 * 预设监听源的描述文案与"自动禁用"标记。
 * seed 时目录不存在的预设写入 MISSING 文案（含标记）；之后目录就绪时，
 * revalidatePresetSources 依据标记区分"seed 自动禁用"与"用户手动禁用"，
 * 只自动恢复前者——用户手动禁用（无标记）永不触碰。
 */
const PRESET_MISSING_MARKER = "本机未检测到该工具目录";
const PRESET_DIR_READY_TEXT = "首次启动自动添加（检测到本机已安装该工具），可在下方禁用或删除";
const PRESET_DIR_MISSING_TEXT =
  "首次启动自动添加（本机未检测到该工具目录，装好后自动启用），可删除";

export class ConfigService {
  private db: Database.Database;

  constructor() {
    this.db = getDatabase();
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        command TEXT NOT NULL,
        args TEXT NOT NULL DEFAULT '[]',
        env TEXT NOT NULL DEFAULT '{}',
        description TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        trigger TEXT NOT NULL,
        description TEXT,
        prompt TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )
    `);

    if (!this.getAiConfig()) {
      this.setAiConfig(this.getDefaultAiConfig());
    }
    if (!this.getStorageConfig()) {
      this.setStorageConfig(this.getDefaultStorageConfig());
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tool_watch_sources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        toolType TEXT NOT NULL,
        path TEXT NOT NULL,
        filePattern TEXT NOT NULL DEFAULT '*.jsonl',
        enabled INTEGER NOT NULL DEFAULT 1,
        topic TEXT,
        description TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )
    `);

    this.seedDefaultToolSources();
    this.revalidatePresetSources();
  }

  /**
   * 首次初始化时自动 seed 本地工具预设（I：监听源零配置）。
   *
   * 用户诉求：换一台电脑不需要手动配置路径——Claude Code 等工具的会话目录
   * 固定在 ~/ 下（~/.claude/projects 等），用主目录展开即可定位，无需用户输入。
   * 因此建表后把预设源直接写进库：目录存在则启用，不存在则禁用（留档，装好
   * 工具后由 revalidatePresetSources 自动启用）。
   *
   * 幂等与迁移：flag 带版本号。
   * - v1→v2：预设路径跨平台修正（Cursor 的 ~/.cursor/projects）。
   * - v2→v3：Codex 路径纠错——%APPDATA%\codex 为误记，Windows 上同样是
   *   ~/.codex/sessions（2026-09-19 实机核验）。存量 v2 库的 preset-codex
   *   因此被错误禁用，本版迁移更新路径并对"带自动禁用标记"的行恢复启用。
   *
   * 对已存在的 preset-* 行更新 path/filePattern/name/topic，但尊重用户
   * enabled——用户改路径请复制条目修改，preset-* 条目始终跟随系统预设版本。
   */
  private seedDefaultToolSources(): void {
    const flagKey = "tool_sources_seeded_v3";
    const seeded = this.db.prepare("SELECT 1 FROM config WHERE key = ?").get(flagKey);
    if (seeded) return;

    const now = new Date().toISOString();
    const insert = this.db.prepare(`
      INSERT INTO tool_watch_sources
        (id, name, toolType, path, filePattern, enabled, topic, description, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const update = this.db.prepare(`
      UPDATE tool_watch_sources
      SET name = ?, path = ?, filePattern = ?, topic = ?, description = ?, enabled = ?, updatedAt = ?
      WHERE id = ?
    `);

    for (const [key, preset] of Object.entries(getToolPresets())) {
      const id = `preset-${key}`;
      const dirExists = existsSync(expandSourcePath(preset.path));
      const description = dirExists ? PRESET_DIR_READY_TEXT : PRESET_DIR_MISSING_TEXT;
      const existing = this.db
        .prepare("SELECT enabled, description FROM tool_watch_sources WHERE id = ?")
        .get(id) as { enabled: number; description: string | null } | undefined;
      if (existing) {
        // 曾因"目录不存在"被 seed 自动禁用（带标记）且目录现已就绪 → 恢复启用；
        // 用户手动禁用（无标记）保持禁用
        const shouldEnable =
          dirExists &&
          existing.enabled === 0 &&
          (existing.description ?? "").includes(PRESET_MISSING_MARKER);
        update.run(
          preset.name,
          preset.path,
          preset.filePattern,
          preset.topic,
          description,
          shouldEnable ? 1 : existing.enabled,
          now,
          id,
        );
      } else {
        insert.run(
          id,
          preset.name,
          preset.toolType,
          preset.path,
          preset.filePattern,
          dirExists ? 1 : 0,
          preset.topic,
          description,
          now,
          now,
        );
      }
    }

    this.db
      .prepare("INSERT OR REPLACE INTO config (key, value, updatedAt) VALUES (?, ?, ?)")
      .run(flagKey, now, now);
  }

  /**
   * 预设监听源的自愈（每次初始化都跑，5 次 existsSync，成本可忽略，仅在实际变更时写库）：
   * 1. 路径跟随：preset-* 行的 name/path/filePattern/topic 始终以当前系统预设为准——
   *    覆盖环境变量（CODEX_HOME / CLAUDE_CONFIG_DIR）后设、库被拷贝到别的机器、
   *    以及任何历史版本残留的错误路径。用户想自定义路径请复制条目修改。
   * 2. 目录就绪自愈：seed 时目录不存在的预设被禁用并带标记，用户之后装好工具，
   *    检测到目录出现即恢复启用。只处理带自动禁用标记的行——用户手动禁用（无标记）
   *    永不触碰。
   * watcher 启动（startToolDirWatcher）内部会构造 ConfigService，因此应用启动时
   * 变更当次即生效；运行中变更则由 watcher 的周期对账捕捉。
   */
  private revalidatePresetSources(): void {
    const rows = this.db
      .prepare("SELECT * FROM tool_watch_sources WHERE id LIKE 'preset-%'")
      .all() as Array<{
      id: string;
      name: string;
      enabled: number;
      path: string;
      filePattern: string;
      topic: string | null;
      description: string | null;
    }>;

    for (const row of rows) {
      const preset = getToolPresets()[row.id.slice("preset-".length)];
      if (!preset) continue;

      // 1. 预设行路径/元数据跟随系统预设版本
      if (
        row.path !== preset.path ||
        row.filePattern !== preset.filePattern ||
        row.name !== preset.name ||
        (row.topic ?? null) !== preset.topic
      ) {
        this.db
          .prepare(
            "UPDATE tool_watch_sources SET name = ?, path = ?, filePattern = ?, topic = ?, updatedAt = ? WHERE id = ?",
          )
          .run(preset.name, preset.path, preset.filePattern, preset.topic, new Date().toISOString(), row.id);
      }

      // 2. 目录就绪自愈（带自动禁用标记才恢复）
      if (row.enabled !== 0) continue;
      if (!(row.description ?? "").includes(PRESET_MISSING_MARKER)) continue;
      if (!existsSync(expandSourcePath(preset.path))) continue;

      this.db
        .prepare(
          "UPDATE tool_watch_sources SET enabled = 1, description = ?, updatedAt = ? WHERE id = ?",
        )
        .run(PRESET_DIR_READY_TEXT, new Date().toISOString(), row.id);
    }
  }

  // ── 存储路径配置（笔记根目录，运行时可热重载） ──

  getStorageConfig(): StorageConfig | null {
    const stmt = this.db.prepare("SELECT value FROM config WHERE key = 'storage'");
    const row = stmt.get() as { value: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.value) as StorageConfig;
    } catch {
      return null;
    }
  }

  setStorageConfig(config: StorageConfig): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO config (key, value, updatedAt) VALUES (?, ?, ?)
    `);
    stmt.run("storage", JSON.stringify(config), new Date().toISOString());
  }

  getDefaultStorageConfig(): StorageConfig {
    return {
      notesPath: env.MEMORY_ROOT,
      updatedAt: new Date().toISOString(),
    };
  }

  getAiConfig(): AiConfig | null {
    const stmt = this.db.prepare("SELECT value FROM config WHERE key = 'ai'");
    const row = stmt.get() as { value: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.value) as AiConfig;
  }

  setAiConfig(config: AiConfig): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO config (key, value, updatedAt) VALUES (?, ?, ?)
    `);
    stmt.run("ai", JSON.stringify(config), new Date().toISOString());
  }

  listMcpServers(): McpServerConfig[] {
    const stmt = this.db.prepare("SELECT * FROM mcp_servers ORDER BY updatedAt DESC");
    const rows = stmt.all() as any[];
    return rows.map((row) => this.mapMcpServer(row));
  }

  getMcpServer(id: string): McpServerConfig | null {
    const stmt = this.db.prepare("SELECT * FROM mcp_servers WHERE id = ?");
    const row = stmt.get(id) as any;
    if (!row) return null;
    return this.mapMcpServer(row);
  }

  createMcpServer(
    server: Omit<McpServerConfig, "id" | "createdAt" | "updatedAt">,
  ): McpServerConfig {
    const now = new Date().toISOString();
    const id = `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const stmt = this.db.prepare(`
      INSERT INTO mcp_servers (id, name, enabled, command, args, env, description, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      server.name,
      server.enabled ? 1 : 0,
      server.command,
      JSON.stringify(server.args || []),
      JSON.stringify(server.env || {}),
      server.description || null,
      now,
      now,
    );
    return this.getMcpServer(id)!;
  }

  updateMcpServer(id: string, updates: Partial<McpServerConfig>): McpServerConfig | null {
    const existing = this.getMcpServer(id);
    if (!existing) return null;

    const merged = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    const stmt = this.db.prepare(`
      UPDATE mcp_servers SET
        name = ?, enabled = ?, command = ?, args = ?, env = ?, description = ?, updatedAt = ?
      WHERE id = ?
    `);
    stmt.run(
      merged.name,
      merged.enabled ? 1 : 0,
      merged.command,
      JSON.stringify(merged.args || []),
      JSON.stringify(merged.env || {}),
      merged.description || null,
      merged.updatedAt,
      id,
    );
    return this.getMcpServer(id);
  }

  deleteMcpServer(id: string): boolean {
    const stmt = this.db.prepare("DELETE FROM mcp_servers WHERE id = ?");
    const result = stmt.run(id);
    return result.changes > 0;
  }

  listSkills(): SkillConfig[] {
    const stmt = this.db.prepare("SELECT * FROM skills ORDER BY updatedAt DESC");
    const rows = stmt.all() as any[];
    return rows.map((row) => this.mapSkill(row));
  }

  getSkill(id: string): SkillConfig | null {
    const stmt = this.db.prepare("SELECT * FROM skills WHERE id = ?");
    const row = stmt.get(id) as any;
    if (!row) return null;
    return this.mapSkill(row);
  }

  createSkill(skill: Omit<SkillConfig, "id" | "createdAt" | "updatedAt">): SkillConfig {
    const now = new Date().toISOString();
    const id = `skill_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const stmt = this.db.prepare(`
      INSERT INTO skills (id, name, enabled, trigger, description, prompt, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      skill.name,
      skill.enabled ? 1 : 0,
      skill.trigger,
      skill.description || null,
      skill.prompt,
      now,
      now,
    );
    return this.getSkill(id)!;
  }

  updateSkill(id: string, updates: Partial<SkillConfig>): SkillConfig | null {
    const existing = this.getSkill(id);
    if (!existing) return null;

    const merged = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    const stmt = this.db.prepare(`
      UPDATE skills SET
        name = ?, enabled = ?, trigger = ?, description = ?, prompt = ?, updatedAt = ?
      WHERE id = ?
    `);
    stmt.run(
      merged.name,
      merged.enabled ? 1 : 0,
      merged.trigger,
      merged.description || null,
      merged.prompt,
      merged.updatedAt,
      id,
    );
    return this.getSkill(id);
  }

  deleteSkill(id: string): boolean {
    const stmt = this.db.prepare("DELETE FROM skills WHERE id = ?");
    const result = stmt.run(id);
    return result.changes > 0;
  }

  getDefaultAiConfig(): AiConfig {
    return {
      provider: "openai-compatible",
      baseURL: "https://api.openai.com/v1",
      apiKey: "",
      flagship: {
        model: "gpt-4o",
        maxTokens: 8192,
        temperature: 0.3,
        timeout: 60000,
        maxRetries: 3,
      },
      standard: {
        model: "gpt-4o-mini",
        maxTokens: 4096,
        temperature: 0.7,
        timeout: 30000,
        maxRetries: 2,
      },
      budget: {
        model: "gpt-4o-mini",
        maxTokens: 2048,
        temperature: 0.6,
        timeout: 15000,
        maxRetries: 1,
      },
      embedding: {
        model: "text-embedding-3-small",
        dimensions: 1536,
        maxConcurrency: 8,
        queueTimeoutMs: 60000,
        apiKey: "",
        baseURL: "",
      },
    };
  }

  private mapMcpServer(row: any): McpServerConfig {
    return {
      id: row.id,
      name: row.name,
      enabled: Boolean(row.enabled),
      command: row.command,
      args: JSON.parse(row.args || "[]"),
      env: JSON.parse(row.env || "{}"),
      description: row.description,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapSkill(row: any): SkillConfig {
    return {
      id: row.id,
      name: row.name,
      enabled: Boolean(row.enabled),
      trigger: row.trigger,
      description: row.description,
      prompt: row.prompt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  // ── 本地工具监听源 CRUD ──

  listToolSources(): ToolWatchSource[] {
    const stmt = this.db.prepare("SELECT * FROM tool_watch_sources ORDER BY updatedAt DESC");
    const rows = stmt.all() as any[];
    return rows.map((row) => this.mapToolSource(row));
  }

  getToolSource(id: string): ToolWatchSource | null {
    const stmt = this.db.prepare("SELECT * FROM tool_watch_sources WHERE id = ?");
    const row = stmt.get(id) as any;
    if (!row) return null;
    return this.mapToolSource(row);
  }

  createToolSource(
    source: Omit<ToolWatchSource, "id" | "createdAt" | "updatedAt">,
  ): ToolWatchSource {
    const now = new Date().toISOString();
    const id = `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const stmt = this.db.prepare(`
      INSERT INTO tool_watch_sources (id, name, toolType, path, filePattern, enabled, topic, description, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      source.name,
      source.toolType,
      source.path,
      source.filePattern || "*.jsonl",
      source.enabled ? 1 : 0,
      source.topic || null,
      source.description || null,
      now,
      now,
    );
    return this.getToolSource(id)!;
  }

  updateToolSource(id: string, updates: Partial<ToolWatchSource>): ToolWatchSource | null {
    const existing = this.getToolSource(id);
    if (!existing) return null;

    const merged = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    const stmt = this.db.prepare(`
      UPDATE tool_watch_sources SET
        name = ?, toolType = ?, path = ?, filePattern = ?, enabled = ?, topic = ?, description = ?, updatedAt = ?
      WHERE id = ?
    `);
    stmt.run(
      merged.name,
      merged.toolType,
      merged.path,
      merged.filePattern,
      merged.enabled ? 1 : 0,
      merged.topic || null,
      merged.description || null,
      merged.updatedAt,
      id,
    );
    return this.getToolSource(id);
  }

  deleteToolSource(id: string): boolean {
    const stmt = this.db.prepare("DELETE FROM tool_watch_sources WHERE id = ?");
    const result = stmt.run(id);
    return result.changes > 0;
  }

  /** 获取所有启用的监听源（watcher 启动时使用） */
  listEnabledToolSources(): ToolWatchSource[] {
    const stmt = this.db.prepare(
      "SELECT * FROM tool_watch_sources WHERE enabled = 1 ORDER BY createdAt ASC",
    );
    const rows = stmt.all() as any[];
    return rows.map((row) => this.mapToolSource(row));
  }

  private mapToolSource(row: any): ToolWatchSource {
    return {
      id: row.id,
      name: row.name,
      toolType: row.toolType as ToolType,
      path: row.path,
      filePattern: row.filePattern,
      enabled: Boolean(row.enabled),
      topic: row.topic,
      description: row.description,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  close(): void {
    // shared connection — no-op
  }
}
