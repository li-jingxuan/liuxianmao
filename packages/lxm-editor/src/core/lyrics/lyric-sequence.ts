import { normalizeMusicText } from "../music-text/music-text";
import { createNumberedMeasureRhythmContext } from "../numbered/numbered-rhythm";
import { planLyricPositions, resolveLyricPosition, type LyricPosition } from "./lyric-positions";
import type { ILXMDocument, ILXMLyricVerse, ILXMMeasure } from "../types";

export type LyricSequenceItem =
  | { kind: "set"; text: string }
  | { kind: "clear" };
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
  status: "add" | "change" | "same" | "clear" | "error";
}
export const MAX_LYRIC_SEQUENCE_ITEMS = 256;
export const MAX_LYRIC_SEQUENCE_INPUT = 16384;

/** 空格只分词；空输入与独立下划线清空位置，不让控制字符被 trim 吞掉。 */
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
  if (!tokens.length) return { ok: true, items: [{ kind: "clear" }] };
  if (tokens.length > MAX_LYRIC_SEQUENCE_ITEMS)
    return { ok: false, message: "单批最多对应 256 拍。" };
  const items: LyricSequenceItem[] = [];
  for (const [index, token] of tokens.entries()) {
    if (token === "_") items.push({ kind: "clear" });
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
  const startMeasureIndex = track.measures.findIndex((m) => m.id === start.measureId);
  const startMeasure = track.measures[startMeasureIndex];
  if (!startMeasure) return invalid("起始歌词位置已失效，请重新选择。");
  const startContext = createNumberedMeasureRhythmContext(track, startMeasureIndex);
  const resolvedStart = resolveLyricPosition(startMeasure, start, startContext);
  if (!resolvedStart) return invalid("起始歌词位置已失效，请重新选择。");

  // 草稿预览和正式应用都只取本批需要的位置。先验证起点，再按小节向后收集，
  // 避免每次键入时为整条轨道重算节奏和空白时间窗。遇到休止仍沿用位置规划的跳过规则，
  // 谱尾未凑满一批时保留已找到的位置，让下面的逻辑继续显示缺项并拒绝整批提交。
  const destinations: {
    measure: ILXMMeasure;
    position: LyricPosition;
    measureNumber: number;
    beatNumber: number;
  }[] = [];
  for (
    let measureIndex = startMeasureIndex;
    measureIndex < track.measures.length && destinations.length < items.length;
    measureIndex++
  ) {
    const measure = track.measures[measureIndex]!;
    const context = measureIndex === startMeasureIndex ? startContext : createNumberedMeasureRhythmContext(track, measureIndex);
    for (const [index, position] of planLyricPositions(measure, context).entries()) {
      if (destinations.length === items.length) break;
      if (measureIndex === startMeasureIndex && position.tick < resolvedStart.tick) continue;
      const beatIndex = position.eventId
        ? measure.numberedVoice.events.findIndex((event) => event.id === position.eventId)
        : index;
      destinations.push({
        measure, position, measureNumber: measureIndex + 1, beatNumber: beatIndex + 1,
      });
    }
  }
  let issue: string | null = null;
  let changes = 0;
  let overwrites = 0;
  const rows = items.map((item, index): LyricSequenceRow => {
    const destination = destinations[index];
    const text =
      item.kind === "set" && typeof item.text === "string"
        ? normalizeMusicText(item.text, 64)
        : null;
    const valid =
      item.kind === "clear" || (item.kind === "set" && text !== null && text !== "_");
    if (!valid && !issue) issue = `第 ${index + 1} 项歌词无效。`;
    const previous =
      destination?.measure.lyrics.find(
        (l) =>
          l.eventId === destination.position.eventId && l.verse === start.verse,
      )?.text ?? null;
    const status =
      !destination || !valid
        ? "error"
        : item.kind === "clear"
          ? previous === null ? "same" : "clear"
          : previous === text
            ? "same"
            : previous !== null
              ? "change"
              : "add";
    if (status === "change" || status === "clear") overwrites++;
    if (status === "change" || status === "add" || status === "clear") changes++;
    return {
      index,
      item: item.kind === "set" && text ? { kind: "set", text } : { ...item },
      target: destination
        ? {
            trackId: start.trackId,
            verse: start.verse,
            measureId: destination.measure.id,
            ...(destination.position.eventId
              ? { eventId: destination.position.eventId }
              : {
                  tick: destination.position.tick,
                  endTick: destination.position.endTick,
                }),
          }
        : null,
      measureNumber: destination?.measureNumber ?? null,
      beatNumber: destination?.beatNumber ?? null,
      rest: false,
      previous,
      status,
    };
  });
  if (items.length > destinations.length)
    issue ??= `谱尾位置不足，还缺 ${items.length - destinations.length} 个歌词位置；整批未应用。`;
  if (overwrites && !allowOverwrite)
    issue ??= `将替换 ${overwrites} 项已有歌词，请先确认允许覆盖。`;
  return { rows, issue, changes, overwrites };
};
