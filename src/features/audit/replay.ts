import { Orchestrator } from "../../server/services/orchestrator";

export class AuditReplayer {
  async replayPendingEvents(): Promise<void> {
    const orchestrator = new Orchestrator();

    try {
      await orchestrator.processQueue();
    } finally {
      orchestrator.close();
    }
  }
}
