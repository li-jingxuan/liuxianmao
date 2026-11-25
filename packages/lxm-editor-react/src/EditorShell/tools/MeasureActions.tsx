"use client";
import { App, Button, Tooltip } from "antd";
import { CopyOutlined, DeleteOutlined } from "@ant-design/icons";
import { useLayoutEffect, useRef, useState } from "react";
import type { ILXMDocument } from "@liuxianmao/lxm-editor";
import type { MeasureCopyDestination, MeasureToolTarget, ToolActionHandler } from "./editor-tool-actions";
import { resolveMeasureControlTarget } from "./MeasureBoundary";
import { CopyMeasureBubble } from "./CopyMeasureBubble";
import styles from "./MeasureControls.module.scss";

export const MeasureActions = ({ document, target, blocked, onAction, getDocument, getTargetIdentity, onBusyChange }: {
  document: ILXMDocument; target?: MeasureToolTarget | null; blocked: boolean; onAction: ToolActionHandler;
  getDocument?: () => ILXMDocument | null; getTargetIdentity?: () => string; onBusyChange?: (busy: boolean) => void;
}) => {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const [copy, setCopy] = useState<{ anchor: HTMLElement; document: ILXMDocument; target: MeasureToolTarget; identity: string } | null>(null);
  const lock = useRef(false);
  const live = useRef({ document, target, blocked, getDocument, getTargetIdentity });
  useLayoutEffect(() => { live.current = { document, target, blocked, getDocument, getTargetIdentity }; });
  const resolved = resolveMeasureControlTarget(document, target);
  const reason = !resolved ? "请选择目标小节。" : blocked ? "请先完成当前编辑或等待提交结束。" : busy ? "正在提交，请稍候。" : "";
  const removeReason = reason || (resolved?.track.measures.length === 1 ? "须至少保留一个小节。" : "");
  const openCopy = copy && copy.document === document && copy.target.trackId === target?.trackId &&
    copy.target.measureId === target?.measureId && copy.identity === (getTargetIdentity?.() ?? JSON.stringify(target));
  const closeCopy = (restoreFocus: boolean) => {
    setCopy(null);
    if (restoreFocus && copy?.anchor.isConnected) copy.anchor.focus({ preventScroll: true });
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
    if (!target || !resolved || removeReason) return;
    // 删除后选区可能迁移、小节可能重排，先按当前轨道记下删除前的序号。
    const measureNumber = resolved.index + 1;
    // 沿用命令的并发与草稿检查，提交成功才使用页面级消息，面板卸载也能显示。
    if (await run({ type: "removeMeasure", target })) {
      void message.success(`第 ${measureNumber} 小节已删除`);
    }
  };
  const copyTo = (destination: MeasureCopyDestination) => {
    if (!copy) return Promise.resolve(false);
    // 复用工具的实时目标检查，异步影响确认期间若切换选区或乐谱，命令应自动失效。
    const isCurrent = () => {
      const now = live.current;
      return (now.getDocument?.() ?? now.document) === copy.document &&
        (now.getTargetIdentity?.() ?? JSON.stringify(now.target)) === copy.identity;
    };
    if (!isCurrent()) return Promise.resolve(false);
    return run({ type: "copyMeasures", target: copy.target, destination, isCurrent });
  };
  return <>
    <div className={styles.actions} role="group" aria-label="当前小节操作">
      <Tooltip trigger={["hover", "focus"]} title={reason || "在当前小节后新增空白小节，延续适用拍号"}>
        <span tabIndex={reason ? 0 : undefined} aria-label={reason || undefined}><Button data-tool-action="measure-actions" className={styles.insert} type="text" disabled={!!reason} icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 5v14M20 5v14M4 9h16M4 15h16M12 2v6M9 5h6" /></svg>} onClick={() => { if (target) void run({ type: "insertMeasure", target }); }}>新增小节</Button></span>
      </Tooltip>
      <Tooltip trigger={["hover", "focus"]} title={reason || (openCopy ? "" : "选择当前小节的复制位置")}>
        <span tabIndex={reason ? 0 : undefined} aria-label={reason || undefined}><Button type="text" disabled={!!reason}
          icon={<CopyOutlined />} aria-label="复制当前小节" aria-haspopup="dialog" aria-expanded={!!openCopy} onClick={(event) => {
          if (openCopy) closeCopy(true);
          else if (target) setCopy({ anchor: event.currentTarget, document, target, identity: getTargetIdentity?.() ?? JSON.stringify(target) });
        }}>复制小节</Button></span>
      </Tooltip>
      <Tooltip trigger={["hover", "focus"]} title={removeReason || "删除当前小节，可撤销"}>
        <span tabIndex={removeReason ? 0 : undefined} aria-label={removeReason || undefined}><Button type="text" className={styles.remove} disabled={!!removeReason} icon={<DeleteOutlined />} aria-label="删除当前小节" onClick={() => { void removeCurrentMeasure(); }}>删除小节</Button></span>
      </Tooltip>
    </div>
    {openCopy && copy && <CopyMeasureBubble anchor={copy.anchor} document={copy.document} target={copy.target}
      blocked={blocked} onCopy={copyTo} onDismiss={closeCopy} />}
  </>;
};
