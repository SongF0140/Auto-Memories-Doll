import { writeFile, readFile } from "./file-manager";
import { getIndexMapPath, getProfilePath } from "./path-resolver";
import { MemoryRecord } from "../../types/memory";

export const updateIndexMap = async (memories: MemoryRecord[]): Promise<void> => {
  const topics = new Map<string, string[]>();
  const tags = new Set<string>();

  memories.forEach(memory => {
    const topic = memory.sourceType;
    if (!topics.has(topic)) {
      topics.set(topic, []);
    }
    topics.get(topic)!.push(memory.id);
    memory.tags.forEach(tag => tags.add(tag));
  });

  let content = "# 索引地图\n\n";
  content += "## 目录索引\n";
  topics.forEach((memoryIds, topic) => {
    content += `\n### ${topic}\n`;
    memoryIds.forEach(id => {
      content += `- [${id}](./notes/${topic}/${id}.md)\n`;
    });
  });

  content += "\n## 标签索引\n";
  tags.forEach(tag => {
    content += `- ${tag}\n`;
  });

  await writeFile(getIndexMapPath(), content);
};

export const updateProfile = async (tags: string[]): Promise<void> => {
  let content = "# 个性标签\n\n";
  content += "## 偏好标签\n";
  tags.forEach(tag => {
    content += `- ${tag}\n`;
  });
  await writeFile(getProfilePath(), content);
};

export const readProfileTags = async (): Promise<string[]> => {
  const content = await readFile(getProfilePath());
  const lines = content.split("\n");
  const tags: string[] = [];
  lines.forEach(line => {
    if (line.startsWith("- ")) {
      tags.push(line.substring(2).trim());
    }
  });
  return tags;
};