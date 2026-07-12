/**
 * AI 模型适配器
 *
 * 调用关系：
 * - 被调用：app/api/chat/route.ts
 * - 被调用：features/chat/* （快轨逻辑）
 * - 被调用：features/memory/* （记忆处理）
 * - 被调用：features/audit/* （审计处理）
 * - 调用：外部 AI 模型 API（Mini LLM、Pro 模型）
 *
 * 作用：
 * - 封装模型供应商差异的本地适配模块
 * - 统一请求格式、响应格式和错误处理
 * - 提供 Mini LLM（低延迟）和 Pro 模型（高质量）两种选择
 * - 支持流式输出和工具调用接口
 */