import type {
  ILXMDocument,
  ILXMTabCellSelection,
} from "@liuxianmao/lxm-editor";
import type { MusicTextTarget } from "./music-text-draft";

const SELECT_REASON = "先选择一个 TAB 拍点，再添加和弦";

/** 和弦身份只到拍；禁止从其他谱层借用残留的 TAB 选区。 */
export function resolveEditorChordTarget(
  document: ILXMDocument,
  selection: ILXMTabCellSelection | null,
  active: MusicTextTarget | null,
  hasNumberedSelection = false,
) {
  const unavailable = {
    target: null,
    chord: null,
    enabled: false,
    reason: SELECT_REASON,
    label: "添加和弦",
    title: SELECT_REASON,
  } as const;
  if (hasNumberedSelection || (active && active.kind !== "chord"))
    return unavailable;
  let candidate = active?.kind === "chord" ? active : null;
  if (!candidate && selection) {
    const { anchor, focus } = selection;
    if (
      anchor.trackId !== focus.trackId ||
      anchor.measureId !== focus.measureId ||
      anchor.beatId !== focus.beatId
    )
      return unavailable;
    candidate = { ...focus, kind: "chord" };
  }
  if (!candidate) return unavailable;
  const track = document.score.tracks.find(
    (item) => item.id === candidate.trackId,
  );
  const measureIndex =
    track?.measures.findIndex((item) => item.id === candidate.measureId) ?? -1;
  const measure = track?.measures[measureIndex];
  const beatIndex =
    measure?.beats.findIndex((item) => item.id === candidate.beatId) ?? -1;
  if (!measure || beatIndex < 0) return unavailable;
  const chord =
    measure.chordSymbols.find((item) => item.beatId === candidate.beatId) ??
    null;
  const label = chord ? "编辑和弦" : "添加和弦";
  // 弦号不参与和弦身份，统一为第一弦。
  const target: Extract<MusicTextTarget, { kind: "chord" }> = {
    kind: "chord",
    trackId: candidate.trackId,
    measureId: candidate.measureId,
    beatId: candidate.beatId,
    string: 1,
  };
  return {
    target,
    chord,
    enabled: true,
    reason: "",
    label,
    title: `${label} · 第 ${measureIndex + 1} 小节 · 第 ${beatIndex + 1} 拍`,
  };
}
