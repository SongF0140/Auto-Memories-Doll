/**
 * 记忆标题清洗与修饰工具
 *
 * 用于在记忆写入时自动清理标题中的非法字符、特殊符号、emoji 等，
 * 生成干净、可读的中文/英文标题。
 */

/** 需要移除的非法字符模式 */
// eslint-disable-next-line no-control-regex
const ILLEGAL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/** 常见无意义符号前缀/后缀（连续重复） */
const TRIM_SYMBOLS = /^[-–—~*#·•·●○■□►▶▷➤➔→←↑↓↔↕⇒⇐⇑⇓⇔⇕✓✔✗✘×÷±∞π∑√∫≠≤≥<>|\\/=_]+/;

/** 连续标点压缩（超过2个的重复标点） */
const RUNE_PUNCTUATION = /[!！?？.。,，;；:：~～\-–—]{3,}/g;

/**
 * 检测字符串是否主要由 emoji 组成
 * 使用简单的启发式方法：统计非 ASCII 字符比例
 */
function isEmojiDominant(text: string): boolean {
  if (!text || text.length === 0) return false;
  // 统计非 ASCII 字符（包括 CJK 和 emoji）
  let nonAsciiCount = 0;
  for (const char of text) {
    if (char.charCodeAt(0) > 127) nonAsciiCount++;
  }
  // 如果超过 80% 是非 ASCII 且没有中文，可能是纯 emoji
  const ratio = nonAsciiCount / text.length;
  const hasChinese = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text);
  return ratio > 0.8 && !hasChinese && text.length <= 10;
}

/** Markdown 图片/链接语法 */
const MARKDOWN_LINK = /\[([^\]]*)\]\([^)]*\)/g;
const MARKDOWN_IMAGE = /!\[^\]]*\]\([^)]*\)/g;

/** 代码块标记 */
const CODE_FENCE = /^```[\s\S]*?```/gm;

/** HTML 标签 */
const HTML_TAG = /<[^>]+>/g;

/** 多余空白行（>2个连续换行） */
const EXTRA_NEWLINES = /\n{3,}/g;

/**
 * 清洗并修饰记忆标题
 *
 * 处理步骤：
 * 1. 移除控制字符和非法字节
 * 2. 去除首尾无意义符号
 * 3. 压缩连续标点
 * 4. 移除纯 emoji 行
 * 5. 清理 Markdown/HTML 标记
 * 6. 截断到合理长度
 * 7. 确保非空且有实际内容
 */
export function sanitizeTitle(raw: string): string {
  if (!raw || typeof raw !== "string") return "未命名记忆";

  let title = raw;

  // 1. 移除控制字符（保留换行和制表符用于后续处理）
  title = title.replace(ILLEGAL_CHARS, "");

  // 2. 移除代码块
  title = title.replace(CODE_FENCE, "");

  // 3. 清理 HTML 标签
  title = title.replace(HTML_TAG, "");

  // 4. 清理 Markdown 链接和图片
  title = title.replace(MARKDOWN_IMAGE, "");
  title = title.replace(MARKDOWN_LINK, "$1");

  // 5. 按行处理
  const lines = title.split("\n").map((line) => line.trim()).filter(Boolean);

  // 找第一个有意义的非 emoji 行作为候选标题
  let candidate = "";
  for (const line of lines) {
    // 跳过纯 emoji 行
    if (isEmojiDominant(line)) continue;
    // 跳过太短的行（< 3 字符且不是中文）
    if (line.length < 3 && !/[\u4e00-\u9fff]/.test(line)) continue;
    // 跳过看起来像元数据的行
    if (/^(date|time|author|source|tag|category|status|id|---|\*\*|##)/i.test(line)) continue;

    candidate = line;
    break;
  }

  // 如果没找到合适的行，用第一行
  if (!candidate) candidate = lines[0] || "";

  // 6. 去除首尾无意义符号
  candidate = candidate.replace(TRIM_SYMBOLS, "").trim();

  // 7. 压缩连续标点（最多保留2个）
  candidate = candidate.replace(RUNE_PUNCTUATION, (match) => match.slice(0, 2));

  // 8. 压缩内部空白
  candidate = candidate.replace(/\s+/g, " ").trim();

  // 9. 如果结果太短或为空，生成默认标题
  if (candidate.length < 2) {
    return "未命名记忆";
  }

  // 10. 截断过长标题（保留中文完整性）
  if (candidate.length > 60) {
    // 尝试在词边界截断
    const truncated = candidate.slice(0, 57);
    // 如果最后一个字符是中文，直接截断；否则找空格截断
    if (/[\u4e00-\u9fff]$/.test(truncated)) {
      candidate = truncated + "...";
    } else {
      const lastSpace = truncated.lastIndexOf(" ");
      candidate = (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated) + "...";
    }
  }

  return candidate;
}

/**
 * 从文本内容中提取干净的标题
 *
 * 优先级：
 * 1. 第一个 # 标题（去除 # 符号后清洗）
 * 2. 第一个有意义的短行（5-80字符）
 * 3. 文本开头截取 + 清洗
 */
export function extractCleanTitle(text: string): string {
  if (!text || typeof text !== "string") return "未命名记忆";

  const lines = text.split("\n").filter((l) => l.trim());

  // 优先取 # 标题
  for (const line of lines) {
    if (line.startsWith("# ")) {
      return sanitizeTitle(line.substring(2).trim());
    }
    if (line.startsWith("## ")) {
      return sanitizeTitle(line.substring(3).trim());
    }
  }

  // 取第一个合适长度的行
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length >= 5 && trimmed.length <= 80) {
      return sanitizeTitle(trimmed);
    }
  }

  // 取开头部分
  return sanitizeTitle(text.substring(0, 80));
}

/**
 * 清洗标签列表
 * 去除非法字符、过长的标签、空标签
 */
export function sanitizeTags(tags: string[]): string[] {
  if (!Array.isArray(tags)) return [];

  return tags
    .map((tag) => {
      if (!tag || typeof tag !== "string") return "";
      // 移除控制字符和首尾符号
      let cleaned = tag.replace(ILLEGAL_CHARS, "").replace(TRIM_SYMBOLS, "").trim();
      // 压缩空白
      cleaned = cleaned.replace(/\s+/g, " ");
      // 限制长度
      if (cleaned.length > 20) cleaned = cleaned.slice(0, 20);
      return cleaned;
    })
    .filter((tag) => tag.length >= 1 && tag.length <= 20);
}
