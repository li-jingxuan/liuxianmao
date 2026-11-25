"use client";
import { App, Button, Modal, Tooltip } from "antd";
import { CopyOutlined, DeleteOutlined } from "@ant-design/icons";
import { useLayoutEffect, useRef, useState } from "react";
import type { ILXMDocument } from "@liuxianmao/lxm-editor";
import type { MeasureCopyDestination, MeasureToolTarget, ToolActionHandler } from "./editor-tool-actions";
import { EditorModalGuard } from "../session/EditorModalGuard";
import { resolveMeasureControlTarget } from "./MeasureBoundary";
import { CopyMeasureDialog } from "./CopyMeasureBubble";
import styles from "./MeasureControls.module.scss";

type MeasureActionDialog = {
  kind: "copy" | "remove";
  anchor: HTMLElement;
  document: ILXMDocument;
  target: MeasureToolTarget;
  identity: string;
  closing?: boolean;
};

export const MeasureActions = ({ document, target, blocked, onAction, getDocument, getTargetIdentity, onBusyChange }: {
  document: ILXMDocument; target?: MeasureToolTarget | null; blocked: boolean; onAction: ToolActionHandler;
  getDocument?: () => ILXMDocument | null; getTargetIdentity?: () => string; onBusyChange?: (busy: boolean) => void;
}) => {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<MeasureActionDialog | null>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const lock = useRef(false);
  const live = useRef({ document, target, blocked, getDocument, getTargetIdentity });
  useLayoutEffect(() => { live.current = { document, target, blocked, getDocument, getTargetIdentity }; });
  const resolved = resolveMeasureControlTarget(document, target);
  const reason = !resolved ? "请选择目标小节。" : blocked ? "请先完成当前编辑或等待提交结束。" : busy ? "正在提交，请稍候。" : "";
  const removeReason = reason || (resolved?.track.measures.length === 1 ? "须至少保留一个小节。" : "");
  const identity = getTargetIdentity?.() ?? JSON.stringify(target);
  const currentDialog = dialog && dialog.document === document && dialog.target.trackId === target?.trackId &&
    dialog.target.measureId === target?.measureId && dialog.identity === identity ? dialog : null;
  // 换谱、撤销或重选后销毁旧参数，避免返回同一小节时重新打开旧确认。
  if (dialog && !currentDialog) setDialog(null);

  const openDialog = (kind: MeasureActionDialog["kind"], anchor: HTMLElement) => {
    if (target && !reason && !lock.current) setDialog({ kind, anchor, document, target, identity });
  };
  const dismiss = (restoreFocus = true) => {
    setDialog(null);
    if (!restoreFocus || !currentDialog) return;
    const { anchor } = currentDialog;
    // 弹窗 portal 退出后，工作区通过动画帧解除 inert，再把焦点还给原入口。
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (anchor.isConnected && !anchor.closest("[inert]")) anchor.focus({ preventScroll: true });
    }));
  };
  const cancel = () => {
    if (!lock.current) setDialog((current) => current && { ...current, closing: true });
  };
  // 异步影响确认期间也校验打开时的文档与选区，避免用新选区完成旧复制。
  const isCurrent = (opening: MeasureActionDialog) => {
    const now = live.current;
    return (now.getDocument ? now.getDocument() : now.document) === opening.document &&
      (now.getTargetIdentity?.() ?? JSON.stringify(now.target)) === opening.identity;
  };
  const run: ToolActionHandler = async (action) => {
    if (lock.current || live.current.blocked) return false;
    lock.current = true;
    setBusy(true);
    onBusyChange?.(true);
    try { return await onAction(action); }
    finally { lock.current = false; setBusy(false); onBusyChange?.(false); }
  };
  const removeCurrentMeasure = async () => {
    if (currentDialog?.kind !== "remove" || currentDialog.closing || !resolved || removeReason || !isCurrent(currentDialog)) return;
    // 删除后选区可能迁移、小节可能重排，先按当前轨道记下删除前的序号。
    const measureNumber = resolved.index + 1;
    // 沿用命令的并发与草稿检查，提交成功才使用页面级消息，面板卸载也能显示。
    if (await run({ type: "removeMeasure", target: currentDialog.target })) {
      dismiss();
      void message.success(`第 ${measureNumber} 小节已删除`);
    }
  };
  const copyTo = (destination: MeasureCopyDestination) => {
    if (currentDialog?.kind !== "copy" || !isCurrent(currentDialog)) return Promise.resolve(false);
    return run({ type: "copyMeasures", target: currentDialog.target, destination, isCurrent: () => isCurrent(currentDialog) });
  };
  return <>
    <div className={styles.actionSection}>
      <div className={styles.actions} role="group" aria-label="当前小节操作">
        <Tooltip trigger={["hover", "focus"]} title={reason || "在当前小节后新增空白小节，延续适用拍号"}>
          <span tabIndex={reason ? 0 : undefined} aria-label={reason || undefined}><Button data-tool-action="measure-actions" className={styles.insert} type="text" disabled={!!reason} icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 5v14M20 5v14M4 9h16M4 15h16M12 2v6M9 5h6" /></svg>} onClick={() => { if (target) void run({ type: "insertMeasure", target }); }}>新增小节</Button></span>
        </Tooltip>
        <Tooltip trigger={["hover", "focus"]} title={reason || (currentDialog ? "" : "选择当前小节的复制位置")}>
          <span tabIndex={reason ? 0 : undefined} aria-label={reason || undefined}><Button type="text" disabled={!!reason}
            icon={<CopyOutlined />} aria-label="复制当前小节" aria-haspopup="dialog" aria-expanded={currentDialog?.kind === "copy"}
            onClick={(event) => openDialog("copy", event.currentTarget)}>复制小节</Button></span>
        </Tooltip>
        <Tooltip trigger={["hover", "focus"]} title={removeReason || (currentDialog ? "" : "删除当前小节，可撤销")}>
          <span tabIndex={removeReason ? 0 : undefined} aria-label={removeReason || undefined}><Button type="text" className={styles.remove} disabled={!!removeReason}
            icon={<DeleteOutlined />} aria-label="删除当前小节" aria-haspopup="dialog" aria-expanded={currentDialog?.kind === "remove"}
            onClick={(event) => openDialog("remove", event.currentTarget)}>删除小节</Button></span>
        </Tooltip>
      </div>
    </div>
    {currentDialog?.kind === "copy" && <CopyMeasureDialog anchor={currentDialog.anchor} document={currentDialog.document} target={currentDialog.target}
      blocked={blocked} onCopy={copyTo} onDismiss={dismiss} />}
    {currentDialog?.kind === "remove" && <Modal title="删除小节" open={!blocked && !currentDialog.closing} centered width={420} keyboard={false} mask={{ closable: false }}
      closable={!busy} focusable={{ focusTriggerAfterClose: false }} onCancel={cancel}
      afterOpenChange={(visible) => {
        if (visible) cancelButton.current?.focus({ preventScroll: true });
        else if (currentDialog.closing) dismiss();
      }}
      footer={<>
        <Button ref={cancelButton} disabled={busy} onClick={cancel}>取消</Button>
        <Button danger type="primary" loading={busy} disabled={!!removeReason} onClick={() => void removeCurrentMeasure()}>确认删除</Button>
      </>}
      modalRender={(content) => <EditorModalGuard dismissable busy={busy} onDismiss={cancel}>{content}</EditorModalGuard>}>
      <p>删除第 {(resolved?.index ?? 0) + 1} 小节及其谱面内容。相关反复与跳转可能受到影响。删除后可撤销。</p>
    </Modal>}
  </>;
};
