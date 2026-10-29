"use client";
import { Alert, Button, Checkbox, Form, Input, Select } from "antd";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
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
  type ILXMRhythm,
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
import type { EditorSessionVersion } from "./editor-session-version";
import { numberedInputRhythmForWindow } from "./editor-rhythm-target";

export interface NumberedEditorController {
  canApply: boolean;
  dirty: boolean;
  /** 简谱属性按内容、时值和单 item 音高分组，避免一个 boolean 掩盖未提交字段。 */
  dirtyGroups: readonly NumberedDraftGroup[];
  apply: (isCurrent?: () => boolean) => Promise<NumberedPropertyApplyResult>;
  applyGroup: (
    group: NumberedDraftGroup,
    isCurrent?: () => boolean,
  ) => Promise<NumberedPropertyApplyResult>;
  discard: () => void;
  focus: () => void;
  snapshot: () => NumberedEditorDraft;
  setRhythm: (rhythm: ILXMRhythm) => Promise<NumberedPropertyApplyResult>;
}
/** 切换简谱目标时暂存纯 UI 输入，不提前写入曲谱或撤销历史。 */
export interface NumberedEditorDraft {
  /** 暂存草稿自己的录入方式，不能被全局当前模式覆盖。 */
  mode?: "single" | "sequence";
  contentBaseline?: string;
  templateBase?: ILXMRhythmBase;
  templateDots?: number;
  fixedRange?: boolean;
  baselineVersion?: EditorSessionVersion;
  dependency?: string;
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
  onModeChange,
  onCancel,
  getClipboard,
  copyRange,
  selectedMarkId,
  savedDraft,
  onSelectTarget,
  checkCandidate,
  onBusyChange,
  onGroupsChange,
}: {
  ref: Ref<NumberedEditorController>;
  checkCandidate?: (candidate: NumberedImpact) => string | null;
  onBusyChange?: (busy: boolean) => void;
  onGroupsChange?: (groups: readonly NumberedDraftGroup[]) => void;
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
  savedDraft?: NumberedEditorDraft;
  onSelectTarget: (target: MusicTextTarget) => void;
}) => {
  const editorStore = useEditorSessionStore();
  const preference = useEditorStore((state) => state.numberedInputRhythm);
  const preferenceExplicit = useEditorStore(
    (state) => state.numberedInputRhythmExplicit,
  );
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
  const [fixedRange, setFixedRange] = useState(savedDraft?.fixedRange ?? false);
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
    [overwrite, setOverwrite] = useState(savedDraft?.overwrite ?? true);
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
  const [pending, setPending] = useState<NumberedImpact | null>(null);
  const [nextTarget, setNextTarget] = useState<MusicTextTarget | null>(null);
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
  const [templateBase, setTemplateBase] = useState<ILXMRhythmBase>(
    savedDraft?.templateBase ??
      numberedInputRhythmForWindow(
        preference,
        preferenceExplicit,
        window.end - window.start,
      ).base,
  );
  const [templateDots, setTemplateDots] = useState(
    savedDraft?.templateDots ??
      numberedInputRhythmForWindow(
        preference,
        preferenceExplicit,
        window.end - window.start,
      ).dots,
  );
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
  const [contentBaseline, setContentBaseline] = useState(
    () => savedDraft?.contentBaseline ?? contentValue(initial),
  );
  const contentFingerprint = contentValue(raw);
  const operation = useMemo<ILXMNumberedVoiceCommand | null>(() => {
    if (!track || !measure || !parsed.ok) return null;
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
    contentFingerprint !== contentBaseline && (raw !== initial || !!raw.trim());

  useEffect(() => {
    // 外部时值偏好只同步干净模板，已输入的内容和缓存草稿保留自己的时值。
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
    !!event && (base !== event.rhythm.base || dots !== event.rhythm.dots);
  const rhythmPreviewRows = useMemo(
    () =>
      rhythmPlan?.ok && track && rhythmOperation
        ? buildNumberedPreviewRows(track, rhythmPlan, rhythmOperation)
        : [],
    [track, rhythmPlan, rhythmOperation],
  );
  const itemPitchValue =
    event?.items.find((item) => item.id === itemId)?.token ?? "";
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
  const itemPitchIssue =
    itemPitchDirty && !itemPitchOperation ? "请选择一个合法简谱音高" : null;
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
  const dirty = dirtyGroups.length > 0;
  const latest = useRef({
    checkCandidate,
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
  });
  useLayoutEffect(() => {
    latest.current = {
      checkCandidate,
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
    };
  });
  const submissionRef = useRef<ReturnType<
    typeof createNumberedSubmission
  > | null>(null);
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
        const cachedIssue = state.checkCandidate?.(candidate);
        if (cachedIssue) return cachedIssue;
        const old = state.event;
        const next = candidate.track.measures
          .flatMap((m) => m.numberedVoice.events)
          .find((e) => e.id === old?.id);
        // 核心候选可能重建 item；先保护仍在编辑的其他组，再允许任何写操作。
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
        if (old) {
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
            (!next ||
              JSON.stringify(old.rhythm) !== JSON.stringify(next.rhythm) ||
              old.items[0]?.id !== next.items[0]?.id)
          )
            return "此操作会影响时值草稿，请先应用或恢复事件时值组。";
          if (
            state.contentDirty &&
            (!grouped || group !== "content") &&
            (!next || JSON.stringify(old.items) !== JSON.stringify(next.items))
          )
            return "此操作会影响内容草稿，请先应用或恢复内容组。";
        }
        return null;
      },
      onSuccess: (group, op, result, grouped) => {
        const state = latest.current;
        if (grouped && group === "content") {
          setInitial(state.raw);
          setContentBaseline(state.contentFingerprint);
        }
        const afterTrack = result.document.score.tracks.find(
          (t) => t.id === op.trackId,
        );
        const afterEvent = afterTrack?.measures
          .flatMap((m) => m.numberedVoice.events)
          .find((e) => e.id === state.event?.id);
        if (afterEvent) {
          if (!state.rhythmDirty || (grouped && group === "rhythm")) {
            setBase(afterEvent.rhythm.base);
            setDots(afterEvent.rhythm.dots);
          }
          if (!state.itemPitchDirty || (grouped && group === "itemPitch")) {
            const item =
              afterEvent.items.find((i) => i.id === state.itemId) ??
              afterEvent.items[0];
            setItemId(item?.id ?? "");
            setItemDraft(item?.token ?? "");
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
          }
        }
        setMessage(result.changed ? "已应用" : "内容未变化");
        const focus = result.nextNumberedFocus;
        if (focus) {
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
    isCurrent = () => true,
    grouped = false,
  ) => {
    const result = (await submissionRef.current?.request(
      op,
      group,
      isCurrent,
      grouped,
    )) ?? { status: "stale" as const, group, message: "简谱编辑器已关闭。" };
    if ("message" in result) setMessage(result.message);
    return result;
  };
  const applyGroup = (
    group: NumberedDraftGroup,
    isCurrent = () => true,
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
        message:
          group === "content"
            ? (issue ?? "当前内容无法应用。")
            : "请先修正本组字段。",
      });
    return submit(op, group, isCurrent, true);
  };
  const apply = (
    isCurrent = () => true,
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
      onSelectTarget(nextTarget);
    });
    return () => {
      cancelled = true;
    };
  }, [nextTarget, pending, onSelectTarget]);
  const restoreGroup = (group: NumberedDraftGroup) => {
    if (submissionRef.current?.isBusy()) return;
    if (group === "content") {
      setRaw(initial);
      setOverwrite(true);
      setTemplate("uniform");
      setFixedRange(false);
      setStart(window.start);
      setEnd(window.end);
      const config = {
        template: "uniform",
        start: window.start,
        end: window.end,
        overwrite: true,
        templateBase,
        templateDots,
        customRhythms,
        ratioIndex,
        fixedRange: false,
      };
      setContentBaseline(contentValue(initial, config));
    } else if (group === "rhythm" && event) {
      setBase(event.rhythm.base);
      setDots(event.rhythm.dots);
    } else if (group === "itemPitch")
      setItemDraft(event?.items.find((i) => i.id === itemId)?.token ?? "");
    setMessage(null);
  };
  const reset = () => {
    restoreGroup("content");
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
    setOverwrite(true);
    submissionRef.current?.cancel();
    setCustomRhythms([]);
    setRatioIndex(1);
    setItemDraft(event?.items.find((i) => i.id === itemId)?.token ?? "");
    onInputActive(false);
  };
  useImperativeHandle(ref, () => ({
    canApply,
    dirty,
    dirtyGroups,
    apply,
    applyGroup,
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
          )
        : Promise.resolve({
            status: "blocked",
            group: "rhythm",
            message: "请先选择简谱事件。",
          }),
    discard: reset,
    focus: () => input.current?.focus({ preventScroll: true }),
    snapshot: () => ({
      mode,
      contentBaseline,
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
      <p className={styles.sidebarTip}>
        内容、事件时值和单音符音高分别应用。还有 {dirtyGroups.length}{" "}
        组修改未应用。
      </p>
      <fieldset
        disabled={!!pending}
        inert={!!pending}
        className={styles.propertyFieldset}
      >
        <legend>简谱内容与录入</legend>
        <div className={styles.propertyGrid}>
          <Form.Item
            layout="vertical"
            label="录入方式"
            htmlFor={"editor-field-" + "简谱录入方式"}
          >
            <Select
              id={"editor-field-" + "简谱录入方式"}
              aria-label="简谱录入方式"
              value={mode}
              onChange={(value) => onModeChange(value as typeof mode)}
              style={{ width: "100%" }}
              options={[
                { value: "sequence", label: "连续录入" },
                { value: "single", label: "单音组编辑" },
              ]}
            />
          </Form.Item>
          {resolved && measure && track && (
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
          )}
        </div>
        {!resolved || !measure || !track ? (
          <p>请选中简谱音符，或从六线谱选拍建立录入窗口</p>
        ) : (
          <>
            <Form.Item
              layout="vertical"
              label={mode === "sequence" ? "连续简谱" : "单音组简谱"}
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
                rows={mode === "single" ? 1 : 3}
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                placeholder="1 2 3；同时多音用 1+3+5"
              />
            </Form.Item>
            <p className={styles.sidebarTip}>
              空格分先后音，+ 表示同时发音。时值与技巧独立于六线谱；高音用
              &apos;，低音用 .，还原号用 n。
            </p>
            <details
              className={styles.numberedAdvanced}
              open={mode === "sequence"}
            >
              <summary>节奏模板与录入范围</summary>
              <div className={styles.propertyGrid}>
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
                  label="模板成员时值"
                  htmlFor={"editor-field-" + "模板成员时值"}
                >
                  <Select
                    id={"editor-field-" + "模板成员时值"}
                    aria-label="模板成员时值"
                    value={templateBase}
                    onChange={(value) => {
                      setTemplateBase(value as ILXMRhythmBase);
                      editorStore.getState().setNumberedInputRhythm({
                        base: value as ILXMRhythmBase,
                        dots: templateDots,
                      });
                    }}
                    style={{ width: "100%" }}
                    options={[
                      ...bases.map((b) => ({ value: b.value, label: b.label })),
                    ]}
                  />
                </Form.Item>
                <Form.Item
                  layout="vertical"
                  label="时值附点"
                  htmlFor={"editor-field-" + "模板成员附点"}
                >
                  <Select
                    id={"editor-field-" + "模板成员附点"}
                    aria-label="模板成员附点"
                    value={templateDots}
                    onChange={(value) => {
                      setTemplateDots(Number(value));
                      editorStore.getState().setNumberedInputRhythm({
                        base: templateBase,
                        dots: Number(value),
                      });
                    }}
                    style={{ width: "100%" }}
                    options={[
                      { value: 0, label: "无" },
                      { value: 1, label: "单附点" },
                      { value: 2, label: "双附点" },
                    ]}
                  />
                </Form.Item>
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
            </details>
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
            {plan?.ok && (
              <div className={styles.sequencePreview} aria-label="简谱修改预览">
                <h4>修改预览 · {previewRows.length} 项</h4>
                {(plan.removedMarkIds.length > 0 ||
                  plan.changedMarkIds.length > 0) && (
                  <p>
                    目标记号影响：删除 {plan.removedMarkIds.length} 个，迁移{" "}
                    {plan.changedMarkIds.length} 个；应用前需确认。
                  </p>
                )}
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
                        <td>
                          {row.measureNumber} 小节 · {row.position}
                          <small>{row.rhythm}</small>
                        </td>
                        <td>
                          {row.before} → {row.after}
                        </td>
                        <td>
                          {
                            {
                              skip: "跳过",
                              release: "释放空位",
                              add: "新增",
                              change:
                                row.impact === "overwrite" ? "覆盖" : "修改",
                              same: "未变化",
                              remove:
                                row.impact === "release" ? "释放" : "删除",
                            }[row.status]
                          }
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
                应用内容
              </Button>
              <Button onClick={() => restoreGroup("content")}>
                恢复内容组
              </Button>
            </div>
            {event && (
              <fieldset className={styles.propertyFieldset}>
                <legend>事件时值与单音符属性</legend>
                <div className={styles.propertyGrid}>
                  <Form.Item
                    label="事件时值"
                    layout="vertical"
                    htmlFor="numbered-event-base"
                  >
                    <Select
                      id="numbered-event-base"
                      aria-label="简谱时值"
                      value={base}
                      onChange={setBase}
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
                      onChange={setDots}
                      options={[
                        { value: 0, label: "无" },
                        { value: 1, label: "单附点" },
                        { value: 2, label: "双附点" },
                      ]}
                    />
                  </Form.Item>
                </div>
                {rhythmPlan?.ok &&
                  (base !== event.rhythm.base ||
                    dots !== event.rhythm.dots) && (
                    <div aria-label="简谱时值修改预览">
                      <p>
                        时值预览：保留当前音符，
                        {rhythmPlan.movedEventIds.length ||
                        rhythmPlan.resizedEventIds.length
                          ? `移动 ${rhythmPlan.movedEventIds.length} 个后续事件，缩短 ${rhythmPlan.resizedEventIds.length} 个后续事件；应用前需确认`
                          : rhythmPlan.releasedRange
                            ? "在后方释放一个可录入范围"
                            : "扩展到后方空白"}
                        。
                      </p>
                      <ul>
                        {rhythmPreviewRows.map((row) => (
                          <li key={row.key}>
                            {row.position} · {row.after} · {row.rhythm}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                {rhythmPlan && !rhythmPlan.ok && (
                  <p role="status">{rhythmPlan.message}</p>
                )}
                <Button
                  disabled={!canApplyByGroup.rhythm}
                  onClick={() => applyGroup("rhythm")}
                >
                  应用当前音符时值
                </Button>
                <Button onClick={() => restoreGroup("rhythm")}>
                  恢复时值组
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
                      if (itemPitchDirty) {
                        setMessage(
                          "请先应用或恢复当前单音符音高，再切换成员。",
                        );
                        return;
                      }
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
                    {itemPitchIssue && (
                      <Alert type="error" title={itemPitchIssue} />
                    )}
                    <Button
                      disabled={!canApplyByGroup.itemPitch}
                      onClick={() => applyGroup("itemPitch")}
                    >
                      应用单音符音高
                    </Button>
                    <Button onClick={() => restoreGroup("itemPitch")}>
                      恢复音高组
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
          </>
        )}
      </fieldset>
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
};
