import { PendingEvent } from "../../types/memory";

export type AuditQueueEntry = {
  event: PendingEvent;
  priority: "high" | "normal" | "low";
};

export class AuditQueue {
  private events: Map<string, PendingEvent[]> = new Map();

  enqueue(event: PendingEvent): void {
    const existing = this.events.get(event.memoryId) || [];
    existing.push(event);
    this.events.set(event.memoryId, existing);
  }

  dequeueByMemoryId(memoryId: string): PendingEvent | null {
    const queue = this.events.get(memoryId);
    if (!queue || queue.length === 0) return null;

    const next = queue.find((e) => e.status === "pending");
    if (!next) return null;

    next.status = "processing";
    return next;
  }

  hasPending(memoryId: string): boolean {
    const queue = this.events.get(memoryId);
    return queue ? queue.some((e) => e.status === "pending") : false;
  }

  removeProcessed(memoryId: string): void {
    const queue = this.events.get(memoryId);
    if (!queue) return;
    this.events.set(
      memoryId,
      queue.filter((e) => e.status !== "done"),
    );
  }

  size(): number {
    let count = 0;
    for (const queue of this.events.values()) {
      count += queue.filter((e) => e.status === "pending").length;
    }
    return count;
  }
}
