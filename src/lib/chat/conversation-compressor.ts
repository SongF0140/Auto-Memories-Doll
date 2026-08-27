import {
  CHAT_CONTEXT_COMPRESSION_MAX_MESSAGES,
  CHAT_CONTEXT_SUMMARY_MAX_CHARS,
} from "../../config/constants";
import { ChatMessage } from "../../types/api";

function summarizeMessage(message: ChatMessage): string {
  const content = message.content.replace(/\s+/g, " ").trim();
  const clipped =
    content.length > CHAT_CONTEXT_SUMMARY_MAX_CHARS
      ? `${content.slice(0, CHAT_CONTEXT_SUMMARY_MAX_CHARS - 1)}…`
      : content;
  return `${message.role}: ${clipped}`;
}

export function compressConversation(messages: ChatMessage[]): ChatMessage[] {
  const systemMessages = messages.filter((message) => message.role === "system");
  const dialogue = messages.filter((message) => message.role !== "system");

  if (dialogue.length <= CHAT_CONTEXT_COMPRESSION_MAX_MESSAGES) {
    return messages;
  }

  const keepCount = Math.max(8, Math.floor(CHAT_CONTEXT_COMPRESSION_MAX_MESSAGES / 2));
  const olderMessages = dialogue.slice(0, dialogue.length - keepCount);
  const recentMessages = dialogue.slice(-keepCount);

  const summary = olderMessages.map(summarizeMessage).join("\n");
  const compressed: ChatMessage[] = [
    ...systemMessages,
    {
      role: "system",
      content: `## 压缩摘要\n${summary}`,
    },
    ...recentMessages,
  ];

  return compressed;
}
