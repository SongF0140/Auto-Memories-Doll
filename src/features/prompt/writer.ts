import { PromptManager } from "./manager";
import { PromptTemplate } from "../../lib/prompt/template-manager";
import { TemplateConflictError, TemplateNotFoundError } from "../../lib/errors";

export class PromptWriter {
  private manager: PromptManager;

  constructor() {
    this.manager = new PromptManager();
  }

  createTemplate(template: PromptTemplate): void {
    if (this.manager.getTemplate(template.id)) {
      throw new TemplateConflictError(template.id);
    }

    this.manager.addTemplate(template);
  }

  updateTemplate(
    templateId: string,
    content: string,
    variables?: string[],
    description?: string,
  ): void {
    const existing = this.manager.getTemplate(templateId);
    if (!existing) {
      throw new TemplateNotFoundError(templateId);
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
      throw new TemplateNotFoundError(templateId);
    }

    this.manager.deleteTemplate(templateId);
  }
}
