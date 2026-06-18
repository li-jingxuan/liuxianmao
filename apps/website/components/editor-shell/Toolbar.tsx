"use client";

import { Redo2, SlidersHorizontal, Undo2 } from "lucide-react";
import type React from "react";
import { cn } from "../../lib/cn";
import { BRAVURA_SYMBOLS, TOOLBAR_SECTIONS } from "./editor-data";
import styles from "./EditorShell.module.scss";

export const Toolbar: React.FC = () => (
  <nav className={styles["score-toolbar"]} aria-label="乐谱工具栏">
    <div className={styles["history-actions"]} aria-label="编辑历史">
      <button
        className={cn(styles["icon-button"], styles.disabled)}
        type="button"
        aria-label="撤销"
      >
        <Undo2 aria-hidden="true" size={17} />
      </button>
      <button className={styles["icon-button"]} type="button" aria-label="重做">
        <Redo2 aria-hidden="true" size={17} />
      </button>
    </div>

    {TOOLBAR_SECTIONS.map((section, index) => (
      <div className={styles["tool-section"]} key={`tool-section-${index}`}>
        {section.map((tool) => (
          <button
            className={cn(styles["tool-button"], tool.active && styles.active)}
            key={tool.label}
            type="button"
            title={tool.label}
          >
            <span className={styles["music-icon"]} aria-hidden="true">
              {tool.icon}
            </span>
            <span>{tool.label}</span>
          </button>
        ))}
      </div>
    ))}

    <div className={styles["score-settings"]} aria-label="谱面设置">
      <button className={styles["select-button"]} type="button">
        4/4
      </button>
      <button className={styles["select-button"]} type="button">
        <span className={styles["music-icon"]}>
          {BRAVURA_SYMBOLS.noteQuarter}
        </span>{" "}
        120
      </button>
      <button
        className={cn(styles["ghost-button"], styles.compact)}
        type="button"
      >
        <SlidersHorizontal aria-hidden="true" size={15} /> 显示设置
      </button>
    </div>
  </nav>
);
