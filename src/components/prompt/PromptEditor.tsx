/**
 * 提示词编辑器组件
 *
 * 调用关系：
 * - 被引用：app/page.tsx （入口页）
 * - 引用：components/prompt/PromptList.tsx （提示词列表）
 * - 引用：components/prompt/PromptPreview.tsx （提示词预览）
 * - 调用：features/prompt/* （提示词读写与回写）
 *
 * 作用：
 * - 提供提示词编辑界面
 * - 管理提示词的创建、编辑、删除
 * - 同步个性标签和偏好参数
 * - 预览提示词效果
 */