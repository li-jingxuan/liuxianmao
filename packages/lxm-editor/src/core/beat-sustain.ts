import { TICKS_PER_QUARTER } from "./constants";
import { techniqueBeatIds } from "./content-protection";
import type { ILXMIdFactory } from "./id-factory";
import { createBeatAlignedRestBeats } from "./rest-beats";
import { calculateRhythmTicks, getMeasureCapacityTicks } from "./rhythm";
import { validateTechnique } from "./technique-rules";
import { createMeasureRhythmContext } from "./tuplet";
import type { ILXMBeat, ILXMTrack } from "./types";

export type BeatSustainResult =
  | { ok: true; changed: boolean; track: ILXMTrack; focusBeatId: string }
  | {
      ok: false;
      code:
        | "MEASURE_NOT_FOUND"
        | "BEAT_NOT_FOUND"
        | "BEAT_IN_TUPLET"
        | "INVALID_BEAT_OPERATION"
        | "RHYTHM_NOT_REPRESENTABLE";
      message: string;
    };

/** 将源拍后的一个四分音符时长原子转换为逐弦 Tie 续音，不移动其他起音。 */
export const extendBeat = (
  track: ILXMTrack,
  measureId: string,
  beatId: string,
  factory: ILXMIdFactory,
): BeatSustainResult => {
  const reject = (
    message: string,
    code: Extract<
      BeatSustainResult,
      { ok: false }
    >["code"] = "INVALID_BEAT_OPERATION",
  ): BeatSustainResult => ({ ok: false, code, message });
  const measure = track.measures.find((m) => m.id === measureId);
  if (!measure) return reject("目标小节不存在", "MEASURE_NOT_FOUND");
  const sourceIndex = measure.beats.findIndex((b) => b.id === beatId);
  const source = measure.beats[sourceIndex];
  if (!source) return reject("源节拍不存在", "BEAT_NOT_FOUND");
  const context = createMeasureRhythmContext(measure);
  if (context.tupletByBeatId.has(source.id))
    return reject("请先删除源拍连音组，再延续一拍", "BEAT_IN_TUPLET");
  if (
    source.kind !== "notes" ||
    source.notes.length === 0 ||
    source.notes.some((n) => typeof n.fret !== "number")
  )
    return reject(
      "延续一拍需要包含数值品位音符的源拍，不能延续空拍、休止或闷音 x",
    );
  const duration = calculateRhythmTicks(source.rhythm);
  if (!duration.ok) return reject("源拍时值无效");
  const startTick = source.tick + duration.ticks;
  const endTick = startTick + TICKS_PER_QUARTER;
  if (endTick > getMeasureCapacityTicks(measure.timeSignature))
    return reject("小节内剩余时长不足一拍，暂不支持跨小节延续");
  const first = measure.beats[sourceIndex + 1];
  if (!first || first.tick !== startTick)
    return reject("源拍后需要紧邻的休止拍");
  if (context.tupletByBeatId.has(first.id))
    return reject("续音目标属于连音组，请先删除连音组", "BEAT_IN_TUPLET");

  // 完整的同弦同品位逐弦 Tie 已存在时保留所有引用与 revision。
  if (
    first.kind === "notes" &&
    first.rhythm.base === "quarter" &&
    first.rhythm.dots === 0 &&
    first.notes.length === source.notes.length &&
    source.notes.every((n) => {
      const to = first.notes.find(
        (candidate) =>
          candidate.string === n.string && candidate.fret === n.fret,
      );
      return (
        to &&
        track.techniques.some(
          (t) =>
            t.type === "tie" && t.fromNoteId === n.id && t.toNoteId === to.id,
        )
      );
    })
  )
    return { ok: true, changed: false, track, focusBeatId: first.id };

  const protectedIds = techniqueBeatIds(track);
  let cursor = startTick;
  let afterIndex = sourceIndex + 1;
  while (cursor < endTick) {
    const beat = measure.beats[afterIndex];
    if (!beat || beat.tick !== cursor)
      return reject("源拍后连续休止时长不足一个四分音符");
    if (context.tupletByBeatId.has(beat.id))
      return reject("续音目标属于连音组，请先删除连音组", "BEAT_IN_TUPLET");
    if (beat.kind !== "rest" || beat.notes.length > 0)
      return reject("延续一拍只能覆盖连续空休止，不能覆盖已有音符或起音");
    if (
      protectedIds.has(beat.id) ||
      measure.chordSymbols.some((c) => c.beatId === beat.id)
    )
      return reject("续音目标含有和弦或技巧，请先调整目标内容");
    const ticks = calculateRhythmTicks(beat.rhythm);
    if (!ticks.ok) return reject("续音目标时值无效");
    cursor += ticks.ticks;
    afterIndex += 1;
  }

  // TAB 的“一拍”固定为 quarter；尾部按 quarter 边界补休止，与拍号分母无关。
  const tail = createBeatAlignedRestBeats(
    endTick,
    cursor - endTick,
    { numerator: 4, denominator: 4 },
    factory.createBeatId,
  );
  if (!tail) return reject("剩余休止无法精确表示", "RHYTHM_NOT_REPRESENTABLE");
  const continuation: ILXMBeat = {
    ...first,
    kind: "notes",
    rhythm: { base: "quarter", dots: 0 },
    notes: source.notes.map((n) => ({ ...n, id: factory.createNoteId() })),
  };
  const next: ILXMTrack = {
    ...track,
    measures: track.measures.map((m) =>
      m === measure
        ? {
            ...m,
            beats: [
              ...m.beats.slice(0, sourceIndex + 1),
              continuation,
              ...tail,
              ...m.beats.slice(afterIndex),
            ],
          }
        : m,
    ),
    techniques: [
      ...track.techniques,
      ...source.notes.map((n, i) => ({
        id: factory.createTechniqueId(),
        type: "tie" as const,
        fromNoteId: n.id,
        toNoteId: continuation.notes[i]!.id,
      })),
    ],
  };
  for (const technique of next.techniques) {
    const validation = validateTechnique(next, technique, technique.id);
    if (!validation.ok) return reject(validation.error.message);
  }
  return { ok: true, changed: true, track: next, focusBeatId: first.id };
};
