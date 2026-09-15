import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";

/**
 * 监听源自动 seed 单测（监听源零配置）。
 * 验证：首次初始化自动写入本机工具预设（目录存在才启用）、
 * flag 幂等（用户删除后不复活）、v2 迁移修正预设路径但保留用户 enabled。
 */

const { dbRef, existsSyncMock } = vi.hoisted(() => ({
  dbRef: { current: null as Database.Database | null },
  existsSyncMock: vi.fn(),
}));

vi.mock("../lib/storage/database", () => ({
  getDatabase: () => dbRef.current,
  closeDatabase: () => undefined,
}));

vi.mock("fs", () => ({
  existsSync: existsSyncMock,
}));

import { ConfigService } from "../server/services/config-service";

/** 预设 id（与 seedDefaultToolSources 的 `preset-${key}` 规则一致） */
const PRESET_IDS = [
  "preset-codex",
  "preset-claude-code",
  "preset-cursor",
  "preset-trae",
  "preset-trae-intl",
];

function listSources(): Array<{
  id: string;
  enabled: number;
  path: string;
  filePattern: string;
  topic: string | null;
}> {
  return dbRef.current!
    .prepare("SELECT id, enabled, path, filePattern, topic FROM tool_watch_sources")
    .all() as Array<{
    id: string;
    enabled: number;
    path: string;
    filePattern: string;
    topic: string | null;
  }>;
}

function flagExists(): boolean {
  return !!dbRef.current!.prepare("SELECT 1 FROM config WHERE key = ?").get("tool_sources_seeded_v2");
}

beforeEach(() => {
  dbRef.current = new Database(":memory:");
  existsSyncMock.mockReset();
});

describe("ConfigService.seedDefaultToolSources（监听源零配置）", () => {
  it("首次初始化自动写入全部预设源，目录存在才启用", () => {
    // 本机只装了 Claude Code 与 Codex
    existsSyncMock.mockImplementation(
      (path: string) => path.includes(".claude") || path.includes("codex"),
    );

    new ConfigService();

    const sources = listSources();
    expect(sources.map((s) => s.id).sort()).toEqual([...PRESET_IDS].sort());
    expect(sources.find((s) => s.id === "preset-claude-code")?.enabled).toBe(1);
    expect(sources.find((s) => s.id === "preset-claude-code")?.topic).toBe("claude-code-sessions");
    expect(sources.find((s) => s.id === "preset-claude-code")?.path).toBe("~/.claude/projects");
    expect(sources.find((s) => s.id === "preset-cursor")?.path).toBe("~/.cursor/projects");
    // Codex 路径随平台变化（Windows %APPDATA%，Unix ~/.codex），共同后缀断言
    expect(sources.find((s) => s.id === "preset-codex")?.path).toContain("codex/sessions");
    expect(sources.find((s) => s.id === "preset-codex")?.enabled).toBe(1);
    expect(sources.find((s) => s.id === "preset-trae")?.enabled).toBe(0);
    expect(sources.find((s) => s.id === "preset-trae-intl")?.enabled).toBe(0);
    expect(flagExists()).toBe(true);
  });

  it("seed 一生一次：用户删除全部监听源后重启不会复活", () => {
    existsSyncMock.mockReturnValue(false);
    new ConfigService();

    dbRef.current!.prepare("DELETE FROM tool_watch_sources").run();
    new ConfigService(); // 第二次初始化（如重启）

    expect(listSources()).toEqual([]);
  });

  it("v2 迁移：修正预设路径与递归 pattern，但保留用户 enabled 与自定义源", () => {
    existsSyncMock.mockReturnValue(true);
    new ConfigService();

    // 把 flag 降级为 v1，模拟 v1 时代装机的存量库（否则第二次初始化会被 v2 flag 短路）
    dbRef.current!
      .prepare("UPDATE config SET key = 'tool_sources_seeded_v1' WHERE key = 'tool_sources_seeded_v2'")
      .run();

    // 模拟 v1 时代的旧预设行 + 用户自定义行 + 用户禁用了 claude-code
    dbRef.current!
      .prepare("UPDATE tool_watch_sources SET path = ?, filePattern = ? WHERE id = ?")
      .run("~/.codex/sessions", "*.jsonl", "preset-codex");
    dbRef.current!
      .prepare("UPDATE tool_watch_sources SET enabled = 0 WHERE id = ?")
      .run("preset-claude-code");
    dbRef.current!
      .prepare(
        "INSERT INTO tool_watch_sources (id, name, toolType, path, filePattern, enabled, topic, description, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run("user-custom", "我的笔记", "markdown", "~/notes", "*.md", 1, null, null, "t", "t");

    new ConfigService(); // v1→v2 迁移触发

    const sources = listSources();
    const codex = sources.find((s) => s.id === "preset-codex")!;
    expect(codex.path).toContain("codex/sessions");
    expect(codex.filePattern).toBe("**/*.jsonl"); // 日期嵌套目录需要递归
    expect(sources.find((s) => s.id === "preset-claude-code")?.enabled).toBe(0); // 用户禁用不被重置
    expect(sources.find((s) => s.id === "user-custom")?.path).toBe("~/notes"); // 自定义源不动
  });
});
