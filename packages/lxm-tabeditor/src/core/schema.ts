import { z } from "zod";
import {
  CURRENT_SCHEMA_VERSION,
  GUITAR_STRING_COUNT,
  MAX_FRET,
  SCORE_DOCUMENT_SCHEMA,
} from "./constants";

/** 基础时值枚举，实际 tick 由 rhythm 工具派生。 */
export const baseDurationSchema = z.enum([
  "whole", // 全音符
  "half", // 二分音符
  "quarter", // 四分音符
  "eighth", // 八分音符
  "sixteenth", // 十六分音符
  "thirtySecond", // 三十六分音符
]);

export const rhythmValueSchema = z
  .object({
    /** 基础时值名称，例如 quarter / eighth。 */
    base: baseDurationSchema,
    /** 附点数量，MVP 只支持无附点、单附点、双附点。 */
    dots: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  })
  .strict();

export const timeSignatureSchema = z
  .object({
    /** 拍号分子，表示每小节包含多少拍。 */
    numerator: z.number().int().positive().max(32),
    /** 拍号分母，表示以什么音符作为一拍。 */
    denominator: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(4),
      z.literal(8),
      z.literal(16),
      z.literal(32),
    ]),
  })
  .strict();

export const tieLinkSchema = z
  .object({
    /** 延音线连接到的目标音符 id。 */
    targetNoteId: z.string().min(1),
  })
  .strict();

const relationTechniqueSchemas = [
  "hammerOn",
  "pullOff",
  "slideUp",
  "slideDown",
].map((type) =>
  z
    .object({
      /** 技巧判别字段。 */
      type: z.literal(type as "hammerOn" | "pullOff" | "slideUp" | "slideDown"),
      /** 关系型技巧指向的另一端音符 id。 */
      targetNoteId: z.string().min(1),
    })
    .strict(),
);

/** 技巧必须使用 type 判别字段，禁止保存无法校验的松散对象。 */
export const techniqueSchema = z.discriminatedUnion("type", [
  relationTechniqueSchemas[0]!,
  relationTechniqueSchemas[1]!,
  relationTechniqueSchemas[2]!,
  relationTechniqueSchemas[3]!,
  z
    .object({
      /** 技巧判别字段。 */
      type: z.literal("bend"),
      /** 推弦目标半音数。 */
      semitones: z.number().int().positive().max(24),
      /** 是否包含回落动作。 */
      release: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      /** 技巧判别字段。 */
      type: z.literal("vibrato"),
      /** 颤音宽度。 */
      width: z.enum(["small", "medium", "wide"]).optional(),
    })
    .strict(),
  z
    .object({
      /** 技巧判别字段。 */
      type: z.literal("harmonic"),
      /** 泛音类型：自然泛音或人工泛音。 */
      harmonicType: z.enum(["natural", "artificial"]),
    })
    .strict(),
  z
    .object({
      /** 技巧判别字段。 */
      type: z.literal("palmMute"),
      /** 可选目标音符；为空时表示由页面或排版层决定作用范围。 */
      targetNoteId: z.string().min(1).optional(),
    })
    .strict(),
]);

export const tabNoteSchema = z
  .object({
    /** 音符稳定 id。 */
    id: z.string().min(1),
    /** 所在弦号，1 为最高音弦。 */
    string: z.number().int().min(1).max(GUITAR_STRING_COUNT),
    /** 品位或闷音标记 x。 */
    fret: z.union([z.number().int().min(0).max(MAX_FRET), z.literal("x")]),
    /** 直接挂在该音符上的技巧列表。 */
    techniques: z.array(techniqueSchema),
    /** 延音线连接信息。 */
    tie: tieLinkSchema.optional(),
    /** 是否作为 ghost note 渲染。 */
    ghost: z.boolean().optional(),
  })
  .strict();

const beatBaseShape = {
  /** 拍点稳定 id。 */
  id: z.string().min(1),
  /** 拍点在小节内的绝对 tick 偏移。 */
  tick: z.number().int().nonnegative(),
  /** 拍点时值定义。 */
  rhythm: rhythmValueSchema,
};

export const noteBeatSchema = z
  .object({
    ...beatBaseShape,
    /** 判别字段，表示这是音符拍。 */
    kind: z.literal("notes"),
    /** 该拍点承载的一个或多个音符。 */
    notes: z.array(tabNoteSchema).min(1),
  })
  .strict();

export const restBeatSchema = z
  .object({
    ...beatBaseShape,
    /** 判别字段，表示这是休止拍。 */
    kind: z.literal("rest"),
  })
  .strict();
export const beatSchema = z.discriminatedUnion("kind", [
  noteBeatSchema,
  restBeatSchema,
]);

export const tupletGroupSchema = z
  .object({
    /** 连音组稳定 id。 */
    id: z.string().min(1),
    /** 实际要演奏的音符数量。 */
    actualNotes: z.union([
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
    ]),
    /** 记谱上等价替代的标准音符数量。 */
    normalNotes: z.union([z.literal(2), z.literal(3), z.literal(4)]),
    /** 被此连音组覆盖的 beat id 列表。 */
    beatIds: z.array(z.string().min(1)).min(2).max(6),
    /** 是否绘制连音括号。 */
    bracket: z.enum(["auto", "show", "hide"]),
  })
  .strict();

export const lyricSegmentSchema = z
  .object({
    /** 歌词片段稳定 id。 */
    id: z.string().min(1),
    /** 歌词挂载到小节时间线中的 tick 位置。 */
    tick: z.number().int().nonnegative(),
    /** 实际显示文本。 */
    text: z.string(),
    /** 音节拆分位置，用于多音节连写排版。 */
    syllable: z.enum(["single", "begin", "middle", "end"]).optional(),
  })
  .strict();

export const chordSymbolSchema = z
  .object({
    /** 和弦符号实例 id。 */
    id: z.string().min(1),
    /** 和弦符号落在小节内的 tick 位置。 */
    tick: z.number().int().nonnegative(),
    /** 指向 chordLibrary 中定义的和弦图 id。 */
    chordDefinitionId: z.string().min(1),
    /** 覆盖默认名称的显示文本。 */
    label: z.string().min(1).optional(),
    /** 显示模式：同时显示名称和图、只显示名称、或完全隐藏。 */
    display: z.enum(["nameAndDiagram", "nameOnly", "hidden"]),
  })
  .strict();

export const chordBarreSchema = z
  .object({
    /** 横按所在品位。 */
    fret: z.number().int().min(1).max(MAX_FRET),
    /** 横按起始弦。 */
    fromString: z.number().int().min(1).max(GUITAR_STRING_COUNT),
    /** 横按结束弦。 */
    toString: z.number().int().min(1).max(GUITAR_STRING_COUNT),
    /** 推荐使用的手指标号。 */
    finger: z.number().int().min(1).max(4).optional(),
  })
  .strict();

const chordFretSchema = z.union([
  z.number().int().min(0).max(MAX_FRET),
  z.literal("x"),
]);
const chordFingerSchema = z.union([z.number().int().min(1).max(4), z.null()]);

export const chordDefinitionSchema = z
  .object({
    /** 和弦定义稳定 id。 */
    id: z.string().min(1),
    /** 和弦名称，例如 Am、Cmaj7。 */
    name: z.string().min(1),
    /** 六根弦各自的按弦品位或闷音标记。 */
    frets: z.array(chordFretSchema).length(GUITAR_STRING_COUNT),
    /** 六根弦推荐指法，null 表示该弦不按。 */
    fingers: z.array(chordFingerSchema).length(GUITAR_STRING_COUNT).optional(),
    /** 图示基准品位；为空时默认从 1 品开始。 */
    baseFret: z.number().int().min(1).max(MAX_FRET).optional(),
    /** 横按定义列表。 */
    barres: z.array(chordBarreSchema).optional(),
  })
  .strict();

export const measureSchema = z
  .object({
    /** 小节稳定 id。 */
    id: z.string().min(1),
    /** 小节内覆盖默认值的拍号；为空时继承 score.meta.timeSignature。 */
    timeSignature: timeSignatureSchema.optional(),
    /** 小节拍点序列。 */
    beats: z.array(beatSchema),
    /** 小节内定义的连音组。 */
    tuplets: z.array(tupletGroupSchema),
    /** 小节结束线类型。 */
    barline: z
      .enum(["single", "double", "final", "repeatStart", "repeatEnd"])
      .optional(),
    /** 小节内的和弦符号。 */
    chordSymbols: z.array(chordSymbolSchema),
    /** 小节内的歌词片段。 */
    lyrics: z.array(lyricSegmentSchema),
    /** 是否为弱起小节。 */
    pickup: z.boolean().optional(),
  })
  .strict();

export const guitarStringSchema = z
  .object({
    /** 弦序号，1 为最高音弦。 */
    index: z.number().int().min(1).max(GUITAR_STRING_COUNT),
    /** 音名八度表示法，例如 E4、B3。 */
    pitch: z.string().regex(/^[A-G](?:#|b)?-?\d+$/),
    /** 对应 MIDI 音高。 */
    midi: z.number().int().min(0).max(127),
  })
  .strict();

export const trackSchema = z
  .object({
    /** 轨道稳定 id。 */
    id: z.string().min(1),
    /** 轨道显示名称。 */
    name: z.string().min(1),
    /** 乐器类型；当前 MVP 固定为 guitar。 */
    instrument: z.literal("guitar"),
    tuning: z
      .object({
        /** 从高音弦到低音弦的定弦配置。 */
        strings: z.array(guitarStringSchema).length(GUITAR_STRING_COUNT),
      })
      .strict(),
    /** 轨道包含的小节序列。 */
    measures: z.array(measureSchema),
  })
  .strict();

export const scoreSchema = z
  .object({
    /** 乐谱稳定 id。 */
    id: z.string().min(1),
    /** 乐谱标题。 */
    title: z.string(),
    meta: z
      .object({
        /** 全局默认速度，单位 BPM。 */
        tempo: z.number().int().min(20).max(400),
        /** 全局默认拍号。 */
        timeSignature: timeSignatureSchema,
        /** 调号文本表示。 */
        keySignature: z.string().optional(),
        /** 变调夹品位。 */
        capo: z.number().int().min(0).max(MAX_FRET).optional(),
      })
      .strict(),
    /** 乐谱包含的演奏轨道；当前至少一条。 */
    tracks: z.array(trackSchema).min(1),
    /** 供和弦符号引用的和弦定义库。 */
    chordLibrary: z.array(chordDefinitionSchema),
  })
  .strict();

export const lxmScoreDocumentSchema = z
  .object({
    /** 文档格式标识，用于区分不同持久化协议。 */
    schema: z.literal(SCORE_DOCUMENT_SCHEMA),
    /** 文档 schema 版本号。 */
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    /** 文档修订号，用于持久化层对比版本。 */
    documentRevision: z.number().int().nonnegative(),
    /** 实际乐谱内容。 */
    score: scoreSchema,
  })
  .strict();

export type BaseDuration = z.infer<typeof baseDurationSchema>;
export type RhythmValue = z.infer<typeof rhythmValueSchema>;
export type TimeSignature = z.infer<typeof timeSignatureSchema>;
export type TieLink = z.infer<typeof tieLinkSchema>;
export type Technique = z.infer<typeof techniqueSchema>;
export type TabNote = z.infer<typeof tabNoteSchema>;
export type NoteBeat = z.infer<typeof noteBeatSchema>;
export type RestBeat = z.infer<typeof restBeatSchema>;
export type Beat = z.infer<typeof beatSchema>;
export type TupletGroup = z.infer<typeof tupletGroupSchema>;
export type LyricSegment = z.infer<typeof lyricSegmentSchema>;
export type ChordSymbol = z.infer<typeof chordSymbolSchema>;
export type ChordBarre = z.infer<typeof chordBarreSchema>;
export type ChordDefinition = z.infer<typeof chordDefinitionSchema>;
export type Measure = z.infer<typeof measureSchema>;
export type GuitarString = z.infer<typeof guitarStringSchema>;
export type Track = z.infer<typeof trackSchema>;
export type Score = z.infer<typeof scoreSchema>;
export type LxmScoreDocument = z.infer<typeof lxmScoreDocumentSchema>;
export type EditorMode = "select" | "note" | "technique" | "lyrics" | "chord";
