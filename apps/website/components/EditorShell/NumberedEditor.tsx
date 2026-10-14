"use client";
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
export interface NumberedEditorController {
  canApply: boolean;
  dirty: boolean;
  apply: () => boolean;
  discard: () => void;
  focus: () => void;
  snapshot: () => NumberedEditorDraft;
}
/** 切换简谱目标时暂存纯 UI 输入，不提前写入曲谱或撤销历史。 */
export interface NumberedEditorDraft {
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
  const [pending, setPending] = useState<{
    operation: ILXMNumberedVoiceCommand;
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
  const issue = !parsed.ok
    ? parsed.message
    : mode === "single" && parsed.items.length !== 1
      ? "单音组只接受一项；先后音请使用节奏模板"
      : plan && !plan.ok
        ? plan.message
        : null;
  useEffect(() => onDirty(dirty || !!pending), [dirty, pending, onDirty]);
  useEffect(
    () => onCanApply(!!operation && !issue),
    [operation, issue, onCanApply],
  );
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
  const submit = (op: ILXMNumberedVoiceCommand): boolean => {
    if (!track) return false;
    const candidate = editNumberedTrack(
      track,
      op,
      createDocumentIdFactory(document),
      true,
    );
    if (!candidate.ok) {
      setMessage(candidate.message);
      return false;
    }
    if (
      op.type !== "numbered.mark.remove" &&
      (candidate.removedMarkIds.length || candidate.changedMarkIds.length)
    ) {
      setPending({
        operation: op,
        document,
        removed: candidate.removedMarkIds,
        changed: candidate.changedMarkIds,
      });
      return false;
    }
    const r = commit({ ...op, expectedRevision: document.documentRevision });
    if (!r?.ok) return false;
    setInitial(raw);
    setOverwrite(false);
    setMessage(r.changed ? "已应用" : "内容未变化");
    return true;
  };
  const apply = () => !!operation && !issue && submit(operation);
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
  };
  useImperativeHandle(ref, () => ({
    canApply: !!operation && !issue,
    dirty,
    apply,
    discard: reset,
    focus: () => input.current?.focus({ preventScroll: true }),
    snapshot: () => ({
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
      <label>
        录入方式
        <select
          aria-label="简谱录入方式"
          value={mode}
          onChange={(e) => onModeChange(e.target.value as typeof mode)}
        >
          <option value="sequence">连续录入</option>
          <option value="single">单音组编辑</option>
        </select>
      </label>
      {!resolved || !measure || !track ? (
        <p>请选中简谱音符，或从六线谱选拍建立录入窗口</p>
      ) : (
        <>
          <label>
            当前简谱事件
            <select
              aria-label="当前简谱事件"
              value={selectedId}
              onChange={(e) => {
                const next = measure.numberedVoice.events.find(
                  (v) => v.id === e.target.value,
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
            >
              <option value="">新增时间范围</option>
              {measure.numberedVoice.events.map((e) => (
                <option key={e.id} value={e.id}>
                  {formatNumberedBeatPosition(
                    e.tick,
                    measure.timeSignature.denominator,
                  )}{" "}
                  · {e.items.map((i) => i.token).join("+") || "未录入"}
                </option>
              ))}
            </select>
          </label>
          <label>
            节奏模板
            <select
              aria-label="简谱节奏模板"
              value={template}
              onChange={(e) => {
                setTemplate(e.target.value);
                setSelectedId("");
                setEnd(start + 960);
              }}
            >
              <option value="uniform">自选时值</option>
              <option value="front8">前八后十六</option>
              <option value="back8">前十六后八</option>
              <option value="triplet">三连音（八分）</option>
              <option value="custom">自定义成员时值</option>
              <option value="tuplet">自选节奏连音</option>
            </select>
          </label>
          {template === "tuplet" && (
            <label>
              连音比例
              <select
                aria-label="简谱连音比例"
                value={ratioIndex}
                onChange={(e) => setRatioIndex(Number(e.target.value))}
              >
                {LXM_TUPLET_RATIOS.map((r, i) => (
                  <option key={i} value={i}>
                    {r.actual}:{r.normal}
                  </option>
                ))}
              </select>
            </label>
          )}
          {template === "custom" &&
            parsed.ok &&
            parsed.items.map((_, i) => (
              <label key={i}>
                第{i + 1}音时值
                <select
                  aria-label={`简谱第${i + 1}音时值`}
                  value={customRhythms[i]?.base ?? base}
                  onChange={(e) =>
                    setCustomRhythms(
                      parsed.items.map((_, j) =>
                        j === i
                          ? {
                              base: e.target.value as ILXMRhythmBase,
                              dots: customRhythms[i]?.dots ?? 0,
                            }
                          : (customRhythms[j] ?? { base, dots }),
                      ),
                    )
                  }
                >
                  {bases.map((b) => (
                    <option key={b.value} value={b.value}>
                      {b.label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`简谱第${i + 1}音附点`}
                  value={customRhythms[i]?.dots ?? dots}
                  onChange={(e) =>
                    setCustomRhythms(
                      parsed.items.map((_, j) =>
                        j === i
                          ? {
                              base: customRhythms[i]?.base ?? base,
                              dots: Number(e.target.value),
                            }
                          : (customRhythms[j] ?? { base, dots }),
                      ),
                    )
                  }
                >
                  <option value={0}>无附点</option>
                  <option value={1}>单附点</option>
                  <option value={2}>双附点</option>
                </select>
              </label>
            ))}
          <label>
            简谱时值
            <select
              aria-label="简谱时值"
              value={base}
              onChange={(e) => setBase(e.target.value as ILXMRhythmBase)}
            >
              {bases.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            时值附点
            <select
              aria-label="简谱时值附点"
              value={dots}
              onChange={(e) => setDots(Number(e.target.value))}
            >
              <option value={0}>无</option>
              <option value={1}>单附点</option>
              <option value={2}>双附点</option>
            </select>
          </label>
          <label>
            录入起点
            <select
              aria-label="简谱录入起点"
              value={start}
              onChange={(e) => {
                const next = Number(e.target.value);
                setStart(next);
                setEnd(next + (end - start));
                setSelectedId("");
              }}
            >
              {[
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
                .map((t) => (
                  <option key={t} value={t}>
                    {formatNumberedBeatPosition(
                      t,
                      measure.timeSignature.denominator,
                    )}
                  </option>
                ))}
            </select>
          </label>
          <label>
            覆盖时长
            <select
              aria-label="简谱覆盖时长"
              value={end - start}
              onChange={(e) => {
                setEnd(start + Number(e.target.value));
                setSelectedId("");
              }}
            >
              <option value={end - start}>当前范围</option>
              <option value={480}>半个四分拍</option>
              <option value={960}>一个四分拍</option>
              <option value={1920}>两个四分拍</option>
              <option value={3840}>四个四分拍</option>
            </select>
          </label>
          <label>
            {mode === "sequence" ? "连续简谱" : "单音组简谱"}
            <textarea
              ref={input}
              aria-label={mode === "sequence" ? "连续简谱" : "单音组简谱"}
              rows={4}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder="1 2 3；同时多音用 1+3+5"
            />
          </label>
          <p className={styles.sidebarTip}>
            空格分先后音，+ 表示同时发音。时值与技巧独立于六线谱；高音用
            &apos;，低音用 .，还原号用 n。
          </p>
          <label>
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
            />
            允许覆盖此时间范围的简谱
          </label>
          {plan?.ok && (
            <p>
              预览：
              {plan.track.measures
                .find((m) => m.id === measure.id)!
                .numberedVoice.events.filter(
                  (e) => e.tick >= start && e.tick < end,
                )
                .map(
                  (e) =>
                    `${e.items.map((i) => i.token).join("+") || "空白"}（${bases.find((b) => b.value === e.rhythm.base)?.label}）`,
                )
                .join(" · ")}
            </p>
          )}
          {issue && raw.trim() && <p role="status">{issue}</p>}
          <div className={styles.sidebarActions}>
            <button
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
            </button>
            <button onClick={onCancel}>取消</button>
            <button
              className={styles.primaryButton}
              disabled={!!issue || !operation}
              onClick={apply}
            >
              应用
            </button>
          </div>
          {event && (
            <fieldset>
              <legend>简谱时值与技巧</legend>
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
              <button
                disabled={!rhythmPlan?.ok}
                onClick={() => rhythmOperation && submit(rhythmOperation)}
              >
                应用当前音符时值
              </button>
              <button
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
              </button>
              <label>
                起始音符
                <select
                  aria-label="简谱技巧起始音符"
                  value={itemId}
                  onChange={(e) => {
                    setItemId(e.target.value);
                    setItemDraft(
                      event.items.find((i) => i.id === e.target.value)?.token ??
                        "",
                    );
                  }}
                >
                  {event.items.map((i, j) => (
                    <option key={i.id} value={i.id}>
                      {j + 1}：{i.token}
                    </option>
                  ))}
                </select>
              </label>
              {event.kind === "notes" && (
                <>
                  <label>
                    单音符音高
                    <input
                      aria-label="简谱单音符音高"
                      value={itemDraft}
                      onChange={(e) => setItemDraft(e.target.value)}
                    />
                  </label>
                  {(["#", "b", "n"] as const).map((prefix) => (
                    <button
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
                    </button>
                  ))}
                  {([-1, 1] as const).map((direction) => (
                    <button
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
                    </button>
                  ))}
                  <button
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
                  </button>
                </>
              )}
              <label>
                连接终点
                <select
                  aria-label="简谱技巧终点"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                >
                  <option value="">请选择</option>
                  {markTargets.flatMap(({ e, label }) =>
                    e.items.map((i, j) => (
                      <option key={i.id} value={i.id}>
                        {label} · 音{j + 1}
                      </option>
                    )),
                  )}
                </select>
              </label>
              <button
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
              </button>
              <button
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
              </button>
              <button
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
              </button>
            </fieldset>
          )}
          <div className={styles.sidebarActions}>
            <button
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
            </button>
            {(["overwrite", "insert"] as const).map((pasteMode) => (
              <button
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
              </button>
            ))}
            {event && (
              <button
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
              </button>
            )}
            {event &&
              measure.numberedVoice.tuplets
                .filter((g) => g.eventIds.includes(event.id))
                .map((g) => (
                  <button
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
                  </button>
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
                <button
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
                </button>
                <button
                  onClick={() =>
                    submit({
                      type: "numbered.mark.remove",
                      trackId: track.id,
                      markId: m.id,
                    })
                  }
                >
                  删除记号
                </button>
              </p>
            ))}
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
            <button onClick={() => setPending(null)}>取消</button>
            <button
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
                if (result?.ok) setPending(null);
              }}
            >
              确认修改
            </button>
          </>
        )}
      </dialog>
      {message && <p role="status">{message}</p>}
    </section>
  );
};
