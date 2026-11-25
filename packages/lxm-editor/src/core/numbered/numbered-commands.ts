import {
  validateNumberedClipboard,
  type NumberedClipboard,
} from "./numbered-clipboard";
import { copyNumberedVoices } from "./numbered-copy";
import { addNumberedCrossBarTuplet, removeNumberedCrossBarTuplet } from "./numbered-cross-bar-tuplet";
import {
  validNumberedTokens,
  type NumberedSequenceItem,
} from "./numbered-notation";
import {
  calculateRhythmTicks,
  createRestRhythmsForTicks,
  getMeasureDurationTicks,
  getTimeSignatureBeatGroupTicks,
} from "../rhythm/rhythm";
import { LXM_RHYTHM_BASES, TICKS_PER_QUARTER } from "../constants";
import { isSupportedTupletRatio } from "../rhythm/tuplet";
import {
  createNumberedTrackRhythmContext,
  buildNumberedIndex,
  findInvalidNumberedTrack,
  numberedContinuationIssue,
  numberedContinuationRhythm,
  NUMBERED_CONTINUATION_METER_REASON,
  NUMBERED_CONTINUATION_RHYTHM_REASON,
  NUMBERED_CONTINUATION_SPACE_REASON,
} from "./numbered-rhythm";
import { validateNumberedMarks } from "./numbered-marks";
import { planNumberedEventRhythm } from "./numbered-timeline";
import { numberedRhythmForTicks } from "./numbered-input-ranges";
import { planNumberedSequenceOverwrite, numberedSequenceContent, type NumberedSequenceTarget } from "./numbered-sequence-overwrite";
export { planNumberedSequenceOverwrite, planNumberedSequenceSlots } from "./numbered-sequence-overwrite";
import type { ILXMIdFactory } from "../id-factory";
import type {
  ILXMNumberedEvent,
  ILXMNumberedMark,
  ILXMNumberedTuplet,
  ILXMTrack,
  ILXMRhythm,
  ILXMTupletRatio,
} from "../types";

interface Base {
  trackId: string;
  expectedRevision?: number;
  confirmedRemovedMarkIds?: string[];
  confirmedChangedMarkIds?: string[];
}
type NumberedTupletOperation =
  | { type: "numbered.tuplet.add"; measureId: string; eventIds: string[]; ratio?: ILXMTupletRatio }
  | {
      type: "numbered.tuplet.createInBeat";
      measureId: string;
      /** 小节内完整四分拍的起点。 */
      startTick: number;
    }
  | { type: "numbered.tuplet.remove"; measureId: string; tupletId: string };
export type ILXMNumberedTupletCommand = Base & NumberedTupletOperation;
export type ILXMNumberedVoiceCommand = Base &
  (
    | {
        type: "numbered.sequence.set";
        measureId: string;
        eventId: string;
        items: NumberedSequenceItem[];
        allowOverwrite: boolean;
      }
    | {
        type: "numbered.sequence.overwrite";
        measureId: string;
        startTick: number;
        items: NumberedSequenceItem[];
        rhythms?: ILXMRhythm[];
        /** 旧录入偏好可逐格回退，和本次显式选择的 rhythms 分开。 */
        preferredRhythm?: ILXMRhythm;
        allowOverwrite: boolean;
      }
    | {
        type: "numbered.sequence.insert";
        measureId: string;
        startTick: number;
        endTick: number;
        items: NumberedSequenceItem[];
        rhythms: ILXMRhythm[];
      }
    | {
        type: "numbered.event.set";
        measureId: string;
        eventId: string;
        itemId?: string;
        tokens: string[];
      }
    | {
        type: "numbered.range.replace";
        measureId: string;
        startTick: number;
        endTick: number;
        items: NumberedSequenceItem[];
        rhythms: ILXMRhythm[];
        ratio?: ILXMTupletRatio;
        allowOverwrite: boolean;
      }
    | {
        type: "numbered.range.paste";
        measureId: string;
        startTick: number;
        mode: "insert" | "overwrite";
        allowOverwrite?: boolean;
        clipboard: NumberedClipboard;
        /** 简谱菜单仅覆盖简谱。目标歌词受保护，旧调用仍可按原语义携带歌词。 */
        numberedOnly?: true;
      }
    | {
        type: "numbered.event.setRhythm";
        measureId: string;
        eventId: string;
        rhythm: ILXMRhythm;
        tokens?: string[];
        /** 兼容旧调用参数；两种值均使用固定窗和相邻附点互补规划。 */
        timeline?: "preservePositions" | "editTimeline";
      }
    | {
        type: "numbered.event.remove" | "numbered.event.split";
        measureId: string;
        eventId: string;
      }
    | { type: "numbered.event.merge"; measureId: string; eventIds: string[] }
    | NumberedTupletOperation
    | { type: "numbered.mark.add"; mark: NumberedMarkDraft }
    | { type: "numbered.mark.update"; markId: string; mark: NumberedMarkDraft }
    | { type: "numbered.mark.remove"; markId: string }
  );
export type NumberedMarkDraft = ILXMNumberedMark extends infer M
  ? M extends ILXMNumberedMark
    ? Omit<M, "id">
    : never
  : never;
export type NumberedCandidate =
  | {
      ok: true;
      track: ILXMTrack;
      changed: boolean;
      removedMarkIds: string[];
      changedMarkIds: string[];
      focusEventId?: string;
      measureId?: string;
      overwrittenEventIds: string[];
      movedEventIds: string[];
      resizedEventIds: string[];
      releasedRange?: { startTick: number; endTick: number };
      nextFocus?: { eventId: string } | { tick: number; endTick: number };
      sequenceTargets?: NumberedSequenceTarget[];
      sequenceAvailableTicks?: number;
    }
  | {
      ok: false;
      code:
        | "NUMBERED_INVALID"
        | "NUMBERED_OVERLAP"
        | "NUMBERED_PARTIAL_RANGE"
        | "NUMBERED_IMPACT_REQUIRED";
      message: string;
      removedMarkIds?: string[];
      changedMarkIds?: string[];
    };
type NumberedFailure = Extract<NumberedCandidate, { ok: false }>;
const failure = (
  message: string,
  code: NumberedFailure["code"] = "NUMBERED_INVALID",
): NumberedFailure => ({ ok: false, code, message });

const numberedTripletRatio = { actual: 3, normal: 2 } as const;
const numberedTripletEighth: ILXMRhythm = { base: "eighth", dots: 0 };

/** 添加、拍内转换与移除共用声部和记号校验。纯校验可省略 ID 工厂。 */
const editNumberedTuplet = (
  track: ILXMTrack,
  command: ILXMNumberedTupletCommand,
  factory?: Pick<ILXMIdFactory, "createNumberedTupletId" | "createNumberedEventId">,
): NumberedCandidate => {
  if (track.id !== command.trackId) return failure("简谱轨道不存在");
  const { measureId } = command;
  const measure = track.measures.find((m) => m.id === measureId);
  if (!measure) return failure("简谱小节不存在");
  // 省略比例的旧调用继续创建三连音。跨小节组只接受已有 3:2 规则，其他比例在同小节内变换。
  const ratio = command.type === "numbered.tuplet.add" ? command.ratio ?? numberedTripletRatio : numberedTripletRatio;
  if (command.type === "numbered.tuplet.add") {
    if (!isSupportedTupletRatio(ratio)) return failure("不支持该简谱连音比例");
    if (command.eventIds.some(id => !measure.numberedVoice.events.some(event => event.id === id))) {
      if (ratio.actual !== 3 || ratio.normal !== 2) return failure("该连音比例只能在同一小节内使用");
      return addNumberedCrossBarTuplet(track, measure, command, factory);
    }
  }
  if (command.type === "numbered.tuplet.remove") {
    // 组只存于首小节。工具也可从原次小节发出移除命令，组仍以全局 ID 识别。
    const owner = track.measures.find(item => item.numberedVoice.tuplets.some(group =>
      group.id === command.tupletId && group.crossBar && (item.id === measureId || group.crossBar.nextMeasureId === measureId)));
    const crossBar = owner?.numberedVoice.tuplets.find(group => group.id === command.tupletId);
    if (owner && crossBar) return removeNumberedCrossBarTuplet(track, owner, crossBar);
  }
  const capacity = getMeasureDurationTicks(measure);
  const context = createNumberedTrackRhythmContext(track);
  let { events, tuplets } = measure.numberedVoice;
  const movedEventIds: string[] = [];
  const resizedEventIds: string[] = [];
  let addedGroup: ILXMNumberedTuplet | undefined;
  let addedGap: ILXMNumberedEvent | undefined;
  let unfoldsToThreeEighths = false;

  if (command.type === "numbered.tuplet.add") {
    // 按谱面顺序取选区，支持反向框选；按所选比例检查成员数量和实际时间是否相接。
    const selectedIds = new Set(command.eventIds);
    const selected = events.filter((e) => selectedIds.has(e.id));
    const [first] = selected;
    if (
      command.eventIds.length !== ratio.actual ||
      selected.length !== ratio.actual ||
      !first ||
      selected.some((e) => e.kind !== "notes")
    )
      return failure(`请选择同一小节内的 ${ratio.actual} 个普通简谱音事件`);
    if (selected.some(event => context.tupletByEventId.has(event.id)))
      return failure("已有简谱连音组的成员不能再次归组");
    if (selected.some((e) => e.rhythm.base !== first.rhythm.base || e.rhythm.dots !== first.rhythm.dots))
      return failure("简谱连音成员的书写时值须一致");
    const written = calculateRhythmTicks(first.rhythm);
    if (!written.ok || (written.ticks * ratio.normal) % ratio.actual !== 0)
      return failure("简谱连音实际时值无法表示为整数 tick");
    const firstIndex = events.indexOf(first);
    if (selected.some((e, i) => e !== events[firstIndex + i] || e.tick !== first.tick + i * written.ticks))
      return failure(`请选择 ${ratio.actual} 个时间连续且中间无空位的简谱音事件`);

    // 固定首音与组外事件。2:3 延长时必须既不碰后续事件，也不越过实际小节边界。
    // 仅改组内起点与实际时值，书写节奏、事件与音符 ID 保留，歌词仍挂在原事件。
    const step = (written.ticks * ratio.normal) / ratio.actual;
    const nextEvent = events[firstIndex + selected.length];
    if (first.tick + step * selected.length > (nextEvent?.tick ?? capacity))
      return failure("本小节连续空位不足，连音会占到后续事件或越过小节线", "NUMBERED_OVERLAP");
    const eventIds = selected.map((e) => e.id);
    movedEventIds.push(...eventIds.slice(1));
    resizedEventIds.push(...eventIds);
    events = events.map((e, i) =>
      selectedIds.has(e.id) && i !== firstIndex
        ? { ...e, tick: first.tick + (i - firstIndex) * step }
        : e,
    );
    addedGroup = { id: "", eventIds, ratio: { ...ratio } };
  } else if (command.type === "numbered.tuplet.createInBeat") {
    const { startTick } = command;
    const endTick = startTick + TICKS_PER_QUARTER;
    const beatGroups = getTimeSignatureBeatGroupTicks(measure.timeSignature);
    if (measure.timeSignature.denominator !== 4 || !beatGroups?.includes(TICKS_PER_QUARTER))
      return failure("当前拍号不支持在本拍创建八分三连音");
    // 沿既有拍组定位，实际小节时长可能短于拍号容量。末拍恰好结束于小节边界时可转换。
    let beatStart = 0;
    const isQuarterBeat = beatGroups.some((ticks) => {
      const matches = beatStart === startTick && ticks === TICKS_PER_QUARTER;
      beatStart += ticks;
      return matches;
    });
    if (!isQuarterBeat || endTick > capacity)
      return failure("请选择小节内完整的四分拍，三连音不能跨小节");

    if (startTick < (context.incomingSustainEndTickByMeasureId.get(measure.id) ?? 0))
      return failure("本拍范围不能切断跨小节简谱连音组", "NUMBERED_PARTIAL_RANGE");
    const selected: { event: ILXMNumberedEvent; duration: number }[] = [];
    for (const event of events) {
      if (event.tick >= endTick) break;
      const duration = context.getEventDurationTicks(event);
      if (!duration.ok) return failure("简谱实际时值无法表示为整数 tick");
      if (event.tick + duration.ticks <= startTick) continue;
      if (context.tupletByEventId.has(event.id))
        return failure("已有简谱连音组的成员不能再次归组");
      if (event.tick < startTick || event.tick + duration.ticks > endTick)
        return failure("本拍范围不能切断简谱事件", "NUMBERED_PARTIAL_RANGE");
      selected.push({ event, duration: duration.ticks });
    }

    const sourceBases =
      selected.length === 2 ? ["eighth", "eighth"] : ["eighth", "sixteenth", "sixteenth"];
    let cursor = startTick;
    const matchesSource =
      selected.length === sourceBases.length &&
      selected.every(({ event, duration }, index) => {
        const matches =
          event.tick === cursor &&
          event.kind === "notes" &&
          event.rhythm.base === sourceBases[index] &&
          event.rhythm.dots === 0;
        cursor += duration;
        return matches;
      });
    if (!matchesSource || cursor !== endTick)
      return failure("本拍须为两个普通八分音符，或前八后十六的三个普通音符");

    // 统一为三个书写八分音槽。原音按顺序保留事件与音符 ID，歌词和弧线仍引用原端点。
    const slotTicks = TICKS_PER_QUARTER / numberedTripletRatio.actual;
    const members = selected.map(({ event }, index) => {
      const tick = startTick + index * slotTicks;
      if (event.tick !== tick) movedEventIds.push(event.id);
      resizedEventIds.push(event.id);
      return { ...event, tick, rhythm: { ...numberedTripletEighth } };
    });
    if (members.length === 2) {
      // 用实际连音成员表示待填位，因此现有简谱输入可以直接在第三槽录入。
      // 合法持久化 ID 非空，占位 ID 只在候选里联结事件与连音组。
      addedGap = {
        id: "",
        tick: startTick + 2 * slotTicks,
        rhythm: { ...numberedTripletEighth },
        kind: "gap",
        items: [],
      };
      members.push(addedGap);
    }
    const firstIndex = events.indexOf(selected[0]!.event);
    events = [
      ...events.slice(0, firstIndex),
      ...members,
      ...events.slice(firstIndex + selected.length),
    ];
    addedGroup = {
      id: "",
      eventIds: members.map((event) => event.id),
      ratio: { ...numberedTripletRatio },
    };
  } else {
    const group = tuplets.find((g) => g.id === command.tupletId);
    if (!group) return failure("简谱连音组不存在");
    const eventsById = new Map(events.map((e) => [e.id, e]));
    const first = eventsById.get(group.eventIds[0]!);
    if (!first) return failure("简谱连音组成员不存在");
    let cursor = first.tick;
    const changes = new Map<string, number>();
    for (const id of group.eventIds) {
      const e = eventsById.get(id);
      if (!e) return failure("简谱连音组成员不存在");
      const duration = calculateRhythmTicks(e.rhythm);
      if (!duration.ok) return failure("书写时值无效");
      changes.set(id, cursor);
      cursor += duration.ticks;
    }

    // 旧连音组的无歌词缺项还原为空白；有歌词的缺项仍是锚点。声部按原顺序校验，拦截扩展挤占或越过组外事件。
    const lyricEventIds = new Set(measure.lyrics.map((lyric) => lyric.eventId));
    // 使用组的书写时值识别三八分展开，已保存的连音组同样沿用容量校验。
    unfoldsToThreeEighths =
      group.ratio.actual === numberedTripletRatio.actual &&
      group.ratio.normal === numberedTripletRatio.normal &&
      group.eventIds.every((id) => {
        const event = eventsById.get(id)!;
        return (
          event.rhythm.base === numberedTripletEighth.base &&
          event.rhythm.dots === numberedTripletEighth.dots &&
          (event.kind !== "gap" || lyricEventIds.has(id))
        );
      });
    events = events.flatMap((e) => {
      const tick = changes.get(e.id);
      if (tick === undefined) return [e];
      if (e.kind === "gap" && !lyricEventIds.has(e.id)) return [];
      resizedEventIds.push(e.id);
      if (tick === e.tick) return [e];
      movedEventIds.push(e.id);
      return [{ ...e, tick }];
    });
    tuplets = tuplets.filter((g) => g !== group);
  }

  if (addedGroup) {
    tuplets = [...tuplets, addedGroup].sort(
      (a, b) =>
        events.findIndex((e) => e.id === a.eventIds[0]) -
        events.findIndex((e) => e.id === b.eventIds[0]),
    );
  }
  const voice = { events, tuplets };
  const next = {
    ...track,
    measures: track.measures.map((m) => m === measure ? { ...m, numberedVoice: voice } : m),
  };
  const invalid = findInvalidNumberedTrack(next)?.message;
  if (invalid) {
    if (unfoldsToThreeEighths)
      return failure(`本拍空间不足，无法展开成三个普通八分音符（${invalid}）`, "NUMBERED_OVERLAP");
    return failure(
      command.type === "numbered.tuplet.remove" ? `无法移除简谱连音组：${invalid}` : invalid,
      "NUMBERED_OVERLAP",
    );
  }
  // 连接端点可能跨小节。若任一记号失效，整笔拒绝，避免走通用的删除确认流程。
  const markError = next.numberedMarks.length ? validateNumberedMarks(next) : null;
  if (markError) return failure(`简谱连音修改与现有记号冲突：${markError}`);
  // 校验完整候选后再分配 ID，确保预览或记号冲突不会占用组与空位的身份。
  if (addedGroup && factory) {
    if (addedGap) {
      addedGap.id = factory.createNumberedEventId();
      addedGroup.eventIds[addedGroup.eventIds.length - 1] = addedGap.id;
    }
    addedGroup.id = factory.createNumberedTupletId();
  }
  return {
    ok: true,
    track: next,
    changed: true,
    measureId,
    removedMarkIds: [],
    changedMarkIds: [],
    overwrittenEventIds: [],
    movedEventIds,
    resizedEventIds,
  };
};

/** 工具栏可使用纯校验结果，无需申请 ID 或通过文档命令入口生成指纹。 */
export const previewNumberedTupletEdit = (
  track: ILXMTrack,
  command: ILXMNumberedTupletCommand,
): { ok: true } | NumberedFailure => {
  const candidate = editNumberedTuplet(track, command);
  return candidate.ok ? { ok: true } : candidate;
};

/** 将输入种类规范化为简谱事件，不从 TAB 读取节奏。 */
const content = (tokens: string[], factory: ILXMIdFactory) => {
  if (!tokens.length) return { kind: "gap" as const, items: [] as [] };
  const items = tokens.map((token) => ({
    id: factory.createNumberedItemId(),
    token,
  }));
  if (tokens[0] === "0") return { kind: "rest" as const, items };
  if (tokens[0] === "-") return { kind: "continuation" as const, items };
  return { kind: "notes" as const, items };
};
/** 候选修改与技巧维护一次完成；preview 模式返回同一影响列表。 */
export const editNumberedTrack = (
  track: ILXMTrack,
  command: ILXMNumberedVoiceCommand,
  factory: ILXMIdFactory,
  preview = false,
): NumberedCandidate => {
  if (command.type === "numbered.tuplet.createInBeat")
    return editNumberedTuplet(track, command, preview ? undefined : factory);
  if (command.type === "numbered.tuplet.add" || command.type === "numbered.tuplet.remove")
    return editNumberedTuplet(track, command, factory);
  let next = track;
  let focusEventId: string | undefined;
  let measureId: string | undefined;
  let overwrittenEventIds: string[] = [];
  let movedEventIds: string[] = [];
  let resizedEventIds: string[] = [];
  let releasedRange: { startTick: number; endTick: number } | undefined;
  let nextFocus: Extract<NumberedCandidate, { ok: true }>["nextFocus"];
  let sequenceTargets: NumberedSequenceTarget[] | undefined;
  let sequenceAvailableTicks: number | undefined;
  if (command.type.startsWith("numbered.mark.")) {
    if (!("markId" in command) && !("mark" in command))
      return failure("简谱标记命令无效");
    if (
      "markId" in command &&
      !track.numberedMarks.some((m) => m.id === command.markId)
    )
      return failure("简谱标记不存在");
    if (command.type === "numbered.mark.remove")
      next = {
        ...track,
        numberedMarks: track.numberedMarks.filter(
          (m) => m.id !== command.markId,
        ),
      };
    if (
      command.type === "numbered.mark.add" ||
      command.type === "numbered.mark.update"
    ) {
      const id =
        command.type === "numbered.mark.update"
          ? command.markId
          : factory.createNumberedMarkId();
      const mark: ILXMNumberedMark = { ...command.mark, id };
      next = {
        ...track,
        numberedMarks: [
          ...track.numberedMarks.filter((m) => m.id !== id),
          mark,
        ],
      };
    }
    const error = validateNumberedMarks(next);
    if (error) return failure(error);
  } else if (command.type === "numbered.sequence.set" || command.type === "numbered.sequence.overwrite") {
    const planned = planNumberedSequenceOverwrite(track, command);
    if (!planned.ok) return failure(planned.message);
    sequenceTargets = planned.targets;
    sequenceAvailableTicks = planned.availableTicks;
    // 整个后音被显式时值覆盖时，传给现有影响确认，避免从空位录入时静默删音。
    overwrittenEventIds = planned.removedEventIds;
    const removed = new Set(planned.removedEventIds);
    next = {
      ...track,
      measures: track.measures.map(m => {
        const targets = planned.targets.filter(target => target.measureId === m.id);
        if (!targets.length) return m;
        const updates = new Map<string, ILXMNumberedEvent>();
        const created: ILXMNumberedEvent[] = [];
        for (const target of targets) {
          if (target.item.kind === "skip") continue;
          const previous = m.numberedVoice.events.find(event => event.id === target.eventId);
          const same = previous && JSON.stringify(previous.items.map(item => item.token)) === JSON.stringify(target.item.tokens);
          const event: ILXMNumberedEvent = {
            ...(same ? previous : numberedSequenceContent(previous, target.item.tokens, () => factory.createNumberedItemId())),
            id: previous?.id ?? factory.createNumberedEventId(), tick: target.startTick,
            rhythm: target.rhythm,
          };
          if (previous) updates.set(previous.id, event);
          else created.push(event);
        }
        for (const remainder of planned.gapRemainders) {
          if (remainder.measureId !== m.id) continue;
          const gap: ILXMNumberedEvent = {
            id: remainder.eventId ?? factory.createNumberedEventId(),
            tick: remainder.tick,
            rhythm: remainder.rhythm,
            kind: "gap",
            items: [],
          };
          if (remainder.eventId) updates.set(gap.id, gap);
          else created.push(gap);
        }
        return { ...m, numberedVoice: { ...m.numberedVoice, events: [...m.numberedVoice.events.filter(event => !removed.has(event.id)).map(event => updates.get(event.id) ?? event), ...created].sort((a, b) => a.tick - b.tick) } };
      }),
    };
    measureId = command.measureId;
    const first = planned.targets[0]!;
    focusEventId = next.measures.find(m => m.id === first.measureId)?.numberedVoice.events.find(event => event.tick === first.startTick)?.id;
    if (focusEventId) nextFocus = { eventId: focusEventId };
    else nextFocus = { tick: first.startTick, endTick: first.endTick };
  } else if ("measureId" in command) {
    measureId = command.measureId;
    const measure = track.measures.find((m) => m.id === measureId);
    if (!measure) return failure("简谱小节不存在");
    let events = measure.numberedVoice.events;
    let lyrics = measure.lyrics;
    let tuplets = measure.numberedVoice.tuplets;
    const context = createNumberedTrackRhythmContext(track);
    const grouped = (id: string) => context.tupletByEventId.has(id);
    const crossBarMember = (id: string) => !!context.tupletByEventId.get(id)?.crossBar;
    const incomingEnd = context.incomingSustainEndTickByMeasureId.get(measure.id) ?? 0;
    const event =
      "eventId" in command
        ? events.find((e) => e.id === command.eventId)
        : undefined;
    if ("eventId" in command && !event) return failure("简谱事件不存在");
    // 单事件按钮、键入和带时值的提交统一使用批量规划的固定延音窗口。
    if ((command.type === "numbered.event.set" && !command.itemId && command.tokens.length === 1 && command.tokens[0] === "-" && event!.kind !== "continuation") ||
        (command.type === "numbered.event.setRhythm" && command.tokens?.length === 1 && command.tokens[0] === "-" && event!.kind !== "continuation")) {
      return editNumberedTrack(track, {
        ...command,
        type: "numbered.sequence.set",
        items: [{ kind: "set", tokens: ["-"] }],
        allowOverwrite: true,
      }, factory, preview);
    }
    if (command.type === "numbered.sequence.insert") {
      const { startTick, endTick, items, rhythms } = command;
      if (
        !Number.isInteger(startTick) ||
        !Number.isInteger(endTick) ||
        startTick < 0 ||
        endTick <= startTick ||
        endTick > getMeasureDurationTicks(measure) ||
        !items.length ||
        items.length > 256 ||
        rhythms.length !== items.length
      )
        return failure("简谱空白窗口或录入时值无效");
      if (startTick < incomingEnd)
        return failure("简谱空白窗口遇到跨小节简谱连音组", "NUMBERED_OVERLAP");
      let cursor = startTick;
      const created: ILXMNumberedEvent[] = [];
      for (const [index, item] of items.entries()) {
        const continuation = item.kind === "set" && item.tokens[0] === "-";
        const rhythm = continuation ? numberedContinuationRhythm(measure.timeSignature) : rhythms[index];
        if (!rhythm) return failure(NUMBERED_CONTINUATION_METER_REASON);
        const duration = calculateRhythmTicks(rhythm);
        if (!duration.ok) return failure("简谱时值无效");
        if (cursor + duration.ticks > endTick)
          return failure(
            continuation ? NUMBERED_CONTINUATION_SPACE_REASON : "录入超出空白窗口，请缩短时值或减少内容",
            "NUMBERED_OVERLAP",
          );
        if (continuation) {
          const issue = numberedContinuationIssue(track, measure, cursor, cursor + duration.ticks, context);
          if (issue) return failure(issue, "NUMBERED_OVERLAP");
        }
        if (
          events.some((event) => {
            const d = context.getEventDurationTicks(event);
            return (
              !d.ok ||
              (event.tick < cursor + duration.ticks &&
                event.tick + d.ticks > cursor)
            );
          })
        )
          return failure(
            "连续录入遇到已有简谱，请在空白范围内录入",
            "NUMBERED_OVERLAP",
          );
        if (item.kind === "set") {
          if (item.tokens.length && !validNumberedTokens(item.tokens))
            return failure("简谱内容无效");
          created.push({
            id: factory.createNumberedEventId(),
            tick: cursor,
            rhythm: { ...rhythm },
            ...content(item.tokens, factory),
          });
        }
        cursor += duration.ticks;
      }
      events = [...events, ...created].sort((a, b) => a.tick - b.tick);
      focusEventId = created.at(-1)?.id;
      const following = events.find((event) => event.tick >= cursor);
      if (following?.tick === cursor) nextFocus = { eventId: following.id };
      else if (cursor < getMeasureDurationTicks(measure)) {
        nextFocus = {
          tick: cursor,
          endTick: Math.min(
            endTick > cursor ? endTick : Infinity,
            following?.tick ?? getMeasureDurationTicks(measure),
          ),
        };
      }
    } else if (command.type === "numbered.event.set") {
      if (command.tokens.length && !validNumberedTokens(command.tokens))
        return failure("简谱音高无效");
      if (command.itemId) {
        if (
          command.tokens.length !== 1 ||
          event!.kind !== "notes" ||
          !event!.items.some((i) => i.id === command.itemId) ||
          ["0", "-"].includes(command.tokens[0]!)
        )
          return failure("请选择明确的简谱音符");
        events = events.map((e) =>
          e !== event
            ? e
            : {
                ...event,
                items: event.items.map((i) =>
                  i.id === command.itemId
                    ? { ...i, token: command.tokens[0]! }
                    : i,
                ),
              },
        );
      } else if (
        JSON.stringify(event!.items.map((i) => i.token)) !==
        JSON.stringify(command.tokens)
      ) {
        events = events.map((e) =>
          e !== event ? e : { ...event, ...content(command.tokens, factory) },
        );
      }
      focusEventId = event!.id;
    } else if (command.type === "numbered.event.setRhythm") {
      const tokens = command.tokens;
      if (tokens && !validNumberedTokens(tokens)) return failure("简谱音高无效");
      if (event!.kind === "continuation") return failure(NUMBERED_CONTINUATION_RHYTHM_REASON);
      if (grouped(event!.id)) return failure("连音成员须整组修改时值");
      const planned = planNumberedEventRhythm(
        measure,
        event!.id,
        command.rhythm,
        context,
      );
      if (!planned.ok) return failure(planned.message, "NUMBERED_OVERLAP");
      events = planned.voice.events;
      if (tokens && JSON.stringify(tokens) !== JSON.stringify(event!.items.map((item) => item.token))) {
        events = events.map((item) => item.id === event!.id
          ? { ...item, ...numberedSequenceContent(item, tokens, () => factory.createNumberedItemId()) }
          : item);
      }
      movedEventIds = planned.movedEventIds;
      overwrittenEventIds = planned.overwrittenEventIds;
      resizedEventIds = planned.resizedEventIds.filter(
        (id) => id !== event!.id,
      );
      releasedRange = planned.releasedRange;
      // 普通时值缩短后保留所选网格，避免释放区被 TAB/贪心规划合回一个长空位。
      // 附点仍沿用相邻互补与原有空白语义，保证加点/取消的往返不产生新事件。
      if (releasedRange && event!.rhythm.base !== command.rhythm.base) {
        const duration = calculateRhythmTicks(command.rhythm);
        if (duration.ok) {
          const blanks: ILXMNumberedEvent[] = [];
          let tick = releasedRange.startTick;
          for (; tick + duration.ticks <= releasedRange.endTick; tick += duration.ticks) {
            blanks.push({ id: factory.createNumberedEventId(), tick, rhythm: { ...command.rhythm }, kind: "gap", items: [] });
          }
          const remaining = releasedRange.endTick - tick;
          if (remaining > 0) {
            const exact = numberedRhythmForTicks(remaining);
            const parts = exact ? { ok: true as const, rhythms: [exact] } : createRestRhythmsForTicks(remaining);
            // 不可编码的小尾量保留为原有隐式空白，不取整或扩展时间窗。
            if (parts.ok) for (const rhythm of parts.rhythms) {
              const span = calculateRhythmTicks(rhythm);
              if (!span.ok) break;
              blanks.push({ id: factory.createNumberedEventId(), tick, rhythm: { ...rhythm }, kind: "gap", items: [] });
              tick += span.ticks;
            }
          }
          events = [...events, ...blanks].sort((a, b) => a.tick - b.tick);
        }
      }
      focusEventId = event!.id;
    } else if (command.type === "numbered.event.remove") {
      events = grouped(event!.id)
        ? events.map((e) =>
            e !== event ? e : { ...e, kind: "gap" as const, items: [] },
          )
        : events.filter((e) => e !== event);
    } else if (command.type === "numbered.range.replace") {
      const { startTick: start, endTick: end } = command;
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 0 ||
        start >= end ||
        end > getMeasureDurationTicks(measure) ||
        command.items.length !== command.rhythms.length ||
        !command.items.length ||
        command.items.length > 256
      )
        return failure("简谱时间窗口或模板无效");
      const affected = events.filter((e) => {
        const d = context.getEventDurationTicks(e);
        return d.ok && e.tick < end && e.tick + d.ticks > start;
      });
      if (
        start < incomingEnd ||
        affected.some(event => crossBarMember(event.id)) ||
        affected.some((e) => {
          const d = context.getEventDurationTicks(e);
          return e.tick < start || !d.ok || e.tick + d.ticks > end;
        }) ||
        tuplets.some(
          (g) =>
            g.eventIds.some((id) => affected.some((e) => e.id === id)) &&
            !g.eventIds.every((id) => affected.some((e) => e.id === id)),
        )
      )
        return failure(
          "范围不能切断事件或连音组，请扩大选区",
          "NUMBERED_PARTIAL_RANGE",
        );
      let cursor = start;
      const created: ILXMNumberedEvent[] = [];
      for (const [i, item] of command.items.entries()) {
        const previous = affected.find((e) => e.tick === cursor);
        const continuation = item.kind === "set" && item.tokens[0] === "-";
        const existingContinuation = continuation && previous?.kind === "continuation";
        const rhythm = existingContinuation ? previous.rhythm
          : continuation ? numberedContinuationRhythm(measure.timeSignature) : command.rhythms[i];
        if (!rhythm) return failure(NUMBERED_CONTINUATION_METER_REASON);
        // 连音比例会缩短延音的实际长度，固定窗模板不能用它录入延音。
        if (continuation && command.ratio) return failure("简谱连音组不能录入固定时值的延音。");
        const d = calculateRhythmTicks(rhythm);
        if (!d.ok) return failure("简谱时值无效");
        const numerator = d.ticks * (command.ratio?.normal ?? 1),
          denominator = command.ratio?.actual ?? 1;
        if (!denominator || numerator % denominator)
          return failure("简谱比例不能表示为整数 tick");
        const ticks = numerator / denominator;
        if (continuation && !existingContinuation) {
          if (cursor + ticks > end) return failure(NUMBERED_CONTINUATION_SPACE_REASON);
          const issue = numberedContinuationIssue(track, measure, cursor, cursor + ticks, context);
          if (issue) return failure(issue, "NUMBERED_OVERLAP");
        }
        if (item.kind === "set") {
          if (!validNumberedTokens(item.tokens)) return failure("简谱输入无效");
          const same =
            previous &&
            JSON.stringify(previous.rhythm) === JSON.stringify(rhythm) &&
            JSON.stringify(previous.items.map((x) => x.token)) ===
              JSON.stringify(item.tokens);
          if (previous && !same && !command.allowOverwrite)
            return failure("请确认允许覆盖已有简谱");
          created.push(
            same
              ? previous
              : {
                  id: factory.createNumberedEventId(),
                  tick: cursor,
                  rhythm: { ...rhythm },
                  ...content(item.tokens, factory),
                },
          );
        } else if (previous) {
          const old = context.getEventDurationTicks(previous);
          if (!old.ok || old.ticks !== ticks)
            return failure("跳过项必须匹配已有事件时长");
          created.push(previous);
        } else if (command.ratio)
          created.push({
            id: factory.createNumberedEventId(),
            tick: cursor,
            rhythm: { ...rhythm },
            kind: "gap",
            items: [],
          });
        cursor += ticks;
      }
      if (cursor !== end)
        return failure(
          `模板时长 ${cursor - start} tick 与窗口 ${end - start} tick 不一致`,
        );
      if (
        affected.length &&
        !command.allowOverwrite &&
        affected.some((e) => !created.includes(e))
      )
        return failure("请确认允许覆盖已有简谱");
      tuplets = tuplets.filter(
        (g) => !g.eventIds.some((id) => affected.some((e) => e.id === id)),
      );
      if (command.ratio) {
        const existing = measure.numberedVoice.tuplets.find(
          (g) =>
            JSON.stringify(g.eventIds) ===
              JSON.stringify(created.map((e) => e.id)) &&
            JSON.stringify(g.ratio) === JSON.stringify(command.ratio),
        );
        tuplets = [
          ...tuplets,
          existing ?? {
            id: factory.createNumberedTupletId(),
            eventIds: created.map((e) => e.id),
            ratio: { ...command.ratio },
          },
        ];
      }
      events = [
        ...events.filter((e) => !affected.includes(e)),
        ...created,
      ].sort((a, b) => a.tick - b.tick);
      focusEventId = created[0]?.id;
    } else if (command.type === "numbered.range.paste") {
      const checked = validateNumberedClipboard(command.clipboard, track);
      if (!checked.ok) return failure(checked.message);
      const c = checked.clipboard,
        start = command.startTick,
        end = start + c.totalTicks;
      if (
        !Number.isInteger(start) ||
        start < 0 ||
        end > getMeasureDurationTicks(measure)
      )
        return failure("简谱粘贴超过小节容量");
      const touched = events.filter((e) => {
        const d = context.getEventDurationTicks(e);
        return (
          d.ok &&
          (command.mode === "insert"
            ? e.tick < start && e.tick + d.ticks > start
            : e.tick < end && e.tick + d.ticks > start)
        );
      });
      if (start < incomingEnd || touched.some(event => crossBarMember(event.id)) ||
          (command.mode === "insert" && events.some(event => event.tick >= start && crossBarMember(event.id))))
        return failure("粘贴范围不能覆盖或移动跨小节简谱连音组，请先移除该组", "NUMBERED_PARTIAL_RANGE");
      const ids = new Set(touched.map((e) => e.id));
      // 歌词绑定事件而非拍点。即使目标是空槽，或调用方已允许覆盖，也不能删除它的歌词锚点。
      if (command.numberedOnly && lyrics.some((lyric) => ids.has(lyric.eventId)))
        return failure("写入范围有关联歌词，请选择其他简谱位置。");
      if (
        (command.mode === "insert" && touched.length) ||
        (command.mode === "overwrite" &&
          touched.some((e) => {
            const d = context.getEventDurationTicks(e);
            return e.tick < start || !d.ok || e.tick + d.ticks > end;
          }))
      )
        return failure("粘贴范围切断简谱事件", "NUMBERED_PARTIAL_RANGE");
      if (
        command.mode === "overwrite" &&
        touched.length &&
        !command.allowOverwrite
      )
        return failure("请确认允许覆盖已有简谱");
      if (
         tuplets.some((g) => {
          if (g.crossBar) return false; // 跨小节组已按实际占用和就地起音保护。
          const first = events.find((e) => e.id === g.eventIds[0])!,
            last = events.find((e) => e.id === g.eventIds.at(-1))!;
          const d = context.getEventDurationTicks(last);
          return command.mode === "insert"
            ? d.ok && first.tick < start && last.tick + d.ticks > start
            : g.eventIds.some((id) => ids.has(id)) &&
                !g.eventIds.every((id) => ids.has(id));
        })
      )
        return failure("粘贴范围切断简谱连音组", "NUMBERED_PARTIAL_RANGE");
      const copied = copyNumberedVoices(
        { ...track, numberedMarks: c.marks },
        [{ ...measure, numberedVoice: c.voice }],
        factory,
      );
      const voice = copied.voices[0]!;
      lyrics = [
        ...lyrics.filter((lyric) => !ids.has(lyric.eventId)),
        ...(command.numberedOnly ? [] : c.lyrics).map((lyric) => ({
          ...lyric,
          id: factory.createLyricId(),
          eventId: copied.ids.get(lyric.eventId)!,
        })),
      ];
      events = [
        ...events
          .filter((e) => !ids.has(e.id))
          .map((e) =>
            command.mode === "insert" && e.tick >= start
              ? { ...e, tick: e.tick + c.totalTicks }
              : e,
          ),
        ...voice.events.map((e) => ({ ...e, tick: e.tick + start })),
      ].sort((a, b) => a.tick - b.tick);
      tuplets = [
        ...tuplets.filter((g) => !g.eventIds.some((id) => ids.has(id))),
        ...voice.tuplets,
      ];
      next = {
        ...next,
        numberedMarks: [...next.numberedMarks, ...copied.marks],
      };
      focusEventId = voice.events[0]?.id;
    } else if (command.type === "numbered.event.split") {
      if (event!.kind === "continuation") return failure(NUMBERED_CONTINUATION_RHYTHM_REASON);
      if (grouped(event!.id)) return failure("连音成员不能单独拆分");
      const base =
        LXM_RHYTHM_BASES[LXM_RHYTHM_BASES.indexOf(event!.rhythm.base) + 1];
      const d = context.getEventDurationTicks(event!);
      if (!base || !d.ok || d.ticks % 2) return failure("该简谱时值不能等分");
      const first = { ...event!, rhythm: { ...event!.rhythm, base } };
      const second: ILXMNumberedEvent = {
        ...first,
        id: factory.createNumberedEventId(),
        tick: first.tick + d.ticks / 2,
        ...content(
          first.items.map((i) => i.token),
          factory,
        ),
      };
      const remap = new Map(
        first.items.map((i, index) => [i.id, second.items[index]!.id]),
      );
      const marks = track.numberedMarks.map((m) =>
        m.type === "tie" && remap.has(m.fromItemId)
          ? { ...m, fromItemId: remap.get(m.fromItemId)! }
          : m.type === "slur" && m.toEventId === first.id
            ? { ...m, toEventId: second.id }
            : m.type === "fermata" && m.eventId === first.id
              ? { ...m, eventId: second.id }
              : m,
      );
      if (first.kind === "notes")
        first.items.forEach((i) =>
          marks.push({
            id: factory.createNumberedMarkId(),
            type: "tie",
            fromItemId: i.id,
            toItemId: remap.get(i.id)!,
          }),
        );
      next = { ...next, numberedMarks: marks };
      events = events.flatMap((e) => (e !== event ? [e] : [first, second]));
      focusEventId = first.id;
    } else if (command.type === "numbered.event.merge") {
      const range = command.eventIds.map((id) =>
        events.find((e) => e.id === id),
      );
      if (range.length < 2 || range.some((e) => !e || grouped(e.id)))
        return failure("请选择完整非连音的简谱合并范围");
      const selected = range as ILXMNumberedEvent[];
      if (selected.some((event) => event.kind === "continuation")) return failure(NUMBERED_CONTINUATION_RHYTHM_REASON);
      const first = selected[0]!;
      if (
        !selected.every(
          (e, i) =>
            events.indexOf(e) === events.indexOf(first) + i &&
            e.kind === first.kind,
        )
      )
        return failure("合并事件须同类且连续");
      let ticks = 0;
      const itemMap = new Map<string, string>();
      const consumed = new Set<string>();
      for (const [i, e] of selected.entries()) {
        const d = context.getEventDurationTicks(e);
        if (!d.ok || e.tick !== first.tick + ticks)
          return failure("合并时间必须连续");
        ticks += d.ticks;
        if (!i) e.items.forEach((item) => itemMap.set(item.id, item.id));
        else if (first.kind === "notes") {
          const last = selected[i - 1]!;
          for (const item of e.items) {
            const tie = track.numberedMarks.find(
              (m) =>
                m.type === "tie" &&
                m.toItemId === item.id &&
                last.items.some((x) => x.id === m.fromItemId),
            );
            if (!tie || tie.type !== "tie")
              return failure("合并普通音需要完整延音线链");
            itemMap.set(item.id, itemMap.get(tie.fromItemId)!);
            consumed.add(tie.id);
          }
          if (e.items.length !== first.items.length)
            return failure("合并音组必须一一对应");
        }
      }
      let rhythm: ILXMRhythm | undefined;
      for (const base of LXM_RHYTHM_BASES)
        for (const dots of [0, 1, 2]) {
          const r = { base, dots };
          const d = calculateRhythmTicks(r);
          if (d.ok && d.ticks === ticks) rhythm ??= r;
        }
      if (!rhythm) return failure("合计时长无法写成单个简谱音");
      const ids = new Set(selected.map((e) => e.id));
      const lastId = selected.at(-1)!.id;
      if (
        track.numberedMarks.some(
          (m) =>
            (m.type === "slur" &&
              ((ids.has(m.fromEventId) && m.fromEventId !== first.id) ||
                (ids.has(m.toEventId) && m.toEventId !== lastId))) ||
            (m.type === "fermata" &&
              ids.has(m.eventId) &&
              m.eventId !== lastId),
        )
      )
        return failure("合并会丢失内部简谱表现记号，请先移除");
      next = {
        ...next,
        numberedMarks: track.numberedMarks
          .filter((m) => !consumed.has(m.id))
          .map((m) =>
            m.type === "tie"
              ? {
                  ...m,
                  fromItemId: itemMap.get(m.fromItemId) ?? m.fromItemId,
                  toItemId: itemMap.get(m.toItemId) ?? m.toItemId,
                }
              : m.type === "slur"
                ? {
                    ...m,
                    fromEventId: ids.has(m.fromEventId)
                      ? first.id
                      : m.fromEventId,
                    toEventId: ids.has(m.toEventId) ? first.id : m.toEventId,
                  }
                : { ...m, eventId: ids.has(m.eventId) ? first.id : m.eventId },
          ),
      };
      events = events.flatMap((e) =>
        e === first
          ? [{ ...first, rhythm: rhythm! }]
          : ids.has(e.id)
            ? []
            : [e],
      );
      focusEventId = first.id;
    }
    const voice = {
      events,
      tuplets: [...tuplets].sort(
        (a, b) =>
          events.findIndex((e) => e.id === a.eventIds[0]) -
          events.findIndex((e) => e.id === b.eventIds[0]),
      ),
    };
    next = {
      ...next,
      measures: track.measures.map((m) =>
        m !== measure
          ? m
          : {
              ...m,
              numberedVoice: voice,
              lyrics: [...lyrics].sort(
                (a, b) =>
                  events.findIndex((event) => event.id === a.eventId) -
                    events.findIndex((event) => event.id === b.eventId) ||
                  a.verse - b.verse,
              ),
            },
      ),
    };
  }
  // 仅清理因内容改变失效的旧关系，新增关系冲突不能悄悄删除旧关系。
  if (!command.type.startsWith("numbered.mark.")) {
    const invalid = findInvalidNumberedTrack(next);
    if (invalid) return failure(invalid.message, "NUMBERED_OVERLAP");
    next = {
      ...next,
      measures: next.measures.map((measure) => ({
        ...measure,
        lyrics: measure.lyrics.filter((lyric) =>
          measure.numberedVoice.events.some(
            (event) =>
              event.id === lyric.eventId &&
              (event.kind === "notes" || event.kind === "gap"),
          ),
        ),
      })),
    };
    const index = buildNumberedIndex(next);
    const oldMarkIds = new Set(track.numberedMarks.map((m) => m.id));
    // 粘贴副本属于新关系，非法时拒绝整笔动作，不能当成旧关系静默清理。
    if (
      next.numberedMarks.some(
        (m) =>
          !oldMarkIds.has(m.id) &&
          validateNumberedMarks({ ...next, numberedMarks: [m] }, index),
      )
    )
      return failure("新增或复制的简谱标记无效，整笔操作未应用");
    next = {
      ...next,
      numberedMarks: next.numberedMarks.filter(
        (m) => !validateNumberedMarks({ ...next, numberedMarks: [m] }, index),
      ),
    };
  }
  const removedMarkIds = track.numberedMarks
    .filter((m) => !next.numberedMarks.some((n) => n.id === m.id))
    .map((m) => m.id)
    .sort();
  const changedMarkIds = track.numberedMarks
    .filter((m) =>
      next.numberedMarks.some(
        (n) => n.id === m.id && JSON.stringify(n) !== JSON.stringify(m),
      ),
    )
    .map((m) => m.id)
    .sort();
  const explicitRemoval = command.type === "numbered.mark.remove";
  if (
    !preview &&
    !explicitRemoval &&
    (removedMarkIds.length || changedMarkIds.length) &&
    (JSON.stringify([...(command.confirmedRemovedMarkIds ?? [])].sort()) !==
      JSON.stringify(removedMarkIds) ||
      JSON.stringify([...(command.confirmedChangedMarkIds ?? [])].sort()) !==
        JSON.stringify(changedMarkIds))
  )
    return {
      ok: false,
      code: "NUMBERED_IMPACT_REQUIRED",
      message: "请确认简谱技巧删除或迁移影响",
      removedMarkIds,
      changedMarkIds,
    };
  const error = validateNumberedMarks(next);
  if (error) return failure(error);
  return {
    ok: true,
    track: next,
    changed: JSON.stringify(next) !== JSON.stringify(track),
    removedMarkIds,
    changedMarkIds,
    focusEventId,
    measureId,
    overwrittenEventIds,
    movedEventIds,
    resizedEventIds,
    releasedRange,
    nextFocus,
    sequenceTargets,
    sequenceAvailableTicks,
  };
};
