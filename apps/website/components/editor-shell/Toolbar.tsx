"use client";

import { Redo2, SlidersHorizontal, Undo2 } from "lucide-react";
import { useCallback, useRef } from "react";
import type React from "react";
import {
  createEmptyMeasure,
  useEditorStore,
  useScoreStore,
  type Measure,
  type TimeSignature,
} from "@liuxianmao/lxm-tabeditor";
import { cn } from "../../lib/cn";
import { MusicAssetIcon } from "../MusicAssetIcon";
import { BRAVURA_SYMBOLS, TOOLBAR_SECTIONS } from "./editor-data";
import sharedStyles from "./shared.module.scss";
import styles from "./Toolbar.module.scss";

const getActiveMeasureTimeSignature = (
  measures: Measure[],
  measureIndex: number,
  fallback: TimeSignature = { numerator: 4, denominator: 4 },
) => {
  let active = fallback;
  for (let index = 0; index <= measureIndex; index += 1) {
    const timeSignature = measures[index]?.timeSignature;
    if (timeSignature) active = timeSignature;
  }
  return active;
};

export const Toolbar: React.FC = () => {
  const generatedIdRef = useRef(0);
  const score = useScoreStore((state) => state.score);
  const executeCommand = useScoreStore((state) => state.executeCommand);
  const activeBeat = useEditorStore((state) => state.activeBeat);
  const setActiveBeat = useEditorStore((state) => state.setActiveBeat);
  const setSelectedNoteIds = useEditorStore((state) => state.setSelectedNoteIds);

  const createGeneratedId = useCallback((prefix: string) => {
    generatedIdRef.current += 1;
    return `${prefix}-${Date.now().toString(36)}-${generatedIdRef.current}`;
  }, []);

  const createMeasureForInsert = useCallback(
    (barline?: Measure["barline"]) => {
      const track = score.tracks[0];
      const measures = track?.measures ?? [];
      const activeIndex = activeBeat
        ? measures.findIndex((measure) => measure.id === activeBeat.measureId)
        : measures.length - 1;
      const sourceIndex = activeIndex >= 0 ? activeIndex : measures.length - 1;
      return createEmptyMeasure({
        id: createGeneratedId("measure"),
        beatIdPrefix: createGeneratedId("beat"),
        timeSignature: getActiveMeasureTimeSignature(
          measures,
          Math.max(0, sourceIndex),
          score.meta.timeSignature,
        ),
        barline,
      });
    },
    [activeBeat, createGeneratedId, score.meta.timeSignature, score.tracks],
  );

  const handleAddMeasure = useCallback(() => {
    const track = score.tracks[0];
    if (!track) return;
    const afterMeasureId = activeBeat?.measureId ?? track.measures.at(-1)?.id;
    executeCommand({
      type: "measure.add",
      payload: {
        trackId: track.id,
        afterMeasureId,
        measure: createMeasureForInsert("final"),
      },
    });
  }, [activeBeat, createMeasureForInsert, executeCommand, score.tracks]);

  const handleDeleteMeasure = useCallback(() => {
    const track = score.tracks[0];
    if (!track) return;
    const measures = track.measures;
    const deleteIndex = activeBeat
      ? measures.findIndex((measure) => measure.id === activeBeat.measureId)
      : measures.length - 1;
    const measure = measures[deleteIndex];
    if (!measure) return;

    /*
     * 删除后把光标落到相邻小节的第一个拍点。
     * 命令本身只负责 score 写入，页面临时态必须在这里同步清理，避免光标指向已删除 id。
     */
    const fallbackMeasure =
      measures.length === 1 ? createMeasureForInsert("final") : undefined;
    const nextMeasure =
      measures[deleteIndex + 1] ?? measures[deleteIndex - 1] ?? fallbackMeasure;
    executeCommand({
      type: "measure.delete",
      payload: {
        trackId: track.id,
        measureId: measure.id,
        fallbackMeasure,
      },
    });
    const nextBeat = nextMeasure?.beats[0];
    setActiveBeat(
      nextMeasure && nextBeat
        ? {
            trackId: track.id,
            measureId: nextMeasure.id,
            beatId: nextBeat.id,
            tick: nextBeat.tick,
            slotId: `${nextMeasure.id}-${nextBeat.id}-slot-0`,
            string: activeBeat?.string ?? 1,
          }
        : undefined,
    );
    setSelectedNoteIds([]);
  }, [
    activeBeat,
    createMeasureForInsert,
    executeCommand,
    score.tracks,
    setActiveBeat,
    setSelectedNoteIds,
  ]);

  const canDeleteMeasure = Boolean(score.tracks[0]?.measures.length);

  return (
    <nav className={styles["score-toolbar"]} aria-label="乐谱工具栏">
      <div className={styles["history-actions"]} aria-label="编辑历史">
        <button
          className={cn(sharedStyles["icon-button"], sharedStyles.disabled)}
          type="button"
          aria-label="撤销"
        >
          <Undo2 aria-hidden="true" size={17} />
        </button>
        <button
          className={sharedStyles["icon-button"]}
          type="button"
          aria-label="重做"
        >
          <Redo2 aria-hidden="true" size={17} />
        </button>
      </div>

      {TOOLBAR_SECTIONS.map((section, index) => (
        <div className={styles["tool-section"]} key={`tool-section-${index}`}>
          {section.map((tool) => (
            <button
              className={cn(
                styles["tool-button"],
                tool.active && sharedStyles.active,
              )}
              key={tool.label}
              type="button"
              title={tool.label}
            >
              <span
                className={cn(sharedStyles["music-icon"], styles["tool-icon"])}
                aria-hidden="true"
              >
                {tool.icon}
              </span>
              <span>{tool.label}</span>
            </button>
          ))}
        </div>
      ))}

      <div className={styles["toolbar-measure-actions"]} aria-label="小节操作">
        <button
          className={sharedStyles["icon-button"]}
          onClick={handleAddMeasure}
          title="添加小节"
          type="button"
          aria-label="添加小节"
        >
          <MusicAssetIcon
            className={sharedStyles["music-asset-icon"]}
            assetId="measureAdd"
          />
        </button>
        <button
          className={sharedStyles["icon-button"]}
          disabled={!canDeleteMeasure}
          onClick={handleDeleteMeasure}
          title="删除小节"
          type="button"
          aria-label="删除小节"
        >
          <MusicAssetIcon
            className={sharedStyles["music-asset-icon"]}
            assetId="measureRemove"
          />
        </button>
      </div>

      <div className={styles["score-settings"]} aria-label="谱面设置">
        <button className={styles["select-button"]} type="button">
          4/4
        </button>
        <button className={styles["select-button"]} type="button">
          <span className={sharedStyles["music-icon"]}>
            {BRAVURA_SYMBOLS.noteQuarter}
          </span>{" "}
          120
        </button>
        <button
          className={cn(
            sharedStyles["ghost-button"],
            sharedStyles.compact,
            styles["settings-button"],
          )}
          type="button"
        >
          <SlidersHorizontal aria-hidden="true" size={15} /> 显示设置
        </button>
      </div>
    </nav>
  );
};
