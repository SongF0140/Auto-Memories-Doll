export const splitText = (text: string, maxChunkSize: number = 1000): string[] => {
  const chunks: string[] = [];
  let currentChunk = "";
  
  const paragraphs = text.split("\n\n");
  
  for (const paragraph of paragraphs) {
    if (currentChunk.length + paragraph.length <= maxChunkSize) {
      currentChunk += (currentChunk ? "\n\n" : "") + paragraph;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk);
      }
      
      if (paragraph.length > maxChunkSize) {
        const subChunks = splitLongParagraph(paragraph, maxChunkSize);
        chunks.push(...subChunks);
        currentChunk = "";
      } else {
        currentChunk = paragraph;
      }
    }
  }
  
  if (currentChunk) {
    chunks.push(currentChunk);
  }
  
  return chunks;
};

const splitLongParagraph = (text: string, maxChunkSize: number): string[] => {
  const chunks: string[] = [];
  let remaining = text;
  
  while (remaining.length > maxChunkSize) {
    const splitIndex = findSplitPoint(remaining, maxChunkSize);
    chunks.push(remaining.substring(0, splitIndex));
    remaining = remaining.substring(splitIndex).trim();
  }
  
  if (remaining) {
    chunks.push(remaining);
  }
  
  return chunks;
};

const findSplitPoint = (text: string, maxChunkSize: number): number => {
  const preferredDelimiters = [". ", "。", "!", "！", "?", "？", "\n", ";", "；"];
  
  for (const delimiter of preferredDelimiters) {
    const index = text.lastIndexOf(delimiter, maxChunkSize);
    if (index > maxChunkSize * 0.5) {
      return index + delimiter.length;
    }
  }
  
  return maxChunkSize;
};