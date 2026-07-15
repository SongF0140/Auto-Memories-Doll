import { TemplateManager } from "./template-manager";

export const buildChatPrompt = (
  messages: { role: string; content: string }[],
  memoryContent: string = "",
  templateManager: TemplateManager
): string => {
  const chatMemory = templateManager.render("chat-memory", {
    memory: memoryContent,
    question: messages[messages.length - 1]?.content || "",
  });

  const conversationHistory = messages
    .slice(-10)
    .map(msg => `${msg.role}: ${msg.content}`)
    .join("\n");

  return `${chatMemory}\n\n对话历史：\n${conversationHistory}\n\n助手回答：`;
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