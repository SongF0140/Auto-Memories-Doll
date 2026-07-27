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

  unregister(skillId: string): void {
    this.skills.delete(skillId);
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
      throw new Error(`Skill "${skillId}" 未找到`);
    }

    return skill.handler(params);
  }
}

export const buildSystemSkill = (
  id: string,
  name: string,
  description: string,
  trigger: string,
  prompt: string
): Skill => ({
  id,
  name,
  description,
  parameters: {
    trigger: { type: "string", description: "触发关键词", required: true },
    prompt: { type: "string", description: "系统提示词", required: true },
  },
  handler: async () => {
    return { trigger, prompt, description };
  },
});

export const initializeSkills = (registry: SkillRegistry): void => {
  // 默认不注册任何技能，技能由用户在设置中手动添加
};
