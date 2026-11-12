"use client";
import { Button, Tooltip } from "antd";
import { DeleteOutlined } from "@ant-design/icons";
import { useRef, useState } from "react";
import {
  LXMScoreCommandEnum as C,
  LXM_TUPLET_RATIOS,
  resolveTupletSelection,
  type ILXMDocument,
  type ILXMNumberedTarget,
  type ILXMTabCellSelection,
} from "@liuxianmao/lxm-editor";
import type { EditorCommandAdapter } from "../session/editor-command-adapter";
import editorFormStyles from "../shared/editor-form.module.scss";
import editorToolPanelStyles from "../shared/editor-tool-panel.module.scss";
import taskStyles from "../shared/SelectionTaskDetails.module.scss";
import { formatNumberedBeatPosition, resolveNumberedEditorTarget } from "../numbered/numbered-editor-target";
import type { MusicTextTarget } from "../music-text/music-text-draft";
import { formatTupletExplanation, formatTupletLabel } from "../shared/tuplet-label";
import styles from "./TupletToolDetails.module.scss";

/** 简谱选择只读取独立声部，绝不把仍保留的 TAB 选区当成连音成员。 */
export const TupletToolDetails = ({ numberedSelection, onEditNumberedRhythm, ...props }: {
  document: ILXMDocument;
  selection: ILXMTabCellSelection | null;
  numberedSelection?: ILXMNumberedTarget | null;
  blocked: boolean;
  execute: EditorCommandAdapter;
  onEditNumberedRhythm?: (target: MusicTextTarget) => void;
}) => {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  if (!numberedSelection) return <TabTupletToolDetails {...props} />;
  const { document, blocked, execute } = props;
  const resolved = resolveNumberedEditorTarget(document, numberedSelection);
  const track = document.score.tracks.find((item) => item.id === resolved?.trackId);
  const measureIndex = track?.measures.findIndex((item) => item.id === resolved?.measureId) ?? -1;
  const measure = track?.measures[measureIndex];
  const event = resolved?.kind === "numberedEvent"
    ? measure?.numberedVoice.events.find((item) => item.id === resolved.eventId) : null;
  const group = event && measure?.numberedVoice.tuplets.find((item) => item.eventIds.includes(event.id));
  const tick = event?.tick ?? (resolved?.kind === "numberedTime" ? resolved.tick : undefined);
  return <section className={editorToolPanelStyles.toolDetails} aria-label="简谱连音组详情">
    <h3 tabIndex={-1}>简谱连音组</h3>
    <div className={editorToolPanelStyles.toolTarget}>{measure && tick !== undefined
      ? `第 ${measureIndex + 1} 小节 · ${formatNumberedBeatPosition(tick, measure.timeSignature.denominator)}`
      : "原简谱位置已失效，请重新选择。"}</div>
    <p data-editor-form-hint className={editorFormStyles.settingsHint}>{group
      ? `当前组：${formatTupletLabel(group.ratio)} · ${group.eventIds.length} 个成员`
      : "当前简谱位置没有连音组。请在简谱的节奏与范围中设置连音。"}</p>
    <p data-editor-form-hint className={editorFormStyles.settingsHint}>连音组用于节奏分组；延音线与连音线请在对应音符的连接工具中编辑。</p>
    <Button block disabled={blocked || busy || !resolved || !onEditNumberedRhythm}
      onClick={() => resolved && onEditNumberedRhythm?.({ ...resolved, kind: "numbered" })}>编辑简谱节奏与范围</Button>
    <Button danger block loading={busy} disabled={blocked || busy || !group}
      onClick={() => {
        if (blocked || lock.current || !resolved || !group) return;
        lock.current = true;
        setBusy(true);
        void Promise.resolve(execute({ type: "numbered.tuplet.remove", trackId: resolved.trackId,
          measureId: resolved.measureId, tupletId: group.id })).finally(() => {
          lock.current = false;
          setBusy(false);
        });
      }}>删除当前简谱连音组</Button>
  </section>;
};

/** 待选比例不写音乐，只有明确应用才执行；详情始终挂载，收纳不丢准备状态。 */
const TabTupletToolDetails = ({
  document,
  selection,
  blocked,
  execute,
}: {
  document: ILXMDocument;
  selection: ILXMTabCellSelection | null;
  blocked: boolean;
  execute: EditorCommandAdapter;
}) => {
  const range = resolveTupletSelection(document, selection);
  const track = document.score.tracks.find((item) => item.id === range?.trackId);
  const measureIndex = track?.measures.findIndex((item) => item.id === range?.measureId) ?? -1;
  const measure = track?.measures[measureIndex];
  const first = measure?.beats.find((item) => item.id === range?.startBeatId);
  const last = measure?.beats.find((item) => item.id === range?.endBeatId);
  const key = JSON.stringify(selection);
  const [choice, setChoice] = useState<{ key: string; value: string | null }>({ key, value: null });
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  // 只派生成员可用性；整数 tick 和容量仍交给核心命令最终裁定。
  const members = measure?.beats.filter((beat) => range?.beatIds.includes(beat.id)) ?? [];
  const rhythmMismatch = members.some((beat) => beat.rhythm.base !== first?.rhythm.base || beat.rhythm.dots !== first?.rhythm.dots);
  const overlaps = measure?.tuplets.some((group) => group.id !== range?.group?.id && group.beatIds.some((id) => range?.beatIds.includes(id)));
  const unavailableReason = (actual: number) => {
    if (!range) return "请选择同小节内的连续拍点";
    if (range.beatIds.length !== actual) return `需要 ${actual} 个连续拍点，当前选中 ${range.beatIds.length} 个`;
    if (rhythmMismatch) return "请选择书写时值和附点相同的拍点";
    if (overlaps) return "连音组不能部分重叠或嵌套，请先删除原组";
    return null;
  };
  const ratio = LXM_TUPLET_RATIOS.find(
    (item) => choice.key === key && `${item.actual}:${item.normal}` === choice.value,
  );
  // 当前组不是草稿；换目标或文档使草稿失效时，立即取消待应用选择。
  if (choice.key !== key || (choice.value !== null && (!ratio || unavailableReason(ratio.actual))))
    setChoice({ key, value: null });
  const pending = ratio && !unavailableReason(ratio.actual) ? ratio : null;
  const highlighted = pending ?? range?.group?.ratio;
  const run = async (remove = false) => {
    if (blocked || lock.current || !range || (remove ? !range.group : !pending)) return;
    const submittedKey = key;
    const submittedValue = choice.value;
    lock.current = true;
    setBusy(true);
    try {
      let result;
      if (remove && range.group)
        result = await execute({
          type: C.RemoveTuplet,
          trackId: range.trackId,
          measureId: range.measureId,
          tupletId: range.group.id,
        });
      else if (pending)
        result = await execute({
          type: C.SetTuplet,
          trackId: range.trackId,
          measureId: range.measureId,
          startBeatId: range.startBeatId,
          endBeatId: range.endBeatId,
          ratio: pending,
        });
      // noop 不会换文档，也必须清理草稿；旧提交不能清掉新目标的待选值。
      if (result?.status === "applied" || result?.status === "noop")
        setChoice((current) => current.key === submittedKey && current.value === submittedValue
          ? { key: current.key, value: null } : current);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <section className={taskStyles.noteDetails} aria-label="连音组详情">
      <div className={taskStyles.detailStat}>
        <span className={styles.currentName}>{range?.group ? formatTupletLabel(range.group.ratio) : "—"}</span>
        <div>
          <strong>{range?.group ? formatTupletExplanation(range.group.ratio) : "当前选区未设置连音组"}</strong>
          <small>{range
            ? `第 ${measureIndex + 1} 小节 · ${first && measure ? formatNumberedBeatPosition(first.tick, measure.timeSignature.denominator) : "起点"} 至 ${last && measure ? formatNumberedBeatPosition(last.tick, measure.timeSignature.denominator) : "终点"} · ${range.beatIds.length} 个成员`
            : "请选择同小节内的连续拍点"}</small>
        </div>
      </div>
      <div className={taskStyles.field}>
        <h3 tabIndex={-1}>连音类型</h3>
        <div className={styles.typePicker} role="group" aria-label="待应用连音类型">
          {LXM_TUPLET_RATIOS.map((item) => {
            const value = `${item.actual}:${item.normal}`;
            const label = formatTupletLabel(item);
            const reason = unavailableReason(item.actual) ?? (blocked ? "先完成属性编辑，再修改 TAB。" : busy ? "正在提交，请稍候" : null);
            const tooltip = `${formatTupletExplanation(item)}${reason ? `；${reason}` : ""}`;
            return <Tooltip key={value} title={tooltip} trigger={["hover", "focus"]}>
              <span tabIndex={reason ? 0 : undefined} aria-label={reason ? `${label}：${tooltip}` : undefined}>
                <Button htmlType="button" aria-label={label} disabled={!!reason}
                  aria-pressed={highlighted?.actual === item.actual && highlighted.normal === item.normal}
                  onClick={() => setChoice({ key, value })}>
                  <span className={styles.typeLabel}>{item.actual === 5 ? <>五连音<small>（{value}）</small></> : label}</span>
                </Button>
              </span>
            </Tooltip>;
          })}
        </div>
      </div>
      {pending && <p role="status">待应用{formatTupletLabel(pending)}</p>}
      <div className={taskStyles.tupletActions}>
      <Button
        loading={busy}
        disabled={
          blocked || busy || !pending || !range
        }
        onClick={() => void run()}
      >
        {pending ? `应用${formatTupletLabel(pending)}` : "应用所选连音"}
      </Button>
      <Button
        danger
        type="text"
        icon={<DeleteOutlined />}
        className={taskStyles.deleteNote}
        disabled={blocked || busy || !range?.group}
        onClick={() => void run(true)}
      >
        删除当前连音组
      </Button>
      </div>
    </section>
  );
};
