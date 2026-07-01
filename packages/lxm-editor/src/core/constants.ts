/** 当前唯一支持的六线谱文档格式标识。 */
export const SCORE_DOCUMENT_SCHEMA = "lxm-tab-score" as const;

/** 当前文档版本；项目明确不维护旧版本迁移链。 */
export const CURRENT_SCHEMA_VERSION = 1 as const;

/** 可展示在六线谱上的基础节奏类型。 */
export const LXM_RHYTHM_BASES = [
  "whole",
  "half",
  "quarter",
  "eighth",
  "sixteenth",
  "thirtySecond",
] as const;

/** 小节线类型；用于描述小节右侧边界的常见记谱样式。 */
export const LXM_BARLINE_TYPES = [
  // 单小节线：普通小节分隔。
  "single",
  // 双小节线：段落、乐句或结构边界。
  "double",
  // 终止线：乐曲或段落结束。
  "final",
  // 起始反复线：反复段落开始。
  "repeatStart",
  // 结束反复线：反复段落结束。
  "repeatEnd",
  // 双向反复线：前一段结束并同时开启下一段反复。
  "repeatBoth",
] as const;

/** 乐器类型；当前 MVP 只描述吉他轨道。 */
export const LXM_INSTRUMENT_TYPES = ["guitar"] as const;

/** 和弦标记的展示方式。 */
export const LXM_CHORD_SYMBOL_DISPLAY_TYPES = ["nameAndDiagram"] as const;

/** 节拍内容类型；notes 表示真实音符集合。 */
export const LXM_BEAT_KINDS = ["notes"] as const;

/** 四分音符一拍的 tick 数，兼顾附点与常用二至六连音。 */
export const TICKS_PER_QUARTER = 960 as const;

/** 吉他 MVP 的固定弦数。 */
export const GUITAR_STRING_COUNT = 6 as const;

/** MVP 默认允许的最大品位。 */
export const MAX_FRET = 24 as const;

/** zundo 保存的最大历史快照数量。 */
export const HISTORY_LIMIT = 100 as const;

/** 标准调弦从 1 弦到 6 弦排列。 */
export const STANDARD_GUITAR_TUNING = [
  { index: 1, pitch: "E4", midi: 64 },
  { index: 2, pitch: "B3", midi: 59 },
  { index: 3, pitch: "G3", midi: 55 },
  { index: 4, pitch: "D3", midi: 50 },
  { index: 5, pitch: "A2", midi: 45 },
  { index: 6, pitch: "E2", midi: 40 },
] as const;
