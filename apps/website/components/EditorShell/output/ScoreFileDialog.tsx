"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import styles from "./score-file.module.scss";

export function ScoreFileDialog({ title, wide, onClose, children }: {
  title: string;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
    return () => dialog.close();
  }, []);

  return (
    <dialog ref={ref} aria-label={title} className={`${styles.dialog}${wide ? ` ${styles.wide}` : ""}`}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onKeyDown={(event) => {
        // Keep dialog keys out of the score editor and cycle past the browser's own controls.
        event.stopPropagation();
        if (event.key === "Escape" && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault();
        if (event.key !== "Tab") return;
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>("button, input, select, a[href], summary")]
          .filter((element) => !element.matches(":disabled") && element.tabIndex >= 0 && element.getClientRects().length);
        const first = controls[0];
        const last = controls.at(-1);
        if ((event.shiftKey ? first : last) !== document.activeElement) return;
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }}>
      <h2>{title}</h2>
      {children}
    </dialog>
  );
}
