"use client";
import { Alert, Button, Form, Select, Tooltip } from "antd";
import { useCallback, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from "react";
import { createPortal } from "react-dom";
import {
  LXM_EDITABLE_TIME_SIGNATURES,
  type ILXMBarlineType,
  type ILXMDocument,
  type ILXMTabCellSelection,
} from "@liuxianmao/lxm-editor";
import { deriveEditorToolState } from "./editor-tool-state";
import type {
  MeasureToolTarget,
  ToolActionHandler,
} from "./editor-tool-actions";
import type { ToolNavigation } from "./editor-tool-catalog";
import styles from "./index.module.scss";
import taskStyles from "./SelectionTaskDetails.module.scss";
export const BARLINES: { value: ILXMBarlineType; label: string }[] = [
  { value: "single", label: "单小节线" },
  { value: "double", label: "双小节线" },
  { value: "final", label: "终止线" },
  { value: "repeatStart", label: "开始反复线" },
  { value: "repeatEnd", label: "结束反复线" },
  { value: "repeatBoth", label: "双向反复线" },
];
/** 边界示意图只用于控件辨识；谱面边界仍完全由核心 scene 绘制。 */
const BarlineSymbol = ({ value }: { value: ILXMBarlineType }) => (
  <svg width="30" height="24" viewBox="0 0 30 24" aria-hidden="true">
    <path
      d="M12 2V22"
      stroke="currentColor"
      strokeWidth={value === "repeatStart" || value === "repeatBoth" ? 3 : 1}
    />
    {value !== "single" && (
      <path
        d="M18 2V22"
        stroke="currentColor"
        strokeWidth={value === "final" || value === "repeatEnd" ? 3 : 1}
      />
    )}
    {(value === "repeatEnd" || value === "repeatBoth") && (
      <>
        <circle cx="7" cy="9" r="1.5" fill="currentColor" />
        <circle cx="7" cy="15" r="1.5" fill="currentColor" />
      </>
    )}
    {(value === "repeatStart" || value === "repeatBoth") && (
      <>
        <circle cx="24" cy="9" r="1.5" fill="currentColor" />
        <circle cx="24" cy="15" r="1.5" fill="currentColor" />
      </>
    )}
  </svg>
);

/** 立即生效的小节工具与设置 owner 的常驻局部表面共用任务区。 */
export const MeasureToolDetails = ({
  ref,
  document,
  selection,
  target,
  blocked,
  onAction,
  navigate,
  measureHost,
}: {
  ref?: Ref<{ focusBoundary: () => boolean }>;
  document: ILXMDocument;
  selection: ILXMTabCellSelection | null;
  target?: MeasureToolTarget;
  blocked: boolean;
  onAction: ToolActionHandler;
  navigate: (destination: ToolNavigation) => void;
  measureHost?: (node: HTMLDivElement | null) => void;
}) => {
  const settingsRoot = useRef<HTMLDivElement>(null);
  const boundaryRoot = useRef<HTMLDetailsElement>(null);
  const boundaryFocusPending = useRef(false);
  const focusBoundary = useCallback(() => {
    const root = boundaryRoot.current;
    if (!root) return false;
    root.open = true;
    root.scrollIntoView({ block: "nearest" });
    root.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
    return true;
  }, []);
  useImperativeHandle(ref, () => ({ focusBoundary: () => {
    boundaryFocusPending.current = true;
    return focusBoundary();
  } }));
  const [boundaryHost, setBoundaryHost] = useState<HTMLElement | null>(null);
  // 设置 owner 的插槽稍后挂载时，恢复同一次显式边界导航的展开与焦点。
  useLayoutEffect(() => {
    if (boundaryFocusPending.current) {
      focusBoundary();
      if (boundaryHost) boundaryFocusPending.current = false;
    }
  }, [boundaryHost, focusBoundary]);
  const bindSettingsHost = useCallback((node: HTMLDivElement | null) => {
    settingsRoot.current = node;
    measureHost?.(node);
  }, [measureHost]);
  // 设置表面由外部 owner portal 挂入。只把即时边界工具放进其布局插槽，
  // 不复制段落字段、复制参数或任何设置草稿。
  useLayoutEffect(() => {
    const root = settingsRoot.current;
    if (!root || !measureHost) return;
    const update = () => setBoundaryHost(root.querySelector<HTMLElement>("[data-measure-boundary-host]"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [measureHost]);
  const tools = deriveEditorToolState(document, selection);
  const track = target
    ? document.score.tracks.find((item) => item.id === target.trackId)
    : tools.focused?.track;
  const index = target
    ? (track?.measures.findIndex((item) => item.id === target.measureId) ?? -1)
    : (tools.focused?.index ?? -1);
  const measure = index >= 0 ? track?.measures[index] : null;
  const signature = measure ? `${measure.timeSignature.numerator}/${measure.timeSignature.denominator}` : "";
  const options: { value: string; label: string; disabled?: boolean }[] =
    LXM_EDITABLE_TIME_SIGNATURES.map((item) => ({
      value: `${item.numerator}/${item.denominator}`,
      label: `${item.numerator}/${item.denominator}`,
    }));
  if (!options.some((item) => item.value === signature))
    options.unshift({
      value: signature,
      label: `${signature}（只读）`,
      disabled: true,
    });
  const atEnd = index === (track?.measures.length ?? 0) - 1;
  const boundaryTools = track && measure ? <div className={taskStyles.boundaryBody}>
      <div
        className={styles.barlineOptions}
        role="group"
        aria-label="六类小节线"
      >
        {BARLINES.map((barline) => {
          const unavailable =
            atEnd &&
            (barline.value === "repeatStart" || barline.value === "repeatBoth");
          return (
            <Tooltip
              key={barline.value}
              title={
                unavailable
                  ? "谱尾没有下一小节，不能设置开始或双向反复。"
                  : undefined
              }
            >
              <span tabIndex={unavailable ? 0 : undefined}>
                <Button
                  block
                  disabled={blocked || unavailable}
                  aria-pressed={measure.barline === barline.value}
                  color={
                    measure.barline === barline.value ? "primary" : "default"
                  }
                  variant={
                    measure.barline === barline.value ? "filled" : "outlined"
                  }
                  icon={<BarlineSymbol value={barline.value} />}
                  onClick={() =>
                    void onAction({
                      type: "barline",
                      value: barline.value,
                      target,
                    })
                  }
                >
                  {barline.label}
                </Button>
              </span>
            </Tooltip>
          );
        })}
      </div>
      {atEnd && (
        <Alert
          variant="filled"
          type="warning"
          showIcon
          title="谱尾没有下一小节"
          description="开始/双向反复不能写入；谱首反复只能在首小节设置。"
        />
      )}
      <Button
        block
        disabled={blocked || index !== 0}
        aria-pressed={track.startBarline === "repeatStart"}
        onClick={() => void onAction({ type: "startRepeat", target })}
      >
        谱首开始反复：{track.startBarline === "repeatStart" ? "开" : "关"}
      </Button>
      {index !== 0 && <p className={styles.settingsHint}>{tools.startRepeat.reason || "谱首反复仅对第一小节可用。"}</p>}
    </div> : null;
  const boundary = <details ref={boundaryRoot} className={`${taskStyles.disclosure} ${taskStyles.noteDisclosure}`}>
    <summary>小节线与反复<small>右边界：{BARLINES.find((item) => item.value === measure?.barline)?.label ?? "未选择"}</small></summary>
    {boundaryTools}
  </details>;
  return (
    <section className={`${taskStyles.noteDetails} ${taskStyles.measureDetails}`} aria-label="小节属性详情">
      {track && measure ? <>
      <div className={taskStyles.sectionHeading}>
        <h3 tabIndex={-1}>小节拍号</h3>
        <span>{atEnd ? "谱尾 · 局部设置" : "局部设置"}</span>
      </div>
        <Form.Item layout="vertical" label={`从第 ${index + 1} 小节开始`} htmlFor="tool-measure-signature">
          <Select
            id="tool-measure-signature"
            aria-label="当前小节拍号"
            disabled={blocked}
            value={signature}
            options={options}
            onChange={(value) => void onAction({ type: "signature", value, target })}
          />
          <p className={styles.settingsHint}>选择后生效：从第 {index + 1} 小节起，直到下一拍号变化点。</p>
        </Form.Item>
      {!measureHost && <>
      <h3 tabIndex={-1}>段落标记与小节复用</h3>
      <p className={styles.settingsHint}>
        段落：{measure.sectionLabel || "未设置"}（仅元数据）
      </p>
      <Button block onClick={() => navigate("section")}>
        编辑段落标记…
      </Button>
      <Button block onClick={() => navigate("copy")}>
        配置小节范围复制…
      </Button>
      </>}
      </> : <Alert variant="filled" type="info" title="请选择目标小节。" />}
      <div ref={bindSettingsHost} hidden={!track || !measure} data-settings-host="measure" />
      {track && measure && (boundaryHost && measureHost ? createPortal(boundary, boundaryHost) : boundary)}
    </section>
  );
};
