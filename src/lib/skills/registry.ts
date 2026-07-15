export type Skill = {
  id: string;
  name: string;
  description: string;
  parameters: Record<string, {
    type: "string" | "number" | "boolean" | "array" | "object";
    description?: string;
    required?: boolean;
  }>;
  handler: (params: Record<string, any>) => Promise<any>;
};

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();

  register(skill: Skill): void {
    this.skills.set(skill.id, skill);
  }

  get(skillId: string): Skill | undefined {
    return this.skills.get(skillId);
  }

  list(): Skill[] {
    return Array.from(this.skills.values());
  }

  async execute(skillId: string, params: Record<string, any>): Promise<any> {
    const skill = this.skills.get(skillId);
    if (!skill) {
      throw new Error(`Skill "${skillId}" not found`);
    }
    
    return skill.handler(params);
  }
}

export const defaultSkills: Skill[] = [
  {
    id: "notion-ingest",
    name: "Notion 数据采集",
    description: "从 Notion 导入页面内容作为记忆",
    parameters: {
      pageId: { type: "string", description: "Notion 页面 ID", required: true },
      apiKey: { type: "string", description: "Notion API Key", required: true },
    },
    handler: async (params) => {
      return { success: true, message: `采集 Notion 页面 ${params.pageId}` };
    },
  },
  {
    id: "browser-history",
    name: "浏览器历史采集",
    description: "采集浏览器历史记录作为记忆",
    parameters: {
      limit: { type: "number", description: "记录数量限制", required: false },
    },
    handler: async (params) => {
      return { success: true, message: `采集浏览器历史 ${params.limit || 10} 条` };
    },
  },
  {
    id: "email-import",
    name: "邮件导入",
    description: "导入邮件内容作为记忆",
    parameters: {
      email: { type: "string", description: "邮箱地址", required: true },
    },
    handler: async (params) => {
      return { success: true, message: `导入邮箱 ${params.email}` };
    },
  },
];

export const initializeSkills = (registry: SkillRegistry): void => {
  defaultSkills.forEach(skill => registry.register(skill));
};