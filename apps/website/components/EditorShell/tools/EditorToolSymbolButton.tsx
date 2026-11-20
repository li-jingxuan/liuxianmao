"use client";
import { Button, Tooltip } from "antd";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { ToolAvailability } from "./editor-tool-state";
import styles from "./EditorToolSymbolButton.module.scss";

/** A named symbol with a viewport-bounded tooltip outside the toolbar's scrolling clip. */
export const EditorToolSymbolButton = ({ label, title, disabledTitle, availability, pressed, expanded, popup, onClick, children, triggerId }: {
  label: string; title?: ReactNode; disabledTitle?: ReactNode; availability: ToolAvailability; pressed?: boolean; expanded?: boolean;
  popup?: boolean; onClick: () => void; children: ReactNode; triggerId?: string;
}) => {
  const id = useId();
  const wrapper = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const text = availability.reason ? (disabledTitle ?? availability.reason) : (title ?? label);
  useEffect(() => {
    if (!visible || expanded) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing && event.keyCode !== 229) {
        setVisible(false);
        if (wrapper.current?.contains(event.target as Node)) {
          event.preventDefault();
          event.stopPropagation();
        }
      }
    };
    const hide = () => setVisible(false);
    const focus = (event: FocusEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) hide();
    };
    window.addEventListener("keydown", escape, true);
    window.addEventListener("pointerdown", hide, true);
    window.addEventListener("focusin", focus, true);
    return () => {
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("pointerdown", hide, true);
      window.removeEventListener("focusin", focus, true);
    };
  }, [visible, expanded]);
  const open = visible && !expanded;
  return <Tooltip id={id} title={text} placement="bottom" trigger={["hover", "focus"]}
    open={open} onOpenChange={(next) => setVisible(next && !expanded)} mouseEnterDelay={0.3} zIndex={2200}
    classNames={{ root: styles.tooltip }}
    getPopupContainer={(node) => node.closest<HTMLElement>("[data-editor-interactive-domain], [role=dialog]") ?? window.document.body}>
    <span ref={wrapper} className={styles.wrap} tabIndex={!availability.enabled ? 0 : undefined}
      aria-label={!availability.enabled ? label : undefined} aria-describedby={!availability.enabled && open ? id : undefined} onPointerDown={() => setVisible(false)}>
      <Button className={styles.button} aria-label={label} aria-describedby={open ? id : undefined}
        aria-pressed={pressed} aria-expanded={expanded} aria-haspopup={popup ? "dialog" : undefined}
        data-tool-trigger={triggerId} disabled={!availability.enabled} color={pressed || expanded ? "primary" : "default"}
        variant={pressed || expanded ? "filled" : "text"} onClick={(event) => { event.stopPropagation(); setVisible(false); onClick(); }}>{children}</Button>
    </span>
  </Tooltip>;
};

export const TechniqueSymbol = ({ kind }: { kind: "slideUp" | "slideDown" | "tie" | "strumDown" | "strumUp" | "arpeggioDown" | "arpeggioUp" | "technique" | "rest" }) =>
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {kind === "rest" ? <text x="12" y="12" textAnchor="middle" dominantBaseline="central" className={styles.musicGlyph} fill="currentColor" stroke="none">{"\uE4E5"}</text>
      : kind === "tie" ? <path d="M4 16C7 7 17 7 20 16C16 10 8 10 4 16Z" fill="currentColor" stroke="none" />
      : kind === "slideUp" ? <><path d="m5 18 14-12M15 6h4v4" /><path d="M4 7h5M15 18h5" /></>
      : kind === "slideDown" ? <><path d="m5 6 14 12M15 18h4v-4" /><path d="M4 17h5M15 6h5" /></>
      : kind === "arpeggioDown" || kind === "arpeggioUp" ? <><path d="M9 20c-7-2 7-5 0-7s7-5 0-7" />{kind === "arpeggioDown"
        ? <path d="M17 20V4m-3 3 3-3 3 3" /> : <path d="M17 4v16m-3-3 3 3 3-3" />}</>
      : kind === "technique" ? <><path d="M5 18V9m0 1c4-8 9-8 13-3m-3 5 3-5 2 5M10 18c1-2 2 2 3 0s2 2 3 0" /><ellipse cx="3.5" cy="19" rx="2" ry="1.5" fill="currentColor" /></>
      : <><path d="M5 7h6M5 12h6M5 17h6" />{kind === "strumDown"
        ? <path d="M17 20V4m-4 4 4-4 4 4" />
        : <path d="M17 4v16m-4-4 4 4 4-4" />}</>}
  </svg>;
