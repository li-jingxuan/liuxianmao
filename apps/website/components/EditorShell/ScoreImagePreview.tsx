"use client";
import { Button } from "antd";

import { useEffect, useRef, useState } from "react";
import type { ILXMDocument, ILXMLayoutDensity } from "@liuxianmao/lxm-editor";
import { ScorePresentationPage } from "./ScorePresentationPage";
import {
  encodeScorePage,
  exportScoreImages,
  pageImageName,
  prepareScoreImages,
  type PreparedScoreImages,
} from "./image-export-controller";
import styles from "./image-export.module.scss";

/** 模态预览锁定已提交内容，关闭/替换会话时取消所有异步输出。 */
export const ScoreImagePreview = ({
  score,
  density,
  showChordDiagrams,
  onClose,
  isCurrent,
}: {
  score: ILXMDocument;
  density: ILXMLayoutDensity;
  showChordDiagrams: boolean;
  onClose: () => void;
  isCurrent: () => boolean;
}) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const task = useRef<AbortController | null>(null);
  const closeRef = useRef(onClose);
  const currentRef = useRef(isCurrent);
  useEffect(() => {
    closeRef.current = onClose;
    currentRef.current = isCurrent;
  }, [onClose, isCurrent]);
  const [prepared, setPrepared] = useState<PreparedScoreImages | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [progress, setProgress] = useState(0);
  const [download, setDownload] = useState<{
    url: string;
    name: string;
  } | null>(null);
  const urlRef = useRef<string | null>(null);
  const clearDownload = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setDownload(null);
  };
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    element?.showModal();
    const controller = new AbortController();
    task.current = controller;
    let ready = false;
    const invalidate = () => {
      if (!ready) return;
      controller.abort();
      task.current?.abort();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
      setDownload(null);
      setPrepared(null);
      setBusy(false);
      setError("字体已变化，请关闭并重新打开图片预览");
    };
    document.fonts.addEventListener("loadingdone", invalidate);
    document.fonts.addEventListener("loadingerror", invalidate);
    void prepareScoreImages(
      score,
      density,
      showChordDiagrams,
      controller.signal,
    ).then(
      (result) => {
        if (controller.signal.aborted) return;
        if (!currentRef.current()) {
          closeRef.current();
          return;
        }
        ready = true;
        setPrepared(result);
        setBusy(false);
      },
      (e) => {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : "图片准备失败");
          setBusy(false);
        }
      },
    );
    return () => {
      controller.abort();
      task.current?.abort();
      document.fonts.removeEventListener("loadingdone", invalidate);
      document.fonts.removeEventListener("loadingerror", invalidate);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, [score, density, showChordDiagrams]);
  const generate = async (index?: number) => {
    if (!prepared || busy) return;
    if (!currentRef.current()) {
      closeRef.current();
      return;
    }
    task.current?.abort();
    const controller = new AbortController();
    task.current = controller;
    clearDownload();
    setError(null);
    setBusy(true);
    setProgress(0);
    try {
      const result =
        index === undefined
          ? await exportScoreImages(prepared, controller.signal, setProgress)
          : {
              blob: await encodeScorePage(prepared, index, controller.signal),
              name: pageImageName(prepared.title, index),
            };
      if (controller.signal.aborted) return;
      if (!currentRef.current()) {
        closeRef.current();
        return;
      }
      const url = URL.createObjectURL(result.blob);
      urlRef.current = url;
      setDownload({ url, name: result.name });
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "图片生成失败，请重试");
    } finally {
      if (task.current === controller) setBusy(false);
    }
  };
  const cancel = () => {
    task.current?.abort();
    setBusy(false);
    setProgress(0);
  };
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="image-preview-title"
      onCancel={(event) => {
        event.preventDefault();
        closeRef.current();
      }}
    >
      <div className={styles.toolbar}>
        <h2 id="image-preview-title">A4 图片预览</h2>
        <Button htmlType="button" onClick={() => closeRef.current()}>
          关闭
        </Button>
      </div>
      <p>
        A4 纵向 · 300 DPI · 2480 × 3508 像素 · 白底 PNG。多页下载为 ZIP 图片包。
      </p>
      <div className={styles.actions}>
        <Button
          htmlType="button"
          disabled={busy || !prepared}
          onClick={() => void generate()}
        >
          生成全部图片
        </Button>
        {busy && prepared && (
          <Button htmlType="button" onClick={cancel}>
            取消生成
          </Button>
        )}
        {download && (
          <Button
            type="primary"
            href={download.url}
            download={download.name}
            onClick={(event) => {
              if (!currentRef.current()) {
                event.preventDefault();
                closeRef.current();
              }
            }}
          >
            下载图片{download.name.endsWith(".zip") ? "包" : ""}
          </Button>
        )}
      </div>
      <p role="status">
        {busy
          ? prepared
            ? `正在生成第 ${progress || 1} / ${prepared.pages.length} 页`
            : "正在准备字体和分页…"
          : prepared
            ? `共 ${prepared.pages.length} 页${download ? "，图片已生成，请点击下载" : ""}`
            : ""}
      </p>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.pages}>
        {prepared?.pages.map((page) => (
          <section key={page.index} aria-label={`第 ${page.index + 1} 页`}>
            <div className={styles.pageHeader}>
              <span>第 {page.index + 1} 页</span>
              <Button
                htmlType="button"
                disabled={busy}
                onClick={() => void generate(page.index)}
              >
                生成此页图片
              </Button>
            </div>
            <ScorePresentationPage
              prepared={prepared}
              page={page}
              className={styles.page}
            />
          </section>
        ))}
      </div>
    </dialog>
  );
};
