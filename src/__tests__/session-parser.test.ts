import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { parseSession } from "../lib/tools/session-parser";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function writeTempFile(name: string, content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "session-parser-"));
  tempDirs.push(dir);
  const filePath = join(dir, name);
  await writeFile(filePath, content, "utf-8");
  return filePath;
}

describe("parseSession toolType=trae", () => {
  it("renders structured summaries as Chinese markdown", async () => {
    const filePath = await writeTempFile(
      "session_memory_2026-08-02.jsonl",
      [
        JSON.stringify({
          intent: "公正评价一下这个项目",
          actions: ["通读 AGENTS.md", "运行 vitest"],
          outcome: "给出评价",
          learned: ["测试覆盖率较高"],
          message_summary_time: "2026-08-02 18:37:29",
        }),
        "not-json-line",
        JSON.stringify({ intent: "" }),
        JSON.stringify({
          intent: "配置工具监听自动采集会话",
          actions: [],
          learned: [],
        }),
      ].join("\n"),
    );

    const parsed = await parseSession(filePath, "trae");

    expect(parsed).not.toBeNull();
    expect(parsed?.source).toBe("trae");
    expect(parsed?.title).toBe("公正评价一下这个项目");
    expect(parsed?.messageCount).toBe(2);
    expect(parsed?.content).toContain("### 意图");
    expect(parsed?.content).toContain("**动作**：通读 AGENTS.md；运行 vitest");
    expect(parsed?.content).toContain("**结果**：给出评价");
    expect(parsed?.content).toContain("**经验**：测试覆盖率较高");
    expect(parsed?.content).toContain("**时间**：2026-08-02 18:37:29");
    expect(parsed?.content).toContain("配置工具监听自动采集会话");
  });

  it("falls back to file name when no line has intent", async () => {
    const filePath = await writeTempFile("empty.jsonl", "not-json\n");
    const parsed = await parseSession(filePath, "trae");

    expect(parsed?.title).toBe("empty");
    expect(parsed?.messageCount).toBe(0);
  });
});
