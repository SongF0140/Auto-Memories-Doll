export interface PromptTemplate {
  id: string;
  name: string;
  content: string;
  variables: string[];
  description?: string;
}

export class TemplateManager {
  private templates: Map<string, PromptTemplate> = new Map();

  register(template: PromptTemplate): void {
    this.templates.set(template.id, template);
  }

  get(templateId: string): PromptTemplate | undefined {
    return this.templates.get(templateId);
  }

  list(): PromptTemplate[] {
    return Array.from(this.templates.values());
  }

  render(templateId: string, variables: Record<string, string>): string {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Template "${templateId}" not found`);
    }

    let content = template.content;
    template.variables.forEach(variable => {
      const value = variables[variable] || "";
      content = content.replace(new RegExp(`{{${variable}}}`, "g"), value);
    });

    return content;
  }
}

export const defaultTemplates: PromptTemplate[] = [
  {
    id: "chat-memory",
    name: "聊天记忆模式",
    content: `你是一个记忆助手。请根据用户的问题和提供的记忆内容进行回答。

记忆内容：
{{memory}}

用户问题：
{{question}}

请基于记忆内容回答问题，如果记忆中没有相关信息，请明确说明。`,
    variables: ["memory", "question"],
    description: "用于聊天模式，结合记忆内容回答用户问题",
  },
  {
    id: "memory-extraction",
    name: "记忆提取",
    content: `请从以下文本中提取关键信息，生成记忆记录。

文本内容：
{{text}}

请提取：
1. 标题（简短）
2. 摘要（1-2句话）
3. 标签（3-5个关键词）
4. 关键内容`,
    variables: ["text"],
    description: "用于从文本中提取记忆信息",
  },
  {
    id: "conflict-resolution",
    name: "冲突解决",
    content: `以下是两个记忆版本的冲突，请分析并给出建议。

现有版本：
{{existing}}

候选版本：
{{candidate}}

冲突字段：{{field}}

请分析：
1. 冲突原因
2. 建议解决方案
3. 是否需要人工干预`,
    variables: ["existing", "candidate", "field"],
    description: "用于分析记忆冲突并提供解决方案",
  },
];

export const initializeTemplates = (manager: TemplateManager): void => {
  defaultTemplates.forEach(template => manager.register(template));
};