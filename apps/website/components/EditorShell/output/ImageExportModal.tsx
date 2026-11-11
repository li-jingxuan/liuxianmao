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
import { EditorModalGuard } from "../session/EditorModalGuard";
import {
  MAX_IMAGE_PAGES,
  type ImageExportSnapshot,
} from "./image-export-controller";
import { useImageExportTask } from "./use-image-export-task";
import styles from "./image-export.module.scss";

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
  const closeRef = useRef(onClose);
  const previousFocus = useRef<HTMLElement | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const focusRestored = useRef(false);
  const closed = useRef(false);
  const mounted = useRef(false);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  const {
    prepared, status, error, staleReason, progress, inspected, rangeAll,
    lastRange, download, generate, cancel, reprepare, inspectPage, changeRange,
    stop, validateCurrent,
  } = useImageExportTask({
    snapshot,
    isCurrent,
    onInvalid: (stage) => {
      // 保留准备失效直接卸载、生成失效等待关闭动画的原有时序。
      if (stage === "prepare") closeRef.current();
      else requestClose();
    },
  });

  const restoreFocus = useCallback(() => {
    if (focusRestored.current) return;
    focusRestored.current = true;
    // 等 AntD 清理完 portal 再还原；期间若有新对话框接管焦点则不抢。
    requestAnimationFrame(() => {
      // 常驻工具浮窗即使隐藏也保留 dialog 角色；只有可见对话框才接管焦点。
      if ([...document.querySelectorAll<HTMLElement>('[role="dialog"]')].some(
        (dialog) => !dialog.hidden && dialog.getAttribute("aria-hidden") !== "true" &&
          dialog.getClientRects().length > 0 && getComputedStyle(dialog).visibility !== "hidden",
      )) return;
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
    stop();
    setOpen(false);
  }, [stop]);

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
              getPopupContainer={(trigger: HTMLElement) => trigger.closest<HTMLElement>('[role="dialog"]') ?? document.body}
              styles={{ popup: { root: { pointerEvents: "auto" } } }}
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
                        if (!validateCurrent()) {
                          event.preventDefault();
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
