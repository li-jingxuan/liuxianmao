"use client";
import { Alert, Button, Form, Select } from "antd";
import { useCallback, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { createPortal } from "react-dom";
import {
  LXM_EDITABLE_TIME_SIGNATURES,
  applyScoreCommand,
  getMeasureCapacityTicks,
  getMeasureDurationTicks,
  LXMScoreCommandEnum as C,
  TICKS_PER_QUARTER,
  type ILXMDocument,
  type ILXMTabCellSelection,
} from "@liuxianmao/lxm-editor";
import { deriveEditorToolState } from "./editor-tool-state";
import type {
  MeasureToolTarget,
  ToolActionHandler,
} from "./editor-tool-actions";
import type { ToolNavigation } from "./editor-tool-catalog";
import editorFormStyles from "../shared/editor-form.module.scss";
import taskStyles from "../shared/SelectionTaskDetails.module.scss";
import { MeasureBoundary } from "./MeasureBoundary";
import { MeasureActions } from "./MeasureActions";
import { MeasureSymbols, resolveMeasureEndingId, type MeasureSymbolCallbacks } from "./MeasureSymbols";
import measureStyles from "./MeasureControls.module.scss";
import { formatMeasureDuration } from "../shared/measure-duration";
export { BARLINES } from "./MeasureBoundary";

/** 草稿属于当前小节和已提交的时长。上层以两者为 key，切换选区和撤销都会重置草稿。 */
function MeasureDurationField({ document, trackId, measureId, capacityTicks, durationTicks, blocked, onAction }: {
  document: ILXMDocument;
  trackId: string;
  measureId: string;
  capacityTicks: number;
  durationTicks: number;
  blocked: boolean;
  onAction: ToolActionHandler;
}) {
  const fieldId = useId();
  const [draft, setDraft] = useState(durationTicks);
  // 按四分之一拍递增，并保留导入谱的精确值和恢复满拍的入口。
  const options = useMemo(() => {
    const ticks = new Set([durationTicks, capacityTicks]);
    const step = TICKS_PER_QUARTER / 4;
    for (let value = step; value < capacityTicks; value += step) ticks.add(value);
    return [...ticks].sort((a, b) => a - b).map(value => ({ value, label: formatMeasureDuration(value) }));
  }, [capacityTicks, durationTicks]);
  const error = useMemo(() => {
    if (draft === durationTicks) return null;
    const result = applyScoreCommand(document, { type: C.SetMeasureDuration, trackId, measureId, durationTicks: draft });
    return result.ok ? null : result.message;
  }, [document, trackId, measureId, draft, durationTicks]);
  return (
    <Form.Item layout="vertical" label="小节时长" htmlFor={fieldId}>
      <div className={measureStyles.durationControl}>
        <Select id={fieldId} aria-label="当前小节时长" virtual={false}
          disabled={blocked} value={draft} options={options} onChange={setDraft} />
        <Button type="primary" disabled={blocked || draft === durationTicks || !!error}
          onClick={() => void onAction({ type: "measureDuration", durationTicks: draft, target: { trackId, measureId } })}>
          应用
        </Button>
      </div>
      {error && <Alert type="warning" showIcon title={error} />}
    </Form.Item>
  );
}

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
  measureAnchor,
  symbolCallbacks,
}: {
  ref?: Ref<{ focusBoundary: () => boolean }>;
  document: ILXMDocument;
  selection: ILXMTabCellSelection | null;
  target?: MeasureToolTarget;
  blocked: boolean;
  onAction: ToolActionHandler;
  navigate: (destination: ToolNavigation) => void;
  measureHost?: (node: HTMLDivElement | null) => void;
  measureAnchor?: MeasureToolTarget;
  symbolCallbacks?: MeasureSymbolCallbacks;
}) => {
  const signatureId = useId();
  const settingsRoot = useRef<HTMLDivElement>(null);
  const boundaryRoot = useRef<HTMLElement>(null);
  const boundaryFocusPending = useRef(false);
  const focusBoundary = useCallback(() => {
    const root = boundaryRoot.current;
    if (!root) return false;
    root.scrollIntoView({ block: "nearest" });
    root.querySelector<HTMLElement>("button:not(:disabled), [tabindex='0']")?.focus({ preventScroll: true });
    return true;
  }, []);
  useImperativeHandle(ref, () => ({ focusBoundary: () => {
    boundaryFocusPending.current = true;
    return focusBoundary();
  } }));
  const [boundaryHost, setBoundaryHost] = useState<HTMLElement | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  // 设置 owner 的插槽稍后挂载时，恢复同一次显式边界导航的标题焦点。
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
  const capacityTicks = measure ? getMeasureCapacityTicks(measure.timeSignature) : 0;
  const durationTicks = measure ? getMeasureDurationTicks(measure) : 0;
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
  const currentTarget = track && measure ? { trackId: track.id, measureId: measure.id } : undefined;
  // 用谱面顺序解析反向选择，普通记号仅限制跨小节范围，房子仍可使用整个范围。
  const anchorIndex = measureAnchor?.trackId === track?.id ? (track?.measures.findIndex(({ id }) => id === measureAnchor?.measureId) ?? -1) : -1;
  const startIndex = Math.min(anchorIndex < 0 ? index : anchorIndex, index);
  const endIndex = Math.max(anchorIndex, index);
  const measureIds = track?.measures.slice(startIndex, endIndex + 1).map(({ id }) => id) ?? [];
  const multipleMeasures = measureIds.length > 1;
  const endingId = track && resolveMeasureEndingId(track, measureIds);
  const boundary = <section ref={boundaryRoot} className={measureStyles.sidebarControls} aria-label="小节线与反复">
    <MeasureBoundary document={document} target={currentTarget} blocked={blocked || actionBusy} multipleMeasures={multipleMeasures} onAction={onAction} />
    {symbolCallbacks && track && measure && currentTarget && <MeasureSymbols document={document} trackId={track.id} measure={measure}
      multipleMeasures={multipleMeasures} blocked={blocked || actionBusy} repeatEndingId={endingId}
      repeatEndingDisabledReason={track.measures.length < 2 ? "至少需要一个共享小节和一个结尾小节" : undefined}
      onOpenRepeatEnding={() => symbolCallbacks.onOpenRepeatEnding(currentTarget, measureIds, endingId)}
      onOpenJumpMarks={(request) => symbolCallbacks.onOpenJumpMarks(currentTarget, request)}
      onOpenMeasureRepeat={() => symbolCallbacks.onOpenMeasureRepeat(currentTarget)}
      onPlaceJumpMark={symbolCallbacks.onPlaceJumpMark && ((kind) => { void symbolCallbacks.onPlaceJumpMark?.(currentTarget, kind); })} />}
    <MeasureActions document={document} target={currentTarget} blocked={blocked} onAction={onAction}
      getTargetIdentity={() => JSON.stringify({ selection, target: currentTarget, anchor: measureAnchor })} onBusyChange={setActionBusy} />
  </section>;
  return (
    <section className={`${taskStyles.noteDetails} ${taskStyles.measureDetails}`} aria-label="小节属性详情">
      {track && measure ? <>
      <div className={taskStyles.sectionHeading}>
        <h3 tabIndex={-1}>小节拍号</h3>
        <span>{atEnd ? "谱尾 · 局部设置" : "局部设置"}</span>
      </div>
        <Form.Item layout="vertical" label={`从第 ${index + 1} 小节开始`} htmlFor={signatureId}>
          <Select
            id={signatureId}
            aria-label="当前小节拍号"
            disabled={blocked}
            value={signature}
            options={options}
            onChange={(value) => void onAction({ type: "signature", value, target })}
          />
        </Form.Item>
        <MeasureDurationField key={JSON.stringify([document.score.id, track.id, measure.id, capacityTicks, durationTicks])}
          document={document} trackId={track.id} measureId={measure.id} capacityTicks={capacityTicks}
          durationTicks={durationTicks} blocked={blocked} onAction={onAction} />
      {!measureHost && <>
      <h3 tabIndex={-1}>段落标记与小节复用</h3>
      <p data-editor-form-hint className={editorFormStyles.settingsHint}>
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
