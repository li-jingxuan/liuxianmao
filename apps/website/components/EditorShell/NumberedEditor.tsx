"use client";
import { Button, Checkbox, Form, Input, Popover, Select } from "antd";
import { QuestionCircleOutlined } from "@ant-design/icons";

import {
  useEffect,
  useMemo,
  useState,
  useImperativeHandle,
  useRef,
  type Ref,
} from "react";
import {
  LXM_TUPLET_RATIOS,
  parseNumberedSequence,
  createDocumentIdFactory,
  editNumberedTrack,
  createNumberedRhythmContext,
  numberedRhythmForTicks,
  type NumberedClipboard,
  type NumberedClipboardRange,
  type ILXMDocument,
  type ILXMApplyScoreCommandResult,
  type ILXMScoreCommand,
  type ILXMTabCellReference,
  type ILXMTabCellSelection,
  type ILXMRhythmBase,
  type ILXMNumberedVoiceCommand,
} from "@liuxianmao/lxm-editor";
import type { MusicTextTarget } from "./music-text-draft";
import {
  resolveNumberedEditorTarget,
  numberedTargetWindow,
  formatNumberedBeatPosition,
} from "./numbered-editor-target";
import styles from "./index.module.scss";
import {
  buildNumberedPreviewRows,
  type NumberedPreviewRow,
} from "./numbered-preview";
export interface NumberedEditorController {
  canApply: boolean;
  dirty: boolean;
  /** 简谱属性按内容、时值和单 item 音高分组，避免一个 boolean 掩盖未提交字段。 */
  dirtyGroups: readonly NumberedDraftGroup[];
  apply: () => boolean;
  applyGroup: (group: NumberedDraftGroup) => NumberedPropertyApplyResult;
  discard: () => void;
  focus: () => void;
  snapshot: () => NumberedEditorDraft;
}
export type NumberedDraftGroup = "content" | "rhythm" | "itemPitch";
export type NumberedPropertyApplyResult =
  | { status: "applied" | "noop"; group: NumberedDraftGroup }
  | { status: "blocked" | "pending"; group: NumberedDraftGroup; message: string };
/** 切换简谱目标时暂存纯 UI 输入，不提前写入曲谱或撤销历史。 */
export interface NumberedEditorDraft {
  /** 暂存草稿自己的录入方式，不能被全局当前模式覆盖。 */
  mode?: "single" | "sequence";
  selectedId: string;
  start: number;
  end: number;
  raw: string;
  initial: string;
  overwrite: boolean;
  base: ILXMRhythmBase;
  dots: number;
  template: string;
  itemId: string;
  destination: string;
  customRhythms: { base: ILXMRhythmBase; dots: number }[];
  ratioIndex: number;
  itemDraft: string;
}
const bases: { value: ILXMRhythmBase; label: string }[] = [
  { value: "whole", label: "全音" },
  { value: "half", label: "二分" },
  { value: "quarter", label: "四分" },
  { value: "eighth", label: "八分" },
  { value: "sixteenth", label: "十六分" },
  { value: "thirtySecond", label: "三十二分" },
];
/** 草稿、目标与覆盖窗口属于 UI；音乐校验和技巧影响全部由核心规划。 */
export const NumberedEditor = ({
  ref,
  document,
  target,
  selection,
  commit,
  onDirty,
  onInputActive,
  onPreviewTargetChange,
  onActivate,
  onCanApply,
  onApplied,
  onDiscarded,
  mode,
  onModeChange,
  onCancel,
  getClipboard,
  copyRange,
  selectedMarkId,
  savedDraft,
  onSelectTarget,
}: {
  ref: Ref<NumberedEditorController>;
  document: ILXMDocument;
  target: MusicTextTarget | ILXMTabCellReference | null;
  selection?: ILXMTabCellSelection | null;
  commit: (c: ILXMScoreCommand) => ILXMApplyScoreCommandResult | null;
  onDirty: (v: boolean) => void;
  onInputActive: (v: boolean) => void;
  onPreviewTargetChange: (t: MusicTextTarget | null) => void;
  onActivate: (focusInput?: boolean) => void;
  onCanApply: (v: boolean) => void;
  /** 成功/取消后由外层推进该目标的会话版本，不刷新其他分组草稿。 */
  onApplied?: () => void;
  onDiscarded?: () => void;
  getClipboard: () => NumberedClipboard | null;
  copyRange: (range: NumberedClipboardRange) => boolean;
  mode: "single" | "sequence";
  onModeChange: (m: "single" | "sequence") => void;
  onCancel: () => void;
  selectedMarkId: string | null;
  savedDraft?: NumberedEditorDraft;
  onSelectTarget: (target: MusicTextTarget) => void;
}) => {
  const resolved = useMemo(
    () => resolveNumberedEditorTarget(document, target),
    [document, target],
  );
  const track = document.score.tracks.find((t) => t.id === resolved?.trackId);
  const measure = track?.measures.find((m) => m.id === resolved?.measureId);
  const targetEvent =
    resolved?.kind === "numberedEvent"
      ? measure?.numberedVoice.events.find((e) => e.id === resolved.eventId)
      : undefined;
  const sourceBeat =
    target && "beatId" in target && target.beatId
      ? measure?.beats.find((beat) => beat.id === target.beatId)
      : undefined;
  const selectedBeats =
    sourceBeat &&
    selection &&
    selection.focus.trackId === track?.id &&
    selection.focus.measureId === measure?.id &&
    selection.focus.beatId === sourceBeat.id &&
    selection.anchor.measureId === measure?.id
      ? measure?.beats.filter((beat) => {
          const anchor = measure.beats.find(
            (item) => item.id === selection.anchor.beatId,
          );
          return (
            anchor &&
            beat.tick >= Math.min(anchor.tick, sourceBeat.tick) &&
            beat.tick <= Math.max(anchor.tick, sourceBeat.tick)
          );
        })
      : sourceBeat
        ? [sourceBeat]
        : [];
  const firstBeat = selectedBeats[0];
  const lastBeat = selectedBeats.at(-1);
  const lastIndex = lastBeat
    ? (measure?.beats.findIndex((beat) => beat.id === lastBeat.id) ?? -1)
    : -1;
  const selectedEnd =
    lastIndex >= 0
      ? (measure?.beats[lastIndex + 1]?.tick ??
        (measure!.timeSignature.numerator * 3840) /
          measure!.timeSignature.denominator)
      : 0;
  // 从 TAB 选区进入连续简谱时回填其中已有事件，保留各事件原时值。
  const selectedEvents = firstBeat
    ? (measure?.numberedVoice.events.filter(
        (event) => event.tick >= firstBeat.tick && event.tick < selectedEnd,
      ) ?? [])
    : targetEvent
      ? [targetEvent]
      : [];
  const firstEvent = selectedEvents[0] ?? targetEvent;
  const [selectedId, setSelectedId] = useState(
    savedDraft?.selectedId ?? firstEvent?.id ?? "",
  );
  const event = measure?.numberedVoice.events.find((e) => e.id === selectedId);
  const window =
    event && measure
      ? (() => {
          const d = createNumberedRhythmContext(
            measure.numberedVoice,
          ).getEventDurationTicks(event);
          return { start: event.tick, end: event.tick + (d.ok ? d.ticks : 0) };
        })()
      : resolved
        ? numberedTargetWindow(document, resolved)
        : { start: 0, end: 960 };
  const [start, setStart] = useState(savedDraft?.start ?? window.start),
    [end, setEnd] = useState(savedDraft?.end ?? window.end);
  const value =
    mode === "single"
      ? (firstEvent?.items.map((i) => i.token).join("+") ?? "")
      : selectedEvents.some((item) => item.items.length)
        ? selectedEvents
            .map((item) =>
              item.items.length
                ? item.items.map((note) => note.token).join("+")
                : "_",
            )
            .join(" ")
        : "";
  const [raw, setRaw] = useState(savedDraft?.raw ?? value),
    [initial, setInitial] = useState(savedDraft?.initial ?? value),
    [overwrite, setOverwrite] = useState(savedDraft?.overwrite ?? false);
  const [base, setBase] = useState<ILXMRhythmBase>(
      savedDraft?.base ??
        firstEvent?.rhythm.base ??
        numberedRhythmForTicks(window.end - window.start)?.base ??
        "quarter",
    ),
    [dots, setDots] = useState(
      savedDraft?.dots ??
        firstEvent?.rhythm.dots ??
        numberedRhythmForTicks(window.end - window.start)?.dots ??
        0,
    );
  const [template, setTemplate] = useState(savedDraft?.template ?? "uniform"),
    [itemId, setItemId] = useState(
      savedDraft?.itemId ??
        (sourceBeat
          ? (firstEvent?.items[0]?.id ?? "")
          : resolved?.kind === "numberedEvent"
            ? (resolved.itemId ?? firstEvent?.items[0]?.id ?? "")
            : ""),
    ),
    [destination, setDestination] = useState(savedDraft?.destination ?? "");
  const [message, setMessage] = useState<string | null>(null);
  // 折叠与帮助开关是纯界面状态，不进入简谱草稿或曲谱文档。
  const [rangeState, setRangeState] = useState<{
    targetId: string;
    expanded: boolean;
  } | null>(null);
  const rangeExpanded = rangeState?.targetId === selectedId
    ? rangeState.expanded
    : !selectedId;
  const [advancedExpanded, setAdvancedExpanded] = useState(false);
  const [reuseExpanded, setReuseExpanded] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [pending, setPending] = useState<{
    operation: ILXMNumberedVoiceCommand;
    group: NumberedDraftGroup;
    document: ILXMDocument;
    removed: string[];
    changed: string[];
  } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const impactDialog = useRef<HTMLDialogElement>(null);
  const [customRhythms, setCustomRhythms] = useState<
    { base: ILXMRhythmBase; dots: number }[]
  >(savedDraft?.customRhythms ?? []);
  const [ratioIndex, setRatioIndex] = useState(savedDraft?.ratioIndex ?? 1);
  const [itemDraft, setItemDraft] = useState(
    savedDraft?.itemDraft ??
      firstEvent?.items.find(
        (i) =>
          i.id ===
          (resolved?.kind === "numberedEvent" ? resolved.itemId : undefined),
      )?.token ??
      firstEvent?.items[0]?.token ??
      "",
  );
  useEffect(() => {
    if (pending && !impactDialog.current?.open)
      impactDialog.current?.showModal();
    else if (!pending) impactDialog.current?.close();
  }, [pending]);
  const parsed = useMemo(() => parseNumberedSequence(raw), [raw]);
  const dirty =
    raw !== initial ||
    overwrite ||
    base !==
      (event?.rhythm.base ??
        numberedRhythmForTicks(window.end - window.start)?.base ??
        "quarter") ||
    dots !==
      (event?.rhythm.dots ??
        numberedRhythmForTicks(window.end - window.start)?.dots ??
        0) ||
    template !== "uniform" ||
    start !== window.start ||
    end !== window.end ||
    customRhythms.length > 0 ||
    ratioIndex !== 1 ||
    itemDraft !== (event?.items.find((i) => i.id === itemId)?.token ?? "");
  const operation = useMemo<ILXMNumberedVoiceCommand | null>(() => {
    if (!track || !measure || !parsed.ok) return null;
    if (
      mode === "single" &&
      event &&
      parsed.items.length === 1 &&
      parsed.items[0]?.kind === "set"
    )
      return {
        type: "numbered.event.set",
        trackId: track.id,
        measureId: measure.id,
        eventId: event.id,
        tokens: parsed.items[0].tokens,
      };
    if (mode === "sequence" && event && template === "uniform")
      return {
        type: "numbered.sequence.set",
        trackId: track.id,
        measureId: measure.id,
        eventId: event.id,
        items: parsed.items,
        allowOverwrite: overwrite,
      };
    let rhythms = parsed.items.map((_, i) =>
      template === "custom"
        ? (customRhythms[i] ?? { base, dots })
        : { base, dots },
    );
    if (template === "front8")
      rhythms = [
        { base: "eighth", dots: 0 },
        { base: "sixteenth", dots: 0 },
        { base: "sixteenth", dots: 0 },
      ];
    if (template === "back8")
      rhythms = [
        { base: "sixteenth", dots: 0 },
        { base: "sixteenth", dots: 0 },
        { base: "eighth", dots: 0 },
      ];
    return {
      type: "numbered.range.replace",
      trackId: track.id,
      measureId: measure.id,
      startTick: start,
      endTick: end,
      items: parsed.items,
      rhythms,
      allowOverwrite: overwrite,
      ...(template === "tuplet"
        ? { ratio: LXM_TUPLET_RATIOS[ratioIndex]! }
        : {}),
      ...(template === "triplet"
        ? {
            ratio: { actual: 3 as const, normal: 2 as const },
            rhythms: parsed.items.map(() => ({
              base: "eighth" as const,
              dots: 0,
            })),
          }
        : {}),
    };
  }, [
    track,
    measure,
    parsed,
    mode,
    event,
    base,
    dots,
    template,
    start,
    end,
    overwrite,
    customRhythms,
    ratioIndex,
  ]);
  const plan = useMemo(
    () =>
      operation && track
        ? editNumberedTrack(
            track,
            operation,
            createDocumentIdFactory(document),
            true,
          )
        : null,
    [document, track, operation],
  );
  const previewRows = useMemo<NumberedPreviewRow[]>(
    () =>
      plan?.ok && track && operation
        ? buildNumberedPreviewRows(track, plan, operation)
        : [],
    [track, plan, operation],
  );
  const issue = !parsed.ok
    ? parsed.message
    : mode === "single" && parsed.items.length !== 1
      ? "单音组只接受一项；先后音请使用节奏模板"
      : plan && !plan.ok
        ? plan.message
        : null;
  const contentDirty =
    raw !== initial ||
    overwrite ||
    template !== "uniform" ||
    start !== window.start ||
    end !== window.end ||
    customRhythms.length > 0 ||
    ratioIndex !== 1;
  useEffect(() => onDirty(dirty || !!pending), [dirty, pending, onDirty]);
  useEffect(
    () =>
      onPreviewTargetChange(
        resolved
          ? event
            ? {
                kind: "numbered",
                trackId: resolved.trackId,
                measureId: resolved.measureId,
                eventId: event.id,
                ...(itemId ? { itemId } : {}),
              }
            : {
                kind: "numbered",
                trackId: resolved.trackId,
                measureId: resolved.measureId,
                tick: start,
                endTick: end,
              }
          : null,
      ),
    [resolved, event, itemId, start, end, onPreviewTargetChange],
  );
  /** 影响确认与动作一同提交，不能先删除技巧再写音符。 */
  const inferGroup = (
    op: ILXMNumberedVoiceCommand,
  ): NumberedDraftGroup => {
    if (op.type === "numbered.event.setRhythm") return "rhythm";
    if (op.type === "numbered.event.set" && "itemId" in op && op.itemId)
      return "itemPitch";
    return "content";
  };
  const acknowledgeGroup = (
    group: NumberedDraftGroup,
    op?: ILXMNumberedVoiceCommand,
  ) => {
    // 自身命令成功后只推进实际提交分组的基线，避免稳定 owner 保留旧 dirty 状态。
    if (group === "content") {
      setInitial(raw);
      setOverwrite(false);
      // 模板、比例和自定义时值是一次提交的准备态，提交后回到干净默认值。
      setTemplate("uniform");
      setCustomRhythms([]);
      setRatioIndex(1);
      if (op?.type === "numbered.range.replace") {
        setStart(op.startTick);
        setEnd(op.endTick);
      }
    }
  };
  const submit = (
    op: ILXMNumberedVoiceCommand,
    group = inferGroup(op),
  ): NumberedPropertyApplyResult => {
    if (!track)
      return { status: "blocked", group, message: "当前简谱目标已失效。" };
    const candidate = editNumberedTrack(
      track,
      op,
      createDocumentIdFactory(document),
      true,
    );
    if (!candidate.ok) {
      setMessage(candidate.message);
      return { status: "blocked", group, message: candidate.message };
    }
    if (
      op.type !== "numbered.mark.remove" &&
      (candidate.removedMarkIds.length || candidate.changedMarkIds.length)
    ) {
      setPending({
        operation: op,
        group,
        document,
        removed: candidate.removedMarkIds,
        changed: candidate.changedMarkIds,
      });
      return {
        status: "pending",
        group,
        message: "等待确认简谱技巧影响。",
      };
    }
    const r = commit({ ...op, expectedRevision: document.documentRevision });
    if (!r?.ok)
      return {
        status: "blocked",
        group,
        message: r?.message ?? "当前无法应用简谱修改。",
      };
    acknowledgeGroup(group, op);
    onApplied?.();
    setMessage(r.changed ? "已应用" : "内容未变化");
    return { status: r.changed ? "applied" : "noop", group };
  };
  const rhythmOperation = useMemo<ILXMNumberedVoiceCommand | null>(
    () =>
      event && track && measure
        ? {
            type: "numbered.event.setRhythm",
            trackId: track.id,
            measureId: measure.id,
            eventId: event.id,
            rhythm: { base, dots },
          }
        : null,
    [event, track, measure, base, dots],
  );
  const rhythmPlan = useMemo(
    () =>
      rhythmOperation && track
        ? editNumberedTrack(
            track,
            rhythmOperation,
            createDocumentIdFactory(document),
            true,
          )
        : null,
    [rhythmOperation, track, document],
  );
  const rhythmDirty =
    !!event &&
    (base !== event.rhythm.base || dots !== event.rhythm.dots);
  const itemPitchValue = event?.items.find((item) => item.id === itemId)?.token ?? "";
  const itemPitchDirty = !!event && !!itemId && itemDraft !== itemPitchValue;
  const itemPitchOperation = useMemo<ILXMNumberedVoiceCommand | null>(() => {
    if (!track || !measure || !event || !itemId) return null;
    const parsedItem = parseNumberedSequence(itemDraft);
    if (
      !parsedItem.ok ||
      parsedItem.items.length !== 1 ||
      parsedItem.items[0]?.kind !== "set" ||
      parsedItem.items[0].tokens.length !== 1
    )
      return null;
    return {
      type: "numbered.event.set",
      trackId: track.id,
      measureId: measure.id,
      eventId: event.id,
      itemId,
      tokens: parsedItem.items[0].tokens,
    };
  }, [track, measure, event, itemId, itemDraft]);
  const itemPitchIssue = itemPitchDirty && !itemPitchOperation
    ? "请选择一个合法简谱音高"
    : null;
  const dirtyGroups = useMemo<readonly NumberedDraftGroup[]>(
    () => [
      ...(contentDirty ? (["content"] as const) : []),
      ...(rhythmDirty ? (["rhythm"] as const) : []),
      ...(itemPitchDirty ? (["itemPitch"] as const) : []),
    ],
    [contentDirty, rhythmDirty, itemPitchDirty],
  );
  const canApplyByGroup = useMemo<Record<NumberedDraftGroup, boolean>>(
    () => ({
      content: contentDirty && !!operation && !issue,
      rhythm: rhythmDirty && !!rhythmOperation && !!rhythmPlan?.ok,
      itemPitch: itemPitchDirty && !!itemPitchOperation && !itemPitchIssue,
    }),
    [
      contentDirty,
      operation,
      issue,
      rhythmDirty,
      rhythmOperation,
      rhythmPlan,
      itemPitchDirty,
      itemPitchOperation,
      itemPitchIssue,
    ],
  );
  const applyGroup = (group: NumberedDraftGroup): NumberedPropertyApplyResult => {
    if (!dirtyGroups.includes(group)) return { status: "noop", group };
    if (group === "content") {
      if (issue || !operation)
        return { status: "blocked", group, message: issue ?? "当前内容无法应用。" };
      return submit(operation, group);
    }
    if (group === "rhythm") {
      if (!rhythmPlan?.ok || !rhythmOperation)
        return {
          status: "blocked",
          group,
          message:
            rhythmPlan && "message" in rhythmPlan
              ? rhythmPlan.message
              : "当前时值无法应用。",
        };
      return submit(rhythmOperation, group);
    }
    if (!itemPitchOperation)
      return { status: "blocked", group, message: itemPitchIssue ?? "当前音高无法应用。" };
    return submit(itemPitchOperation, group);
  };
  const apply = () => {
    const applicable = dirtyGroups.filter((group) => canApplyByGroup[group]);
    if (applicable.length !== 1) return false;
    const result = applyGroup(applicable[0]!);
    return result.status === "applied" || result.status === "noop";
  };
  useEffect(
    () =>
      onCanApply(
        dirtyGroups.filter((group) => canApplyByGroup[group]).length === 1,
      ),
    [dirtyGroups, canApplyByGroup, onCanApply],
  );
  const reset = () => {
    setRaw(initial);
    setBase(
      event?.rhythm.base ??
        numberedRhythmForTicks(window.end - window.start)?.base ??
        "quarter",
    );
    setDots(
      event?.rhythm.dots ??
        numberedRhythmForTicks(window.end - window.start)?.dots ??
        0,
    );
    setTemplate("uniform");
    setStart(window.start);
    setEnd(window.end);
    setOverwrite(false);
    setPending(null);
    setCustomRhythms([]);
    setRatioIndex(1);
    setItemDraft(event?.items.find((i) => i.id === itemId)?.token ?? "");
    onInputActive(false);
    onDiscarded?.();
  };
  useImperativeHandle(ref, () => ({
    canApply:
      dirtyGroups.filter((group) => canApplyByGroup[group]).length === 1,
    dirty,
    dirtyGroups,
    apply,
    applyGroup,
    discard: reset,
    focus: () => input.current?.focus({ preventScroll: true }),
    snapshot: () => ({
      mode,
      selectedId,
      start,
      end,
      raw,
      initial,
      overwrite,
      base,
      dots,
      template,
      itemId,
      destination,
      customRhythms: structuredClone(customRhythms),
      ratioIndex,
      itemDraft,
    }),
  }));
  const markTargets =
    track?.measures.flatMap((m, mi) =>
      m.numberedVoice.events
        .filter((e) => e.kind === "notes")
        .map((e) => ({
          e,
          label: `${mi + 1}小节 · ${formatNumberedBeatPosition(e.tick, m.timeSignature.denominator)} · ${e.items.map((i) => i.token).join("+")}`,
        })),
    ) ?? [];
  return (
    <section
      className={styles.sidebarSection}
      onFocusCapture={(e) => {
        if (
          e.target instanceof HTMLTextAreaElement ||
          e.target instanceof HTMLInputElement
        )
          onActivate(false);
      }}
    >
      <h3>简谱编辑</h3>
      {!resolved || !measure || !track ? (
        <>
          <p>请选中简谱音符，或从六线谱选拍建立录入窗口</p>
          <Form.Item layout="vertical" label="录入方式">
            <Select
              aria-label="简谱录入方式"
              value={mode}
              onChange={(value) => onModeChange(value as typeof mode)}
              options={[
                { value: "sequence", label: "连续录入" },
                { value: "single", label: "单音组编辑" },
              ]}
            />
          </Form.Item>
        </>
      ) : (
        <>
          <div className={styles.numberedLocationGrid}>
          <Form.Item
            layout="vertical"
            label="当前简谱事件"
            htmlFor={"editor-field-" + "当前简谱事件"}
          >
            <Select
              id={"editor-field-" + "当前简谱事件"}
              aria-label="当前简谱事件"
              value={selectedId}
              onChange={(value) => {
                const next = measure.numberedVoice.events.find(
                  (v) => v.id === value,
                );
                if (next) {
                  onSelectTarget({
                    kind: "numbered",
                    trackId: track.id,
                    measureId: measure.id,
                    eventId: next.id,
                    itemId: next.items[0]?.id,
                  });
                } else {
                  onSelectTarget({
                    kind: "numbered",
                    trackId: track.id,
                    measureId: measure.id,
                    tick: start,
                    endTick: end,
                  });
                }
              }}
              style={{ width: "100%" }}
              options={[
                { value: "", label: "新增时间范围" },
                ...measure.numberedVoice.events.map((e) => ({
                  value: e.id,
                  label: (
                    <>
                      {formatNumberedBeatPosition(
                        e.tick,
                        measure.timeSignature.denominator,
                      )}{" "}
                      · {e.items.map((i) => i.token).join("+") || "未录入"}
                    </>
                  ),
                })),
              ]}
            />
          </Form.Item>
          <Form.Item
            layout="vertical"
            label="录入方式"
            htmlFor="editor-field-简谱录入方式"
          >
            <Select
              id="editor-field-简谱录入方式"
              aria-label="简谱录入方式"
              value={mode}
              onChange={(value) => onModeChange(value as typeof mode)}
              options={[
                { value: "sequence", label: "连续录入" },
                { value: "single", label: "单音组编辑" },
              ]}
            />
          </Form.Item>
          </div>
          <Form.Item
            layout="vertical"
            label={
              <span className={styles.numberedInputLabel}>
                {mode === "sequence" ? "连续简谱" : "单音组简谱"}
                <Popover
                  open={helpOpen}
                  onOpenChange={setHelpOpen}
                  trigger="click"
                  placement="left"
                  content={
                    <div className={styles.numberedHelp}>
                      <p>空格分隔先后音，+ 表示同时发音；休止拍可用 _ 表示。</p>
                      <p>高音用 &apos;，低音用 .，还原号用 n。简谱时值与技巧独立于六线谱。</p>
                      <p>先检查预览；覆盖默认关闭，窗口不合法时需修正输入后再应用。</p>
                    </div>
                  }
                >
                  <button
                    type="button"
                    className={styles.numberedHelpTrigger}
                    aria-label="简谱输入规则"
                    aria-expanded={helpOpen}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setHelpOpen(false);
                    }}
                  >
                    <QuestionCircleOutlined />
                  </button>
                </Popover>
              </span>
            }
            htmlFor={
              "editor-field-" +
              (mode === "sequence" ? "连续简谱" : "单音组简谱")
            }
          >
            <Input.TextArea
              id={
                "editor-field-" +
                (mode === "sequence" ? "连续简谱" : "单音组简谱")
              }
              ref={(control) => {
                input.current = control?.resizableTextArea?.textArea ?? null;
              }}
              aria-label={mode === "sequence" ? "连续简谱" : "单音组简谱"}
              rows={2}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder="1 2 3；同时多音用 1+3+5"
            />
          </Form.Item>
          <p className={styles.numberedInlineTip}>
            空格分先后音，+ 同时发音 · &apos;高音 · .低音 · n还原
          </p>
          <Form.Item
            layout="vertical"
            label="节奏模板"
            htmlFor={"editor-field-" + "简谱节奏模板"}
          >
            <Select
              id={"editor-field-" + "简谱节奏模板"}
              aria-label="简谱节奏模板"
              value={template}
              onChange={(value) => {
                setTemplate(value);
                setSelectedId("");
                setEnd(start + 960);
              }}
              style={{ width: "100%" }}
              options={[
                { value: "uniform", label: "自选时值" },
                { value: "front8", label: "前八后十六" },
                { value: "back8", label: "前十六后八" },
                { value: "triplet", label: "三连音（八分）" },
                { value: "custom", label: "自定义成员时值" },
                { value: "tuplet", label: "自选节奏连音" },
              ]}
            />
          </Form.Item>
          {template === "tuplet" && (
            <Form.Item
              layout="vertical"
              label="连音比例"
              htmlFor={"editor-field-" + "简谱连音比例"}
            >
              <Select
                id={"editor-field-" + "简谱连音比例"}
                aria-label="简谱连音比例"
                value={ratioIndex}
                onChange={(value) => setRatioIndex(Number(value))}
                style={{ width: "100%" }}
                options={[
                  ...LXM_TUPLET_RATIOS.map((r, i) => ({
                    value: i,
                    label: (
                      <>
                        {r.actual}:{r.normal}
                      </>
                    ),
                  })),
                ]}
              />
            </Form.Item>
          )}
          {template === "custom" &&
            parsed.ok &&
            parsed.items.map((_, i) => (
              <Form.Item
                key={i}
                className={styles.numberedCustomRhythm}
                layout="vertical"
                label={<>第{i + 1} 音时值</>}
                htmlFor={"editor-field-" + `简谱第${i + 1}音时值`}
              >
                <Select
                  id={"editor-field-" + `简谱第${i + 1}音时值`}
                  aria-label={`简谱第${i + 1}音时值`}
                  value={customRhythms[i]?.base ?? base}
                  onChange={(value) =>
                    setCustomRhythms(
                      parsed.items.map((_, j) =>
                        j === i
                          ? {
                              base: value as ILXMRhythmBase,
                              dots: customRhythms[i]?.dots ?? 0,
                            }
                          : (customRhythms[j] ?? { base, dots }),
                      ),
                    )
                  }
                  style={{ width: "100%" }}
                  options={[
                    ...bases.map((b) => ({ value: b.value, label: b.label })),
                  ]}
                />
                <Select
                  aria-label={`简谱第${i + 1}音附点`}
                  value={customRhythms[i]?.dots ?? dots}
                  onChange={(value) =>
                    setCustomRhythms(
                      parsed.items.map((_, j) =>
                        j === i
                          ? {
                              base: customRhythms[i]?.base ?? base,
                              dots: Number(value),
                            }
                          : (customRhythms[j] ?? { base, dots }),
                      ),
                    )
                  }
                  style={{ width: "100%" }}
                  options={[
                    { value: 0, label: "无附点" },
                    { value: 1, label: "单附点" },
                    { value: 2, label: "双附点" },
                  ]}
                />
              </Form.Item>
            ))}
          <div className={styles.numberedRhythmGrid}>
          <Form.Item
            layout="vertical"
            label="简谱时值"
            htmlFor={"editor-field-" + "简谱时值"}
          >
            <Select
              id={"editor-field-" + "简谱时值"}
              aria-label="简谱时值"
              value={base}
              onChange={(value) => setBase(value as ILXMRhythmBase)}
              style={{ width: "100%" }}
              options={[
                ...bases.map((b) => ({ value: b.value, label: b.label })),
              ]}
            />
          </Form.Item>
          <Form.Item
            layout="vertical"
            label="时值附点"
            htmlFor={"editor-field-" + "简谱时值附点"}
          >
            <Select
              id={"editor-field-" + "简谱时值附点"}
              aria-label="简谱时值附点"
              value={dots}
              onChange={(value) => setDots(Number(value))}
              style={{ width: "100%" }}
              options={[
                { value: 0, label: "无" },
                { value: 1, label: "单附点" },
                { value: 2, label: "双附点" },
              ]}
            />
          </Form.Item>
          </div>
          <details
            className={styles.numberedDisclosure}
            open={rangeExpanded}
            onToggle={(event) => setRangeState({ targetId: selectedId, expanded: event.currentTarget.open })}
          >
            <summary>
              录入范围 <span>起点 {formatNumberedBeatPosition(start, measure.timeSignature.denominator)} · 当前窗口</span>
            </summary>
          <div className={styles.numberedRangeGrid}>
          <Form.Item
            layout="vertical"
            label="录入起点"
            htmlFor={"editor-field-" + "简谱录入起点"}
          >
            <Select
              id={"editor-field-" + "简谱录入起点"}
              aria-label="简谱录入起点"
              value={start}
              onChange={(value) => {
                const next = Number(value);
                setStart(next);
                setEnd(next + (end - start));
                setSelectedId("");
              }}
              style={{ width: "100%" }}
              options={[
                ...[
                  ...new Set([
                    ...Array.from(
                      {
                        length: Math.ceil(
                          (measure.timeSignature.numerator * 3840) /
                            measure.timeSignature.denominator /
                            120,
                        ),
                      },
                      (_, i) => i * 120,
                    ),
                    ...measure.numberedVoice.events.map((e) => e.tick),
                    start,
                  ]),
                ]
                  .sort((a, b) => a - b)
                  .filter(
                    (t) =>
                      t <
                      (measure.timeSignature.numerator * 3840) /
                        measure.timeSignature.denominator,
                  )
                  .map((t) => ({
                    value: t,
                    label: formatNumberedBeatPosition(
                      t,
                      measure.timeSignature.denominator,
                    ),
                  })),
              ]}
            />
          </Form.Item>
          <Form.Item
            layout="vertical"
            label="覆盖时长"
            htmlFor={"editor-field-" + "简谱覆盖时长"}
          >
            <Select
              id={"editor-field-" + "简谱覆盖时长"}
              aria-label="简谱覆盖时长"
              value={end - start}
              onChange={(value) => {
                setEnd(start + Number(value));
                setSelectedId("");
              }}
              style={{ width: "100%" }}
              options={[
                { value: end - start, label: "当前范围" },
                ...[
                  { value: 480, label: "半个四分拍" },
                  { value: 960, label: "一个四分拍" },
                  { value: 1920, label: "两个四分拍" },
                  { value: 3840, label: "四个四分拍" },
                ].filter((option) => option.value !== end - start),
              ]}
            />
          </Form.Item>
          </div>
          </details>
          <Checkbox
            checked={overwrite}
            onChange={(e) => setOverwrite(e.target.checked)}
          >
            允许覆盖此时间范围的简谱
          </Checkbox>
          {plan?.ok && (
            <div className={styles.sequencePreview} aria-label="简谱修改预览">
              <h4>修改预览 · {previewRows.length} 项</h4>
              <table>
                <thead>
                  <tr>
                    <th>位置</th>
                    <th>原值 → 新值</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row) => (
                    <tr key={row.key}>
                      <td>{row.measureNumber} 小节 · {row.startTick} tick</td>
                      <td>{row.before} → {row.after}</td>
                      <td>
                        {{
                          add: "新增",
                          change: row.impact === "overwrite" ? "覆盖" : "修改",
                          same: "未变化",
                          remove: row.impact === "release" ? "释放" : "删除",
                        }[row.status]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {issue && <p role="status">{issue}</p>}
          <div className={styles.sidebarActions}>
            <Button
              disabled={!event}
              onClick={() =>
                event &&
                submit({
                  type: "numbered.event.remove",
                  trackId: track.id,
                  measureId: measure.id,
                  eventId: event.id,
                })
              }
            >
              删除简谱
            </Button>
            <Button onClick={onCancel}>取消</Button>
            <Button
              type="primary"
              disabled={!canApplyByGroup.content}
              onClick={() => {
                applyGroup("content");
              }}
            >
              应用
            </Button>
          </div>
          <details
            className={styles.numberedDisclosure}
            open={advancedExpanded}
            onToggle={(toggleEvent) => setAdvancedExpanded(toggleEvent.currentTarget.open)}
          >
            <summary>
              音符技巧 <span>时值、音高、连接</span>
            </summary>
          {event && (
            <fieldset>
              {rhythmPlan?.ok &&
                (base !== event.rhythm.base || dots !== event.rhythm.dots) && (
                  <p>
                    时值预览：保留当前音符，
                    {rhythmPlan.overwrittenEventIds.length
                      ? `覆盖 ${rhythmPlan.overwrittenEventIds.length} 个后续音符`
                      : rhythmPlan.releasedRange
                        ? "在后方释放一个可录入范围"
                        : "扩展到后方空白"}
                    。
                  </p>
                )}
              {rhythmPlan && !rhythmPlan.ok && (
                <p role="status">{rhythmPlan.message}</p>
              )}
              <Button
                disabled={!rhythmPlan?.ok}
                onClick={() => rhythmOperation && submit(rhythmOperation)}
              >
                应用当前音符时值
              </Button>
              <Button
                onClick={() =>
                  submit({
                    type: "numbered.event.split",
                    trackId: track.id,
                    measureId: measure.id,
                    eventId: event.id,
                  })
                }
              >
                等分持续音
              </Button>
              <Form.Item
                layout="vertical"
                label="起始音符"
                htmlFor={"editor-field-" + "简谱技巧起始音符"}
              >
                <Select
                  id={"editor-field-" + "简谱技巧起始音符"}
                  aria-label="简谱技巧起始音符"
                  value={itemId}
                  onChange={(value) => {
                    setItemId(value);
                    setItemDraft(
                      event.items.find((i) => i.id === value)?.token ?? "",
                    );
                  }}
                  style={{ width: "100%" }}
                  options={[
                    ...event.items.map((i, j) => ({
                      value: i.id,
                      label: (
                        <>
                          {j + 1}：{i.token}
                        </>
                      ),
                    })),
                  ]}
                />
              </Form.Item>
              {event.kind === "notes" && (
                <>
                  <Form.Item
                    layout="vertical"
                    label="单音符音高"
                    htmlFor={"editor-field-" + "简谱单音符音高"}
                  >
                    <Input
                      id={"editor-field-" + "简谱单音符音高"}
                      aria-label="简谱单音符音高"
                      value={itemDraft}
                      onChange={(e) => setItemDraft(e.target.value)}
                    />
                  </Form.Item>
                  {(["#", "b", "n"] as const).map((prefix) => (
                    <Button
                      key={prefix}
                      onClick={() =>
                        setItemDraft(
                          prefix + itemDraft.replace(/^[#bn♯♭♮]/, ""),
                        )
                      }
                    >
                      {prefix === "#"
                        ? "升音"
                        : prefix === "b"
                          ? "降音"
                          : "还原"}
                    </Button>
                  ))}
                  {([-1, 1] as const).map((direction) => (
                    <Button
                      key={direction}
                      onClick={() => {
                        const suffix = itemDraft.match(/['.]+$/)?.[0] ?? "";
                        const octave = suffix.startsWith("'")
                          ? suffix.length
                          : -suffix.length;
                        const next = octave + direction;
                        if (Math.abs(next) > 3) {
                          setMessage("八度点最多三层");
                          return;
                        }
                        setItemDraft(
                          itemDraft.replace(/['.]+$/, "") +
                            (next > 0 ? "'".repeat(next) : ".".repeat(-next)),
                        );
                      }}
                    >
                      {direction > 0 ? "高一八度" : "低一八度"}
                    </Button>
                  ))}
                  <Button
                    onClick={() => {
                      const p = parseNumberedSequence(itemDraft);
                      if (
                        !p.ok ||
                        p.items.length !== 1 ||
                        p.items[0]?.kind !== "set" ||
                        p.items[0].tokens.length !== 1
                      ) {
                        setMessage("请选择一个合法简谱音高");
                        return;
                      }
                      submit({
                        type: "numbered.event.set",
                        trackId: track.id,
                        measureId: measure.id,
                        eventId: event.id,
                        itemId,
                        tokens: p.items[0].tokens,
                      });
                    }}
                  >
                    应用单音符音高
                  </Button>
                </>
              )}
              <Form.Item
                layout="vertical"
                label="连接终点"
                htmlFor={"editor-field-" + "简谱技巧终点"}
              >
                <Select
                  id={"editor-field-" + "简谱技巧终点"}
                  aria-label="简谱技巧终点"
                  value={destination}
                  onChange={(value) => setDestination(value)}
                  style={{ width: "100%" }}
                  options={[
                    { value: "", label: "请选择" },
                    ...markTargets.flatMap(({ e, label }) =>
                      e.items.map((i, j) => ({
                        value: i.id,
                        label: (
                          <>
                            {label}· 音{j + 1}
                          </>
                        ),
                      })),
                    ),
                  ]}
                />
              </Form.Item>
              <Button
                disabled={!itemId || !destination}
                onClick={() =>
                  submit({
                    type: "numbered.mark.add",
                    trackId: track.id,
                    mark: {
                      type: "tie",
                      fromItemId: itemId,
                      toItemId: destination,
                    },
                  })
                }
              >
                添加延音线
              </Button>
              <Button
                disabled={!destination}
                onClick={() => {
                  const to = markTargets.find(({ e }) =>
                    e.items.some((i) => i.id === destination),
                  );
                  if (to)
                    submit({
                      type: "numbered.mark.add",
                      trackId: track.id,
                      mark: {
                        type: "slur",
                        fromEventId: event.id,
                        toEventId: to.e.id,
                      },
                    });
                }}
              >
                添加连音线
              </Button>
              <Button
                onClick={() => {
                  const old = track.numberedMarks.find(
                    (m) => m.type === "fermata" && m.eventId === event.id,
                  );
                  submit(
                    old
                      ? {
                          type: "numbered.mark.remove",
                          trackId: track.id,
                          markId: old.id,
                        }
                      : {
                          type: "numbered.mark.add",
                          trackId: track.id,
                          mark: { type: "fermata", eventId: event.id },
                        },
                  );
                }}
              >
                切换延长记号
              </Button>
            </fieldset>
          )}
          </details>
          <details
            className={styles.numberedDisclosure}
            open={reuseExpanded}
            onToggle={(toggleEvent) => setReuseExpanded(toggleEvent.currentTarget.open)}
          >
            <summary>
              范围复用 <span>复制、覆盖、插入、合并</span>
            </summary>
          <div className={styles.numberedReuseScope} role="status">
            作用范围：{formatNumberedBeatPosition(start, measure.timeSignature.denominator)} – {formatNumberedBeatPosition(end, measure.timeSignature.denominator)} · {measure.numberedVoice.events.filter((candidate) => candidate.kind === "notes" && candidate.tick >= start && candidate.tick < end).length} 个音符
          </div>
          {!getClipboard() && <p className={styles.settingsHint}>请先复制一个简谱范围，之后可覆盖或插入到当前起点。</p>}
          {getClipboard() && <p className={styles.settingsHint}>剪贴板时长：{getClipboard()!.totalTicks} tick</p>}
          <div className={styles.sidebarActions}>
            <Button
              onClick={() => {
                if (
                  copyRange({
                    trackId: track.id,
                    measureId: measure.id,
                    startTick: start,
                    endTick: end,
                  })
                )
                  setMessage(
                    `已复制简谱范围${getClipboard()?.omissions.length ? `，${getClipboard()!.omissions.length} 个跨范围连接未复制` : ""}`,
                  );
              }}
            >
              复制简谱范围
            </Button>
            {(["overwrite", "insert"] as const).map((pasteMode) => (
              <Button
                key={pasteMode}
                disabled={!getClipboard() || (pasteMode === "overwrite" && !overwrite)}
                onClick={() => {
                  const clipboard = getClipboard();
                  if (!clipboard) {
                    setMessage("请先复制简谱范围");
                    return;
                  }
                  submit({
                    type: "numbered.range.paste",
                    trackId: track.id,
                    measureId: measure.id,
                    startTick: start,
                    mode: pasteMode,
                    allowOverwrite: overwrite,
                    clipboard,
                  });
                }}
              >
                {pasteMode === "insert" ? "插入简谱" : "覆盖简谱"}
              </Button>
            ))}
            {event && (
              <Button
                onClick={() => {
                  const to = markTargets.find(({ e }) =>
                    e.items.some((i) => i.id === destination),
                  );
                  if (!to) {
                    setMessage("请选择合并终点");
                    return;
                  }
                  const a = measure.numberedVoice.events.indexOf(event),
                    b = measure.numberedVoice.events.findIndex(
                      (e) => e.id === to.e.id,
                    );
                  submit({
                    type: "numbered.event.merge",
                    trackId: track.id,
                    measureId: measure.id,
                    eventIds:
                      b > a
                        ? measure.numberedVoice.events
                            .slice(a, b + 1)
                            .map((e) => e.id)
                        : [],
                  });
                }}
              >
                合并至终点
              </Button>
            )}
            {event &&
              measure.numberedVoice.tuplets
                .filter((g) => g.eventIds.includes(event.id))
                .map((g) => (
                  <Button
                    key={g.id}
                    onClick={() =>
                      submit({
                        type: "numbered.tuplet.remove",
                        trackId: track.id,
                        measureId: measure.id,
                        tupletId: g.id,
                      })
                    }
                  >
                    移除简谱连音组
                  </Button>
                ))}
          </div>
          {track.numberedMarks
            .filter(
              (m) =>
                m.id === selectedMarkId ||
                (event &&
                  (m.type === "tie"
                    ? event.items.some(
                        (i) => i.id === m.fromItemId || i.id === m.toItemId,
                      )
                    : m.type === "slur"
                      ? m.fromEventId === event.id || m.toEventId === event.id
                      : m.eventId === event.id)),
            )
            .map((m) => (
              <p key={m.id}>
                {m.id === selectedMarkId ? "当前选中：" : ""}
                {m.type === "tie"
                  ? "延音线"
                  : m.type === "slur"
                    ? "连音线"
                    : "延长记号"}
                <Button
                  disabled={!event || (m.type !== "fermata" && !destination)}
                  onClick={() => {
                    if (!event) return;
                    const to = markTargets.find(({ e }) =>
                      e.items.some((i) => i.id === destination),
                    );
                    const mark =
                      m.type === "fermata"
                        ? { type: "fermata" as const, eventId: event.id }
                        : m.type === "tie"
                          ? {
                              type: "tie" as const,
                              fromItemId: itemId,
                              toItemId: destination,
                            }
                          : to
                            ? {
                                type: "slur" as const,
                                fromEventId: event.id,
                                toEventId: to.e.id,
                              }
                            : null;
                    if (mark)
                      submit({
                        type: "numbered.mark.update",
                        trackId: track.id,
                        markId: m.id,
                        mark,
                      });
                  }}
                >
                  更新记号端点
                </Button>
                <Button
                  onClick={() =>
                    submit({
                      type: "numbered.mark.remove",
                      trackId: track.id,
                      markId: m.id,
                    })
                  }
                >
                  删除记号
                </Button>
              </p>
            ))}
          </details>
        </>
      )}
      <dialog
        ref={impactDialog}
        aria-label="确认简谱技巧影响"
        onCancel={() => setPending(null)}
      >
        {pending && (
          <>
            <p>
              将删除 {pending.removed.length} 个记号，迁移{" "}
              {pending.changed.length} 个记号。此操作与内容修改一起撤销。
            </p>
            <Button onClick={() => setPending(null)}>取消</Button>
            <Button
              onClick={() => {
                if (pending.document !== document) {
                  setPending(null);
                  setMessage("预览已过期，请重新操作");
                  return;
                }
                const result = commit({
                  ...pending.operation,
                  expectedRevision: document.documentRevision,
                  confirmedRemovedMarkIds: pending.removed,
                  confirmedChangedMarkIds: pending.changed,
                });
                if (result?.ok) {
                  acknowledgeGroup(pending.group, pending.operation);
                  onApplied?.();
                  setPending(null);
                  setMessage(result.changed ? "已应用" : "内容未变化");
                }
              }}
            >
              确认修改
            </Button>
          </>
        )}
      </dialog>
      {message && <p role="status">{message}</p>}
    </section>
  );
};
