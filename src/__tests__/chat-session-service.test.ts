import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { ChatSessionService } from "../server/services/chat-session-service";

let memoryRoot = "";

vi.mock("../lib/storage/path-resolver", () => ({
  getMemoryRoot: () => memoryRoot,
}));

describe("ChatSessionService", () => {
  beforeEach(() => {
    memoryRoot = mkdtempSync(join(tmpdir(), "amd-session-test-"));
  });

  afterEach(() => {
    if (memoryRoot && existsSync(memoryRoot)) {
      rmSync(memoryRoot, { recursive: true, force: true });
    }
  });

  it("appends a JSONL snapshot and filters system messages", () => {
    const service = new ChatSessionService();

    service.appendSnapshot({
      sessionId: "sess_abc",
      mode: "memory",
      messages: [
        { role: "system", content: "runtime prompt" },
        { role: "user", content: "remember this" },
        { role: "assistant", content: "saved" },
      ],
    });

    const filePath = join(memoryRoot, "sessions", "sess_abc.jsonl");
    const line = readFileSync(filePath, "utf-8").trim();
    const parsed = JSON.parse(line);

    expect(parsed.sessionId).toBe("sess_abc");
    expect(parsed.mode).toBe("memory");
    expect(parsed.messages).toEqual([
      { role: "user", content: "remember this" },
      { role: "assistant", content: "saved" },
    ]);
  });

  it("reads snapshots in append order", () => {
    const service = new ChatSessionService();

    service.appendSnapshot({
      sessionId: "sess_abc",
      mode: "chat",
      messages: [{ role: "user", content: "first" }],
    });
    service.appendSnapshot({
      sessionId: "sess_abc",
      mode: "prompt",
      messages: [{ role: "user", content: "second" }],
    });

    const snapshots = service.readSnapshots("sess_abc");

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].messages[0].content).toBe("first");
    expect(snapshots[1].messages[0].content).toBe("second");
  });

  it("sanitizes session ids before using them as filenames", () => {
    const service = new ChatSessionService();

    service.appendSnapshot({
      sessionId: "../bad/session",
      mode: "chat",
      messages: [{ role: "user", content: "safe" }],
    });

    expect(existsSync(join(memoryRoot, "sessions", "bad_session.jsonl"))).toBe(true);
    expect(existsSync(join(memoryRoot, "bad"))).toBe(false);
  });
});
