import { describe, expect, it } from "vitest";
import { assembleSystemMessage } from "../features/chat/system-prompt";

describe("chat system prompt helpers", () => {
  it("assembles system prefix, intent block, and memory block", () => {
    const message = assembleSystemMessage({
      systemPrefix: "SYS",
      intentBlock: "INTENT",
      memoryBlock: "MEMORY",
    });

    expect(message).toContain("SYS");
    expect(message).toContain("INTENT");
    expect(message).toContain("MEMORY");
  });
});
