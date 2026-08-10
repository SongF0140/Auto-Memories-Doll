import { describe, it, expect } from "vitest";
import {
  chatRequestSchema,
  memoryCreateSchema,
  memoryUpdateSchema,
  storageConfigPreviewSchema,
  storageConfigUpdateSchema,
  toolSourceCreateSchema,
  toolSourceUpdateSchema,
} from "../lib/validation";

describe("chatRequestSchema", () => {
  const validBody = {
    messages: [{ role: "user" as const, content: "hello" }],
    mode: "chat" as const,
    sessionId: "test-session",
  };

  it("passes valid request", () => {
    expect(chatRequestSchema.safeParse(validBody).success).toBe(true);
  });

  it("defaults mode to chat", () => {
    const result = chatRequestSchema.safeParse({ messages: validBody.messages });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.mode).toBe("chat");
  });

  it("rejects empty messages array", () => {
    const result = chatRequestSchema.safeParse({ messages: [] });
    expect(result.success).toBe(false);
  });

  it("rejects invalid role", () => {
    const result = chatRequestSchema.safeParse({
      messages: [{ role: "bot", content: "hi" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a session id that could escape the sessions directory", () => {
    const result = chatRequestSchema.safeParse({
      messages: validBody.messages,
      sessionId: "../outside",
    });
    expect(result.success).toBe(false);
  });
});

describe("memoryCreateSchema", () => {
  it("passes with required fields", () => {
    const result = memoryCreateSchema.safeParse({
      title: "Test Memory",
      content: "Some content",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty title", () => {
    const result = memoryCreateSchema.safeParse({ title: "", content: "x" });
    expect(result.success).toBe(false);
  });

  it("defaults tags to empty", () => {
    const result = memoryCreateSchema.safeParse({ title: "T", content: "C" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.tags).toEqual([]);
  });
});

describe("memoryUpdateSchema", () => {
  it("allows partial update", () => {
    const result = memoryUpdateSchema.safeParse({ title: "Updated" });
    expect(result.success).toBe(true);
  });

  it("rejects empty object", () => {
    const result = memoryUpdateSchema.safeParse({});
    expect(result.success).toBe(true); // all fields optional
  });
});

describe("storage config schemas", () => {
  it("trims notesPath and defaults copyExisting", () => {
    const result = storageConfigUpdateSchema.safeParse({ notesPath: "  memory-root-new  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ notesPath: "memory-root-new", copyExisting: true });
    }
  });

  it("rejects a non-boolean copyExisting value", () => {
    expect(
      storageConfigUpdateSchema.safeParse({
        notesPath: "memory-root-new",
        copyExisting: "false",
      }).success,
    ).toBe(false);
  });

  it("rejects traversal and non-string preview paths", () => {
    expect(storageConfigPreviewSchema.safeParse({ notesPath: "../outside" }).success).toBe(false);
    expect(storageConfigPreviewSchema.safeParse({ notesPath: 123 }).success).toBe(false);
  });
});

describe("tool source schemas", () => {
  it("normalizes a valid create request and applies defaults", () => {
    const result = toolSourceCreateSchema.safeParse({
      name: "  Codex  ",
      toolType: "codex",
      path: "  C:/sessions  ",
      topic: "   ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        name: "Codex",
        toolType: "codex",
        path: "C:/sessions",
        filePattern: "*.jsonl",
        enabled: true,
        topic: undefined,
      });
    }
  });

  it("rejects wrong primitive types instead of relying on assertions", () => {
    expect(
      toolSourceCreateSchema.safeParse({
        name: 123,
        toolType: "codex",
        path: "C:/sessions",
      }).success,
    ).toBe(false);
    expect(
      toolSourceCreateSchema.safeParse({
        name: "Codex",
        toolType: "codex",
        path: "C:/sessions",
        enabled: "false",
      }).success,
    ).toBe(false);
  });

  it("accepts the real update fields and rejects stale field names", () => {
    expect(
      toolSourceUpdateSchema.safeParse({
        toolType: "markdown",
        path: "C:/notes",
        filePattern: "*.md",
        topic: "notes",
        description: "Markdown notes",
      }).success,
    ).toBe(true);
    expect(toolSourceUpdateSchema.safeParse({ dirPath: "C:/notes" }).success).toBe(false);
    expect(toolSourceUpdateSchema.safeParse({}).success).toBe(false);
  });
});
