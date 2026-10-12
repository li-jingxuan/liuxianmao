"use client";

import {
  EXAMPLE_TECHNIQUE_RHYTHM_DOCUMENT,
  createQualityScore,
  EXAMPLE_MUTED_NOTE_DOCUMENT,
  EXAMPLE_MVP7C_DOCUMENT,
  EXAMPLE_MVP7C_LONG_DOCUMENT,
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
  const qualityCount = useStore(session, (state) =>
    state.document?.score.title.startsWith("A4 图片质量验收")
      ? state.document.score.tracks[0]?.measures.length
      : null,
  );
  const isMutedFixture = useStore(
    session,
    (state) =>
      state.document?.score.id === EXAMPLE_MUTED_NOTE_DOCUMENT.score.id,
  );

  const measureCount = useStore(
    session,
    (state) => state.document?.score.tracks[0]?.measures.length ?? 0,
  );
  const isCFixture = useStore(
    session,
    (state) => state.document?.score.id.startsWith("mvp7c-") ?? false,
  );
  return (
    <div className={styles.testPage}>
      <header className={styles.header}>
        <h1>{title}</h1>
        <p>
          {qualityCount
            ? `${qualityCount} 小节混合谱，包含四段歌词、中文、和弦图、闷音、两位品位和跨行技巧，用于 A4 图片及长谱验收。`
            : isCFixture
              ? `${measureCount} 小节，覆盖简谱高低音/多音、半音推弦、连音与 16 类技巧。可验证段落子 TAB、拍点结构、复制粘贴和行左侧边界。`
              : isMutedFixture
                ? "6 小节，覆盖闷音 x、数字/x 混合和弦、附点、休止、三连音、拨片方向、扫弦/琶音和 P.M.。按 X 或工具栏 x 输入，可撤销重做。"
                : "14 小节，覆盖 16 种技巧、全音符至三十二分音符、附点、休止和三连音。可选择技巧、编辑、撤销及切换排版，或载入闷音混合谱。"}
        </p>
        <nav>
          <button
            onClick={() =>
              session.getState().replaceDocument(EXAMPLE_MVP7C_DOCUMENT)
            }
          >
            载入 MVP7.1-C 混合谱
          </button>
          <button
            onClick={() =>
              session.getState().replaceDocument(EXAMPLE_MVP7C_LONG_DOCUMENT)
            }
          >
            载入 100 小节基线谱
          </button>
          <Link href="/">返回编辑器</Link>
          <button
            type="button"
            onClick={() =>
              session.getState().replaceDocument(createQualityScore(16))
            }
          >
            载入 16 小节验收谱
          </button>
          <button
            type="button"
            onClick={() =>
              session.getState().replaceDocument(createQualityScore(100))
            }
          >
            载入 100 小节验收谱
          </button>
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
