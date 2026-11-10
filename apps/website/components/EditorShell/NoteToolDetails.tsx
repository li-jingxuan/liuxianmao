"use client";
import { Button, Select } from "antd";
import { DeleteOutlined, LinkOutlined } from "@ant-design/icons";
import type {
  ILXMDocument,
  ILXMRhythm,
  ILXMTabCellSelection,
} from "@liuxianmao/lxm-editor";
import { tabInputRhythmFromNumbered } from "@liuxianmao/lxm-editor";
import { useEditorStore } from "../../stores/editor-store";
import { MusicAssetIcon } from "../MusicAssetIcon";
import type { MusicControlIcon } from "../../assets/svg/svg-assets-manifest";
import { deriveEditorToolState } from "./editor-tool-state";
import type { ToolActionHandler } from "./editor-tool-actions";
import styles from "./index.module.scss";
import type { MusicTextTarget } from "./music-text-draft";
import taskStyles from "./SelectionTaskDetails.module.scss";

const rhythms: {
  base: ILXMRhythm["base"];
  icon: MusicControlIcon;
  label: string;
}[] = [
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
  numberedTarget?: Extract<MusicTextTarget, { kind: "numbered" }> | null;
  onEdit?: (target: MusicTextTarget) => void;
}) => {
  const overrides = useEditorStore((state) => state.tabInputRhythmOverrides);
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
  const mixedNotes = new Set(selectedNotes.map((note) =>
    typeof note.fret === "number" ? "fret" : note.fret,
  )).size > 1;
  const beat = beats.length === 1 ? beats[0] : null;
  const inputRhythm = beat && tools.focused
    ? (overrides.includes(beat.id) ? beat.rhythm : tabInputRhythmFromNumbered(tools.focused.track, tools.focused.measure, beat.id) ?? beat.rhythm)
    : null;
  const numberedMeasure =
    numberedTarget &&
    document.score.tracks
      .find((track) => track.id === numberedTarget.trackId)
      ?.measures.find((measure) => measure.id === numberedTarget.measureId);
  const numberedEvent = numberedMeasure?.numberedVoice.events.find(
    (event) => event.id === numberedTarget?.eventId,
  );
  // 简谱目标不能借仍保留的 TAB 选区执行另一谱层的时值或状态命令。
  if (numberedTarget)
    return (
      <section className={styles.toolDetails} aria-label="音符与休止详情">
        <h3 tabIndex={-1}>简谱音符</h3>
        <p className={styles.settingsHint}>
          {numberedEvent
            ? `${numberedEvent.items.length} 个成员 · ${rhythms.find((rhythm) => rhythm.base === numberedEvent.rhythm.base)?.label ?? numberedEvent.rhythm.base}${numberedEvent.rhythm.dots ? ` · ${numberedEvent.rhythm.dots} 附点` : ""}`
            : "简谱录入位置"}
        </p>
        <p className={styles.settingsHint}>
          时值、单音符音高与连接在「简谱与歌词 → 简谱」中分别编辑和应用。
        </p>
        {onEdit && (
          <div className={styles.sidebarActions}>
            <Button
              disabled={!numberedMeasure}
              onClick={() => onEdit(numberedTarget)}
            >
              编辑简谱时值与连接
            </Button>
            <Button
              disabled={!numberedMeasure}
              onClick={() =>
                onEdit({
                  kind: "lyric",
                  trackId: numberedTarget.trackId,
                  measureId: numberedTarget.measureId,
                  eventId: numberedTarget.eventId,
                  tick: numberedTarget.tick,
                  endTick: numberedTarget.endTick,
                  verse: 1,
                })
              }
            >
              填写歌词
            </Button>
          </div>
        )}
      </section>
    );
  return (
    <section className={taskStyles.noteDetails} aria-label="音符与休止详情">
      <div className={taskStyles.detailStat}>
        <span className={taskStyles.statLarge}>
          {selectedNotes.length === 1
            ? selectedNotes[0]!.fret
            : rests === beats.length && rests > 0
              ? "休"
              : selectedNotes.length}
        </span>
        <div>
          <strong>
            {selectedNotes.length === 1
              ? `第 ${selectedNotes[0]!.string} 弦 · ${selectedNotes[0]!.fret === "x" ? "x 弹奏标记" : selectedNotes[0]!.fret === "-" ? "- 延音标记" : `第 ${selectedNotes[0]!.fret} 品`}`
              : beats.length
                ? `已选 ${beats.length} 拍 · ${selectedNotes.length} 个音符`
                : "在谱面选择音符或小节"}
          </strong>
          <small>
            {selectedNotes.length
              ? `当前选中 ${selectedNotes.length} 个 TAB 音符`
              : beats.length
                ? "当前选区没有弦音符"
                : "尚未选择拍点"}
          </small>
        </div>
      </div>
      <div className={taskStyles.group}>
        <div className={taskStyles.sectionHeading}>
          <h3 tabIndex={-1}>时值</h3>
          <span>{beat ? "单拍选区" : `已选 ${beats.length} 拍`}</span>
        </div>
        <div
          className={taskStyles.durationPicker}
          role="group"
          aria-label="音符时值"
        >
          {rhythms.map((rhythm) => (
            <Button
              key={rhythm.base}
              aria-label={rhythm.label}
              title={tools.rhythm.reason || rhythm.label}
              aria-pressed={inputRhythm?.base === rhythm.base}
              disabled={blocked || !tools.rhythm.enabled}
              color={inputRhythm?.base === rhythm.base ? "primary" : "default"}
              variant={
                inputRhythm?.base === rhythm.base ? "filled" : "outlined"
              }
              onClick={() =>
                void onAction({ type: "rhythm", base: rhythm.base })
              }
            >
              <MusicAssetIcon
                assetId={rhythm.icon}
                className={styles.toolbarIcon}
              />
            </Button>
          ))}
        </div>
        <label className={taskStyles.field}>
          <span>附点</span>
          <Select
            aria-label="音符附点"
            disabled={blocked || !tools.rhythm.enabled}
            value={inputRhythm?.dots}
            placeholder="请选择单拍选区"
            options={[
              { value: 0, label: "无附点" },
              { value: 1, label: "单附点" },
              { value: 2, label: "双附点" },
            ]}
            onChange={(dots) =>
              void onAction({ type: "dots", dots: dots as 0 | 1 | 2 })
            }
          />
        </label>
        {!tools.rhythm.enabled && (
          <p className={styles.settingsHint}>{tools.rhythm.reason}</p>
        )}
      </div>
      <div className={taskStyles.group}>
        <h3 tabIndex={-1}>音符状态</h3>
        <div className={taskStyles.compactActions}>
          <Button
            disabled={blocked || !tools.note.enabled}
            onClick={() => void onAction({ type: "muted" })}
          >
            设为 x 弹奏标记
          </Button>
          <Button
            disabled={blocked || !tools.note.enabled}
            title="在所选弦格显示横线延音标记（-）"
            onClick={() => void onAction({ type: "continuation" })}
          >
            设为 - 延音标记
          </Button>
          <Button
            disabled={blocked || !tools.beatRange.enabled}
            title={
              rests === beats.length && rests > 0
                ? "取消休止（Shift+R）；不会恢复已清空的原音符"
                : "设为整拍休止（R）；清空整拍全部弦音符"
            }
            onClick={() =>
              void onAction({
                type: rests === beats.length && rests > 0 ? "restore" : "rest",
              })
            }
          >
            {rests === beats.length && rests > 0
              ? "取消整拍休止"
              : "设为整拍休止"}
          </Button>
          {rests > 0 && rests < beats.length && (
            <Button
              disabled={blocked}
              onClick={() => void onAction({ type: "restore" })}
            >
              取消选区休止
            </Button>
          )}
        </div>
        <p className={taskStyles.help}>
          {rests > 0
            ? rests === beats.length
              ? "当前选区为休止。"
              : "选区含音符与休止。"
            : mixedNotes
               ? "选区含不同类型的品位或弦格标记。"
              : ""}
          x 和 - 只修改所选弦格；休止会清空整拍全部弦音符。
          {rests > 0 && "取消休止不会恢复已清空的原音符。"}
        </p>
        <div className={taskStyles.compactActions}>
          <Button
            icon={<LinkOutlined />}
            title={
              tools.sustain.reason ||
              "延续前音一个四分音符，不重新拨弦；后方须有空白。"
            }
            disabled={blocked || !tools.sustain.enabled}
            onClick={() => void onAction({ type: "sustain" })}
          >
            延续一拍
          </Button>
          {onEdit && selection?.focus && tools.focused ? (
            <Button
              onClick={() => onEdit({ ...selection.focus, kind: "chord" })}
            >
              编辑此拍和弦
            </Button>
          ) : null}
        </div>
        {!tools.beatRange.enabled && (
          <p className={styles.settingsHint}>{tools.beatRange.reason}</p>
        )}
        {!tools.note.enabled && (
          <p className={styles.settingsHint}>{tools.note.reason}</p>
        )}
        {!tools.sustain.enabled && (
          <p className={styles.settingsHint}>{tools.sustain.reason}</p>
        )}
      </div>
      <details
        className={`${taskStyles.disclosure} ${taskStyles.noteDisclosure}`}
      >
        <summary>
          演奏技巧<small>快捷工具与当前记号</small>
        </summary>
        <p className={styles.settingsHint}>
          在顶部「技巧」工具中选择击弦、勾弦、滑音、延音等记号，再进入技巧参数。连接按既有规则选择起点与终点。
        </p>
      </details>
      <Button
        type="text"
        className={taskStyles.deleteNote}
        danger
        icon={<DeleteOutlined />}
        disabled={blocked || !tools.note.enabled}
        onClick={() => void onAction({ type: "removeNotes" })}
      >
        删除所选弦音符
      </Button>
      <p className={taskStyles.deleteHint}>
        删除只清所选弦。恢复原内容请使用撤销。
      </p>
    </section>
  );
};
