"use client";
import { Button, Tooltip } from "antd";
import { DeleteOutlined, WarningOutlined } from "@ant-design/icons";
import { LXM_TUPLET_RATIOS, LXMScoreCommandEnum, resolveTupletSelection, isPureTabContinuationBeat,
  type ILXMDocument, type ILXMScoreCommand, type ILXMTabCellSelection } from "@liuxianmao/lxm-editor";
import { useEffect, useMemo, useRef, useState } from "react";
import type { EditorCommandAdapter } from "../session/editor-command-adapter";
import { formatTupletLabel } from "../shared/tuplet-label";
import { sameTupletRatio, type NumberedBeatTupletTarget, type NumberedTupletTarget } from "./editor-numbered-tuplet-target";
import type { EditorToolbarAction } from "./editor-tool-actions";
import styles from "./TupletToolbar.module.scss";

export const TupletSymbol = ({ actual, normal }: { actual: number; normal: number }) => (
  <svg width="42" height="24" viewBox="0 0 42 24" aria-hidden="true" focusable="false">
    <path d="M2 9v7h10M30 16h10V9" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <text x="21" y="16" textAnchor="middle" fill="currentColor" fontSize={actual === 5 ? "9" : "12"} fontFamily="Arial, sans-serif">{actual === 5 ? `${actual}:${normal}` : actual}</text>
  </svg>
);

/** 从选区组连音可直接应用；整拍重排先展示三个槽位，避免点击入口就改写原拍。 */
export const NumberedTupletToolbar = ({ target, beatTarget, blocked, onApply }: {
  target: NumberedTupletTarget;
  beatTarget: NumberedBeatTupletTarget;
  blocked: boolean;
  onApply: (action: Extract<EditorToolbarAction, { type: "numberedTuplet" }>) => Promise<boolean>;
}) => {
  // 拍位、原音或节奏改变后，需要重新打开预览确认。异步提交期间拦截重复点击。
  const previewKey = beatTarget.ok ? JSON.stringify(beatTarget) : null;
  const [openPreview, setOpenPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const previewTrigger = useRef<HTMLButtonElement>(null);
  const applyButton = useRef<HTMLButtonElement>(null);
  const restorePreviewFocus = useRef(false);
  const previewing = beatTarget.ok && openPreview === previewKey;
  useEffect(() => {
    // 预览替换触发按钮，进入与取消时都把键盘焦点交给当前可操作的按钮。
    if (previewing) applyButton.current?.focus();
    else if (restorePreviewFocus.current) {
      restorePreviewFocus.current = false;
      previewTrigger.current?.focus();
    }
  }, [previewing]);
  const apply = async (action: Parameters<typeof onApply>[0]) => {
    if (blocked || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      if (await onApply(action)) setOpenPreview(null);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const commonReason = blocked ? "请先完成当前编辑。" : busy ? "正在提交，请稍候。" : "";
  const removeReason = commonReason || (target.ok && !target.remove.ok ? target.remove.message : "");
  const firstEnabled = target.ok ? target.ratios.findIndex(({ target }) => target.ok) : -1;
  const focusRemove = target.ok && !!target.currentRatio;
  const focusPreview = beatTarget.ok && firstEnabled < 0 && !focusRemove;
  return <div className={styles.root} role="group" aria-label="简谱连音工具" data-presentation="popover">
    {/* 单点可能既没有连音组，也不满足拍内创建条件。右键入口仍使用此处呈现限制原因。 */}
    {!target.ok && !beatTarget.ok && <p className={styles.hint} tabIndex={-1} data-tool-action="tuplet-actions">{target.message}</p>}
    {target.ok && !previewing && <>
      <p className={styles.hint}>选择连续、书写时值相同的简谱音符。</p>
      <div className={styles.grid} role="group" aria-label="连音比例">
        {target.ratios.map(({ ratio, target: option }, index) => {
          const name = ratio.actual === 5 ? "五连音" : formatTupletLabel(ratio);
          const label = `${name}（${ratio.actual}:${ratio.normal}）`;
          const reason = commonReason || (!option.ok ? option.message : "");
          const pressed = sameTupletRatio(ratio, target.currentRatio);
          // 有匹配比例时焦点落到第一个可用按钮；全禁用且无其他入口时，聚焦说明以便键盘读到原因。
          const focus = index === firstEnabled || (index === 0 && firstEnabled < 0 && !focusRemove && !focusPreview);
          return <Tooltip key={label} title={reason ? `${label}：${reason}` : label} trigger={["hover", "focus"]}>
            <span className={styles.wrapper} tabIndex={reason ? 0 : undefined} aria-label={reason ? `${label}：${reason}` : undefined}
              data-tool-action={focus && reason ? "tuplet-actions" : undefined}>
              <Button htmlType="button" aria-label={label} aria-description={reason || undefined} aria-pressed={pressed}
                data-tool-action={focus && !reason ? "tuplet-actions" : undefined} disabled={!!reason}
                color={pressed ? "primary" : "default"} variant={pressed ? "filled" : "outlined"}
                onClick={() => void apply({ type: "numberedTuplet", operation: "add", ratio })}>
                <TupletSymbol {...ratio} />
              </Button>
            </span>
          </Tooltip>;
        })}
      </div>
      <Tooltip title={removeReason || "删除当前连音组"} trigger={["hover", "focus"]}>
        <span className={styles.wrapper} tabIndex={removeReason ? 0 : undefined} aria-label={removeReason ? `删除连音组：${removeReason}` : undefined}
          data-tool-action={focusRemove && removeReason ? "tuplet-actions" : undefined}>
          <Button block danger htmlType="button" aria-label="删除连音组" aria-description={removeReason || undefined} disabled={!!removeReason}
            data-tool-action={focusRemove && !removeReason ? "tuplet-actions" : undefined} icon={<DeleteOutlined />}
            onClick={() => void apply({ type: "numberedTuplet", operation: "remove" })}>删除连音组</Button>
        </span>
      </Tooltip>
    </>}
    {beatTarget.ok && !previewing && <Button ref={previewTrigger} block htmlType="button" data-tool-action={focusPreview ? "tuplet-actions" : undefined}
      disabled={blocked || busy} onClick={() => setOpenPreview(previewKey)}>在本拍创建三连音</Button>}
    {previewing && <div className={styles.root} role="group" aria-label="本拍三连音预览">
      <p className={styles.hint}>第 {beatTarget.measureNumber} 小节 · 第 {beatTarget.beatNumber} 拍</p>
      <div className={styles.grid} role="group" aria-label="三个等分八分音槽位">
        {beatTarget.slots.map((note, index) => <span key={index} className={styles.previewSlot}>{note ?? "空位"}</span>)}
      </div>
      <Button ref={applyButton} type="primary" htmlType="button" disabled={blocked} loading={busy}
        onClick={() => void apply({ type: "numberedTuplet", operation: "createInBeat" })}>应用</Button>
      <Button htmlType="button" disabled={busy} onClick={() => {
        restorePreviewFocus.current = true;
        setOpenPreview(null);
      }}>取消</Button>
    </div>}
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
