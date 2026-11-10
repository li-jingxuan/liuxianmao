import { useEffect, type RefObject } from "react";

const visible = (element: HTMLElement) =>
  element.getClientRects().length > 0 &&
  getComputedStyle(element).visibility !== "hidden" &&
  !element.closest("[hidden], [aria-hidden=true]");
const focusable = (root: HTMLElement) =>
  Array.from(
    root.querySelectorAll<HTMLElement>(
      "button,input,textarea,select,a[href],[tabindex]",
    ),
  ).filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.matches(":disabled") &&
      !element.closest("[hidden],[inert]") &&
      visible(element),
  );

/** 以实际浮层域协调所有入口，包括独立输出 Modal 和文字 portal。 */
export function useWorkspaceOverlays({
  rootRef,
  workspaceRef,
  panel,
  onClose,
}: {
  rootRef: RefObject<HTMLDivElement | null>;
  workspaceRef: RefObject<HTMLDivElement | null>;
  panel: "history" | "sidebar" | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const root = rootRef.current;
    const workspace = workspaceRef.current;
    if (!root || !workspace) return;
    const managed = new Map<HTMLElement, boolean>();
    let topModal: HTMLElement | null = null;
    let previousModal: HTMLElement | null = null;
    let lastDrawerFocus: HTMLElement | null = null;
    let focusFrame = 0;
    const findTopModal = () =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '.ant-modal-wrap [role="dialog"], dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"], [data-editor-modal-domain]',
        ),
      )
        .filter(
          (element) =>
            element.id !== "editor-history-panel" &&
            element.id !== "music-text-sidebar" &&
            visible(element),
        )
        .at(-1) ?? null;
    const inert = (element: HTMLElement) => {
      if (!managed.has(element)) managed.set(element, element.inert);
      if (!element.inert) element.inert = true;
    };
    const restore = () => {
      for (const [element, previous] of managed) {
        // 文字 portal 的可见性可能在 Modal 退出期间改变；恢复当前 React 意图，
        // 不能把打开时捕获的 hidden/inert 永久写回已恢复的表面。
        const desired = element.dataset.editorInert;
        const next = desired === undefined ? previous : desired === "true";
        if (element.inert !== next) element.inert = next;
      }
      managed.clear();
    };
    const drawer = () =>
      panel === "history"
        ? workspace.querySelector<HTMLElement>("#editor-history-panel")
        : panel === "sidebar"
          ? workspace.querySelector<HTMLElement>("#music-text-sidebar")
          : null;
    const associated = (active: HTMLElement) =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          `[data-editor-associated-panel="${active.id}"]`,
        ),
      ).filter(visible);
    const inDomain = (active: HTMLElement, target: Node | null) =>
      !!target &&
      (active.contains(target) ||
        associated(active).some((surface) => surface.contains(target)));
    const domainControls = (active: HTMLElement) =>
      [active, ...associated(active)].flatMap(focusable);
    // 工具栏内的面板开关也属于抽屉操作域；只保留关联分支，继续隔离其他工具。
    const isolateOutside = (branch: HTMLElement, domains: HTMLElement[]) => {
      if (domains.some((domain) => domain === branch || domain.contains(branch)))
        return;
      if (!domains.some((domain) => branch.contains(domain))) {
        inert(branch);
        return;
      }
      for (const child of Array.from(branch.children))
        if (child instanceof HTMLElement) isolateOutside(child, domains);
    };
    const sync = () => {
      // 先恢复本 owner 设置的 inert，再判断当前最上层；不读取其他 owner 的可变业务状态。
      restore();
      topModal = findTopModal();
      const active = drawer();
      if (
        active &&
        inDomain(active, document.activeElement) &&
        document.activeElement instanceof HTMLElement
      )
        lastDrawerFocus = document.activeElement;
      if (previousModal && !topModal && active && visible(active)) {
        cancelAnimationFrame(focusFrame);
        focusFrame = requestAnimationFrame(() => {
          if (
            findTopModal() ||
            !visible(active) ||
            inDomain(active, document.activeElement)
          )
            return;
          const target =
            lastDrawerFocus?.isConnected &&
            inDomain(active, lastDrawerFocus) &&
            visible(lastDrawerFocus)
              ? lastDrawerFocus
              : domainControls(active)[0];
          target?.focus({ preventScroll: true });
        });
      }
      previousModal = topModal;
      if (topModal) {
        // 独立输出、导入确认及属性确认不一定由运行时 modal controller 创建。
        // 从实际最上层域向 body 逐级隔离兄弟分支，也覆盖内联确认和工作区外 portal。
        let domain: HTMLElement =
          topModal.closest<HTMLElement>(".ant-modal-root") ?? topModal;
        while (domain.parentElement && domain !== document.body) {
          for (const sibling of Array.from(domain.parentElement.children)) {
            if (sibling instanceof HTMLElement && sibling !== domain)
              inert(sibling);
          }
          domain = domain.parentElement;
        }
      } else if (active && visible(active)) {
        const domains = [active, ...associated(active)];
        // 仅模态抽屉启用背景 inert。portal 放在独立域，不能把 Select/Tooltip 一并屏蔽。
        for (const child of Array.from(root.children)) {
          if (
            child instanceof HTMLElement &&
            child !== workspace &&
            !child.contains(topModal)
          )
            isolateOutside(child, domains);
        }
        for (const child of Array.from(workspace.children)) {
          if (
            child instanceof HTMLElement &&
            child !== active &&
            !child.contains(active) &&
            !child.hasAttribute("data-drawer-mask") &&
            !child.contains(topModal)
          )
            inert(child);
        }
        if (topModal && !active.contains(topModal)) inert(active);
      }
      if (!topModal && active && visible(active)) {
        for (const surface of document.querySelectorAll<HTMLElement>(
          ".ant-popover, .ant-select-dropdown, .ant-dropdown, [data-music-text-floating]",
        )) {
          if (
            visible(surface) &&
            !inDomain(active, surface) &&
            !surface.contains(active)
          )
            inert(surface);
        }
      }
      if (topModal) {
        for (const popup of Array.from(
          document.querySelectorAll<HTMLElement>(
            ".ant-popover, .ant-select-dropdown, .ant-dropdown, [data-music-text-floating]",
          ),
        )) {
          if (
            visible(popup) &&
            !popup.contains(topModal) &&
            !topModal.contains(popup)
          )
            inert(popup);
        }
      }
    };
    let frame = 0;
    const schedule = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          sync();
        });
    };
    // 不观察 inert，避免本 owner 的可访问状态更新触发反馈循环。
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "aria-hidden", "open"],
    });
    sync();
    const keydown = (event: KeyboardEvent) => {
      topModal = findTopModal();
      if (topModal) return; // Modal 自己负责 busy、禁止关闭和焦点循环。
      const active = drawer();
      if (!active || !visible(active) || event.isComposing) return;
      const popupOpen = Array.from(
        document.querySelectorAll<HTMLElement>(
          '.ant-select-dropdown, .ant-dropdown, .ant-popover, [role="listbox"]',
        ),
      ).some((popup) => visible(popup) && !popup.closest("[inert]"));
      if (popupOpen) return; // Escape 先交还最上层菜单，不能连带关闭抽屉。
      if (event.key === "Escape") {
        if (
          event.target instanceof HTMLElement &&
          associated(active).some((surface) =>
            // 文字气泡自己处理 Escape；面板开关上的 Escape 则关闭抽屉。
            !surface.hasAttribute("data-editor-panel-control") &&
            surface.contains(event.target as Node),
          )
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      } else if (event.key === "Tab") {
        const controls = domainControls(active);
        const first = controls[0],
          last = controls.at(-1);
        if (!controls.length) {
          event.preventDefault();
          active.focus();
        } else if (
          (event.shiftKey && document.activeElement === first) ||
          (!event.shiftKey && document.activeElement === last) ||
          !inDomain(active, document.activeElement)
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus({ preventScroll: true });
        }
      }
    };
    const focusin = (event: FocusEvent) => {
      topModal = findTopModal();
      const active = drawer();
      if (
        active &&
        event.target instanceof HTMLElement &&
        inDomain(active, event.target)
      )
        lastDrawerFocus = event.target;
      if (
        !topModal &&
        active &&
        visible(active) &&
        event.target instanceof HTMLElement &&
        !inDomain(active, event.target) &&
        !event.target.closest(".ant-select-dropdown,.ant-popover,.ant-dropdown")
      ) {
        focusable(active)[0]?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("focusin", focusin);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(focusFrame);
      restore();
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("focusin", focusin);
    };
  }, [rootRef, workspaceRef, panel, onClose]);
}
