"use client";

import type React from "react";
import { useEffect } from "react";
import { useScoreStore } from "@liuxianmao/lxm-tabeditor";
import { createExampleDocument } from "@liuxianmao/lxm-tabeditor/testing";
import { HeaderBar } from "./HeaderBar";
import { PlaybackBar } from "./PlaybackBar";
import { ScorePreview } from "./ScorePreview";
import { Sidebar } from "./Sidebar";
import { Toolbar } from "./Toolbar";
import styles from "./EditorShell.module.scss";

export const EditorShell: React.FC = () => {
  const loadDocument = useScoreStore((state) => state.loadDocument);

  useEffect(() => {
    const exampleDock = createExampleDocument();
    console.log('exampleDock: ', exampleDock);
    // Iteration 1 使用规范夹具初始化 store，页面不再维护第二份 mock score。
    loadDocument(exampleDock);
  }, [loadDocument]);

  return (
    <div className={`${styles["music-editor"]} h-dvh overflow-hidden`}>
      <HeaderBar />
      <section className={styles["workspace-shell"]} aria-label="六线谱编辑器">
        <Toolbar />
        <div className={styles["editor-body"]}>
          <Sidebar />
          <ScorePreview />
        </div>
      </section>
      <PlaybackBar />
    </div>
  );
};
