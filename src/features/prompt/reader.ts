import { PromptManager } from "./manager";
import { PromptTemplate } from "../../lib/prompt/template-manager";

export class PromptReader {
  private manager: PromptManager;

  constructor() {
    this.manager = new PromptManager();
  }

  getTemplate(templateId: string): PromptTemplate | undefined {
    return this.manager.getTemplate(templateId);
  }

  getAllTemplates(): PromptTemplate[] {
    return this.manager.listTemplates();
  }

  getAvailableTemplateIds(): string[] {
    return this.manager.listTemplates().map(t => t.id);
  }

  hasTemplate(templateId: string): boolean {
    return this.manager.getTemplate(templateId) !== undefined;
  }
}