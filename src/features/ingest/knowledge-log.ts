import { ConversationMessage } from "../../types/memory";

export const KNOWLEDGE_LOG_MAX_CHARS = 10_000;
export const KNOWLEDGE_LOG_DETAIL_TARGET = 1_500;

type KnowledgeLogOptions = {
  source?: string;
  metadata?: { platform?: string; model?: string; url?: string };
};

export type KnowledgeLog = {
  summary: string;
  content: string;
};

const cleanText = (text: string): string =>
  text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const roleLabel = (role: ConversationMessage["role"]): string => {
  if (role === "user") return "用户";
  if (role === "assistant") return "AI";
  return "系统";
};

const renderMessages = (messages: ConversationMessage[]): string =>
  messages
    .map((message) => `### ${roleLabel(message.role)}\n\n${cleanText(message.content)}`)
    .join("\n\n");

const renderRoleSection = (
  messages: ConversationMessage[],
  role: ConversationMessage["role"],
): string => {
  const selected = messages.filter((message) => message.role === role);
  return renderMessages(selected) || "原始对话中没有明确记录。";
};

const renderRelevantMessages = (messages: ConversationMessage[], pattern: RegExp): string => {
  const selected = messages.filter((message) => pattern.test(message.content));
  return renderMessages(selected) || "原始对话中没有明确记录。";
};

const renderQuestionsAndAnswers = (messages: ConversationMessage[]): string => {
  const pairs: string[] = [];
  for (let index = 0; index < messages.length; index++) {
    const current = messages[index];
    if (current.role !== "user") continue;
    const next = messages[index + 1];
    pairs.push(
      `### 问题\n\n${cleanText(current.content)}\n\n### 回答\n\n${next ? cleanText(next.content) : "尚未记录回答。"}`,
    );
  }
  return pairs.join("\n\n") || "原始对话中没有可配对的问题与回答。";
};

const renderContext = (options: KnowledgeLogOptions): string => {
  const { source, metadata } = options;
  const details = [
    source ? `- 来源：${source}` : "",
    metadata?.platform ? `- 平台：${metadata.platform}` : "",
    metadata?.model ? `- 模型：${metadata.model}` : "",
    metadata?.url ? `- 原始链接：${metadata.url}` : "",
  ].filter(Boolean);
  return details.length > 0 ? details.join("\n") : "- 来源信息未提供";
};

const buildSections = (messages: ConversationMessage[], options: KnowledgeLogOptions): string[] => {
  const original = renderMessages(messages);
  return [
    `## 工作背景\n\n${renderRoleSection(messages, "user")}`,
    `## 已完成内容\n\n${renderRoleSection(messages, "assistant")}`,
    `## 技术细节\n\n${renderRelevantMessages(messages, /代码|实现|文件|路径|命令|接口|模型|数据集|参数|配置|训练|部署|TypeScript|React|YOLO/i)}`,
    `## 配置与环境\n\n${renderRelevantMessages(messages, /Windows|Linux|macOS|CPU|GPU|CUDA|workers|device|版本|环境|依赖|mAP|Recall|精度|端口/i)}`,
    `## 遇到的问题与坑\n\n${renderRelevantMessages(messages, /问题|报错|错误|失败|异常|坑|注意|不能|不要|缺少|兼容|超时|权限|截断/i)}`,
    `## Q&A\n\n${renderQuestionsAndAnswers(messages)}`,
    `## 来源信息\n\n${renderContext(options)}`,
    `## 原始对话记录\n\n${original || "无可用原始对话。"}`,
  ];
};

const limitContent = (sections: string[]): string => {
  const content = sections.join("\n\n");
  if (content.length <= KNOWLEDGE_LOG_MAX_CHARS) return content;
  const suffix = "\n\n[日志超过 10000 字，已保留结构化内容和原始记录前缀]";
  const budget = KNOWLEDGE_LOG_MAX_CHARS - suffix.length;
  const structured = sections.slice(0, 6).map((section) => section.slice(0, 1_200));
  const kept = structured.join("\n\n").slice(0, Math.floor(budget * 0.7));
  const rawBudget = Math.max(0, budget - kept.length - 30);
  const raw = (sections[7] ?? "").slice(0, rawBudget);
  return `${kept}\n\n## 原始对话记录（截取）\n\n${raw}${suffix}`.slice(0, KNOWLEDGE_LOG_MAX_CHARS);
};

const makeSummary = (messages: ConversationMessage[]): string => {
  const firstUser = messages.find((message) => message.role === "user");
  const text = cleanText(firstUser?.content ?? messages[0]?.content ?? "").replace(/\n/g, " ");
  return text.length > 280 ? `${text.slice(0, 277)}...` : text;
};

export const buildKnowledgeLog = (
  messages: ConversationMessage[],
  options: KnowledgeLogOptions = {},
): KnowledgeLog => ({
  summary: makeSummary(messages),
  content: limitContent(buildSections(messages, options)),
});

export const buildKnowledgeLogFromText = (
  text: string,
  options: KnowledgeLogOptions = {},
): KnowledgeLog => buildKnowledgeLog([{ role: "assistant", content: cleanText(text) }], options);
