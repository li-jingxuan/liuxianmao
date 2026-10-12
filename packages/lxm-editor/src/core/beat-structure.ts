import type {
  ILXMTrack,
  ILXMMeasure,
  ILXMTechnique,
  ILXMRhythm,
} from "./types";
import type { ILXMIdFactory } from "./id-factory";
import { LXM_RHYTHM_BASES } from "./constants";
import { calculateRhythmTicks } from "./rhythm";
import { createMeasureRhythmContext } from "./tuplet";
import { validateTechnique } from "./technique-rules";
export type BeatStructureResult =
  | {
      ok: true;
      track: ILXMTrack;
      focusBeatId: string;
      consumedTieCount: number;
    }
  | { ok: false; message: string };
/** 保持纯规划，所有技巧完整映射后整体校验，不通过清理函数修复非法结果。 */
const finish = (
  track: ILXMTrack,
  measure: ILXMMeasure,
  techniques: ILXMTechnique[],
  focusBeatId: string,
  consumedTieCount = 0,
): BeatStructureResult => {
  const next = {
    ...track,
    measures: track.measures.map((m) => (m.id === measure.id ? measure : m)),
    techniques,
  };
  for (const t of techniques) {
    const result = validateTechnique(next, t, t.id);
    if (!result.ok) return { ok: false, message: result.error.message };
  }
  return { ok: true, track: next, focusBeatId, consumedTieCount };
};
/** 单拍等分为持续音的两拍，第一拍保留身份，外部离开连接迁移至第二拍。 */
export const splitBeat = (
  track: ILXMTrack,
  measureId: string,
  beatId: string,
  factory: ILXMIdFactory,
): BeatStructureResult => {
  const m = track.measures.find((m) => m.id === measureId),
    i = m?.beats.findIndex((b) => b.id === beatId) ?? -1;
  if (!m || i < 0) return { ok: false, message: "拆分目标拍不存在。" };
  const b = m.beats[i]!;
  if (createMeasureRhythmContext(m).tupletByBeatId.has(b.id))
    return { ok: false, message: "连音成员不能拆分，请先移除连音组。" };
  const index = LXM_RHYTHM_BASES.indexOf(b.rhythm.base),
    base = LXM_RHYTHM_BASES[index + 1];
  if (!base || b.notes.some((n) => n.fret === "x"))
    return { ok: false, message: "最短时值或闷音 x 不能保持原音乐语义拆分。" };
  const duration = calculateRhythmTicks(b.rhythm);
  if (!duration.ok || duration.ticks % 2)
    return { ok: false, message: "该时值不能精确等分。" };
  const rhythm = { ...b.rhythm, base },
    first = { ...b, rhythm };
  const { numberedNotation: _notation, ...body } = b;
  const second = {
    ...body,
    id: factory.createBeatId(),
    tick: b.tick + duration.ticks / 2,
    rhythm,
    notes: b.notes.map((n) => ({ ...n, id: factory.createNoteId() })),
  };
  const noteMap = new Map(b.notes.map((n, j) => [n.id, second.notes[j]!.id]));
  const techniques = track.techniques.map((t) => {
    if ("toNoteId" in t && noteMap.has(t.fromNoteId))
      return { ...t, fromNoteId: noteMap.get(t.fromNoteId)! };
    if ("toBeatId" in t && t.toBeatId === b.id)
      return { ...t, toBeatId: second.id };
    return t;
  });
  for (const n of b.notes)
    techniques.push({
      id: factory.createTechniqueId(),
      type: "tie",
      fromNoteId: n.id,
      toNoteId: noteMap.get(n.id)!,
    });
  return finish(
    track,
    {
      ...m,
      beats: [...m.beats.slice(0, i), first, second, ...m.beats.slice(i + 1)],
    },
    techniques,
    first.id,
  );
};
/** 合并仅接受普通休止或有完整逐弦 Tie 的持续音；不同起音和内部文本不会丢失。 */
export const mergeBeats = (
  track: ILXMTrack,
  measureId: string,
  startBeatId: string,
  endBeatId: string,
): BeatStructureResult => {
  const m = track.measures.find((m) => m.id === measureId),
    start = m?.beats.findIndex((b) => b.id === startBeatId) ?? -1,
    end = m?.beats.findIndex((b) => b.id === endBeatId) ?? -1;
  const reject = (message: string): BeatStructureResult => ({
    ok: false,
    message,
  });
  if (!m || start < 0 || end <= start)
    return reject("请选择同小节内至少两拍的连续范围。");
  const range = m.beats.slice(start, end + 1),
    first = range[0]!,
    last = range.at(-1)!,
    ids = new Set(range.map((b) => b.id));
  const context = createMeasureRhythmContext(m);
  if (range.some((b) => context.tupletByBeatId.has(b.id)))
    return reject("连音成员不能合并。");
  const ticks = range.reduce((sum, b) => {
    const d = calculateRhythmTicks(b.rhythm);
    return sum + (d.ok ? d.ticks : Infinity);
  }, 0);
  let rhythm: ILXMRhythm | undefined;
  for (const base of LXM_RHYTHM_BASES)
    for (const dots of [0, 1, 2]) {
      const r = { base, dots },
        d = calculateRhythmTicks(r);
      if (d.ok && d.ticks === ticks) rhythm ??= r;
    }
  if (!rhythm) return reject("总时值无法表示为一个合法音符。");
  if (
    range.slice(1).some((b) => b.numberedNotation) ||
    m.lyrics.some((l) => ids.has(l.beatId) && l.beatId !== first.id) ||
    m.chordSymbols.some((c) => ids.has(c.beatId) && c.beatId !== first.id)
  )
    return reject("后续拍有歌词、简谱或和弦，不能合并丢失内容。");
  const key = (b: typeof first) =>
    JSON.stringify(
      [...b.notes]
        .sort((a, b) => a.string - b.string)
        .map((n) => [n.string, n.fret]),
    );
  const rests = range.every((b) => b.kind === "rest");
  const sustained =
    first.kind === "notes" &&
    first.notes.length > 0 &&
    range.every(
      (b) =>
        b.kind === "notes" &&
        !b.notes.some((n) => n.fret === "x") &&
        key(b) === key(first),
    );
  if (!rests && !sustained)
    return reject("只能合并休止或同弦同品位的 Tie 持续音。");
  const consumed = new Set<string>();
  if (sustained)
    for (let j = 0; j < range.length - 1; j++)
      for (const n of range[j]!.notes) {
        const to = range[j + 1]!.notes.find((x) => x.string === n.string)!;
        const tie = track.techniques.find(
          (t) =>
            t.type === "tie" && t.fromNoteId === n.id && t.toNoteId === to.id,
        );
        if (!tie) return reject("相邻音符没有完整 Tie，合并会丢失起音次数。");
        consumed.add(tie.id);
      }
  const noteBeat = new Map(
      range.flatMap((b) => b.notes.map((n) => [n.id, b.id] as const)),
    ),
    targetNotes = new Map(first.notes.map((n) => [n.string, n.id]));
  const noteMap = new Map(
    range.flatMap((b) =>
      b.notes.map((n) => [n.id, targetNotes.get(n.string)!] as const),
    ),
  );
  const techniques: ILXMTechnique[] = [];
  for (const t of track.techniques) {
    if (consumed.has(t.id)) continue;
    if ("fromNoteId" in t) {
      const from = noteBeat.get(t.fromNoteId),
        to = "toNoteId" in t ? noteBeat.get(t.toNoteId) : undefined;
      if ("toNoteId" in t) {
        if (
          (from && from !== last.id) ||
          (to && to !== first.id) ||
          (from && to)
        )
          return reject("内部连接或中途起止技巧不能无损合并。");
        techniques.push({
          ...t,
          fromNoteId: noteMap.get(t.fromNoteId) ?? t.fromNoteId,
          toNoteId: noteMap.get(t.toNoteId) ?? t.toNoteId,
        });
      } else {
        if (from && from !== first.id)
          return reject("后续拍有独立音符技巧，不能合并。");
        techniques.push(t);
      }
    } else if ("beatId" in t) {
      if (ids.has(t.beatId) && t.beatId !== first.id)
        return reject("后续拍有独立拍点技巧，不能合并。");
      techniques.push(t);
    } else {
      if (
        (ids.has(t.fromBeatId) && t.fromBeatId !== first.id) ||
        (ids.has(t.toBeatId) && t.toBeatId !== last.id)
      )
        return reject("技巧只覆盖部分合并时长，不能扩大区间。");
      techniques.push({
        ...t,
        fromBeatId: ids.has(t.fromBeatId) ? first.id : t.fromBeatId,
        toBeatId: ids.has(t.toBeatId) ? first.id : t.toBeatId,
      });
    }
  }
  return finish(
    track,
    {
      ...m,
      beats: [
        ...m.beats.slice(0, start),
        { ...first, rhythm },
        ...m.beats.slice(end + 1),
      ],
    },
    techniques,
    first.id,
    consumed.size,
  );
};
