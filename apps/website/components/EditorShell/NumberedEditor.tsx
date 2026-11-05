"use client";
import { Button, Checkbox, Form, Input, Segmented, Select } from "antd";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useImperativeHandle,
  useRef,
  type HTMLAttributes,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
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
  type ILXMRhythm,
  type ILXMNumberedVoiceCommand,
} from "@liuxianmao/lxm-editor";
import type { MusicTextTarget } from "./music-text-draft";
import {
  resolveNumberedEditorTarget,
  numberedTargetWindow,
  formatNumberedBeatPosition,
  numberedTargetKey,
} from "./numbered-editor-target";
import styles from "./index.module.scss";
import {
  buildNumberedPreviewRows,
  type NumberedPreviewRow,
} from "./numbered-preview";
import { numberedContentDependency } from "./numbered-draft-dependencies";
import {
  useEditorSessionStore,
  useEditorStore,
} from "../../stores/editor-store";
import {
  createNumberedSubmission,
  type NumberedDraftGroup,
  type NumberedPropertyApplyResult,
  type NumberedImpact,
} from "./numbered-submission";
export type {
  NumberedDraftGroup,
  NumberedPropertyApplyResult,
} from "./numbered-submission";
import { numberedInputRhythmForWindow } from "./editor-rhythm-target";
import { shouldIgnoreMusicTextKey } from "./music-text-interaction";
import floatingStyles from "./NumberedEditor.module.scss";
import { NumberedRhythmToolbar } from "./NumberedRhythmToolbar";
import { NumberedPitchFields } from "./NumberedPitchFields";
import { BeatMappingPreview, type BeatMappingPosition } from "./BeatMappingPreview";
import { numberedPreviewMapping } from "./numbered-preview";

export interface NumberedGroupState {
  dirty: boolean;
  canApply: boolean;
  blockedReason: string | null;
}

export interface NumberedEditorStatus {
  groups: Record<NumberedDraftGroup, NumberedGroupState>;
  busy: boolean;
  composing: boolean;
  targetKey: string;
  generation: number;
}

export interface NumberedContentBaseline {
  raw: string;
  selectedId: string;
  template: string;
  start: number;
  end: number;
  overwrite: boolean;
  templateBase: ILXMRhythmBase;
  templateDots: number;
  customRhythms: { base: ILXMRhythmBase; dots: number }[];
  ratioIndex: number;
  fixedRange: boolean;
}

const numberedGroupLabels: Record<NumberedDraftGroup, string> = {
  content: "简谱内容", rhythm: "时值", itemPitch: "单音符音高",
};

function NumberedActions({ compact, mode, group, groups, dirtyGroups, disabled, onRestore, onApply, onFocus }: {
  compact: boolean;
  mode: "single" | "sequence";
  group: NumberedDraftGroup;
  groups: Record<NumberedDraftGroup, NumberedGroupState>;
  dirtyGroups: readonly NumberedDraftGroup[];
  disabled: boolean;
  onRestore: (group: NumberedDraftGroup) => boolean;
  onApply: (group: NumberedDraftGroup) => Promise<NumberedPropertyApplyResult>;
  onFocus: (group: NumberedDraftGroup) => void;
}) {
  const label = numberedGroupLabels[group];
  const state = groups[group];
  return <div className={floatingStyles.actions}>
    <p className={floatingStyles.leavingHint}>切换位置或模式会丢弃未应用输入。</p>
    {!compact && <Button disabled={disabled || !state.dirty} onClick={() => onRestore(group)}>恢复{label}</Button>}
    <Button type="primary" aria-label={compact ? "应用" : `应用${label}`} disabled={disabled || !state.canApply}
      title={state.blockedReason ?? (!state.dirty ? "本组没有未应用修改" : group !== "content" ? `独立应用${label}` : mode === "single" ? "应用正文（Enter）" : "应用正文（Ctrl/Cmd+Enter）")}
      onClick={() => onApply(group)}>{compact ? "应用" : `应用${label}`}</Button>
    {!compact && dirtyGroups.filter((other) => other !== group).map((other) => <Button key={other} size="small" onClick={() => onFocus(other)}>{numberedGroupLabels[other]}未应用 · 前往处理</Button>)}
    {!compact && group !== "content" && state.blockedReason && <p className={floatingStyles.actionReason} role="status">{state.blockedReason}</p>}
  </div>;
}

type NumberedDependencyState = {
  contentDirty: boolean;
  rhythmDirty: boolean;
  itemPitchDirty: boolean;
  track?: NumberedImpact["track"];
  measureId?: string;
  event?: NumberedImpact["track"]["measures"][number]["numberedVoice"]["events"][number];
  raw: string;
  itemId: string;
};

/** 同一纯校验供预览和最终提交使用；最终候选仍需重新检查。 */
export const checkNumberedDraftDependencies = (
  state: NumberedDependencyState,
  candidate: NumberedImpact,
  group: NumberedDraftGroup,
  grouped = true,
): string | null => {
  const old = state.event;
  const next = candidate.track.measures
    .flatMap((m) => m.numberedVoice.events)
    .find((e) => e.id === old?.id);
  if (
    state.contentDirty &&
    (!grouped || group !== "content") &&
    state.track &&
    state.measureId &&
    numberedContentDependency(
      state.track,
      state.measureId,
      old?.id,
      state.raw,
    ) !==
      numberedContentDependency(
        candidate.track,
        state.measureId,
        old?.id,
        state.raw,
      )
  )
    return "此操作会影响内容草稿，请先应用或恢复内容组。";
  if (!old) return null;
  if (
    state.itemPitchDirty &&
    (!grouped || group !== "itemPitch") &&
    JSON.stringify(old.items.find((i) => i.id === state.itemId)) !==
      JSON.stringify(next?.items.find((i) => i.id === state.itemId))
  )
    return "此操作会替换单音符草稿的目标，请先应用或恢复单音符音高组。";
  if (
    state.rhythmDirty &&
    (!grouped || group !== "rhythm") &&
    (!next || JSON.stringify(old.rhythm) !== JSON.stringify(next.rhythm))
  )
    return "此操作会影响时值草稿，请先应用或恢复事件时值组。";
  if (
    state.contentDirty &&
    (!grouped || group !== "content") &&
    (!next || JSON.stringify(old.items) !== JSON.stringify(next.items))
  )
    return "此操作会影响内容草稿，请先应用或恢复内容组。";
  return null;
};

export interface NumberedEditorController {
  canApply: boolean;
  canApplyContent: boolean;
  dirty: boolean;
  /** 简谱属性按内容、时值和单 item 音高分组，避免一个 boolean 掩盖未提交字段。 */
  dirtyGroups: readonly NumberedDraftGroup[];
  groups: Record<NumberedDraftGroup, NumberedGroupState>;
  apply: (
    isCurrent?: () => boolean,
    /** 切换前提交可关闭录入前进；默认按核心返回的焦点继续录入。 */
    options?: { advance?: boolean },
  ) => Promise<NumberedPropertyApplyResult>;
  applyContent: (
    isCurrent?: () => boolean,
  ) => Promise<NumberedPropertyApplyResult>;
  applyGroup: (
    group: NumberedDraftGroup,
    isCurrent?: () => boolean,
    options?: { advance?: boolean },
  ) => Promise<NumberedPropertyApplyResult>;
  restoreGroup: (group: NumberedDraftGroup) => boolean;
  readStatus: () => NumberedEditorStatus;
  discard: () => void;
  /** 无参数时恢复上次活动的脏分组；指定分组时展开并定位该组。 */
  focus: (group?: NumberedDraftGroup) => void;
  /** 聚焦紧凑气泡正文；不改变完整侧栏的分组定位。 */
  focusPopover: () => void;
  snapshot: () => NumberedEditorSnapshot;
  setRhythm: (rhythm: ILXMRhythm) => Promise<NumberedPropertyApplyResult>;
}
/** 当前编辑输入的只读快照，用于全局输入登记。 */
export interface NumberedEditorSnapshot {
  activeGroup?: NumberedDraftGroup;
  mode?: "single" | "sequence";
  contentBaseline?: string;
  contentBaselineValue?: NumberedContentBaseline;
  templateBase?: ILXMRhythmBase;
  templateDots?: number;
  fixedRange?: boolean;
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
const countNumberedOverwrites = (
  candidate: NumberedImpact,
  operation: ILXMNumberedVoiceCommand,
  rows: readonly NumberedPreviewRow[],
) =>
  Math.max(
    candidate.overwrittenEventIds.length,
    "allowOverwrite" in operation
      ? rows.filter(
          (row) =>
            (row.status === "change" || row.status === "remove") &&
            row.before !== "—" &&
            (row.before !== "空白" ||
              operation.type === "numbered.range.replace"),
        ).length
      : 0,
  );
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
  mode,
  onModeChange,
  getClipboard,
  copyRange,
  selectedMarkId,
  onSelectTarget,
  onBusyChange,
  onGroupsChange,
  presentation = "sidebar",
  popoverContainer = null,
  onRequestSidebar,
  actionsHost = null,
  onRequestTarget,
  onInspectPosition,
}: {
  ref: Ref<NumberedEditorController>;
  onBusyChange?: (busy: boolean) => void;
  onGroupsChange?: (groups: readonly NumberedDraftGroup[]) => void;
  presentation?: "popover" | "sidebar";
  /** 在完整侧栏之外，用同一份草稿渲染紧凑气泡；仅 sidebar 模式使用。 */
  popoverContainer?: HTMLElement | null;
  onRequestSidebar?: (group?: NumberedDraftGroup) => void;
  actionsHost?: HTMLElement | null;
  /** 成员变化必须经过父级统一离开策略；不得局部替换当前脏草稿。 */
  onRequestTarget?: (target: MusicTextTarget) => void;
  onInspectPosition?: (position: BeatMappingPosition) => void;
  document: ILXMDocument;
  target: MusicTextTarget | ILXMTabCellReference | null;
  selection?: ILXMTabCellSelection | null;
  commit: (c: ILXMScoreCommand) => ILXMApplyScoreCommandResult | null;
  onDirty: (v: boolean) => void;
  onInputActive: (v: boolean) => void;
  onPreviewTargetChange: (t: MusicTextTarget | null) => void;
  onActivate: (focusInput?: boolean) => void;
  onCanApply: (v: boolean) => void;
  getClipboard: () => NumberedClipboard | null;
  copyRange: (range: NumberedClipboardRange) => boolean;
  mode: "single" | "sequence";
  onModeChange: (m: "single" | "sequence") => void;
  onCancel: () => void;
  selectedMarkId: string | null;
  onSelectTarget: (target: MusicTextTarget, advance?: boolean) => void;
}) => {
  const compact = presentation === "popover";
  const editorStore = useEditorSessionStore();
  const preference = useEditorStore((state) => state.numberedInputRhythm);
  const preferenceExplicit = useEditorStore(
    (state) => state.numberedInputRhythmExplicit,
  );
  // getClipboard 返回快照；仅复制动作也须刷新摘要和粘贴规划。
  useEditorStore((state) => state.clipboardVersion);
  const targetInputKey = JSON.stringify(target);
  // 核心可能在正文成功后重建成员 ID；仅本 owner 的真实成功结果可重绑当前事件。
  const [submittedTarget, setSubmittedTarget] = useState<{
    inputKey: string;
    target: MusicTextTarget;
  } | null>(null);
  const resolved = useMemo(
    () => resolveNumberedEditorTarget(document, submittedTarget?.inputKey === targetInputKey ? submittedTarget.target : target),
    [document, target, submittedTarget, targetInputKey],
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
  const [selectedId, setSelectedId] = useState(firstEvent?.id ?? "");
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
  const [start, setStart] = useState(window.start),
    [end, setEnd] = useState(window.end);
  const initialBeatTicks = 3840 / (measure?.timeSignature.denominator ?? 4);
  const [copySource, setCopySource] = useState({ measureId: measure?.id ?? "", startBeat: String(1 + window.start / initialBeatTicks), endBeat: String(1 + window.end / initialBeatTicks) });
  const [pasteTarget, setPasteTarget] = useState({ measureId: measure?.id ?? "", startBeat: String(1 + window.start / initialBeatTicks) });
  const [pasteOverwrite, setPasteOverwrite] = useState(true);
  const [copiedRange, setCopiedRange] = useState<{ label: string; clipboard: NumberedClipboard } | null>(null);
  const [mergeEndId, setMergeEndId] = useState("");
  const [originalPosition] = useState(() => track && measure
    ? `第 ${track.measures.indexOf(measure) + 1} 小节 · ${formatNumberedBeatPosition(window.start, measure.timeSignature.denominator)}`
    : "原选择位置");
  const [fixedRange, setFixedRange] = useState(false);
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
  const [raw, setRaw] = useState(value),
    [initial, setInitial] = useState(value),
    [overwrite, setOverwrite] = useState(true);
  const [base, setBase] = useState<ILXMRhythmBase>(
      firstEvent?.rhythm.base ??
        numberedRhythmForTicks(window.end - window.start)?.base ??
        "quarter",
    ),
    [dots, setDots] = useState(
      firstEvent?.rhythm.dots ??
        numberedRhythmForTicks(window.end - window.start)?.dots ??
        0,
    );
  const [template, setTemplate] = useState("uniform"),
    [itemId, setItemId] = useState(
      sourceBeat
        ? (firstEvent?.items[0]?.id ?? "")
        : resolved?.kind === "numberedEvent"
          ? (resolved.itemId ?? firstEvent?.items[0]?.id ?? "")
          : "",
    ),
    [destination, setDestination] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<NumberedImpact | null>(null);
  const [nextTarget, setNextTarget] = useState<MusicTextTarget | null>(null);
  const input = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const popoverInput = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const sidebarCaret = useRef<{ start: number; end: number; direction: "forward" | "backward" | "none" } | null>(null);
  const root = useRef<HTMLElement>(null);
  const rhythmDetails = useRef<HTMLDetailsElement>(null);
  const rangeDetails = useRef<HTMLDetailsElement>(null);
  const activeGroup = useRef<NumberedDraftGroup>("content");
  const [actionGroup, setActionGroup] = useState<NumberedDraftGroup>("content");
  const composing = useRef(false);
  const compositionEndedAt = useRef(-Infinity);
  const [compositionGuard, setCompositionGuard] = useState(false);
  const compositionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (compositionTimer.current) clearTimeout(compositionTimer.current);
    },
    [],
  );
  const [focusRequest, setFocusRequest] = useState<{
    group: NumberedDraftGroup;
    popover?: boolean;
  } | null>(null);
  const completedFocusRequest = useRef<typeof focusRequest>(null);
  const impactDialog = useRef<HTMLDialogElement>(null);
  const [customRhythms, setCustomRhythms] = useState<
    { base: ILXMRhythmBase; dots: number }[]
  >([]);
  const [ratioIndex, setRatioIndex] = useState(1);
  const [itemDraft, setItemDraft] = useState(
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
  // 单音留空只清除已有事件的内容，保留该事件占用的时间。
  const clearSingleEvent =
    mode === "single" &&
    !raw.trim() &&
    !!event &&
    template === "uniform" &&
    !fixedRange;
  const [templateBase, setTemplateBase] = useState<ILXMRhythmBase>(
    numberedInputRhythmForWindow(
      preference,
      preferenceExplicit,
      window.end - window.start,
    ).base,
  );
  const [templateDots, setTemplateDots] = useState(
    numberedInputRhythmForWindow(
      preference,
      preferenceExplicit,
      window.end - window.start,
    ).dots,
  );
  const complexRhythm =
    template !== "uniform" ||
    fixedRange ||
    (event ? dots : templateDots) > 1 ||
    !!(
      event &&
      measure?.numberedVoice.tuplets.some((g) => g.eventIds.includes(event.id))
    );
  const changeEventRhythmDraft = (
    nextBase: ILXMRhythmBase,
    nextDots: number,
  ) => {
    if (pending || composing.current || compositionGuard) return;
    setBase(nextBase);
    setDots(nextDots);
  };
  const changeInputRhythmDraft = (
    nextBase: ILXMRhythmBase,
    nextDots: number,
  ) => {
    if (pending || composing.current || compositionGuard) return;
    setTemplateBase(nextBase);
    setTemplateDots(nextDots);
    editorStore
      .getState()
      .setNumberedInputRhythm({ base: nextBase, dots: nextDots });
  };
  // 创建模板与已有事件时值分别保存；停用的比例/成员参数只作为录入偏好。
  const contentValue = useCallback(
    (
      text: string,
      config = {
        template,
        start,
        end,
        overwrite,
        templateBase,
        templateDots,
        customRhythms,
        ratioIndex,
        fixedRange,
      },
    ) =>
      JSON.stringify({
        raw: text,
        template: config.template,
        fixedRange: config.fixedRange,
        ...(event && config.template === "uniform" && !config.fixedRange
          ? {}
          : {
              start: config.start,
              end: config.end,
              ...(config.template === "uniform" || config.template === "tuplet"
                ? { base: config.templateBase, dots: config.templateDots }
                : {}),
              ...(config.template === "custom"
                ? { rhythms: config.customRhythms }
                : {}),
              ...(config.template === "tuplet"
                ? { ratio: config.ratioIndex }
                : {}),
            }),
        overwrite: config.overwrite,
      }),
    [
      template,
      start,
      end,
      overwrite,
      templateBase,
      templateDots,
      customRhythms,
      ratioIndex,
      fixedRange,
      event,
    ],
  );
  const [contentBaseline, setContentBaseline] = useState(() =>
    contentValue(initial),
  );
  const contentBaselineValue = useRef<NumberedContentBaseline>({
    raw: initial, selectedId, template, start, end, overwrite,
    templateBase, templateDots, customRhythms: structuredClone(customRhythms),
    ratioIndex, fixedRange,
  });
  const [rhythmBaseline, setRhythmBaseline] = useState({ base, dots });
  const [pitchBaseline, setPitchBaseline] = useState(itemDraft);
  const [conflicts, setConflicts] = useState<Partial<Record<NumberedDraftGroup, string>>>({});
  const targetInvalid = !resolved || !track || !measure ||
    (!!selectedId && !event) ||
    (resolved.kind === "numberedEvent" && !!resolved.itemId && !!event && !event.items.some((item) => item.id === resolved.itemId));
  const contentFingerprint = contentValue(raw);
  const operation = useMemo<ILXMNumberedVoiceCommand | null>(() => {
    if (!track || !measure || targetInvalid) return null;
    if (clearSingleEvent && event)
      return {
        type: "numbered.event.set",
        trackId: track.id,
        measureId: measure.id,
        eventId: event.id,
        tokens: [],
      };
    if (!parsed.ok) return null;
    if (
      mode === "single" &&
      template === "uniform" &&
      !fixedRange &&
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
    if (mode === "sequence" && event && template === "uniform" && !fixedRange)
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
        ? (customRhythms[i] ?? { base: templateBase, dots: templateDots })
        : { base: templateBase, dots: templateDots },
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
    if (!event && template === "uniform" && !fixedRange)
      return {
        type: "numbered.sequence.insert",
        trackId: track.id,
        measureId: measure.id,
        startTick: start,
        endTick: end,
        items: parsed.items,
        rhythms,
      };
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
    templateBase,
    templateDots,
    template,
    start,
    end,
    overwrite,
    customRhythms,
    ratioIndex,
    fixedRange,
    clearSingleEvent,
    targetInvalid,
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
  // 只借用同一个 planner 显示未获许可的影响；真正提交仍使用原始操作。
  const overwritePreview = useMemo(
    () =>
      track &&
      operation &&
      "allowOverwrite" in operation &&
      !overwrite &&
      plan &&
      !plan.ok &&
      plan.message.includes("覆盖")
        ? editNumberedTrack(
            track,
            { ...operation, allowOverwrite: true },
            createDocumentIdFactory(document),
            true,
          )
        : null,
    [track, operation, overwrite, plan, document],
  );
  const previewRows = useMemo<NumberedPreviewRow[]>(
    () =>
      plan?.ok && track && operation
        ? buildNumberedPreviewRows(track, plan, operation)
        : [],
    [track, plan, operation],
  );
  const issue =
    !parsed.ok && !clearSingleEvent
      ? parsed.message
      : mode === "single" && parsed.ok && parsed.items.length !== 1
        ? "单音组只接受一项；先后音请使用节奏模板"
        : plan && !plan.ok
          ? plan.message
           : null;
  useEffect(() => {
    if (!issue || !parsed.ok) return;
    // 核心规划失败时展开真实范围控件；普通预览刷新不折叠用户已展开的分组。
    if (rhythmDetails.current) rhythmDetails.current.open = true;
    if (rangeDetails.current) rangeDetails.current.open = true;
  }, [issue, parsed.ok]);
  const contentDirty =
    !(clearSingleEvent && event?.kind === "gap") &&
    contentFingerprint !== contentBaseline &&
    (raw !== initial || !!raw.trim());

  useEffect(() => {
    // 外部时值偏好只同步干净模板，已输入的内容保留自己的时值。
    if (contentDirty || pending) return;
    const rhythm = numberedInputRhythmForWindow(
      preference,
      preferenceExplicit,
      window.end - window.start,
    );
    if (rhythm.base === templateBase && rhythm.dots === templateDots) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setTemplateBase(rhythm.base);
      setTemplateDots(rhythm.dots);
      setContentBaseline(
        contentValue(initial, {
          template,
          start,
          end,
          overwrite,
          customRhythms,
          ratioIndex,
          fixedRange,
          templateBase: rhythm.base,
          templateDots: rhythm.dots,
        }),
      );
      contentBaselineValue.current = {
        ...contentBaselineValue.current,
        templateBase: rhythm.base,
        templateDots: rhythm.dots,
      };
    });
    return () => {
      cancelled = true;
    };
  }, [
    preference,
    preferenceExplicit,
    window.end,
    window.start,
    contentDirty,
    pending,
    templateBase,
    templateDots,
    initial,
    template,
    start,
    end,
    overwrite,
    customRhythms,
    ratioIndex,
    fixedRange,
    contentValue,
  ]);

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
  const inferGroup = (op: ILXMNumberedVoiceCommand): NumberedDraftGroup => {
    if (op.type === "numbered.event.setRhythm") return "rhythm";
    if (op.type === "numbered.event.set" && "itemId" in op && op.itemId)
      return "itemPitch";
    return "content";
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
            timeline: "editTimeline",
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
    base !== rhythmBaseline.base || dots !== rhythmBaseline.dots;
  const rhythmPreviewRows = useMemo(
    () =>
      rhythmPlan?.ok && track && rhythmOperation
        ? buildNumberedPreviewRows(track, rhythmPlan, rhythmOperation)
        : [],
    [track, rhythmPlan, rhythmOperation],
  );
  const itemPitchDirty = !!itemId && itemDraft !== pitchBaseline;
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
  const itemPitchIssue =
    itemPitchDirty && !itemPitchOperation ? "请选择一个合法简谱音高" : null;
  const itemPitchPlan = useMemo(
    () =>
      itemPitchOperation && track
        ? editNumberedTrack(
            track,
            itemPitchOperation,
            createDocumentIdFactory(document),
            true,
          )
        : null,
    [itemPitchOperation, track, document],
  );
  const dirtyGroups = useMemo<readonly NumberedDraftGroup[]>(
    () => [
      ...(contentDirty ? (["content"] as const) : []),
      ...(rhythmDirty ? (["rhythm"] as const) : []),
      ...(itemPitchDirty ? (["itemPitch"] as const) : []),
    ],
    [contentDirty, rhythmDirty, itemPitchDirty],
  );
  const dependencyState: NumberedDependencyState = {
    contentDirty,
    rhythmDirty,
    itemPitchDirty,
    track,
    measureId: measure?.id,
    event,
    raw,
    itemId,
  };
  const groupState = (
    group: NumberedDraftGroup,
    candidate: typeof plan,
    validationIssue?: string | null,
  ): NumberedGroupState => {
    const dirty = dirtyGroups.includes(group);
    const fingerprint = group === "content" ? contentFingerprint : group === "rhythm" ? JSON.stringify({ base, dots }) : itemDraft;
    const blockedReason = !dirty
      ? null
      : (targetInvalid ? "当前简谱目标已失效，输入已保留，请重新选择位置。" :
        conflicts[group] === fingerprint ? "曲谱中的本组内容已改变，请恢复本组或核对后修改输入。" : validationIssue ??
        (candidate?.ok
          ? checkNumberedDraftDependencies(dependencyState, candidate, group)
          : (candidate?.message ?? "请先修正本组字段。")));
    return {
      dirty,
      canApply: dirty && !pending && !compositionGuard && !blockedReason,
      blockedReason,
    };
  };
  const groups: Record<NumberedDraftGroup, NumberedGroupState> = {
    content: groupState("content", plan, issue),
    rhythm: groupState("rhythm", rhythmPlan),
    itemPitch: groupState("itemPitch", itemPitchPlan, itemPitchIssue),
  };
  const canApplyByGroup: Record<NumberedDraftGroup, boolean> = {
    content: groups.content.canApply,
    rhythm: groups.rhythm.canApply,
    itemPitch: groups.itemPitch.canApply,
  };
  const dirty = dirtyGroups.length > 0;
  const submissionRef = useRef<ReturnType<
    typeof createNumberedSubmission
  > | null>(null);
  const submissionAdvance = useRef(true);
  // 只在真实输入/配置或目标变化时递增；相同输入重新登记、滚动和重渲染不失效。
  const candidateKey = JSON.stringify({
    resolved,
    mode,
    selectedId,
    contentFingerprint,
    base,
    dots,
    templateBase,
    templateDots,
    customRhythms,
    ratioIndex,
    itemId,
    itemDraft,
    destination,
    mergeEndId,
    copySource,
    pasteTarget,
    pasteOverwrite,
    selectedMarkId,
  });
  const candidateGeneration = useRef({
    key: candidateKey,
    revision: 0,
    mounted: false,
  });
  useLayoutEffect(() => {
    const generation = candidateGeneration.current;
    if (generation.key !== candidateKey) {
      generation.key = candidateKey;
      generation.revision++;
      submissionRef.current?.cancel("stale");
    }
  }, [candidateKey]);
  useLayoutEffect(() => {
    const generation = candidateGeneration.current;
    generation.mounted = true;
    return () => {
      generation.mounted = false;
      generation.revision++;
    };
  }, []);
  const focusGroup = (requested?: NumberedDraftGroup) => {
    const group =
      requested ??
      (dirtyGroups.includes(activeGroup.current)
        ? activeGroup.current
        : (dirtyGroups[0] ?? "content"));
    activeGroup.current = group;
    setActionGroup(group);
    if (
      compact &&
      (group === "itemPitch" ||
        (group === "rhythm" && (!event || complexRhythm)))
    )
      onRequestSidebar?.(group);
    setFocusRequest({ group });
  };
  useLayoutEffect(() => {
    if (
      !focusRequest ||
      completedFocusRequest.current === focusRequest ||
      pending
    )
      return;
    if (focusRequest.popover) {
      // Ant Input 的 visibility transition 在起始帧仍可能停在 hidden。
      // 首次聚焦失败时等待该过渡结束，不以固定帧数猜测可聚焦时机。
      let cancelled = false;
      const frame = requestAnimationFrame(() => {
        const control = compact
          ? input.current
          : popoverContainer
            ? popoverInput.current
            : null;
        if (!control) return;
        const focus = () => {
          if (
            cancelled ||
            completedFocusRequest.current === focusRequest ||
            !control.isConnected ||
            control.closest("[hidden], [inert]")
          )
            return;
          control.focus({ preventScroll: true });
          if (globalThis.document.activeElement === control) {
            completedFocusRequest.current = focusRequest;
            control.scrollIntoView?.({ block: "nearest" });
          }
        };
        focus();
        if (completedFocusRequest.current === focusRequest) return;
        const transitions = control
          .getAnimations()
          .filter(
            (animation) =>
              animation.effect instanceof KeyframeEffect &&
              animation.effect
                .getKeyframes()
                .some((keyframe) => "visibility" in keyframe),
          );
        if (transitions.length)
          void Promise.allSettled(
            transitions.map((animation) => animation.finished),
          ).then(focus);
      });
      return () => {
        cancelled = true;
        cancelAnimationFrame(frame);
      };
    }
    if (
      compact &&
      (focusRequest.group === "itemPitch" ||
        (focusRequest.group === "rhythm" && (!event || complexRhythm)))
    )
      return;
    const container = Array.from(
      root.current?.querySelectorAll<HTMLElement>(
        `[data-numbered-group="${focusRequest.group}"]`,
      ) ?? [],
    ).find((element) => !element.closest("[hidden], [inert]"));
    if (!container) return;
    let ancestor: HTMLElement | null = container;
    while (ancestor && ancestor !== root.current) {
      if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
      ancestor = ancestor.parentElement;
    }
    const control =
      focusRequest.group === "content"
        ? input.current
        : container.querySelector<HTMLElement>(
            "input:not(:disabled), textarea:not(:disabled), button:not(:disabled)",
          );
    control?.focus({ preventScroll: true });
    if (focusRequest.group === "content" && sidebarCaret.current &&
      (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement)) {
      const caret = sidebarCaret.current;
      control.setSelectionRange(caret.start, caret.end, caret.direction);
      sidebarCaret.current = null;
    }
    control?.scrollIntoView?.({ block: "nearest" });
    if (control && globalThis.document.activeElement === control)
      completedFocusRequest.current = focusRequest;
  }, [focusRequest, pending, compact, complexRhythm, event, popoverContainer]);
  const latest = useRef({
    onBusyChange,
    commit,
    contentDirty,
    rhythmDirty,
    itemPitchDirty,
    contentFingerprint,
    raw,
    event,
    itemId,
    itemDraft,
    track,
    dirtyGroups,
    contentValue,
    selectedEvents,
    measureId: measure?.id,
    mode,
    targetInputKey,
    contentConfig: { raw, selectedId, template, start, end, overwrite, templateBase, templateDots, customRhythms, ratioIndex, fixedRange },
  });
  useLayoutEffect(() => {
    latest.current = {
      onBusyChange,
      commit,
      contentDirty,
      rhythmDirty,
      itemPitchDirty,
      contentFingerprint,
      raw,
      event,
      itemId,
      itemDraft,
      track,
      dirtyGroups,
      contentValue,
      selectedEvents,
      measureId: measure?.id,
      mode,
      targetInputKey,
      contentConfig: { raw, selectedId, template, start, end, overwrite, templateBase, templateDots, customRhythms, ratioIndex, fixedRange },
    };
  });
  const ownDocument = useRef<ILXMDocument | null>(null);
  const observed = useRef({ document, track, event, itemId });
  useLayoutEffect(() => {
    const previous = observed.current;
    if (previous.document === document) return;
    observed.current = { document, track, event, itemId };
    if (ownDocument.current === document) {
      ownDocument.current = null;
      return;
    }
    // 同会话外部更新：干净字段跟随，脏字段保持原文；同依赖变化须重新核对。
    const changed: Partial<Record<NumberedDraftGroup, string>> = {};
    if (contentDirty && previous.track && track && measure &&
      numberedContentDependency(previous.track, measure.id, previous.event?.id, raw) !==
      numberedContentDependency(track, measure.id, event?.id, raw))
      changed.content = contentFingerprint;
    if (rhythmDirty && JSON.stringify(previous.event?.rhythm) !== JSON.stringify(event?.rhythm))
      changed.rhythm = JSON.stringify({ base, dots });
    if (itemPitchDirty && JSON.stringify(previous.event?.items.find((item) => item.id === itemId)) !== JSON.stringify(event?.items.find((item) => item.id === itemId)))
      changed.itemPitch = itemDraft;
    queueMicrotask(() => {
      if (!candidateGeneration.current.mounted || observed.current.document !== document) return;
      if (Object.keys(changed).length) setConflicts((current) => ({ ...current, ...changed }));
      if (!contentDirty && !targetInvalid) {
        setRaw(value);
        setInitial(value);
        setContentBaseline(contentValue(value));
        contentBaselineValue.current = structuredClone({ ...latest.current.contentConfig, raw: value });
      }
      if (!rhythmDirty && event) {
        setBase(event.rhythm.base);
        setDots(event.rhythm.dots);
        setRhythmBaseline({ ...event.rhythm });
      }
      if (!itemPitchDirty && event) {
        const nextItem = event.items.find((item) => item.id === itemId) ?? event.items[0];
        const token = nextItem?.token ?? "";
        setItemId(nextItem?.id ?? "");
        setItemDraft(token);
        setPitchBaseline(token);
      }
    });
  }, [document, track, event, itemId, measure, contentDirty, rhythmDirty, itemPitchDirty, raw, contentFingerprint, base, dots, itemDraft, targetInvalid, value, contentValue]);
  useLayoutEffect(() => {
    const submission = createNumberedSubmission({
      getVersion: editorStore.getState,
      commit: (op) => latest.current.commit(op),
      onPending: (impact) => {
        setPending(impact);
        latest.current.onBusyChange?.(!!impact);
      },
      check: (_op, candidate, group, grouped) => {
        const state = latest.current;
        return checkNumberedDraftDependencies(state, candidate, group, grouped);
      },
      onSuccess: (group, op, result, grouped) => {
        const state = latest.current;
        ownDocument.current = result.document;
        if (grouped && group === "content") {
          setInitial(state.raw);
          setContentBaseline(state.contentFingerprint);
          contentBaselineValue.current = structuredClone(state.contentConfig);
        }
        const afterTrack = result.document.score.tracks.find(
          (t) => t.id === op.trackId,
        );
        const afterEvent = afterTrack?.measures
          .flatMap((m) => m.numberedVoice.events)
          .find((e) => e.id === state.event?.id) ??
          (grouped && group === "content" && op.type === "numbered.range.replace"
            ? afterTrack?.measures.find((m) => m.id === op.measureId)?.numberedVoice.events.find((e) => e.tick === op.startTick)
            : undefined);
        if (afterEvent) {
          setSelectedId(afterEvent.id);
          if (grouped && group === "content") contentBaselineValue.current.selectedId = afterEvent.id;
          const member = afterEvent.items.find((item) => item.id === state.itemId) ?? afterEvent.items[0];
          setSubmittedTarget({ inputKey: state.targetInputKey, target: {
            kind: "numbered", trackId: op.trackId,
            measureId: afterTrack!.measures.find((item) => item.numberedVoice.events.some((e) => e.id === afterEvent.id))!.id,
            eventId: afterEvent.id,
            ...(member ? { itemId: member.id } : {}),
          } });
          if (!state.rhythmDirty || (grouped && group === "rhythm")) {
            setBase(afterEvent.rhythm.base);
            setDots(afterEvent.rhythm.dots);
            setRhythmBaseline({ ...afterEvent.rhythm });
          }
          if (!state.itemPitchDirty || (grouped && group === "itemPitch")) {
            const item =
              afterEvent.items.find((i) => i.id === state.itemId) ??
              afterEvent.items[0];
            setItemId(item?.id ?? "");
            setItemDraft(item?.token ?? "");
            setPitchBaseline(item?.token ?? "");
          }
          if (!state.contentDirty && state.event) {
            const ids = state.selectedEvents.map((e) => e.id);
            const text =
              state.mode === "single"
                ? afterEvent.items.map((i) => i.token).join("+")
                : afterTrack!.measures
                    .flatMap((m) => m.numberedVoice.events)
                    .filter((e) => ids.includes(e.id))
                    .map((e) => e.items.map((i) => i.token).join("+") || "_")
                    .join(" ");
            setRaw(text);
            setInitial(text);
            setContentBaseline(state.contentValue(text));
            contentBaselineValue.current = structuredClone({ ...state.contentConfig, raw: text });
          }
        }
        setMessage(result.changed ? "已应用" : "内容未变化");
        const focus = result.nextNumberedFocus;
        if (focus && submissionAdvance.current && !state.dirtyGroups.some((other) => !grouped || other !== group)) {
          setNextTarget({ kind: "numbered", ...focus });
        }
      },
    });
    submissionRef.current = submission;
    const release = editorStore.subscribe(() => submission.invalidate());
    return () => {
      release();
      submission.cancel("stale");
      submissionRef.current = null;
    };
  }, [editorStore]);
  const submit = async (
    op: ILXMNumberedVoiceCommand,
    group = inferGroup(op),
    isCurrent?: () => boolean,
    grouped = false,
    advance = true,
  ) => {
    if (targetInvalid)
      return { status: "blocked" as const, group, message: "当前简谱目标已失效，输入已保留。" };
    if (composing.current || compositionGuard)
      return {
        status: "blocked" as const,
        group,
        message: "请先完成输入法输入。",
      };
    const revision = candidateGeneration.current.revision;
    const current = () =>
      candidateGeneration.current.mounted &&
      candidateGeneration.current.revision === revision &&
      (isCurrent?.() ?? true);
    // 确认等待期间的重复请求不能改变原提交是否前进。
    if (!submissionRef.current?.isBusy()) submissionAdvance.current = advance;
    const result = (await submissionRef.current?.request(
      op,
      group,
      current,
      grouped,
    )) ?? { status: "stale" as const, group, message: "简谱编辑器已关闭。" };
    if (candidateGeneration.current.mounted && candidateGeneration.current.revision === revision && "message" in result)
      setMessage(result.message);
    return result;
  };
  const applyGroup = (
    group: NumberedDraftGroup,
    isCurrent?: () => boolean,
    options?: { advance?: boolean },
  ): Promise<NumberedPropertyApplyResult> => {
    if (!dirtyGroups.includes(group))
      return Promise.resolve({ status: "noop", group });
    const op =
      group === "content"
        ? operation
        : group === "rhythm"
          ? rhythmOperation
          : itemPitchOperation;
    if (!canApplyByGroup[group] || !op)
      return Promise.resolve({
        status: "blocked",
        group,
        message: groups[group].blockedReason ?? "请先修正本组字段。",
      });
    const advance = group === "content" && (options?.advance ?? true) &&
      !dirtyGroups.some((other) => other !== group);
    return submit(op, group, isCurrent, true, advance);
  };
  const applyContent = (isCurrent?: () => boolean) =>
    applyGroup("content", isCurrent);
  const apply = (
    isCurrent?: () => boolean,
    options?: { advance?: boolean },
  ): Promise<NumberedPropertyApplyResult> => {
    if (dirtyGroups.length === 0)
      return Promise.resolve({ status: "noop", group: "content" });
    if (dirtyGroups.length !== 1)
      return Promise.resolve({
        status: "blocked",
        group: "content",
        message: "有多个分组尚未应用，请分别处理后再切换。",
      });
    return applyGroup(dirtyGroups[0]!, isCurrent, options);
  };
  const canApply =
    !pending &&
    (dirtyGroups.length === 0 ||
      (dirtyGroups.length === 1 && canApplyByGroup[dirtyGroups[0]!]));
  useEffect(() => onGroupsChange?.(dirtyGroups), [onGroupsChange, dirtyGroups]);
  useEffect(() => onDirty(dirty || !!pending), [dirty, pending, onDirty]);
  useEffect(() => onCanApply(canApply), [canApply, onCanApply]);
  useEffect(() => {
    if (!nextTarget || pending) return;
    // 先发布已清理的草稿和释放确认锁，再通过父级目标保护器移动焦点。
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setNextTarget(null);
      if (dirtyGroups.length) return;
      onSelectTarget(nextTarget, true);
    });
    return () => {
      cancelled = true;
    };
  }, [nextTarget, pending, onSelectTarget, dirtyGroups]);
  const restoreGroup = (group: NumberedDraftGroup) => {
    if (composing.current || compositionGuard || pending || submissionRef.current?.isBusy()) return false;
    if (group === "content") {
      const baseline = structuredClone(contentBaselineValue.current);
      if (conflicts.content !== undefined && !targetInvalid) baseline.raw = value;
      setRaw(baseline.raw);
      setInitial(baseline.raw);
      setSelectedId(baseline.selectedId);
      setOverwrite(baseline.overwrite);
      setTemplate(baseline.template);
      setFixedRange(baseline.fixedRange);
      setStart(baseline.start);
      setEnd(baseline.end);
      setTemplateBase(baseline.templateBase);
      setTemplateDots(baseline.templateDots);
      setCustomRhythms(baseline.customRhythms);
      setRatioIndex(baseline.ratioIndex);
      contentBaselineValue.current = baseline;
      setContentBaseline(contentValue(baseline.raw, baseline));
    } else if (group === "rhythm" && event) {
      setBase(event.rhythm.base);
      setDots(event.rhythm.dots);
      setRhythmBaseline({ ...event.rhythm });
    } else if (group === "rhythm") {
      setBase(rhythmBaseline.base);
      setDots(rhythmBaseline.dots);
    } else if (group === "itemPitch") {
      const token = event?.items.find((i) => i.id === itemId)?.token ?? pitchBaseline;
      setItemDraft(token);
      setPitchBaseline(token);
    }
    setConflicts((current) => ({ ...current, [group]: undefined }));
    setMessage(null);
    return true;
  };
  const reset = () => {
    if (composing.current || compositionGuard) return;
    submissionRef.current?.cancel();
    restoreGroup("content");
    restoreGroup("rhythm");
    restoreGroup("itemPitch");
    onInputActive(false);
  };
  const statusRef = useRef<NumberedEditorStatus>({
    groups, busy: !!pending, composing: compositionGuard,
    targetKey: resolved ? numberedTargetKey(resolved) : "invalid",
    generation: 0,
  });
  useLayoutEffect(() => {
    statusRef.current = {
      groups, busy: !!pending || !!submissionRef.current?.isBusy(),
      composing: composing.current || compositionGuard,
      targetKey: resolved ? numberedTargetKey(resolved) : "invalid",
      generation: candidateGeneration.current.revision,
    };
  });
  useImperativeHandle(ref, () => ({
    canApply,
    canApplyContent: !pending && canApplyByGroup.content,
    dirty,
    dirtyGroups,
    groups,
    apply,
    applyContent,
    applyGroup,
    restoreGroup,
    readStatus: () => ({ ...statusRef.current,
      busy: !!submissionRef.current?.isBusy(),
      composing: composing.current || statusRef.current.composing,
      generation: candidateGeneration.current.revision,
    }),
    setRhythm: (rhythm) =>
      event && track && measure
        ? submit(
            {
              type: "numbered.event.setRhythm",
              trackId: track.id,
              measureId: measure.id,
              eventId: event.id,
              rhythm,
              timeline: "editTimeline",
            },
             "rhythm",
             undefined,
             false,
             false,
          )
        : Promise.resolve({
            status: "blocked",
            group: "rhythm",
            message: "请先选择简谱事件。",
          }),
    discard: reset,
    focus: focusGroup,
    focusPopover: () => setFocusRequest({ group: "content", popover: true }),
    snapshot: () => ({
      activeGroup: activeGroup.current,
      mode,
      contentBaseline,
      contentBaselineValue: structuredClone(contentBaselineValue.current),
      templateBase,
      templateDots,
      fixedRange,
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
  const inputIsEmpty = !raw.trim() && !event;
  const previewFocus = plan?.ok ? plan.nextFocus : undefined;
  const previewMeasure = plan?.ok
    ? plan.track.measures.find((m) => m.id === measure?.id)
    : undefined;
  const focusEvent =
    previewFocus && "eventId" in previewFocus
      ? previewMeasure?.numberedVoice.events.find(
          (e) => e.id === previewFocus.eventId,
        )
      : undefined;
  // 时长取核心候选的真实事件区间/下一焦点，包含跳过占用及连音的实际时长。
  const occupiedTicks = inputIsEmpty
    ? 0
    : !plan?.ok
      ? null
      : previewRows
          .filter((row) => !["remove", "release"].includes(row.status))
          .reduce((sum, row) => sum + row.endTick - row.startTick, 0);
  const beatTicks = 3840 / (measure?.timeSignature.denominator ?? 4);
  const beats = (ticks: number) =>
    `${Number((ticks / beatTicks).toFixed(3))} 拍`;
  const nextPosition = !plan?.ok
    ? inputIsEmpty
      ? "等待录入"
      : "请先修正输入"
    : previewFocus && "tick" in previewFocus
      ? `剩余空白 ${formatNumberedBeatPosition(previewFocus.tick, measure!.timeSignature.denominator)}～${formatNumberedBeatPosition(previewFocus.endTick, measure!.timeSignature.denominator)}`
      : focusEvent
        ? `已有事件 · ${formatNumberedBeatPosition(focusEvent.tick, measure!.timeSignature.denominator)}`
        : operation?.type === "numbered.sequence.insert"
          ? "本小节录入完成，请选择下一位置"
          : "停留当前事件";
  const compactBlockedReason = dirtyGroups
    .map((group) => groups[group].blockedReason)
    .find(Boolean);
  const confirmedOverwrites =
    plan?.ok && operation
      ? countNumberedOverwrites(plan, operation, previewRows)
      : 0;
  const unconfirmedOverwrites =
    overwritePreview?.ok && operation && track
      ? countNumberedOverwrites(
          overwritePreview,
          operation,
          buildNumberedPreviewRows(track, overwritePreview, operation),
        )
      : 0;
  const requestSidebar = (group?: NumberedDraftGroup) => {
    if (
      pending ||
      composing.current ||
      compositionGuard ||
      submissionRef.current?.isBusy()
    )
      return;
    if (!group || group === "content") {
      const source = compact ? input.current : popoverInput.current;
      if (source?.selectionStart !== null && source?.selectionEnd !== null && source) {
        sidebarCaret.current = { start: source.selectionStart, end: source.selectionEnd, direction: source.selectionDirection ?? "none" };
      }
    }
    onRequestSidebar?.(group);
  };
  const restoreUniform = () => {
    if (pending || composing.current || compositionGuard) return;
    setTemplate("uniform");
    setFixedRange(false);
    setCustomRhythms([]);
    setRatioIndex(1);
    setStart(window.start);
    setEnd(window.end);
    if (templateDots > 1) changeInputRhythmDraft(templateBase, 0);
  };
  const editorEvents: HTMLAttributes<HTMLElement> = {
    onCompositionStart: () => {
      composing.current = true;
      if (compositionTimer.current) clearTimeout(compositionTimer.current);
      setCompositionGuard(true);
    },
    onCompositionEnd: (e) => {
      composing.current = false;
      compositionEndedAt.current = e.timeStamp;
      compositionTimer.current = setTimeout(
        () => setCompositionGuard(false),
        50,
      );
    },
    onKeyDown: (e) => {
      const bodyInput = e.target === input.current || e.target === popoverInput.current;
      const applyKey = mode === "single"
        ? !e.shiftKey && !e.altKey
        : (e.ctrlKey || e.metaKey) && !e.altKey;
      if (e.key !== "Enter" || !bodyInput || !applyKey)
        return;
      e.stopPropagation();
      if (
        shouldIgnoreMusicTextKey(
          e.nativeEvent,
          composing.current,
          compositionEndedAt.current,
        )
      )
        return;
      e.preventDefault();
      if (!pending) void applyContent();
    },
    onFocusCapture: (e) => {
      // 用户已选中任一表单控件时，不再补做等待中的气泡聚焦。
      if (focusRequest) completedFocusRequest.current = focusRequest;
      const group = (e.target as HTMLElement).closest<HTMLElement>(
        "[data-numbered-group]",
      )?.dataset.numberedGroup;
      if (group === "content" || group === "rhythm" || group === "itemPitch") {
        activeGroup.current = group;
        setActionGroup(group);
      }
      if (
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLInputElement
      )
        onActivate(false);
    },
  };
  const renderInput = (compact: boolean, portal = false) => {
    const label = mode === "sequence" ? "音符内容" : "单音组简谱";
    const id = `editor-field-${label}${portal ? "-popover" : ""}`;
    const inputIssue = !inputIsEmpty ? groups.content.blockedReason ?? issue : null;
    return (
      <><Form.Item layout="vertical" label={label} htmlFor={id}
        validateStatus={inputIssue ? "error" : undefined}>
        {compact || mode === "single" ? (
          <Input
            id={id}
            ref={(control) => {
              (portal ? popoverInput : input).current = control?.input ?? null;
            }}
             aria-label={label}
             aria-invalid={!!inputIssue}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={mode === "single" ? "1+3+5" : "1 2 3；同时多音用 1+3+5"}
            title={mode === "single" ? "Enter 应用简谱内容" : "Ctrl/Cmd+Enter 应用简谱内容"}
          />
        ) : (
          <Input.TextArea
            id={id}
            ref={(control) => {
              (portal ? popoverInput : input).current =
                control?.resizableTextArea?.textArea ?? null;
            }}
            aria-label={label}
            aria-invalid={!!inputIssue}
            rows={2}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="1 2 3；同时多音用 1+3+5"
          />
        )}
      </Form.Item>
        {!compact && inputIssue && <p className={floatingStyles.actionReason} role="status">{inputIssue}</p>}
      </>
    );
  };
  const renderCompactRhythm = (visible: boolean) => (
    <div
      hidden={!visible}
      inert={!visible}
      className={floatingStyles.compactRhythm}
      data-numbered-group={event ? "rhythm" : undefined}
    >
      <div className={floatingStyles.compactRhythmRow}>
        <NumberedRhythmToolbar
          base={event ? base : templateBase}
          dots={event ? dots : templateDots}
          disabled={!!pending || compositionGuard || complexRhythm}
          onChange={event ? changeEventRhythmDraft : changeInputRhythmDraft}
        />
        {event && rhythmDirty && (
          <Button
            size="small"
            disabled={!canApplyByGroup.rhythm}
            title={groups.rhythm.blockedReason ?? "时值未应用"}
            onClick={() => applyGroup("rhythm")}
          >
            应用时值
          </Button>
        )}
      </div>
      {complexRhythm && (
        <p className={floatingStyles.compactNotice}>
          {template !== "uniform" || fixedRange
            ? "使用自定义节奏"
            : `${bases.find((item) => item.value === (event ? base : templateBase))?.label}${(event ? dots : templateDots) > 1 ? " · 双附点" : " · 连音节奏"}`}
          {" · "}
          <button
            type="button"
            onClick={() =>
              requestSidebar(
                template !== "uniform" || fixedRange
                  ? "content"
                  : event
                    ? "rhythm"
                    : "content",
              )
            }
          >
            侧栏编辑
          </button>
        </p>
      )}
    </div>
  );
  const renderCompactSummary = (visible: boolean) => (
    <div
      hidden={!visible}
      inert={!visible}
      className={floatingStyles.compactSummary}
      aria-label="简谱紧凑摘要"
      aria-live="polite"
    >
      <p>
        {inputIsEmpty
          ? `可用 ${beats(end - start)}`
          : plan?.ok && occupiedTicks !== null
            ? `${previewRows.filter((row) => !["remove", "release", "skip"].includes(row.status)).length} 个音符 · 占 ${beats(occupiedTicks)} · 可用 ${beats(end - start)}`
            : `可用 ${beats(end - start)} · 当前输入无法应用`}
      </p>
      {plan?.ok && confirmedOverwrites > 0 && (
        <p>
          将覆盖 {confirmedOverwrites} 处
          {overwrite ? "（已允许）" : "，前往侧栏确认"}
        </p>
      )}
      {unconfirmedOverwrites > 0 ? (
        <p role="status">将覆盖 {unconfirmedOverwrites} 处，前往侧栏确认</p>
      ) : (
        compactBlockedReason &&
        !inputIsEmpty && <p role="status">{compactBlockedReason}</p>
      )}
      {itemPitchDirty && (
        <p>
          另有音高修改 ·{" "}
          <button type="button" onClick={() => requestSidebar("itemPitch")}>
            侧栏处理
          </button>
        </p>
      )}
    </div>
  );
  const renderSummary = () => <div className={floatingStyles.summary} aria-label="简谱录入摘要" aria-live="polite">
    <p>可用 {beats(end - start)} · 输入 {occupiedTicks === null ? "待修正后计算" : beats(occupiedTicks)} · 覆盖 {plan?.ok ? confirmedOverwrites : "待校验"} 处</p>
    <p>第 {track!.measures.indexOf(measure!) + 1} 小节 · {formatNumberedBeatPosition(start, measure!.timeSignature.denominator)}～{formatNumberedBeatPosition(end, measure!.timeSignature.denominator)}</p>
    <p>{inputIsEmpty ? "尚未输入" : plan?.ok
      ? `将${event ? "处理" : "创建"} ${previewRows.filter((row) => !["remove", "release", "skip"].includes(row.status)).length} 个事件`
      : !parsed.ok ? "输入尚未完整，请修正后查看节拍映射" : "当前输入无法应用"}；应用后位置：{nextPosition}</p>
  </div>;
  const clipboard = getClipboard();
  const copyMeasure = track?.measures.find((item) => item.id === copySource.measureId);
  const pasteMeasure = track?.measures.find((item) => item.id === pasteTarget.measureId);
  const tickValue = (text: string, denominator?: number) => {
    if (!denominator || !text.trim() || !Number.isFinite(Number(text)) || Number(text) < 1) return null;
    const ticks = (Number(text) - 1) * 3840 / denominator;
    return Number.isSafeInteger(Math.round(ticks)) && Math.abs(ticks - Math.round(ticks)) < 0.000001 ? Math.round(ticks) : null;
  };
  const copyStart = tickValue(copySource.startBeat, copyMeasure?.timeSignature.denominator), copyEnd = tickValue(copySource.endBeat, copyMeasure?.timeSignature.denominator);
  const pasteStart = tickValue(pasteTarget.startBeat, pasteMeasure?.timeSignature.denominator);
  const pasteMeasureId = pasteMeasure?.id;
  const copyIssue = !copyMeasure || copyStart === null || copyEnd === null || copyStart >= copyEnd || copyEnd > copyMeasure.timeSignature.numerator * 3840 / copyMeasure.timeSignature.denominator
    ? "请选择小节内有效的源范围，终点须晚于起点。" : null;
  const pastePlans = (["overwrite", "insert"] as const).map((pasteMode) => {
    const op: ILXMNumberedVoiceCommand | null = clipboard && pasteMeasureId && pasteStart !== null && track ? {
      type: "numbered.range.paste", trackId: track.id, measureId: pasteMeasureId,
      startTick: pasteStart, mode: pasteMode, allowOverwrite: pasteOverwrite, clipboard,
    } : null;
    const candidate = op && track ? editNumberedTrack(structuredClone(track), op, createDocumentIdFactory(structuredClone(document)), true) : null;
    const reason = !clipboard ? "请先复制简谱范围" : !candidate ? "请填写有效的粘贴目标。"
      : !candidate.ok ? candidate.message : checkNumberedDraftDependencies(structuredClone({
        contentDirty, rhythmDirty, itemPitchDirty, track, measureId: measure?.id, event, raw, itemId,
      }), candidate, "content", false);
    return { pasteMode, op, candidate, reason };
  });
  const measureOptions = track?.measures.map((item, index) => ({ value: item.id, label: `第 ${index + 1} 小节` })) ?? [];
  const tickHint = (denominator: number | undefined, beat: string) => denominator && tickValue(beat, denominator) !== null
    ? formatNumberedBeatPosition(tickValue(beat, denominator)!, denominator) : "请填写有效拍位，例如 1 或 1.5";
  const marksMaintenance = track?.numberedMarks.filter((mark) => mark.id === selectedMarkId || (event && (mark.type === "tie"
    ? event.items.some((item) => item.id === mark.fromItemId || item.id === mark.toItemId)
    : mark.type === "slur" ? mark.fromEventId === event.id || mark.toEventId === event.id : mark.eventId === event.id)));
  const actions = (compact: boolean) => <NumberedActions compact={compact} mode={mode} group={compact ? "content" : actionGroup}
    groups={groups} dirtyGroups={dirtyGroups} disabled={!!pending || compositionGuard}
    onRestore={restoreGroup} onApply={applyGroup} onFocus={focusGroup} />;
  const editor = (
    <section
      ref={root}
      className={`${styles.sidebarSection} ${floatingStyles.editor} ${compact ? floatingStyles.compact : ""}`}
      data-presentation={presentation}
      {...editorEvents}
    >
      <fieldset
        disabled={!!pending}
        inert={!!pending}
        className={styles.propertyFieldset}
      >
        <div data-numbered-group="content">
          <div
            className={floatingStyles.modeRow}
            hidden={compact}
            inert={compact}
          >
            <span>录入方式</span>
            <Segmented size="small" id="editor-field-简谱录入方式" aria-label="简谱录入方式"
              value={mode} onChange={(value) => onModeChange(value as typeof mode)}
              options={[{ value: "single", label: "单音组编辑" }, { value: "sequence", label: "连续录入" }]} />
          </div>
          {targetInvalid ? (
            <>
              <p role="status">{originalPosition}已失效，输入已保留。请重新选择有效的简谱位置。</p>
              {renderInput(compact)}
            </>
          ) : (
            <>
              {renderInput(compact)}
              <p
                className={floatingStyles.inputHint}
                hidden={compact}
                inert={compact}
              >
                空格分先后音，+ 表示同时发音；高音用 &apos;，低音用 .，还原号用 n。
                {mode === "single" ? " Enter 应用简谱内容。" : " Ctrl/Cmd+Enter 应用简谱内容。"}
              </p>
              {!compact && !targetInvalid && conflicts.content !== contentFingerprint && (plan?.ok || overwritePreview?.ok) && (
                <BeatMappingPreview
                  rows={numberedPreviewMapping(plan?.ok ? previewRows : overwritePreview?.ok && operation ? buildNumberedPreviewRows(track, overwritePreview, operation) : [])}
                  measures={track.measures.map((item, index) => ({ key: item.id, label: `第 ${index + 1} 小节`, durationTicks: item.timeSignature.numerator * 3840 / item.timeSignature.denominator, beatTicks: 3840 / item.timeSignature.denominator }))}
                  onInspect={onInspectPosition}
                  notice={overwritePreview?.ok && !plan?.ok ? "待允许覆盖；当前不可应用" : undefined}
                />
              )}
              {!compact && renderSummary()}
              {(!popoverContainer || compact) && renderCompactRhythm(compact)}
              <details ref={rhythmDetails} data-numbered-group={!event ? "rhythm" : undefined} className={floatingStyles.taskGroup} hidden={compact} inert={compact}>
                <summary>节奏与范围 <span>{bases.find((item) => item.value === (event ? base : templateBase))?.label} · {beats(end - start)}{rhythmDirty ? " · 时值未应用" : ""}</span></summary>
              <div
                className={styles.propertyGrid}
                hidden={compact}
                inert={compact}
              >
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
                      if (value !== "uniform") {
                        setFixedRange(true);
                        setEnd(start + 960);
                      }
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
              </div>
              {event && (
                <div
                  data-numbered-group="rhythm"
                  hidden={compact}
                  inert={compact}
                >
                  <div className={styles.propertyGrid}>
                    <Form.Item
                      label="当前事件时值"
                      layout="vertical"
                      htmlFor="numbered-event-base"
                    >
                      <Select
                        id="numbered-event-base"
                        aria-label="简谱时值"
                        value={base}
                        onChange={(value) =>
                          changeEventRhythmDraft(value, dots)
                        }
                        options={bases}
                      />
                    </Form.Item>
                    <Form.Item
                      label="事件附点"
                      layout="vertical"
                      htmlFor="numbered-event-dots"
                    >
                      <Select
                        id="numbered-event-dots"
                        aria-label="简谱时值附点"
                        value={dots}
                        onChange={(value) =>
                          changeEventRhythmDraft(base, value)
                        }
                        options={[
                          { value: 0, label: "无" },
                          { value: 1, label: "单附点" },
                          { value: 2, label: "双附点" },
                        ]}
                      />
                    </Form.Item>
                  </div>
                  <p className={rhythmDirty ? floatingStyles.dirty : floatingStyles.inputHint}>
                    {rhythmDirty
                      ? "时值组有未应用修改"
                      : "时值单独应用，正文应用保留当前时值"}
                  </p>
                  {rhythmDirty && rhythmPlan?.ok && conflicts.rhythm !== JSON.stringify({ base, dots }) && (
                    <BeatMappingPreview
                      label="简谱时值修改预览"
                      rows={numberedPreviewMapping(rhythmPreviewRows)}
                      measures={track.measures.map((item, index) => ({ key: item.id, label: `第 ${index + 1} 小节`, durationTicks: item.timeSignature.numerator * 3840 / item.timeSignature.denominator, beatTicks: 3840 / item.timeSignature.denominator }))}
                      onInspect={onInspectPosition}
                      notice={`移动 ${rhythmPlan.movedEventIds.length} 个后续事件，缩短 ${rhythmPlan.resizedEventIds.length} 个后续事件；${rhythmPlan.movedEventIds.length || rhythmPlan.resizedEventIds.length ? "应用前需确认" : "独立应用当前事件时值"}`}
                    />
                  )}
                  <div className={floatingStyles.inlineActions}>
                    <Button disabled={!groups.rhythm.canApply || compositionGuard || !!pending} onClick={() => void applyGroup("rhythm")}>应用时值</Button>
                    {rhythmDirty && <Button type="text" disabled={compositionGuard || !!pending} onClick={() => restoreGroup("rhythm")}>恢复时值</Button>}
                  </div>
                  {rhythmDirty && groups.rhythm.blockedReason && <p role="status" className={floatingStyles.actionReason}>{groups.rhythm.blockedReason}</p>}
                  <details className={floatingStyles.secondaryGroup}>
                    <summary>拆分与合并 <span>持续音与连音组</span></summary>
                  <Button onClick={() => submit({
                    type: "numbered.event.split", trackId: track.id,
                    measureId: measure.id, eventId: event.id,
                  })}>等分持续音</Button>
                  <Form.Item layout="vertical" label="合并终点" htmlFor="editor-field-简谱合并终点">
                    <Select id="editor-field-简谱合并终点" aria-label="简谱合并终点" value={mergeEndId || undefined}
                      placeholder="选择当前事件之后的终点" onChange={setMergeEndId}
                      options={measure.numberedVoice.events.slice(measure.numberedVoice.events.indexOf(event) + 1).map((item) => ({
                        value: item.id,
                        label: `${formatNumberedBeatPosition(item.tick, measure.timeSignature.denominator)} · ${item.items.map((note) => note.token).join("+") || "空白"}`,
                      }))} />
                  </Form.Item>
                  <Button disabled={!mergeEndId || !measure.numberedVoice.events.some((item) => item.id === mergeEndId)} onClick={() => {
                    const from = measure.numberedVoice.events.indexOf(event);
                    const to = measure.numberedVoice.events.findIndex((item) => item.id === mergeEndId);
                    void submit({ type: "numbered.event.merge", trackId: track.id, measureId: measure.id,
                      eventIds: to > from ? measure.numberedVoice.events.slice(from, to + 1).map((item) => item.id) : [],
                    });
                  }}>合并至终点</Button>
                  {measure.numberedVoice.tuplets.filter((group) => group.eventIds.includes(event.id)).map((group) => <Button key={group.id}
                    onClick={() => submit({ type: "numbered.tuplet.remove", trackId: track.id, measureId: measure.id, tupletId: group.id })}>
                    移除简谱连音组（{group.ratio.actual}:{group.ratio.normal} · {group.eventIds.length} 个成员）
                  </Button>)}
                  </details>
                </div>
              )}
              {(!event || fixedRange || template !== "uniform") && (
                <div
                  className={styles.propertyGrid}
                  hidden={compact}
                  inert={compact}
                >
                  <Form.Item
                    layout="vertical"
                    label={event ? "替换成员时值" : "新录入时值"}
                    htmlFor="editor-field-模板成员时值"
                  >
                    <Select
                      id="editor-field-模板成员时值"
                      aria-label="模板成员时值"
                      value={templateBase}
                      onChange={(value) => {
                        changeInputRhythmDraft(value, templateDots);
                      }}
                      options={bases}
                    />
                  </Form.Item>
                  <Form.Item
                    layout="vertical"
                    label="时值附点"
                    htmlFor="editor-field-模板成员附点"
                  >
                    <Select
                      id="editor-field-模板成员附点"
                      aria-label="模板成员附点"
                      value={templateDots}
                      onChange={(value) => {
                        changeInputRhythmDraft(templateBase, value);
                      }}
                      options={[
                        { value: 0, label: "无" },
                        { value: 1, label: "单附点" },
                        { value: 2, label: "双附点" },
                      ]}
                    />
                  </Form.Item>
                </div>
              )}
              {(!popoverContainer || compact) && renderCompactSummary(compact)}
              <details
                ref={rangeDetails}
                className={styles.numberedAdvanced}
                hidden={compact}
                inert={compact}
              >
                <summary>
                  高级录入范围与复杂节奏
                  {contentDirty ? " · 正文有未应用修改" : ""}
                </summary>
                <Form.Item layout="vertical" label="当前简谱事件" htmlFor="editor-field-当前简谱事件">
                  <Select id="editor-field-当前简谱事件" aria-label="当前简谱事件" value={selectedId}
                    onChange={(value) => {
                      const next = measure.numberedVoice.events.find((item) => item.id === value);
                      (onRequestTarget ?? onSelectTarget)(next ? {
                        kind: "numbered", trackId: track.id, measureId: measure.id,
                        eventId: next.id, itemId: next.items[0]?.id,
                      } : { kind: "numbered", trackId: track.id, measureId: measure.id, tick: start, endTick: end });
                    }}
                    options={[{ value: "", label: "新增时间范围" }, ...measure.numberedVoice.events.map((item) => ({
                      value: item.id,
                      label: `${formatNumberedBeatPosition(item.tick, measure.timeSignature.denominator)} · ${item.items.map((note) => note.token).join("+") || "未录入"}`,
                    }))]} />
                </Form.Item>
                <Button onClick={restoreUniform}>恢复均分</Button>
                <div className={styles.propertyGrid}>
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
                        layout="vertical"
                        label={<>第{i + 1}音时值</>}
                        htmlFor={"editor-field-" + `简谱第${i + 1}音时值`}
                      >
                        <Select
                          id={"editor-field-" + `简谱第${i + 1}音时值`}
                          aria-label={`简谱第${i + 1}音时值`}
                          value={customRhythms[i]?.base ?? templateBase}
                          onChange={(value) =>
                            setCustomRhythms(
                              parsed.items.map((_, j) =>
                                j === i
                                  ? {
                                      base: value as ILXMRhythmBase,
                                      dots: customRhythms[i]?.dots ?? 0,
                                    }
                                  : (customRhythms[j] ?? {
                                      base: templateBase,
                                      dots: templateDots,
                                    }),
                              ),
                            )
                          }
                          style={{ width: "100%" }}
                          options={[
                            ...bases.map((b) => ({
                              value: b.value,
                              label: b.label,
                            })),
                          ]}
                        />
                        <Select
                          aria-label={`简谱第${i + 1}音附点`}
                          value={customRhythms[i]?.dots ?? templateDots}
                          onChange={(value) =>
                            setCustomRhythms(
                              parsed.items.map((_, j) =>
                                j === i
                                  ? {
                                      base:
                                        customRhythms[i]?.base ?? templateBase,
                                      dots: Number(value),
                                    }
                                  : (customRhythms[j] ?? {
                                      base: templateBase,
                                      dots: templateDots,
                                    }),
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
                        setFixedRange(true);
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
                        setFixedRange(true);
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
                {template === "uniform" && (
                  <Checkbox
                    checked={fixedRange}
                    onChange={(e) => setFixedRange(e.target.checked)}
                  >
                    固定范围替换（高级）
                  </Checkbox>
                )}
                {(fixedRange ||
                  template !== "uniform" ||
                  operation?.type === "numbered.sequence.set") && (
                  <Checkbox
                    checked={overwrite}
                    onChange={(e) => setOverwrite(e.target.checked)}
                  >
                    允许覆盖此时间范围的简谱
                  </Checkbox>
                )}
              </details>
              </details>
              <details
                className={floatingStyles.taskGroup}
                hidden={compact}
                inert={compact}
              >
                <summary>
                  音高与连接 <span>{itemPitchDirty ? "单音符音高未应用" : "升降、八度、延音线"}</span>
                </summary>
                {event && (
                  <div>
                    <div data-numbered-group="itemPitch">
                      <div className={styles.propertyGrid}>
                      <Form.Item
                        layout="vertical"
                        label="选择音符"
                        htmlFor={"editor-field-" + "简谱技巧起始音符"}
                      >
                        <Select
                          id={"editor-field-" + "简谱技巧起始音符"}
                          aria-label="简谱技巧起始音符"
                          value={itemId}
                          onChange={(value) => (onRequestTarget ?? onSelectTarget)({
                            kind: "numbered", trackId: track.id, measureId: measure.id,
                            eventId: event.id, itemId: value,
                          })}
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
                        <NumberedPitchFields value={itemDraft} onChange={setItemDraft} />
                      )}
                      </div>
                      {event.kind === "notes" && <>
                        <div className={floatingStyles.inlineActions}>
                          <Button disabled={!groups.itemPitch.canApply || compositionGuard || !!pending} onClick={() => void applyGroup("itemPitch")}>应用单个音高</Button>
                          {itemPitchDirty && <Button type="text" disabled={compositionGuard || !!pending} onClick={() => restoreGroup("itemPitch")}>恢复音高</Button>}
                        </div>
                        <p className={floatingStyles.inputHint} role={itemPitchDirty && groups.itemPitch.blockedReason ? "status" : undefined}>
                          {itemPitchDirty && groups.itemPitch.blockedReason ? groups.itemPitch.blockedReason : "单个音高独立应用。正文有修改时，请先处理正文。"}
                        </p>
                      </>}
                    </div>
                    <div className={floatingStyles.connectionFields}>
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
                    <div className={floatingStyles.compactActions}>
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
                    </div>
                    </div>
                  </div>
                )}
                    <details className={floatingStyles.secondaryGroup} open={!!selectedMarkId}>
                      <summary>更多记号设置 <span>延长记号与现有连接</span></summary>
                    {event && <Button
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
                    </Button>}
                <p className={floatingStyles.inputHint}>延音线连接两个音符成员；连音线连接两个事件。更新端点使用上方起点与终点。</p>
                {marksMaintenance?.map((mark) => <div key={mark.id} className={floatingStyles.summary}>
                  <p>{mark.id === selectedMarkId ? "当前选中：" : ""}{mark.type === "tie" ? "延音线" : mark.type === "slur" ? "连音线" : "延长记号"}</p>
                  <div className={styles.sidebarActions}>
                    <Button disabled={!event || (mark.type !== "fermata" && !destination) || (mark.type === "tie" && !itemId)} onClick={() => {
                      if (!event) return;
                      const to = markTargets.find(({ e }) => e.items.some((item) => item.id === destination));
                      const nextMark = mark.type === "fermata" ? { type: "fermata" as const, eventId: event.id }
                        : mark.type === "tie" ? { type: "tie" as const, fromItemId: itemId, toItemId: destination }
                        : to ? { type: "slur" as const, fromEventId: event.id, toEventId: to.e.id } : null;
                      if (nextMark) void submit({ type: "numbered.mark.update", trackId: track.id, markId: mark.id, mark: nextMark });
                    }}>更新记号端点</Button>
                    <Button onClick={() => submit({ type: "numbered.mark.remove", trackId: track.id, markId: mark.id })}>删除记号</Button>
                  </div>
                </div>)}
                    </details>
                {!event && <p className={floatingStyles.inputHint}>先在谱面选择一个已应用的简谱音符，再编辑音高与连接。</p>}
              </details>
              <details className={floatingStyles.taskGroup} hidden={compact} inert={compact}>
                <summary>复制与粘贴 <span>按简谱范围复用</span></summary>
                <p className={floatingStyles.inputHint}>复制读取已应用的简谱与歌词。拍位从 1 开始，1.5 表示第一拍后半；源终点不含在范围内。</p>
                <Form.Item layout="vertical" label="源小节" htmlFor="editor-field-简谱复制小节">
                  <Select id="editor-field-简谱复制小节" aria-label="简谱复制小节" value={copySource.measureId}
                    options={measureOptions} onChange={(measureId) => setCopySource({ ...copySource, measureId })} />
                </Form.Item>
                <div className={styles.propertyGrid}>
                  <Form.Item layout="vertical" label="源起点（第几拍）" htmlFor="editor-field-简谱复制起点" extra={tickHint(copyMeasure?.timeSignature.denominator, copySource.startBeat)}>
                    <Input id="editor-field-简谱复制起点" aria-label="简谱复制起点" type="number" min={1} step="any"
                      value={copySource.startBeat} onChange={(e) => setCopySource({ ...copySource, startBeat: e.target.value })} />
                  </Form.Item>
                  <Form.Item layout="vertical" label="源终点（第几拍）" htmlFor="editor-field-简谱复制终点" extra={tickHint(copyMeasure?.timeSignature.denominator, copySource.endBeat)}>
                    <Input id="editor-field-简谱复制终点" aria-label="简谱复制终点" type="number" min={1} step="any"
                      value={copySource.endBeat} onChange={(e) => setCopySource({ ...copySource, endBeat: e.target.value })} />
                  </Form.Item>
                </div>
                {(copyIssue || dirty) && <p role="status" className={floatingStyles.actionReason}>{dirty ? "请先应用或恢复未应用分组；复制读取已应用谱面。" : copyIssue}</p>}
                <div className={styles.sidebarActions}>
                  <Button
                    disabled={dirty || !!copyIssue || compositionGuard}
                    title={dirty ? "请先应用或恢复未应用分组，复制读取已应用谱面。" : "复制已应用谱面范围"}
                    onClick={() => {
                      if (composing.current || compositionGuard || pending || submissionRef.current?.isBusy() || dirty || copyIssue || copyStart === null || copyEnd === null) return;
                      if (
                        copyRange({
                          trackId: track.id,
                          measureId: copySource.measureId,
                          startTick: copyStart,
                          endTick: copyEnd,
                        })
                      ) {
                        const copied = getClipboard();
                        if (copied) {
                          setCopiedRange({ clipboard: copied, label: `第 ${track.measures.indexOf(copyMeasure!) + 1} 小节 · ${tickHint(copyMeasure?.timeSignature.denominator, copySource.startBeat)}～${tickHint(copyMeasure?.timeSignature.denominator, copySource.endBeat)}` });
                          setMessage(`已复制简谱范围，${copied.omissions.length} 个跨范围连接未复制`);
                        }
                      }
                    }}
                  >
                    复制简谱范围
                  </Button>
                </div>
                <div className={floatingStyles.summary} aria-label="简谱剪贴板摘要" aria-live="polite">
                  {clipboard ? <>
                    {copiedRange && JSON.stringify(copiedRange.clipboard) === JSON.stringify(clipboard) && <p>已复制：{copiedRange.label}</p>}
                    <p>{clipboard.voice.events.length} 个事件 · {clipboard.totalTicks / 960} 个四分拍 · {clipboard.lyrics.length} 条歌词 · {clipboard.marks.length} 个记号</p>
                    <p>{clipboard.omissions.length} 个跨范围连接未复制</p>
                  </> : <p>请先复制简谱范围</p>}
                </div>
                <Form.Item layout="vertical" label="粘贴目标小节" htmlFor="editor-field-简谱粘贴小节">
                  <Select id="editor-field-简谱粘贴小节" aria-label="简谱粘贴小节" value={pasteTarget.measureId}
                    options={measureOptions} onChange={(measureId) => setPasteTarget({ ...pasteTarget, measureId })} />
                </Form.Item>
                <Form.Item layout="vertical" label="粘贴起点（第几拍）" htmlFor="editor-field-简谱粘贴起点" extra={tickHint(pasteMeasure?.timeSignature.denominator, pasteTarget.startBeat)}>
                  <Input id="editor-field-简谱粘贴起点" aria-label="简谱粘贴起点" type="number" min={1} step="any"
                    value={pasteTarget.startBeat} onChange={(e) => setPasteTarget({ ...pasteTarget, startBeat: e.target.value })} />
                </Form.Item>
                <Checkbox checked={pasteOverwrite} onChange={(e) => setPasteOverwrite(e.target.checked)}>允许覆盖目标范围已有简谱</Checkbox>
                {pastePlans.map(({ pasteMode, op, candidate, reason }) => <div key={pasteMode} className={floatingStyles.summary}>
                  <p>{pasteMode === "insert" ? "插入粘贴" : "覆盖粘贴"}：{reason ?? (candidate?.ok
                    ? `覆盖 ${candidate.overwrittenEventIds.length} 个事件 · 移动 ${candidate.movedEventIds.length} 个事件 · 缩短 ${candidate.resizedEventIds.length} 个事件 · 移除 ${candidate.removedMarkIds.length} 个记号 · 更新 ${candidate.changedMarkIds.length} 个记号`
                    : "请先复制简谱范围")}</p>
                  <Button disabled={!!reason || compositionGuard || !op} onClick={() => op && submit(structuredClone(op))}>
                    {pasteMode === "insert" ? "插入粘贴" : "覆盖粘贴"}
                  </Button>
                </div>)}
              </details>
              <details className={floatingStyles.taskGroup} hidden={compact} inert={compact}>
                <summary>移除当前事件 <span>同时移除附着歌词</span></summary>
                <p className={floatingStyles.inputHint}>普通事件删除后，其全部歌词也会删除；连音成员清空时保留时值与歌词。</p>
                <Button type="text" className={floatingStyles.dangerAction} danger disabled={!event} onClick={() => event && submit({
                  type: "numbered.event.remove", trackId: track.id, measureId: measure.id, eventId: event.id,
                })}>{event && measure.numberedVoice.tuplets.some((group) => group.eventIds.includes(event.id))
                  ? "清空连音成员，保留时值与歌词" : "删除音符及其全部歌词"}</Button>
              </details>
            </>
          )}
        </div>
      </fieldset>
      {compact ? actions(true) : actionsHost ? createPortal(actions(false), actionsHost) : actions(false)}
      <dialog
        ref={impactDialog}
        aria-label="确认简谱修改影响"
        onCancel={(event) => {
          event.preventDefault();
          submissionRef.current?.cancel();
        }}
        onKeyDown={(event) => {
          // 原生 dialog 独立处理键盘，不能让底层草稿保护区截获 Esc。
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            submissionRef.current?.cancel();
            return;
          }
          if (event.key !== "Tab") return;
          const buttons = Array.from(
            impactDialog.current?.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ) ?? [],
          );
          const first = buttons[0],
            last = buttons.at(-1);
          if (event.shiftKey && globalThis.document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (
            !event.shiftKey &&
            globalThis.document.activeElement === last
          ) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        {pending && (
          <>
            <h3>确认简谱修改影响</h3>
            {(pending.movedEventIds.length > 0 ||
              pending.resizedEventIds.length > 0) && (
              <>
                <p>
                  将移动 {pending.movedEventIds.length} 个后续事件，缩短{" "}
                  {pending.resizedEventIds.length} 个后续事件，保留其音符内容。
                </p>
                <ul aria-label="后续事件调整">
                  {[
                    ...new Set([
                      ...pending.movedEventIds,
                      ...pending.resizedEventIds,
                    ]),
                  ].map((id) => {
                    const beforeMeasure = track?.measures.find((m) =>
                      m.numberedVoice.events.some((e) => e.id === id),
                    );
                    const before = beforeMeasure?.numberedVoice.events.find(
                      (e) => e.id === id,
                    );
                    const after = pending.track.measures
                      .flatMap((m) => m.numberedVoice.events)
                      .find((e) => e.id === id);
                    if (!before || !after || !beforeMeasure) return null;
                    const describe = (e: typeof before) =>
                      `${formatNumberedBeatPosition(e.tick, beforeMeasure.timeSignature.denominator)} · ${bases.find((b) => b.value === e.rhythm.base)?.label}${e.rhythm.dots ? ` · ${e.rhythm.dots} 附点` : ""}`;
                    return (
                      <li key={id}>
                        {before.items.map((i) => i.token).join("+") || "空白"}：
                        {describe(before)} → {describe(after)}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            <p>
              将删除 {pending.removedMarkIds.length} 个记号，迁移{" "}
              {pending.changedMarkIds.length} 个记号。此操作与内容修改一起撤销。
            </p>
            <Button onClick={() => submissionRef.current?.cancel()}>
              取消
            </Button>
            <Button
              type="primary"
              onClick={() => submissionRef.current?.confirm()}
            >
              确认修改
            </Button>
          </>
        )}
      </dialog>
      {message && <p role="status">{message}</p>}
    </section>
  );
  return (
    <>
      {editor}
      {popoverContainer &&
        !compact &&
        createPortal(
          <section
            className={`${styles.sidebarSection} ${floatingStyles.editor} ${floatingStyles.compact}`}
            data-presentation="popover"
            {...editorEvents}
          >
            <fieldset
              disabled={!!pending}
              inert={!!pending}
              className={styles.propertyFieldset}
            >
              <div data-numbered-group="content">
                {targetInvalid ? (
                  <><p role="status">{originalPosition}已失效，输入已保留。</p>{renderInput(true, true)}</>
                ) : (
                  <>
                    {renderInput(true, true)}
                    {renderCompactRhythm(true)}
                    {renderCompactSummary(true)}
                  </>
                )}
              </div>
            </fieldset>
            {actions(true)}
            {message && <p role="status">{message}</p>}
          </section>,
          popoverContainer,
        )}
    </>
  );
};
