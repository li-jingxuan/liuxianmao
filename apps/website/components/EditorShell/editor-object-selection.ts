import {
  hitTestLayout,
  hitTestMusicText,
  hitTestTechniqueTarget,
  resolveTabCellSelection,
  resolveTechniqueSelection,
  type ILXMDocument,
  type ILXMLayout,
  type ILXMTabCellSelection,
} from "@liuxianmao/lxm-editor";
import type { SidebarAction } from "./music-text-draft";

/** 命中对象决定动作，不接收侧栏页签；技巧优先于六线谱单元格命中。 */
export const resolveScorePointerAction = (
  document: ILXMDocument,
  layout: ILXMLayout,
  point: { x: number; y: number },
  selection: ILXMTabCellSelection | null,
  extend: boolean,
): SidebarAction | null => {
  const text = hitTestMusicText(layout, point);
  if (text)
    return {
      type: "target",
      target: {
        trackId: text.trackId,
        measureId: text.measureId,
        beatId: text.beatId,
        kind: text.kind,
        verse: text.verse,
        string: selection?.focus.string ?? 1,
      },
    };
  const technique = hitTestTechniqueTarget(layout, point);
  if (technique)
    return {
      type: "selection",
      techniqueId: technique.techniqueId,
      selection: resolveTechniqueSelection(
        document,
        technique.techniqueId,
        technique.focusEndpoint,
      ),
    };
  const hit = hitTestLayout(layout, point);
  if (!hit) return extend ? null : { type: "selection", selection: null };
  const target = {
    trackId: hit.trackId,
    measureId: hit.measureId,
    beatId: hit.beatId,
    string: hit.string,
  };
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
