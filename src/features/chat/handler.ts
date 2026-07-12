/**
 * 聊天处理器
 *
 * 调用关系：
 * - 被调用：app/api/chat/route.ts
 * - 调用：lib/ai/* （模型适配）
 * - 调用：features/chat/extractor.ts （快轨抽取）
 * - 调用：features/chat/classifier.ts （快轨分类）
 *
 * 作用：
 * - 处理即时对话请求
 * - 维持低延迟流式回复
 * - 只消费标准化事件的即时字段，不直接修改最终落盘文件
 * - 调用 Mini LLM 进行快轨处理
 */