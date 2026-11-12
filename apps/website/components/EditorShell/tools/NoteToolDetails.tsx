"use client";
import { Button, Tooltip } from "antd";
import type {
  ILXMDocument,
  ILXMRhythm,
  ILXMTabCellSelection,
} from "@liuxianmao/lxm-editor";
import { tabInputRhythmFromNumbered } from "@liuxianmao/lxm-editor";
import { useEditorStore } from "../../../stores/editor-store";
import { MusicAssetIcon } from "../../MusicAssetIcon";
import type { MusicControlIcon } from "../../../assets/svg/svg-assets-manifest";
import { deriveEditorToolState } from "./editor-tool-state";
import type { ToolActionHandler } from "./editor-tool-actions";
import { TechniqueSymbol } from "./EditorToolSymbolButton";
import editorFormStyles from "../shared/editor-form.module.scss";
import editorToolPanelStyles from "../shared/editor-tool-panel.module.scss";
import type { MusicTextTarget } from "../music-text/music-text-draft";
import taskStyles from "../shared/SelectionTaskDetails.module.scss";

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
  const allRest = rests > 0 && rests === beats.length;
  // 选区中存在空弦格时属于混合状态，不能仅凭已有音符高亮 x 或横线。
  const allCellsHaveNotes = !!tools.range && selectedNotes.length === beats.length * (tools.range.endString - tools.range.startString + 1);
  const rhythmDisabled = blocked || !tools.rhythm.enabled;
  const rhythmReason = beats.length > 1 ? "时值与附点需要单拍选区" : tools.rhythm.reason;
  const blockedReason = "请先完成当前编辑或等待提交结束";
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
      <section className={editorToolPanelStyles.toolDetails} aria-label="音符与休止详情">
        <h3 tabIndex={-1}>简谱音符</h3>
        <p data-editor-form-hint className={editorFormStyles.settingsHint}>
          {numberedEvent
            ? `${numberedEvent.items.length} 个成员 · ${rhythms.find((rhythm) => rhythm.base === numberedEvent.rhythm.base)?.label ?? numberedEvent.rhythm.base}${numberedEvent.rhythm.dots ? ` · ${numberedEvent.rhythm.dots} 附点` : ""}`
            : "简谱录入位置"}
        </p>
        <p data-editor-form-hint className={editorFormStyles.settingsHint}>
          时值、单音符音高与连接在「简谱与歌词 → 简谱」中分别编辑和应用。
        </p>
        {onEdit && (
          <div data-editor-form-actions className={editorFormStyles.sidebarActions}>
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
            <Tooltip key={rhythm.base} trigger={["hover", "focus"]} title={`${rhythm.label}${rhythmDisabled ? `：${blocked ? blockedReason : rhythmReason}` : ""}`}>
            <span className={taskStyles.symbolWrapper} tabIndex={rhythmDisabled ? 0 : undefined} aria-label={rhythmDisabled ? rhythm.label : undefined}>
            <Button
              block
              aria-label={rhythm.label}
              aria-pressed={inputRhythm?.base === rhythm.base}
              disabled={rhythmDisabled}
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
                className={editorToolPanelStyles.toolbarIcon}
              />
            </Button>
            </span>
            </Tooltip>
          ))}
        </div>
        <h3>附点</h3>
        <div className={taskStyles.dotsPicker} role="group" aria-label="音符附点">
          {([0, 1, 2] as const).map((dots) => {
            const label = ["无附点", "附点", "复附点"][dots];
            return <Tooltip key={dots} trigger={["hover", "focus"]} title={`${label}${rhythmDisabled ? `：${blocked ? blockedReason : rhythmReason}` : ""}`}>
              <span className={taskStyles.symbolWrapper} tabIndex={rhythmDisabled ? 0 : undefined} aria-label={rhythmDisabled ? label : undefined}>
                <Button block aria-label={label} aria-pressed={inputRhythm?.dots === dots} disabled={rhythmDisabled}
                  color={inputRhythm?.dots === dots ? "primary" : "default"} variant={inputRhythm?.dots === dots ? "filled" : "outlined"}
                  onClick={() => void onAction({ type: "dots", dots })}>
                  <span className={taskStyles.buttonContent}>
                    <span className={taskStyles.stateIcon}><MusicAssetIcon assetId={dots === 0 ? "noteQuarter" : dots === 1 ? "noteDot" : "noteDoubleDotted"} className={editorToolPanelStyles.toolbarIcon} /></span>
                    <span>{label}</span>
                  </span>
                </Button>
              </span>
            </Tooltip>;
          })}
        </div>
      </div>
      <div className={taskStyles.group}>
        <h3 tabIndex={-1}>音符状态</h3>
        <div className={taskStyles.statePicker} role="group" aria-label="音符状态">
          {/* x 与横线始终是设置动作；只有全休止选区复用原来的 restore 语义。 */}
          {([
            { type: "muted", label: "弹奏标记", hint: "设为 x 弹奏标记：只修改所选弦格", icon: <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.6" /></svg>, enabled: tools.note.enabled, reason: tools.note.reason, pressed: allCellsHaveNotes && selectedNotes.length > 0 && selectedNotes.every((note) => note.fret === "x") && rests === 0 },
            { type: "continuation", label: "延音标记", hint: "设为 - 延音标记：只修改所选弦格", icon: <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16" stroke="currentColor" strokeWidth="1.6" /></svg>, enabled: tools.note.enabled, reason: tools.note.reason, pressed: allCellsHaveNotes && selectedNotes.length > 0 && selectedNotes.every((note) => note.fret === "-") && rests === 0 },
            { type: allRest ? "restore" : "rest", label: allRest ? "取消休止" : "整拍休止", hint: allRest ? "取消整拍休止；不会恢复已清空的原音符，恢复原内容请使用撤销" : "设为整拍休止：清空所选拍的全部弦音符", icon: <TechniqueSymbol kind="rest" />, enabled: tools.beatRange.enabled, reason: tools.beatRange.reason, pressed: allRest },
          ] as const).map((state) => {
            const disabled = blocked || !state.enabled;
            return <Tooltip key={state.type} trigger={["hover", "focus"]} title={`${state.hint}${disabled ? `：${blocked ? blockedReason : state.reason}` : ""}`}>
              <span className={taskStyles.symbolWrapper} tabIndex={disabled ? 0 : undefined} aria-label={disabled ? state.label : undefined}>
                <Button block disabled={disabled} aria-label={state.label} aria-pressed={state.pressed}
                  color={state.pressed ? "primary" : "default"} variant={state.pressed ? "filled" : "outlined"}
                  onClick={() => void onAction({ type: state.type })}>
                  <span className={taskStyles.buttonContent}><span className={taskStyles.stateIcon}>{state.icon}</span><span>{state.label}</span></span>
                </Button>
              </span>
            </Tooltip>;
          })}
        </div>
        {rests > 0 && !allRest && <Button type="link" size="small" className={taskStyles.restoreRest}
          disabled={blocked || !tools.beatRange.enabled} title="取消选区休止；不会恢复已清空的原音符"
          onClick={() => void onAction({ type: "restore" })}>取消选区休止</Button>}
      </div>
    </section>
  );
};
