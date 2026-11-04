"use client";
import { Button, Segmented } from "antd";
import {
  DeleteOutlined,
  InfoCircleOutlined,
  ExclamationCircleOutlined,
} from "@ant-design/icons";
import type {
  ILXMDocument,
  ILXMRhythm,
  ILXMTabCellSelection,
} from "@liuxianmao/lxm-editor";
import { MusicAssetIcon } from "../MusicAssetIcon";
import type { MusicControlIcon } from "../../assets/svg/svg-assets-manifest";
import { deriveEditorToolState } from "./editor-tool-state";
import type { ToolActionHandler } from "./editor-tool-actions";
import styles from "./index.module.scss";
import type { MusicTextTarget } from "./music-text-draft";
import { formatNumberedBeatPosition } from "./numbered-editor-target";
import taskStyles from "./SelectionTaskDetails.module.scss";

const rhythms: { base: ILXMRhythm["base"]; icon: MusicControlIcon; label: string }[] = [
  { base: "whole", icon: "noteWhole", label: "全音符" },
  { base: "half", icon: "noteHalf", label: "二分音符" },
  { base: "quarter", icon: "noteQuarter", label: "四分音符" },
  { base: "eighth", icon: "noteEighth", label: "八分音符" },
  { base: "sixteenth", icon: "noteSixteenth", label: "十六分音符" },
  { base: "thirtySecond", icon: "noteThirtySecond", label: "三十二分音符" },
];

/** 详情只读真实选区，按钮与顶部工具发送同一动作。 */
export const NoteToolDetails = ({
  document,
  selection,
  blocked,
  onAction,
  numberedTarget,
  onEdit,
}: {
  document: ILXMDocument;
  selection: ILXMTabCellSelection | null;
  blocked: boolean;
  onAction: ToolActionHandler;
  numberedTarget?: Extract<MusicTextTarget, {kind:"numbered"}> | null;
  onEdit?: (target: MusicTextTarget) => void;
}) => {
  const tools = deriveEditorToolState(document, selection);
  const beats =
    tools.range?.beats.flatMap(
      (ref) =>
        document.score.tracks
          .find((track) => track.id === ref.trackId)
          ?.measures.find((measure) => measure.id === ref.measureId)
          ?.beats.filter((beat) => beat.id === ref.beatId) ?? [],
    ) ?? [];
  const rests = beats.filter((beat) => beat.kind === "rest").length;
  const selectedNotes = beats.flatMap((beat) =>
    beat.notes.filter(
      (note) =>
        tools.range &&
        note.string >= tools.range.startString &&
        note.string <= tools.range.endString,
    ),
  );
  const mixedNotes =
    selectedNotes.some((note) => note.fret === "x") &&
    selectedNotes.some((note) => note.fret !== "x");
  const beat = beats.length === 1 ? beats[0] : null;
  const numberedMeasure = numberedTarget && document.score.tracks
    .find((track) => track.id === numberedTarget.trackId)?.measures
    .find((measure) => measure.id === numberedTarget.measureId);
  const numberedEvent = numberedMeasure?.numberedVoice.events.find((event) => event.id === numberedTarget?.eventId);
  // 简谱目标不能借仍保留的 TAB 选区执行另一谱层的时值或状态命令。
  if (numberedTarget) return (
    <section className={styles.toolDetails} aria-label="音符与休止详情">
      <h3 tabIndex={-1}>简谱音符</h3>
      <p className={styles.settingsHint}>
        {numberedEvent ? `${numberedEvent.items.length} 个成员 · ${rhythms.find((rhythm) => rhythm.base === numberedEvent.rhythm.base)?.label ?? numberedEvent.rhythm.base}${numberedEvent.rhythm.dots ? ` · ${numberedEvent.rhythm.dots} 附点` : ""}` : "简谱录入位置"}
      </p>
      <p className={styles.settingsHint}>时值、单音符音高与连接在「简谱与歌词 → 简谱」中分别编辑和应用。</p>
      {onEdit && <div className={styles.sidebarActions}>
        <Button disabled={!numberedMeasure} onClick={() => onEdit(numberedTarget)}>编辑简谱</Button>
        <Button disabled={!numberedMeasure} onClick={() => onEdit({ kind: "lyric", trackId: numberedTarget.trackId, measureId: numberedTarget.measureId,
          eventId: numberedTarget.eventId, tick: numberedTarget.tick, endTick: numberedTarget.endTick, verse: 1 })}>填写歌词</Button>
      </div>}
    </section>
  );
  return (
    <section className={styles.toolDetails} aria-label="音符与休止详情">
      <h3 tabIndex={-1}>音符与休止</h3>
      {onEdit && selection?.focus && tools.focused ? <Button onClick={() => onEdit({ ...selection.focus, kind:"chord" })}>编辑此拍和弦</Button> : null}
      <div className={styles.toolTarget}>
        {tools.focused
          ? `TAB · 第 ${tools.focused.index + 1} 小节${beat ? ` · ${formatNumberedBeatPosition(beat.tick, tools.focused.measure.timeSignature.denominator)}` : ` · 已选 ${beats.length} 拍`}${selectedNotes.length === 1 ? ` · 第 ${selectedNotes[0]!.string} 弦 · ${selectedNotes[0]!.fret === "x" ? "闷音 x" : `第 ${selectedNotes[0]!.fret} 品`}` : ` · ${selectedNotes.length} 个音符`}`
          : "在谱面选择音符或小节"}
      </div>
      <div className={taskStyles.group}>
        <h3 tabIndex={-1}>时值</h3>
        <div className={taskStyles.durationPicker} role="group" aria-label="音符时值">
          {rhythms.map((rhythm) => <Button
            key={rhythm.base}
            aria-label={rhythm.label}
            title={tools.rhythm.reason || rhythm.label}
            aria-pressed={beat?.rhythm.base === rhythm.base}
            disabled={blocked || !tools.rhythm.enabled}
            color={beat?.rhythm.base === rhythm.base ? "primary" : "default"}
            variant={beat?.rhythm.base === rhythm.base ? "filled" : "outlined"}
            onClick={() => void onAction({ type: "rhythm", base: rhythm.base })}
          ><MusicAssetIcon assetId={rhythm.icon} className={styles.toolbarIcon} /></Button>)}
        </div>
        <h3 tabIndex={-1}>附点</h3>
        <Segmented
          block
          aria-label="音符附点"
          disabled={blocked || !tools.rhythm.enabled}
          value={beat?.rhythm.dots ?? -1}
          options={[
            { value: 0, label: "无附点" },
            { value: 1, label: "单附点" },
            { value: 2, label: "双附点" },
          ]}
          onChange={(dots) => void onAction({ type: "dots", dots: dots as 0 | 1 | 2 })}
        />
        {!tools.rhythm.enabled && <p className={styles.settingsHint}>{tools.rhythm.reason}</p>}
      </div>
      <div className={taskStyles.group}>
      <h3 tabIndex={-1}>音符状态</h3>
      {/* 选区说明采用紧凑图文，保留状态与操作影响，避免提示卡片挤占操作空间。 */}
      <p className={styles.selectionTip}>
        <InfoCircleOutlined aria-hidden="true" />
        <span>
          {!beats.length
            ? "尚未选择拍点"
            : rests && rests === beats.length
              ? "当前拍为休止"
              : rests
                ? "选区为混合状态"
                : mixedNotes
                  ? "选区含普通音符与闷音的混合状态"
                  : "当前拍为音符"}
          。休止属于整拍；取消休止不会恢复已清空的原音符。
        </span>
      </p>
      <Button
        type="primary"
        block
        disabled={blocked || !tools.beatRange.enabled}
        onClick={() =>
          void onAction({
            type: rests === beats.length && rests > 0 ? "restore" : "rest",
          })
        }
      >
        {rests === beats.length && rests > 0
          ? "取消休止（Shift+R）"
          : "设为休止（R）"}
      </Button>
      {rests > 0 && rests < beats.length && (
        <Button
          block
          disabled={blocked}
          onClick={() => void onAction({ type: "restore" })}
        >
          取消选区休止
        </Button>
      )}
      <Button
        block
        disabled={blocked || !tools.note.enabled}
        onClick={() => void onAction({ type: "muted" })}
      >
        设置闷音音符 x
      </Button>
      {!tools.beatRange.enabled && <p className={styles.settingsHint}>{tools.beatRange.reason}</p>}
      {!tools.note.enabled && <p className={styles.settingsHint}>{tools.note.reason}</p>}
      </div>
      <details className={taskStyles.disclosure}>
        <summary>演奏技巧<small>快捷工具与当前记号</small></summary>
        <p className={styles.settingsHint}>在顶部「技巧」工具中选择击弦、勾弦、滑音、延音等记号，再进入技巧参数。连接按既有规则选择起点与终点。</p>
      </details>
      <Button
        block
        danger
        icon={<DeleteOutlined />}
        disabled={blocked || !tools.note.enabled}
        onClick={() => void onAction({ type: "removeNotes" })}
      >
        删除所选音符
      </Button>
      <p className={styles.selectionTip}>
        <ExclamationCircleOutlined aria-hidden="true" />
        <span>删除只清所选弦；休止清整拍全部弦。恢复原内容请使用撤销。</span>
      </p>
    </section>
  );
};
