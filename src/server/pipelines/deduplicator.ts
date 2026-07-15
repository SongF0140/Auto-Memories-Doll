export const deduplicateMemories = (memories: { id: string; content: string }[]): string[] => {
  const seenContent = new Set<string>();
  const duplicateIds: string[] = [];

  for (const memory of memories) {
    const normalizedContent = normalizeContent(memory.content);
    
    if (seenContent.has(normalizedContent)) {
      duplicateIds.push(memory.id);
    } else {
      seenContent.add(normalizedContent);
    }
  }

  return duplicateIds;
};

export const detectDuplicates = (
  content: string,
  existingContents: string[]
): { isDuplicate: boolean; similarity: number } => {
  const normalizedNew = normalizeContent(content);
  
  for (const existing of existingContents) {
    const normalizedExisting = normalizeContent(existing);
    const similarity = calculateSimilarity(normalizedNew, normalizedExisting);
    
    if (similarity > 0.9) {
      return { isDuplicate: true, similarity };
    }
  }
  
  return { isDuplicate: false, similarity: 0 };
};

const normalizeContent = (content: string): string => {
  return content
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s]/g, "");
};

const calculateSimilarity = (a: string, b: string): number => {
  if (!a || !b) return 0;
  
  const setA = new Set(a.split(" "));
  const setB = new Set(b.split(" "));
  const intersection = Array.from(setA).filter(x => setB.has(x)).length;
  const union = setA.size + setB.size - intersection;
  
  return union > 0 ? intersection / union : 0;
};