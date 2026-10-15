"use client";

import { Alert, Button, Modal } from "antd";
import { useState, useSyncExternalStore } from "react";
import type { EditorModalController } from "./editor-modal-controller";

/** 单一 Ant Design 弹层宿主，版本检查和忙碌锁统一走同一控制器。 */
export const EditorModalHost = ({
  controller,
}: {
  controller: EditorModalController;
}) => {
  const active = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    () => null,
  );
  // 保留退出动画期间的内容，焦点只在 afterClose 中恢复。
  const [display, setDisplay] = useState(active);
  if (active && active !== display) setDisplay(active);
  return (
    <Modal
      title={display?.request.title}
      open={!!active}
      mask={{ closable: false }}
      keyboard={display?.request.kind === "keyboard-help" && !display.busy}
      closable={!display?.busy}
      focusable={{ focusTriggerAfterClose: false }}
      modalRender={(content) => (
        <div
          onKeyDown={(event) => {
            // 保留的 Popover portal 不能抢走帮助弹层的 Esc；只在弹层内部处理。
            if (
              event.key === "Escape" &&
              !event.nativeEvent.isComposing &&
              active?.request.kind === "keyboard-help" &&
              !active.busy
            ) {
              event.stopPropagation();
              controller.close(active.id, "cancel");
            }
          }}
        >
          {content}
        </div>
      )}
      onCancel={() => {
        if (active) controller.close(active.id, "cancel");
      }}
      afterClose={controller.restoreFocus}
      footer={
        display?.request.confirm ? (
          <>
            <Button
              disabled={display.busy}
              onClick={() => controller.close(display.id, "cancel")}
            >
              取消
            </Button>
            <Button
              type="primary"
              loading={display.busy}
              onClick={() => void controller.confirm(display.id)}
            >
              确认修改
            </Button>
          </>
        ) : (
          <Button
            onClick={() => display && controller.close(display.id, "cancel")}
          >
            关闭
          </Button>
        )
      }
    >
      <p style={{ whiteSpace: "pre-line" }}>{display?.request.message}</p>
      {display?.error && <Alert type="error" title={display.error} showIcon />}
    </Modal>
  );
};
