"use client";

import { Download, MoreHorizontal, Redo2, Save, Undo2 } from "lucide-react";
import type React from "react";
import { redoScore, undoScore, useScoreStore } from "@liuxianmao/lxm-tabeditor";
import styles from "./EditorShell.module.scss";

/** 顶栏读取真实乐谱标题，历史按钮直接调用核心包 temporal store。 */
export const HeaderBar: React.FC = () => {
  const title = useScoreStore((state) => state.score.title);

  return (
    <header className={styles["app-header"]}>
      <div className={styles["brand-block"]} aria-label="六线猫">
        <span className={styles["cat-mark"]} aria-hidden="true">
          六
        </span>
        <strong>六线猫</strong>
        <span className={styles["save-state"]}>本地数据已加载</span>
      </div>

      <div className={styles["score-title"]} aria-label="乐谱名称">
        <strong>{title}</strong>
      </div>

      <div className={styles["header-actions"]} aria-label="文件操作">
        <button
          className={styles["icon-button"]}
          type="button"
          aria-label="撤销"
          onClick={undoScore}
        >
          <Undo2 aria-hidden="true" size={17} />
        </button>
        <button
          className={styles["icon-button"]}
          type="button"
          aria-label="重做"
          onClick={redoScore}
        >
          <Redo2 aria-hidden="true" size={17} />
        </button>
        <span className={styles.divider} aria-hidden="true" />
        <button className={styles["ghost-button"]} type="button">
          <Save aria-hidden="true" size={15} /> 保存
        </button>
        <button className={styles["dark-button"]} type="button">
          <Download aria-hidden="true" size={15} /> 导出
        </button>
        <button
          className={styles["icon-button"]}
          type="button"
          aria-label="更多"
        >
          <MoreHorizontal aria-hidden="true" size={18} />
        </button>
      </div>
    </header>
  );
};
