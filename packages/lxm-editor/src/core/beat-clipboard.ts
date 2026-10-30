import { copyNumberedVoices } from "./numbered-copy";
import {
  createNumberedRhythmContext,
  validateNumberedVoice,
} from "./numbered-rhythm";
import { validateNumberedMarks } from "./numbered-marks";
import { TICKS_PER_QUARTER } from "./constants";
import { z } from "zod";
import {
  LXMMeasureSchema,
  LXMTechniqueSchema,
  LXMNumberedVoiceSchema,
  LXMNumberedMarkSchema,
} from "./schema";
import { createDocumentIdFactory } from "./id-factory";
import type { ILXMIdFactory } from "./id-factory";
import type { ILXMDocument, ILXMMeasure, ILXMTrack } from "./types";
import { copyMeasureRangeTechniques } from "./copy-measure-techniques";
import { createMeasureRhythmContext } from "./tuplet";
import { validateTechnique } from "./technique-rules";
import { techniqueBeatIds } from "./content-protection";
import {
  getFixedPrefixLength,
  reconcileMeasureTimeline,
} from "./measure-timeline";
import type { ILXMCommandEffect } from "./command-effects";
import { collectNumberedOmissionEffects } from "./command-effects";
const contentSchema = LXMMeasureSchema.pick({
  beats: true,
  lyrics: true,
  chordSymbols: true,
  tuplets: true,
}).extend({ beats: LXMMeasureSchema.shape.beats.min(1).max(256) });
const clipboardSchema = z
  .object({
    format: z.literal("lxm-beat-clipboard"),
    version: z.literal(2),
    layers: z.enum(["tab", "both"]),
    numberedVoice: LXMNumberedVoiceSchema.nullable(),
    numberedMarks: z.array(LXMNumberedMarkSchema),
    numberedOmissions: z.array(z.string()),
    content: contentSchema,
    techniques: z.array(LXMTechniqueSchema),
    totalTicks: z.number().int().positive(),
    omissions: z.array(
      z
        .object({
          kind: z.literal("technique.omitted"),
          trackId: z.string(),
          measureId: z.string(),
          measureNumber: z.number().int().positive(),
          techniqueId: z.string(),
          techniqueType: LXMTechniqueSchema.options[0].shape.type.or(
            z.enum([
              "vibrato",
              "naturalHarmonic",
              "artificialHarmonic",
              "tapping",
              "trill",
              "hammerOn",
              "pullOff",
              "slideUp",
              "slideDown",
              "tie",
              "strum",
              "arpeggio",
              "pickStroke",
              "palmMute",
              "letRing",
            ]),
          ),
        })
        .strict(),
    ),
  })
  .strict();
export type BeatClipboard = z.infer<typeof clipboardSchema>;
export interface BeatClipboardRange {
  trackId: string;
  measureId: string;
  startBeatId: string;
  endBeatId: string;
  layers?: "tab" | "both";
}
/** 使用局部载荷构造校验上下文，不把部分小节错误地按完整小节容量校验。 */
const sliceMeasure = (content: BeatClipboard["content"]): ILXMMeasure => ({
  id: "clipboard-measure",
  timeSignature: { numerator: 4, denominator: 4 },
  barline: "single",
  numberedVoice: { events: [], tuplets: [] },
  ...content,
});
export const validateBeatClipboard = (
  input: unknown,
  template: ILXMTrack,
): { ok: true; clipboard: BeatClipboard } | { ok: false; message: string } => {
  const parsed = clipboardSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      message:
        "拍点快照格式无效：" +
        parsed.error.issues
          .map((i) => i.path.join(".") + ":" + i.message)
          .join("；"),
    };
  const c = parsed.data,
    m = sliceMeasure(c.content),
    ids = [
      ...m.beats.flatMap((b) => [b.id, ...b.notes.map((n) => n.id)]),
      ...m.tuplets.map((g) => g.id),
      ...m.lyrics.map((l) => l.id),
      ...m.chordSymbols.map((s) => s.id),
      ...c.techniques.map((t) => t.id),
      ...(c.numberedVoice?.events.flatMap((e) => [
        e.id,
        ...e.items.map((i) => i.id),
      ]) ?? []),
      ...(c.numberedVoice?.tuplets.map((g) => g.id) ?? []),
      ...c.numberedMarks.map((m) => m.id),
    ];
  const reject = (message: string) => ({ ok: false as const, message });
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length)
    return reject("拍点快照 ID 重复或为空。");
  const beatIds = new Set(m.beats.map((b) => b.id));
  const lyricEventIds = new Set(
    c.numberedVoice?.events
      .filter((event) => event.kind === "notes" || event.kind === "gap")
      .map((event) => event.id),
  );
  if (
    m.lyrics.some((l) => !lyricEventIds.has(l.eventId)) ||
    m.chordSymbols.some((s) => !beatIds.has(s.beatId))
  )
    return reject("快照文本引用不存在。");
  if (
    new Set(m.lyrics.map((l) => `${l.eventId}:${l.verse}`)).size !==
      m.lyrics.length ||
    new Set(m.chordSymbols.map((s) => s.beatId)).size !== m.chordSymbols.length
  )
    return reject("快照文本目标重复。");
  const grouped = new Set<string>();
  let previous = -1;
  for (const g of m.tuplets) {
    const start = m.beats.findIndex((b) => b.id === g.beatIds[0]);
    if (start < 0 || start < previous || g.beatIds.length !== g.ratio.actual)
      return reject("快照连音组不完整。");
    previous = start;
    for (const [i, id] of g.beatIds.entries()) {
      const b = m.beats[start + i];
      if (
        !b ||
        b.id !== id ||
        grouped.has(id) ||
        b.rhythm.base !== m.beats[start]!.rhythm.base ||
        b.rhythm.dots !== m.beats[start]!.rhythm.dots
      )
        return reject("快照连音成员非法。");
      grouped.add(id);
    }
  }
  const context = createMeasureRhythmContext(m);
  let tick = 0;
  for (const b of m.beats) {
    const d = context.getBeatDurationTicks(b);
    if (
      !d.ok ||
      b.tick !== tick ||
      (b.kind === "rest" && b.notes.length) ||
      new Set(b.notes.map((n) => n.string)).size !== b.notes.length
    )
      return reject("快照拍点时值或音符无效。");
    tick += d.ticks;
  }
  if (tick !== c.totalTicks) return reject("快照总时值不一致。");
  if (
    (c.layers === "tab" &&
      (c.numberedVoice !== null || c.numberedMarks.length)) ||
    (c.layers === "both" && !c.numberedVoice)
  )
    return reject("快照所选谱层与内容不一致");
  const numberedError =
    c.numberedVoice && validateNumberedVoice(c.numberedVoice, c.totalTicks);
  if (numberedError) return reject(numberedError);
  const track = {
    ...template,
    measures: [
      { ...m, numberedVoice: c.numberedVoice ?? { events: [], tuplets: [] } },
    ],
    techniques: c.techniques,
    numberedMarks: c.numberedMarks,
  };
  const marksError = validateNumberedMarks(track);
  if (marksError) return reject(marksError);
  for (const t of c.techniques) {
    const r = validateTechnique(track, t, t.id);
    if (!r.ok) return reject(r.error.message);
  }
  return { ok: true, clipboard: c };
};
/** 每次粘贴重建全部 ID 与关联，简谱/和弦图深复制，绝不保留源外引用。 */
const copyContent = (
  content: BeatClipboard["content"],
  techniques: BeatClipboard["techniques"],
  template: ILXMTrack,
  factory: ILXMIdFactory,
  numberedVoice: BeatClipboard["numberedVoice"],
  numberedMarks: BeatClipboard["numberedMarks"],
) => {
  const source = {
      ...sliceMeasure(content),
      numberedVoice: numberedVoice ?? { events: [], tuplets: [] },
    },
    beatMap = new Map(source.beats.map((b) => [b.id, factory.createBeatId()]));
  const copy = {
    ...source,
    beats: source.beats.map((b) => ({
      ...structuredClone(b),
      id: beatMap.get(b.id)!,
      notes: b.notes.map((n) => ({ ...n, id: factory.createNoteId() })),
    })),
    chordSymbols: source.chordSymbols.map((s) => ({
      ...structuredClone(s),
      id: factory.createChordSymbolId(),
      beatId: beatMap.get(s.beatId)!,
    })),
    tuplets: source.tuplets.map((g) => ({
      ...structuredClone(g),
      id: factory.createTupletId(),
      beatIds: g.beatIds.map((id) => beatMap.get(id)!),
    })),
  };
  const mapped = copyMeasureRangeTechniques(
    { ...template, measures: [source], techniques },
    [source],
    [copy],
    factory,
  ).techniques;
  const numbered = copyNumberedVoices(
    { ...template, numberedMarks },
    [source],
    factory,
  );
  return {
    measure: {
      ...copy,
      numberedVoice: numbered.voices[0]!,
      lyrics: source.lyrics.map((lyric) => ({
        ...lyric,
        id: factory.createLyricId(),
        eventId: numbered.ids.get(lyric.eventId)!,
      })),
    },
    techniques: mapped,
    numberedMarks: numbered.marks,
  };
};
/** 复制只有临时结果，不改变文档、revision 或宿主通知。 */
export const createBeatClipboard = (
  document: ILXMDocument,
  range: BeatClipboardRange,
): { ok: true; clipboard: BeatClipboard } | { ok: false; message: string } => {
  const track = document.score.tracks.find((t) => t.id === range.trackId),
    m = track?.measures.find((m) => m.id === range.measureId);
  const a = m?.beats.findIndex((b) => b.id === range.startBeatId) ?? -1,
    b = m?.beats.findIndex((b) => b.id === range.endBeatId) ?? -1;
  if (!track || !m || a < 0 || b < a || b - a + 1 > 256)
    return {
      ok: false,
      message: "请选择同小节的 1–256 个连续拍点（含全部弦）。",
    };
  const beats = m.beats.slice(a, b + 1),
    ids = new Set(beats.map((b) => b.id));
  if (
    m.tuplets.some(
      (g) =>
        g.beatIds.some((id) => ids.has(id)) &&
        !g.beatIds.every((id) => ids.has(id)),
    )
  )
    return { ok: false, message: "复制范围不能截断连音组。" };
  const content = {
    beats: beats.map((b) => ({
      ...structuredClone(b),
      tick: b.tick - beats[0]!.tick,
    })),
    tuplets: m.tuplets
      .filter((g) => g.beatIds.every((id) => ids.has(id)))
      .map((g) => structuredClone(g)),
    lyrics: [] as ILXMMeasure["lyrics"],
    chordSymbols: m.chordSymbols
      .filter((s) => ids.has(s.beatId))
      .map((s) => structuredClone(s)),
  };
  const part = { ...m, ...content },
    factory = createDocumentIdFactory(document);
  const mapped = copyMeasureRangeTechniques(
    track,
    [{ ...m, beats }],
    [{ ...m, beats }],
    factory,
  );
  const context = createMeasureRhythmContext(part),
    totalTicks = content.beats.reduce((sum, b) => {
      const d = context.getBeatDurationTicks(b);
      return sum + (d.ok ? d.ticks : Infinity);
    }, 0);
  const layers = range.layers ?? "both";
  const startTick = beats[0]!.tick,
    endTick = startTick + totalTicks;
  const numberedContext = createNumberedRhythmContext(m.numberedVoice);
  const selectedEvents = m.numberedVoice.events.filter((e) => {
    const d = numberedContext.getEventDurationTicks(e);
    return d.ok && e.tick < endTick && e.tick + d.ticks > startTick;
  });
  const selectedIds = new Set(selectedEvents.map((e) => e.id));
  if (layers === "both")
    content.lyrics = structuredClone(
      m.lyrics.filter((lyric) => selectedIds.has(lyric.eventId)),
    );
  if (
    layers === "both" &&
    (selectedEvents.some((e) => {
      const d = numberedContext.getEventDurationTicks(e);
      return e.tick < startTick || !d.ok || e.tick + d.ticks > endTick;
    }) ||
      m.numberedVoice.tuplets.some(
        (g) =>
          g.eventIds.some((id) => selectedIds.has(id)) &&
          !g.eventIds.every((id) => selectedIds.has(id)),
      ))
  )
    return {
      ok: false,
      message: "复制范围切断简谱事件或连音组，请扩大范围或仅复制六线谱",
    };
  const itemIds = new Set(
    selectedEvents.flatMap((e) => e.items.map((i) => i.id)),
  );
  const internal = track.numberedMarks.filter((mark) =>
    mark.type === "tie"
      ? itemIds.has(mark.fromItemId) && itemIds.has(mark.toItemId)
      : mark.type === "slur"
        ? selectedIds.has(mark.fromEventId) && selectedIds.has(mark.toEventId)
        : selectedIds.has(mark.eventId),
  );
  const numberedVoice =
    layers === "both"
      ? {
          events: selectedEvents.map((e) => ({
            ...structuredClone(e),
            tick: e.tick - startTick,
          })),
          tuplets: m.numberedVoice.tuplets
            .filter((g) => g.eventIds.every((id) => selectedIds.has(id)))
            .map((g) => structuredClone(g)),
        }
      : null;
  return validateBeatClipboard(
    {
      format: "lxm-beat-clipboard",
      version: 2,
      layers,
      numberedVoice,
      numberedMarks: layers === "both" ? structuredClone(internal) : [],
      numberedOmissions:
        layers === "both"
          ? track.numberedMarks
              .filter(
                (m) =>
                  !internal.includes(m) &&
                  (m.type === "tie"
                    ? itemIds.has(m.fromItemId) || itemIds.has(m.toItemId)
                    : m.type === "slur"
                      ? selectedIds.has(m.fromEventId) ||
                        selectedIds.has(m.toEventId)
                      : false),
              )
              .map((m) => m.id)
          : [],
      content,
      techniques: mapped.techniques,
      totalTicks,
      omissions: mapped.effects,
    },
    track,
  );
};
export interface BeatPasteTarget {
  trackId: string;
  measureId: string;
  beatId: string;
  mode: "insert" | "overwrite";
}
export type BeatPastePlan =
  | {
      ok: true;
      track: ILXMTrack;
      nextFocus: { trackId: string; measureId: string; beatId: string };
      confirmationKey: string;
      requiresConfirmation: boolean;
      durationLabel: string;
      replacedLyrics: number;
      replacedNumbered: number;
      replacedChords: number;
      count: number;
      removedTechniques: number;
      removedNumberedMarks: number;
      replacedBeats: number;
      effects: ILXMCommandEffect[];
    }
  | { ok: false; message: string };
/** 预览与执行调用同一纯规划；确认键包含完整读取的轨道与快照，防止同 revision 分支误覆盖。 */
export const planBeatPaste = (
  document: ILXMDocument,
  target: BeatPasteTarget,
  input: unknown,
): BeatPastePlan => {
  const track = document.score.tracks.find((t) => t.id === target.trackId),
    m = track?.measures.find((m) => m.id === target.measureId),
    index = m?.beats.findIndex((b) => b.id === target.beatId) ?? -1;
  const reject = (message: string): BeatPastePlan => ({ ok: false, message });
  if (
    !track ||
    !m ||
    index < 0 ||
    !["insert", "overwrite"].includes(target.mode)
  )
    return reject("粘贴目标或模式无效。");
  const checked = validateBeatClipboard(input, track);
  if (!checked.ok) return checked;
  const c = checked.clipboard,
    context = createMeasureRhythmContext(m),
    group = context.tupletByBeatId.get(target.beatId);
  if (target.mode === "insert" && group && group.beatIds[0] !== target.beatId)
    return reject("不能插入连音组内部。");
  const factory = createDocumentIdFactory(document),
    copy = copyContent(
      c.content,
      c.techniques,
      track,
      factory,
      c.numberedVoice,
      c.numberedMarks,
    );
  const removed = new Set<string>();
  let end = index,
    requiresConfirmation = false;
  if (target.mode === "overwrite") {
    let ticks = 0;
    while (end < m.beats.length && ticks < c.totalTicks) {
      const d = context.getBeatDurationTicks(m.beats[end]!);
      if (!d.ok) return reject("目标时值无效。");
      ticks += d.ticks;
      removed.add(m.beats[end]!.id);
      end++;
    }
    if (ticks !== c.totalTicks)
      return reject("覆盖结束必须精确对齐已有拍边界，且不能超过小节。");
    if (
      m.tuplets.some(
        (g) =>
          g.beatIds.some((id) => removed.has(id)) &&
          !g.beatIds.every((id) => removed.has(id)),
      )
    )
      return reject("不能覆盖部分连音组。");
    requiresConfirmation =
      m.beats.slice(index, end).some((b) => b.kind === "notes") ||
      m.chordSymbols.some((s) => removed.has(s.beatId)) ||
      m.tuplets.some((g) => g.beatIds.some((id) => removed.has(id)));
  }
  let candidate: ILXMMeasure = {
    ...m,
    beats: [
      ...m.beats.slice(0, index),
      ...copy.measure.beats,
      ...m.beats.slice(end),
    ],
    chordSymbols: [
      ...m.chordSymbols.filter((s) => !removed.has(s.beatId)),
      ...copy.measure.chordSymbols,
    ],
    tuplets: [
      ...m.tuplets.filter((g) => !g.beatIds.some((id) => removed.has(id))),
      ...copy.measure.tuplets,
    ],
  };
  const order = new Map(candidate.beats.map((b, i) => [b.id, i]));
  candidate = {
    ...candidate,
    chordSymbols: candidate.chordSymbols.sort(
      (a, b) => order.get(a.beatId)! - order.get(b.beatId)!,
    ),
    tuplets: candidate.tuplets.sort(
      (a, b) => order.get(a.beatIds[0]!)! - order.get(b.beatIds[0]!)!,
    ),
  };
  const protectedIds = new Set([
    ...techniqueBeatIds(track),
    ...(target.mode === "insert" ? [target.beatId] : []),
    ...copy.measure.beats.map((b) => b.id),
  ]);
  // 保留受保护前缀，只消费普通尾部休止；目标容量不足直接拒绝。
  if (target.mode === "insert")
    candidate = {
      ...candidate,
      beats: candidate.beats.slice(
        0,
        getFixedPrefixLength(candidate, protectedIds),
      ),
    };
  const reconciled = reconcileMeasureTimeline(candidate, {
    createBeatId: factory.createBeatId,
    protectedBeatIds: protectedIds,
  });
  if (!reconciled.ok)
    return reject("小节剩余容量不足或时值无法精确表示，未粘贴。");
  candidate = reconciled.measure;
  let numberedRemoved = 0;
  let replacedLyrics = 0;
  if (c.layers === "both") {
    const start = m.beats[index]!.tick,
      end = start + c.totalTicks;
    const ncontext = createNumberedRhythmContext(m.numberedVoice);
    const touched = m.numberedVoice.events.filter((e) => {
      const d = ncontext.getEventDurationTicks(e);
      return (
        d.ok &&
        (target.mode === "insert"
          ? e.tick < start && e.tick + d.ticks > start
          : e.tick < end && e.tick + d.ticks > start)
      );
    });
    if (
      (target.mode === "insert" && touched.length) ||
      (target.mode === "overwrite" &&
        touched.some((e) => {
          const d = ncontext.getEventDurationTicks(e);
          return e.tick < start || !d.ok || e.tick + d.ticks > end;
        }))
    )
      return reject("目标范围不能切断简谱事件");
    const ids = new Set(touched.map((e) => e.id));
    replacedLyrics = m.lyrics.filter((lyric) => ids.has(lyric.eventId)).length;
    if (
      m.numberedVoice.tuplets.some(
        (g) =>
          g.eventIds.some((id) => ids.has(id)) &&
          !g.eventIds.every((id) => ids.has(id)),
      )
    )
      return reject("目标范围不能切断简谱连音组");
    if (
      target.mode === "insert" &&
      m.numberedVoice.tuplets.some((g) => {
        const first = m.numberedVoice.events.find(
            (e) => e.id === g.eventIds[0],
          )!,
          last = m.numberedVoice.events.find(
            (e) => e.id === g.eventIds.at(-1),
          )!;
        const d = ncontext.getEventDurationTicks(last);
        return d.ok && first.tick < start && last.tick + d.ticks > start;
      })
    )
      return reject("不能插入简谱连音组内部");
    const kept = m.numberedVoice.events
      .filter((e) => !ids.has(e.id))
      .map((e) =>
        target.mode === "insert" && e.tick >= start
          ? { ...e, tick: e.tick + c.totalTicks }
          : e,
      );
    candidate = {
      ...candidate,
      lyrics: [
        ...m.lyrics.filter((lyric) => !ids.has(lyric.eventId)),
        ...copy.measure.lyrics,
      ],
      numberedVoice: {
        events: [
          ...kept,
          ...copy.measure.numberedVoice.events.map((e) => ({
            ...e,
            tick: e.tick + start,
          })),
        ].sort((a, b) => a.tick - b.tick),
        tuplets: [
          ...m.numberedVoice.tuplets.filter(
            (g) => !g.eventIds.some((id) => ids.has(id)),
          ),
          ...copy.measure.numberedVoice.tuplets,
        ],
      },
    };
    candidate.numberedVoice.tuplets.sort(
      (a, b) =>
        candidate.numberedVoice.events.findIndex(
          (e) => e.id === a.eventIds[0],
        ) -
        candidate.numberedVoice.events.findIndex((e) => e.id === b.eventIds[0]),
    );
    const lyricOrder = new Map(
      candidate.numberedVoice.events.map((event) => [event.id, event.tick]),
    );
    candidate.lyrics.sort(
      (a, b) =>
        lyricOrder.get(a.eventId)! - lyricOrder.get(b.eventId)! ||
        a.verse - b.verse,
    );
    const error = validateNumberedVoice(
      candidate.numberedVoice,
      (m.timeSignature.numerator * 3840) / m.timeSignature.denominator,
    );
    if (error) return reject(error);
    numberedRemoved = touched.length;
    requiresConfirmation ||= numberedRemoved > 0;
  }
  const base = {
    ...track,
    measures: track.measures.map((x) => (x.id === m.id ? candidate : x)),
    techniques: track.techniques,
  };
  const kept: typeof track.techniques = [];
  const effects: ILXMCommandEffect[] = [
    ...c.omissions,
    ...collectNumberedOmissionEffects(
      document,
      track.id,
      m.id,
      c.numberedOmissions,
    ),
  ];
  let removedTechniques = 0;
  // 只清理目标既有的失效关系，副本非法/冲突一律拒绝，不按数组顺序修复。
  for (const t of track.techniques) {
    const valid = validateTechnique(base, t, t.id);
    if (valid.ok) kept.push(t);
    else {
      removedTechniques++;
      effects.push({
        kind: "technique.removed",
        trackId: track.id,
        measureId: m.id,
        measureNumber: track.measures.indexOf(m) + 1,
        techniqueId: t.id,
        techniqueType: t.type,
      });
    }
  }
  if (removedTechniques) requiresConfirmation ||= target.mode === "overwrite";
  const keptNumbered = track.numberedMarks.filter(
    (mark) => !validateNumberedMarks({ ...base, numberedMarks: [mark] }),
  );
  requiresConfirmation ||= keptNumbered.length !== track.numberedMarks.length;
  const next = {
    ...base,
    techniques: [...kept, ...copy.techniques],
    numberedMarks: [
      ...keptNumbered,
      ...(c.layers === "both" ? copy.numberedMarks : []),
    ],
  };
  const numberedMarksError = validateNumberedMarks(next);
  if (numberedMarksError) return reject(numberedMarksError);
  for (const t of next.techniques) {
    const result = validateTechnique(next, t, t.id);
    if (!result.ok) return reject(result.error.message);
  }
  // 用约分后的音乐时值表达预览，UI 不显示内部 tick，也不自行推导容量。
  let divisor: number = c.totalTicks,
    remainder: number = TICKS_PER_QUARTER;
  while (remainder) {
    const next = divisor % remainder;
    divisor = remainder;
    remainder = next;
  }
  const numerator = c.totalTicks / divisor,
    denominator = TICKS_PER_QUARTER / divisor;
  return {
    ok: true,
    track: next,
    durationLabel: `${numerator}${denominator === 1 ? "" : "/" + denominator} 个四分拍`,
    replacedLyrics,
    replacedNumbered: numberedRemoved,
    replacedChords: m.chordSymbols.filter((c) => removed.has(c.beatId)).length,
    nextFocus: {
      trackId: track.id,
      measureId: m.id,
      beatId: copy.measure.beats[0]!.id,
    },
    confirmationKey: JSON.stringify([
      {
        trackId: target.trackId,
        measureId: target.measureId,
        beatId: target.beatId,
        mode: target.mode,
      },
      track,
      c,
    ]),
    requiresConfirmation,
    count: c.content.beats.length,
    removedTechniques,
    removedNumberedMarks: track.numberedMarks.length - keptNumbered.length,
    replacedBeats: removed.size,
    effects,
  };
};
