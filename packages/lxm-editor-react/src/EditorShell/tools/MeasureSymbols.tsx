"use client";

import {
  getJumpMarkFields,
  getJumpMarkSide,
  getMeasureRepeatAvailability,
  JUMP_MARK_LABEL,
  type ILXMDocument,
  type ILXMJumpMarkKind,
  type ILXMMeasure,
  type ILXMTrack,
} from "@liuxianmao/lxm-editor";
import type { ReactNode } from "react";
import type { JumpMarkInspectorRequest } from "./JumpMarkInspector";
import { EditorToolSymbolButton } from "./EditorToolSymbolButton";
import { JUMP_MARK_SYMBOLS, JumpMarkSymbol } from "./JumpMarkSymbol";
import type { MeasureToolTarget } from "./editor-tool-actions";
import styles from "./MeasureControls.module.scss";

export interface MeasureSymbolCallbacks {
  onOpenJumpMarks: (target: MeasureToolTarget, request: JumpMarkInspectorRequest) => boolean;
  onOpenRepeatEnding: (target: MeasureToolTarget, measureIds: readonly string[], endingId?: string) => boolean;
  onOpenMeasureRepeat: (target: MeasureToolTarget) => boolean;
  onPlaceJumpMark?: (target: MeasureToolTarget, kind: ILXMJumpMarkKind) => boolean | Promise<boolean>;
}

/** 单节命中房子区间，范围选择只命中具有相同首尾的房子。 */
export function resolveMeasureEndingId(track: ILXMTrack, measureIds: readonly string[]) {
  return track.repeatEndingGroups?.flatMap(({ endings }) => endings).find((ending) => {
    if (measureIds.length > 1) return ending.startMeasureId === measureIds[0] && ending.endMeasureId === measureIds.at(-1);
    const index = track.measures.findIndex(({ id }) => id === measureIds[0]);
    const first = track.measures.findIndex(({ id }) => id === ending.startMeasureId);
    const last = track.measures.findIndex(({ id }) => id === ending.endMeasureId);
    return first >= 0 && first <= index && index <= last;
  })?.id;
}

interface MeasureSymbolsProps {
  document: ILXMDocument;
  trackId: string;
  measure: ILXMMeasure;
  multipleMeasures: boolean;
  blocked: boolean;
  repeatEndingId?: string;
  repeatEndingDisabledReason?: string;
  onOpenRepeatEnding: () => void;
  onOpenJumpMarks: (request: JumpMarkInspectorRequest) => void;
  onOpenMeasureRepeat: () => void;
  /** 普通无参数记号的一键落谱入口，由会话 owner 接线。 */
  onPlaceJumpMark?: (kind: ILXMJumpMarkKind) => void;
}

/** 两处小节入口共用记号的排列、可用性和直落谱判断。 */
export function MeasureSymbols({ document, trackId, measure, multipleMeasures, blocked, repeatEndingId, repeatEndingDisabledReason,
  onOpenRepeatEnding, onOpenJumpMarks, onOpenMeasureRepeat, onPlaceJumpMark }: MeasureSymbolsProps) {
  const blockedReason = blocked ? "请先完成当前编辑或等待提交结束" : "";
  const endingReason = blockedReason || repeatEndingDisabledReason;
  const singleReason = blockedReason || (multipleMeasures ? "请选择一个小节" : "");
  const hasMeasureRepeat = measure.measureRepeat?.type === "previousSingle";
  // 已有缩写须始终能进入查看和展开；新增时把核心的完整边界判定原样显示在提示里。
  const measureRepeatReason = singleReason || (hasMeasureRepeat ? "" : getMeasureRepeatAvailability(document.score, measure.id, trackId).reason);

  const markButton = (label: string, title: string, reason: string, pressed: boolean,
    onClick: () => void, children: ReactNode, notation?: string) => <div key={label} className={styles.markItem}>
      <EditorToolSymbolButton label={notation ? `${label}（${notation}）` : label} title={title} variant="outlined" pressed={pressed}
        availability={{ enabled: !reason, reason: reason ? `${label} · ${reason}` : "" }} onClick={onClick}>
        {children}
      </EditorToolSymbolButton>
      <span className={styles.markLabel} aria-hidden="true">{label}</span>
    </div>;

  return <section className={styles.symbolSection} aria-label="反复与跳转">
    <h4 tabIndex={-1} data-measure-symbol-heading>反复与跳转</h4>
    <div className={styles.symbols} role="group" aria-label="反复与跳转">
      {markButton("反复房子", "反复房子 · 设置选区在第几遍演奏",
        endingReason ?? "", !!repeatEndingId, onOpenRepeatEnding,
        <svg aria-hidden="true" viewBox="0 0 32 28"><path d="M4 24V7H29" fill="none" stroke="currentColor" strokeWidth="1.3" /><text x="8" y="21" fill="currentColor" fontFamily="Georgia, serif" fontSize="15">1.</text></svg>)}
      {JUMP_MARK_SYMBOLS.map(({ kind, description: label, glyph, hint }) => {
        const englishLabel = JUMP_MARK_LABEL[kind];
        const existing = measure.jumpMarks?.find((mark) => mark.kind === kind);
        // 首尾各有一个位置。已有记号按 ID 打开编辑，另一端仍可以新增。
        const occupied = !existing && measure.jumpMarks?.some((mark) => getJumpMarkSide(mark.kind) === getJumpMarkSide(kind));
        const reason = singleReason || (occupied ? "该端已有记号，先编辑或删除它" : "");
        const place = () => {
          if (existing) {
            onOpenJumpMarks({ markId: existing.id });
          } else if (!getJumpMarkFields(kind).length && onPlaceJumpMark) {
            onPlaceJumpMark(kind);
          } else {
            onOpenJumpMarks({ mode: "insert", markKind: kind });
          }
        };
        return markButton(label, `${englishLabel} · ${hint}`, reason, !!existing && !multipleMeasures, place,
          <JumpMarkSymbol name={englishLabel} glyph={glyph} />, englishLabel);
      })}
      {markButton("小节重复", "小节重复 · 当前小节重复前一小节的演奏内容",
        measureRepeatReason ?? "", hasMeasureRepeat && !multipleMeasures, onOpenMeasureRepeat,
        <span className={styles.musicSymbol} aria-hidden="true">{"\uE500"}</span>, "单小节重复")}
    </div>
  </section>;
}
