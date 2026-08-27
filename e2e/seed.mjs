import Database from "better-sqlite3";
import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const memoryRoot = resolve(process.cwd(), "e2e/.tmp/memory-root");
rmSync(memoryRoot, { recursive: true, force: true });
mkdirSync(memoryRoot, { recursive: true });

const database = new Database(join(memoryRoot, "memory.db"));
database.exec(`
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    version INTEGER,
    source TEXT,
    sourceType TEXT,
    title TEXT,
    titleZh TEXT,
    content TEXT,
    summary TEXT,
    summaryZh TEXT,
    tags TEXT,
    tagsZh TEXT,
    topic TEXT DEFAULT 'uncategorized',
    topicZh TEXT,
    createdAt TEXT,
    updatedAt TEXT,
    accessedAt TEXT,
    accessCount INTEGER,
    heatScore REAL,
    vectorId TEXT,
    graphLinks TEXT
  )
`);

database
  .prepare(`
    INSERT INTO memories (
      id, version, source, sourceType, title, content, summary, tags, topic,
      createdAt, updatedAt, accessedAt, accessCount, heatScore, graphLinks
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  .run(
    "e2e-memory-1",
    1,
    "playwright",
    "manual",
    "E2E 测试记忆",
    "这是一条只存在于隔离测试 memory root 中的记忆。",
    "用于验证检索库、详情页和知识图谱的浏览器流程。",
    JSON.stringify(["e2e", "playwright"]),
    "ai-coding",
    "2026-08-28T00:00:00.000Z",
    "2026-08-28T00:00:00.000Z",
    "2026-08-28T00:00:00.000Z",
    0,
    0,
    JSON.stringify([]),
  );

database.close();
