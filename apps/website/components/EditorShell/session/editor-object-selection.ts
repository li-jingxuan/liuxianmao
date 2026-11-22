import {
  hitTestLayout,
  hitTestMusicText,
  hitTestNumbered,
  hitTestNumberedMark,
  hitTestTechniqueTarget,
  hitTestTuplet,
  resolveTabCellSelection,
  resolveTechniqueSelection,
  LXMScoreCommandEnum as C,
  type ILXMDocument,
  type ILXMHitTarget,
  type ILXMLayout,
  type ILXMTabCellReference,
  type ILXMTabCellSelection,
  type ILXMScoreCommand,
} from "@liuxianmao/lxm-editor";
import type { SidebarAction } from "../music-text/music-text-draft";

/** 选区只保留稳定业务 ID。 */
const toCellReference = ({ trackId, measureId, beatId, string }: ILXMHitTarget): ILXMTabCellReference =>
  ({ trackId, measureId, beatId, string });

const isChordTraversal = (document: ILXMDocument, trackId: string, techniqueId: string) =>
  document.score.tracks.find((track) => track.id === trackId)?.techniques.some((technique) =>
    technique.id === techniqueId && (technique.type === "strum" || technique.type === "arpeggio"));

/** 拖动优先命中弦格，扫弦/琶音伸出谱表的端点也可作为弦格。 */
export const hitTestTabRangeCell = (
  document: ILXMDocument,
  layout: ILXMLayout,
  point: { x: number; y: number },
): ILXMTabCellReference | null => {
  const cell = hitTestLayout(layout, point);
  if (cell) return toCellReference(cell);
  const technique = hitTestTechniqueTarget(layout, point);
  return technique && isChordTraversal(document, layout.trackId, technique.techniqueId)
    ? resolveTechniqueSelection(document, technique.techniqueId, technique.focusEndpoint)?.focus ?? null
    : null;
};

/** 命中对象决定动作，不接收侧栏页签；技巧和连音标注优先于 TAB 弦格。 */
export const resolveScorePointerAction = (
  document: ILXMDocument,
  layout: ILXMLayout,
  point: { x: number; y: number },
  selection: ILXMTabCellSelection | null,
  extend: boolean,
): SidebarAction | null => {
  const numberedMark = hitTestNumberedMark(layout, point);
  if (numberedMark)
    return {
      type: "target",
      numberedMarkId: numberedMark.markId,
      target: { ...numberedMark.target, kind: "numbered" },
    };
  const numbered = hitTestNumbered(layout, point);
  if (numbered)
    return { type: "target", target: { ...numbered, kind: "numbered" } };
  const text = hitTestMusicText(layout, point);
  if (text?.kind === "chord" && text.beatId)
    return {
      type: "target",
      target: {
        trackId: text.trackId,
        measureId: text.measureId,
        beatId: text.beatId,
        kind: "chord",
        string: selection?.focus.string ?? 1,
      },
    };
  if (text?.kind === "lyric" && (text.eventId || text.tick !== undefined))
    return {
      type: "target",
      target: {
        trackId: text.trackId,
        measureId: text.measureId,
        ...(text.eventId
          ? { eventId: text.eventId }
          : { tick: text.tick, endTick: text.endTick }),
        kind: "lyric",
        verse: text.verse,
        string: selection?.focus.string ?? 1,
      },
    };
  const technique = hitTestTechniqueTarget(layout, point);
  if (technique) {
    const mapped = resolveTechniqueSelection(document, technique.techniqueId, technique.focusEndpoint);
    if (mapped && isChordTraversal(document, layout.trackId, technique.techniqueId)) {
      const hit = hitTestLayout(layout, point);
      const target = hit?.beatId === mapped.focus.beatId ? toCellReference(hit) : mapped.focus;
      if (extend && selection)
        return { type: "selection", selection: { anchor: selection.anchor, focus: target } };
      return { type: "selection", techniqueId: technique.techniqueId, selection: mapped, dragAnchor: target };
    }
    return {
      type: "selection",
      techniqueId: technique.techniqueId,
      selection: mapped,
    };
  }
  const tuplet = hitTestTuplet(layout, point);
  if (tuplet?.beatIds.length) {
    const target = {
      trackId: tuplet.trackId,
      measureId: tuplet.measureId,
      string: selection?.focus.string ?? 1,
    };
    return {
      type: "selection",
      startDrag: false,
      selection: {
        anchor: { ...target, beatId: tuplet.beatIds[0]! },
        focus: { ...target, beatId: tuplet.beatIds.at(-1)! },
      },
    };
  }
  const hit = hitTestLayout(layout, point);
  if (!hit) return extend ? null : { type: "selection", selection: null };
  const target = toCellReference(hit);
  return {
    type: "selection",
    selection: {
      anchor: extend && selection ? selection.anchor : target,
      focus: target,
    },
  };
};

/** 草稿应用可能改变布局，接受待选区前用最新文档验证 ID，不能重新命中旧像素。 */
export const isScoreSelectionValid = (
  document: ILXMDocument | null,
  selection: ILXMTabCellSelection | null,
): boolean =>
  !!document && (!selection || resolveTabCellSelection(document, selection).ok);

export type SelectionRequestResult = "accepted" | "pending" | "blocked";

/** 技巧映射的 TAB 区间仅用于定位；对象被选中时删除不能落到该区间的音符。 */
export const resolveScoreDeleteCommand = (
  document: ILXMDocument,
  selection: ILXMTabCellSelection | null,
  selectedTechniqueId: string | null,
): ILXMScoreCommand | null => {
  if (selectedTechniqueId) {
    const track = document.score.tracks.find((item) =>
      item.techniques.some((technique) => technique.id === selectedTechniqueId));
    return track ? { type: C.RemoveTechnique, trackId: track.id, techniqueId: selectedTechniqueId } : null;
  }
  return selection ? {
    type: C.RemoveNotesInRect,
    range: { trackId: selection.anchor.trackId, anchor: selection.anchor, focus: selection.focus },
  } : null;
};
