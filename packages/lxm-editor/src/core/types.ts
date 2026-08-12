import type {
  CURRENT_SCHEMA_VERSION,
  LXM_BARLINE_TYPES,
  LXM_BEAT_KINDS,
  LXM_CHORD_SYMBOL_DISPLAY_TYPES,
  LXM_INSTRUMENT_TYPES,
  LXM_RHYTHM_BASES,
  LXM_STROKE_DIRECTIONS,
  LXM_ARPEGGIO_DIRECTIONS,
  LXM_TECHNIQUE_TYPES,
  LXM_TRACK_START_BARLINE_TYPES,
  SCORE_DOCUMENT_SCHEMA,
  STANDARD_GUITAR_TUNING,
} from "./constants";

/** MVP 阶段支持的乐谱文档格式标识。 */
export type ILXMSchema = typeof SCORE_DOCUMENT_SCHEMA;

/** MVP 阶段支持的乐谱文档版本。 */
export type ILXMSchemaVersion = typeof CURRENT_SCHEMA_VERSION;

export type ILXMRhythmBase = (typeof LXM_RHYTHM_BASES)[number];
export type ILXMBarlineType = (typeof LXM_BARLINE_TYPES)[number];
export type ILXMTrackStartBarlineType =
  (typeof LXM_TRACK_START_BARLINE_TYPES)[number];
export type ILXMInstrumentType = (typeof LXM_INSTRUMENT_TYPES)[number];
export type ILXMChordSymbolDisplayType =
  (typeof LXM_CHORD_SYMBOL_DISPLAY_TYPES)[number];
export type ILXMBeatKind = (typeof LXM_BEAT_KINDS)[number];
export type ILXMTechniqueType = (typeof LXM_TECHNIQUE_TYPES)[number];
export type ILXMStrokeDirection = (typeof LXM_STROKE_DIRECTIONS)[number];
export type ILXMArpeggioDirection =
  (typeof LXM_ARPEGGIO_DIRECTIONS)[number];

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
  /** 第一小节之前的谱首边界；普通谱面使用 none。 */
  startBarline: ILXMTrackStartBarlineType;
  measures: ILXMMeasure[];
  /**
   * 吉他技巧独立于 Note/Beat 保存，引用稳定业务 ID。
   *
   * 这样跨小节、跨 system 的技巧只有一个领域事实来源；自动换行仅在 layout
   * 中把它拆成多个视觉 segment，不会把临时坐标或分段写回文档。
   */
  techniques: ILXMTechnique[];
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
  /** 该小节之后的结构边界。 */
  barline: ILXMBarlineType;
  chordSymbols: ILXMChordSymbol[];
  beats: ILXMBeat[];
}

/** 小节拍号，例如 4/4。 */
export interface ILXMTimeSignature {
  numerator: number;
  denominator: number;
}

/**
 * 拍号命令的作用范围。
 *
 * measure 用于只改变一个小节；untilNextChange 用于从当前小节建立一个持续的
 * 拍号段落，并在命令执行前已经存在的下一个拍号变化点停止。
 */
export type ILXMTimeSignatureChangeScope = "measure" | "untilNextChange";

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

/**
 * MVP v5 技巧判别联合。
 *
 * - 单音与连接技巧引用 Note；
 * - 扫弦、琶音和拨片方向引用一个完整 Beat；
 * - P.M. 与 Let Ring 引用 Beat 区间。
 *
 * 把三种目标形态写进类型 interface，可阻止页面把“扫弦”错误绑定到和弦中的
 * 任意一颗 Note，也避免区间技巧在多根弦上重复存储相同关系。
 */
export type ILXMTechnique =
  | {
      id: string;
      type: "bend";
      fromNoteId: string;
      /** MVP 首版固定为全音推弦，保留参数便于后续扩展半音等档位。 */
      semitones: 2;
    }
  | {
      id: string;
      type:
        | "vibrato"
        | "naturalHarmonic"
        | "artificialHarmonic"
        | "tapping";
      fromNoteId: string;
    }
  | {
      id: string;
      type: "trill";
      fromNoteId: string;
      auxiliaryFret: number;
    }
  | {
      id: string;
      type: "hammerOn" | "pullOff" | "slideUp" | "slideDown" | "tie";
      fromNoteId: string;
      toNoteId: string;
    }
  | {
      id: string;
      type: "strum";
      beatId: string;
      stroke: ILXMStrokeDirection;
    }
  | {
      id: string;
      type: "arpeggio";
      beatId: string;
      direction: ILXMArpeggioDirection;
    }
  | {
      id: string;
      type: "pickStroke";
      beatId: string;
      stroke: ILXMStrokeDirection;
    }
  | {
      id: string;
      type: "palmMute" | "letRing";
      fromBeatId: string;
      toBeatId: string;
    };

/** 分布式 Omit 保留判别联合的每一个成员，供新增/修改命令接收无 ID 草稿。 */
export type ILXMTechniqueDraft = ILXMTechnique extends infer Technique
  ? Technique extends ILXMTechnique
    ? Omit<Technique, "id">
    : never
  : never;

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
