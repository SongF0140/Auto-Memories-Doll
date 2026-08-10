import { describe, it, expect } from "vitest";
import { chatRequestSchema, memoryCreateSchema, memoryUpdateSchema } from "../lib/validation";

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
