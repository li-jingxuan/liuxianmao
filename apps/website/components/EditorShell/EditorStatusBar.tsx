"use client";

import { Tag } from "antd";
import { useSyncExternalStore } from "react";
import { useEditorRuntime } from "./EditorSessionRuntime";
import styles from "./index.module.scss";

/** 位置与草稿摘要只属于会话 UI，不参与领域命令或撤销历史。 */
export const EditorStatusBar = ({
  position,
  cellCount,
  fretDraft,
  viewLabel,
}: {
  position: string;
  cellCount: number;
  fretDraft: string;
  viewLabel?: string;
}) => {
  const { drafts } = useEditorRuntime();
  useSyncExternalStore(drafts.subscribe, drafts.getSnapshot, () => 0);
  const { pending, composing, busy } = drafts.inspect();
  return (
    <div
      className={styles.statusBar}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span>{position}</span>
      {cellCount > 0 && <Tag>{`已选择 ${cellCount} 格`}</Tag>}
      {fretDraft && <Tag color="processing">正在输入：{fretDraft}</Tag>}
      {pending.length > 0 && (
        <Tag
          color="warning"
          title={pending.map((draft) => draft.label).join("；")}
        >
          {pending.length} 处待处理草稿
        </Tag>
      )}
      {composing && <span>输入法输入中</span>}
      {busy && <span>正在处理草稿</span>}
      {viewLabel && <span className={styles.statusView}>{viewLabel}</span>}
    </div>
  );
};
