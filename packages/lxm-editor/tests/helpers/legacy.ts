/** 历史测试从当前基础谱构造旧文件时，显式移除新版本专有字段。 */
export const asLegacyFixture = (value: unknown): unknown => {
  const source = structuredClone(value);
  if (!source || typeof source !== "object" || !("score" in source))
    return source;
  const score = source.score;
  if (
    !score ||
    typeof score !== "object" ||
    !("tracks" in score) ||
    !Array.isArray(score.tracks)
  )
    return source;
  for (const track of score.tracks) {
    if (!track || typeof track !== "object") continue;
    delete track.numberedMarks;
    if (!Array.isArray(track.measures)) continue;
    for (const measure of track.measures)
      if (measure && typeof measure === "object") delete measure.numberedVoice;
  }
  return source;
};
