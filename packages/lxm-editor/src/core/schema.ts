import { z } from "zod";
import { normalizeMusicText } from "./music-text";
import { validateChordDiagram } from "./chord-diagram";

import {
  CURRENT_SCHEMA_VERSION,
  GUITAR_STRING_COUNT,
  LXM_BARLINE_TYPES,
  LXM_TUPLET_RATIOS,
  LXM_BEAT_KINDS,
  LXM_CHORD_SYMBOL_DISPLAY_TYPES,
  LXM_INSTRUMENT_TYPES,
  LXM_RHYTHM_BASES,
  LXM_STROKE_DIRECTIONS,
  LXM_ARPEGGIO_DIRECTIONS,
  LXM_TRACK_START_BARLINE_TYPES,
  MAX_FRET,
  SCORE_DOCUMENT_SCHEMA,
} from "./constants";
import {
  type ILXMBeat,
  type ILXMTuplet,
  type ILXMChordSymbol,
  type ILXMDocument,
  type ILXMMeasure,
  type ILXMNote,
  type ILXMRhythm,
  type ILXMScore,
  type ILXMTimeSignature,
  type ILXMTechnique,
  type ILXMTuning,
  type ILXMTuningString,
  type ILXMTrack,
} from "./types";

const MIN_POSITIVE_INTEGER = 1;
const MIN_NON_NEGATIVE_INTEGER = 0;
const MIDI_MIN_VALUE = 0;
const MIDI_MAX_VALUE = 127;
const MIN_TIME_SIGNATURE_DENOMINATOR = 1;
const MAX_TIME_SIGNATURE_DENOMINATOR = 64;
const MIN_GUITAR_STRING_INDEX = 1;
const MAX_CAPO = 12;

/** 可扩展元信息只要求是普通对象，不限制业务侧字段。 */
export const LXMRecordSchema = z.record(z.unknown());

/** 单根弦的音高定义校验。 */
export const LXMTuningStringSchema = z
  .object({
    index: z.number().int().min(MIN_GUITAR_STRING_INDEX),
    pitch: z.string(),
    midi: z.number().int().min(MIDI_MIN_VALUE).max(MIDI_MAX_VALUE),
  })
  .strict() satisfies z.ZodType<ILXMTuningString>;

/** 弦乐器调弦信息校验。 */
export const LXMTuningSchema = z
  .object({
    strings: z.array(LXMTuningStringSchema).length(GUITAR_STRING_COUNT),
  })
  .strict()
  .superRefine((tuning, context) => {
    tuning.strings.forEach((string, index) => {
      if (string.index !== index + 1)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["strings", index, "index"],
          message: "弦索引必须按 1 到 6 顺序排列",
        });
    });
  }) satisfies z.ZodType<ILXMTuning>;

/** 小节拍号校验，例如 4/4。 */
export const LXMTimeSignatureSchema = z
  .object({
    numerator: z.number().int().min(MIN_POSITIVE_INTEGER),
    denominator: z
      .number()
      .int()
      .min(MIN_TIME_SIGNATURE_DENOMINATOR)
      .max(MAX_TIME_SIGNATURE_DENOMINATOR),
  })
  .strict() satisfies z.ZodType<ILXMTimeSignature>;

/** 文本字段必须已规范化；加载时不静默改变用户数据。 */
const musicTextSchema = (limit: number) =>
  z
    .string()
    .refine(
      (text) => normalizeMusicText(text, limit) === text,
      `文本须为规范化的单行非空文字，最多 ${limit} 个字符`,
    );
const fingerSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);
export const LXMChordDiagramSchema = z
  .object({
    startFret: z.number().int().min(1).max(20),
    fretCount: z.literal(5),
    strings: z
      .array(
        z
          .object({
            string: z.union([
              z.literal(1),
              z.literal(2),
              z.literal(3),
              z.literal(4),
              z.literal(5),
              z.literal(6),
            ]),
            fret: z.union([z.literal("x"), z.number().int().min(0).max(24)]),
            finger: fingerSchema.nullable(),
          })
          .strict(),
      )
      .length(6),
    barres: z
      .array(
        z
          .object({
            fret: z.number().int().min(1).max(24),
            minString: z.number().int().min(1).max(6),
            maxString: z.number().int().min(1).max(6),
            finger: fingerSchema,
          })
          .strict(),
      )
      .max(4),
  })
  .strict()
  .superRefine((diagram, context) => {
    const message = validateChordDiagram(diagram);
    if (message) context.addIssue({ code: z.ZodIssueCode.custom, message });
  });
export const LXMLyricSchema = z
  .object({
    id: z.string(),
    beatId: z.string(),
    verse: fingerSchema,
    text: musicTextSchema(64),
  })
  .strict();
/** 和弦保存局部名称/图快照，不依赖未定义的外部字典。 */
export const LXMChordSymbolSchema = z
  .object({
    id: z.string(),
    beatId: z.string(),
    display: z.enum(LXM_CHORD_SYMBOL_DISPLAY_TYPES),
    chord: z
      .object({
        name: musicTextSchema(32),
        diagram: LXMChordDiagramSchema.nullable(),
      })
      .strict(),
  })
  .strict()
  .refine(
    (s) => s.display === "name" || s.chord.diagram !== null,
    "名称加图模式需要指法图",
  ) satisfies z.ZodType<ILXMChordSymbol>;

/** 节拍时值描述校验，dots 表示附点数量。 */
export const LXMRhythmSchema = z
  .object({
    base: z.enum(LXM_RHYTHM_BASES),
    dots: z.number().int().min(MIN_NON_NEGATIVE_INTEGER),
  })
  .strict() satisfies z.ZodType<ILXMRhythm>;

/** 六线谱音符校验，string 为弦号，fret 为品位。 */
export const LXMNoteSchema = z
  .object({
    id: z.string(),
    string: z.number().int().min(MIN_GUITAR_STRING_INDEX),
    fret: z.union([
      z.literal("x"),
      z.number().int().min(MIN_NON_NEGATIVE_INTEGER).max(MAX_FRET),
    ]),
  })
  .strict() satisfies z.ZodType<ILXMNote>;

/**
 * 技巧 schema 与 TypeScript 判别联合保持同构。
 *
 * 每个成员都使用 strict，确保例如 strum 不会意外携带 fromNoteId，或单音技巧
 * 混入 beatId。引用是否存在、两端是否同弦等跨实体规则交给语义校验处理。
 */
export const LXMTechniqueSchema = z.discriminatedUnion("type", [
  z
    .object({
      id: z.string(),
      type: z.literal("bend"),
      fromNoteId: z.string(),
      semitones: z.literal(2),
    })
    .strict(),
  ...(
    ["vibrato", "naturalHarmonic", "artificialHarmonic", "tapping"] as const
  ).map((type) =>
    z
      .object({ id: z.string(), type: z.literal(type), fromNoteId: z.string() })
      .strict(),
  ),
  z
    .object({
      id: z.string(),
      type: z.literal("trill"),
      fromNoteId: z.string(),
      auxiliaryFret: z.number().int().min(0).max(MAX_FRET),
    })
    .strict(),
  ...(["hammerOn", "pullOff", "slideUp", "slideDown", "tie"] as const).map(
    (type) =>
      z
        .object({
          id: z.string(),
          type: z.literal(type),
          fromNoteId: z.string(),
          toNoteId: z.string(),
        })
        .strict(),
  ),
  z
    .object({
      id: z.string(),
      type: z.literal("strum"),
      beatId: z.string(),
      minString: z.number().int().min(1).max(GUITAR_STRING_COUNT),
      maxString: z.number().int().min(1).max(GUITAR_STRING_COUNT),
      stroke: z.enum(LXM_STROKE_DIRECTIONS),
    })
    .strict(),
  z
    .object({
      id: z.string(),
      type: z.literal("arpeggio"),
      beatId: z.string(),
      minString: z.number().int().min(1).max(GUITAR_STRING_COUNT),
      maxString: z.number().int().min(1).max(GUITAR_STRING_COUNT),
      direction: z.enum(LXM_ARPEGGIO_DIRECTIONS),
    })
    .strict(),
  z
    .object({
      id: z.string(),
      type: z.literal("pickStroke"),
      beatId: z.string(),
      stroke: z.enum(LXM_STROKE_DIRECTIONS),
    })
    .strict(),
  ...(["palmMute", "letRing"] as const).map((type) =>
    z
      .object({
        id: z.string(),
        type: z.literal(type),
        fromBeatId: z.string(),
        toBeatId: z.string(),
      })
      .strict(),
  ),
]) satisfies z.ZodType<ILXMTechnique>;

/** 节拍内容校验，tick 表示该节拍在小节中的起始位置。 */
export const LXMBeatSchema = z
  .object({
    id: z.string(),
    tick: z.number().int().min(MIN_NON_NEGATIVE_INTEGER),
    rhythm: LXMRhythmSchema,
    kind: z.enum(LXM_BEAT_KINDS),
    notes: z.array(LXMNoteSchema),
  })
  .strict() satisfies z.ZodType<ILXMBeat>;

/** 严格比例联合，拒绝未支持比例及附加字段。 */
const ratioSchema = <A extends number, N extends number>(
  actual: A,
  normal: N,
) =>
  z.object({ actual: z.literal(actual), normal: z.literal(normal) }).strict();
export const LXMTupletRatioSchema = z.union([
  ratioSchema(LXM_TUPLET_RATIOS[0].actual, LXM_TUPLET_RATIOS[0].normal),
  ratioSchema(LXM_TUPLET_RATIOS[1].actual, LXM_TUPLET_RATIOS[1].normal),
  ratioSchema(LXM_TUPLET_RATIOS[2].actual, LXM_TUPLET_RATIOS[2].normal),
  ratioSchema(LXM_TUPLET_RATIOS[3].actual, LXM_TUPLET_RATIOS[3].normal),
  ratioSchema(LXM_TUPLET_RATIOS[4].actual, LXM_TUPLET_RATIOS[4].normal),
  ratioSchema(LXM_TUPLET_RATIOS[5].actual, LXM_TUPLET_RATIOS[5].normal),
]) satisfies z.ZodType<ILXMTuplet["ratio"]>;
export const LXMTupletSchema = z
  .object({
    id: z.string(),
    beatIds: z.array(z.string()),
    ratio: LXMTupletRatioSchema,
  })
  .strict() satisfies z.ZodType<ILXMTuplet>;

/** 一个小节内包含节拍、和弦标记和小节线信息。 */
export const LXMMeasureSchema = z
  .object({
    id: z.string(),
    timeSignature: LXMTimeSignatureSchema,
    barline: z.enum(LXM_BARLINE_TYPES),
    chordSymbols: z.array(LXMChordSymbolSchema),
    lyrics: z.array(LXMLyricSchema),
    beats: z.array(LXMBeatSchema),
    tuplets: z.array(LXMTupletSchema),
    sectionLabel: z.string().max(32).optional(),
  })
  .strict() satisfies z.ZodType<ILXMMeasure>;

/** 单个演奏轨道校验，MVP 中对应一把吉他。 */
export const LXMTrackSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    instrument: z.enum(LXM_INSTRUMENT_TYPES),
    tuning: LXMTuningSchema,
    capo: z.number().int().min(0).max(MAX_CAPO),
    startBarline: z.enum(LXM_TRACK_START_BARLINE_TYPES),
    measures: z.array(LXMMeasureSchema),
    techniques: z.array(LXMTechniqueSchema),
  })
  .strict() satisfies z.ZodType<ILXMTrack>;

/** 乐谱主体信息校验。 */
export const LXMScoreSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    meta: LXMRecordSchema,
    tracks: z.array(LXMTrackSchema),
  })
  .strict() satisfies z.ZodType<ILXMScore>;

/** 乐谱文档根节点校验。 */
export const LXMDocumentSchema = z
  .object({
    schema: z.literal(SCORE_DOCUMENT_SCHEMA),
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    documentRevision: z.number().int().min(MIN_POSITIVE_INTEGER),
    score: LXMScoreSchema,
  })
  .strict() satisfies z.ZodType<ILXMDocument>;
