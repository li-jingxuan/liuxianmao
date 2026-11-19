"use client";

import { useRef, useEffect, type ReactNode, type Ref } from "react";
import { createScoreSettingsComposition } from "../settings/score-settings-composition";

/** 同一 Tab 首尾循环与 Escape 语义供所有受控 Modal 复用。 */
export const EditorModalGuard = ({
  dismissable,
  busy = false,
  onDismiss,
  children,
  ref,
}: {
  dismissable: boolean;
  busy?: boolean;
  onDismiss: () => void;
  children: ReactNode;
  ref?: Ref<HTMLDivElement>;
}) => {
  const composition = useRef(createScoreSettingsComposition(() => {}));
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => () => composition.current.dispose(), []);
  useEffect(() => {
    // AntD 6 的初始焦点在 modalRender 外层 dialog；这一路也必须消费 Esc。
    const dialog = root.current?.closest<HTMLElement>('[role="dialog"]');
    if (!dialog) return;
    const handleDialogKey = (event: globalThis.KeyboardEvent) => {
      if (event.target !== dialog || event.key !== "Escape") return;
      event.stopPropagation();
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || composition.current.isComposing()) return;
      event.preventDefault();
      if (!event.repeat && dismissable && !busy) onDismiss();
    };
    dialog.addEventListener("keydown", handleDialogKey);
    return () => dialog.removeEventListener("keydown", handleDialogKey);
  }, [busy, dismissable, onDismiss]);
  return (
    <div
      ref={node => {
        root.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
      onCompositionStart={() => composition.current.start()}
      onCompositionEnd={() => composition.current.end()}
      onKeyDown={(event) => {
        // 子 Modal 的 portal 在 React 树内冒泡；只处理当前实际 dialog 的按键。
        const targetDialog = (event.target as HTMLElement | undefined)?.closest?.('[role="dialog"]');
        if (targetDialog && targetDialog !== root.current?.closest('[role="dialog"]')) return;
        composition.current.observeKey(event.nativeEvent);
        if (event.repeat && ["Enter", " ", "Escape"].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        // 原生 Tab 从最后控件可能直接进入浏览器工具栏，不产生可供框架拦截的 focusin。
        // 在首尾主动循环，保留正文中各控件原有的键盘行为。
        if (event.key === "Tab") {
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              "button,input,select,textarea,a[href],summary,[tabindex]",
            ),
          ).filter(
            (element) =>
              element.tabIndex >= 0 &&
              !element.matches(":disabled") &&
              !element.closest("[hidden],[inert]") &&
              element.getClientRects().length > 0,
          );
          const first = controls[0];
          const last = controls.at(-1);
          const current = document.activeElement;
          if (
            (event.shiftKey && current === first) ||
            (!event.shiftKey && current === last)
          ) {
            event.preventDefault();
            (event.shiftKey ? last : first)?.focus({ preventScroll: true });
          }
        }
        // portal 保留挂载时仍不能越过最上层 Modal；中文组合 Esc 保留输入法行为。
        if (event.key === "Escape") {
          event.stopPropagation();
          if (
            event.defaultPrevented ||
            event.nativeEvent.isComposing ||
            event.keyCode === 229 ||
            composition.current.isComposing()
          )
            return;
          const popupOpen =
            event.currentTarget.querySelector(
              '.ant-select-open,[aria-expanded="true"][aria-haspopup]',
            ) ||
            Array.from(
              document.querySelectorAll(".ant-select-dropdown,.ant-dropdown"),
            ).some(
              (e) =>
                e.getClientRects().length &&
                !e.classList.contains("ant-select-dropdown-hidden") &&
                !e.classList.contains("ant-dropdown-hidden"),
            );
          if (popupOpen) return;
          if (dismissable && !busy) {
            event.preventDefault();
            onDismiss();
          }
        }
      }}
    >
      {children}
    </div>
  );
};
