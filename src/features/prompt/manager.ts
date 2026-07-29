import {
  TemplateManager,
  initializeTemplates,
  PromptTemplate,
} from "../../lib/prompt/template-manager";
import { TemplateNotFoundError } from "../../lib/errors";

export class PromptManager {
  private templateManager: TemplateManager;

  constructor() {
    this.templateManager = new TemplateManager();
    initializeTemplates(this.templateManager);
  }

  getTemplate(templateId: string): PromptTemplate | undefined {
    return this.templateManager.get(templateId);
  }

  listTemplates(): PromptTemplate[] {
    return this.templateManager.list();
  }

  addTemplate(template: PromptTemplate): void {
    this.templateManager.register(template);
  }

  updateTemplate(templateId: string, updates: Partial<PromptTemplate>): void {
    const existing = this.templateManager.get(templateId);
    if (!existing) throw new TemplateNotFoundError(templateId);

    this.templateManager.register({ ...existing, ...updates, id: templateId });
  }

  deleteTemplate(templateId: string): void {
    const templates = this.templateManager.list();
    this.templateManager = new TemplateManager();

    templates.forEach((t) => {
      if (t.id !== templateId) {
        this.templateManager.register(t);
      }
    });
  }

  renderTemplate(templateId: string, variables: Record<string, string>): string {
    return this.templateManager.render(templateId, variables);
  }
}
