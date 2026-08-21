import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ConversationProcessor } from "../../../features/ingest/conversation-processor";
import { MemoryService } from "../../../server/services/memory-service";
import { ListenStatsService } from "../../../server/services/listen-stats-service";
import { getNotePath } from "../../../lib/storage/path-resolver";


const MAX_LISTEN_BODY_BYTES = 1_000_000;
const MAX_LISTEN_MESSAGES = 200;

const listenRequestSchema = z.object({
  source: z.string().min(1, "source 不能为空"),
  sourceType: z.enum(["listen", "chat", "ingest", "manual", "mcp", "skill"]).default("listen"),
  title: z.string().optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string().min(1),
        timestamp: z.string().optional(),
      }),
    )
    .min(1, "messages 至少需要一条消息")
    .max(MAX_LISTEN_MESSAGES, `messages 不能超过 ${MAX_LISTEN_MESSAGES} 条`),
  tags: z.array(z.string()).optional(),
  topic: z.string().optional(),
  metadata: z
    .object({
      url: z.string().optional(),
      platform: z.string().optional(),
      model: z.string().optional(),
    })
    .passthrough()
    .optional(),
});

/**
 * POST /api/listen
 *
 * 外部工具（Trae IDE、浏览器 AI 会话等）通过此端点将对话数据发送到
 * Auto-Memories-Doll。系统自动完成：
 * 1. 格式化对话为 Markdown
 * 2. 自动提取话题
 * 3. 生成知识卡片摘要
 * 4. 将唯一候选记录写入待审计队列
 * 5. 审计通过后由 Orchestrator 写入带稳定 memoryId 的 Markdown
 */
export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_LISTEN_BODY_BYTES) {
    return NextResponse.json(
      { success: false, error: `请求体不能超过 ${MAX_LISTEN_BODY_BYTES} bytes` },
      { status: 413 },
    );
  }

  let body: unknown;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_LISTEN_BODY_BYTES) {
      return NextResponse.json(
        { success: false, error: `请求体不能超过 ${MAX_LISTEN_BODY_BYTES} bytes` },
        { status: 413 },
      );
    }
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ success: false, error: "请求体不是有效 JSON" }, { status: 400 });
  }

  const parsed = listenRequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0].message },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const processor = new ConversationProcessor();
  const memoryService = new MemoryService();
  const statsService = new ListenStatsService();

  try {
    // 1. 格式化对话并提取话题
    const { title, content, topic } = processor.formatConversation(data);

    // 2. 生成知识卡片
    const knowledgeCard = processor.generateKnowledgeCard(data);

    // 3. 唯一写入入口：先进入待审计队列，禁止在这里提前写 Markdown
    const memoryId = memoryService.stageCreateMemory(
      data.source,
      data.sourceType,
      title,
      content,
      knowledgeCard.summary,
      knowledgeCard.tags,
      topic,
      {
        titleZh: knowledgeCard.titleZh,
        summaryZh: knowledgeCard.summary,
        tagsZh: knowledgeCard.tagsZh,
        topicZh: knowledgeCard.topicZh,
      },
    );
    const filePath = getNotePath(topic, memoryId);

    // 4. 更新持久统计
    statsService.record(data.source, topic, true);

    return NextResponse.json({
      success: true,
      memoryId,
      topic,
      filePath,
      knowledgeCard: {
        title: knowledgeCard.title,
        summary: knowledgeCard.summary,
        tags: knowledgeCard.tags,
        topic: knowledgeCard.topic,
      },
      message: `已接收来自 "${data.source}" 的对话，话题: ${topic}`,
    });
  } catch (error) {
    statsService.record(data.source, data.topic || "unknown", false);
    return NextResponse.json(
      { success: false, error: `处理失败: ${(error as Error).message}` },
      { status: 500 },
    );
  } finally {
    memoryService.close();
    statsService.close();
  }
}

/**
 * GET /api/listen
 * 返回监听器状态，供外部工具检查服务是否就绪
 */
export async function GET() {
  const statsService = new ListenStatsService();
  const stats = statsService.getStats();
  statsService.close();

  return NextResponse.json({
    status: "listening",
    uptime: process.uptime(),
    stats,
    endpoints: {
      post: "POST /api/listen - 发送对话数据",
      get: "GET  /api/listen - 查看监听状态",
    },
    example: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: {
        source: "trae-ide",
        sourceType: "listen",
        messages: [
          { role: "user", content: "帮我写一个排序算法" },
          { role: "assistant", content: "好的，这是快速排序的实现..." },
        ],
        metadata: {
          platform: "Trae IDE",
          model: "claude-sonnet-4-20250514",
        },
      },
    },
  });
}
