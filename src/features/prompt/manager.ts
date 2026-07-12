/**
 * 提示词管理器
 *
 * 调用关系：
 * - 被调用：app/api/prompt/route.ts
 * - 被调用：components/prompt/* （提示词编辑组件）
 * - 调用：features/prompt/reader.ts （提示词读取）
 * - 调用：features/prompt/writer.ts （提示词写入）
 * - 调用：lib/storage/* （本地存储）
 *
 * 作用：
 * - 管理提示词的读取、更新、同步
 * - 维护个性标签和偏好参数
 * - 同步更新 profile.md
 */