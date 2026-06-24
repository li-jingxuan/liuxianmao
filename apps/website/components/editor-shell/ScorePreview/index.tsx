"use client";

import { Plus } from "lucide-react";
import type React from "react";
import { useCallback, useMemo, useRef } from "react";
import {
  layoutScore,
  useEditorStore,
  useScoreStore,
  useViewportStore,
  type Beat,
  type TabNote,
} from "@liuxianmao/lxm-tabeditor";
import { BRAVURA_SYMBOLS } from "../editor-data";
import { ScorePreviewSvg } from "./ScorePreviewSvg";
import { useBravuraFontStatus } from "./hooks/useBravuraFontStatus";
import { useScorePreviewInput } from "./hooks/useScorePreviewInput";
import { useScorePreviewPointerHit } from "./hooks/useScorePreviewPointerHit";
import sharedStyles from "../shared.module.scss";
import styles from "./index.module.scss";

const getBeatNoteOnString = (
  beat: Beat | undefined,
  string: number,
): TabNote | undefined =>
  beat?.kind === "notes"
    ? beat.notes.find((note) => note.string === string)
    : undefined;

const getActiveBeat = (
  score: ReturnType<typeof useScoreStore.getState>["score"],
  activeBeat: ReturnType<typeof useEditorStore.getState>["activeBeat"],
) => {
  /*
   * activeBeat 存的是稳定 id，不存对象引用。
   * 每次执行命令前重新从 score 解析，避免 React 旧闭包持有已经被 reducer 替换的 beat。
   */
  if (!activeBeat) return undefined;
  const track = score.tracks.find((item) => item.id === activeBeat.trackId);
  const measure = track?.measures.find(
    (item) => item.id === activeBeat.measureId,
  );
  const beat = measure?.beats.find((item) =>
    activeBeat.beatId ? item.id === activeBeat.beatId : item.tick === activeBeat.tick,
  );
  return track && measure && beat ? { track, measure, beat } : undefined;
};

export const ScorePreview: React.FC = () => {
  const panelRef = useRef<HTMLElement>(null);
  const generatedIdRef = useRef(0);
  const score = useScoreStore((state) => state.score);
  const lastCommandIssues = useScoreStore((state) => state.lastCommandIssues);
  const executeCommand = useScoreStore((state) => state.executeCommand);
  const zoom = useViewportStore((state) => state.zoom);
  const activeBeat = useEditorStore((state) => state.activeBeat);
  const currentRhythm = useEditorStore((state) => state.currentRhythm);
  const setActiveBeat = useEditorStore((state) => state.setActiveBeat);
  const setSelectedNoteIds = useEditorStore((state) => state.setSelectedNoteIds);
  const fontStatus = useBravuraFontStatus();
  const layout = useMemo(
    () =>
      /**
       * MVP 固定按 720p 桌面基线排版，页面层不再把容器宽度传入 layout。
       * 这样只读谱面的换行结果稳定，后续编辑命中索引不会因为窗口变化而漂移。
       */
      layoutScore(score, {
        zoom,
        editingRhythm: currentRhythm,
      }),
    [currentRhythm, score, zoom],
  );

  const activeContext = getActiveBeat(score, activeBeat);
  const activeNote = getBeatNoteOnString(
    activeContext?.beat,
    activeBeat?.string ?? 1,
  );

  const createGeneratedId = useCallback((prefix: string) => {
    generatedIdRef.current += 1;
    return `${prefix}-${Date.now().toString(36)}-${generatedIdRef.current}`;
  }, []);

  const { svgRef, handlePointerDown } = useScorePreviewPointerHit({
    layout,
    score,
    panelRef,
    setActiveBeat,
    setSelectedNoteIds,
  });
  const { inputIssue, handleKeyDown, handleAddMeasure } = useScorePreviewInput({
    score,
    activeBeat,
    activeNote,
    currentRhythm,
    executeCommand,
    setActiveBeat,
    setSelectedNoteIds,
    createGeneratedId,
  });

  return (
    <main
      className={styles["canvas-panel"]}
      aria-label="乐谱编辑区域"
      onKeyDown={handleKeyDown}
      ref={panelRef}
      tabIndex={0}
    >
      <div className={styles["tempo-row"]}>
        <span className={`${styles["tempo-note"]} ${sharedStyles["music-icon"]}`}>
          {BRAVURA_SYMBOLS.noteQuarter}
        </span>
        <span>= {layout.tempo}</span>
      </div>
      {fontStatus === "failed" ? (
        <p className={styles["font-warning"]}>
          Bravura 字体加载失败，休止符等音乐符号可能显示异常。
        </p>
      ) : null}
      {inputIssue || lastCommandIssues.length > 0 ? (
        <div className={styles["command-issues"]} role="status">
          {inputIssue ?? lastCommandIssues[0]?.message}
        </div>
      ) : null}

      <div className={styles["score-sheet"]}>
        <ScorePreviewSvg
          layout={layout}
          title={score.title}
          selection={{
            activeBeatId: activeBeat?.beatId,
            activeMeasureId: activeBeat?.measureId,
            activeSlotId: activeBeat?.slotId,
            activeString: activeBeat?.string,
            activeNoteId: activeNote?.id,
          }}
          svgRef={svgRef}
          onPointerDown={handlePointerDown}
        />
      </div>

      <div className={styles["score-add-measure-row"]}>
        <button
          className={`${styles["add-measure-button"]} ${styles["score-add-measure-button"]}`}
          onClick={handleAddMeasure}
          type="button"
        >
          <Plus aria-hidden="true" size={15} /> 添加小节
        </button>
      </div>
    </main>
  );
};
