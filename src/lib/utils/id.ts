export const generateId = (): string => {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};

export const generateVersionId = (): string => {
  return `v${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
};
