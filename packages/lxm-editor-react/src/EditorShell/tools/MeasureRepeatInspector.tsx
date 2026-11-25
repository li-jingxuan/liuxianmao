"use client";

import { Button } from "antd";
import { useState } from "react";
import {
  getMeasureRepeatAvailability,
  LXMScoreCommandEnum,
  type ILXMScore,
  type ILXMScoreCommand,
  type MeasureRepeatAvailability,
} from "@liuxianmao/lxm-editor";
import styles from "./MeasureRepeatInspector.module.scss";

interface MeasureRepeatInspectorProps {
  score: ILXMScore;
  measureId: string;
  documentRevision: number;
  onApply: (command: ILXMScoreCommand) => boolean | Promise<boolean>;
  onSelectMeasure: (measureId: string) => void;
  onSelectBeat: (beatId: string) => void;
}

const replacementLabels: Record<keyof NonNullable<MeasureRepeatAvailability["replacement"]>, string> = {
  notes: "TAB 音符",
  rhythm: "节奏拍位",
  chords: "和弦",
  numbered: "简谱事件",
  tuplets: "连音组",
  techniques: "技巧与连接",
};

/** 覆盖第二步绑定到当时的小节与版本。异步命令实际成功后才移交选区。 */
export const MeasureRepeatInspector = ({
  score, measureId, documentRevision, onApply, onSelectMeasure, onSelectBeat,
}: MeasureRepeatInspectorProps) => {
  const [confirmation, setConfirmation] = useState<{ measureId: string; revision: number } | null>(null);
  const [applying, setApplying] = useState(false);
  const track = score.tracks.find((candidate) => candidate.measures.some((measure) => measure.id === measureId));
  const measure = track?.measures.find((candidate) => candidate.id === measureId);
  const { enabled, existing, reason, source, target, replacement } = getMeasureRepeatAvailability(score, measureId, track?.id);
  const confirming = !!replacement && confirmation?.measureId === measureId && confirmation.revision === documentRevision;

  const submit = async (expand: boolean) => {
    if (!track || !measure || !enabled || applying) return;
    if (!expand && replacement && !confirming) {
      setConfirmation({ measureId, revision: documentRevision });
      return;
    }
    setApplying(true);
    try {
      const applied = await onApply(expand
        ? { type: LXMScoreCommandEnum.ExpandMeasureRepeat, trackId: track.id, measureId, expectedRevision: documentRevision }
        : { type: LXMScoreCommandEnum.AddMeasureRepeat, trackId: track.id, measureId, expectedRevision: documentRevision, allowOverwrite: confirming });
      if (!applied) return;
      setConfirmation(null);
      if (expand) {
        const first = [...measure.beats].sort((a, b) => a.tick - b.tick)[0];
        if (first) onSelectBeat(first.id);
      }
    } finally {
      setApplying(false);
    }
  };

  const alternative = source ?? (track?.measures[1] ? { id: track.measures[1].id, number: 2 } : null);
  return (
    <section className={styles.inspector} data-measure-repeat-inspector tabIndex={-1} aria-label="单小节重复">
      <h3>单小节重复</h3>
      {source && target ? (
        <p className={styles.detail}>
          第 {source.number} 小节 → 第 {target.number} 小节
          <span>{target.signature} · {target.beatCount} 拍</span>
        </p>
      ) : target ? <p className={styles.detail}>第 {target.number} 小节<span>{target.signature} · {target.beatCount} 拍</span></p> : null}
      {existing ? (
        <>
          <p>重复前一小节</p>
          <div className={styles.actions}>
            <Button type="primary" loading={applying} onClick={() => void submit(true)}>展开为普通小节</Button>
            {source && <Button disabled={applying} onClick={() => onSelectMeasure(source.id)}>编辑前一小节</Button>}
          </div>
        </>
      ) : (
        <>
          {reason && <p className={styles.reason}>{reason}</p>}
          {confirming && replacement && (
            <div className={styles.confirmation} data-measure-repeat-confirmation role="group" aria-label="确认替换小节内容">
              <p>将使用第 {source?.number} 小节的音乐替换第 {target?.number} 小节的内容。</p>
              <ul>
                {(Object.keys(replacementLabels) as (keyof typeof replacementLabels)[]).filter((key) => replacement[key]).map((key) => (
                  <li key={key}>{replacementLabels[key]} {replacement[key]} 项</li>
                ))}
              </ul>
            </div>
          )}
          <div className={styles.actions}>
            {confirming && <Button disabled={applying} onClick={() => setConfirmation(null)}>取消</Button>}
            <Button type="primary" disabled={!enabled} loading={applying} onClick={() => void submit(false)}>
              {confirming ? "替换并添加记号" : "添加单小节重复"}
            </Button>
            {!enabled && alternative && (
              <Button onClick={() => onSelectMeasure(alternative.id)}>
                {source ? "查看前一小节" : `去第 ${alternative.number} 小节`}
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
};
