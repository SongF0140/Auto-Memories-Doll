import { SkillRegistry, Skill } from "./registry";

export type SkillExecutionResult = {
  success: boolean;
  data?: any;
  error?: string;
  skillId: string;
};

export class SkillExecutor {
  private registry: SkillRegistry;

  constructor() {
    this.registry = new SkillRegistry();
  }

  getRegistry(): SkillRegistry {
    return this.registry;
  }

  async execute(skillId: string, params: Record<string, any>): Promise<SkillExecutionResult> {
    try {
      const result = await this.registry.execute(skillId, params);
      return {
        success: true,
        data: result,
        skillId,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        skillId,
      };
    }
  }

  async executeAll(params: Record<string, any>): Promise<SkillExecutionResult[]> {
    const results: SkillExecutionResult[] = [];

    for (const skill of this.registry.list()) {
      results.push(await this.execute(skill.id, params));
    }

    return results;
  }

  getAvailableSkills(): Skill[] {
    return this.registry.list();
  }
}
