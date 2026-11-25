"use client";

import {
  getJumpMarkSide,
  getMeasureRepeatAvailability,
  JUMP_MARK_LABEL,
  type ILXMDocument,
  type ILXMJumpMarkKind,
  type ILXMMeasure,
} from "@liuxianmao/lxm-editor";
import type { JumpMarkInspectorRequest } from "./JumpMarkInspector";
import { EditorToolSymbolButton } from "./EditorToolSymbolButton";
import styles from "./MeasureControls.module.scss";

const jumpSymbols: readonly { kind: ILXMJumpMarkKind; glyph?: string; hint: string }[] = [
  { kind: "segno", glyph: "\uE047", hint: "回跳后从本小节第 1 拍继续" },
  { kind: "ds", hint: "弹完本小节，回到配对的 Segno" },
  { kind: "dsAlCoda", hint: "回到 Segno，重奏时经 To Coda 进入尾声" },
  { kind: "toCoda", hint: "重奏命中配对时跳至 Coda" },
  { kind: "coda", glyph: "\uE048", hint: "从本小节第 1 拍进入尾声" },
  { kind: "dc", hint: "弹完本小节，回到曲首并重奏至曲尾" },
  { kind: "fine", hint: "首遍顺行，重奏命中配对时在本小节末结束" },
  { kind: "dcAlFine", hint: "回到曲首，重奏到配对的 Fine 停止" },
  { kind: "dsAlFine", hint: "回到 Segno，重奏到配对的 Fine 停止" },
  { kind: "dcAlCoda", hint: "回到曲首，重奏时经 To Coda 进入尾声" },
];

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
}

/** 小节工具只选择符号与对应目标，填写参数、提交和替换确认由小节属性中的原表单负责。 */
export function MeasureSymbols({ document, trackId, measure, multipleMeasures, blocked, repeatEndingId, repeatEndingDisabledReason,
  onOpenRepeatEnding, onOpenJumpMarks, onOpenMeasureRepeat }: MeasureSymbolsProps) {
  const blockedReason = blocked ? "请先完成当前编辑或等待提交结束" : "";
  const endingReason = blockedReason || repeatEndingDisabledReason;
  const singleReason = blockedReason || (multipleMeasures ? "请选择一个小节" : "");
  const hasMeasureRepeat = measure.measureRepeat?.type === "previousSingle";
  // 已有缩写须始终能进入查看和展开；新增时把核心的完整边界判定原样显示在提示里。
  const measureRepeatReason = singleReason || (hasMeasureRepeat ? "" : getMeasureRepeatAvailability(document.score, measure.id, trackId).reason);

  return <section className={styles.symbolSection} aria-label="反复与跳转">
    <h4 tabIndex={-1} data-measure-symbol-heading>反复与跳转</h4>
    <div className={styles.symbols}>
      <EditorToolSymbolButton label="反复房子" title="反复房子 · 设置选区在第几遍演奏"
        variant="outlined" pressed={!!repeatEndingId}
        availability={{ enabled: !endingReason, reason: endingReason ? `反复房子 · ${endingReason}` : "" }}
        onClick={onOpenRepeatEnding}>
        <svg aria-hidden="true" viewBox="0 0 32 28">
          <path d="M4 24V7H29" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <text x="8" y="21" fill="currentColor" fontFamily="Georgia, serif" fontSize="15">1.</text>
        </svg>
      </EditorToolSymbolButton>
      <div className={styles.jumpSymbols} role="group" aria-label="跳转记号">
        {jumpSymbols.map(({ kind, glyph, hint }) => {
          const label = JUMP_MARK_LABEL[kind];
          const existing = measure.jumpMarks?.find((mark) => mark.kind === kind);
          // 首尾各自占位。允许编辑正在占用这一端的记号，也允许在另一端添加；缺配对留给右栏修复。
          const occupied = !existing && measure.jumpMarks?.some((mark) => getJumpMarkSide(mark.kind) === getJumpMarkSide(kind));
          const reason = singleReason || (occupied ? "该端已有记号，先编辑或删除它" : "");
          const [sign, continuation] = label.includes(" al ") ? label.split(/ (?=al )/) : label === "To Coda" ? ["To", "Coda"] : [label];
          return <EditorToolSymbolButton key={kind} label={label} title={`${label} · ${hint}`} variant="outlined"
            availability={{ enabled: !reason, reason: reason && `${label} · ${reason}` }} pressed={!!existing && !multipleMeasures}
            onClick={() => onOpenJumpMarks(existing ? { markId: existing.id } : { mode: "insert", markKind: kind })}>
            {glyph ? <span className={styles.musicSymbol} aria-hidden="true">{glyph}</span>
              : <span className={styles.jumpText} aria-hidden="true">{sign}{continuation && <span>{continuation}</span>}</span>}
          </EditorToolSymbolButton>;
        })}
      </div>
      <div className={styles.repeatSymbol}>
        <EditorToolSymbolButton label="单小节重复" title="单小节重复 · 当前小节重复前一小节的演奏内容"
          variant="outlined" pressed={hasMeasureRepeat && !multipleMeasures}
          availability={{ enabled: !measureRepeatReason, reason: measureRepeatReason ? `单小节重复 · ${measureRepeatReason}` : "" }}
          onClick={onOpenMeasureRepeat}>
          <span className={styles.musicSymbol} aria-hidden="true">{"\uE500"}</span>
        </EditorToolSymbolButton>
      </div>
    </div>
  </section>;
}
