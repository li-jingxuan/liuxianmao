import type { ILXMMeasure } from "./types";

/** 先拒绝原始控制字符，再规范化；不能让 trim 掩盖多行输入。 */
export const normalizeMusicText = (
  text: string,
  limit: number,
): string | null => {
  if (hasMusicTextControlCharacter(text)) return null;
  const normalized = text.normalize("NFC").trim();
  return normalized && [...normalized].length <= limit ? normalized : null;
};

/** 和弦绑定 TAB Beat；歌词绑定简谱事件，不参与 TAB 容量保护。 */
export const collectMusicTextBeatIds = (
  measure: ILXMMeasure,
): ReadonlySet<string> =>
  new Set(measure.chordSymbols.map((item) => item.beatId));

export const collectLyricEventIds = (
  measure: ILXMMeasure,
): ReadonlySet<string> => new Set(measure.lyrics.map((item) => item.eventId));

/** 空白清除也不能掩盖控制字符，供标记命令与文本规范化共用。 */
export const hasMusicTextControlCharacter = (text: string): boolean =>
  [...text].some((character) => {
    const code = character.codePointAt(0)!;
    return (
      code <= 31 ||
      (code >= 127 && code <= 159) ||
      code === 0x2028 ||
      code === 0x2029
    );
  });
