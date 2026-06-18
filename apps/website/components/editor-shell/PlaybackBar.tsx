"use client";

import {
  Repeat2,
  Settings,
  SkipBack,
  SkipForward,
  Volume2,
} from "lucide-react";
import { Play } from "lucide-react";
import type React from "react";
import { cn } from "../../lib/cn";
import styles from "./EditorShell.module.scss";

const PLAYBACK_ACTIONS = [SkipBack, Play, SkipForward, Repeat2] as const;

export const PlaybackBar: React.FC = () => (
  <footer className={styles["playback-bar"]} aria-label="播放控制">
    <div className={styles["transport-controls"]}>
      {PLAYBACK_ACTIONS.map((Icon, index) => (
        <button
          className={cn(
            styles["transport-button"],
            index === 1 && styles.primary,
          )}
          key={Icon.displayName ?? index}
          type="button"
          aria-label={index === 1 ? "播放" : "播放控制"}
        >
          <Icon aria-hidden="true" size={17} />
        </button>
      ))}
    </div>
    <div className={styles["playback-meta"]}>
      <strong>Am</strong>
      <span>1/4</span>
      <span>00:00 / 01:30</span>
    </div>
    <div className={styles.timeline} aria-hidden="true">
      <span />
    </div>
    <div className={styles["volume-control"]} aria-label="音量">
      <Volume2 aria-hidden="true" size={16} />
      <div className={styles["volume-track"]}>
        <span />
      </div>
    </div>
    <div className={styles["bottom-actions"]}>
      <button
        className={cn(styles["ghost-button"], styles.compact)}
        type="button"
      >
        节拍器
      </button>
      <button
        className={cn(styles["ghost-button"], styles.compact)}
        type="button"
      >
        <Repeat2 size={14} /> 循环
      </button>
      <button className={styles["icon-button"]} type="button" aria-label="设置">
        <Settings size={17} />
      </button>
    </div>
  </footer>
);
