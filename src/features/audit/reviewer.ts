import { ConflictRecord } from "../../types/memory";
import { AuditService } from "../../server/services/audit-service";

export type ConflictResolution = "accept" | "keep" | "manual";

export class AuditReviewer {
  private auditService: AuditService;

  constructor() {
    this.auditService = new AuditService();
  }

  async listConflicts(status?: string): Promise<ConflictRecord[]> {
    return this.auditService.listConflicts(status);
  }

  async resolveConflict(
    conflictId: string,
    resolution: ConflictResolution,
    manualValue?: string,
  ): Promise<void> {
    this.auditService.resolveConflict(conflictId, resolution, manualValue);
  }
}
