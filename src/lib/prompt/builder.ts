/**
 * 提示词构建器
 *
 * 调用关系：
 * - 被调用：features/prompt/manager.ts
 * - 调用：lib/prompt/template-manager.ts
 *
 * 作用：
 * - 构建完整的提示词
 * - 注入记忆检索结果（摘要、来源、引用路径）
 * - 注入个性标签和偏好参数
 * - 处理变量替换和格式化
 */