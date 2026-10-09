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
  const track = document.score.tracks.find(
    (candidate) => candidate.id === trackId,
  );
  const measure = track?.measures.find((candidate) =>
    candidate.beats.some((beat) => beat.id === beatId),
  );
  return track && measure
    ? { trackId, measureId: measure.id, beatId, string }
    : null;
};

/** 在同轨道中按稳定 Note ID 找到所属 TAB 单元格。 */
const findNoteReference = (
  document: ILXMDocument,
  trackId: string,
  noteId: string,
): ILXMTabCellReference | null => {
  const track = document.score.tracks.find(
    (candidate) => candidate.id === trackId,
  );
  for (const measure of track?.measures ?? []) {
    for (const beat of measure.beats) {
      const note = beat.notes.find((candidate) => candidate.id === noteId);
      if (note)
        return {
          trackId,
          measureId: measure.id,
          beatId: beat.id,
          string: note.string,
        };
    }
  }
  return null;
};

/** 所有技巧恢复稳定选区；连接和区间的 focus 可落在点击的音乐端点。 */
export const resolveTechniqueSelection = (
  document: ILXMDocument,
  techniqueId: string,
  focusEndpoint: ILXMTechniqueFocusEndpoint,
): ILXMTabCellSelection | null => {
  const resolved = findTechnique(document, techniqueId);
  if (!resolved) return null;
  const { trackId, technique } = resolved;
  if ("fromNoteId" in technique) {
    const from = findNoteReference(document, trackId, technique.fromNoteId);
    const to =
      "toNoteId" in technique
        ? findNoteReference(document, trackId, technique.toNoteId)
        : from;
    if (!from || !to) return null;
    return focusEndpoint === "start"
      ? { anchor: to, focus: from }
      : { anchor: from, focus: to };
  }
  if ("fromBeatId" in technique) {
    const from = findBeatReference(document, trackId, technique.fromBeatId, 1);
    const to = findBeatReference(document, trackId, technique.toBeatId, 1);
    if (!from || !to) return null;
    return focusEndpoint === "start"
      ? { anchor: to, focus: from }
      : { anchor: from, focus: to };
  }
  if (technique.type === "pickStroke") {
    const track = document.score.tracks.find(
      (candidate) => candidate.id === trackId,
    );
    const beat = track?.measures
      .flatMap((measure) => measure.beats)
      .find((candidate) => candidate.id === technique.beatId);
    const reference = beat?.notes[0]
      ? findBeatReference(document, trackId, beat.id, beat.notes[0].string)
      : null;
    return reference ? { anchor: reference, focus: reference } : null;
  }

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
