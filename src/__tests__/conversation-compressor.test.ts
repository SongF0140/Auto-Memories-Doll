import { describe, expect, it } from "vitest";
import { compressConversation } from "../lib/chat/conversation-compressor";

describe("conversation compressor", () => {
  it("compresses long conversations into a summary plus recent turns", () => {
    const messages = Array.from({ length: 30 }, (_, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `message ${index + 1} ${"x".repeat(20)}`,
    }));

    const compressed = compressConversation(messages);

    expect(compressed.length).toBeLessThan(messages.length);
    expect(
      compressed.some(
        (message) => message.role === "system" && message.content.includes("压缩摘要"),
      ),
    ).toBe(true);
    expect(compressed.at(-1)?.content).toContain("message 30");
  });
});
