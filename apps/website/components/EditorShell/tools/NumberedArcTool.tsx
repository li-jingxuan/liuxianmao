"use client";

import { useId, useRef, useState } from "react";
import { AnchoredToolBubble } from "./AnchoredToolBubble";
import { EditorToolSymbolButton, TechniqueSymbol } from "./EditorToolSymbolButton";
import type { NumberedArcKind, NumberedArcOptions } from "./editor-tie-target";
import styles from "./NumberedArcTool.module.scss";

const commands = [
  { kind: "tie", label: "延音线", detail: "同音持续发声" },
  { kind: "slur", label: "圆滑线", detail: "各音保留原时值" },
] as const;

export function NumberedArcTool({ options, blocked, onApply }: {
  options: NumberedArcOptions;
  blocked: boolean;
  onApply: (kind: NumberedArcKind) => Promise<boolean>;
}) {
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const submitting = useRef(false);
  const open = !!anchor && !blocked;
  const close = (restoreFocus: boolean) => {
    setAnchor(null);
    // 收起后按钮样式会切换。等 React 更新后，从稳定的锚点找到当前按钮再恢复焦点。
    if (restoreFocus && !blocked)
      requestAnimationFrame(() => anchor?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true }));
  };

  // 阻止连续点击把一次提交变成重复添加或移除。等待结果时如焦点已移走，关闭气泡时保留新焦点。
  const apply = async (kind: NumberedArcKind) => {
    if (blocked || submitting.current || !options[kind].ok) return;
    submitting.current = true;
    try {
      if (await onApply(kind)) {
        const focusInBubble = !!anchor?.ownerDocument.activeElement?.closest("[data-numbered-arc-options]");
        close(focusInBubble);
      }
    } finally {
      submitting.current = false;
    }
  };

  return <>
    <EditorToolSymbolButton label="简谱弧线" popup expanded={open}
      availability={{ enabled: !blocked, reason: blocked ? "请先完成当前草稿或确认操作。" : "" }}
      onClick={(trigger) => { if (open) close(true); else setAnchor(trigger); }}>
      <TechniqueSymbol kind="tie" />
    </EditorToolSymbolButton>
    <AnchoredToolBubble anchor={open ? anchor : null} label="选择简谱弧线" compactCentered onDismiss={close}>
      <div className={styles.commands} data-numbered-arc-options>
        {commands.map(({ kind, label, detail }) => {
          const option = options[kind];
          const removal = option.ok && option.pressed;
          const recommended = options.recommended === kind && !removal;
          const labelId = `${id}-${kind}`;
          return <button key={kind} type="button" className={styles.command} disabled={!option.ok}
            aria-labelledby={labelId} aria-describedby={`${labelId}-detail${recommended ? ` ${labelId}-recommendation` : ""}`}
            data-recommended={recommended || undefined} data-bubble-initial-focus={recommended || undefined}
            onClick={() => void apply(kind)}>
            <span className={styles.curve} data-kind={kind} aria-hidden="true" />
            <span className={styles.label} id={labelId}>{removal ? `移除${label}` : label}</span>
            {recommended && <span id={`${labelId}-recommendation`} className={styles.badge}>推荐</span>}
            <span id={`${labelId}-detail`} className={styles.detail}>{option.ok ? (removal ? "移除当前记号" : detail) : option.message}</span>
          </button>;
        })}
      </div>
    </AnchoredToolBubble>
  </>;
}
