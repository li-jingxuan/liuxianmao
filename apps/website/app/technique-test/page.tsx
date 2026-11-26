"use client";

import { createEditorSession, LxmEditor } from "@liuxianmao/lxm-editor-react";
// 直接依赖本页验收谱，避免汇总入口的默认谱初始化把《理想》一起编入公开静态 JS。
import EXAMPLE_TECHNIQUE_RHYTHM_DOCUMENT from "../../../../packages/lxm-editor/example/example-technique-rhythm";
import EXAMPLE_MUTED_NOTE_DOCUMENT from "../../../../packages/lxm-editor/example/example-muted-note";
import { EXAMPLE_MVP7C_DOCUMENT, EXAMPLE_MVP7C_LONG_DOCUMENT } from "../../../../packages/lxm-editor/example/example-mvp7c";
import { createQualityScore } from "../../../../packages/lxm-editor/example/quality-score";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState, useSyncExternalStore } from "react";
import { websiteEditorResources } from "../../lib/editor-resources";
import styles from "./page.module.scss";

/** 测试页独立会话；恢复只替换本页文档，不触碰编辑器谱面与历史。 */
const TechniqueTestPage = () => {
  const router = useRouter();
  const [session] = useState(() =>
    createEditorSession(EXAMPLE_TECHNIQUE_RHYTHM_DOCUMENT),
  );

  // 接入页仅订阅公共会话的文档变更。服务端与首次客户端渲染都读取该会话的初始谱。
  const subscribe = useCallback(
    (notify: () => void) => session.on("change", notify),
    [session],
  );
  const score = useSyncExternalStore(subscribe, session.getDocument, session.getDocument)?.score;
  const title = score?.title ?? "技巧与时值测试谱";
  const measureCount = score?.tracks[0]?.measures.length ?? 0;
  const qualityCount = title.startsWith("A4 图片质量验收") ? measureCount : null;
  const isMutedFixture = score?.id === EXAMPLE_MUTED_NOTE_DOCUMENT.score.id;
  const isCFixture = score?.id.startsWith("mvp7c-") ?? false;
  return (
    <div className={styles.testPage}>
      <header className={styles.header}>
        <h1>{title}</h1>
        <p>
          {qualityCount
            ? `${qualityCount} 小节混合谱，包含四段歌词、中文、和弦图、x 弹奏标记、两位品位和跨行技巧，用于 A4 图片及长谱验收。`
            : isCFixture
              ? `${measureCount} 小节，覆盖简谱高低音/多音、半音推弦、连音与 16 类技巧。可验证段落子 TAB、拍点结构、复制粘贴和行左侧边界。`
              : isMutedFixture
                ? "6 小节，覆盖 x 弹奏标记、数字/x 混合和弦、附点、休止、三连音、拨片方向、扫弦/琶音和 P.M.。按 X 输入，可撤销重做。"
                : "14 小节，覆盖 16 种技巧、全音符至三十二分音符、附点、休止和三连音。可选择技巧、编辑、撤销及切换排版，或载入 x 混合谱。"}
        </p>
        <nav>
          <button
            onClick={() =>
              session.replaceDocument(EXAMPLE_MVP7C_DOCUMENT)
            }
          >
            载入 MVP7.1-C 混合谱
          </button>
          <button
            onClick={() =>
              session.replaceDocument(EXAMPLE_MVP7C_LONG_DOCUMENT)
            }
          >
            载入 100 小节基线谱
          </button>
          <Link href="/editor">返回编辑器</Link>
          <button
            type="button"
            onClick={() =>
              session.replaceDocument(createQualityScore(16))
            }
          >
            载入 16 小节验收谱
          </button>
          <button
            type="button"
            onClick={() =>
              session.replaceDocument(createQualityScore(100))
            }
          >
            载入 100 小节验收谱
          </button>
          <button
            type="button"
            onClick={() =>
              session.replaceDocument(EXAMPLE_MUTED_NOTE_DOCUMENT)
            }
          >
            载入 x 混合谱
          </button>
          <button
            type="button"
            onClick={() =>
              session.replaceDocument(EXAMPLE_TECHNIQUE_RHYTHM_DOCUMENT)
            }
          >
            恢复测试谱
          </button>
        </nav>
      </header>
      <div className={styles.workspace}>
        <LxmEditor
          session={session}
          resources={websiteEditorResources}
          navigation={{
            homeHref: "/",
            learningHref: "/guitar-advanced",
            onNavigate: router.push,
            onDiscard: () => session.replaceDocument(EXAMPLE_TECHNIQUE_RHYTHM_DOCUMENT),
            renderLink: (props) => <Link {...props} />,
          }}
        />
      </div>
    </div>
  );
};

export default TechniqueTestPage;
