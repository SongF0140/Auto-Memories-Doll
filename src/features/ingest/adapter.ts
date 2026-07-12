/**
 * 数据接入适配器
 *
 * 调用关系：
 * - 被调用：app/api/ingest/route.ts
 * - 调用：features/ingest/normalizer.ts （数据归一化）
 * - 调用：features/ingest/parser.ts （数据解析）
 *
 * 作用：
 * - 接收外部数据源接入请求（MCP、skills、浏览器侧采集等）
 * - 适配不同数据源格式
 * - 转换为统一的输入格式
 */