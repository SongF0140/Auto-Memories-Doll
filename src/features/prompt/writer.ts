import { PromptManager } from "./manager";
import { PromptTemplate } from "../../lib/prompt/template-manager";

export class PromptWriter {
  private manager: PromptManager;

  constructor() {
    this.manager = new PromptManager();
  }

  createTemplate(template: PromptTemplate): void {
    if (this.manager.getTemplate(template.id)) {
      throw new Error(`Template "${template.id}" already exists`);
    }
    
    this.manager.addTemplate(template);
  }

  updateTemplate(templateId: string, content: string, variables?: string[], description?: string): void {
    const existing = this.manager.getTemplate(templateId);
    if (!existing) {
      throw new Error(`Template "${templateId}" not found`);
    }
    
    this.manager.updateTemplate(templateId, {
      content,
      variables: variables || existing.variables,
      description: description || existing.description,
    });
  }

  deleteTemplate(templateId: string): void {
    const existing = this.manager.getTemplate(templateId);
    if (!existing) {
      throw new Error(`Template "${templateId}" not found`);
    }
    
    this.manager.deleteTemplate(templateId);
  }
}