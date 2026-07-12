/**
 * 聊天界面组件
 *
 * 调用关系：
 * - 被引用：app/page.tsx （入口页）
 * - 引用：components/chat/MessageList.tsx （消息列表）
 * - 引用：components/chat/InputBox.tsx （输入框）
 * - 引用：components/chat/ModeSelector.tsx （模式选择器）
 * - 调用：features/chat/* （快轨逻辑）
 *
 * 作用：
 * - 提供人机交互界面
 * - 管理聊天消息状态
 * - 协调消息列表、输入框、模式选择器
 * - 处理用户输入和 AI 响应的展示
 */