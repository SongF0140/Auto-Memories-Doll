import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { ChatMessage, ChatMode } from "../../types/api";
import { AiEvent } from "../../lib/ai/ai-events";
import { getMemoryRoot } from "../../lib/storage/path-resolver";
import { logger } from "../../lib/logger";

export type ChatSessionSnapshot = {
  schemaVersion?: 1;
  type?: "snapshot";
  sessionId: string;
  mode: ChatMode;
  messages: ChatMessage[];
  createdAt: string;
};

export type ChatSessionDeleted = {
  schemaVersion: 1;
  type: "deleted";
  sessionId: string;
  createdAt: string;
};

export type ChatSessionRecord = ChatSessionSnapshot | ChatSessionDeleted;

export type ChatSessionSummary = {
  sessionId: string;
  mode: ChatMode;
  title: string;
  messageCount: number;
  updatedAt: string;
};

export class ChatSessionService {
  appendSnapshot(input: { sessionId: string; mode: ChatMode; messages: ChatMessage[] }): boolean {
    const snapshot: ChatSessionSnapshot = {
      schemaVersion: 1,
      type: "snapshot",
      sessionId: input.sessionId,
      mode: input.mode,
      messages: input.messages.filter((message) => message.role !== "system"),
      createdAt: new Date().toISOString(),
    };

    const latest = this.getLatest(input.sessionId);
    if (
      latest &&
      latest.mode === snapshot.mode &&
      JSON.stringify(latest.messages) === JSON.stringify(snapshot.messages)
    ) {
      return false;
    }

    mkdirSync(this.getSessionsDir(), { recursive: true });
    appendFileSync(this.getSessionPath(input.sessionId), `${JSON.stringify(snapshot)}\n`, "utf-8");
    return true;
  }

  appendDeleted(sessionId: string): void {
    const record: ChatSessionDeleted = {
      schemaVersion: 1,
      type: "deleted",
      sessionId,
      createdAt: new Date().toISOString(),
    };

    mkdirSync(this.getSessionsDir(), { recursive: true });
    appendFileSync(this.getSessionPath(sessionId), `${JSON.stringify(record)}\n`, "utf-8");
  }

  readSnapshots(sessionId: string): ChatSessionSnapshot[] {
    return this.readRecords(sessionId).filter(this.isSnapshot);
  }

  getLatest(sessionId: string): ChatSessionSnapshot | null {
    const records = this.readRecords(sessionId);
    let latest: ChatSessionSnapshot | null = null;

    for (const record of records) {
      if (record.type === "deleted") {
        latest = null;
      } else {
        latest = record;
      }
    }

    return latest;
  }

  listSessions(): ChatSessionSummary[] {
    const sessionsDir = this.getSessionsDir();
    if (!existsSync(sessionsDir)) return [];

    return readdirSync(sessionsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .flatMap((entry) => {
        const fallbackId = entry.name.slice(0, -".jsonl".length);
        const latest = this.getLatest(fallbackId);
        if (!latest) return [];

        const firstUserMessage = latest.messages.find((message) => message.role === "user");
        const title =
          firstUserMessage?.content.trim().replace(/\s+/g, " ").slice(0, 48) || "新会话";
        return [
          {
            sessionId: latest.sessionId,
            mode: latest.mode,
            title,
            messageCount: latest.messages.length,
            updatedAt: latest.createdAt,
          },
        ];
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  importSnapshot(input: { sessionId: string; mode: ChatMode; messages: ChatMessage[] }): boolean {
    const latest = this.getLatest(input.sessionId);
    if (
      latest &&
      latest.messages.length >= input.messages.filter((message) => message.role !== "system").length
    ) {
      return false;
    }
    return this.appendSnapshot(input);
  }

  captureAssistantStream(input: {
    stream: ReadableStream<AiEvent>;
    sessionId: string;
    mode: ChatMode;
    messages: ChatMessage[];
    onComplete?: () => void;
  }): ReadableStream<AiEvent> {
    const reader = input.stream.getReader();
    let assistantContent = "";
    let finalized = false;

    const finalize = () => {
      if (finalized) return;
      finalized = true;
      try {
        if (assistantContent) {
          this.appendSnapshot({
            sessionId: input.sessionId,
            mode: input.mode,
            messages: [...input.messages, { role: "assistant", content: assistantContent }],
          });
        }
      } catch (error) {
        logger.chat.warn("最终会话 JSONL 持久化失败", {
          error: (error as Error).message,
          sessionId: input.sessionId,
        });
      } finally {
        input.onComplete?.();
      }
    };

    return new ReadableStream<AiEvent>({
      start: async (controller) => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value.type === "text_delta") {
              assistantContent += value.content;
            }
            controller.enqueue(value);
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        } finally {
          finalize();
        }
      },
      cancel: async (reason) => {
        try {
          await reader.cancel(reason);
        } finally {
          finalize();
        }
      },
    });
  }

  private readRecords(sessionId: string): ChatSessionRecord[] {
    const filePath = this.getSessionPath(sessionId);
    if (!existsSync(filePath)) return [];

    return readFileSync(filePath, "utf-8")
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap<ChatSessionRecord>((line): ChatSessionRecord[] => {
        try {
          const parsed = JSON.parse(line) as Partial<ChatSessionRecord>;
          if (
            typeof parsed !== "object" ||
            parsed === null ||
            typeof parsed.sessionId !== "string" ||
            typeof parsed.createdAt !== "string"
          ) {
            return [];
          }
          if (parsed.type === "deleted") {
            return [parsed as ChatSessionDeleted];
          }
          const snapshot = parsed as ChatSessionSnapshot;
          const hasValidMessages =
            Array.isArray(snapshot.messages) &&
            snapshot.messages.every(
              (message) =>
                typeof message === "object" &&
                message !== null &&
                ["user", "assistant", "system"].includes(message.role) &&
                typeof message.content === "string",
            );
          if (
            (snapshot.type === undefined || snapshot.type === "snapshot") &&
            hasValidMessages &&
            ["chat", "memory", "prompt"].includes(snapshot.mode)
          ) {
            return [snapshot];
          }
          return [];
        } catch {
          return [];
        }
      });
  }

  private isSnapshot(record: ChatSessionRecord): record is ChatSessionSnapshot {
    return record.type !== "deleted";
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
