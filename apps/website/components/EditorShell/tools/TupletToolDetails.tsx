"use client";
import { Button, Select } from "antd";
import { DeleteOutlined, InfoCircleOutlined } from "@ant-design/icons";
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
      ? `当前组：${group.ratio.actual}:${group.ratio.normal} · ${group.eventIds.length} 个成员`
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
  const [choice, setChoice] = useState({
    key,
    value: range?.group
      ? `${range.group.ratio.actual}:${range.group.ratio.normal}`
      : "",
  });
  if (choice.key !== key)
    setChoice({
      key,
      value: range?.group
        ? `${range.group.ratio.actual}:${range.group.ratio.normal}`
        : "",
    });
  // 文档变化也可能让同一选区不再适用，失效的待选比例不能伪装成可提交选择。
  if (
    choice.key === key &&
    choice.value &&
    (!range ||
      !LXM_TUPLET_RATIOS.some(
        (item) =>
          `${item.actual}:${item.normal}` === choice.value &&
          item.actual === range.beatIds.length,
      ))
  )
    setChoice({ key, value: "" });
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const ratio = LXM_TUPLET_RATIOS.find(
    (item) => `${item.actual}:${item.normal}` === choice.value,
  );
  const run = async (remove = false) => {
    if (blocked || lock.current || !range) return;
    lock.current = true;
    setBusy(true);
    try {
      if (remove && range.group)
        await execute({
          type: C.RemoveTuplet,
          trackId: range.trackId,
          measureId: range.measureId,
          tupletId: range.group.id,
        });
      else if (ratio)
        await execute({
          type: C.SetTuplet,
          trackId: range.trackId,
          measureId: range.measureId,
          startBeatId: range.startBeatId,
          endBeatId: range.endBeatId,
          ratio,
        });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <section className={taskStyles.noteDetails} aria-label="连音组详情">
      <div className={taskStyles.detailStat}>
        <span className={taskStyles.statLarge}>{range?.group ? `${range.group.ratio.actual}:${range.group.ratio.normal}` : "—"}</span>
        <div>
          <strong>{range?.group ? `${range.group.ratio.actual} 个音符，占 ${range.group.ratio.normal} 个音符的时间` : "当前选区未设置连音组"}</strong>
          <small>{range
            ? `第 ${measureIndex + 1} 小节 · ${first && measure ? formatNumberedBeatPosition(first.tick, measure.timeSignature.denominator) : "起点"} 至 ${last && measure ? formatNumberedBeatPosition(last.tick, measure.timeSignature.denominator) : "终点"} · ${range.beatIds.length} 个成员`
            : "请选择同小节内的连续拍点"}</small>
        </div>
      </div>
      <div className={taskStyles.field}>
        <h3 tabIndex={-1}>连音比例</h3>
      <Select
        aria-label="待应用连音比例"
        value={choice.value || undefined}
        placeholder="请选择可用比例"
        disabled={blocked || busy || !range}
        onChange={(value) => setChoice({ key, value })}
        options={LXM_TUPLET_RATIOS.map((item) => ({
          value: `${item.actual}:${item.normal}`,
          label: `${item.actual}:${item.normal}${range?.beatIds.length === item.actual ? "" : `（需连续 ${item.actual} 拍）`}`,
          disabled: !range || range.beatIds.length !== item.actual,
        }))}
      />
      </div>
      <p className={editorToolPanelStyles.selectionTip}>
        <InfoCircleOutlined aria-hidden="true" />
        <span>成员须在同一小节内，且时值、附点相同；成员数必须与比例一致。不支持跨小节、重叠或嵌套。</span>
      </p>
      {ratio && <p>{ratio.actual} 个同值音符占 {ratio.normal} 个音符的时间。</p>}
      <div className={taskStyles.tupletActions}>
      <Button
        loading={busy}
        disabled={
          blocked || !ratio || !range || range.beatIds.length !== ratio.actual
        }
        onClick={() => void run()}
      >
        应用 {choice.value || "所选"} 连音
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
      <p>连音组用于节奏分组；延音线与连音线在音符连接工具中编辑。</p>
    </section>
  );
};
