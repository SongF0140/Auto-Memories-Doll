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
    content: `你是 Auto-Memories-Doll，一个智能记忆伴侣助手。

## 核心能力
- 基于用户的长期记忆库提供个性化对话
- 在对话中自动识别值得保存的信息
- 支持记忆的创建、查询、更新和关联

## 行为准则
- 亲切、温暖、简洁，像朋友一样自然交流
- 优先参考记忆内容回答问题，若记忆与问题相关则明确指出来源
- 若记忆库中没有相关信息，诚实说明而非编造
- 对用户说"记住""保存""记录"等内容时，确认并帮助整理记忆

## 相关记忆
{{memory}}

## 回答格式
- 使用 Markdown 格式使回答更清晰易读
- 若引用了某条记忆，用引用块标注 [来自记忆]
- 保持回答简洁，避免冗长，重点突出

## 对话历史
{{question}}

你现在要以记忆伴侣的身份，根据以上信息为用户提供最贴心的回答。`,
    variables: ["memory", "question"],
    description: "用于聊天模式，结合记忆内容回答用户问题",
  },
  {
    id: "memory-extraction",
    name: "记忆提取",
    content: `请从以下文本中提取有价值的信息，生成一条结构化的记忆记录。

## 文本内容
{{text}}

## 提取规则
1. **标题**：用最精炼的语言概括核心信息（不超过 20 字）
2. **摘要**：用 1-2 句话总结要点，保留关键事实
3. **标签**：提取 3-5 个关键词，便于后续检索（中文优先）
4. **关键内容**：保留原文中最重要的具体细节、数字、日期等

## 要求
- 只提取有长期保存价值的信息，忽略闲聊和临时内容
- 标签应具备区分度和检索价值，避免过于宽泛的词
- 保留原始语境，不要过度概括导致信息失真
- 输出为 JSON 格式：{"title": "…", "summary": "…", "tags": ["…"], "content": "…"}`,
    variables: ["text"],
    description: "用于从文本中提取记忆信息",
  },
  {
    id: "conflict-resolution",
    name: "冲突解决",
    content: `你是记忆版本冲突仲裁器。请分析两个版本间的差异并给出裁决建议。

## 现有版本
{{existing}}

## 候选版本
{{candidate}}

## 冲突字段
{{field}}

## 裁决规则
1. **信息完整性**：优先选择信息更完整、更具体的版本
2. **时效性**：如果涉及时间敏感信息，优先选择更新的版本
3. **一致性**：与记忆库中其他相关记忆保持一致的版本优先
4. **可信度**：来源更可信（手动收录 > AI 提取 > 自动导入）的版本优先

## 输出格式
请用 JSON 输出：
{
  "decision": "existing" | "candidate" | "merge",
  "reason": "简要说明裁决理由",
  "mergedContent": "若 decision 为 merge，提供合并后的内容；否则为 null",
  "needsHumanReview": true/false
}`,
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
