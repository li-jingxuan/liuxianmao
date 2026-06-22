"use client";

import { useCallback, useRef } from "react";
import type React from "react";
import {
  useScoreStore,
  useEditorStore,
  type Beat,
  type Measure,
  type RhythmValue,
  type TupletGroup,
} from "@liuxianmao/lxm-tabeditor";
import type { MusicControlIcon } from "../../assets/svg/svg-assets-manifest";
import { MusicAssetIcon } from "../MusicAssetIcon";
import { cn } from "../../lib/cn";
import { NOTE_OPTIONS, TECHNIQUE_OPTIONS } from "./editor-data";
import sharedStyles from "./shared.module.scss";
import styles from "./Sidebar.module.scss";

const rhythmByLabel: Record<string, RhythmValue> = {
  全音符: { base: "whole", dots: 0 },
  二分音符: { base: "half", dots: 0 },
  四分音符: { base: "quarter", dots: 0 },
  八分音符: { base: "eighth", dots: 0 },
  十六分音符: { base: "sixteenth", dots: 0 },
  三十二分音符: { base: "thirtySecond", dots: 0 },
};

const rhythmIconByLabel: Record<string, MusicControlIcon> = {
  全音符: "noteWhole",
  二分音符: "noteHalf",
  四分音符: "noteQuarter",
  八分音符: "noteEighth",
  十六分音符: "noteSixteenth",
  三十二分音符: "noteThirtySecond",
};

const dotControls: readonly {
  label: string;
  dots: RhythmValue["dots"];
  assetId: MusicControlIcon;
}[] = [
  { label: "附点", dots: 1, assetId: "noteDot" },
  { label: "双附点", dots: 2, assetId: "noteDoubleDotted" },
  { label: "取消附点", dots: 0, assetId: "noteQuarter" },
];

const tupletControls: readonly {
  label: string;
  actualNotes: TupletGroup["actualNotes"];
  assetId: MusicControlIcon;
}[] = [
  { label: "二连音", actualNotes: 2, assetId: "duplet" },
  { label: "三连音", actualNotes: 3, assetId: "triplet" },
  { label: "四连音", actualNotes: 4, assetId: "quadruplet" },
  { label: "五连音", actualNotes: 5, assetId: "quintupletFiveFour" },
  { label: "六连音", actualNotes: 6, assetId: "sextuplet" },
];

const getActiveBeatContext = (
  score: ReturnType<typeof useScoreStore.getState>["score"],
  activeBeat: ReturnType<typeof useEditorStore.getState>["activeBeat"],
): { measure: Measure; beat: Beat } | undefined => {
  if (!activeBeat) return undefined;
  const measure = score.tracks
    .find((track) => track.id === activeBeat.trackId)
    ?.measures.find((item) => item.id === activeBeat.measureId);
  const beat = measure?.beats.find((item) => item.id === activeBeat.beatId);
  return measure && beat ? { measure, beat } : undefined;
};

interface SidebarButtonProps {
  active?: boolean;
  assetId: MusicControlIcon;
  disabled?: boolean;
  label: string;
  onClick?: () => void;
}

const SidebarButton: React.FC<SidebarButtonProps> = ({
  active,
  assetId,
  disabled,
  label,
  onClick,
}) => (
  <button
    className={cn(styles["option-button"], active && sharedStyles.active)}
    disabled={disabled}
    aria-label={label}
    onClick={onClick}
    title={label}
    type="button"
  >
    <MusicAssetIcon
      className={sharedStyles["music-asset-icon"]}
      assetId={assetId}
    />
  </button>
);

export const Sidebar: React.FC = () => {
  const generatedIdRef = useRef(0);
  const score = useScoreStore((state) => state.score);
  const executeCommand = useScoreStore((state) => state.executeCommand);
  const activeBeat = useEditorStore((state) => state.activeBeat);
  const currentRhythm = useEditorStore((state) => state.currentRhythm);
  const setCurrentRhythm = useEditorStore((state) => state.setCurrentRhythm);

  const createGeneratedId = useCallback((prefix: string) => {
    generatedIdRef.current += 1;
    return `${prefix}-${Date.now().toString(36)}-${generatedIdRef.current}`;
  }, []);

  const applyRhythm = useCallback(
    (rhythm: RhythmValue) => {
      setCurrentRhythm(rhythm);
      if (!activeBeat) return;
      executeCommand({
        type: "beat.setRhythm",
        payload: { ...activeBeat, rhythm },
      });
    },
    [activeBeat, executeCommand, setCurrentRhythm],
  );

  const applyDots = useCallback(
    (dots: RhythmValue["dots"]) => {
      const context = getActiveBeatContext(score, activeBeat);
      const rhythm = {
        ...(context?.beat.rhythm ?? currentRhythm),
        dots,
      };
      applyRhythm(rhythm);
    },
    [activeBeat, applyRhythm, currentRhythm, score],
  );

  const setTuplet = useCallback(
    (actualNotes: TupletGroup["actualNotes"]) => {
      const track = score.tracks[0];
      if (!track || !activeBeat) return;
      const measure = track.measures.find((item) => item.id === activeBeat.measureId);
      if (!measure) return;
      const startIndex = measure.beats.findIndex(
        (beat) => beat.id === activeBeat.beatId,
      );
      const beatIds = measure.beats
        .slice(startIndex, startIndex + actualNotes)
        .map((beat) => beat.id);

      /*
       * 从当前光标向右取连续拍点生成连音组。
       * 这样 UI 不需要复杂选择状态，语义校验仍能兜底容量和重叠问题。
       */
      if (beatIds.length !== actualNotes) return;
      executeCommand({
        type: "tuplet.set",
        payload: {
          trackId: track.id,
          measureId: measure.id,
          tuplet: {
            id: createGeneratedId("tuplet"),
            actualNotes,
            normalNotes: (actualNotes === 2
              ? 3
              : Math.min(4, actualNotes - 1)) as TupletGroup["normalNotes"],
            beatIds,
            bracket: "show",
          },
        },
      });
    },
    [activeBeat, createGeneratedId, executeCommand, score.tracks],
  );

  const clearTuplet = useCallback(() => {
    const track = score.tracks[0];
    if (!track || !activeBeat) return;
    const measure = track.measures.find((item) => item.id === activeBeat.measureId);
    const tuplet = measure?.tuplets.find((group) =>
      group.beatIds.includes(activeBeat.beatId),
    );
    if (!measure || !tuplet) return;
    executeCommand({
      type: "tuplet.clear",
      payload: {
        trackId: track.id,
        measureId: measure.id,
        tupletId: tuplet.id,
      },
    });
  }, [activeBeat, executeCommand, score.tracks]);

  return (
    <aside className={styles["left-panel"]} aria-label="音符与技巧">
      <section aria-label="添加音符">
        <p>添加音符</p>
        <div className={styles["option-list"]}>
          {NOTE_OPTIONS.map((option) => {
            const rhythm = rhythmByLabel[option.label];
            const active =
              rhythm?.base === currentRhythm.base &&
              rhythm.dots === currentRhythm.dots;
            return (
              <SidebarButton
                active={active}
                assetId={rhythmIconByLabel[option.label] ?? "noteQuarter"}
                key={option.label}
                label={option.label}
                onClick={() => rhythm && applyRhythm(rhythm)}
              />
            );
          })}
        </div>
      </section>

      <section className={styles["sidebar-section"]} aria-label="时值标注">
        <p>时值标注</p>
        <div className={styles["option-list"]}>
          {dotControls.map((control) => (
            <SidebarButton
              active={currentRhythm.dots === control.dots}
              assetId={control.assetId}
              disabled={!activeBeat}
              key={control.label}
              label={control.label}
              onClick={() => applyDots(control.dots)}
            />
          ))}
          {tupletControls.map((control) => (
            <SidebarButton
              assetId={control.assetId}
              disabled={!activeBeat}
              key={control.label}
              label={control.label}
              onClick={() => setTuplet(control.actualNotes)}
            />
          ))}
          <SidebarButton
            assetId="noteTie"
            disabled={!activeBeat}
            label="取消连音"
            onClick={clearTuplet}
          />
        </div>
      </section>

      <section className={styles["technique-section"]} aria-label="技巧">
        <p>技巧</p>
        <div className={styles["option-list"]}>
          {TECHNIQUE_OPTIONS.map((option) => (
            <button
              className={styles["option-button"]}
              aria-label={option.label}
              key={option.label}
              title={option.label}
              type="button"
            >
              <span aria-hidden="true">·</span>
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
};
