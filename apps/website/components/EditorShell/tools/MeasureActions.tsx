"use client";
import { Button, Tooltip } from "antd";
import { CopyOutlined, DeleteOutlined } from "@ant-design/icons";
import { useLayoutEffect, useRef, useState } from "react";
import type { ILXMDocument } from "@liuxianmao/lxm-editor";
import type { MeasureCopyDestination, MeasureToolTarget, ToolActionHandler } from "./editor-tool-actions";
import { resolveMeasureControlTarget } from "./MeasureBoundary";
import { CopyMeasureBubble } from "./CopyMeasureBubble";
import { previewMeasureRemoval } from "./measure-removal-preview";
import styles from "./MeasureControls.module.scss";

export const MeasureActions = ({ document, target, blocked, onAction, getDocument, getTargetIdentity, onBusyChange }: {
  document: ILXMDocument; target?: MeasureToolTarget | null; blocked: boolean; onAction: ToolActionHandler;
  getDocument?: () => ILXMDocument | null; getTargetIdentity?: () => string; onBusyChange?: (busy: boolean) => void;
}) => {
  const [pending, setPending] = useState<{ document: ILXMDocument; target: MeasureToolTarget; revision: number; identity: string; index: number; impact: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  const beginRemove = () => {
    if (!resolved || !target || removeReason) return;
    const preview = previewMeasureRemoval(document, target);
    if (!preview.ok) { setError(preview.message); return; }
    setError(null);
    const notes = resolved.measure.beats.reduce((count, beat) => count + beat.notes.length, 0);
    setPending({ document, target: { ...target }, revision: document.documentRevision,
      identity: getTargetIdentity?.() ?? JSON.stringify(target), index: resolved.index,
      impact: `将删除第 ${resolved.index + 1} 小节及其中 ${resolved.measure.beats.length} 个拍点、${notes} 个 TAB 音符和该小节的简谱、歌词、和弦。${preview.message}此操作可一次撤销。` });
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
  const isCurrent = () => {
    if (!pending) return false;
    const now = live.current;
    const currentDocument = now.getDocument?.() ?? now.document;
    return !now.blocked && currentDocument === pending.document && currentDocument.documentRevision === pending.revision &&
      JSON.stringify(now.target) === JSON.stringify(pending.target) &&
      (now.getTargetIdentity?.() ?? JSON.stringify(now.target)) === pending.identity &&
      !!resolveMeasureControlTarget(currentDocument, pending.target);
  };
  const stale = !!pending && (document !== pending.document || document.documentRevision !== pending.revision || JSON.stringify(target) !== JSON.stringify(pending.target) ||
    (getTargetIdentity?.() ?? JSON.stringify(target)) !== pending.identity);
  return <>
    <div className={styles.actions} role="group" aria-label="当前小节操作">
      <Tooltip trigger={["hover", "focus"]} title={reason || "在当前小节后新增空白小节，延续适用拍号"}>
        <span tabIndex={reason ? 0 : undefined} aria-label={reason || undefined}><Button data-tool-action="measure-actions" className={styles.insert} type="text" disabled={!!reason || !!pending} icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 5v14M20 5v14M4 9h16M4 15h16M12 2v6M9 5h6" /></svg>} onClick={() => { if (target) void run({ type: "insertMeasure", target }); }}>新增小节</Button></span>
      </Tooltip>
      <Tooltip trigger={["hover", "focus"]} title={reason || (openCopy ? "" : "选择当前小节的复制位置")}>
        <span tabIndex={reason ? 0 : undefined} aria-label={reason || undefined}><Button type="text" disabled={!!reason || !!pending}
          icon={<CopyOutlined />} aria-label="复制当前小节" aria-haspopup="dialog" aria-expanded={!!openCopy} onClick={(event) => {
          if (openCopy) closeCopy(true);
          else if (target) setCopy({ anchor: event.currentTarget, document, target, identity: getTargetIdentity?.() ?? JSON.stringify(target) });
        }}>复制小节</Button></span>
      </Tooltip>
      <Tooltip trigger={["hover", "focus"]} title={removeReason || "删除当前小节，先确认内容影响"}>
        <span tabIndex={removeReason ? 0 : undefined} aria-label={removeReason || undefined}><Button type="text" className={styles.remove} disabled={!!removeReason || !!pending} icon={<DeleteOutlined />} aria-label="删除当前小节" onClick={beginRemove}>删除小节</Button></span>
      </Tooltip>
    </div>
    {openCopy && copy && <CopyMeasureBubble anchor={copy.anchor} document={copy.document} target={copy.target}
      blocked={blocked} onCopy={copyTo} onDismiss={closeCopy} />}
    {error && <p role="alert">{error}</p>}
    {pending && <div className={styles.confirmation} role="region" aria-label="删除当前小节确认">
      <p>{pending.impact}</p>
      {stale && <p role="alert">目标或乐谱已变化，请取消后重新操作。</p>}
      <div className={styles.confirmButtons}><Button size="small" disabled={busy} onClick={() => setPending(null)}>取消</Button>
        <Button size="small" danger type="primary" loading={busy} disabled={blocked || stale} onClick={async () => {
          if (!isCurrent()) return;
          const success = await run({ type: "removeMeasure", target: pending.target, confirmation: { isCurrent } });
          if (success) setPending(null);
        }}>确认删除第 {pending.index + 1} 小节</Button></div>
    </div>}
  </>;
};
