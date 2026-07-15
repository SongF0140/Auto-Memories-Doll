import { MemoryService } from "../../server/services/memory-service";
import { AuditService } from "../../server/services/audit-service";

export interface AuditReport {
  totalMemories: number;
  pendingEvents: number;
  conflicts: number;
}

export class AuditReporter {
  private memoryService: MemoryService;
  private auditService: AuditService;

  constructor() {
    this.memoryService = new MemoryService();
    this.auditService = new AuditService();
  }

  async generateReport(): Promise<AuditReport> {
    const memories = this.memoryService.listMemories();
    const conflicts = this.auditService.listConflicts("pending");

    return {
      totalMemories: memories.length,
      pendingEvents: 0,
      conflicts: conflicts.length,
    };
  }
}
