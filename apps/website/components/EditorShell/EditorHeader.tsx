"use client";

import { useRef, useState, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { Button, Popover, Segmented, Switch } from "antd";
import {
  EyeOutlined,
  PictureOutlined,
  QuestionCircleOutlined,
} from "@ant-design/icons";
import type { ILXMLayoutDensity } from "@liuxianmao/lxm-editor";
import styles from "./index.module.scss";

/** 头部只组织真实的视图及文件入口，不添加曲谱库保存或管理语义。 */
export const EditorHeader = ({
  title,
  density,
  showChordDiagrams,
  onDensityChange,
  onChordDiagramsChange,
  fileControls,
  onImageExport,
  imageExportButtonRef,
  onHelp,
  helpDisabled,
}: {
  title: string;
  density: ILXMLayoutDensity;
  showChordDiagrams: boolean;
  onDensityChange: (density: ILXMLayoutDensity) => void;
  onChordDiagramsChange: (visible: boolean) => void;
  fileControls: ReactNode;
  onImageExport: () => void;
  imageExportButtonRef: RefObject<HTMLButtonElement | null>;
  onHelp: () => void;
  helpDisabled: boolean;
}) => {
  const [viewOpen, setViewOpen] = useState(false);
  const viewButton = useRef<HTMLButtonElement>(null);
  return (
    <header className={styles.editorHeader}>
      <div className={styles.editorBrand}>
        <span aria-hidden="true">六</span>
        <strong>六线猫</strong>
      </div>
      <div className={styles.editorHeading}>
        <strong title={title || "未命名曲谱"}>{title || "未命名曲谱"}</strong>
        <span>编辑工作区</span>
      </div>
      <div className={styles.headerActions}>
        <Link
          className={`${styles.headerNativeAction} ${styles.learningLink}`}
          href="/guitar-advanced"
        >
          吉他进阶
        </Link>
        <Popover
          trigger="click"
          placement="bottomRight"
          open={viewOpen}
          onOpenChange={setViewOpen}
          content={
            <div
              className={styles.viewSettings}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setViewOpen(false);
                  viewButton.current?.focus();
                }
              }}
            >
              <h3>视图与排版</h3>
              <Segmented
                aria-label="谱面排版密度"
                value={density}
                options={[
                  { label: "紧凑排版", value: "compact" },
                  { label: "舒适排版", value: "comfortable" },
                ]}
                onChange={onDensityChange}
                block
              />
              <label>
                <Switch
                  aria-label="显示和弦指法图"
                  checked={showChordDiagrams}
                  onChange={onChordDiagramsChange}
                />
                显示和弦指法图
              </label>
              <p>隐藏指法图保留数据，图片输出同步。</p>
              <Button
                icon={<QuestionCircleOutlined />}
                block
                disabled={helpDisabled}
                onClick={() => {
                  setViewOpen(false);
                  viewButton.current?.focus();
                  onHelp();
                }}
              >
                快捷键帮助
              </Button>
            </div>
          }
        >
          <Button
            ref={viewButton}
            icon={<EyeOutlined />}
            aria-label="视图与排版"
            aria-expanded={viewOpen}
          >
            视图
          </Button>
        </Popover>
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
