import { TemplateManager } from "./template-manager";

export const buildChatPrompt = (
  messages: { role: string; content: string }[],
  memoryContent: string = "",
  templateManager: TemplateManager
): string => {
  const conversationHistory = messages
    .slice(-10)
    .map(msg => `${msg.role}: ${msg.content}`)
    .join("\n");

  return templateManager.render("chat-memory", {
    memory: memoryContent || "暂无相关记忆",
    question: conversationHistory,
  });
};

export const buildMemoryExtractionPrompt = (text: string, templateManager: TemplateManager): string => {
  return templateManager.render("memory-extraction", { text });
};

export const buildConflictResolutionPrompt = (
  existing: string,
  candidate: string,
  field: string,
  templateManager: TemplateManager
): string => {
  return templateManager.render("conflict-resolution", { existing, candidate, field });
};