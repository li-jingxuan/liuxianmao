/**
 * TAB 单元格矩形选区。
 *
 * 这个模块只处理稳定业务 ID 和文档顺序，不读取 system 换行或 SVG 坐标。这样同一
 * 个选区在页面重新排版后仍指向相同的 Beat/string，也能被核心命令直接复用。
 */
import { GUITAR_STRING_COUNT } from "../core/constants";
import type { ILXMDocument, ILXMTrack } from "../core/types";

/** 单次命令允许展开的最大单元格数，防止误选导致同步编辑耗时不可控。 */
export const MAX_TAB_CELL_RANGE_CELLS = 512;
/** 单次 Beat 状态命令的安全上限；与弦宽无关。 */
export const MAX_BEAT_RANGE_BEATS = 512;

/** Beat 范围端点只保存稳定业务 ID，不携带弦或布局信息。 */
export interface ILXMBeatReference {
  measureId: string;
  beatId: string;
}

export interface ILXMBeatRange {
  trackId: string;
  anchor: ILXMBeatReference;
  focus: ILXMBeatReference;
}

/** 一个 TAB 单元格的稳定业务引用；视觉 systemIndex 明确不属于持久引用。 */
export interface ILXMTabCellReference {
  trackId: string;
  measureId: string;
  beatId: string;
  string: number;
}

/** anchor 在 Shift 扩展期间保持不变，focus 表示当前活动单元格。 */
export interface ILXMTabCellSelection {
  anchor: ILXMTabCellReference;
  focus: ILXMTabCellReference;
}

/** Beat 在指定轨道中的规范文档顺序信息。 */
export interface ILXMOrderedBeat {
  trackId: string;
  measureId: string;
  measureIndex: number;
  beatId: string;
  beatIndex: number;
}

/** 已规范化的连续 Beat × 连续弦矩形。 */
export interface ILXMResolvedTabCellRange {
  trackId: string;
  beats: ILXMOrderedBeat[];
  startString: number;
  endString: number;
  cellCount: number;
}

export interface ILXMResolvedBeatRange {
  trackId: string;
  beats: ILXMOrderedBeat[];
}

export type ILXMResolveBeatRangeResult =
  | { ok: true; range: ILXMResolvedBeatRange }
  | {
      ok: false;
      code: "INVALID_BEAT_RANGE" | "BEAT_RANGE_TOO_LARGE";
      message: string;
    };

export type ILXMResolveTabCellSelectionErrorCode =
  | "INVALID_TAB_CELL_RANGE"
  | "TAB_CELL_RANGE_TOO_LARGE";

export type ILXMResolveTabCellSelectionResult =
  | { ok: true; range: ILXMResolvedTabCellRange }
  | {
      ok: false;
      code: ILXMResolveTabCellSelectionErrorCode;
      message: string;
    };

/**
 * 按 measure 数组顺序、再按 tick 排序 Beat。
 *
 * beatIndex 是排序后的局部下标，而不是原数组下标。语义校验通常保证二者一致，
 * 这里仍显式排序，使选择与布局共用“时间顺序”契约且不修改输入数组。
 */
export const buildOrderedBeatIndex = (track: ILXMTrack): ILXMOrderedBeat[] =>
  track.measures.flatMap((measure, measureIndex) =>
    [...measure.beats]
      .sort((left, right) => left.tick - right.tick)
      .map((beat, beatIndex) => ({
        trackId: track.id,
        measureId: measure.id,
        measureIndex,
        beatId: beat.id,
        beatIndex,
      })),
  );

const isValidString = (string: number): boolean =>
  Number.isInteger(string) && string >= 1 && string <= GUITAR_STRING_COUNT;

const invalidRange = (message: string): ILXMResolveTabCellSelectionResult => ({
  ok: false,
  code: "INVALID_TAB_CELL_RANGE",
  message,
});

/** 按稳定端点解析与拖动方向无关的连续 Beat 范围。 */
export const resolveBeatRange = (
  document: ILXMDocument,
  range: ILXMBeatRange,
): ILXMResolveBeatRangeResult => {
  const track = document.score.tracks.find(
    (candidate) => candidate.id === range.trackId,
  );
  if (!track)
    return {
      ok: false,
      code: "INVALID_BEAT_RANGE",
      message: "Beat 选区的目标轨道不存在",
    };

  const orderedBeats = buildOrderedBeatIndex(track);
  const findEndpoint = (reference: ILXMBeatReference) =>
    orderedBeats.findIndex(
      (beat) =>
        beat.measureId === reference.measureId &&
        beat.beatId === reference.beatId,
    );
  const anchorIndex = findEndpoint(range.anchor);
  const focusIndex = findEndpoint(range.focus);
  if (anchorIndex < 0 || focusIndex < 0)
    return {
      ok: false,
      code: "INVALID_BEAT_RANGE",
      message: "Beat 选区端点不存在",
    };

  const beats = orderedBeats.slice(
    Math.min(anchorIndex, focusIndex),
    Math.max(anchorIndex, focusIndex) + 1,
  );
  if (beats.length > MAX_BEAT_RANGE_BEATS)
    return {
      ok: false,
      code: "BEAT_RANGE_TOO_LARGE",
      message: `Beat 选区最多包含 ${MAX_BEAT_RANGE_BEATS} 个 Beat`,
    };

  return { ok: true, range: { trackId: track.id, beats } };
};

/**
 * 将任意拖动方向的 anchor/focus 规范化为可供命令和布局消费的矩形。
 *
 * 错误检查顺序是稳定契约：先验证端点与轨道，再计算矩形大小；因此只有两个合法
 * 端点实际形成超大矩形时才返回 TAB_CELL_RANGE_TOO_LARGE。
 */
export const resolveTabCellSelection = (
  document: ILXMDocument,
  selection: ILXMTabCellSelection,
): ILXMResolveTabCellSelectionResult => {
  const { anchor, focus } = selection;
  if (anchor.trackId !== focus.trackId)
    return invalidRange("TAB 单元格选区不能跨轨道");
  if (!isValidString(anchor.string) || !isValidString(focus.string))
    return invalidRange("TAB 单元格弦号必须在 1 到 6 之间");

  const track = document.score.tracks.find(
    (candidate) => candidate.id === anchor.trackId,
  );
  if (!track) return invalidRange("TAB 单元格选区的目标轨道不存在");

  const orderedBeats = buildOrderedBeatIndex(track);
  const anchorIndex = orderedBeats.findIndex(
    (beat) =>
      beat.measureId === anchor.measureId && beat.beatId === anchor.beatId,
  );
  const focusIndex = orderedBeats.findIndex(
    (beat) =>
      beat.measureId === focus.measureId && beat.beatId === focus.beatId,
  );
  if (anchorIndex < 0 || focusIndex < 0)
    return invalidRange("TAB 单元格选区的 Beat 端点不存在");

  const startBeatIndex = Math.min(anchorIndex, focusIndex);
  const endBeatIndex = Math.max(anchorIndex, focusIndex);
  const startString = Math.min(anchor.string, focus.string);
  const endString = Math.max(anchor.string, focus.string);
  const beats = orderedBeats.slice(startBeatIndex, endBeatIndex + 1);
  const cellCount = beats.length * (endString - startString + 1);

  if (cellCount > MAX_TAB_CELL_RANGE_CELLS)
    return {
      ok: false,
      code: "TAB_CELL_RANGE_TOO_LARGE",
      message: `TAB 单元格选区最多包含 ${MAX_TAB_CELL_RANGE_CELLS} 个单元格`,
    };

  return {
    ok: true,
    range: {
      trackId: track.id,
      beats,
      startString,
      endString,
      cellCount,
    },
  };
};

/** 从文档中取得首个合法单元格，供初始化及历史恢复后的安全回退使用。 */
export const getFirstTabCellReference = (
  document: ILXMDocument,
): ILXMTabCellReference | null => {
  for (const track of document.score.tracks) {
    const firstBeat = buildOrderedBeatIndex(track)[0];
    if (firstBeat)
      return {
        trackId: track.id,
        measureId: firstBeat.measureId,
        beatId: firstBeat.beatId,
        string: 1,
      };
  }
  return null;
};

/** 将单元格引用转换为折叠选区，减少页面层重复组装 anchor/focus。 */
export const createCollapsedTabCellSelection = (
  reference: ILXMTabCellReference,
): ILXMTabCellSelection => ({ anchor: reference, focus: reference });
