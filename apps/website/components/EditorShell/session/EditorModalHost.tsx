"use client";

import { Alert, Button, ConfigProvider, Modal } from "antd";
import { Fragment, useState, useSyncExternalStore } from "react";
import type {
  EditorModalController,
  EditorModalState,
} from "./editor-modal-controller";
import { BeatPastePreview } from "../tools/BeatPastePreview";
import { EditorModalGuard } from "./EditorModalGuard";
import { TechniqueTypePicker } from "../tools/TechniqueTypePicker";
import styles from "./EditorModalHost.module.scss";

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
  const chord =
    request?.kind === "chord-library" || request?.kind === "chord-custom";
  const dismissable = request?.kind === "technique-type" || chord;
  return (
    <ConfigProvider
      getPopupContainer={chord ? (trigger) => trigger?.closest<HTMLElement>(".ant-modal") ?? document.body : undefined}
      theme={chord ? { token: { colorPrimary: "#2457eb", colorText: "#202938", colorTextSecondary: "#607084", colorBorder: "#ccd5e1", borderRadius: 6, fontSize: 14, controlHeight: 36 }, components: { Select: { zIndexPopup: 1100 }, Dropdown: { zIndexPopup: 1100 } } } : {}}><Modal
      className={chord ? styles.chordModal : undefined}
      title={chord && request ? <div className={styles.heading}><h2>{request.title}</h2><p aria-hidden="true">{request.subtitle ?? (request.kind === "chord-library" ? "选择和弦与指法，带回当前编辑位置。" : "调整按点与横按，完成后带回当前和弦草稿。")}</p></div> : request?.title}
      open={!!active && !active.closing}
      width={
        chord
          ? request?.kind === "chord-custom" ? 850 : 1000
          : request?.kind === "beat-paste"
            ? 660
            : request?.kind === "technique-type"
              ? 720
              : 560
      }
      centered
      mask={{ closable: false }}
      keyboard={false}
      closable={!display?.busy}
      focusable={{ focusTriggerAfterClose: false }}
      styles={{
        container: {
          maxWidth: "calc(100vw - 32px)",
          padding: chord ? 0 : 28,
          borderRadius: chord ? 12 : 8,
          maxHeight: "calc(100dvh - 32px)",
          display: "flex",
          flexDirection: "column",
        },
        body: { overflowY: chord ? "hidden" : "auto", minHeight: 0 },
        header: { flexShrink: 0, ...(chord ? { padding: "20px 24px", marginBottom: 0, borderBottom: "1px solid #dce3eb" } : {}) },
        title: { fontSize: 20, fontWeight: 500 },
        footer: { flexShrink: 0, marginTop: 24 },
      }}
      modalRender={(content) => (
        <EditorModalGuard
          dismissable={dismissable}
          busy={display?.busy}
          onDismiss={() => {
            if (active) controller.close(active.id, "cancel");
          }}
        >
          {content}
        </EditorModalGuard>
      )}
      onCancel={() => {
        if (active) controller.close(active.id, "cancel");
      }}
      afterClose={() => controller.restoreFocus(display?.id)}
      footer={
        chord ? null : display && request?.kind === "beat-paste" ? (
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
      {request?.kind === "chord-library" || request?.kind === "chord-custom" ? (
        <Fragment key={display?.id}>{request.content}</Fragment>
      ) : request?.kind === "beat-paste" ? (
        <BeatPastePreview controller={request.preview} />
      ) : request?.kind === "technique-type" ? (
        <TechniqueTypePicker controller={request.picker} />
      ) : (
        <p style={{ whiteSpace: "pre-line" }}>{request?.message}</p>
      )}
      {display?.error && request?.kind !== "beat-paste" && (
        <Alert type="error" title={display.error} showIcon />
      )}
    </Modal></ConfigProvider>
  );
};
