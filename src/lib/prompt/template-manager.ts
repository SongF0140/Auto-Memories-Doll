import { getDatabase } from "../storage/database";

export interface PromptTemplate {
  id: string;
  name: string;
  content: string;
  variables: string[];
  description?: string;
}

export class TemplateManager {
  private templates: Map<string, PromptTemplate> = new Map();
  private db = getDatabase();
  private initialized = false;

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS prompt_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        content TEXT NOT NULL,
        variables TEXT NOT NULL DEFAULT '[]',
        description TEXT
      )
    `);
  }

  private loadFromDb(): void {
    if (this.initialized) return;
    this.ensureTable();

    const stmt = this.db.prepare("SELECT * FROM prompt_templates");
    const rows = stmt.all() as any[];
    for (const row of rows) {
      this.templates.set(row.id, {
        id: row.id,
        name: row.name,
        content: row.content,
        variables: JSON.parse(row.variables || "[]"),
        description: row.description,
      });
    }
    this.initialized = true;
  }

  register(template: PromptTemplate): void {
    this.loadFromDb();

    this.templates.set(template.id, template);

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO prompt_templates (id, name, content, variables, description)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(
      template.id,
      template.name,
      template.content,
      JSON.stringify(template.variables),
      template.description || null
    );
  }

  get(templateId: string): PromptTemplate | undefined {
    this.loadFromDb();
    return this.templates.get(templateId);
  }

  list(): PromptTemplate[] {
    this.loadFromDb();
    return Array.from(this.templates.values());
  }

  delete(templateId: string): boolean {
    this.loadFromDb();
    const existed = this.templates.delete(templateId);
    if (existed) {
      const stmt = this.db.prepare("DELETE FROM prompt_templates WHERE id = ?");
      stmt.run(templateId);
    }
    return existed;
  }

  render(templateId: string, variables: Record<string, string>): string {
    this.loadFromDb();
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

/** 初始化内置模板（仅在模板不存在时写入） */
export const initializeTemplates = (manager: TemplateManager): void => {
  for (const template of defaultTemplates) {
    if (!manager.get(template.id)) {
      manager.register(template);
    }
  }
};
