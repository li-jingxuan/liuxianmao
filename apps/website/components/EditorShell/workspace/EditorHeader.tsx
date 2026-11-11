"use client";

import type { ReactNode, RefObject } from "react";
import Link from "next/link";
import { Button } from "antd";
import { PictureOutlined } from "@ant-design/icons";
import editorHeaderStyles from "./EditorHeader.module.scss";

/**
 * 展示曲谱标题、跨产品导航与文件操作入口，不持有会话或草稿状态。
 * 是否允许离开由宿主在点击时检查，避免头部缓存的状态漏掉刚产生的输入。
 */
export const EditorHeader = ({
  title,
  fileControls,
  onImageExport,
  imageExportButtonRef,
  canNavigateToLearning,
}: {
  title: string;
  fileControls: ReactNode;
  onImageExport: () => void;
  imageExportButtonRef: RefObject<HTMLButtonElement | null>;
  /** 返回 false 时取消本次同页路由跳转；提示及草稿处理仍由宿主负责。 */
  canNavigateToLearning: () => boolean;
}) => {
  return (
    <header className={editorHeaderStyles.editorHeader}>
      <div className={editorHeaderStyles.editorBrand}>
        <strong>六线猫</strong>
      </div>
      <div className={editorHeaderStyles.editorHeading}>
        <strong title={title || "未命名曲谱"}>{title || "未命名曲谱"}</strong>
        <span>吉他弹唱谱</span>
      </div>
      <div className={editorHeaderStyles.headerActions}>
        <Link
          className={`${editorHeaderStyles.headerNativeAction} ${editorHeaderStyles.learningLink}`}
          href="/guitar-advanced"
          // 只保护会卸载当前编辑器的客户端导航；新标签打开不需要清理当前会话。
          onNavigate={(event) => {
            if (!canNavigateToLearning()) event.preventDefault();
          }}
        >
          吉他进阶
        </Link>
        {fileControls}
        <Button
          ref={imageExportButtonRef}
          type="primary"
          icon={<PictureOutlined />}
          aria-label="导出 A4 图片"
          onClick={onImageExport}
        >
          导出图片
        </Button>
      </div>
    </header>
  );
};
