/**
 * 工具调用处理器
 *
 * 调用关系：
 * - 被调用：lib/ai/model-adapter.ts
 * - 调用：lib/ai/tool-registry.ts （工具注册表）
 *
 * 作用：
 * - 处理 AI 模型的工具调用请求
 * - 执行工具并返回结果
 * - 支持多轮工具调用和错误处理
 */