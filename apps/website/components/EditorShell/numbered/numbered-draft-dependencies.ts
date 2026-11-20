import { createNumberedRhythmContext, parseNumberedSequence, planNumberedEventRhythm, planNumberedSequenceOverwrite, planNumberedSequenceSlots, type ILXMMeasure, type ILXMNumberedVoiceCommand, type ILXMTrack } from "@liuxianmao/lxm-editor";

export const numberedSequenceRangeText = (measure: ILXMMeasure, startTick: number, endTick: number): string => {
  const items = planNumberedSequenceSlots(measure).filter(slot => slot.startTick >= startTick && slot.startTick < endTick).map(slot => {
    const event = measure.numberedVoice.events.find(event => event.id === slot.eventId);
    return event?.items.map(item => item.token).join("+") || "_";
  });
  return items.some(item => item !== "_") ? items.join(" ") : "";
};

/** 当前内容组只依赖事件身份/位置/内容；时值组可独立提交而不改变 raw 基线。 */
export const numberedContentDependency = (
  track: ILXMTrack,
  measureId: string,
  eventId: string | undefined,
  raw: string,
  operation?: ILXMNumberedVoiceCommand | null,
): string => {
  const events = track.measures.flatMap((measure) =>
    measure.numberedVoice.events.map((event) => ({
      measureId: measure.id,
      event,
    })),
  );
  const start = events.findIndex(
    (row) => row.measureId === measureId && row.event.id === eventId,
  );
  const parsed = parseNumberedSequence(raw);
  if (operation?.type === "numbered.event.setRhythm" && operation.tokens) {
    const measure = track.measures.find(item => item.id === operation.measureId);
    if (!measure) return "missing measure";
    const plan = planNumberedEventRhythm(measure, operation.eventId, operation.rhythm);
    const affected = new Set(plan.ok
      ? [operation.eventId, ...plan.movedEventIds, ...plan.resizedEventIds, ...plan.overwrittenEventIds]
      : [operation.eventId]);
    return JSON.stringify({
      issue: plan.ok ? null : plan.message,
      events: measure.numberedVoice.events.filter(event => affected.has(event.id)),
    });
  }
  if (operation?.type === "numbered.range.replace" || operation?.type === "numbered.sequence.insert") {
    const measure = track.measures.find(measure => measure.id === operation.measureId);
    if (!measure) return "missing measure";
    const context = createNumberedRhythmContext(measure.numberedVoice);
    return JSON.stringify({
      slots: planNumberedSequenceSlots(measure).filter(slot => slot.startTick < operation.endTick && slot.endTick > operation.startTick),
      events: measure.numberedVoice.events.filter(event => {
        const duration = context.getEventDurationTicks(event);
        return duration.ok && event.tick < operation.endTick && event.tick + duration.ticks > operation.startTick;
      }),
    });
  }
  if (operation?.type === "numbered.sequence.overwrite" || operation?.type === "numbered.sequence.set") {
    const plan = planNumberedSequenceOverwrite(track, { ...operation, allowOverwrite: true });
    if (plan.ok) {
      const explicit = operation.type === "numbered.sequence.overwrite" && !!operation.rhythms;
      // A reflow can consume old events between planned onsets. Snapshot the
      // entire written interval, including events removed by the operation.
      return JSON.stringify(track.measures.flatMap(measure => {
        const targets = plan.targets.filter(target => target.measureId === measure.id);
        if (!targets.length) return [];
        const context = createNumberedRhythmContext(measure.numberedVoice);
        const start = targets[0]!.startTick, end = targets.at(-1)!.endTick;
        return [{ measureId: measure.id,
          targets: targets.map(target => target.eventId && !explicit ? { eventId: target.eventId, startTick: target.startTick } : { startTick: target.startTick, endTick: target.endTick, rhythm: target.rhythm, ratio: target.ratio }),
          events: measure.numberedVoice.events.filter(event => {
            const duration = context.getEventDurationTicks(event);
            return duration.ok && event.tick < end && event.tick + duration.ticks > start;
          }).map(event => ({ id: event.id, tick: event.tick, items: event.items, ...(explicit ? { rhythm: event.rhythm } : {}) })),
        }];
      }));
    }
    // A newly protected boundary must also invalidate the original draft.
    return JSON.stringify({ invalidPlan: plan.message, measures: track.measures });
  }
  if (eventId && parsed.ok) {
    const plan = planNumberedSequenceOverwrite(track, { measureId, eventId, items: parsed.items, allowOverwrite: true });
    if (plan.ok) return JSON.stringify(plan.targets.map(target => {
      const event = track.measures.find(measure => measure.id === target.measureId)?.numberedVoice.events.find(event => event.id === target.eventId);
      return event ? { measureId: target.measureId, id: event.id, tick: event.tick, items: event.items }
        : { measureId: target.measureId, tick: target.startTick, endTick: target.endTick, rhythm: target.rhythm };
    }));
  }
  const relevant =
    start >= 0
      ? events.slice(
          start,
          start + (parsed.ok ? Math.max(1, parsed.items.length) : 1),
        )
      : events.filter((row) => row.measureId === measureId);
  return JSON.stringify(
    relevant.map(({ measureId, event }) => ({
      measureId,
      id: event.id,
      tick: event.tick,
      items: event.items,
    })),
  );
};
