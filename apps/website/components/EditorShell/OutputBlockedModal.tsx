"use client";

import { Alert, Button, Modal } from "antd";
import { useRef, useState, useSyncExternalStore } from "react";
import type { EditorDraftCoordinator } from "./editor-draft-coordinator";
import { EditorModalGuard } from "./EditorModalGuard";
import styles from "./image-export.module.scss";

/** 输出闸门只提供返回编辑和明确放弃，不自动应用草稿，也不自动重开输出。 */
export const OutputBlockedModal = ({
  open,
  drafts,
  onClose,
  onBlocked,
}: {
  open: boolean;
  drafts: EditorDraftCoordinator;
  onClose: () => void;
  onBlocked: (message: string) => void;
}) => {
  useSyncExternalStore(
    drafts.subscribe,
    drafts.getSnapshot,
    drafts.getSnapshot,
  );
  const { pending, composing } = drafts.inspect();
  const [confirmation, setConfirmation] = useState<{
    token: number;
    ids: string[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const focusAfterClose = useRef<string | null>(null);
  const firstAction = useRef<HTMLButtonElement>(null);

  const close = (focusId?: string) => {
    focusAfterClose.current = focusId ?? null;
    setConfirmation(null);
    setMessage(null);
    onClose();
  };

  const discardAll = async (token?: number) => {
    if (busy) return;
    setBusy(true);
    const result = await drafts.request(
      token === undefined
        ? { type: "discardAll" }
        : { type: "discardAll", confirmation: token },
    );
    setBusy(false);
    if (result.status === "needs-confirmation") {
      setConfirmation({ token: result.confirmation, ids: result.ids });
      setMessage(null);
      return;
    }
    if (result.status === "accepted") {
      close();
      return;
    }
    if (result.status === "blocked") {
      setMessage(result.reason);
      return;
    }
    setConfirmation(null);
    setMessage("草稿状态已变化，请重新查看后再处理。");
  };

  return (
    <Modal
      title="先处理未应用的输入"
      open={open}
      width={640}
      centered
      mask={{ closable: false }}
      keyboard={false}
      closable={false}
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
        <EditorModalGuard
          dismissable={!busy}
          busy={busy}
          onDismiss={() => close()}
        >
          {content}
        </EditorModalGuard>
      )}
      afterClose={() => {
        const id = focusAfterClose.current;
        focusAfterClose.current = null;
        if (!id) return;
        void drafts.request({ type: "focus", id }).then((result) => {
          if (result.status === "accepted") return;
          onBlocked(
            result.status === "blocked"
              ? result.reason
              : "原草稿已失效，请从原编辑入口重新定位。",
          );
        });
      }}
      afterOpenChange={(visible) => {
        if (!visible) return;
        firstAction.current?.focus({ preventScroll: true });
      }}
      footer={
        confirmation ? (
          <>
            <Button disabled={busy} onClick={() => setConfirmation(null)}>
              保留草稿
            </Button>
            <Button
              danger
              loading={busy}
              onClick={() => void discardAll(confirmation.token)}
            >
              确认放弃 {confirmation.ids.length} 处
            </Button>
          </>
        ) : (
          <>
            <Button disabled={busy} onClick={() => close()}>
              关闭
            </Button>
            <Button
              danger
              loading={busy}
              disabled={!pending.length || composing}
              onClick={() => void discardAll()}
            >
              放弃全部草稿
            </Button>
          </>
        )
      }
    >
      <div className={styles.blockedBody}>
        <p>
          图片只导出已提交内容。请先返回对应编辑位置应用或取消修改，再重新导出。
        </p>
        {pending.length ? (
          <ul className={styles.blockedList} aria-label="待处理草稿">
            {pending.map((record, index) => (
              <li key={record.id}>
                <div>
                  <strong>{record.label}</strong>
                  {record.location && <span>{record.location}</span>}
                  {record.error && (
                    <span className={styles.blockedError}>{record.error}</span>
                  )}
                  {record.composing && <span>输入法组合输入中</span>}
                </div>
                <Button
                  ref={index === 0 ? firstAction : undefined}
                  disabled={busy || record.composing}
                  onClick={() => close(record.id)}
                >
                  返回编辑
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p>当前还有未结束的输入或弹层，请关闭本提示后返回编辑器处理。</p>
        )}
        {composing && (
          <Alert
            type="warning"
            showIcon
            title="请先完成输入法组合输入，再返回编辑或放弃草稿。"
          />
        )}
        {confirmation && (
          <Alert
            type="warning"
            showIcon
            title={`将放弃 ${confirmation.ids.length} 处未应用输入，丢弃后不会自动开始导出。`}
          />
        )}
        {message && <Alert type="error" showIcon title={message} />}
      </div>
    </Modal>
  );
};
