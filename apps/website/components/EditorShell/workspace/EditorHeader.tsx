"use client";

import { useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { Button, Dropdown, Tooltip } from "antd";
import { DownOutlined } from "@ant-design/icons";
import { Keyboard } from "lucide-react";
import type { ScoreFileStatus } from "../../../stores/editor-store";
import { BrandIcon } from "../../BrandIcon";
import type { ScoreFilePanel } from "../output/use-score-file-flow";
import editorHeaderStyles from "./EditorHeader.module.scss";

/**
 * 展示曲谱标题、跨产品导航与文件操作入口，不持有会话或草稿状态。
 * 是否允许离开由宿主在点击时检查，避免头部缓存的状态漏掉刚产生的输入。
 */
export const EditorHeader = ({
  title,
  status,
  onFileAction,
  onExportAction,
  onNavigate,
  onShortcuts,
  exportButtonRef,
  empty = false,
}: {
  title: string;
  status: ScoreFileStatus;
  onFileAction: (action: Exclude<ScoreFilePanel, "json"> | "home", trigger: HTMLButtonElement | null) => void;
  onExportAction: (action: "json" | "png" | "print", trigger: HTMLButtonElement | null) => void;
  onNavigate: (destination: "/" | "/guitar-advanced", trigger: HTMLElement | null) => boolean;
  onShortcuts: (trigger: HTMLButtonElement, fromKeyboard: boolean) => void;
  exportButtonRef: RefObject<HTMLButtonElement | null>;
  empty?: boolean;
}) => {
  const fileButtonRef = useRef<HTMLButtonElement>(null);
  const homeLinkRef = useRef<HTMLAnchorElement>(null);
  const learningLinkRef = useRef<HTMLAnchorElement>(null);
  const [openMenu, setOpenMenu] = useState<"file" | "export">();
  const [shortcutTooltipOpen, setShortcutTooltipOpen] = useState(false);
  const menuTrigger = (menu: "file" | "export") => ({
    "aria-haspopup": "menu" as const,
    "aria-expanded": openMenu === menu,
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== "ArrowDown") return;
      event.preventDefault();
      setOpenMenu(menu);
    },
  });
  const changeMenu = (menu: "file" | "export", open: boolean) => {
    setOpenMenu((current) => open ? menu : current === menu ? undefined : current);
  };
  const statusText = { example: "示例曲谱", imported: "与导入文件一致", exported: "JSON 已导出", pending: "待导出 JSON" };
  return (
    <header className={editorHeaderStyles.editorHeader}>
      <Link
        ref={homeLinkRef}
        className={editorHeaderStyles.editorBrand}
        href="/"
        aria-label="六线猫首页"
        onNavigate={(event) => {
          if (!onNavigate("/", homeLinkRef.current)) event.preventDefault();
        }}
      >
        <BrandIcon size={26} />
        <strong>六线猫</strong>
      </Link>
      <div className={editorHeaderStyles.editorHeading}>
        <strong title={empty ? undefined : title || "未命名曲谱"}>{empty ? "曲谱编辑器" : title || "未命名曲谱"}</strong>
        <span>吉他弹唱谱</span>
      </div>
      <div className={editorHeaderStyles.headerActions}>
        <Link
          ref={learningLinkRef}
          className={`${editorHeaderStyles.headerNativeAction} ${editorHeaderStyles.learningLink}`}
          href="/guitar-advanced"
          // 只保护会卸载当前编辑器的客户端导航；新标签打开不需要清理当前会话。
          onNavigate={(event) => {
            if (!onNavigate("/guitar-advanced", learningLinkRef.current)) event.preventDefault();
          }}
        >
          吉他进阶
        </Link>
        {/* 弹窗接管焦点会同步触发 blur，由 React 更新提示，避开 Tooltip 内部的 flushSync。 */}
        <Tooltip title="快捷键" trigger={["hover"]} placement="bottom" mouseEnterDelay={0.3}
          open={shortcutTooltipOpen} onOpenChange={setShortcutTooltipOpen}>
          <button type="button" className={`${editorHeaderStyles.headerNativeAction} ${editorHeaderStyles.shortcutButton}`}
            aria-label="快捷键" aria-haspopup="dialog" data-open-shortcuts
            onFocus={(event) => setShortcutTooltipOpen(event.currentTarget.matches(":focus-visible"))}
            onBlur={() => setShortcutTooltipOpen(false)}
            onClick={(event) => {
              setShortcutTooltipOpen(false);
              setOpenMenu(undefined);
              onShortcuts(event.currentTarget, event.detail === 0);
            }}><Keyboard size={16} aria-hidden="true" /><span className={editorHeaderStyles.shortcutLabel}>快捷键</span></button>
        </Tooltip>
        <Dropdown autoFocus={!fileButtonRef.current?.closest("[inert]")} trigger={["click"]} open={openMenu === "file"} onOpenChange={(open) => changeMenu("file", open)} menu={{ items: [
          { key: "new", label: "新建曲谱" },
          { key: "import", label: "导入曲谱" },
          { key: "home", label: "返回首页" },
        ], onClick: ({ key, domEvent }) => {
          domEvent.preventDefault();
          onFileAction(key as "new" | "import" | "home", fileButtonRef.current);
        } }}>
          <Button ref={fileButtonRef} aria-label="文件" {...menuTrigger("file")}>文件 <DownOutlined aria-hidden="true" /></Button>
        </Dropdown>
        {!empty && <><Dropdown autoFocus={!exportButtonRef.current?.closest("[inert]")} trigger={["click"]} open={openMenu === "export"} onOpenChange={(open) => changeMenu("export", open)} menu={{ items: [
          { key: "json", label: "JSON 曲谱" },
          { key: "png", label: "PNG 图片" },
          { key: "print", label: "打印" },
        ], onClick: ({ key, domEvent }) => {
          domEvent.preventDefault();
          onExportAction(key as "json" | "png" | "print", exportButtonRef.current);
        } }}>
          <Button ref={exportButtonRef} type="primary" aria-label="导出" {...menuTrigger("export")}>导出 <DownOutlined aria-hidden="true" /></Button>
        </Dropdown>
        <span className={editorHeaderStyles.fileStatus} data-file-status={status} role="status">{statusText[status]}</span></>}
      </div>
    </header>
  );
};
