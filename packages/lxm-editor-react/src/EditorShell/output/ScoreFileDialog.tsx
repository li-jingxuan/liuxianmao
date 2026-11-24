"use client";

import { Modal } from "antd";
import { useRef, type ReactNode } from "react";
import { EditorModalGuard } from "../session/EditorModalGuard";
import styles from "./score-file.module.scss";

export function ScoreFileDialog({ title, wide, onClose, children }: {
  title: string;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const content = useRef<HTMLDivElement>(null);

  return (
    <Modal open centered width={wide ? 560 : 480} title={<h2>{title}</h2>} footer={null}
      className={styles.dialog} mask={{ closable: false }} keyboard={false} closable={false}
      focusable={{ focusTriggerAfterClose: false }} transitionName="" maskTransitionName=""
      modalRender={(node) => <EditorModalGuard ref={content} dismissable onDismiss={onClose}>{node}</EditorModalGuard>}
      afterOpenChange={(open) => {
        if (!open) return;
        const active = document.activeElement;
        // 打开回调可能晚于用户点击或按 Tab。已在对话框内操作时保留当前控件的焦点。
        if (content.current?.contains(active) && active?.matches("input,textarea,select,button,a[href],[role=combobox]")) return;
        content.current?.querySelector<HTMLElement>("[data-initial-focus]")?.focus({ preventScroll: true });
      }}>
      {children}
    </Modal>
  );
}
