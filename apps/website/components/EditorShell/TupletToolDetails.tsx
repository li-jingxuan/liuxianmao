"use client";
import { Alert, Button, Radio, Tooltip } from "antd";
import { useRef, useState } from "react";
import {
  LXMScoreCommandEnum as C,
  LXM_TUPLET_RATIOS,
  resolveTupletSelection,
  type ILXMDocument,
  type ILXMNumberedTarget,
  type ILXMTabCellSelection,
} from "@liuxianmao/lxm-editor";
import type { EditorCommandAdapter } from "./editor-command-adapter";
import styles from "./index.module.scss";
import { formatNumberedBeatPosition, resolveNumberedEditorTarget } from "./numbered-editor-target";
import type { MusicTextTarget } from "./music-text-draft";

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
  return <section className={styles.toolDetails} aria-label="简谱连音组详情">
    <h3 tabIndex={-1}>简谱连音组</h3>
    <div className={styles.toolTarget}>{measure && tick !== undefined
      ? `第 ${measureIndex + 1} 小节 · ${formatNumberedBeatPosition(tick, measure.timeSignature.denominator)}`
      : "原简谱位置已失效，请重新选择。"}</div>
    <p className={styles.settingsHint}>{group
      ? `当前组：${group.ratio.actual}:${group.ratio.normal} · ${group.eventIds.length} 个成员`
      : "当前简谱位置没有连音组。请在简谱的节奏与范围中设置连音。"}</p>
    <p className={styles.settingsHint}>连音组用于节奏分组；延音线与连音线请在对应音符的连接工具中编辑。</p>
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
    <section className={styles.toolDetails} aria-label="连音组详情">
      <h3 tabIndex={-1}>连音组</h3>
      <div className={styles.toolTarget}>
        {range
          ? `第 ${measureIndex + 1} 小节 · ${first && measure ? formatNumberedBeatPosition(first.tick, measure.timeSignature.denominator) : "起点"} 至 ${last && measure ? formatNumberedBeatPosition(last.tick, measure.timeSignature.denominator) : "终点"} · ${range.beatIds.length} 个成员`
          : "请选择同小节内的连续拍点"}
      </div>
      <p className={styles.settingsHint}>
        选中连续、相同时值和附点的拍点。成员数必须与连音比例一致。
      </p>
      <p className={styles.settingsHint}>连音组用于节奏分组；延音线与连音线请在对应音符的连接工具中编辑。</p>
      <p className={styles.settingsHint}>
        当前组：
        {range?.group
          ? `${range.group.ratio.actual}:${range.group.ratio.normal}`
          : "无"}
      </p>
      <Radio.Group
        buttonStyle="solid"
        aria-label="待应用连音比例"
        className={styles.tupletRatioGrid}
        value={choice.value}
        onChange={(event) => setChoice({ key, value: event.target.value })}
      >
        {LXM_TUPLET_RATIOS.map((item) => {
          const value = `${item.actual}:${item.normal}`,
            enabled = !!range && range.beatIds.length === item.actual;
          return (
            <Tooltip
              key={value}
              title={
                !enabled ? `需要同小节内连续 ${item.actual} 拍` : undefined
              }
            >
              <span tabIndex={!enabled ? 0 : undefined}>
                <Radio.Button
                  className={styles.toolChoiceCard}
                  value={value}
                  disabled={blocked || busy || !enabled}
                >
                  {value}
                </Radio.Button>
              </span>
            </Tooltip>
          );
        })}
      </Radio.Group>
      <Alert
        variant="filled"
        type="info"
        showIcon
        title={
          ratio
            ? `${ratio.actual} 个同值音符占 ${ratio.normal} 个音符的时间`
            : "请选择可用比例"
        }
        description="不支持混合时值、跨小节、嵌套或重叠；最终由音乐规则校验。"
      />
      <Button
        type="primary"
        block
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
        block
        disabled={blocked || busy || !range?.group}
        onClick={() => void run(true)}
      >
        删除当前连音组
      </Button>
    </section>
  );
};
