/** 保留核心真实时间窗校验；仅将时值不足的失败解释成用户可操作的提示。 */
export const numberedRhythmIssue = (message: string): string => {
  if (message === "简谱时值超出小节容量")
    return "当前位置后续时值不够，已超出本小节末尾；请缩短时值。";
  if (message === "附点修改超出后方空白，请先调整相邻音符或空位")
    return "当前拍后续空白时值不够；请先调整相邻音符或空位。";
  if (message === "本拍内相邻音符没有可互补的时值，请先调整相邻音符或空位")
    return "当前拍后续时值不够或无法互补；请先调整相邻音符或空位。";
  return message;
};
