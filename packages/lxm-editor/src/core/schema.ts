import { z } from "zod";

import {
  CURRENT_SCHEMA_VERSION,
  LXM_BARLINE_TYPES,
  LXM_BEAT_KINDS,
  LXM_CHORD_SYMBOL_DISPLAY_TYPES,
  LXM_INSTRUMENT_TYPES,
  LXM_RHYTHM_BASES,
  MAX_FRET,
  SCORE_DOCUMENT_SCHEMA,
} from "./constants";
import {
  type ILXMBeat,
  type ILXMChordSymbol,
  type ILXMDocument,
  type ILXMMeasure,
  type ILXMNote,
  type ILXMRhythm,
  type ILXMScore,
  type ILXMTimeSignature,
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
    strings: z.array(LXMTuningStringSchema).min(MIN_POSITIVE_INTEGER),
  })
  .strict() satisfies z.ZodType<ILXMTuning>;

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

/** 小节内某个 tick 位置上的和弦标记校验。 */
export const LXMChordSymbolSchema = z
  .object({
    id: z.string(),
    tick: z.number().int().min(MIN_NON_NEGATIVE_INTEGER),
    chordDefinitionId: z.string(),
    display: z.enum(LXM_CHORD_SYMBOL_DISPLAY_TYPES),
  })
  .strict() satisfies z.ZodType<ILXMChordSymbol>;

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
    fret: z.number().int().min(MIN_NON_NEGATIVE_INTEGER).max(MAX_FRET),
  })
  .strict() satisfies z.ZodType<ILXMNote>;

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

/** 一个小节内包含节拍、和弦标记和小节线信息。 */
export const LXMMeasureSchema = z
  .object({
    id: z.string(),
    timeSignature: LXMTimeSignatureSchema,
    barline: z.enum(LXM_BARLINE_TYPES),
    chordSymbols: z.array(LXMChordSymbolSchema),
    beats: z.array(LXMBeatSchema),
  })
  .strict() satisfies z.ZodType<ILXMMeasure>;

/** 单个演奏轨道校验，MVP 中对应一把吉他。 */
export const LXMTrackSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    instrument: z.enum(LXM_INSTRUMENT_TYPES),
    tuning: LXMTuningSchema,
    measures: z.array(LXMMeasureSchema),
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
