"use client";

import type { ReactNode, RefObject } from "react";
import { Button } from "antd";
import { PictureOutlined } from "@ant-design/icons";
import editorHeaderStyles from "./EditorHeader.module.scss";

/** 头部组织曲谱标题及文件入口。 */
export const EditorHeader = ({
  title,
  fileControls,
  onImageExport,
  imageExportButtonRef,
}: {
  title: string;
  fileControls: ReactNode;
  onImageExport: () => void;
  imageExportButtonRef: RefObject<HTMLButtonElement | null>;
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
