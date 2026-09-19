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
  description: string | null;
}> {
  return dbRef.current!
    .prepare("SELECT id, enabled, path, filePattern, topic, description FROM tool_watch_sources")
    .all() as Array<{
    id: string;
    enabled: number;
    path: string;
    filePattern: string;
    topic: string | null;
    description: string | null;
  }>;
}

function flagExists(): boolean {
  return !!dbRef.current!.prepare("SELECT 1 FROM config WHERE key = ?").get("tool_sources_seeded_v3");
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
    // Codex 预设在所有平台都是 ~/.codex/sessions（CODEX_HOME 默认主目录）
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

  it("v3 迁移：纠正 v2 误记的 Codex 路径并恢复其启用，用户手动禁用与自定义源不动", () => {
    existsSyncMock.mockReturnValue(true);
    new ConfigService();

    // 把 flag 降级为 v2，模拟 v2 时代装机的存量库（否则第二次初始化会被 v3 flag 短路）
    dbRef.current!
      .prepare("UPDATE config SET key = 'tool_sources_seeded_v2' WHERE key = 'tool_sources_seeded_v3'")
      .run();

    // 模拟 v2 时代的 preset-codex：%APPDATA% 误记路径 + 因目录不存在被自动禁用（带标记）
    dbRef.current!
      .prepare("UPDATE tool_watch_sources SET path = ?, filePattern = ?, enabled = 0, description = ? WHERE id = ?")
      .run("%APPDATA%/codex/sessions", "*.jsonl", "首次启动自动添加（本机未检测到该工具目录，装好后启用即可），可删除", "preset-codex");
    // 用户手动禁用了 claude-code（描述为"已检测到"文案，无自动禁用标记）
    dbRef.current!
      .prepare("UPDATE tool_watch_sources SET enabled = 0 WHERE id = ?")
      .run("preset-claude-code");
    dbRef
      .current!.prepare(
        "INSERT INTO tool_watch_sources (id, name, toolType, path, filePattern, enabled, topic, description, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run("user-custom", "我的笔记", "markdown", "~/notes", "*.md", 1, null, null, "t", "t");

    new ConfigService(); // v2→v3 迁移触发

    const sources = listSources();
    const codex = sources.find((s) => s.id === "preset-codex")!;
    expect(codex.path).toBe("~/.codex/sessions"); // %APPDATA% 误记被纠正
    expect(codex.filePattern).toBe("**/*.jsonl"); // 日期嵌套目录需要递归
    expect(codex.enabled).toBe(1); // 自动禁用（带标记）且目录就绪 → 恢复启用
    expect(sources.find((s) => s.id === "preset-claude-code")?.enabled).toBe(0); // 用户禁用不被重置
    expect(sources.find((s) => s.id === "user-custom")?.path).toBe("~/notes"); // 自定义源不动
  });

  it("自愈：seed 时目录缺失的预设，装好工具后下次初始化自动启用", () => {
    existsSyncMock.mockReturnValue(false);
    new ConfigService();
    expect(listSources().find((s) => s.id === "preset-codex")?.enabled).toBe(0);

    // 用户装好了 Codex（目录出现）
    existsSyncMock.mockImplementation((path: string) => String(path).includes("codex"));
    new ConfigService();

    const codex = listSources().find((s) => s.id === "preset-codex")!;
    expect(codex.enabled).toBe(1);
    expect(codex.description).not.toContain("本机未检测到该工具目录"); // 标记清除
    // 目录仍缺失的预设保持禁用
    expect(listSources().find((s) => s.id === "preset-cursor")?.enabled).toBe(0);
    expect(listSources().find((s) => s.id === "preset-trae")?.enabled).toBe(0);
  });

  it("路径跟随：存量预设行的残留错误路径在下次初始化自动同步为系统预设", () => {
    existsSyncMock.mockReturnValue(true);
    new ConfigService();
    // 模拟历史版本/拷贝库遗留的错误路径（如 %APPDATA% 误记）
    dbRef.current!
      .prepare("UPDATE tool_watch_sources SET path = ? WHERE id = ?")
      .run("%APPDATA%/codex/sessions", "preset-codex");

    new ConfigService();

    expect(listSources().find((s) => s.id === "preset-codex")?.path).toBe("~/.codex/sessions");
  });

  it("自愈不越权：用户手动禁用的预设（无标记）不被自动启用", () => {
    existsSyncMock.mockReturnValue(true);
    new ConfigService();
    dbRef.current!
      .prepare("UPDATE tool_watch_sources SET enabled = 0 WHERE id = ?")
      .run("preset-trae");

    new ConfigService();

    expect(listSources().find((s) => s.id === "preset-trae")?.enabled).toBe(0);
  });
});
