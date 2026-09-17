import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 工具预设路径单测：跨平台路径选择（Codex 的 %APPDATA%）、
 * 路径占位符展开（~ 与 %APPDATA%）。
 */

const originalPlatform = process.platform;

function setPlatform(platform: string): void {
  Object.defineProperty(process, "platform", { value: platform });
}

afterEach(() => {
  setPlatform(originalPlatform);
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadPresets() {
  const mod = await import("../config/tool-presets");
  return mod;
}

describe("getToolPresets（跨平台预设路径）", () => {
  it("Windows 上 Codex 走 %APPDATA%/codex/sessions，其余平台走 ~/.codex/sessions", async () => {
    setPlatform("win32");
    let presets = (await loadPresets()).getToolPresets();
    expect(presets.codex.path).toBe("%APPDATA%/codex/sessions");

    setPlatform("linux");
    vi.resetModules();
    presets = (await loadPresets()).getToolPresets();
    expect(presets.codex.path).toBe("~/.codex/sessions");
  });

  it("五个预设齐全，filePattern 均为递归 jsonl（日期嵌套/项目子目录）", async () => {
    const { getToolPresets } = await loadPresets();
    const presets = getToolPresets();
    expect(Object.keys(presets).sort()).toEqual([
      "claude-code",
      "codex",
      "cursor",
      "trae",
      "trae-intl",
    ]);
    expect(presets["claude-code"].filePattern).toBe("**/*.jsonl");
    expect(presets.cursor.path).toBe("~/.cursor/projects");
    expect(presets["trae-intl"].path).toBe("~/.trae/memory");
  });
});

describe("expandSourcePath（路径占位符展开）", () => {
  it("~ 展开为用户主目录（USERPROFILE 优先，HOME 兜底）", async () => {
    const { expandSourcePath } = await loadPresets();
    vi.stubEnv("USERPROFILE", "C:\\Users\\alice");
    vi.stubEnv("HOME", "/home/alice");
    expect(expandSourcePath("~/.claude/projects")).toBe(
      join("C:\\Users\\alice", ".claude/projects"),
    );

    vi.stubEnv("USERPROFILE", "");
    // 分隔符随平台（join 在 Windows 上用反斜杠），用 join 计算期望值保持跨平台
    expect(expandSourcePath("~/.claude/projects")).toBe(join("/home/alice", ".claude/projects"));
  });

  it("%APPDATA% 展开为 Windows Roaming 目录", async () => {
    const { expandSourcePath } = await loadPresets();
    vi.stubEnv("APPDATA", "C:\\Users\\alice\\AppData\\Roaming");
    expect(expandSourcePath("%APPDATA%/codex/sessions")).toBe(
      "C:\\Users\\alice\\AppData\\Roaming/codex/sessions",
    );
  });

  it("环境变量缺失时原样返回，普通绝对路径不处理", async () => {
    const { expandSourcePath } = await loadPresets();
    vi.stubEnv("APPDATA", "");
    expect(expandSourcePath("%APPDATA%/codex/sessions")).toBe("%APPDATA%/codex/sessions");
    expect(expandSourcePath("/var/log")).toBe("/var/log");
  });
});
