export const scoringConfig = {
  recencyLambda: 0.01,
  accessWeight: 0.35,
  recencyWeight: 0.25,
  exposureWeight: 0.25,
  tagAffinityWeight: 0.15,
};

export const calculateHeatScore = (
  accessCount: number,
  updatedAt: string,
  exposureCount: number,
  tags: string[],
  profileTags: string[],
  maxAccessCount: number,
  maxExposureCount: number,
): number => {
  const accessScore =
    maxAccessCount > 0 ? Math.log(1 + accessCount) / Math.log(1 + maxAccessCount) : 0;

  const hoursSinceUpdate = (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60);
  const recencyScore = Math.exp(-scoringConfig.recencyLambda * hoursSinceUpdate);

  const exposureScore = maxExposureCount > 0 ? exposureCount / maxExposureCount : 0;

  const intersection = tags.filter((tag) => profileTags.includes(tag)).length;
  const union = tags.length + profileTags.length - intersection;
  const tagAffinityScore = union > 0 ? intersection / union : 0;

  return (
    accessScore * scoringConfig.accessWeight +
    recencyScore * scoringConfig.recencyWeight +
    exposureScore * scoringConfig.exposureWeight +
    tagAffinityScore * scoringConfig.tagAffinityWeight
  );
};
