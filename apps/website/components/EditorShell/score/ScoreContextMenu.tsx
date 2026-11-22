"use client";

import { CopyOutlined } from "@ant-design/icons";
import { useEffect, useLayoutEffect, useRef } from "react";
import { fitContextOverlay } from "./context-panel-position";
import styles from "./ScoreContextMenu.module.scss";

const entries = [
  { id: "measure", label: "小节工具", icon: "││", hint: "调整当前小节的小节线，或管理小节。" },
  { id: "beat", label: "节奏型", icon: "♫", hint: "为当前六线谱选区选择节奏型。" },
  { id: "technique", label: "技巧", icon: "⌒", hint: "查看当前选区可用的演奏技巧。" },
  { id: "chord", label: "添加和弦", icon: "▦", hint: "在当前拍点打开和弦快捷编辑。" },
  { id: "copy", label: "复制当前小节", icon: null, hint: "选择副本要插入的位置，可以撤销。" },
] as const;

export type ScoreContextAction = (typeof entries)[number]["id"];

export function ScoreContextMenu({ point, scope, chordLabel, disabled, active, onAction, onDismiss }: {
  point: { x: number; y: number };
  scope: string;
  chordLabel: string;
  disabled: Partial<Record<ScoreContextAction, string>>;
  active: ScoreContextAction | null;
  onAction: (id: ScoreContextAction, anchor: HTMLButtonElement) => void;
  onDismiss: (restoreFocus: boolean) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    const menu = root.current;
    if (!menu) return;
    const align = () => {
      const { left, top } = fitContextOverlay(point.x, point.y, menu.offsetWidth, menu.offsetHeight);
      Object.assign(menu.style, { left: `${left}px`, top: `${top}px` });
    };
    align();
    menu.querySelector("button")?.focus({ preventScroll: true });
    window.addEventListener("resize", align);
    return () => window.removeEventListener("resize", align);
  }, [point]);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target;
      // 工具常经由 portal 渲染。与菜单属于同一交互，点击内部字段或选项时都要保留菜单锚点。
      if (!(target instanceof Element) || target.closest(
        "[data-score-context-menu], [data-score-context-panel], [data-editor-anchored-tool], .ant-popover:has([data-score-context-panel]), .ant-select-dropdown, .ant-modal-root",
      )) return;
      onDismiss(false);
    };
    window.addEventListener("pointerdown", outside, true);
    return () => window.removeEventListener("pointerdown", outside, true);
  }, [onDismiss]);

  const showHint = (id: ScoreContextAction) => {
    const text = disabled[id] ?? entries.find((entry) => entry.id === id)?.hint;
    if (hint.current && text) hint.current.textContent = text;
  };

  return (
    <div ref={root} className={styles.menu} data-score-context-menu onContextMenu={(event) => event.preventDefault()}>
      <header className={styles.heading}><strong>谱面工具</strong><span>{scope}</span></header>
      <div role="menu" aria-label="谱面工具" aria-describedby="score-context-hint" onKeyDown={(event) => {
        const buttons = Array.from(event.currentTarget.querySelectorAll("button"));
        const index = buttons.indexOf(event.target as HTMLButtonElement);
        if (index < 0 || event.nativeEvent.isComposing) return;
        const button = buttons[index]!;
        const count = buttons.length;
        const destinations: Record<string, number> = { ArrowDown: (index + 1) % count, ArrowUp: (index + count - 1) % count, Home: 0, End: count - 1 };
        if (event.key === "Escape" || event.key === "Tab") {
          if (active) return;
          event.preventDefault();
          event.stopPropagation();
          onDismiss(true);
        } else if (event.key === "ArrowRight" && button.hasAttribute("aria-haspopup")) {
          event.preventDefault();
          button.click();
        } else if (Object.hasOwn(destinations, event.key)) {
          event.preventDefault();
          buttons[destinations[event.key]!]!.focus();
        }
      }}>
        {entries.map(({ id, label, icon }) => (
          <button key={id} role="menuitem" type="button" tabIndex={-1}
            aria-haspopup="dialog"
            aria-expanded={active === id}
            aria-disabled={disabled[id] ? true : undefined}
            onFocus={() => showHint(id)} onPointerEnter={() => showHint(id)}
            onClick={(event) => { if (!disabled[id]) onAction(id, event.currentTarget); }}>
            <span className={styles.icon} aria-hidden="true">{icon ?? <CopyOutlined />}</span>
            {id === "chord" ? chordLabel : label}
            <span className={styles.arrow} aria-hidden="true">›</span>
          </button>
        ))}
      </div>
      <p ref={hint} id="score-context-hint" className={styles.hint} aria-live="polite">{entries[0].hint}</p>
    </div>
  );
}
