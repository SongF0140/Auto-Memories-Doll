import { InputEvent } from "../../types/event";

export class InputParser {
  parseJson(input: string): InputEvent[] {
    try {
      const parsed = JSON.parse(input);
      
      if (Array.isArray(parsed)) {
        return parsed.map(item => this.parseItem(item));
      }
      
      return [this.parseItem(parsed)];
    } catch {
      return [{
        id: `${Date.now()}`,
        source: "manual",
        sourceType: "manual",
        content: input,
        timestamp: new Date().toISOString(),
      }];
    }
  }

  parseText(text: string): InputEvent {
    return {
      id: `${Date.now()}`,
      source: "manual",
      sourceType: "manual",
      content: text,
      timestamp: new Date().toISOString(),
    };
  }

  parseItem(item: any): InputEvent {
    return {
      id: item.id || `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      source: item.source || "unknown",
      sourceType: item.sourceType || "manual",
      content: item.content || "",
      timestamp: item.timestamp || new Date().toISOString(),
      sessionId: item.sessionId,
      metadata: item.metadata,
    };
  }
}