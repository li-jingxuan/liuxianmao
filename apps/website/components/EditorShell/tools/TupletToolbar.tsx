"use client";
import { Button, Tooltip } from "antd";
import { DeleteOutlined, WarningOutlined } from "@ant-design/icons";
import { LXM_TUPLET_RATIOS, LXMScoreCommandEnum, resolveTupletSelection, isPureTabContinuationBeat,
  type ILXMDocument, type ILXMNumberedTupletCommand, type ILXMScoreCommand, type ILXMTabCellSelection } from "@liuxianmao/lxm-editor";
import { useMemo, useRef, useState } from "react";
import type { EditorCommandAdapter } from "../session/editor-command-adapter";
import { formatTupletLabel } from "../shared/tuplet-label";
import styles from "./TupletToolbar.module.scss";

export const TupletSymbol = ({ actual, normal }: { actual: number; normal: number }) => (
  <svg width="42" height="24" viewBox="0 0 42 24" aria-hidden="true" focusable="false">
    <path d="M2 9v7h10M30 16h10V9" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <text x="21" y="16" textAnchor="middle" fill="currentColor" fontSize={actual === 5 ? "9" : "12"} fontFamily="Arial, sans-serif">{actual === 5 ? `${actual}:${normal}` : actual}</text>
  </svg>
);

/** 简谱入口沿用连音工具的位置与操作样式，按钮只提供已支持的三连音比例。 */
export const NumberedTupletToolbar = ({ command, blocked, onApply }: {
  command: ILXMNumberedTupletCommand;
  blocked: boolean;
  onApply: (operation: "add" | "remove") => Promise<boolean>;
}) => {
  const removing = command.type === "numbered.tuplet.remove";
  const label = removing ? "删除连音组" : "三连音（3:2）";
  return <div className={styles.root} role="group" aria-label="简谱连音工具" data-presentation="popover">
    <Button block danger={removing} htmlType="button" data-tool-action="tuplet-actions" disabled={blocked}
      icon={removing ? <DeleteOutlined /> : undefined} onClick={() => void onApply(removing ? "remove" : "add")}>{label}</Button>
  </div>;
};

export const resolveTupletToolbarTarget = (document: ILXMDocument, selection: ILXMTabCellSelection | null) => {
  const range = resolveTupletSelection(document, selection);
  const hasContinuation = !!range && document.score.tracks.find((track) => track.id === range.trackId)?.measures
    .find((measure) => measure.id === range.measureId)?.beats.some((beat) => range.beatIds.includes(beat.id) && isPureTabContinuationBeat(beat));
  const reason = !selection ? "请先选择 TAB 目标。" : !range ? "请选择 TAB 同小节内连续拍点，不可跨小节。" : "";
  const ratioReason = (actual: number) => reason || (hasContinuation ? "延音标记不能设为连音成员。"
    : range?.beatIds.length !== actual ? `需要同小节内连续 ${actual} 个拍点，实际拍点数须为 ${actual}。`
      : range.partiallyOverlapsTuplet ? "请扩大选区以覆盖完整的原连音组" : "");
  return { range, reason, ratioReason };
};

/** 选区和 actual 数量来自核心 resolver；图标仅改变展示。 */
export const TupletToolbar = ({ document, selection, execute, blocked = false, blockedReason, onSuccess,
  presentation = "popover", onBusyChange }: {
  document: ILXMDocument; selection: ILXMTabCellSelection | null; execute: EditorCommandAdapter;
  blocked?: boolean; blockedReason?: string; onSuccess?: () => void; presentation?: "popover" | "sidebar";
  onBusyChange?: (busy: boolean) => void;
}) => {
  const { range, reason: targetReason, ratioReason } = useMemo(() => resolveTupletToolbarTarget(document, selection), [document, selection]);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const run = async (command: ILXMScoreCommand) => {
    if (lock.current || blocked) return;
    lock.current = true; setBusy(true); onBusyChange?.(true);
    try {
      const result = await execute(command);
      if (result.status === "applied" || result.status === "noop") onSuccess?.();
    } finally { lock.current = false; setBusy(false); onBusyChange?.(false); }
  };
  const baseReason = blocked ? blockedReason || "先完成属性编辑，再修改 TAB。" : busy ? "正在提交，请稍候。"
    : blockedReason || targetReason;
  const removeReason = baseReason || (!range?.group ? "请选择可定位的已有连音组。" : "");
  const sidebar = presentation === "sidebar";
  const hint = <p className={styles.hint}>
    {!sidebar && <WarningOutlined aria-hidden="true" />}
    <span>同小节内，连续拍点数须与连音数字一致。</span>
  </p>;
  return <div className={styles.root} data-presentation={presentation} role="group" aria-label="连音工具">
    {!sidebar && hint}
    <div className={styles.grid}>
      {LXM_TUPLET_RATIOS.map((ratio) => {
        const label = `${ratio.actual}:${ratio.normal}`;
        const name = formatTupletLabel(ratio);
        const reason = baseReason || ratioReason(ratio.actual);
        const pressed = range?.group?.ratio.actual === ratio.actual && range.group.ratio.normal === ratio.normal;
        return <Tooltip key={label} title={`${name}（${label}）${reason ? `：${reason}` : ""}`} trigger={["hover", "focus"]}>
          <span className={styles.wrapper} tabIndex={reason ? 0 : undefined} aria-label={reason ? `${name}：${reason}` : undefined}>
            <Button data-tool-action={label === "2:3" ? "tuplet-actions" : undefined} htmlType="button" aria-label={`${name}（${label}）`} aria-description={reason || undefined}
              aria-pressed={pressed} disabled={!!reason} color={pressed ? "primary" : "default"} variant={pressed ? "filled" : "outlined"}
              onClick={() => { if (range) void run({ type: LXMScoreCommandEnum.SetTuplet, trackId: range.trackId, measureId: range.measureId, startBeatId: range.startBeatId, endBeatId: range.endBeatId, ratio }); }}>
              <TupletSymbol actual={ratio.actual} normal={ratio.normal} />
            </Button>
          </span>
        </Tooltip>;
      })}
    </div>
    {(!sidebar || !!range?.group) && <Tooltip title={removeReason || "删除当前连音组"} trigger={["hover", "focus"]}>
      <span className={styles.wrapper} tabIndex={removeReason ? 0 : undefined} aria-label={removeReason ? `删除连音组：${removeReason}` : undefined}>
        <Button block danger htmlType="button" aria-label="删除连音组" disabled={!!removeReason} icon={<DeleteOutlined />}
          onClick={() => { if (range?.group) void run({ type: LXMScoreCommandEnum.RemoveTuplet, trackId: range.trackId, measureId: range.measureId, tupletId: range.group.id }); }}>删除连音组</Button>
      </span>
    </Tooltip>}
    {sidebar && hint}
  </div>;
};
