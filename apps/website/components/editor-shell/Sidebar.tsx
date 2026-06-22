"use client";

import type React from "react";
import {
  useEditorStore,
  type RhythmValue,
} from "@liuxianmao/lxm-tabeditor";
import { MusicAssetIcon } from "../MusicAssetIcon";
import { cn } from "../../lib/cn";
import { NOTE_OPTIONS, TECHNIQUE_OPTIONS } from "./editor-data";
import styles from "./EditorShell.module.scss";

const rhythmByLabel: Record<string, RhythmValue> = {
  全音符: { base: "whole", dots: 0 },
  二分音符: { base: "half", dots: 0 },
  四分音符: { base: "quarter", dots: 0 },
  八分音符: { base: "eighth", dots: 0 },
  十六分音符: { base: "sixteenth", dots: 0 },
  三十二分音符: { base: "thirtySecond", dots: 0 },
};

export const Sidebar: React.FC = () => {
  const currentRhythm = useEditorStore((state) => state.currentRhythm);
  const setCurrentRhythm = useEditorStore((state) => state.setCurrentRhythm);

  return (
    <aside className={styles["left-panel"]} aria-label="音符与技巧">
      <section>
        <h2>添加音符</h2>
        <div className={styles["option-list"]}>
          {NOTE_OPTIONS.map((option) => {
            const rhythm = rhythmByLabel[option.label];
            const active =
              rhythm?.base === currentRhythm.base &&
              rhythm.dots === currentRhythm.dots;
            return (
              <button
                className={cn(styles["option-button"], active && styles.active)}
                key={option.label}
                onClick={() => rhythm && setCurrentRhythm(rhythm)}
                type="button"
              >
                {option.assetId ? (
                  <MusicAssetIcon
                    className={styles["music-asset-icon"]}
                    assetId={option.assetId}
                  />
                ) : (
                  <span className={styles["music-icon"]} aria-hidden="true">
                    {option.label}
                  </span>
                )}
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className={styles["technique-section"]}>
        <h2>技巧</h2>
        <div className={styles["option-list"]}>
          {TECHNIQUE_OPTIONS.map((option) => (
            <button
              className={styles["option-button"]}
              key={option.label}
              type="button"
            >
              <span aria-hidden="true">·</span>
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
};
