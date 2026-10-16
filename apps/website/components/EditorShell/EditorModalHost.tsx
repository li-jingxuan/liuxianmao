"use client";

import { Alert, Button, Modal } from "antd";
import { useState, useSyncExternalStore } from "react";
import type {
  EditorModalController,
  EditorModalState,
} from "./editor-modal-controller";
import { BeatPastePreview } from "./BeatPastePreview";
import { TechniqueTypePicker } from "./TechniqueTypePicker";

/** footer 订阅同一 owner，勾选/模式更新立即反映可提交状态。 */
const PasteFooter = ({
  active,
  controller,
}: {
  active: EditorModalState & {
    request: Extract<EditorModalState["request"], { kind: "beat-paste" }>;
  };
  controller: EditorModalController;
}) => {
  useSyncExternalStore(
    active.request.preview.subscribe,
    active.request.preview.getSnapshot,
    active.request.preview.getSnapshot,
  );
  return (
    <>
      <Button
        disabled={active.busy}
        onClick={() => controller.close(active.id, "cancel")}
      >
        取消预览
      </Button>
      <Button
        type="primary"
        loading={active.busy}
        disabled={!active.request.preview.canApply()}
        onClick={() => void controller.confirm(active.id)}
      >
        应用粘贴
      </Button>
    </>
  );
};
const TypeFooter = ({
  active,
  controller,
}: {
  active: EditorModalState & {
    request: Extract<EditorModalState["request"], { kind: "technique-type" }>;
  };
  controller: EditorModalController;
}) => {
  const type = useSyncExternalStore(
    active.request.picker.subscribe,
    active.request.picker.getSnapshot,
    active.request.picker.getSnapshot,
  );
  return (
    <>
      <Button
        disabled={active.busy}
        onClick={() => controller.close(active.id, "cancel")}
      >
        取消
      </Button>
      <Button
        type="primary"
        loading={active.busy}
        disabled={!!active.request.picker.reason(type)}
        onClick={() => void controller.confirm(active.id)}
      >
        下一步：参数
      </Button>
    </>
  );
};

/** 单一弹层宿主只呈现请求，不拼领域命令；动画结束后进行交接或恢复焦点。 */
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
  const [display, setDisplay] = useState(active);
  if (active && active !== display) setDisplay(active);
  const request = display?.request;
  const dismissable =
    request?.kind === "keyboard-help" || request?.kind === "technique-type";
  return (
    <Modal
      title={request?.title}
      open={!!active}
      width={
        request?.kind === "beat-paste"
          ? 660
          : request?.kind === "technique-type"
            ? 720
            : 560
      }
      centered
      mask={{ closable: false }}
      keyboard={dismissable && !display?.busy}
      closable={!display?.busy}
      focusable={{ focusTriggerAfterClose: false }}
      styles={{
        container: {
          maxWidth: "calc(100vw - 32px)",
          padding: 28,
          borderRadius: 8,
          maxHeight: "calc(100dvh - 32px)",
          display: "flex",
          flexDirection: "column",
        },
        body: { overflowY: "auto", minHeight: 0 },
        header: { flexShrink: 0 },
        title: { fontSize: 20, fontWeight: 500 },
        footer: { flexShrink: 0, marginTop: 24 },
      }}
      modalRender={(content) => (
        <div
          onKeyDown={(event) => {
            // portal 保留挂载时仍不能越过最上层 Modal；中文组合 Esc 保留输入法行为。
            if (event.key === "Escape") {
              event.stopPropagation();
              if (
                dismissable &&
                !event.nativeEvent.isComposing &&
                active &&
                !active.busy
              )
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
        display && request?.kind === "beat-paste" ? (
          <PasteFooter
            active={{ ...display, request }}
            controller={controller}
          />
        ) : display && request?.kind === "technique-type" ? (
          <TypeFooter
            active={{ ...display, request }}
            controller={controller}
          />
        ) : display?.request.confirm ? (
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
      {request?.kind === "beat-paste" ? (
        <BeatPastePreview controller={request.preview} />
      ) : request?.kind === "technique-type" ? (
        <TechniqueTypePicker controller={request.picker} />
      ) : (
        <p style={{ whiteSpace: "pre-line" }}>{request?.message}</p>
      )}
      {display?.error && request?.kind !== "beat-paste" && (
        <Alert type="error" title={display.error} showIcon />
      )}
    </Modal>
  );
};
