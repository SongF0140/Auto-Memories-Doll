import { beforeEach, describe, expect, it, vi } from "vitest";

const adapterMocks = vi.hoisted(() => ({
  degraded: false,
  generate: vi.fn(),
}));

vi.mock("../lib/ai/model-adapter", () => ({
  ModelAdapter: {
    get isDegradedMode() {
      return adapterMocks.degraded;
    },
    generate: adapterMocks.generate,
  },
}));

import {
  KnowledgeReconciliationService,
  type ReconciliationCandidate,
  type ReconciliationResult,
  type TurnAnalysisCard,
} from "../server/services/knowledge-reconciliation-service";

/** 收窄联合：非 ok 直接失败并带出原因 */
function expectOk(result: ReconciliationResult): Extract<ReconciliationResult, { type: "ok" }> {
  if (result.type !== "ok") throw new Error(`期望 ok，实际 unavailable：${result.reason}`);
  return result;
}

const card = (overrides: Partial<TurnAnalysisCard> = {}): TurnAnalysisCard => ({
  title: "部署命令",
  summary: "项目用 npm run deploy 部署",
  content: "本项目部署命令是 npm run deploy。",
  tags: ["部署"],
  source: "user",
  kind: "fact",
  topic: "tech",
  evidence: { sourceRole: "user", text: "部署命令", verified: true },
  reviewStatus: "auto",
  ...overrides,
});

const candidate = (overrides: Partial<ReconciliationCandidate> = {}): ReconciliationCandidate => ({
  memoryId: "mem-1",
  title: "部署方式",
  summary: "使用 npm 部署",
  content: "项目通过 npm run deploy 脚本部署到服务器。",
  ...overrides,
});

/** 构造模型协调输出（按 cards 顺序逐卡给决策） */
function modelDecisions(entries: Array<Record<string, unknown>>): string {
  return JSON.stringify({ decisions: entries });
}

describe("KnowledgeReconciliationService — 逐知识匹配与冲突审核（第十一块）", () => {
  let service: KnowledgeReconciliationService;

  beforeEach(() => {
    adapterMocks.degraded = false;
    adapterMocks.generate.mockReset();
    service = new KnowledgeReconciliationService();
  });

  it("语义重复 → duplicate 指向召回目标，不产生新卡", async () => {
    adapterMocks.generate.mockResolvedValueOnce({
      content: modelDecisions([
        { decision: "duplicate", targetId: "mem-1", reason: "同一部署命令" },
      ]),
    });

    const result = expectOk(await service.reconcile([card()], async () => [candidate()]));

    expect(result.decisions[0]).toMatchObject({ decision: "duplicate", targetId: "mem-1" });
    expect(result.acceptedCount).toBe(0);
    expect(result.pendingCount).toBe(0);
    expect(result.duplicateCount).toBe(1);
  });

  it("相似但有新信息 → supplement 产出完整精修卡（非机械追加）", async () => {
    adapterMocks.generate.mockResolvedValueOnce({
      content: modelDecisions([
        {
          decision: "supplement",
          targetId: "mem-1",
          reason: "补充了部署目标环境",
          refined: {
            title: "部署方式",
            summary: "npm run deploy 部署到 staging 服务器",
            content: "项目通过 npm run deploy 部署到 staging 服务器，部署前需构建。",
            tags: ["部署", "staging"],
            kind: "fact",
            topic: "tech",
          },
        },
      ]),
    });

    const result = expectOk(await service.reconcile([card()], async () => [candidate()]));

    expect(result.decisions[0].decision).toBe("supplement");
    if (result.decisions[0].decision !== "supplement") return;
    expect(result.decisions[0].refined.content).toContain("staging");
    expect(result.pendingCount).toBe(1);
  });

  it("独立知识 → new 且 acceptedCount 计入已接受", async () => {
    adapterMocks.generate.mockResolvedValueOnce({
      content: modelDecisions([{ decision: "new", reason: "全新话题，无相似候选" }]),
    });

    const result = expectOk(await service.reconcile([card()], async () => []));

    expect(result.decisions[0]).toMatchObject({ decision: "new", review: false });
    expect(result.acceptedCount).toBe(1);
    expect(result.pendingCount).toBe(0);
  });

  it("assistant/mixed 无依据新增断言 → new 强制 review（转人工）", async () => {
    adapterMocks.generate.mockResolvedValueOnce({
      content: modelDecisions([{ decision: "new", reason: "全新话题" }]),
    });

    const result = expectOk(
      await service.reconcile(
        [card({ source: "assistant", evidence: null, reviewStatus: "auto" })],
        async () => [],
      ),
    );

    expect(result.decisions[0]).toMatchObject({ decision: "new", review: true });
    expect(result.pendingCount).toBe(1);
    expect(result.acceptedCount).toBe(0);
  });

  it("冲突 → conflict 指向目标，不覆盖，转待确认", async () => {
    adapterMocks.generate.mockResolvedValueOnce({
      content: modelDecisions([
        { decision: "conflict", targetId: "mem-1", reason: "部署命令与既有记录矛盾" },
      ]),
    });

    const result = expectOk(await service.reconcile([card()], async () => [candidate()]));

    expect(result.decisions[0]).toMatchObject({ decision: "conflict", targetId: "mem-1" });
    expect(result.pendingCount).toBe(1);
    expect(result.acceptedCount).toBe(0);
  });

  it("同一既有目标两张补充卡 → 模型必须合并为单条 supplement（同轮不互相覆盖）", async () => {
    // 第一次输出违反"同一目标只能一条 supplement"→ 判解析失败；第二次合并输出通过
    adapterMocks.generate
      .mockResolvedValueOnce({
        content: modelDecisions([
          {
            decision: "supplement",
            targetId: "mem-1",
            reason: "r1",
            refined: {
              title: "t1",
              summary: "s1",
              content: "c1",
              tags: [],
              kind: "fact",
              topic: "tech",
            },
          },
          {
            decision: "supplement",
            targetId: "mem-1",
            reason: "r2",
            refined: {
              title: "t2",
              summary: "s2",
              content: "c2",
              tags: [],
              kind: "fact",
              topic: "tech",
            },
          },
        ]),
      })
      .mockResolvedValueOnce({
        content: modelDecisions([
          {
            decision: "supplement",
            targetId: "mem-1",
            reason: "合并两张卡的信息",
            refined: {
              title: "部署方式",
              summary: "合并摘要",
              content: "合并后的完整正文。",
              tags: ["部署"],
              kind: "fact",
              topic: "tech",
            },
          },
          { decision: "duplicate", targetId: "mem-1", reason: "第二张与合并结果重复" },
        ]),
      });

    const result = expectOk(
      await service.reconcile([card({ title: "卡A" }), card({ title: "卡B" })], async () => [
        candidate(),
      ]),
    );

    expect(adapterMocks.generate).toHaveBeenCalledTimes(2);
    const supplements = result.decisions.filter((d) => d.decision === "supplement");
    expect(supplements).toHaveLength(1);
    expect(supplements[0].refined.content).toContain("合并");
  });

  it("模型返回未召回的 targetId → 拒绝重试，2 次耗尽 unavailable", async () => {
    adapterMocks.generate
      .mockResolvedValueOnce({
        content: modelDecisions([{ decision: "duplicate", targetId: "mem-fake", reason: "r" }]),
      })
      .mockResolvedValueOnce({
        content: modelDecisions([
          { decision: "duplicate", targetId: "mem-also-fake", reason: "r" },
        ]),
      });

    const result = await service.reconcile([card()], async () => [candidate()]);

    expect(result.type).toBe("unavailable");
    expect(adapterMocks.generate).toHaveBeenCalledTimes(2);
  });

  it("决策数量与输入卡数不一致 → 判解析失败", async () => {
    adapterMocks.generate
      .mockResolvedValueOnce({ content: modelDecisions([]) })
      .mockResolvedValueOnce({ content: modelDecisions([]) });

    const result = await service.reconcile([card()], async () => [candidate()]);

    expect(result.type).toBe("unavailable");
  });

  it("模型降级 → unavailable，不发起调用", async () => {
    adapterMocks.degraded = true;

    const result = await service.reconcile([card()], async () => [candidate()]);

    expect(result.type).toBe("unavailable");
    expect(adapterMocks.generate).not.toHaveBeenCalled();
  });

  it("混合结果分开计数：duplicate/new(auto)/supplement 各归其类", async () => {
    adapterMocks.generate.mockResolvedValueOnce({
      content: modelDecisions([
        { decision: "duplicate", targetId: "mem-1", reason: "重复" },
        { decision: "new", reason: "独立知识" },
        {
          decision: "supplement",
          targetId: "mem-1",
          reason: "补充",
          refined: {
            title: "t",
            summary: "s",
            content: "c",
            tags: [],
            kind: "fact",
            topic: "tech",
          },
        },
      ]),
    });

    const result = expectOk(
      await service.reconcile(
        [card(), card({ title: "卡B", evidence: null }), card({ title: "卡C" })],
        async () => [candidate()],
      ),
    );

    expect(result.type).toBe("ok");
    if (result.type !== "ok") return;
    expect(result.duplicateCount).toBe(1);
    expect(result.acceptedCount).toBe(1);
    expect(result.pendingCount).toBe(1);
  });
});
