import { promises as fs } from "fs";
import { dirname } from "path";
import {
  getMemoryRoot,
  getNotesPath,
  getArchivePath,
  getFailuresPath,
  getDeletedPath,
} from "./path-resolver";
import { sanitizeFilename } from "../utils/normalization";
import { recordWrite } from "./write-tracker";
import { logger } from "../logger";

export const ensureDirectory = async (path: string): Promise<void> => {
  try {
    await fs.access(path);
  } catch {
    await fs.mkdir(path, { recursive: true });
  }
};

export const initializeMemoryRoot = async (): Promise<void> => {
  await ensureDirectory(getMemoryRoot());
  await ensureDirectory(getNotesPath());
  await ensureDirectory(getArchivePath());
  await ensureDirectory(getFailuresPath());
  await ensureDirectory(getDeletedPath());
};

export const readFile = async (path: string): Promise<string> => {
  try {
    return await fs.readFile(path, "utf-8");
  } catch (error) {
    // 文件不存在是正常情况，其他错误记录日志
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.storage.warn(`读取文件失败: ${path}`, { error: (error as Error).message });
    }
    return "";
  }
};

export const writeFile = async (path: string, content: string): Promise<void> => {
  await ensureDirectory(dirname(path));
  await fs.writeFile(path, content, "utf-8");
  recordWrite(path);
};

export const appendFile = async (path: string, content: string): Promise<void> => {
  await ensureDirectory(dirname(path));
  await fs.appendFile(path, content, "utf-8");
  recordWrite(path);
};

export const deleteFile = async (path: string): Promise<void> => {
  try {
    await fs.unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.storage.warn(`删除文件失败: ${path}`, { error: (error as Error).message });
    }
  }
};

export const listFiles = async (directory: string): Promise<string[]> => {
  try {
    const files = await fs.readdir(directory);
    return files.filter((f) => f.endsWith(".md"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.storage.warn(`列出目录失败: ${directory}`, { error: (error as Error).message });
    }
    return [];
  }
};

export const moveFile = async (source: string, destination: string): Promise<void> => {
  await ensureDirectory(destination.substring(0, destination.lastIndexOf("/")));
  await fs.rename(source, destination);
};

export const createFailureRecord = async (
  memoryId: string,
  stage: string,
  error: Error,
): Promise<string> => {
  const filename = `${memoryId}-${stage}-${Date.now()}.json`;
  const path = `${getFailuresPath()}/${sanitizeFilename(filename)}`;
  const content = JSON.stringify(
    {
      memoryId,
      stage,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    },
    null,
    2,
  );
  await writeFile(path, content);
  return path;
};
