"use client";

import { useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from "react";
import { AnchoredToolBubble } from "./AnchoredToolBubble";
import { EditorToolSymbolButton, TechniqueSymbol } from "./EditorToolSymbolButton";
import type { NumberedArcKind, NumberedArcOptions } from "./editor-tie-target";
import styles from "./NumberedArcTool.module.scss";

const commands = [
  { kind: "tie", label: "延音线", detail: "同音持续发声" },
  { kind: "slur", label: "圆滑线", detail: "各音保留原时值" },
] as const;

type ArcEntry = { anchor: HTMLElement; onClose?: () => void };
export interface NumberedArcToolController {
  openContextTool: (anchor: HTMLElement, onClose: () => void) => boolean;
  closeContextTool: () => boolean;
  getDisabledReason: () => string | null;
}

export function NumberedArcTool({ ref, options, blocked, onApply }: {
  ref?: Ref<NumberedArcToolController>;
  options: NumberedArcOptions;
  blocked: boolean;
  onApply: (kind: NumberedArcKind) => Promise<boolean>;
}) {
  const id = useId();
  const [entry, setEntry] = useState<ArcEntry | null>(null);
  const liveEntry = useRef<ArcEntry | null>(null);
  const updateEntry = (next: ArcEntry | null) => {
    liveEntry.current = next;
    setEntry(next);
  };
  const submitting = useRef(false);
  const anchor = entry?.anchor ?? null;
  const inContext = !!entry?.onClose;
  const open = !!entry && !blocked;
  const close = (restoreFocus: boolean) => {
    const previous = liveEntry.current;
    if (!previous) return;
    updateEntry(null);
    previous.onClose?.();
    // 收起后按钮样式会切换。等 React 更新后，从稳定的锚点找到当前按钮再恢复焦点。
    if (restoreFocus && !blocked) requestAnimationFrame(() => {
      const trigger = previous.onClose ? previous.anchor : previous.anchor.querySelector<HTMLButtonElement>("button:not(:disabled)");
      if (!liveEntry.current && trigger?.isConnected) trigger.focus({ preventScroll: true });
    });
  };
  const getDisabledReason = () => blocked || submitting.current ? "请先完成当前草稿或确认操作。" : null;
  useImperativeHandle(ref, () => ({
    openContextTool: (anchor, onClose) => {
      if (!anchor.isConnected || getDisabledReason()) return false;
      if (liveEntry.current?.anchor === anchor) { close(true); return false; }
      close(false);
      // 右键菜单只是另一个锚点，内容、提交锁和气泡与工具栏按钮共用。
      updateEntry({ anchor, onClose });
      return true;
    },
    closeContextTool: () => {
      if (liveEntry.current?.onClose) close(false);
      return true;
    },
    getDisabledReason,
  }));
  useEffect(() => () => {
    // 选区变化会卸载原工具，清除以前的菜单展开状态。
    const previous = liveEntry.current;
    liveEntry.current = null;
    previous?.onClose?.();
  }, []);

  // 阻止连续点击把一次提交变成重复添加或移除。等待结果时如焦点已移走，关闭气泡时保留新焦点。
  const apply = async (kind: NumberedArcKind) => {
    if (blocked || submitting.current || !options[kind].ok) return;
    submitting.current = true;
    const previous = liveEntry.current;
    try {
      if (await onApply(kind) && liveEntry.current === previous) {
        const focusInBubble = !!anchor?.ownerDocument.activeElement?.closest("[data-numbered-arc-options]");
        close(focusInBubble);
      }
    } finally {
      submitting.current = false;
    }
  };

  return <>
    <EditorToolSymbolButton label="简谱弧线" showDisabledReason={false} popup expanded={open && !inContext}
      availability={{ enabled: !blocked, reason: blocked ? "请先完成当前草稿或确认操作。" : "" }}
      onClick={(trigger) => {
        if (submitting.current) return;
        if (open && !inContext) close(true);
        else { close(false); updateEntry({ anchor: trigger }); }
      }}>
      <TechniqueSymbol kind="tie" />
    </EditorToolSymbolButton>
    <AnchoredToolBubble anchor={open ? anchor : null} label="选择简谱弧线" compactCentered
      contextPanel={inContext ? "numberedArc" : undefined} dismissOnOutside={!inContext} onDismiss={close}>
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
