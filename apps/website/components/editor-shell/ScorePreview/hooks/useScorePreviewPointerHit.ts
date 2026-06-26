import { useCallback, useRef, type RefObject } from "react";
import {
  hitTestScoreLayout,
  useEditorStore,
  useScoreStore,
  type Beat,
  type ScoreLayout,
  type TabNote,
} from "@liuxianmao/lxm-tabeditor";

type Score = ReturnType<typeof useScoreStore.getState>["score"];
type SetActiveBeat = ReturnType<typeof useEditorStore.getState>["setActiveBeat"];
type SetSelectedNoteIds =
  ReturnType<typeof useEditorStore.getState>["setSelectedNoteIds"];

interface UseScorePreviewPointerHitOptions {
  layout: ScoreLayout;
  score: Score;
  panelRef: RefObject<HTMLElement | null>;
  setActiveBeat: SetActiveBeat;
  setSelectedNoteIds: SetSelectedNoteIds;
}

const getBeatNoteOnString = (
  beat: Beat | undefined,
  string: number,
): TabNote | undefined =>
  beat?.kind === "notes"
    ? beat.notes.find((note) => note.string === string)
    : undefined;

/**
 * 指针命中 hook 负责把“浏览器里的像素坐标”翻译成“谱面里的编辑位置”。
 * 它依赖 layout 的命中索引，但不关心后续是改 fret、设 rest 还是移动选区。
 */
export const useScorePreviewPointerHit = ({
  layout,
  score,
  panelRef,
  setActiveBeat,
  setSelectedNoteIds,
}: UseScorePreviewPointerHitOptions) => {
  const svgRef = useRef<SVGSVGElement>(null);

  /**
   * 指针命中分两步完成：
   * 1. DOM client 坐标按 SVG 当前渲染尺寸反算回 viewBox 坐标；
   * 2. layout 层根据小节 bounds、拍点 x 和弦线 y 找到最近编辑位置。
   */
  const handlePointerDown = useCallback<React.PointerEventHandler<SVGSVGElement>>(
    (event) => {
      const svg = svgRef.current;
      const track = score.tracks[0];
      if (!svg || !track) return;
      const rect = svg.getBoundingClientRect();
      /*
       * 页面渲染尺寸会跟 zoom 一起变化，但 layout 命中总是基于固定 viewBox 坐标。
       * 所以这里必须先把 DOM 像素坐标反算回 layout 坐标，不能直接拿 clientX/clientY 做命中。
       */
      const point = {
        x: ((event.clientX - rect.left) / rect.width) * layout.width,
        y: ((event.clientY - rect.top) / rect.height) * layout.height,
      };
      const hit = hitTestScoreLayout(layout, point);
      if (!hit) return;
      // 命中结果里的 slot metadata 要原样进入 active cursor，后续 reducer 会据此
      // 决定这次输入是“拆已有 beat”还是“把 gap materialize 成真实时间线”。
      const nextActiveBeat = {
        trackId: track.id,
        ...hit,
        slotKind: hit.slotKind ?? "beat",
        slotId:
          hit.slotId ??
          `${hit.measureId}-${hit.beatId ?? hit.tick.toString()}-slot-0`,
      };
      const beat = track.measures
        .find((measure) => measure.id === hit.measureId)
        ?.beats.find((item) =>
          hit.beatId ? item.id === hit.beatId : item.tick === hit.tick,
        );
      const note = getBeatNoteOnString(beat, hit.string);
      setActiveBeat(nextActiveBeat);
      setSelectedNoteIds(note ? [note.id] : []);
      panelRef.current?.focus();
    },
    [layout, panelRef, score.tracks, setActiveBeat, setSelectedNoteIds],
  );

  return { svgRef, handlePointerDown };
};
