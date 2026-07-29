import { SkillConfig } from "../../types/config";
import { ConfigService } from "../../server/services/config-service";

export class SkillManager {
  private configService: ConfigService;

  constructor() {
    this.configService = new ConfigService();
  }

  listEnabledSkills(): SkillConfig[] {
    return this.configService.listSkills().filter((s) => s.enabled);
  }

  getSkill(id: string): SkillConfig | null {
    return this.configService.getSkill(id);
  }

  /**
   * 根据用户输入匹配最相关的 skill
   */
  matchSkill(content: string): SkillConfig | null {
    const skills = this.listEnabledSkills();
    if (skills.length === 0) return null;

    const lowerContent = content.toLowerCase();

    for (const skill of skills) {
      const trigger = skill.trigger.toLowerCase();
      if (lowerContent.includes(trigger)) {
        return skill;
      }
    }

    return null;
  }

  /**
   * 应用 skill prompt 到用户输入
   */
  applySkill(content: string, skill: SkillConfig): string {
    return `${skill.prompt}\n\nUser input:\n${content}`;
  }

  close(): void {
    this.configService.close();
  }
}
