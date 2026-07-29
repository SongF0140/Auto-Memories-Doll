import { InputEvent } from "../../types/event";
import { normalizeText } from "../../lib/utils/normalization";
import { generateId } from "../../lib/utils/id";
import { getCurrentTime } from "../../lib/utils/date";

export class InputNormalizer {
  normalize(input: unknown): InputEvent[] {
    if (Array.isArray(input)) {
      return input.map((item) => this.normalizeItem(item));
    }

    return [this.normalizeItem(input)];
  }

  private normalizeItem(input: unknown): InputEvent {
    const now = getCurrentTime();

    if (typeof input === "string") {
      return {
        id: generateId(),
        source: "manual",
        sourceType: "manual",
        content: normalizeText(input),
        timestamp: now,
      };
    }

    if (input && typeof input === "object") {
      const obj = input as Record<string, any>;
      return {
        id: obj.id || generateId(),
        source: obj.source || "unknown",
        sourceType: obj.sourceType || "manual",
        content: normalizeText(obj.content || ""),
        timestamp: obj.timestamp || now,
        sessionId: obj.sessionId,
        metadata: obj.metadata,
      };
    }

    return {
      id: generateId(),
      source: "unknown",
      sourceType: "manual",
      content: "",
      timestamp: now,
    };
  }
}
