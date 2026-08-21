import { ConflictRecord } from "../../types/memory";
import { AuditService } from "../../server/services/audit-service";

export class AuditReviewer {
  private auditService: AuditService;

  constructor() {
    this.auditService = new AuditService();
  }

  async listConflicts(status?: string): Promise<ConflictRecord[]> {
    return this.auditService.listConflicts(status);
  }
}
