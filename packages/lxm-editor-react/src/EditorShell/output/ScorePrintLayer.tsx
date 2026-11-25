import { memo, useEffect, useState } from "react";
import type { ILXMDocument, ILXMLayoutDensity } from "@liuxianmao/lxm-editor";
import {
  prepareScorePresentation,
  type PreparedScoreImages,
} from "./image-export-controller";
import { ScorePresentationPage } from "./ScorePresentationPage";
import type { ScoreWatermark } from "./score-watermark";
import styles from "./score-print.module.scss";

/** 隐藏打印层提前准备快照；快捷打印不能等待异步字体，也不能沿用旧编辑坐标。 */
export const ScorePrintLayer = memo(function ScorePrintLayer({
  score,
  density,
  showChordDiagrams,
  watermark = null,
  watermarkVersion = 0,
}: {
  score: ILXMDocument;
  density: ILXMLayoutDensity;
  showChordDiagrams: boolean;
  watermark?: ScoreWatermark;
  watermarkVersion?: number;
}) {
  const [snapshot, setSnapshot] = useState<{
    score: ILXMDocument;
    density: ILXMLayoutDensity;
    showChordDiagrams: boolean;
    fontVersion: number;
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
      // 进入打印媒体可能触发第二次字体加载。浏览器会在准备新快照期间取页，
      // 此时保留同一份谱上一次完整的分页，避免把单行准备提示印成整份 PDF。
      // 版本不一致仍会关闭显式打印入口，直到新的字体度量完成。
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
        setSnapshot({ score, density, showChordDiagrams, fontVersion, prepared });
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setSnapshot({
            score,
            density,
            showChordDiagrams,
            fontVersion,
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
      data-score-print-layer="true"
      aria-hidden="true"
      data-print-ready={!!current?.prepared && current.fontVersion === fontVersion}
      data-watermark-version={watermarkVersion}
    >
      {current?.prepared ? (
        current.prepared.pages.map((page) => (
          <ScorePresentationPage
            key={page.index}
            prepared={current.prepared!}
            page={page}
            watermark={watermark}
            className={styles.page}
          />
        ))
      ) : (
        <p>{current?.error ?? "成品谱面正在准备，请稍后重新打印。"}</p>
      )}
    </div>
  );
});
