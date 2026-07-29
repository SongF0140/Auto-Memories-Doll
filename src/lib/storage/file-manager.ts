import { promises as fs } from "fs";
import {
  getMemoryRoot,
  getNotesPath,
  getArchivePath,
  getFailuresPath,
  getDeletedPath,
} from "./path-resolver";
import { sanitizeFilename } from "../utils/normalization";

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
  } catch {
    return "";
  }
};

export const writeFile = async (path: string, content: string): Promise<void> => {
  await ensureDirectory(path.substring(0, path.lastIndexOf("/")));
  await fs.writeFile(path, content, "utf-8");
};

export const appendFile = async (path: string, content: string): Promise<void> => {
  await ensureDirectory(path.substring(0, path.lastIndexOf("/")));
  await fs.appendFile(path, content, "utf-8");
};

export const deleteFile = async (path: string): Promise<void> => {
  try {
    await fs.unlink(path);
  } catch {
    // File doesn't exist, ignore
  }
};

export const listFiles = async (directory: string): Promise<string[]> => {
  try {
    const files = await fs.readdir(directory);
    return files.filter((f) => f.endsWith(".md"));
  } catch {
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
