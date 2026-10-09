import type { ILXMMeasure } from "./types";

/** 先拒绝原始控制字符，再规范化；不能让 trim 掩盖多行输入。 */
export const normalizeMusicText = (
  text: string,
  limit: number,
): string | null => {
  if (
    [...text].some((character) => {
      const code = character.codePointAt(0)!;
      return (
        code <= 31 ||
        (code >= 127 && code <= 159) ||
        code === 0x2028 ||
        code === 0x2029
      );
    })
  )
    return null;
  const normalized = text.normalize("NFC").trim();
  return normalized && [...normalized].length <= limit ? normalized : null;
};

/** 带文本的休止拍属于明确内容，不能被容量重建吞掉。 */
export const collectMusicTextBeatIds = (
  measure: ILXMMeasure,
): ReadonlySet<string> =>
  new Set(
    [...measure.lyrics, ...measure.chordSymbols].map((item) => item.beatId),
  );
