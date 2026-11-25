"use client";

import { QuestionCircleOutlined } from "@ant-design/icons";
import { Button, Modal, Tooltip } from "antd";
import { useState } from "react";
import {
  getMeasureRepeatAvailability,
  LXMScoreCommandEnum,
  type ILXMScore,
  type ILXMScoreCommand,
  type MeasureRepeatAvailability,
} from "@liuxianmao/lxm-editor";
import { EditorModalGuard } from "../session/EditorModalGuard";
import styles from "./MeasureRepeatInspector.module.scss";

interface MeasureRepeatInspectorProps {
  score: ILXMScore;
  measureId: string;
  documentRevision: number;
  onCancel: () => void;
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

/** 空白小节由入口直接写入。有内容或已有重复记号时，这里确认替换内容或展开现有快照。 */
export const MeasureRepeatInspector = ({
  score, measureId, documentRevision, onCancel, onApply, onSelectMeasure, onSelectBeat,
}: MeasureRepeatInspectorProps) => {
  const [applying, setApplying] = useState(false);
  const [help, setHelp] = useState(false);
  const track = score.tracks.find((candidate) => candidate.measures.some((measure) => measure.id === measureId));
  const measure = track?.measures.find((candidate) => candidate.id === measureId);
  const { enabled, existing, reason, source, target, replacement } = getMeasureRepeatAvailability(score, measureId, track?.id);

  const submit = async () => {
    if (!track || !measure || !enabled || applying) return;
    setApplying(true);
    try {
      // 覆盖许可来自此弹窗所列出的目标内容。将观察到的版本一起提交，防止确认期间把新内容误覆盖。
      const applied = await onApply(existing
        ? { type: LXMScoreCommandEnum.ExpandMeasureRepeat, trackId: track.id, measureId, expectedRevision: documentRevision }
        : { type: LXMScoreCommandEnum.AddMeasureRepeat, trackId: track.id, measureId, expectedRevision: documentRevision, allowOverwrite: !!replacement });
      if (!applied) return;
      onCancel();
      if (existing) {
        const first = [...measure.beats].sort((a, b) => a.tick - b.tick)[0];
        if (first) onSelectBeat(first.id);
      }
    } finally {
      setApplying(false);
    }
  };

  const cancel = () => { if (!applying) onCancel(); };
  const dismiss = () => { if (help) setHelp(false); else cancel(); };
  const title = existing ? "单小节重复" : "替换为单小节重复";
  return (
    <Modal open centered width={440} keyboard={false} closable={!applying} mask={{ closable: false }} onCancel={cancel}
      title={<span className={styles.title}>{title}<Tooltip title="重复前一小节的演奏内容。展开后可以继续编辑实际音符。"
        trigger={["hover", "focus"]} open={help} onOpenChange={setHelp}>
        <button type="button" className={styles.help} aria-label="单小节重复说明"><QuestionCircleOutlined aria-hidden="true" /></button>
      </Tooltip></span>}
      modalRender={(content) => <EditorModalGuard dismissable busy={applying} onDismiss={dismiss}>{content}</EditorModalGuard>}
      onOk={() => void submit()} okText={existing ? "展开为普通小节" : "替换并添加"} cancelText="取消"
      okButtonProps={{ disabled: !enabled }} confirmLoading={applying} cancelButtonProps={{ disabled: applying }}>
      <div className={styles.inspector} data-measure-repeat-inspector>
      {source && target ? (
        <p className={styles.detail}>
          第 {source.number} 小节 → 第 {target.number} 小节
          <span>{target.signature} · {target.beatCount} 拍</span>
        </p>
      ) : target ? <p className={styles.detail}>第 {target.number} 小节<span>{target.signature} · {target.beatCount} 拍</span></p> : null}
      {existing && <>
        <p>重复前一小节。展开后保留实际演奏内容。</p>
        {source && <Button disabled={applying} onClick={() => { onCancel(); onSelectMeasure(source.id); }}>编辑前一小节</Button>}
      </>}
      {reason && <p className={styles.reason}>{reason}</p>}
      {replacement && (
            <div className={styles.confirmation} data-measure-repeat-confirmation role="group" aria-label="确认替换小节内容">
              <p>将使用第 {source?.number} 小节的音乐替换第 {target?.number} 小节的内容。</p>
              <ul>
                {(Object.keys(replacementLabels) as (keyof typeof replacementLabels)[]).filter((key) => replacement[key]).map((key) => (
                  <li key={key}>{replacementLabels[key]} {replacement[key]} 项</li>
                ))}
              </ul>
            </div>
      )}
      </div>
    </Modal>
  );
};
