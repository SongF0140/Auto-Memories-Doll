/**
 * 入口页 - 前端 UI 主入口
 *
 * 调用关系：
 * - 引用：components/chat/* （人机交互组件）
 * - 引用：components/prompt/* （提示词编辑组件）
 * - 引用：components/memory/* （记忆模式相关组件）
 * - 调用：features/chat/* （快轨逻辑）
 * - 调用：features/prompt/* （提示词读写）
 *
 * 作用：
 * - 负责收集用户输入
 * - 控制记忆模式切换
 * - 编辑和同步提示词
 * - 协调 chat、prompt、memory 三大功能模块的前端交互
 */