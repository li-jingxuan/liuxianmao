"use client";

import { useRef, useState } from "react";
import type { ILXMDocument } from "@liuxianmao/lxm-editor";
import { AnchoredToolBubble } from "./AnchoredToolBubble";
import { resolveMeasureControlTarget } from "./MeasureBoundary";
import type { MeasureCopyDestination, MeasureToolTarget } from "./editor-tool-actions";
import styles from "./AnchoredToolBubble.module.scss";

/** 来源固定为入口当时的小节。列表展示小节序号，实际提交稳定 ID，由调用方校验捕获的目标。 */
export const CopyMeasureBubble = ({ anchor, document, target, contextCopy, blocked, onCopy, onDismiss }: {
  anchor: HTMLElement;
  document: ILXMDocument;
  target: MeasureToolTarget;
  contextCopy?: boolean;
  blocked?: boolean;
  onCopy: (destination: MeasureCopyDestination) => Promise<boolean>;
  onDismiss: (restoreFocus: boolean) => void;
}) => {
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const source = resolveMeasureControlTarget(document, target);
  if (!source) return null;
  const choose = async (destination: MeasureCopyDestination) => {
    // 点击或键盘重复触发都只提交一次。取消原有影响确认后，可以继续选择位置。
    if (submitting.current || blocked) return;
    submitting.current = true;
    setBusy(true);
    try { if (await onCopy(destination)) onDismiss(!contextCopy); }
    finally { submitting.current = false; setBusy(false); }
  };
  const option = (key: string, label: string, destination: MeasureCopyDestination) =>
    <button key={key} className={styles.position} type="button" aria-disabled={busy || blocked || undefined}
      onClick={() => void choose(destination)}>{label}</button>;

  return <AnchoredToolBubble anchor={anchor} label="复制到" contextCopy={contextCopy} suspended={blocked} onDismiss={(restore) => {
    if (submitting.current) return false;
    onDismiss(restore);
  }}>
    <h4>复制到</h4>
    <p>来源 · 第 {source.index + 1} 小节</p>
    <div className={styles.positions} role="group" aria-label="插入位置" aria-busy={busy} onKeyDown={(event) => {
      const buttons = Array.from(event.currentTarget.querySelectorAll("button"));
      const index = buttons.indexOf(event.target as HTMLButtonElement);
      if (index < 0 || event.nativeEvent.isComposing) return;
      const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: buttons.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      buttons[Math.max(0, Math.min(buttons.length - 1, next))]?.focus();
    }}>
      {option("start", "曲首", { kind: "start" })}
      {option("end", "曲末", { kind: "end" })}
      {source.track.measures.map((measure, index) => option(`after:${measure.id}`, `第 ${index + 1} 小节后`, { kind: "after", measureId: measure.id }))}
    </div>
  </AnchoredToolBubble>;
};
