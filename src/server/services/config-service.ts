import { getDatabase } from "../../lib/storage/database";
import { AiConfig, McpServerConfig, SkillConfig, StorageConfig, ToolWatchSource, ToolType } from "../../types/config";
import { env } from "../../config/env";
import Database from "better-sqlite3";

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
