"use client";
import { Button, Form, Input, Modal, Tooltip } from "antd";
import { ShortcutHint, ShortcutTooltip } from "../session/EditorShortcutReference";

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
  getMeasureDurationTicks,
  NUMBERED_CONTINUATION_RHYTHM_REASON,
  numberedContinuationRhythm,
  numberedRhythmForTicks,
  planNumberedInputRanges,
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
import type { MusicTextTarget } from "../music-text/music-text-draft";
import {
  resolveNumberedEditorTarget,
  numberedTargetWindow,
  formatNumberedBeatPosition,
  numberedTargetKey,
} from "./numbered-editor-target";
import editorFormStyles from "../shared/editor-form.module.scss";
import {
  buildNumberedPreviewRows,
  numberedRhythmMergeMessage,
  numberedPreviewMapping,
  type NumberedPreviewRow,
} from "./numbered-preview";
import { numberedContentDependency, numberedSequenceRangeText } from "./numbered-draft-dependencies";
import {
  useEditorSessionStore,
  useEditorStore,
} from "../../../stores/editor-store";
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
import { resolveNumberedInputDefault, numberedInputRhythmForWindow, numberedInputRhythmFromTab } from "../tools/editor-rhythm-target";
import { shouldIgnoreMusicTextKey } from "../music-text/music-text-interaction";
import floatingStyles from "./NumberedEditor.module.scss";
import { NumberedRhythmToolbar } from "./NumberedRhythmToolbar";
import { numberedRhythmIssue } from "./numbered-rhythm-issue";
import { NumberedPitchFields } from "./NumberedPitchFields";
import { BeatMappingPreview, type BeatMappingPosition } from "../music-text/BeatMappingPreview";
import { EditorModalGuard } from "../session/EditorModalGuard";
import { TextApplyAdvanceCheckbox, type TextApplyAdvanceSetting } from "../music-text/TextApplyAdvanceCheckbox";
import { nextNumberedTextInput } from "../music-text/text-apply-advance";

type NumberedInputSurface = "sidebar" | "popover";
type NumberedPrimaryApply = { surface: NumberedInputSurface; advance: boolean };

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
  inputRhythmExplicit?: boolean;
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
  contentOperation?: ILXMNumberedVoiceCommand | null;
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
      state.contentOperation,
    ) !==
      numberedContentDependency(
        candidate.track,
        state.measureId,
        old?.id,
        state.raw,
        state.contentOperation,
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
  ) => Promise<NumberedPropertyApplyResult>;
  applyContent: (
    isCurrent?: () => boolean,
    surface?: NumberedInputSurface,
  ) => Promise<NumberedPropertyApplyResult>;
  applyGroup: (
    group: NumberedDraftGroup,
    isCurrent?: () => boolean,
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
  inputRhythmExplicit?: boolean;
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
  mode,
  selectedMarkId,
  onSelectTarget,
  onBusyChange,
  onGroupsChange,
  presentation = "sidebar",
  popoverContainer = null,
  onRequestSidebar,
  onInspectPosition,
  textAdvance,
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
  onSelectTarget: (target: MusicTextTarget, surface: NumberedInputSurface) => void;
  textAdvance?: TextApplyAdvanceSetting;
}) => {
  const compact = presentation === "popover";
  const editorStore = useEditorSessionStore();
  const preference = useEditorStore((state) => state.numberedInputRhythm);
  const preferenceExplicit = useEditorStore(
    (state) => state.numberedInputRhythmExplicit,
  );
  const numberedAutoAdvance = useEditorStore((state) => state.numberedAutoAdvance);
  const preferenceTarget = useEditorStore((state) => state.numberedInputRhythmTarget);
  const targetInputKey = JSON.stringify(target);
  // 核心可能在正文成功后重建成员 ID；仅本 owner 的真实成功结果可重绑当前事件。
  const [submittedTarget, setSubmittedTarget] = useState<{
    inputKey: string;
    target: MusicTextTarget;
  } | null>(null);
  const resolved = useMemo(() => {
    const submitted = submittedTarget?.inputKey === targetInputKey ? submittedTarget.target : null;
    const original = resolveNumberedEditorTarget(document, target);
    // 多音转为延音时临时绑定横线成员。撤销恢复原来的成员后，优先使用谱面明确选中的音高。
    if (target && "itemId" in target && target.itemId && original?.kind === "numberedEvent" &&
      submitted?.eventId === original.eventId) return original;
    const rebound = submitted ? resolveNumberedEditorTarget(document, submitted) : null;
    if (rebound) return rebound;
    if (original) return original;
    // Undo may restore an event's old members. Recover only that same surviving
    // event; an actually removed event must remain invalid and cannot be edited.
    return submitted?.eventId
      ? resolveNumberedEditorTarget(document, { ...submitted, itemId: undefined })
      : null;
  }, [document, target, submittedTarget, targetInputKey]);
  const track = document.score.tracks.find((t) => t.id === resolved?.trackId);
  const measure = track?.measures.find((m) => m.id === resolved?.measureId);
  const targetEvent =
    resolved?.kind === "numberedEvent"
      ? measure?.numberedVoice.events.find((e) => e.id === resolved.eventId)
      // 精确命中已有 gap 的时间窗口按原事件编辑，继承已保存的模板时值和歌词引用；
      // 更大的时间范围仍走原来的范围替换流程，保留用户显式调整范围的能力。
      : resolved?.kind === "numberedTime"
        ? measure?.numberedVoice.events.find((event) => {
            if (event.kind !== "gap" || event.tick !== resolved.tick) return false;
            const duration = createNumberedRhythmContext(measure.numberedVoice).getEventDurationTicks(event);
            return duration.ok && event.tick + duration.ticks === resolved.endTick;
          })
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
        getMeasureDurationTicks(measure!))
      : 0;
  // 从 TAB 选区进入连续简谱时回填其中已有事件，保留各事件原时值。
  const selectedEvents = firstBeat
    ? (measure?.numberedVoice.events.filter(
        (event) => event.tick >= firstBeat.tick && event.tick < selectedEnd,
      ) ?? [])
    : targetEvent
      ? [targetEvent]
      : [];
  const firstEvent = firstBeat ? selectedEvents.find(event => event.tick === firstBeat.tick) ?? (targetEvent && targetEvent.tick <= firstBeat.tick ? targetEvent : undefined) : targetEvent;
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
      : firstBeat
        ? { start: firstBeat.tick, end: selectedEnd }
      : resolved
        ? numberedTargetWindow(document, resolved)
        : { start: 0, end: measure ? Math.min(960, getMeasureDurationTicks(measure)) : 0 };
  const [start, setStart] = useState(window.start),
    [end, setEnd] = useState(window.end);
  const [fixedRange, setFixedRange] = useState(false);
  const value =
    mode === "single"
      ? (firstEvent?.items.map((i) => i.token).join("+") ?? "")
      : firstBeat && measure
        ? numberedSequenceRangeText(measure, Math.min(firstBeat.tick, firstEvent?.tick ?? Infinity), selectedEnd)
        : firstEvent?.items.map(item => item.token).join("+") ?? "";
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
     );
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<NumberedImpact | null>(null);
  const [nextTarget, setNextTarget] = useState<{ target: MusicTextTarget; surface: NumberedInputSurface } | null>(null);
  const input = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const popoverInput = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const root = useRef<HTMLElement>(null);
  const activeGroup = useRef<NumberedDraftGroup>("content");
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
  const parsed = useMemo(() => parseNumberedSequence(raw), [raw]);
  // 两种录入模式留空均清除当前事件内容，保留其时值与歌词锚点。
  const clearSingleEvent =
    !raw.trim() &&
    !!event &&
    template === "uniform" &&
    !fixedRange;
  // 附点互补后常留下比上次录入时值更窄的空格；当前格的安全默认值和顶部工具栏统一。
  // 真实事件（包括持久空格）继续使用自身身份和已保存时值。
  const windowTicks = window.end - window.start;
  const inputDefault = !event ? resolveNumberedInputDefault(measure, resolved, preference, preferenceExplicit,
    numberedAutoAdvance, preferenceTarget) : undefined;
  const targetInputRhythm = inputDefault?.rhythm;
  const defaultInputRhythm = targetInputRhythm ?? numberedInputRhythmForWindow(
    preference,
    preferenceExplicit,
    windowTicks,
    !event ? numberedInputRhythmFromTab(measure, window.start, windowTicks) : undefined,
  );
  const [templateBase, setTemplateBase] = useState<ILXMRhythmBase>(defaultInputRhythm.base);
  const [templateDots, setTemplateDots] = useState(defaultInputRhythm.dots);
  // 目标格仅提供默认时值。连续录入没有显式改时值时逐格沿用各自节奏，不能把首格时值套给整批。
  const [inputRhythmExplicit, setInputRhythmExplicit] = useState(!event && preferenceExplicit && !targetInputRhythm);
  const complexRhythm =
    template !== "uniform" ||
    fixedRange ||
    (event ? dots : templateDots) > 1 ||
    !!(
      event &&
      measure?.numberedVoice.tuplets.some((g) => g.eventIds.includes(event.id))
    );
  // 创建模板与已有事件时值分别保存；停用的比例/成员参数只作为录入偏好。
  const contentValue = useCallback(
    (
      text: string,
      config: Omit<NumberedContentBaseline, "raw" | "selectedId"> = {
        template,
        start,
        end,
        overwrite,
        templateBase,
        templateDots,
        customRhythms,
        ratioIndex,
        fixedRange,
        inputRhythmExplicit,
      },
    ) =>
      JSON.stringify({
        raw: text,
        template: config.template,
        fixedRange: config.fixedRange,
        inputRhythmExplicit: !!config.inputRhythmExplicit,
        ...(config.template === "uniform" && !config.fixedRange && !config.inputRhythmExplicit
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
      inputRhythmExplicit,
    ],
  );
  const [contentBaseline, setContentBaseline] = useState(() =>
    contentValue(initial),
  );
  const contentBaselineValue = useRef<NumberedContentBaseline>({
    raw: initial, selectedId, template, start, end, overwrite,
    templateBase, templateDots, customRhythms: structuredClone(customRhythms),
    ratioIndex, fixedRange, inputRhythmExplicit,
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
    const singleItem = parsed.items.length === 1 ? parsed.items[0] : undefined;
    // 单个延音可以跨虚拟 TAB 槽，其完整时间窗由核心检查，和按钮录入一致。
    if (template === "uniform" && !fixedRange && singleItem?.kind === "set" && singleItem.tokens[0] === "-")
      return event
        ? { type: "numbered.event.set", trackId: track.id, measureId: measure.id, eventId: event.id, tokens: singleItem.tokens }
        : { type: "numbered.sequence.overwrite", trackId: track.id, measureId: measure.id, startTick: start, items: [singleItem], allowOverwrite: true };
    if (event && event.kind !== "continuation" && template === "uniform" && !fixedRange && inputRhythmExplicit &&
      singleItem?.kind === "set" && (event.rhythm.base !== templateBase || event.rhythm.dots !== templateDots)) {
      return {
        type: "numbered.event.setRhythm", trackId: track.id, measureId: measure.id,
        eventId: event.id, rhythm: { base: templateBase, dots: templateDots }, tokens: singleItem.tokens,
      };
    }
    if (
      mode === "single" &&
      template === "uniform" &&
      !fixedRange &&
      event &&
      singleItem?.kind === "set"
    )
      return {
        type: "numbered.event.set",
        trackId: track.id,
        measureId: measure.id,
        eventId: event.id,
        tokens: singleItem.tokens,
      };
    if (mode === "sequence" && template === "uniform" && !fixedRange && !inputRhythmExplicit)
      return {
        type: "numbered.sequence.overwrite",
        trackId: track.id,
        measureId: measure.id,
        startTick: event?.tick ?? start,
        items: parsed.items,
        allowOverwrite: true,
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
    if (mode === "sequence" && !fixedRange && !["tuplet", "triplet"].includes(template))
      return {
        type: "numbered.sequence.overwrite", trackId: track.id, measureId: measure.id,
        startTick: event?.tick ?? start, items: parsed.items, rhythms, allowOverwrite: true,
      };
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
    inputRhythmExplicit,
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
  const issue =
    !parsed.ok && !clearSingleEvent
      ? "简谱输入错误"
      : !clearSingleEvent && mode === "single" && parsed.ok && parsed.items.length !== 1
        ? "单音组只接受一项；先后音请使用节奏模板"
        : plan && !plan.ok
          ? plan.message
           : null;
  const contentDirty =
    !(clearSingleEvent && event?.kind === "gap") &&
    contentFingerprint !== contentBaseline &&
    (raw !== initial || !!raw.trim());

  useEffect(() => {
    // 外部时值偏好只同步干净模板，已输入的内容保留自己的时值。
    if (contentDirty || pending) return;
    const rhythm = defaultInputRhythm;
    // 顶部工具栏也能在到达后显式选时值。即便显示值相同，也要记下显式选择，提交时才会按此重排。
    const explicit = targetInputRhythm ? false : inputRhythmExplicit || inputDefault?.chosenHere === true;
    if (rhythm.base === templateBase && rhythm.dots === templateDots && explicit === inputRhythmExplicit) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setTemplateBase(rhythm.base);
      setTemplateDots(rhythm.dots);
      setInputRhythmExplicit(explicit);
      setContentBaseline(
        contentValue(initial, {
          template,
          start,
          end,
          overwrite,
          customRhythms,
          ratioIndex,
          fixedRange,
          inputRhythmExplicit: explicit,
          templateBase: rhythm.base,
          templateDots: rhythm.dots,
        }),
      );
      contentBaselineValue.current = {
        ...contentBaselineValue.current,
        templateBase: rhythm.base,
        templateDots: rhythm.dots,
        inputRhythmExplicit: explicit,
      };
    });
    return () => {
      cancelled = true;
    };
  }, [
    inputDefault?.chosenHere,
    targetInputRhythm,
    defaultInputRhythm,
    event,
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
    inputRhythmExplicit,
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
      event && event.kind !== "continuation" && track && measure
        ? {
            type: "numbered.event.setRhythm",
            trackId: track.id,
            measureId: measure.id,
            eventId: event.id,
            rhythm: { base, dots },
            timeline: "preservePositions",
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
    contentOperation: operation,
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
    rhythm: groupState("rhythm", rhythmPlan, rhythmPlan && !rhythmPlan.ok ? numberedRhythmIssue(rhythmPlan.message) : null),
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
  const primaryApply = useRef<NumberedPrimaryApply | undefined>(undefined);
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
    // 聚焦会同步触发旧按钮的 Tooltip blur，等 React 提交完成后再移焦。
    const frame = requestAnimationFrame(() => {
      if (completedFocusRequest.current === focusRequest) return;
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
      if (!control?.isConnected || control.closest("[hidden], [inert]")) return;
      control.focus({ preventScroll: true });
      if (globalThis.document.activeElement === control) {
        completedFocusRequest.current = focusRequest;
        control.scrollIntoView?.({ block: "nearest" });
      }
    });
    return () => cancelAnimationFrame(frame);
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
    selectionRange: firstBeat ? { start: Math.min(firstBeat.tick, firstEvent?.tick ?? Infinity), end: selectedEnd } : null,
    measureId: measure?.id,
    mode,
    targetInputKey,
    contentOperation: operation,
    contentConfig: { raw, selectedId, template, start, end, overwrite, templateBase, templateDots, customRhythms, ratioIndex, fixedRange, inputRhythmExplicit },
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
      selectionRange: firstBeat ? { start: Math.min(firstBeat.tick, firstEvent?.tick ?? Infinity), end: selectedEnd } : null,
      measureId: measure?.id,
      mode,
      targetInputKey,
      contentOperation: operation,
      contentConfig: { raw, selectedId, template, start, end, overwrite, templateBase, templateDots, customRhythms, ratioIndex, fixedRange, inputRhythmExplicit },
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
      numberedContentDependency(previous.track, measure.id, previous.event?.id, raw, operation) !==
      numberedContentDependency(track, measure.id, event?.id, raw, operation))
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
        const preferredItemId = resolved?.kind === "numberedEvent" ? resolved.itemId ?? itemId : itemId;
        const nextItem = event.items.find((item) => item.id === preferredItemId) ?? event.items[0];
        const token = nextItem?.token ?? "";
        setItemId(nextItem?.id ?? "");
        setItemDraft(token);
        setPitchBaseline(token);
      }
    });
  }, [document, track, event, itemId, measure, contentDirty, rhythmDirty, itemPitchDirty, raw, contentFingerprint, base, dots, itemDraft, targetInvalid, value, contentValue, operation, resolved]);
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
      onSuccess: (group, op, result, grouped, candidate) => {
        const state = latest.current;
        ownDocument.current = result.document;
        // Immediate rhythm changes update the input template in the same success
        // transaction as the content baseline, using the actual committed result.
        const contentConfig = !grouped && op.type === "numbered.event.setRhythm" && !state.contentDirty
          ? { ...state.contentConfig, templateBase: op.rhythm.base, templateDots: op.rhythm.dots, inputRhythmExplicit: true }
          : state.contentConfig;
        if (contentConfig !== state.contentConfig) {
          setTemplateBase(contentConfig.templateBase);
          setTemplateDots(contentConfig.templateDots);
          setInputRhythmExplicit(true);
        }
        if (grouped && group === "content") {
          setInitial(state.raw);
          setContentBaseline(state.contentFingerprint);
          contentBaselineValue.current = structuredClone(state.contentConfig);
          if (state.contentConfig.template === "uniform" && state.contentConfig.inputRhythmExplicit &&
            (op.type === "numbered.event.setRhythm" || op.type === "numbered.sequence.overwrite" || op.type === "numbered.sequence.insert")) {
            editorStore.getState().setNumberedInputRhythm({ base: state.contentConfig.templateBase, dots: state.contentConfig.templateDots });
          }
        }
        const afterTrack = result.document.score.tracks.find(
          (t) => t.id === op.trackId,
        );
        const editedMeasure = "measureId" in op ? afterTrack?.measures.find((m) => m.id === op.measureId) : undefined;
        const startTick = "startTick" in op ? op.startTick : undefined;
        // 部分写入可能把原 gap ID 留给尾部。范围命令要按起点重绑，避免光标追随这个 ID。
        const afterEvent = startTick !== undefined
          ? editedMeasure?.numberedVoice.events.find((e) => e.tick === startTick)
          : afterTrack?.measures.flatMap((m) => m.numberedVoice.events).find((e) => e.id === state.event?.id);
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
          if (!state.contentDirty) {
            const text =
              state.mode === "single"
                ? afterEvent.items.map((i) => i.token).join("+")
                : state.selectionRange
                  ? numberedSequenceRangeText(afterTrack!.measures.find(m => m.id === state.measureId)!, state.selectionRange.start, state.selectionRange.end)
                  : afterEvent.items.map(i => i.token).join("+");
            setRaw(text);
            setInitial(text);
            setContentBaseline(state.contentValue(text, contentConfig));
            contentBaselineValue.current = structuredClone({ ...contentConfig, selectedId: afterEvent.id, raw: text });
          }
        }
        setMessage(result.changed ? "已应用" : "内容未变化");
        if (!result.changed || !grouped || group !== "content" || !state.track || !afterTrack) return;
        const placement = primaryApply.current;
        // core 的默认选区可能落在插入末尾或首个写入项。保持当前表单起点，
        // 包括首项跳过、关闭自动前进和后续无空位的情况。
        if (editedMeasure && startTick !== undefined) {
          if (afterEvent) {
            const member = afterEvent.items.find((item) => item.id === state.itemId) ?? afterEvent.items[0];
            editorStore.getState().setNumberedSelection({ kind: "numberedEvent", trackId: op.trackId,
              measureId: editedMeasure.id, eventId: afterEvent.id, ...(member ? { itemId: member.id } : {}) });
          } else {
            const blank = planNumberedInputRanges(editedMeasure).find((slot) => slot.startTick === startTick);
            if (blank) editorStore.getState().setNumberedSelection({ kind: "numberedTime", trackId: op.trackId,
              measureId: editedMeasure.id, tick: blank.startTick, endTick: blank.endTick });
          }
        }
        if (placement?.advance && !state.dirtyGroups.some((other) => other !== group)) {
          const target = nextNumberedTextInput(state.track, afterTrack, op, candidate);
          if (target) {
            setNextTarget({ target, surface: placement.surface });
            return;
          }
        }
        if (placement) setFocusRequest({ group: "content", popover: placement.surface === "popover" });
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
    placement?: NumberedPrimaryApply,
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
    if (!submissionRef.current?.isBusy()) primaryApply.current = placement;
    const submitted = (await submissionRef.current?.request(
      op,
      group,
      current,
      grouped,
    )) ?? { status: "stale" as const, group, message: "简谱编辑器已关闭。" };
    const result = op.type === "numbered.event.setRhythm" && "message" in submitted
      ? { ...submitted, message: numberedRhythmIssue(submitted.message) } : submitted;
    if (candidateGeneration.current.mounted && candidateGeneration.current.revision === revision && "message" in result)
      setMessage(result.message);
    return result;
  };
  const applyGroup = (
    group: NumberedDraftGroup,
    isCurrent?: () => boolean,
    placement?: NumberedPrimaryApply,
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
    return submit(op, group, isCurrent, true, placement);
  };
  const applyContent = (isCurrent?: () => boolean, surface: NumberedInputSurface = presentation) =>
    applyGroup("content", isCurrent, { surface, advance: textAdvance?.checked ?? false });
  const apply = (
    isCurrent?: () => boolean,
  ): Promise<NumberedPropertyApplyResult> => {
    if (dirtyGroups.length === 0)
      return Promise.resolve({ status: "noop", group: "content" });
    if (dirtyGroups.length !== 1)
      return Promise.resolve({
        status: "blocked",
        group: "content",
        message: "有多个分组尚未应用，请分别处理后再切换。",
      });
    return applyGroup(dirtyGroups[0]!, isCurrent);
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
      onSelectTarget(nextTarget.target, nextTarget.surface);
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
      setInputRhythmExplicit(!!baseline.inputRhythmExplicit);
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
              timeline: "preservePositions",
            },
             "rhythm",
             undefined,
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
      inputRhythmExplicit,
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
      destination: "",
      customRhythms: structuredClone(customRhythms),
      ratioIndex,
      itemDraft,
    }),
  }));
  const inputIsEmpty = !raw.trim() && !event;
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
      const applyKey = !e.shiftKey && !e.altKey;
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
      if (!pending && !e.repeat) void applyContent(undefined, e.target === popoverInput.current ? "popover" : presentation);
    },
    onFocusCapture: (e) => {
      // 用户已选中任一表单控件时，不再补做等待中的气泡聚焦。
      if (focusRequest) completedFocusRequest.current = focusRequest;
      const group = (e.target as HTMLElement).closest<HTMLElement>(
        "[data-numbered-group]",
      )?.dataset.numberedGroup;
      if (group === "content" || group === "rhythm" || group === "itemPitch") {
        activeGroup.current = group;
      }
      if (
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLInputElement
      )
        onActivate(false);
    },
  };
  const renderInput = (compact: boolean, portal = false) => {
    const id = `numbered-${compact ? 'popover' : 'sidebar'}-content`;
    const inputIssue = !inputIsEmpty ? groups.content.blockedReason ?? issue : null;
    const applyDisabled = !!pending || compositionGuard || !groups.content.canApply;
    return <Form.Item layout="vertical" label={<span className={floatingStyles.inputLabel}>简谱内容<Tooltip trigger={['hover','focus','click']} title={<ShortcutHint shortcuts={["apply", "textNavigate"]} note="空格分隔先后音，+ 表示多音；1–7 音级，0 休止，- 延音；' 高八度，. 低八度；# 升、b 降、n 还原。留空应用可清除当前音符并保留占位。" />}><button type="button" className={floatingStyles.helpButton} aria-label="简谱输入规则">?</button></Tooltip><span>连续录入</span></span>} htmlFor={id} validateStatus={inputIssue ? 'error' : undefined}>
      <div className={floatingStyles.contentEntry}>
        <Input id={id} ref={(control) => { (portal ? popoverInput : input).current = control?.input ?? null; }} aria-label="简谱内容" aria-invalid={!!inputIssue} aria-describedby={inputIssue ? `${id}-error` : undefined} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="1 2 3；多音用 1+3" />
        <ShortcutTooltip shortcuts={["apply", "applyModified"]} disabled={applyDisabled}>
          <Button type="primary" aria-label="应用简谱内容" disabled={applyDisabled} onClick={() => void applyContent(undefined, compact ? "popover" : "sidebar")}>应用</Button>
        </ShortcutTooltip>
      </div>
      {inputIssue && <p id={`${id}-error`} className={floatingStyles.actionReason} role="status" title={!parsed.ok && !clearSingleEvent ? parsed.message : undefined}>{inputIssue}</p>}
    </Form.Item>;
  }
   const rhythmBlockedReason = targetInvalid ? "请先选择有效简谱位置"
     : pending ? "请先完成修改确认"
     : compositionGuard ? "请先完成输入法输入"
     : rhythmDirty || itemPitchDirty ? "请先处理未应用的属性"
     : contentDirty && clearSingleEvent ? "清空内容时保留原时值" : null;
   const immediateBlockedReason = rhythmBlockedReason ?? (contentDirty ? "请先应用简谱内容" : null);
   // 已载入的旧延音可以保留原书写值，选中它或键入单个延音时均禁用时值编辑。
   const draftIsContinuation = parsed.ok && parsed.items.length === 1 &&
     parsed.items[0]?.kind === "set" && parsed.items[0].tokens[0] === "-";
   const continuationSelected = event?.kind === "continuation" || draftIsContinuation;
   const durationBlockedReason = rhythmBlockedReason ?? (continuationSelected ? NUMBERED_CONTINUATION_RHYTHM_REASON : null);
   const draftContinuationRhythm = draftIsContinuation && event?.kind !== "continuation" && measure
     ? numberedContinuationRhythm(measure.timeSignature) : undefined;
   // 多音必须来自谱面明确选中的成员，不能默认修改整组或第一个音。
   const selectedPitchItem = event?.kind === "notes" &&
     (event.items.length === 1 || (target && "itemId" in target && target.itemId))
     ? event.items.find((item) => item.id === itemId) : undefined;
   const applyInstantPitch = (token: string) => {
     if (immediateBlockedReason || !selectedPitchItem || !track || !measure || !event || token === selectedPitchItem.token) return;
     void submit({ type: "numbered.event.set", trackId: track.id, measureId: measure.id,
       eventId: event.id, itemId: selectedPitchItem.id, tokens: [token] }, "itemPitch", undefined, false);
   };
    const applyInstantRhythm = async (nextBase: ILXMRhythmBase, nextDots: number) => {
     if (durationBlockedReason) return;
     if (contentDirty) {
       setTemplateBase(nextBase);
       setTemplateDots(nextDots);
       setInputRhythmExplicit(true);
       return;
     }
     if (event && track && measure) {
        const result = await submit({ type: "numbered.event.setRhythm", trackId: track.id, measureId: measure.id,
           eventId: event.id, rhythm: { base: nextBase, dots: nextDots }, timeline: "preservePositions" }, "rhythm", undefined, false);
        if (result.status !== "applied" && result.status !== "noop") return;
      } else {
        // Empty positions only change the input preference; no score command.
        const config = { ...latest.current.contentConfig, templateBase: nextBase, templateDots: nextDots, inputRhythmExplicit: true };
        setTemplateBase(nextBase);
        setTemplateDots(nextDots);
        setInputRhythmExplicit(true);
        contentBaselineValue.current = structuredClone(config);
        setContentBaseline(contentValue(latest.current.raw, config));
      }
      editorStore.getState().setNumberedInputRhythm({ base: nextBase, dots: nextDots },
        !event && resolved?.kind === "numberedTime" ? resolved : undefined);
   };
   const applyInstantSustain = () => {
     if (immediateBlockedReason || !track || !measure) return;
     if (event) {
       if (event.items.length === 1 && event.items[0]?.token === "-") return;
       void submit({ type: "numbered.event.set", trackId: track.id, measureId: measure.id,
         eventId: event.id, tokens: ["-"] }, "content", undefined, false);
     } else {
       const sustain = parseNumberedSequence("-");
       if (sustain.ok) void submit({ type: "numbered.sequence.overwrite", trackId: track.id, measureId: measure.id,
         startTick: start, items: sustain.items, allowOverwrite: true }, "content", undefined, false);
     }
   };
   const useDraftRhythm = contentDirty && inputRhythmExplicit;
   const renderCompactRhythm = (visible: boolean) => <section hidden={!visible} inert={!visible} className={floatingStyles.compactRhythm} data-numbered-group="rhythm">
     <div className={floatingStyles.sectionHeading}>
       <strong>时值</strong>
       {contentDirty && <span>随内容应用</span>}
       {textAdvance && <TextApplyAdvanceCheckbox {...textAdvance} disabled={compositionGuard || !!pending} />}
     </div>
     <NumberedRhythmToolbar
       base={draftContinuationRhythm?.base ?? (event && !useDraftRhythm ? base : templateBase)}
       dots={draftContinuationRhythm?.dots ?? (event && !useDraftRhythm ? dots : templateDots)}
       disabled={!!durationBlockedReason}
       disabledReason={durationBlockedReason ?? undefined}
       onChange={(nextBase, nextDots) => void applyInstantRhythm(nextBase, nextDots)}
       onSustain={contentDirty ? undefined : applyInstantSustain}
       sustain={continuationSelected}
     />
   </section>;
  const editor = (
    <section
      ref={root}
      data-editor-form-section className={`${editorFormStyles.sidebarSection} ${floatingStyles.editor} ${compact ? floatingStyles.compact : ""}`}
      data-presentation={presentation}
      {...editorEvents}
    >
      <fieldset disabled={!!pending} inert={!!pending} className={floatingStyles.propertyFieldset}>
        <div data-numbered-group="content">{renderInput(compact)}</div>
        {!targetInvalid && <>
          {renderCompactRhythm(true)}
          {!compact && plan?.ok && <BeatMappingPreview
            label="节拍映射预览"
            rows={numberedPreviewMapping(previewRows)}
            measures={track.measures.map((item, index) => ({ key: item.id, label: `第 ${index + 1} 小节`, durationTicks: getMeasureDurationTicks(item), beatTicks: 3840 / item.timeSignature.denominator }))}
            onInspect={onInspectPosition}
          />}
          {!compact && <section data-numbered-group="itemPitch" className={floatingStyles.pitchSection} aria-label="八度与变音">
            <div className={floatingStyles.sectionHeading}><strong>八度与变音</strong><span>{selectedPitchItem ? `已选 ${selectedPitchItem.token}` : event?.kind === "notes" ? "请点选谱面单音" : "请选择有音高的简谱"}</span></div>
            <NumberedPitchFields value={selectedPitchItem?.token ?? ""} disabled={!!immediateBlockedReason || !selectedPitchItem} disabledReason={immediateBlockedReason ?? "请先在谱面点选单个音符"} onChange={applyInstantPitch} />
          </section>}
        </>}
      </fieldset>
      <Modal
        open={!!pending}
        centered
        title="确认简谱修改影响"
        mask={{ closable: false }}
        keyboard={false}
        closable={false}
        onCancel={() => submissionRef.current?.cancel()}
        onOk={() => submissionRef.current?.confirm()}
        cancelText="取消"
        okText="确认修改"
        modalRender={(node) => (
          <EditorModalGuard dismissable onDismiss={() => submissionRef.current?.cancel()}>{node}</EditorModalGuard>
        )}
        styles={{ container: { maxHeight: "calc(100dvh - 32px)", overflowY: "auto" } }}
      >
        {pending && (
          <>
            {track && pending.overwrittenEventIds.length > 0 && (
              <p>{numberedRhythmMergeMessage(track, pending)}</p>
            )}
            {(pending.movedEventIds.length > 0 ||
              pending.resizedEventIds.length > 0) && (
              <>
                <p>
                  附点修改将互补调整紧邻后音的起点与时值，保留音符内容及其结束拍位。确认修改吗？
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
          </>
        )}
      </Modal>
      {message && message !== "已应用" && message !== "内容未变化" && <p role="status">{message}</p>}
    </section>
  );
  return (
    <>
      {editor}
      {popoverContainer &&
        !compact &&
        createPortal(
          <section
            data-editor-form-section className={`${editorFormStyles.sidebarSection} ${floatingStyles.editor} ${floatingStyles.compact}`}
            data-presentation="popover"
            {...editorEvents}
          >
            <fieldset disabled={!!pending} inert={!!pending} className={floatingStyles.propertyFieldset}>
              <div data-numbered-group="content">{renderInput(true, true)}</div>
              {!targetInvalid && <>
                {renderCompactRhythm(true)}
              </>}
            </fieldset>
            {message && message !== "已应用" && message !== "内容未变化" && <p role="status">{message}</p>}
          </section>,
          popoverContainer,
        )}
    </>
  );
};
