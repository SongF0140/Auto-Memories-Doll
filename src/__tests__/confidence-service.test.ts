import { describe, it, expect } from "vitest";
import { ConfidenceService } from "../server/services/confidence-service";
import { CONFIDENCE_MAX } from "../config/constants";
import { MemoryRecord } from "../types/memory";

describe("ConfidenceService", () => {
  describe("initial", () => {
    it("fact + 原文哈希起步 0.9 档", () => {
      expect(
        ConfidenceService.initial({ qualityScore: 1, kind: "fact", hasSourceHash: true }),
      ).toBe(0.9);
    });

    it("fact 无哈希低于有哈希版本", () => {
      const withHash = ConfidenceService.initial({
        qualityScore: 1,
        kind: "fact",
        hasSourceHash: true,
      });
      const withoutHash = ConfidenceService.initial({ qualityScore: 1, kind: "fact" });
      expect(withoutHash).toBeLessThan(withHash);
      expect(withoutHash).toBe(0.7);
    });

    it("inference / hypothesis / synthesis 按各自证据系数", () => {
      expect(ConfidenceService.initial({ qualityScore: 1, kind: "inference" })).toBe(0.5);
      expect(ConfidenceService.initial({ qualityScore: 1, kind: "hypothesis" })).toBe(0.3);
      expect(ConfidenceService.initial({ qualityScore: 1, kind: "synthesis" })).toBe(0.8);
      expect(ConfidenceService.initial({ qualityScore: 1, kind: "insight" })).toBe(0.6);
    });

    it("初值随质量分线性缩放且不超过 0.95 上限", () => {
      expect(
        ConfidenceService.initial({ qualityScore: 0.5, kind: "fact", hasSourceHash: true }),
      ).toBe(0.45);
      // qualityScore 先被夹到 [0,1]，因此 fact+hash 的理论最高就是 0.9
      expect(
        ConfidenceService.initial({ qualityScore: 2, kind: "fact", hasSourceHash: true }),
      ).toBe(0.9);
      expect(
        ConfidenceService.initial({ qualityScore: 1, kind: "fact", hasSourceHash: true }),
      ).toBeLessThanOrEqual(CONFIDENCE_MAX);
      expect(ConfidenceService.initial({ qualityScore: NaN })).toBe(0);
    });
  });

  describe("decay（Ebbinghaus：不同记忆类型衰减率不同）", () => {
    it("hypothesis 比 fact 衰减更快", () => {
      const hours = 24 * 30; // 30 天
      const fact = ConfidenceService.decay(0.9, "fact", hours);
      const hypothesis = ConfidenceService.decay(0.9, "hypothesis", hours);
      expect(hypothesis).toBeLessThan(fact);
      expect(fact).toBeGreaterThan(0);
    });

    it("时间为零或置信度为零时不衰减", () => {
      expect(ConfidenceService.decay(0.9, "fact", 0)).toBe(0.9);
      expect(ConfidenceService.decay(0, "fact", 100)).toBe(0);
    });

    it("decayAll 跳过 superseded 卡且只回写有变化的记录", () => {
      const memory = (id: string, overrides: Partial<MemoryRecord>): MemoryRecord =>
        ({
          id,
          status: "active",
          confidence: 0.9,
          kind: "fact",
          ...overrides,
        }) as MemoryRecord;
      const memories = [
        memory("a", {}),
        memory("b", { status: "superseded" }),
        memory("c", { confidence: 0 }),
      ];
      const result = ConfidenceService.decayAll(memories, 100);
      expect(result.has("a")).toBe(true);
      expect(result.has("b")).toBe(false);
      expect(result.has("c")).toBe(false);
    });
  });

  describe("reinforce", () => {
    it("每次访问 +0.05，封顶 0.95", () => {
      expect(ConfidenceService.reinforce(0.5)).toBe(0.55);
      expect(ConfidenceService.reinforce(0.94)).toBe(CONFIDENCE_MAX);
      expect(ConfidenceService.reinforce(0.99)).toBe(CONFIDENCE_MAX);
    });
  });
});
