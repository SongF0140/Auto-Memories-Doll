export const normalizeText = (text: string): string => {
  return text.trim().replace(/\s+/g, " ").replace(/\n+/g, "\n");
};

export const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + "...";
};

export const sanitizeFilename = (filename: string): string => {
  return filename.replace(/[\\/:*?"<>|]/g, "_");
};
