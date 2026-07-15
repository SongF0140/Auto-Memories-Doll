export const getCurrentTime = (): string => {
  return new Date().toISOString();
};

export const formatDate = (date: string | Date): string => {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const isExpired = (date: string, hours: number): boolean => {
  const expiryTime = new Date(date).getTime() + hours * 60 * 60 * 1000;
  return Date.now() > expiryTime;
};