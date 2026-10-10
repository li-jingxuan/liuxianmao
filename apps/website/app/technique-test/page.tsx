"use client";

import {
  EXAMPLE_TECHNIQUE_RHYTHM_DOCUMENT,
  EXAMPLE_MUTED_NOTE_DOCUMENT,
} from "@liuxianmao/lxm-editor";
import Link from "next/link";
import { useState } from "react";
import { useStore } from "zustand";
import { EditorSession } from "../../components/EditorShell/EditorSession";
import { createEditorSession } from "../../stores/editor-store";
import styles from "./page.module.scss";

/** 测试页独立会话；恢复只替换本页文档，不触碰首页谱面与历史。 */
const TechniqueTestPage = () => {
  const [session] = useState(() =>
    createEditorSession(EXAMPLE_TECHNIQUE_RHYTHM_DOCUMENT),
  );

  const title = useStore(
    session,
    (state) => state.document?.score.title ?? "技巧与时值测试谱",
  );
  const isMutedFixture = useStore(
    session,
    (state) =>
      state.document?.score.id === EXAMPLE_MUTED_NOTE_DOCUMENT.score.id,
  );

  return (
    <div className={styles.testPage}>
      <header className={styles.header}>
        <h1>{title}</h1>
        <p>
          {isMutedFixture
            ? "6 小节，覆盖闷音 x、数字/x 混合和弦、附点、休止、三连音、拨片方向、扫弦/琶音和 P.M.。按 X 或工具栏 x 输入，可撤销重做。"
            : "14 小节，覆盖 16 种技巧、全音符至三十二分音符、附点、休止和三连音。可选择技巧、编辑、撤销及切换排版，或载入闷音混合谱。"}
        </p>
        <nav>
          <Link href="/">返回编辑器</Link>
          <button
            type="button"
            onClick={() =>
              session.getState().replaceDocument(EXAMPLE_MUTED_NOTE_DOCUMENT)
            }
          >
            载入闷音混合谱
          </button>
          <button
            type="button"
            onClick={() =>
              session
                .getState()
                .replaceDocument(EXAMPLE_TECHNIQUE_RHYTHM_DOCUMENT)
            }
          >
            恢复测试谱
          </button>
        </nav>
      </header>
      <div className={styles.workspace}>
        <EditorSession session={session} />
      </div>
    </div>
  );
};

export default TechniqueTestPage;
