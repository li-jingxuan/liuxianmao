import { z } from "zod";
import { LXMNumberedVoiceSchema, LXMNumberedMarkSchema } from "./schema";
import {
  createNumberedRhythmContext,
  validateNumberedVoice,
} from "./numbered-rhythm";
import { validateNumberedMarks } from "./numbered-marks";
import type { ILXMDocument, ILXMTrack } from "./types";
const schema = z
  .object({
    format: z.literal("lxm-numbered-clipboard"),
    version: z.literal(2),
    layers: z.literal("numbered"),
    tab: z.null(),
    voice: LXMNumberedVoiceSchema,
    marks: z.array(LXMNumberedMarkSchema),
    totalTicks: z.number().int().positive(),
    omissions: z.array(z.string()),
  })
  .strict();
export type NumberedClipboard = z.infer<typeof schema>;
export interface NumberedClipboardRange {
  trackId: string;
  measureId: string;
  startTick: number;
  endTick: number;
}
/** 简谱专用载荷不含 TAB 时钟或虚构 Beat，容量校验使用真实复制范围。 */
export const validateNumberedClipboard = (input: unknown, track: ILXMTrack) => {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, message: "简谱快照格式无效，请重新复制" };
  const c = parsed.data;
  const ids = [
    ...c.voice.events.flatMap((e) => [e.id, ...e.items.map((i) => i.id)]),
    ...c.voice.tuplets.map((g) => g.id),
    ...c.marks.map((m) => m.id),
  ];
  if (new Set(ids).size !== ids.length)
    return { ok: false as const, message: "简谱快照 ID 重复" };
  const error =
    validateNumberedVoice(c.voice, c.totalTicks) ||
    validateNumberedMarks({
      ...track,
      measures: [{ ...track.measures[0]!, numberedVoice: c.voice }],
      numberedMarks: c.marks,
    });
  return error
    ? { ok: false as const, message: error }
    : { ok: true as const, clipboard: c };
};
/** 复制只输出独立值对象，跨范围连接报告遗漏，不截短事件。 */
export const createNumberedClipboard = (
  document: ILXMDocument,
  range: NumberedClipboardRange,
) => {
  const track = document.score.tracks.find((t) => t.id === range.trackId),
    m = track?.measures.find((m) => m.id === range.measureId);
  if (
    !track ||
    !m ||
    !Number.isInteger(range.startTick) ||
    !Number.isInteger(range.endTick) ||
    range.startTick < 0 ||
    range.startTick >= range.endTick ||
    range.endTick >
      (m.timeSignature.numerator * 3840) / m.timeSignature.denominator
  )
    return { ok: false as const, message: "简谱复制范围无效" };
  const context = createNumberedRhythmContext(m.numberedVoice);
  const events = m.numberedVoice.events.filter((e) => {
    const d = context.getEventDurationTicks(e);
    return d.ok && e.tick < range.endTick && e.tick + d.ticks > range.startTick;
  });
  const ids = new Set(events.map((e) => e.id)),
    items = new Set(events.flatMap((e) => e.items.map((i) => i.id)));
  if (
    events.length > 256 ||
    events.some((e) => {
      const d = context.getEventDurationTicks(e);
      return (
        !d.ok || e.tick < range.startTick || e.tick + d.ticks > range.endTick
      );
    }) ||
    m.numberedVoice.tuplets.some(
      (g) =>
        g.eventIds.some((id) => ids.has(id)) &&
        !g.eventIds.every((id) => ids.has(id)),
    )
  )
    return { ok: false as const, message: "简谱复制不能切断事件或连音组" };
  const marks = track.numberedMarks.filter((m) =>
    m.type === "tie"
      ? items.has(m.fromItemId) && items.has(m.toItemId)
      : m.type === "slur"
        ? ids.has(m.fromEventId) && ids.has(m.toEventId)
        : ids.has(m.eventId),
  );
  return validateNumberedClipboard(
    {
      format: "lxm-numbered-clipboard",
      version: 2,
      layers: "numbered",
      tab: null,
      voice: {
        events: events.map((e) => ({
          ...structuredClone(e),
          tick: e.tick - range.startTick,
        })),
        tuplets: m.numberedVoice.tuplets
          .filter((g) => g.eventIds.every((id) => ids.has(id)))
          .map((g) => structuredClone(g)),
      },
      marks: structuredClone(marks),
      totalTicks: range.endTick - range.startTick,
      omissions: track.numberedMarks
        .filter(
          (m) =>
            !marks.includes(m) &&
            (m.type === "tie"
              ? items.has(m.fromItemId) || items.has(m.toItemId)
              : m.type === "slur"
                ? ids.has(m.fromEventId) || ids.has(m.toEventId)
                : false),
        )
        .map((m) => m.id),
    },
    track,
  );
};
