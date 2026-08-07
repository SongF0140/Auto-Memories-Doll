import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { ChatMessage, ChatMode } from "../../types/api";
import { getMemoryRoot } from "../../lib/storage/path-resolver";

export type ChatSessionSnapshot = {
  sessionId: string;
  mode: ChatMode;
  messages: ChatMessage[];
  createdAt: string;
};

export class ChatSessionService {
  appendSnapshot(input: {
    sessionId: string;
    mode: ChatMode;
    messages: ChatMessage[];
  }): void {
    const snapshot: ChatSessionSnapshot = {
      sessionId: input.sessionId,
      mode: input.mode,
      messages: input.messages.filter((message) => message.role !== "system"),
      createdAt: new Date().toISOString(),
    };

    mkdirSync(this.getSessionsDir(), { recursive: true });
    appendFileSync(this.getSessionPath(input.sessionId), `${JSON.stringify(snapshot)}\n`, "utf-8");
  }

  readSnapshots(sessionId: string): ChatSessionSnapshot[] {
    const filePath = this.getSessionPath(sessionId);
    if (!existsSync(filePath)) return [];

    return readFileSync(filePath, "utf-8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ChatSessionSnapshot);
  }

  private getSessionsDir(): string {
    return join(getMemoryRoot(), "sessions");
  }

  private getSessionPath(sessionId: string): string {
    return join(this.getSessionsDir(), `${this.sanitizeSessionId(sessionId)}.jsonl`);
  }

  private sanitizeSessionId(sessionId: string): string {
    return sessionId.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "default";
  }
}
