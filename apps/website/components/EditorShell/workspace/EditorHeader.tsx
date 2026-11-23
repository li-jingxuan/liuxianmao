"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { Dropdown } from "antd";
import { DownOutlined } from "@ant-design/icons";
import type { ScoreFileStatus } from "../../../stores/editor-store";
import { BrandIcon } from "../../BrandIcon";
import type { ScoreFilePanel } from "../output/use-score-file-flow";
import { useShortcutPlatform } from "../session/EditorShortcutReference";
import { shortcutKeys } from "../session/editor-shortcuts";
import type { ScoreZoom } from "../score/score-view";
import { SCORE_ZOOM_LEVELS } from "../score/score-view";
import styles from "./EditorHeader.module.scss";

const statusText = {
  example: "示例曲谱",
  imported: "与导入文件一致",
  exported: "JSON 已导出",
  pending: "待导出 JSON",
};

type MenuName = "file" | "edit" | "view" | "help" | "export";
type MenuAction = {
  key: string;
  label: ReactNode;
  disabled?: boolean;
  run: (trigger: HTMLButtonElement, fromKeyboard: boolean) => void;
};

/** 顶栏组织入口，导航、草稿保护与谱面操作交由编辑器会话处理。 */
export const EditorHeader = ({
  title, status, empty = false, canUndo, canRedo, sidebarCollapsed, sidebarToggleDisabled = false, zoom,
  onFileAction, onExportAction, onNavigate, onLearning, onShortcuts,
  onHistory, onToggleSidebar, onZoom, exportButtonRef,
}: {
  title: string;
  status: ScoreFileStatus;
  empty?: boolean;
  canUndo: boolean;
  canRedo: boolean;
  sidebarCollapsed: boolean;
  sidebarToggleDisabled?: boolean;
  zoom: ScoreZoom;
  onFileAction: (action: Exclude<ScoreFilePanel, "json"> | "home", trigger: HTMLButtonElement) => void;
  onExportAction: (action: "json" | "png" | "print", trigger: HTMLButtonElement) => void;
  onNavigate: (destination: "/" | "/guitar-advanced", trigger: HTMLElement | null) => boolean;
  onLearning: (trigger: HTMLButtonElement) => void;
  onShortcuts: (trigger: HTMLButtonElement, fromKeyboard: boolean) => void;
  onHistory: (action: "undo" | "redo") => void;
  onToggleSidebar: () => void;
  onZoom: (zoom: ScoreZoom) => void;
  exportButtonRef: RefObject<HTMLButtonElement | null>;
}) => {
  const headerRef = useRef<HTMLElement>(null);
  const homeLinkRef = useRef<HTMLAnchorElement>(null);
  const focusLastMenuItem = useRef<MenuName | undefined>(undefined);
  const [openMenu, setOpenMenu] = useState<MenuName>();
  const platform = useShortcutPlatform();
  const zoomIndex = SCORE_ZOOM_LEVELS.indexOf(zoom);
  const previousZoom = SCORE_ZOOM_LEVELS[zoomIndex - 1];
  const nextZoom = SCORE_ZOOM_LEVELS[zoomIndex + 1];
  const scoreTitle = empty ? "曲谱编辑器" : title || "未命名曲谱";

  const findTrigger = (menu: MenuName) =>
    headerRef.current?.querySelector<HTMLButtonElement>(`button[data-editor-menu="${menu}"]`);

  const moveBetweenMenus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const { key, target, currentTarget } = event;
    if (!(target instanceof Element)) return;
    const forward = key === "ArrowRight";
    const backward = key === "ArrowLeft";
    const trigger = target.closest<HTMLButtonElement>("button[data-editor-menu]");
    if (!forward && !backward && !(trigger && (key === "Home" || key === "End"))) return;
    const buttons = Array.from(currentTarget.querySelectorAll<HTMLButtonElement>("button[data-editor-menu]"));
    const current = trigger ?? (openMenu && findTrigger(openMenu));
    if (!current) return;
    const index = buttons.indexOf(current);
    const next = key === "Home" ? buttons[0] : key === "End" ? buttons.at(-1)
      : buttons[(index + (forward ? 1 : -1) + buttons.length) % buttons.length];
    if (!next) return;
    event.preventDefault();
    focusLastMenuItem.current = undefined;
    next.focus({ preventScroll: true });
    if (openMenu) setOpenMenu(next.dataset.editorMenu as MenuName);
  };

  const renderMenu = (name: MenuName, label: string, actions: readonly (MenuAction | "divider")[]) => (
    <div
      className={styles.menu}
      onFocusCapture={(event) => {
        if (focusLastMenuItem.current !== name || !event.target.closest('[role="menu"]')) return;
        focusLastMenuItem.current = undefined;
        const items = event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])');
        items[items.length - 1]?.focus({ preventScroll: true });
      }}
      onKeyDownCapture={(event) => {
        if (openMenu !== name || event.nativeEvent.isComposing) return;
        if (event.key === "Escape" || event.key === "Tab") {
          if (event.key === "Escape") event.preventDefault();
          event.stopPropagation();
          focusLastMenuItem.current = undefined;
          findTrigger(name)?.focus({ preventScroll: true });
          setOpenMenu(undefined);
        } else if (event.key === " " && event.target instanceof HTMLElement &&
          event.target.matches('[role="menuitem"]:not([aria-disabled="true"])')) {
          event.preventDefault();
          if (!event.repeat) event.target.click();
        }
      }}
    >
      <Dropdown
        autoFocus
        align={{ overflow: { shiftX: true, adjustY: true } }}
        classNames={{ root: styles.menuPopup }}
        destroyOnHidden
        trigger={["click"]}
        placement={name === "export" ? "bottomRight" : "bottomLeft"}
        getPopupContainer={(trigger) => trigger.parentElement!}
        open={openMenu === name}
        onOpenChange={(open) => {
          if (open || focusLastMenuItem.current === name) focusLastMenuItem.current = undefined;
          setOpenMenu((current) => open ? name : current === name ? undefined : current);
        }}
        menu={{
          "aria-label": label,
          tabIndex: -1,
          items: actions.map((action, index) => action === "divider"
            ? { type: "divider", key: `divider-${index}` }
            : { key: action.key, label: action.label, disabled: action.disabled }),
          onClick: ({ key, domEvent }) => {
            // 真实链接保留在新标签打开等原生行为；键盘激活菜单项走同一导航保护。
            if (domEvent.type === "click" && domEvent.target instanceof Element && domEvent.target.closest("a[href]")) return;
            const action = actions.find((item): item is MenuAction => item !== "divider" && item.key === key);
            const trigger = findTrigger(name);
            if (!action || !trigger) return;
            // Enter 的默认点击不能落在操作打开后新获得焦点的按钮上。
            domEvent.preventDefault();
            trigger.focus({ preventScroll: true });
            action.run(trigger, domEvent.type === "keydown" || ("detail" in domEvent && domEvent.detail === 0));
          },
        }}
      >
        <button
          ref={name === "export" ? exportButtonRef : undefined}
          className={styles.menuButton}
          type="button"
          data-editor-menu={name}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={openMenu === name}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            focusLastMenuItem.current = event.key === "ArrowUp" ? name : undefined;
            setOpenMenu(name);
          }}
        >
          {label}{name === "export" && <DownOutlined aria-hidden="true" />}
        </button>
      </Dropdown>
    </div>
  );

  return (
    <header ref={headerRef} className={styles.editorHeader} data-empty={empty}>
      <div className={styles.headerStart}>
        <Link ref={homeLinkRef} className={styles.editorBrand} href="/" aria-label="六线猫首页"
          onNavigate={(event) => {
            if (!onNavigate("/", homeLinkRef.current)) event.preventDefault();
          }}>
          <BrandIcon size={32} />
          <strong>六线猫</strong>
        </Link>
        <nav className={styles.menuBar} aria-label="编辑器菜单" onKeyDown={moveBetweenMenus}>
          {renderMenu("file", "文件", [
            { key: "new", label: "新建曲谱", run: (trigger) => onFileAction("new", trigger) },
            { key: "import", label: "导入曲谱", run: (trigger) => onFileAction("import", trigger) },
            "divider",
            { key: "home", label: "返回首页", run: (trigger) => onFileAction("home", trigger) },
          ])}
          {renderMenu("edit", "编辑", (["undo", "redo"] as const).map((action) => ({
            key: action,
            label: <span className={styles.historyItem}>
              {action === "undo" ? "撤销" : "重做"}
              <kbd aria-hidden="true">{shortcutKeys(action, platform)[0]}</kbd>
            </span>,
            disabled: empty || !(action === "undo" ? canUndo : canRedo),
            run: () => onHistory(action),
          })))}
          {renderMenu("view", "视图", [
            { key: "sidebar", label: sidebarCollapsed ? "显示侧栏" : "隐藏侧栏", disabled: empty || sidebarToggleDisabled, run: onToggleSidebar },
            { key: "zoom-in", label: "放大", disabled: empty || !nextZoom, run: () => nextZoom && onZoom(nextZoom) },
            { key: "zoom-out", label: "缩小", disabled: empty || !previousZoom, run: () => previousZoom && onZoom(previousZoom) },
            { key: "zoom-reset", label: "实际大小", disabled: empty || zoom === 100, run: () => onZoom(100) },
          ])}
          {renderMenu("help", "帮助", [
            { key: "shortcuts", label: "快捷键", run: onShortcuts },
            { key: "learning", label: <Link href="/guitar-advanced" tabIndex={-1} onNavigate={(event) => {
              const trigger = findTrigger("help");
              trigger?.focus({ preventScroll: true });
              if (!onNavigate("/guitar-advanced", trigger ?? null)) event.preventDefault();
            }}>吉他进阶</Link>, run: onLearning },
          ])}
        </nav>
      </div>
      <strong className={styles.editorHeading} title={scoreTitle}>{scoreTitle}</strong>
      {!empty && <div className={styles.headerActions}>
        <span className={styles.fileStatus} data-file-status={status} role="status">{statusText[status]}</span>
        {renderMenu("export", "导出", [
          { key: "json", label: "JSON 曲谱", run: (trigger) => onExportAction("json", trigger) },
          { key: "png", label: "PNG 图片", run: (trigger) => onExportAction("png", trigger) },
          "divider",
          { key: "print", label: "打印", run: (trigger) => onExportAction("print", trigger) },
        ])}
      </div>}
    </header>
  );
};
