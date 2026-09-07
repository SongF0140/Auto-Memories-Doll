import { createHash } from "crypto";

/** Rainy Delta（I-10）：监听对象（Cursor/Claude Code 日志、笔记）是典型追加型文件，
 *  变更即整文件重跑抽取管线是对 Embedding/LLM 的巨大浪费。
 *  本模块只做纯判定：新内容是否为旧内容的纯追加，以及追加的 delta 文本。 */

export type AppendDetection = {
  /** 纯追加：新内容以旧内容为前缀，且确实有新增部分 */
  isAppend: boolean;
  /** 纯追加时的新增文本；否则为空串 */
  deltaText: string;
};

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * 通过"旧长度 + 旧内容哈希"判定纯追加，无需保存旧全文：
 * 新内容的前 prevLength 个字符的 sha256 等于旧哈希 ⇒ 前缀未变 ⇒ 纯追加。
 *
 * @param newContent 本次读到的完整文件内容
 * @param prevHash  上次入库内容的 sha256
 * @param prevLength 上次入库内容的字符长度
 */
export function detectAppend(
  newContent: string,
  prevHash: string,
  prevLength: number,
): AppendDetection {
  if (!prevHash || !Number.isFinite(prevLength) || prevLength <= 0) {
    return { isAppend: false, deltaText: "" };
  }
  if (prevLength >= newContent.length) {
    return { isAppend: false, deltaText: "" };
  }

  const prefixHash = sha256Hex(newContent.slice(0, prevLength));
  if (prefixHash !== prevHash) {
    return { isAppend: false, deltaText: "" };
  }

  return { isAppend: true, deltaText: newContent.slice(prevLength) };
}

/** delta 文本是否值得单独走一次抽取管线（与 file-watcher 的最小内容阈值一致） */
export function isDeltaWorthIngest(deltaText: string, minChars = 10): boolean {
  return deltaText.trim().length >= minChars;
}
