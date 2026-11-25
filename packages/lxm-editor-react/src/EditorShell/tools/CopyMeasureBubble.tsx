"use client";

import { Button, Modal } from "antd";
import { useId, useRef, useState } from "react";
import type { ILXMDocument } from "@liuxianmao/lxm-editor";
import { EditorModalGuard } from "../session/EditorModalGuard";
import { resolveMeasureControlTarget } from "./MeasureBoundary";
import type { MeasureCopyDestination, MeasureToolTarget } from "./editor-tool-actions";
import styles from "./MeasureControls.module.scss";

/** 来源固定为打开时的小节。位置显示谱序，实际提交稳定 ID，由入口校验文档与选区。 */
export const CopyMeasureDialog = ({ anchor, document, target, contextCopy, blocked, onCopy, onDismiss }: {
  anchor: HTMLElement;
  document: ILXMDocument;
  target: MeasureToolTarget;
  contextCopy?: boolean;
  blocked?: boolean;
  onCopy: (destination: MeasureCopyDestination) => Promise<boolean>;
  onDismiss: (restoreFocus: boolean) => void;
}) => {
  const fieldId = useId();
  const field = useRef<HTMLSelectElement>(null);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [position, setPosition] = useState("");
  const source = resolveMeasureControlTarget(document, target);
  if (!source) return null;

  const options: { label: string; destination: MeasureCopyDestination }[] = [
    { label: "曲首", destination: { kind: "start" } },
    { label: "曲末", destination: { kind: "end" } },
    ...source.track.measures.map((measure, index) => ({
      label: `第 ${index + 1} 小节后`, destination: { kind: "after" as const, measureId: measure.id },
    })),
  ];
  // 取消时保留组件到退场结束，让工作区先解除对右键菜单和小节工具的 inert 隔离。
  const dismiss = () => { if (!submitting.current) setClosing(true); };
  const submit = async () => {
    const option = position ? options[Number(position)] : undefined;
    if (!option || submitting.current || blocked || closing) return;
    // 影响确认由命令适配器负责。取消影响确认后保留这里选好的位置，允许继续编辑或取消。
    const score = contextCopy ? anchor.closest("[data-editor-shell]")?.querySelector<SVGSVGElement>(
      '[data-score-viewport] svg[aria-label="六线谱编辑器"]',
    ) : null;
    submitting.current = true;
    setBusy(true);
    try {
      if (await onCopy(option.destination)) {
        onDismiss(!contextCopy && anchor.isConnected);
        if (!score) return;
        // 右键入口在提交时就关闭。若还有结构影响确认退场，等谱面解除隔离后再补回焦点。
        // 用户已聚焦其他操作时停止等待，避免迟到的焦点恢复打断操作。
        const deadline = performance.now() + 1500;
        const restoreScoreFocus = () => {
          if (!score.isConnected) return;
          const { activeElement, body } = score.ownerDocument;
          if (activeElement !== body && !activeElement?.closest(".ant-modal-root")) return;
          if (score.closest("[inert]")) {
            if (performance.now() < deadline) requestAnimationFrame(restoreScoreFocus);
          } else if (activeElement === body) score.focus({ preventScroll: true });
        };
        requestAnimationFrame(restoreScoreFocus);
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return <Modal title="复制小节" open={!blocked && !closing} centered width={420} keyboard={false} mask={{ closable: false }}
    closable={!busy} focusable={{ focusTriggerAfterClose: false }} onCancel={dismiss}
    afterOpenChange={(visible) => {
      if (visible) field.current?.focus({ preventScroll: true });
      else if (closing) {
        // 工作区在 DOM 变更后的下一帧解除隔离，再下一帧才能安全地聚焦入口。
        requestAnimationFrame(() => requestAnimationFrame(() => onDismiss(anchor.isConnected)));
      }
    }}
    footer={(
      <>
        <Button disabled={busy} onClick={dismiss}>取消</Button>
        <Button type="primary" disabled={!position || blocked} loading={busy} onClick={() => void submit()}>复制</Button>
      </>
    )}
    modalRender={(content) => <EditorModalGuard dismissable busy={busy} onDismiss={dismiss}>{content}</EditorModalGuard>}>
    <p>来源 · 第 {source.index + 1} 小节</p>
    <label className={styles.copyPosition} htmlFor={fieldId}>
      插入位置
      <select id={fieldId} ref={field} value={position} disabled={busy || blocked} onChange={(event) => setPosition(event.target.value)}>
        <option value="">请选择插入位置</option>
        {options.map(({ label }, index) => <option key={label} value={index}>{label}</option>)}
      </select>
    </label>
  </Modal>;
};

// 谱面右键与小节工具沿用同一入口属性，复制参数统一交给 Modal。
export const CopyMeasureBubble = CopyMeasureDialog;
