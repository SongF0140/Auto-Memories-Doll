import { splitText } from "./splitter";
import { detectDuplicates } from "./deduplicator";
import { formatMemoryContent, formatSummary } from "./formatter";

export interface ProcessedChunk {
  id: string;
  content: string;
  summary: string;
  tags: string[];
}

export const processJsonPipeline = async (
  rawContent: string,
  existingContents: string[] = [],
): Promise<{ chunks: ProcessedChunk[]; isDuplicate: boolean; similarity: number }> => {
  const formatted = formatMemoryContent(rawContent);

  const duplicateCheck = detectDuplicates(formatted, existingContents);
  if (duplicateCheck.isDuplicate) {
    return { chunks: [], isDuplicate: true, similarity: duplicateCheck.similarity };
  }

  const chunks = splitText(formatted);
  const processedChunks: ProcessedChunk[] = [];

  for (let i = 0; i < chunks.length; i++) {
    processedChunks.push({
      id: `${Date.now()}-${i}`,
      content: chunks[i],
      summary: formatSummary(chunks[i]),
      tags: extractTags(chunks[i]),
    });
  }

  return { chunks: processedChunks, isDuplicate: false, similarity: 0 };
};

export const extractTags = (content: string): string[] => {
  const tags: string[] = [];

  const patterns = [/#(\w+)/g, /@(\w+)/g, /\[(\w+)\]/g];

  for (const pattern of patterns) {
    const matches = content.match(pattern);
    if (matches) {
      matches.forEach((match) => {
        const tag = match.substring(1, match.length - (match.endsWith("]") ? 1 : 0));
        if (tag.length > 2 && tag.length < 20 && !tags.includes(tag)) {
          tags.push(tag);
        }
      });
    }
  }

  return tags.slice(0, 5);
};
