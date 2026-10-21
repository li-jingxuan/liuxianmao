"use client";

import { Alert, Button, Modal, Progress, Select, Spin } from "antd";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { ScorePresentationPage } from "./ScorePresentationPage";
import { EditorModalGuard } from "./EditorModalGuard";
import {
  encodeScorePage,
  exportScoreImages,
  MAX_IMAGE_PAGES,
  pageImageName,
  prepareScoreImages,
  toImageExportError,
  ImageExportError,
  type ImageExportSnapshot,
  type PreparedScoreImages,
} from "./image-export-controller";
import styles from "./image-export.module.scss";

type ExportStatus =
  | "preparing"
  | "ready"
  | "generating"
  | "generated"
  | "failed"
  | "stale";
type ExportRange = { type: "all" } | { type: "page"; index: number };
interface DownloadState {
  url: string;
  name: string;
  range: "all" | number;
}

/** 图片 Modal 只消费打开时的已提交快照；生成任务、URL 和错误全部绑定任务令牌。 */
export const ImageExportModal = ({
  snapshot,
  returnFocus,
  onClose,
  isCurrent,
}: {
  snapshot: ImageExportSnapshot;
  returnFocus: RefObject<HTMLElement | null>;
  onClose: () => void;
  isCurrent: () => boolean;
}) => {
  const task = useRef<AbortController | null>(null);
  const taskToken = useRef(0);
  const urlRef = useRef<string | null>(null);
  const preparedRef = useRef<PreparedScoreImages | null>(null);
  const closeRef = useRef(onClose);
  const currentRef = useRef(isCurrent);
  const previousFocus = useRef<HTMLElement | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const focusRestored = useRef(false);
  const closed = useRef(false);
  const mounted = useRef(false);
  const [open, setOpen] = useState(true);
  const [prepareAttempt, setPrepareAttempt] = useState(0);
  const [prepared, setPrepared] = useState<PreparedScoreImages | null>(null);
  const [status, setStatus] = useState<ExportStatus>("preparing");
  const [error, setError] = useState<ImageExportError | null>(null);
  const [staleReason, setStaleReason] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [inspected, setInspected] = useState(0);
  const [rangeAll, setRangeAll] = useState(true);
  const [lastRange, setLastRange] = useState<ExportRange>({ type: "all" });
  const [download, setDownload] = useState<DownloadState | null>(null);

  useEffect(() => {
    closeRef.current = onClose;
    currentRef.current = isCurrent;
  }, [onClose, isCurrent]);

  const clearDownload = useCallback(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setDownload(null);
  }, []);

  const restoreFocus = useCallback(() => {
    if (focusRestored.current) return;
    focusRestored.current = true;
    // 等 AntD 清理完 portal 再还原；期间若有新对话框接管焦点则不抢。
    requestAnimationFrame(() => {
      if (document.querySelector('[role="dialog"]')) return;
      const previous = previousFocus.current;
      if (previous?.isConnected && previous.getClientRects().length)
        previous.focus({ preventScroll: true });
      else
        document
          .querySelector<SVGSVGElement>('svg[aria-label="六线谱编辑器"]')
          ?.focus();
    });
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (!previousFocus.current)
      previousFocus.current =
        returnFocus.current ??
        (document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null);
    return () => {
      mounted.current = false;
      task.current?.abort();
      taskToken.current += 1;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
      // StrictMode 的模拟卸载会立即重挂载，此时焦点仍归新 Modal，不能抢回触发器。
      setTimeout(() => {
        if (!mounted.current) restoreFocus();
      }, 0);
    };
  }, [restoreFocus, returnFocus]);

  const finishClose = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    closeRef.current();
  }, []);

  const requestClose = useCallback(() => {
    task.current?.abort();
    taskToken.current += 1;
    setProgress(0);
    setOpen(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    task.current = controller;
    let ready = false;

    const invalidate = () => {
      if (!ready) return;
      ready = false;
      controller.abort();
      task.current?.abort();
      task.current = null;
      taskToken.current += 1;
      clearDownload();
      preparedRef.current = null;
      setPrepared(null);
      setStatus("stale");
      setStaleReason("字体发生变化，请重新准备预览。");
    };
    document.fonts.addEventListener("loadingdone", invalidate);
    document.fonts.addEventListener("loadingerror", invalidate);
    void prepareScoreImages(
      snapshot.document,
      snapshot.density,
      snapshot.showChordDiagrams,
      controller.signal,
    ).then(
      (result) => {
        if (controller.signal.aborted) return;
        if (!currentRef.current()) {
          closeRef.current();
          return;
        }
        ready = true;
        preparedRef.current = result;
        setPrepared(result);
        setRangeAll(
          result.pages.length > 0 && result.pages.length <= MAX_IMAGE_PAGES,
        );
        setStatus("ready");
      },
      (cause) => {
        if (controller.signal.aborted) return;
        if (!currentRef.current()) {
          closeRef.current();
          return;
        }
        setError(toImageExportError(cause));
        setStatus("failed");
      },
    );
    return () => {
      controller.abort();
      document.fonts.removeEventListener("loadingdone", invalidate);
      document.fonts.removeEventListener("loadingerror", invalidate);
    };
  }, [snapshot, prepareAttempt, clearDownload]);

  const generate = async (target: ExportRange) => {
    if (!prepared || status === "generating" || status === "preparing") return;
    if (!currentRef.current()) {
      requestClose();
      return;
    }
    if (target.type === "all" && prepared.pages.length > MAX_IMAGE_PAGES) {
      setError(
        new ImageExportError(
          "zip-too-many-pages",
          "超过 100 页，请在预览中按页下载",
        ),
      );
      setStatus("failed");
      return;
    }
    const token = ++taskToken.current;
    task.current?.abort();
    const controller = new AbortController();
    task.current = controller;
    clearDownload();
    setError(null);
    setStaleReason(null);
    setLastRange(target);
    setProgress(target.type === "page" ? 1 : 0);
    setStatus("generating");
    try {
      const result =
        target.type === "all"
          ? await exportScoreImages(prepared, controller.signal, (page) => {
              if (taskToken.current === token && !controller.signal.aborted)
                setProgress(page);
            })
          : {
              blob: await encodeScorePage(
                prepared,
                target.index,
                controller.signal,
              ),
              name: pageImageName(prepared.title, target.index),
            };
      if (taskToken.current !== token || controller.signal.aborted) return;
      if (!currentRef.current()) {
        requestClose();
        return;
      }
      const url = URL.createObjectURL(result.blob);
      urlRef.current = url;
      setDownload({
        url,
        name: result.name,
        range: target.type === "all" ? "all" : target.index,
      });
      setProgress(prepared.pages.length);
      setStatus("generated");
    } catch (cause) {
      if (taskToken.current !== token || controller.signal.aborted) return;
      if (!currentRef.current()) {
        requestClose();
        return;
      }
      setError(toImageExportError(cause));
      setStatus("failed");
    } finally {
      if (taskToken.current === token) task.current = null;
    }
  };

  const cancel = () => {
    taskToken.current += 1;
    task.current?.abort();
    task.current = null;
    setProgress(0);
    setError(null);
    setStatus(preparedRef.current ? "ready" : "preparing");
  };

  const reprepare = () => {
    if (!currentRef.current()) {
      requestClose();
      return;
    }
    task.current?.abort();
    taskToken.current += 1;
    preparedRef.current = null;
    setPrepared(null);
    setStatus("preparing");
    setError(null);
    setStaleReason(null);
    setProgress(0);
    setInspected(0);
    setRangeAll(true);
    clearDownload();
    setPrepareAttempt((value) => value + 1);
  };

  const inspectPage = (index: number) => {
    if (status === "generating" || status === "preparing") return;
    setInspected(index);
    if (download && download.range !== "all" && download.range !== index) {
      clearDownload();
      if (status === "generated") setStatus("ready");
    }
  };

  const changeRange = (value: "all" | "page") => {
    if (status === "generating" || status === "preparing") return;
    setRangeAll(value === "all");
    if (download) {
      clearDownload();
      if (status === "generated") setStatus("ready");
    }
  };

  const pages = prepared?.pages ?? [];
  const page = pages[inspected];
  const busy = status === "preparing" || status === "generating";
  const canGenerate =
    !!prepared &&
    !busy &&
    pages.length > 0 &&
    (!rangeAll || pages.length <= MAX_IMAGE_PAGES);
  const fontError = error?.code.startsWith("font-") ?? false;
  const layoutError = error?.code.startsWith("layout-") ?? false;
  const capacityError =
    error?.code === "zip-too-many-pages" || error?.code === "zip-too-large";
  const canRetryGenerate =
    !!prepared &&
    !!error &&
    (error.code.startsWith("encode-") || error.code === "zip-failed");
  const canReprepare = !!error && (fontError || error.code === "text-measure");
  const errorTitle = layoutError
    ? "超出 A4 页面范围"
    : capacityError
      ? "图片包超出限制"
      : error?.code === "font-timeout"
        ? "字体准备超时"
        : fontError
          ? "音乐字体加载失败"
          : error?.code === "text-measure"
            ? "文字度量失败"
            : "图片生成失败";

  return (
    <Modal
      open={open}
      width={1180}
      title={
        <div className={styles.titleRow}>
          <div>
            <h2 id="image-preview-title">A4 图片预览</h2>
            <span>纵向 · 300 DPI · 白底 PNG</span>
          </div>
          <Button ref={closeButton} onClick={requestClose}>
            关闭预览
          </Button>
        </div>
      }
      footer={null}
      centered
      closable={false}
      keyboard={false}
      mask={{ closable: false }}
      focusable={{ focusTriggerAfterClose: false }}
      styles={{
        container: {
          width: 1180,
          maxWidth: "calc(100vw - 24px)",
          height: "min(860px, calc(100dvh - 24px))",
          padding: 0,
          borderRadius: 10,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        },
        header: {
          flexShrink: 0,
          margin: 0,
          padding: "18px 22px",
          borderBottom: "1px solid #e5e7eb",
        },
        title: { margin: 0 },
        body: {
          flex: 1,
          minHeight: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
        },
      }}
      modalRender={(content) => (
        <EditorModalGuard dismissable onDismiss={requestClose}>
          {content}
        </EditorModalGuard>
      )}
      afterOpenChange={(visible) => {
        if (visible) closeButton.current?.focus({ preventScroll: true });
      }}
      afterClose={() => {
        restoreFocus();
        finishClose();
      }}
    >
      <div
        className={styles.workspace}
        data-image-export-status={status}
        data-image-export-range={rangeAll ? "all" : "page"}
        data-inspected-page={inspected}
      >
        <aside className={styles.thumbnailPane} aria-label="页面缩略图">
          <h3>页面 · 共 {pages.length} 页</h3>
          {pages.length ? (
            <div className={styles.thumbnails}>
              {pages.map((item) => (
                <button
                  key={item.index}
                  type="button"
                  className={styles.thumbnailButton}
                  aria-label={`第 ${item.index + 1} 页`}
                  aria-current={item.index === inspected ? "page" : undefined}
                  disabled={busy}
                  onClick={() => inspectPage(item.index)}
                >
                  <ScorePresentationPage
                    prepared={prepared!}
                    page={item}
                    className={styles.thumbnail}
                  />
                  <span>第 {item.index + 1} 页</span>
                </button>
              ))}
            </div>
          ) : (
            <p className={styles.note}>
              {status === "preparing"
                ? "准备完成后显示页面缩略图。"
                : "当前没有可用的页面缩略图。"}
            </p>
          )}
        </aside>

        <main className={styles.previewPane} aria-label="A4 成品页预览">
          {prepared && page ? (
            <div className={styles.previewScroll}>
              <ScorePresentationPage
                prepared={prepared}
                page={page}
                className={styles.page}
              />
            </div>
          ) : (
            <div className={styles.previewEmpty}>
              {status === "preparing" ? (
                <>
                  <Spin size="small" /> 正在准备字体和分页…
                </>
              ) : (
                "当前内容无法生成 A4 预览。"
              )}
            </div>
          )}
        </main>

        <aside className={styles.settingsPane} aria-label="输出设置">
          <h3>输出设置</h3>
          <label className={styles.rangeLabel}>
            <span>输出范围</span>
            <Select<"all" | "page">
              aria-label="输出范围"
              value={rangeAll ? "all" : "page"}
              disabled={!prepared || busy}
              popupMatchSelectWidth={false}
              onChange={changeRange}
              options={[
                {
                  value: "all",
                  label: `全部 ${pages.length} 页`,
                  disabled:
                    pages.length === 0 || pages.length > MAX_IMAGE_PAGES,
                },
                {
                  value: "page",
                  label: `当前第 ${inspected + 1} 页`,
                  disabled: pages.length === 0,
                },
              ]}
            />
          </label>
          <p className={styles.meta}>
            2480 × 3508 像素 · 白底 PNG
            <br />
            多页下载为 ZIP 图片包
          </p>

          {status === "generating" ? (
            <div className={styles.status} role="status" aria-live="polite">
              <strong>
                正在生成第 {Math.max(progress, 1)} / {pages.length} 页
              </strong>
              <Progress
                percent={Math.round(
                  (Math.max(progress, 1) / Math.max(pages.length, 1)) * 100,
                )}
                status="active"
                showInfo={false}
              />
              <span className={styles.note}>请保持此窗口打开。</span>
              <Button onClick={cancel}>取消生成</Button>
            </div>
          ) : (
            <>
              {status === "preparing" && (
                <div className={styles.status} role="status">
                  <Spin size="small" /> 正在准备字体和分页…
                </div>
              )}
              {status === "stale" && (
                <Alert
                  type="error"
                  showIcon
                  title="预览已失效"
                  description={staleReason}
                />
              )}
              {status === "failed" && error && (
                <Alert
                  type={layoutError || capacityError ? "warning" : "error"}
                  showIcon
                  title={errorTitle}
                  description={error.message}
                />
              )}
              {status === "generated" && download && (
                <Alert
                  type="success"
                  showIcon
                  title={
                    download.range === "all"
                      ? "全部图片已生成"
                      : `第 ${download.range + 1} 页图片已生成`
                  }
                  description={download.name}
                />
              )}
              {pages.length > MAX_IMAGE_PAGES && (
                <Alert
                  type="warning"
                  showIcon
                  title="超过 100 页，请按页生成并下载。"
                />
              )}
              <div className={styles.actions}>
                {status === "stale" && (
                  <Button type="primary" onClick={reprepare}>
                    重新准备预览
                  </Button>
                )}
                {canReprepare && (
                  <Button type="primary" onClick={reprepare}>
                    重新准备预览
                  </Button>
                )}
                {canRetryGenerate && (
                  <Button
                    type="primary"
                    onClick={() => void generate(lastRange)}
                  >
                    重试生成
                  </Button>
                )}
                {capacityError && (
                  <Button
                    onClick={() =>
                      void generate({ type: "page", index: inspected })
                    }
                  >
                    生成第 {inspected + 1} 页
                  </Button>
                )}
                {status === "generated" && download && (
                  <>
                    <Button
                      type="primary"
                      href={download.url}
                      download={download.name}
                      onClick={(event) => {
                        if (!currentRef.current()) {
                          event.preventDefault();
                          requestClose();
                        }
                      }}
                    >
                      下载图片{download.name.endsWith(".zip") ? "包" : ""}
                    </Button>
                    <Button
                      onClick={() =>
                        void generate(
                          download.range === "all"
                            ? { type: "all" }
                            : { type: "page", index: download.range },
                        )
                      }
                    >
                      重新生成
                    </Button>
                  </>
                )}
                {layoutError && (
                  <Button onClick={requestClose}>返回编辑器调整内容</Button>
                )}
                {(fontError ||
                  error?.code === "text-measure" ||
                  capacityError) && (
                  <Button onClick={requestClose}>关闭预览</Button>
                )}
              </div>
            </>
          )}

          {status !== "generated" && status !== "generating" && (
            <div className={styles.actions}>
              <Button
                type="primary"
                loading={status === "preparing"}
                disabled={!canGenerate}
                onClick={() =>
                  void generate(
                    rangeAll
                      ? { type: "all" }
                      : { type: "page", index: inspected },
                  )
                }
              >
                {rangeAll ? "生成全部图片" : `生成第 ${inspected + 1} 页图片`}
              </Button>
              {rangeAll && (
                <Button
                  disabled={!canGenerate}
                  onClick={() =>
                    void generate({ type: "page", index: inspected })
                  }
                >
                  仅生成当前页
                </Button>
              )}
            </div>
          )}

          <p className={styles.note}>
            预览采用当前已提交内容。未应用的草稿不会进入输出。
          </p>
        </aside>
      </div>
    </Modal>
  );
};
