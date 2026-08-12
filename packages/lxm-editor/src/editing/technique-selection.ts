/**
 * 把领域技巧解析为可编辑的稳定 TAB selection。
 *
 * layout 命中只传入音乐起止端提示，本模块不读取 SVG 坐标。这样换行与缩放不会
 * 进入编辑状态，页面也不需要按技巧判别字段扫描文档。
 */
import type { ILXMDocument, ILXMTechnique } from "../core/types";
import type {
  ILXMTabCellReference,
  ILXMTabCellSelection,
} from "./tab-cell-selection";

export type ILXMTechniqueFocusEndpoint = "start" | "end";

const findTechnique = (
  document: ILXMDocument,
  techniqueId: string,
): { trackId: string; technique: ILXMTechnique } | null => {
  for (const track of document.score.tracks) {
    const technique = track.techniques.find(
      (candidate) => candidate.id === techniqueId,
    );
    if (technique) return { trackId: track.id, technique };
  }
  return null;
};

const findBeatReference = (
  document: ILXMDocument,
  trackId: string,
  beatId: string,
  string: number,
): ILXMTabCellReference | null => {
  const track = document.score.tracks.find((candidate) => candidate.id === trackId);
  const measure = track?.measures.find((candidate) =>
    candidate.beats.some((beat) => beat.id === beatId),
  );
  return track && measure
    ? { trackId, measureId: measure.id, beatId, string }
    : null;
};

/** 当前先完整支持具有明确 Beat × 弦范围的扫弦与琶音。 */
export const resolveTechniqueSelection = (
  document: ILXMDocument,
  techniqueId: string,
  focusEndpoint: ILXMTechniqueFocusEndpoint,
): ILXMTabCellSelection | null => {
  const resolved = findTechnique(document, techniqueId);
  if (!resolved) return null;
  const { trackId, technique } = resolved;
  if (technique.type !== "strum" && technique.type !== "arpeggio") return null;

  const startsAtMaxString =
    technique.type === "strum"
      ? technique.stroke === "down"
      : technique.direction === "ascending";
  const startString = startsAtMaxString
    ? technique.maxString
    : technique.minString;
  const endString = startsAtMaxString
    ? technique.minString
    : technique.maxString;
  const anchorString = focusEndpoint === "start" ? endString : startString;
  const focusString = focusEndpoint === "start" ? startString : endString;
  const anchor = findBeatReference(
    document,
    trackId,
    technique.beatId,
    anchorString,
  );
  const focus = findBeatReference(
    document,
    trackId,
    technique.beatId,
    focusString,
  );
  return anchor && focus ? { anchor, focus } : null;
};
