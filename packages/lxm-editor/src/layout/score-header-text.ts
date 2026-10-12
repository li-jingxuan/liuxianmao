import type { ILXMScore, ILXMTrack } from "../core/types";
/** 谱首字符串只有一个来源，度量、布局、打印共同消费。 */
export const scoreHeaderText = (score: ILXMScore, track: ILXMTrack) => {
  const time = track.measures[0]?.timeSignature;
  return {
    title: score.title || "未命名歌曲",
    author: score.arranger ? `编谱：${score.arranger}` : "",
    info: [
      score.keySignature ? `1=${score.keySignature}` : "",
      time ? `${time.numerator}/${time.denominator}` : "",
      track.capo ? `Capo ${track.capo}` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  };
};
