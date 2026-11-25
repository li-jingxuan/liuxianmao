"use client";

import { CopyOutlined, DeleteOutlined, SnippetsOutlined } from "@ant-design/icons";
import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { BarlineSymbol } from "../tools/MeasureBoundary";
import { fitContextOverlay } from "./context-panel-position";
import styles from "./ScoreContextMenu.module.scss";

const entries = [
  // 菜单入口复用小节工具中的双线符号，保持两个入口的视觉对应，并随菜单文字切换交互颜色。
  { id: "measure", label: "小节工具", icon: <BarlineSymbol value="double" />, hint: "调整当前小节的小节线，或管理小节。" },
  { id: "jumpMarks", label: "反复与跳转…", icon: "↪", hint: "在小节工具中选择反复房子、跳转或单小节重复记号。" },
  { id: "beat", label: "节奏型", icon: "♫", hint: "为当前六线谱选区选择节奏型。" },
  { id: "technique", label: "技巧", icon: "⌒", hint: "查看当前选区可用的演奏技巧。" },
  { id: "chord", label: "添加和弦", icon: "▦", hint: "在当前拍点打开和弦快捷编辑。" },
  { id: "copy", label: "复制当前小节", icon: <CopyOutlined />, hint: "选择副本要插入的位置，可以撤销。" },
] as const;

export type ScoreContextAction = (typeof entries)[number]["id"];

const numberedEntries = [
  { id: "beat", label: "节奏型", icon: "♫", tool: true },
  { id: "numberedArc", label: "圆弧/连音线", icon: "⌒", tool: true },
  { id: "tuplet", label: "连音设置", icon: "⑶", tool: true },
  { id: "copyNumbered", label: "复制简谱", icon: <CopyOutlined />, separator: true },
  { id: "pasteNumbered", label: "粘贴简谱…", icon: <SnippetsOutlined /> },
  { id: "clearNumbered", label: "清空简谱内容", icon: <DeleteOutlined />, danger: true, separator: true },
] as const;
export type NumberedScoreContextAction = (typeof numberedEntries)[number]["id"];

type MenuProps<Action extends string> = {
  point: { x: number; y: number };
  scope: string;
  disabled: Partial<Record<Action, string>>;
  active: Action | null;
  onAction: (id: Action, anchor: HTMLButtonElement) => void;
  onDismiss: (restoreFocus: boolean) => void;
};
type MenuEntry<Action extends string> = {
  id: Action; label: string; icon: ReactNode; hint?: string; tool?: boolean; danger?: boolean; separator?: boolean;
};

export function ScoreContextMenu({ chordLabel, ...props }: MenuProps<ScoreContextAction> & { chordLabel: string }) {
  return <ContextMenu {...props} title="谱面工具" entries={entries.map((entry) => ({ ...entry, tool: true,
    label: entry.id === "chord" ? chordLabel : entry.label }))} />;
}

export function NumberedScoreContextMenu(props: MenuProps<NumberedScoreContextAction>) {
  return <ContextMenu {...props} title="简谱工具" entries={numberedEntries} numbered />;
}

/** TAB 保留原来的底部提示；简谱的禁用原因直接关联菜单项，键盘移到该项时可读出。 */
function ContextMenu<Action extends string>({ point, scope, title, numbered, entries, disabled, active, onAction, onDismiss }:
  MenuProps<Action> & { title: string; numbered?: boolean; entries: readonly MenuEntry<Action>[] }) {
  const root = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLParagraphElement>(null);
  const hintId = useId();

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

  const showHint = (id: Action) => {
    const text = disabled[id] ?? entries.find((entry) => entry.id === id)?.hint;
    if (hint.current && text) hint.current.textContent = text;
  };

  return (
    <div ref={root} className={styles.menu} data-score-context-menu data-numbered-menu={numbered || undefined} onContextMenu={(event) => event.preventDefault()}>
      <header className={styles.heading}><strong>{title}</strong><span>{scope}</span></header>
      <div role="menu" aria-label={title} aria-describedby={numbered ? undefined : hintId} onKeyDown={(event) => {
        const buttons = Array.from(event.currentTarget.querySelectorAll("button"));
        const index = buttons.indexOf(event.target as HTMLButtonElement);
        if (index < 0 || event.nativeEvent.isComposing) return;
        const button = buttons[index]!;
        const count = buttons.length;
        const destinations: Record<string, number> = { ArrowDown: (index + 1) % count, ArrowUp: (index + count - 1) % count, Home: 0, End: count - 1 };
        if (event.key === "Escape" || event.key === "Tab") {
          if (active && !numbered) return;
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
        {entries.map(({ id, label, icon, tool, danger, separator }) => (
          <button key={id} role="menuitem" type="button" tabIndex={-1}
            aria-haspopup={tool ? "dialog" : undefined}
            aria-expanded={tool ? active === id : undefined}
            aria-disabled={disabled[id] ? true : undefined}
            aria-description={numbered ? disabled[id] : undefined}
            data-danger={danger || undefined} data-separator={separator || undefined}
            onFocus={() => showHint(id)} onPointerEnter={() => showHint(id)}
            onClick={(event) => { if (!disabled[id]) onAction(id, event.currentTarget); }}>
            <span className={styles.icon} aria-hidden="true">{icon}</span>
            {label}
            {tool && <span className={styles.arrow} aria-hidden="true">›</span>}
          </button>
        ))}
      </div>
      {!numbered && <p ref={hint} id={hintId} className={styles.hint} aria-live="polite">{entries[0]?.hint}</p>}
    </div>
  );
}
