import type {
  CURRENT_SCHEMA_VERSION,
  SCORE_DOCUMENT_SCHEMA,
  STANDARD_GUITAR_TUNING,
} from "./constants";

/** MVP 阶段支持的乐谱文档格式标识。 */
export type ILXMSchema = typeof SCORE_DOCUMENT_SCHEMA;

/** MVP 阶段支持的乐谱文档版本。 */
export type ILXMSchemaVersion = typeof CURRENT_SCHEMA_VERSION;

/** 可展示在六线谱上的基础节奏类型。 */
export const LXM_RHYTHM_BASES = [
  "whole",
  "half",
  "quarter",
  "eighth",
  "sixteenth",
  "thirtySecond",
] as const;

/** 小节线类型；当前示例只包含单小节线。 */
export const LXM_BARLINE_TYPES = ["single"] as const;

/** 乐器类型；当前 MVP 只描述吉他轨道。 */
export const LXM_INSTRUMENT_TYPES = ["guitar"] as const;

/** 和弦标记的展示方式。 */
export const LXM_CHORD_SYMBOL_DISPLAY_TYPES = ["nameAndDiagram"] as const;

/** 节拍内容类型；notes 表示真实音符集合。 */
export const LXM_BEAT_KINDS = ["notes"] as const;

export type ILXMRhythmBase = (typeof LXM_RHYTHM_BASES)[number];
export type ILXMBarlineType = (typeof LXM_BARLINE_TYPES)[number];
export type ILXMInstrumentType = (typeof LXM_INSTRUMENT_TYPES)[number];
export type ILXMChordSymbolDisplayType =
  (typeof LXM_CHORD_SYMBOL_DISPLAY_TYPES)[number];
export type ILXMBeatKind = (typeof LXM_BEAT_KINDS)[number];

/** 允许业务方扩展的普通对象元信息。 */
export type ILXMRecord = Record<string, unknown>;

/** 乐谱文档根节点。 */
export interface ILXMDocument {
  schema: ILXMSchema;
  schemaVersion: ILXMSchemaVersion;
  documentRevision: number;
  score: ILXMScore;
}

/** 乐谱主体信息。 */
export interface ILXMScore {
  id: string;
  title: string;
  meta: ILXMRecord;
  tracks: ILXMTrack[];
}

/** 单个演奏轨道，MVP 中对应一把吉他。 */
export interface ILXMTrack {
  id: string;
  name: string;
  instrument: ILXMInstrumentType;
  tuning: ILXMTuning;
  measures: ILXMMeasure[];
}

/** 弦乐器调弦信息。 */
export interface ILXMTuning {
  strings: ILXMTuningString[];
}

/** 单根弦的音高定义。 */
export interface ILXMTuningString {
  index: number;
  pitch: string;
  midi: number;
}

/** 标准吉他调弦的只读结构，可直接承接 constants 中的默认值。 */
export type ILXMStandardGuitarTuning = typeof STANDARD_GUITAR_TUNING;

/** 一个小节内包含节拍、和弦标记和小节线信息。 */
export interface ILXMMeasure {
  id: string;
  timeSignature: ILXMTimeSignature;
  barline: ILXMBarlineType;
  chordSymbols: ILXMChordSymbol[];
  beats: ILXMBeat[];
}

/** 小节拍号，例如 4/4。 */
export interface ILXMTimeSignature {
  numerator: number;
  denominator: number;
}

/** 小节内某个 tick 位置上的和弦标记。 */
export interface ILXMChordSymbol {
  id: string;
  tick: number;
  chordDefinitionId: string;
  display: ILXMChordSymbolDisplayType;
}

/** 节拍时值描述，dots 表示附点数量。 */
export interface ILXMRhythm {
  base: ILXMRhythmBase;
  dots: number;
}

/** 节拍内容，tick 表示该节拍在小节中的起始位置。 */
export interface ILXMBeat {
  id: string;
  tick: number;
  rhythm: ILXMRhythm;
  kind: ILXMBeatKind;
  notes: ILXMNote[];
}

/** 六线谱音符，string 为弦号，fret 为品位。 */
export interface ILXMNote {
  id: string;
  string: number;
  fret: number;
}

/** JSON 加载后的成功结果。 */
export interface ILXMDocumentLoadSuccess {
  ok: true;
  document: ILXMDocument;
}

/** JSON 加载失败时携带错误信息。 */
export interface ILXMDocumentLoadFailure {
  ok: false;
  errors: string[];
}

/** 文档加载函数的统一返回结构。 */
export type DocumentLoadResult =
  | ILXMDocumentLoadSuccess
  | ILXMDocumentLoadFailure;
