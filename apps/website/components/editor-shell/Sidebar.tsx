"use client";

import type React from "react";
import { MusicAssetIcon } from "../MusicAssetIcon";
import { cn } from "../../lib/cn";
import { NOTE_OPTIONS, TECHNIQUE_OPTIONS } from "./editor-data";
import styles from "./EditorShell.module.scss";

export const Sidebar: React.FC = () => (
  <aside className={styles["left-panel"]} aria-label="音符与技巧">
    <section>
      <h2>添加音符</h2>
      <div className={styles["option-list"]}>
        {NOTE_OPTIONS.map((option) => (
          <button
            className={cn(
              styles["option-button"],
              option.active && styles.active,
            )}
            key={option.label}
            type="button"
          >
            {option.assetId ? (
              <MusicAssetIcon className={styles["music-asset-icon"]} assetId={option.assetId} />
            ) : (
              <span className={styles["music-icon"]} aria-hidden="true">
                {option.label}
              </span>
            )}
            <span>{option.label}</span>
          </button>
        ))}
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
