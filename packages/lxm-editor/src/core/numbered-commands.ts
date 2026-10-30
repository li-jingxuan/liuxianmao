import {
  validateNumberedClipboard,
  type NumberedClipboard,
} from "./numbered-clipboard";
import { copyNumberedVoices } from "./numbered-copy";
import {
  validNumberedTokens,
  type NumberedSequenceItem,
} from "./numbered-notation";
import { calculateRhythmTicks, getMeasureCapacityTicks } from "./rhythm";
import { LXM_RHYTHM_BASES } from "./constants";
import {
  createNumberedRhythmContext,
  buildNumberedIndex,
  validateNumberedVoice,
} from "./numbered-rhythm";
import { validateNumberedMarks } from "./numbered-marks";
import { planNumberedEventRhythm } from "./numbered-timeline";
import type { ILXMIdFactory } from "./id-factory";
import type {
  ILXMNumberedEvent,
  ILXMNumberedMark,
  ILXMTrack,
  ILXMRhythm,
  ILXMTupletRatio,
} from "./types";

interface Base {
  trackId: string;
  expectedRevision?: number;
  confirmedRemovedMarkIds?: string[];
  confirmedChangedMarkIds?: string[];
}
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
      }
    | {
        type: "numbered.event.setRhythm";
        measureId: string;
        eventId: string;
        rhythm: ILXMRhythm;
        timeline?: "preservePositions" | "editTimeline";
      }
    | {
        type: "numbered.event.remove" | "numbered.event.split";
        measureId: string;
        eventId: string;
      }
    | { type: "numbered.event.merge"; measureId: string; eventIds: string[] }
    | { type: "numbered.tuplet.remove"; measureId: string; tupletId: string }
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
const failure = (
  message: string,
  code: Extract<NumberedCandidate, { ok: false }>["code"] = "NUMBERED_INVALID",
): NumberedCandidate => ({ ok: false, code, message });
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
  let next = track;
  let focusEventId: string | undefined;
  let measureId: string | undefined;
  let overwrittenEventIds: string[] = [];
  let movedEventIds: string[] = [];
  let resizedEventIds: string[] = [];
  let releasedRange: { startTick: number; endTick: number } | undefined;
  let nextFocus: Extract<NumberedCandidate, { ok: true }>["nextFocus"];
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
  } else if (command.type === "numbered.sequence.set") {
    const rows = track.measures.flatMap((m) =>
      m.numberedVoice.events.map((e) => ({ m, e })),
    );
    const start = rows.findIndex(
      ({ m, e }) => m.id === command.measureId && e.id === command.eventId,
    );
    if (
      start < 0 ||
      !command.items.length ||
      command.items.length > 256 ||
      start + command.items.length > rows.length
    )
      return failure("简谱事件不足或目标失效，整批未应用");
    const updates = new Map<string, ILXMNumberedEvent>();
    for (const [i, item] of command.items.entries()) {
      if (item.kind === "skip") continue;
      if (item.tokens.length && !validNumberedTokens(item.tokens))
        return failure("简谱内容无效");
      const e = rows[start + i]!.e;
      if (
        JSON.stringify(e.items.map((x) => x.token)) ===
        JSON.stringify(item.tokens)
      )
        continue;
      if (e.items.length && !command.allowOverwrite)
        return failure("请确认允许覆盖已有简谱");
      updates.set(e.id, { ...e, ...content(item.tokens, factory) });
    }
    next = {
      ...track,
      measures: track.measures.map((m) => ({
        ...m,
        numberedVoice: {
          ...m.numberedVoice,
          events: m.numberedVoice.events.map((e) => updates.get(e.id) ?? e),
        },
      })),
    };
    measureId = command.measureId;
    focusEventId = command.eventId;
  } else if ("measureId" in command) {
    measureId = command.measureId;
    const measure = track.measures.find((m) => m.id === measureId);
    if (!measure) return failure("简谱小节不存在");
    let events = measure.numberedVoice.events;
    let lyrics = measure.lyrics;
    let tuplets = measure.numberedVoice.tuplets;
    const context = createNumberedRhythmContext(measure.numberedVoice);
    const grouped = (id: string) => context.tupletByEventId.has(id);
    const event =
      "eventId" in command
        ? events.find((e) => e.id === command.eventId)
        : undefined;
    if ("eventId" in command && !event) return failure("简谱事件不存在");
    if (command.type === "numbered.sequence.insert") {
      const { startTick, endTick, items, rhythms } = command;
      if (
        !Number.isInteger(startTick) ||
        !Number.isInteger(endTick) ||
        startTick < 0 ||
        endTick <= startTick ||
        endTick > getMeasureCapacityTicks(measure.timeSignature) ||
        !items.length ||
        items.length > 256 ||
        rhythms.length !== items.length
      )
        return failure("简谱空白窗口或录入时值无效");
      let cursor = startTick;
      const created: ILXMNumberedEvent[] = [];
      for (const [index, item] of items.entries()) {
        const rhythm = rhythms[index]!;
        const duration = calculateRhythmTicks(rhythm);
        if (!duration.ok) return failure("简谱时值无效");
        if (cursor + duration.ticks > endTick)
          return failure(
            "录入超出空白窗口，请缩短时值或减少内容",
            "NUMBERED_OVERLAP",
          );
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
      else if (cursor < getMeasureCapacityTicks(measure.timeSignature)) {
        nextFocus = {
          tick: cursor,
          endTick: Math.min(
            endTick > cursor ? endTick : Infinity,
            following?.tick ?? getMeasureCapacityTicks(measure.timeSignature),
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
      if (grouped(event!.id)) return failure("连音成员须整组修改时值");
      if (command.timeline === "editTimeline") {
        const planned = planNumberedEventRhythm(
          measure,
          event!.id,
          command.rhythm,
        );
        if (!planned.ok) return failure(planned.message, "NUMBERED_OVERLAP");
        events = planned.voice.events;
        movedEventIds = planned.movedEventIds;
        resizedEventIds = planned.resizedEventIds.filter(
          (id) => id !== event!.id,
        );
        releasedRange = planned.releasedRange;
        focusEventId = event!.id;
      } else {
        const previous = context.getEventDurationTicks(event!),
          duration = calculateRhythmTicks(command.rhythm);
        if (!previous.ok || !duration.ok) return failure("简谱时值无效");
        const endTick = event!.tick + duration.ticks;
        if (endTick > getMeasureCapacityTicks(measure.timeSignature))
          return failure("简谱时值超出小节容量", "NUMBERED_OVERLAP");
        const covered = events.filter(
          (e) => e !== event && e.tick >= event!.tick && e.tick < endTick,
        );
        if (
          covered.some((e) => {
            const d = context.getEventDurationTicks(e);
            return !d.ok || e.tick + d.ticks > endTick;
          })
        )
          return failure(
            "新时值终点切断后续音符，请调整范围",
            "NUMBERED_PARTIAL_RANGE",
          );
        if (covered.some((e) => grouped(e.id)))
          return failure(
            "时值扩展不能覆盖连音组，请使用整组窗口编辑",
            "NUMBERED_PARTIAL_RANGE",
          );
        overwrittenEventIds = covered.map((e) => e.id);
        if (duration.ticks < previous.ticks)
          releasedRange = {
            startTick: endTick,
            endTick: event!.tick + previous.ticks,
          };
        const removed = new Set(overwrittenEventIds);
        // 保留当前音符身份与起点；完整覆盖后续事件，不推移其后的音乐时间。
        events = events
          .filter((e) => !removed.has(e.id))
          .map((e) =>
            e !== event ? e : { ...e, rhythm: { ...command.rhythm } },
          );
        focusEventId = event!.id;
      }
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
        end > getMeasureCapacityTicks(measure.timeSignature) ||
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
        const rhythm = command.rhythms[i]!;
        const d = calculateRhythmTicks(rhythm);
        if (!d.ok) return failure("简谱时值无效");
        const numerator = d.ticks * (command.ratio?.normal ?? 1),
          denominator = command.ratio?.actual ?? 1;
        if (!denominator || numerator % denominator)
          return failure("简谱比例不能表示为整数 tick");
        const ticks = numerator / denominator;
        const previous = affected.find((e) => e.tick === cursor);
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
        end > getMeasureCapacityTicks(measure.timeSignature)
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
      const ids = new Set(touched.map((e) => e.id));
      if (
        tuplets.some((g) => {
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
        ...c.lyrics.map((lyric) => ({
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
    } else if (command.type === "numbered.tuplet.remove") {
      const group = tuplets.find((g) => g.id === command.tupletId);
      if (!group) return failure("简谱连音组不存在");
      let cursor = events.find((e) => e.id === group.eventIds[0])!.tick;
      const changes = new Map<string, number>();
      for (const id of group.eventIds) {
        const e = events.find((e) => e.id === id)!;
        const d = calculateRhythmTicks(e.rhythm);
        if (!d.ok) return failure("书写时值无效");
        changes.set(id, cursor);
        cursor += d.ticks;
      }
      events = events
        .filter((e) => !(changes.has(e.id) && e.kind === "gap"))
        .map((e) =>
          changes.has(e.id) ? { ...e, tick: changes.get(e.id)! } : e,
        )
        .sort((a, b) => a.tick - b.tick);
      tuplets = tuplets.filter((g) => g !== group);
    } else if (command.type === "numbered.event.split") {
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
    const invalid = validateNumberedVoice(
      voice,
      getMeasureCapacityTicks(measure.timeSignature),
    );
    if (invalid) return failure(invalid, "NUMBERED_OVERLAP");
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
  };
};
