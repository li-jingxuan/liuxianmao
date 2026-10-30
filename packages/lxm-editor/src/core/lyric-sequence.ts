import { normalizeMusicText } from "./music-text";
import { planLyricPositions, resolveLyricPosition } from "./lyric-positions";
import type { ILXMDocument, ILXMLyricVerse } from "./types";

export type LyricSequenceItem =
  | { kind: "set"; text: string }
  | { kind: "skip" };
export interface LyricSequenceTarget {
  trackId: string;
  measureId: string;
  eventId?: string;
  tick?: number;
  endTick?: number;
  verse: ILXMLyricVerse;
}
export interface LyricSequenceRow {
  index: number;
  item: LyricSequenceItem;
  target: LyricSequenceTarget | null;
  measureNumber: number | null;
  beatNumber: number | null;
  rest: boolean;
  previous: string | null;
  status: "add" | "change" | "same" | "skip" | "error";
}
export const MAX_LYRIC_SEQUENCE_ITEMS = 256;
export const MAX_LYRIC_SEQUENCE_INPUT = 16384;

/** 只接受半角/全角空格；保留显式跳拍，不让控制字符被 trim 吞掉。 */
export const parseLyricSequence = (
  raw: string,
):
  | { ok: true; items: LyricSequenceItem[] }
  | { ok: false; message: string } => {
  if ([...raw].length > MAX_LYRIC_SEQUENCE_INPUT)
    return { ok: false, message: "连续填词输入最多 16384 个字符。" };
  if (
    [...raw].some((c) => /\s/u.test(c) && c !== " " && c !== "\u3000") ||
    [...raw].some((c) => {
      const code = c.codePointAt(0)!;
      return code <= 31 || (code >= 127 && code <= 159);
    })
  )
    return {
      ok: false,
      message: "只支持半角或全角空格分隔，不接受换行、制表符或其他控制字符。",
    };
  const tokens = raw.split(/[ \u3000]+/u).filter(Boolean);
  if (!tokens.length || tokens.every((t) => t === "_"))
    return { ok: false, message: "请至少输入一项有效歌词，不能全部跳过。" };
  if (tokens.length > MAX_LYRIC_SEQUENCE_ITEMS)
    return { ok: false, message: "单批最多对应 256 拍。" };
  const items: LyricSequenceItem[] = [];
  for (const [index, token] of tokens.entries()) {
    if (token === "_") items.push({ kind: "skip" });
    else {
      const text = normalizeMusicText(token, 64);
      if (!text)
        return {
          ok: false,
          message: `第 ${index + 1} 项歌词无效，每项最多 64 个字符。`,
        };
      items.push({ kind: "set", text });
    }
  }
  return { ok: true, items };
};

/** 预览与提交共用映射，按真实简谱事件顺序跨小节分配；失败不产生候选文档。 */
export const planLyricSequence = (
  document: ILXMDocument,
  start: LyricSequenceTarget,
  items: readonly LyricSequenceItem[],
  allowOverwrite = false,
): {
  rows: LyricSequenceRow[];
  issue: string | null;
  changes: number;
  overwrites: number;
} => {
  const invalid = (issue: string) => ({
    rows: [],
    issue,
    changes: 0,
    overwrites: 0,
  });
  if (![1, 2, 3, 4].includes(start.verse)) return invalid("歌词段号应为 1–4。");
  if (!items.length || items.length > MAX_LYRIC_SEQUENCE_ITEMS)
    return invalid("每批须包含 1–256 个位置。");
  const track = document.score.tracks.find((t) => t.id === start.trackId);
  if (!track) return invalid("目标轨道不存在。");
  const events = track.measures.flatMap((m, mi) =>
    planLyricPositions(m).map((position, index) => ({
      m,
      position,
      mi,
      ei: position.eventId
        ? m.numberedVoice.events.findIndex(
            (event) => event.id === position.eventId,
          )
        : index,
    })),
  );
  const startMeasure = track.measures.find((m) => m.id === start.measureId);
  const resolvedStart =
    startMeasure && resolveLyricPosition(startMeasure, start);
  const offset = events.findIndex(
    ({ m, position }) =>
      m.id === start.measureId &&
      resolvedStart &&
      position.tick === resolvedStart.tick,
  );
  if (offset < 0) return invalid("起始歌词位置已失效，请重新选择。");
  let issue: string | null = null;
  let changes = 0;
  let overwrites = 0;
  let sets = 0;
  const rows = items.map((item, index): LyricSequenceRow => {
    const targetEvent = events[offset + index];
    const text =
      item.kind === "set" && typeof item.text === "string"
        ? normalizeMusicText(item.text, 64)
        : null;
    const valid =
      item.kind === "skip" || (item.kind === "set" && text !== null);
    if (item.kind === "set") sets++;
    if (!valid && !issue) issue = `第 ${index + 1} 项歌词无效。`;
    const previous =
      targetEvent?.m.lyrics.find(
        (l) =>
          l.eventId === targetEvent.position.eventId && l.verse === start.verse,
      )?.text ?? null;
    const status =
      !targetEvent || !valid
        ? "error"
        : item.kind === "skip"
          ? "skip"
          : previous === text
            ? "same"
            : previous !== null
              ? "change"
              : "add";
    if (status === "change") overwrites++;
    if (status === "change" || status === "add") changes++;
    return {
      index,
      item: item.kind === "set" && text ? { kind: "set", text } : { ...item },
      target: targetEvent
        ? {
            trackId: start.trackId,
            verse: start.verse,
            measureId: targetEvent.m.id,
            ...(targetEvent.position.eventId
              ? { eventId: targetEvent.position.eventId }
              : {
                  tick: targetEvent.position.tick,
                  endTick: targetEvent.position.endTick,
                }),
          }
        : null,
      measureNumber: targetEvent ? targetEvent.mi + 1 : null,
      beatNumber: targetEvent ? targetEvent.ei + 1 : null,
      rest: false,
      previous,
      status,
    };
  });
  if (!sets) issue ??= "请至少输入一项有效歌词，不能全部跳过。";
  if (offset + items.length > events.length)
    issue ??= `谱尾位置不足，还缺 ${offset + items.length - events.length} 个歌词位置；整批未应用。`;
  if (overwrites && !allowOverwrite)
    issue ??= `将替换 ${overwrites} 项已有歌词，请先确认允许覆盖。`;
  return { rows, issue, changes, overwrites };
};
