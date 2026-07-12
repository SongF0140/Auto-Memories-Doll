/**
 * 快轨对话入口 API 路由
 *
 * 调用关系：
 * - 接收：前端 POST 请求（messages, mode, sessionId）
 * - 调用：lib/ai/* （Vercel AI SDK 与模型适配）
 * - 调用：features/chat/* （快轨逻辑）
 * - 返回：流式输出（Streaming Response）
 *
 * 作用：
 * - 处理即时对话请求
 * - 维持低延迟流式回复
 * - 只消费标准化事件的即时字段，不直接修改最终落盘文件
 * - 调用 Mini LLM 进行快轨抽取、分类和摘要
 *
 * 约束：
 * - 请求体 schema：{ messages: Message[], mode: string, sessionId: string, ... }
 * - 响应体 schema：{ stream: ReadableStream, ... }
 * - 错误码表：需要定义
 */