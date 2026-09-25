/**
 * LoComo 真实数据集准备脚本
 *
 * 从 snap-research/locomo（论文 "Evaluating Very Long-Term Conversational
 * Memory of LLM Agents" 的官方仓库）下载 locomo10.json，提取为精简评测
 * fixture（轮次文本 + 时间戳 + QA evidence 指针），供 src/eval/locomo-real-eval.test.ts
 * 做真实数据检索评测。
 *
 * 用法：npm run eval:prepare-locomo
 * 环境变量：
 * - LOCOMO_SOURCE_URL  覆盖下载地址（默认 raw.githubusercontent.com）
 * - LOCOMO_RAW_FILE    已下载的 locomo10.json 路径（跳过下载）
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const fixturesDir = join(projectRoot, "evals", "fixtures");
const rawFile = process.env.LOCOMO_RAW_FILE
  ? resolve(process.env.LOCOMO_RAW_FILE)
  : join(fixturesDir, "locomo10.json");
const outFile = join(fixturesDir, "locomo-real.json");
const sourceUrl =
  process.env.LOCOMO_SOURCE_URL ||
  "https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json";

const MONTHS = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

/** "1:56 pm on 8 May, 2023" → "2023-05-08T13:56:00" */
function parseLocomoDatetime(raw) {
  const m = /(\d{1,2}):(\d{2})\s*(am|pm)\s+on\s+(\d{1,2})\s+([A-Za-z]+),\s*(\d{4})/.exec(raw.trim());
  if (!m) return null;
  let hours = Number(m[1]);
  const minutes = Number(m[2]);
  const meridiem = m[3].toLowerCase();
  if (meridiem === "pm" && hours !== 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;
  const month = MONTHS[m[5].toLowerCase()];
  if (month === undefined || Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return `${m[6]}-${pad(month + 1)}-${pad(Number(m[4]))}T${pad(hours)}:${pad(minutes)}:00`;
}

async function downloadRaw() {
  if (existsSync(rawFile)) {
    console.log(`[prepare-locomo] 使用已有原始数据 ${rawFile}`);
    return readFileSync(rawFile, "utf-8");
  }
  console.log(`[prepare-locomo] 下载 ${sourceUrl}`);
  const response = await fetch(sourceUrl, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`下载失败 HTTP ${response.status}；可手动下载后设 LOCOMO_RAW_FILE 指向本地文件`);
  }
  const text = await response.text();
  mkdirSync(dirname(rawFile), { recursive: true });
  writeFileSync(rawFile, text, "utf-8");
  return text;
}

async function main() {
  const dataset = JSON.parse(await downloadRaw());
  if (!Array.isArray(dataset) || dataset.length === 0) {
    throw new Error("locomo10.json 结构异常：顶层应为非空数组");
  }

  const samples = [];
  let droppedQuestions = 0;
  let unresolvedEvidence = 0;

  for (const sample of dataset) {
    const conversation = sample.conversation ?? {};
    const sampleId = String(sample.sample_id);

    // ── 轮次 → 记忆卡 ──
    const memories = [];
    const diaIdToCard = new Map();
    for (let sessionNo = 1; sessionNo <= 35; sessionNo++) {
      const turns = conversation[`session_${sessionNo}`];
      if (!Array.isArray(turns)) continue;
      const datetimeRaw = conversation[`session_${sessionNo}_date_time`] ?? "";
      const datetime = parseLocomoDatetime(datetimeRaw);
      if (!datetime) {
        console.warn(`[prepare-locomo] ${sampleId} session_${sessionNo} 时间无法解析: "${datetimeRaw}"，跳过该 session`);
        continue;
      }
      for (let i = 0; i < turns.length; i++) {
        const turn = turns[i];
        const diaId = turn.dia_id ?? `D${sessionNo}:${i + 1}`;
        const id = `${sampleId}:${diaId}`;
        const memory = {
          id,
          sessionId: sessionNo,
          turn: i + 1,
          speaker: turn.speaker ?? "unknown",
          datetime,
          text: turn.text ?? "",
        };
        memories.push(memory);
        diaIdToCard.set(diaId, id);
      }
    }

    // ── QA → 评测问题（丢弃无 evidence / evidence 无法解析的条目）──
    const categoryName = { 1: "single-hop", 2: "multi-hop", 3: "temporal", 4: "open-domain", 5: "adversarial" };
    const questions = [];
    for (const [qi, qa] of (sample.qa ?? []).entries()) {
      // category 4（open-domain）答案不在会话内，evidence 不构成检索真值，排除
      if (qa.category === 4) {
        droppedQuestions += 1;
        continue;
      }
      const evidence = (qa.evidence ?? []).map((diaId) => diaIdToCard.get(diaId)).filter(Boolean);
      if (evidence.length === 0) {
        unresolvedEvidence += 1;
        droppedQuestions += 1;
        continue;
      }
      questions.push({
        id: `${sampleId}:q${qi}`,
        question: qa.question ?? "",
        answer: qa.answer ?? "",
        category: qa.category,
        categoryName: categoryName[qa.category] ?? `cat-${qa.category}`,
        evidence,
      });
    }

    samples.push({ sampleId, memories, questions });
    console.log(
      `[prepare-locomo] ${sampleId}: ${memories.length} 轮对话 → ${memories.length} 张卡，` +
        `${questions.length} 道可用问题`,
    );
  }

  const totals = {
    samples: samples.length,
    memories: samples.reduce((s, x) => s + x.memories.length, 0),
    questions: samples.reduce((s, x) => s + x.questions.length, 0),
    droppedQuestions,
    unresolvedEvidence,
  };
  mkdirSync(fixturesDir, { recursive: true });
  writeFileSync(
    outFile,
    JSON.stringify({ sourceUrl, generatedAt: new Date().toISOString(), samples }, null, 1),
    "utf-8",
  );
  console.log(`[prepare-locomo] 完成 → ${outFile}`);
  console.log(`[prepare-locomo] 汇总: ${JSON.stringify(totals)}`);
}

main().catch((error) => {
  console.error("[prepare-locomo] 失败:", error.message);
  process.exit(1);
});
