"use client";

import { Alert, Button, Modal, Progress, Select, Spin } from "antd";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { EditorHost, EditorHostResult } from "../../editor-host";
import { ScorePresentationPage } from "./ScorePresentationPage";
import { EditorModalGuard } from "../session/EditorModalGuard";
import {
  MAX_IMAGE_PAGES,
  type ImageExportSnapshot,
} from "./image-export-controller";
import type { ScoreWatermark } from "./score-watermark";
import { useImageExportTask } from "./use-image-export-task";
import {
  sameWatermark,
  useWatermarkDraft,
  WatermarkForm,
} from "./WatermarkForm";
import styles from "./image-export.module.scss";

const browserPrintClosed = {
  error: false,
  text: "已关闭打印窗口，可继续编辑或重新打印。",
};
const printUnavailable = {
  error: true,
  text: "暂时无法打开打印窗口，请稍后重试。",
};

/** 谱面沿用打开时的已提交快照，水印草稿仅在当前预览试排。 */
export const ImageExportModal = ({
  snapshot,
  returnFocus,
  onClose,
  isCurrent,
  onPrint,
  writeOutput,
  watermark = null,
  onWatermarkApply,
  onSwitchPreview,
}: {
  snapshot: ImageExportSnapshot;
  returnFocus: RefObject<HTMLElement | null>;
  onClose: () => void;
  isCurrent: () => boolean;
  onPrint?: () => boolean | Promise<EditorHostResult>;
  writeOutput?: EditorHost["writeOutput"];
  watermark?: ScoreWatermark;
  onWatermarkApply?: (value: ScoreWatermark) => void;
  onSwitchPreview?: () => void;
}) => {
  const closeRef = useRef(onClose);
  const previousFocus = useRef<HTMLElement | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const focusRestored = useRef(false);
  const closed = useRef(false);
  const mounted = useRef(false);
  const previewScroll = useRef<HTMLDivElement>(null);
  const printAttempt = useRef<{ browser: boolean; afterPrint: boolean } | null>(
    null,
  );
  const [open, setOpen] = useState(true);
  const [printMessage, setPrintMessage] = useState<{
    error: boolean;
    text: string;
  }>();
  const [printBusy, setPrintBusy] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const draft = useWatermarkDraft(watermark);
  const printing = !!onPrint;

  useEffect(() => {
    if (!printing) return;
    const afterPrint = () => {
      const attempt = printAttempt.current;
      if (!attempt) return;
      // 浏览器可能在 onPrint 返回 boolean 前派发事件。宿主则只以 Promise 的结果为准。
      attempt.afterPrint = true;
      if (attempt.browser) {
        printAttempt.current = null;
        setPrintBusy(false);
        setPrintMessage(browserPrintClosed);
      }
    };
    window.addEventListener("afterprint", afterPrint);
    return () => window.removeEventListener("afterprint", afterPrint);
  }, [printing]);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  const {
    prepared,
    status,
    error,
    staleReason,
    progress,
    inspected,
    rangeAll,
    lastRange,
    download,
    saving,
    saveResult,
    save,
    generate,
    cancel,
    reprepare,
    inspectPage,
    changeRange,
    stop,
    validateCurrent,
    invalidateOutput,
  } = useImageExportTask({
    snapshot,
    isCurrent,
    writeOutput,
    watermark,
    onInvalid: (stage) => {
      // 保留准备失效直接卸载、生成失效等待关闭动画的原有时序。
      if (stage === "prepare") closeRef.current();
      else requestClose();
    },
  });

  useEffect(() => {
    previewScroll.current?.scrollTo(0, 0);
  }, [inspected, zoomed]);

  const restoreFocus = useCallback(() => {
    if (focusRestored.current) return;
    focusRestored.current = true;
    // 等 AntD 清理完 portal 再还原；期间若有新对话框接管焦点则不抢。
    requestAnimationFrame(() => {
      // 常驻工具浮窗即使隐藏也保留 dialog 角色；只有可见对话框才接管焦点。
      if (
        [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].some(
          (dialog) =>
            !dialog.hidden &&
            dialog.getAttribute("aria-hidden") !== "true" &&
            dialog.getClientRects().length > 0 &&
            getComputedStyle(dialog).visibility !== "hidden",
        )
      )
        return;
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
    if (!previousFocus.current) {
      const trigger = returnFocus.current;
      previousFocus.current =
        trigger && !trigger.closest("[inert]")
          ? trigger
          : document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
    }
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
    printAttempt.current = null;
    stop();
    setOpen(false);
  }, [stop]);

  const print = async () => {
    if (!onPrint || outputLocked || printAttempt.current || !validateCurrent())
      return;
    // 同步锁先于按钮重绘生效，避免连续点击启动两个宿主打印窗口。
    const attempt = { browser: false, afterPrint: false };
    printAttempt.current = attempt;
    setPrintMessage(undefined);
    setPrintBusy(true);
    let waitForAfterPrint = false;
    const isActive = () =>
      mounted.current && printAttempt.current === attempt && validateCurrent();
    try {
      const result = onPrint();
      if (typeof result === "boolean") {
        attempt.browser = result;
        if (!result) setPrintMessage(printUnavailable);
        else if (attempt.afterPrint) setPrintMessage(browserPrintClosed);
        // Safari 的 print() 可以先返回。浏览器分支继续等待窗口关闭事件。
        else waitForAfterPrint = true;
        return;
      }
      const outcome = await result;
      if (!isActive()) return;
      if (outcome.status === "ok") {
        setPrintMessage({ error: false, text: "已提交打印。" });
      } else if (outcome.status === "cancelled") {
        setPrintMessage({ error: false, text: "已取消打印，可重新打印。" });
      } else {
        setPrintMessage({
          error: true,
          text: outcome.message || printUnavailable.text,
        });
      }
    } catch (cause) {
      if (isActive()) {
        setPrintMessage({
          error: true,
          text:
            cause instanceof Error && cause.message
              ? cause.message
              : printUnavailable.text,
        });
      }
    } finally {
      if (
        !waitForAfterPrint &&
        mounted.current &&
        printAttempt.current === attempt
      ) {
        printAttempt.current = null;
        setPrintBusy(false);
      }
    }
  };

  const pages = prepared?.pages ?? [];
  const page = pages[inspected];
  const outputBusy = saving || printBusy;
  const busy =
    !open || status === "preparing" || status === "generating" || outputBusy;
  // 由会话持有并同步打印层的水印才能编辑；只传生效值时照常渲染谱页。
  const watermarkPending = !!onWatermarkApply && draft.dirty;
  const previewTrial = onWatermarkApply ? draft.trial : undefined;
  const outputLocked = busy || watermarkPending;
  const canGenerate =
    !!prepared &&
    !outputLocked &&
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
  const applyWatermark = (value: ScoreWatermark) => {
    if (!onWatermarkApply || busy || printAttempt.current || !validateCurrent())
      return false;
    if (!sameWatermark(value, watermark)) {
      // 应用与旧成品作废在同一交互内完成。还原和仅整理空白时保留原文件与保存反馈。
      invalidateOutput();
      setPrintMessage(undefined);
      onWatermarkApply(value);
    }
    return true;
  };
  const switchPreview = () => {
    if (outputLocked || printAttempt.current || !validateCurrent()) return;
    // 互切沿用当前页和范围，同时撤下上一种模式的交付结果。
    invalidateOutput();
    setPrintMessage(undefined);
    onSwitchPreview?.();
  };
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
            <h2>{onPrint ? "A4 打印预览" : "A4 图片预览"}</h2>
            <span>{onPrint ? "A4 纵向" : "纵向 · 300 DPI · 白底 PNG"}</span>
          </div>
          <div className={styles.headerActions}>
            {onSwitchPreview && (
              <div
                className={styles.modeSwitch}
                role="group"
                aria-label="预览方式"
              >
                <Button
                  autoInsertSpace={false}
                  aria-pressed={!printing}
                  disabled={outputLocked}
                  onClick={printing ? switchPreview : undefined}
                >
                  图片
                </Button>
                <Button
                  autoInsertSpace={false}
                  aria-pressed={printing}
                  disabled={outputLocked}
                  onClick={!printing ? switchPreview : undefined}
                >
                  打印
                </Button>
              </div>
            )}
            <Button
              ref={closeButton}
              disabled={outputBusy}
              onClick={requestClose}
            >
              关闭预览
            </Button>
          </div>
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
        <EditorModalGuard
          dismissable
          busy={outputBusy}
          onDismiss={requestClose}
        >
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
                    watermark={watermark}
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
            <>
              <div
                ref={previewScroll}
                className={styles.previewScroll}
                data-zoomed={zoomed}
              >
                <ScorePresentationPage
                  prepared={prepared}
                  page={page}
                  className={styles.page}
                  watermark={previewTrial ?? watermark}
                />
              </div>
              <div className={styles.previewTools}>
                <div className={styles.pager}>
                  <Button
                    type="text"
                    size="small"
                    aria-label="上一页"
                    disabled={busy || inspected === 0}
                    onClick={() => inspectPage(inspected - 1)}
                  >
                    ‹
                  </Button>
                  <span>
                    {inspected + 1} / {pages.length}
                  </span>
                  <Button
                    type="text"
                    size="small"
                    aria-label="下一页"
                    disabled={busy || inspected + 1 >= pages.length}
                    onClick={() => inspectPage(inspected + 1)}
                  >
                    ›
                  </Button>
                </div>
                <Button
                  type="text"
                  size="small"
                  aria-pressed={zoomed}
                  disabled={busy}
                  onClick={() => setZoomed(!zoomed)}
                >
                  {zoomed ? "适应整页" : "放大查看"}
                </Button>
                {previewTrial && (
                  <span className={styles.trial}>当前页试排</span>
                )}
              </div>
            </>
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

        <aside
          className={styles.settingsPane}
          aria-label={printing ? "打印设置" : "输出设置"}
        >
          {onWatermarkApply && (
            <WatermarkForm
              draft={draft}
              disabled={busy}
              onApply={applyWatermark}
            />
          )}
          {watermarkPending && (
            <p className={styles.note}>请先应用或还原水印，再输出曲谱。</p>
          )}
          {printing ? (
            <>
              <h3>打印</h3>
              <p className={styles.note}>
                在打印窗口中可选择打印机或另存为 PDF。
              </p>
              <Button
                type="primary"
                aria-label="打开打印窗口"
                aria-busy={printBusy}
                disabled={!prepared || pages.length === 0 || outputLocked}
                loading={printBusy}
                onClick={() => void print()}
              >
                打开打印窗口
              </Button>
              {error && (
                <Alert
                  type="error"
                  showIcon
                  title={errorTitle}
                  description={error.message}
                />
              )}
              {(status === "stale" || canReprepare) && (
                <Button disabled={outputLocked} onClick={reprepare}>
                  重新准备预览
                </Button>
              )}
              {printMessage && (
                <p role={printMessage.error ? "alert" : "status"}>
                  {printMessage.text}
                </p>
              )}
            </>
          ) : (
            <>
              <h3>输出设置</h3>
              <label className={styles.rangeLabel}>
                <span>输出范围</span>
                <Select<"all" | "page">
                  getPopupContainer={(trigger: HTMLElement) =>
                    trigger.closest<HTMLElement>('[role="dialog"]') ??
                    document.body
                  }
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
                {writeOutput
                  ? "多页保存为 ZIP 图片包"
                  : "多页下载为 ZIP 图片包"}
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
                  {status === "generated" && download && !watermarkPending && (
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
                  {saveResult && !watermarkPending && (
                    <p
                      role={saveResult.status === "error" ? "alert" : "status"}
                    >
                      {saveResult.status === "ok"
                        ? "图片文件已保存。"
                        : saveResult.status === "cancelled"
                          ? "已取消保存，可再次保存。"
                          : saveResult.message || "暂时无法保存图片，请重试。"}
                    </p>
                  )}
                  {pages.length > MAX_IMAGE_PAGES && (
                    <Alert
                      type="warning"
                      showIcon
                      title={
                        writeOutput
                          ? "超过 100 页，请按页生成并保存。"
                          : "超过 100 页，请按页生成并下载。"
                      }
                    />
                  )}
                  <div className={styles.actions}>
                    {status === "stale" && (
                      <Button
                        type="primary"
                        disabled={outputLocked}
                        onClick={reprepare}
                      >
                        重新准备预览
                      </Button>
                    )}
                    {canReprepare && (
                      <Button
                        type="primary"
                        disabled={outputLocked}
                        onClick={reprepare}
                      >
                        重新准备预览
                      </Button>
                    )}
                    {canRetryGenerate && (
                      <Button
                        type="primary"
                        disabled={outputLocked}
                        onClick={() => void generate(lastRange)}
                      >
                        重试生成
                      </Button>
                    )}
                    {capacityError && (
                      <Button
                        disabled={outputLocked}
                        onClick={() =>
                          void generate({ type: "page", index: inspected })
                        }
                      >
                        生成第 {inspected + 1} 页
                      </Button>
                    )}
                    {status === "generated" &&
                      download &&
                      !watermarkPending && (
                        <>
                          {"url" in download ? (
                            !busy && (
                              <Button
                                type="primary"
                                href={download.url}
                                download={download.name}
                                onClick={(event) => {
                                  if (!validateCurrent())
                                    event.preventDefault();
                                }}
                              >
                                下载图片
                                {download.name.endsWith(".zip") ? "包" : ""}
                              </Button>
                            )
                          ) : (
                            <Button
                              type="primary"
                              aria-label={
                                download.name.endsWith(".zip")
                                  ? "保存图片包"
                                  : "保存图片"
                              }
                              aria-busy={saving}
                              disabled={outputLocked}
                              loading={saving}
                              onClick={() => void save()}
                            >
                              保存图片
                              {download.name.endsWith(".zip") ? "包" : ""}
                            </Button>
                          )}
                          <Button
                            disabled={outputLocked}
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
                    {rangeAll
                      ? "生成全部图片"
                      : `生成第 ${inspected + 1} 页图片`}
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
            </>
          )}
        </aside>
      </div>
    </Modal>
  );
};
