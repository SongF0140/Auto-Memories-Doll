import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
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

  it("returns the latest snapshot and lightweight session summaries", () => {
    const service = new ChatSessionService();
    service.appendSnapshot({
      sessionId: "sess_first",
      mode: "chat",
      messages: [{ role: "user", content: "A useful session title" }],
    });
    service.appendSnapshot({
      sessionId: "sess_first",
      mode: "memory",
      messages: [
        { role: "user", content: "A useful session title" },
        { role: "assistant", content: "complete answer" },
      ],
    });

    expect(service.getLatest("sess_first")?.messages).toHaveLength(2);
    expect(service.listSessions()).toEqual([
      expect.objectContaining({
        sessionId: "sess_first",
        mode: "memory",
        title: "A useful session title",
        messageCount: 2,
      }),
    ]);
  });

  it("uses an append-only tombstone to hide deleted sessions", () => {
    const service = new ChatSessionService();
    service.appendSnapshot({
      sessionId: "sess_deleted",
      mode: "chat",
      messages: [{ role: "user", content: "remove me" }],
    });
    service.appendDeleted("sess_deleted");

    expect(service.getLatest("sess_deleted")).toBeNull();
    expect(service.listSessions()).toEqual([]);
    expect(readFileSync(join(memoryRoot, "sessions", "sess_deleted.jsonl"), "utf-8")).toContain(
      '"type":"deleted"',
    );
  });

  it("skips a malformed trailing JSONL line", () => {
    const service = new ChatSessionService();
    service.appendSnapshot({
      sessionId: "sess_safe",
      mode: "chat",
      messages: [{ role: "user", content: "still readable" }],
    });
    const filePath = join(memoryRoot, "sessions", "sess_safe.jsonl");
    appendFileSync(filePath, "{unfinished\n", "utf-8");

    expect(service.getLatest("sess_safe")?.messages[0].content).toBe("still readable");
  });

  it("imports legacy data only when it contains more messages", () => {
    const service = new ChatSessionService();
    service.appendSnapshot({
      sessionId: "sess_legacy",
      mode: "chat",
      messages: [{ role: "user", content: "question" }],
    });

    expect(
      service.importSnapshot({
        sessionId: "sess_legacy",
        mode: "chat",
        messages: [
          { role: "user", content: "question" },
          { role: "assistant", content: "answer from localStorage" },
        ],
      }),
    ).toBe(true);
    expect(
      service.importSnapshot({
        sessionId: "sess_legacy",
        mode: "chat",
        messages: [{ role: "user", content: "question" }],
      }),
    ).toBe(false);
    expect(service.getLatest("sess_legacy")?.messages).toHaveLength(2);
  });

  it("captures the final assistant text from an AiEvent stream", async () => {
    const service = new ChatSessionService();
    const onComplete = vi.fn();
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "text_delta", content: "hello " } as const);
        controller.enqueue({ type: "text_delta", content: "world" } as const);
        controller.enqueue({ type: "done", finishReason: "stop" } as const);
        controller.close();
      },
    });
    const captured = service.captureAssistantStream({
      stream: source,
      sessionId: "sess_stream",
      mode: "chat",
      messages: [{ role: "user", content: "say hello" }],
      onComplete,
    });

    const reader = captured.getReader();
    while (!(await reader.read()).done) {
      // Consume the wrapped stream so its finalizer persists the snapshot.
    }

    expect(service.getLatest("sess_stream")?.messages).toEqual([
      { role: "user", content: "say hello" },
      { role: "assistant", content: "hello world" },
    ]);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
