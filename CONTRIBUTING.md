# 贡献指南

感谢你对 Auto-Memeries-Doll 的关注！这是一个个人学习项目，欢迎任何形式的反馈和建议。

## 报告问题

在提交 Issue 之前，请先检查是否已有相同的报告。

提交 Issue 时请包含：

- 环境信息（Node.js 版本、操作系统）
- 复现步骤
- 期望行为 vs 实际行为
- 相关日志输出（`LOG_LEVEL=debug`）

## 代码规范

- TypeScript strict mode，所有新代码必须通过 `npm run typecheck`
- 提交前运行 `npm test` 确保测试通过
- 新功能请附带测试用例
- 代码格式使用 Prettier，提交前运行 `npm run format`

## 项目架构

开发前请先阅读 `AGENTS.md`，了解项目的分层设计、数据流和核心约束。

关键原则：

1. **核心零 UI 依赖** — `src/features/` 和 `src/lib/` 不导入 React 组件
2. **事件驱动** — Agent 循环通过 `ReadableStream<AiEvent>` 输出，前端消费事件流
3. **存储不可变追加** — 记忆和会话采用追加式日志，不修改已写入的数据
4. **审计优先** — 所有记忆写入先进待审计队列，不直接落盘

## 提交 PR

1. Fork 仓库并创建分支（`git checkout -b feature/your-feature`）
2. 确保测试通过和类型检查无误
3. 提交 PR 时描述改动内容和动机
4. 如果是较大的改动，建议先开 Issue 讨论

## 当前优先事项

查看 `AGENTS.md` 的路线图（Phase 4 收口）了解当前阶段的优先事项。

## 开发环境

```bash
npm install
npm run dev        # 启动开发服务器
npm test           # 运行测试
npm run typecheck  # 类型检查
npm run format     # 格式化
```
