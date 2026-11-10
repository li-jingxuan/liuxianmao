"use client";

import { useRef, useEffect, type ReactNode } from "react";
import { createScoreSettingsComposition } from "./score-settings-composition";

/** 同一 Tab 首尾循环与 Escape 语义供所有受控 Modal 复用。 */
export const EditorModalGuard = ({
  dismissable,
  busy = false,
  onDismiss,
  children,
}: {
  dismissable: boolean;
  busy?: boolean;
  onDismiss: () => void;
  children: ReactNode;
}) => {
  const composition = useRef(createScoreSettingsComposition(() => {}));
  useEffect(() => () => composition.current.dispose(), []);
  return (
    <div
      onCompositionStart={() => composition.current.start()}
      onCompositionEnd={() => composition.current.end()}
      onKeyDown={(event) => {
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
              "button,input,select,textarea,a[href],[tabindex]",
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
