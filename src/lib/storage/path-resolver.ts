import { env } from "../../config/env";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";

const ensureDir = (dirPath: string): void => {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
};

export const getMemoryRoot = (): string => {
  const root = env.MEMORY_ROOT;
  ensureDir(root);
  return root;
};

export const getIndexMapPath = (): string => {
  return join(getMemoryRoot(), "index-map.md");
};

export const getProfilePath = (): string => {
  return join(getMemoryRoot(), "profile.md");
};

export const getDatabasePath = (): string => {
  const root = getMemoryRoot();
  return join(root, "memory.db");
};

export const getNotesPath = (): string => {
  return join(getMemoryRoot(), "notes");
};

export const getTopicPath = (topic: string): string => {
  return join(getNotesPath(), topic);
};

export const getAgentPath = (topic: string): string => {
  return join(getTopicPath(topic), "Agent.md");
};

export const getNotePath = (topic: string, noteId: string): string => {
  return join(getTopicPath(topic), `${noteId}.md`);
};

export const getArchivePath = (): string => {
  return join(getMemoryRoot(), "archive");
};

export const getFailuresPath = (): string => {
  return join(getArchivePath(), "failures");
};

export const getDeletedPath = (): string => {
  return join(getArchivePath(), "deleted");
};
