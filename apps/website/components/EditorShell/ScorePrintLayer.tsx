import { useEffect, useState } from "react";
import type { ILXMDocument, ILXMLayoutDensity } from "@liuxianmao/lxm-editor";
import {
  prepareScorePresentation,
  type PreparedScoreImages,
} from "./image-export-controller";
import { ScorePresentationPage } from "./ScorePresentationPage";
import styles from "./score-print.module.scss";

/** 隐藏打印层提前准备快照；快捷打印不能等待异步字体，也不能沿用旧编辑坐标。 */
export const ScorePrintLayer = ({
  score,
  density,
  showChordDiagrams,
}: {
  score: ILXMDocument;
  density: ILXMLayoutDensity;
  showChordDiagrams: boolean;
}) => {
  const [snapshot, setSnapshot] = useState<{
    score: ILXMDocument;
    density: ILXMLayoutDensity;
    showChordDiagrams: boolean;
    prepared?: PreparedScoreImages;
    error?: string;
  } | null>(null);
  const [fontVersion, setFontVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let ready = false;
    const invalidate = () => {
      if (!ready) return;
      ready = false;
      setSnapshot(null);
      setFontVersion((version) => version + 1);
    };
    document.fonts.addEventListener("loadingdone", invalidate);
    document.fonts.addEventListener("loadingerror", invalidate);
    void prepareScorePresentation(
      score,
      density,
      showChordDiagrams,
      controller.signal,
    ).then(
      (prepared) => {
        if (controller.signal.aborted) return;
        ready = true;
        setSnapshot({ score, density, showChordDiagrams, prepared });
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setSnapshot({
            score,
            density,
            showChordDiagrams,
            error: error instanceof Error ? error.message : "成品谱面准备失败",
          });
      },
    );
    return () => {
      controller.abort();
      document.fonts.removeEventListener("loadingdone", invalidate);
      document.fonts.removeEventListener("loadingerror", invalidate);
    };
  }, [score, density, showChordDiagrams, fontVersion]);
  // 身份检查发生在 render 内，堵住文档替换到 effect 清理之间的旧快照窗口。
  const current =
    snapshot?.score === score &&
    snapshot.density === density &&
    snapshot.showChordDiagrams === showChordDiagrams
      ? snapshot
      : null;
  return (
    <div
      className={styles.printLayer}
      aria-hidden="true"
      data-print-ready={!!current?.prepared}
    >
      {current?.prepared ? (
        current.prepared.pages.map((page) => (
          <ScorePresentationPage
            key={page.index}
            prepared={current.prepared!}
            page={page}
            className={styles.page}
          />
        ))
      ) : (
        <p>{current?.error ?? "成品谱面正在准备，请稍后重新打印。"}</p>
      )}
    </div>
  );
};
