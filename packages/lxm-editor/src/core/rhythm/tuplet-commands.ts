/** 连音命令的纯小节规划；文档提交与历史由统一分发器负责。 */
import type {
  ILXMSetTupletCommand,
  ILXMRemoveTupletCommand,
  ILXMScoreCommandErrorCode,
} from "../commands/commands";
import type { ILXMIdFactory } from "../id-factory";
import type { ILXMMeasure } from "../types";
import {
  isSameTupletRatio,
  isSupportedTupletRatio,
  createMeasureRhythmContext,
} from "./tuplet";
import { reconcileMeasureTimeline } from "./measure-timeline";
import { isPureTabContinuationBeat } from "./tab-continuation";

type Result =
  | { ok: true; changed: boolean; measure: ILXMMeasure }
  | { ok: false; code: ILXMScoreCommandErrorCode; message: string };
export const editMeasureTuplet = (
  measure: ILXMMeasure,
  command: ILXMSetTupletCommand | ILXMRemoveTupletCommand,
  factory: ILXMIdFactory,
  externalProtectedBeatIds: ReadonlySet<string> = new Set(),
): Result => {
  const fail = (code: ILXMScoreCommandErrorCode, message: string): Result => ({
    ok: false,
    code,
    message,
  });
  let memberIds: string[];
  let tuplets = measure.tuplets;
  if (command.type === "tuplet.remove") {
    const group = tuplets.find((group) => group.id === command.tupletId);
    if (!group) return fail("TUPLET_NOT_FOUND", "目标连音组不存在");
    if (measure.beats.some((beat) => group.beatIds.includes(beat.id) && isPureTabContinuationBeat(beat)))
      return fail("INVALID_BEAT_OPERATION", "请先把连音组中的延音标记改为普通音符或休止，再修改连音组");
    memberIds = group.beatIds;
    tuplets = tuplets.filter((item) => item.id !== group.id);
  } else {
    if (!isSupportedTupletRatio(command.ratio))
      return fail("UNSUPPORTED_TUPLET_RATIO", "不支持该连音比例");
    const start = measure.beats.findIndex(
      (beat) => beat.id === command.startBeatId,
    );
    const end = measure.beats.findIndex(
      (beat) => beat.id === command.endBeatId,
    );
    if (start < 0 || end < start)
      return fail("TUPLET_RANGE_INVALID", "请选择同小节内按时间排序的连续节拍");
    const members = measure.beats.slice(start, end + 1);
    if (members.some(isPureTabContinuationBeat))
      return fail("INVALID_BEAT_OPERATION", "延音标记固定占一个单位拍，不能设为连音成员");
    memberIds = members.map((beat) => beat.id);
    if (members.length !== command.ratio.actual)
      return fail(
        "TUPLET_MEMBER_COUNT_MISMATCH",
        `该比例需要 ${command.ratio.actual} 个节拍`,
      );
    const first = members[0]!;
    if (
      members.some(
        (beat) =>
          beat.rhythm.base !== first.rhythm.base ||
          beat.rhythm.dots !== first.rhythm.dots,
      )
    )
      return fail(
        "TUPLET_RHYTHM_MISMATCH",
        "连音成员的书写时值和附点必须完全相同",
      );
    const selected = new Set(memberIds);
    const overlaps = tuplets.filter((group) =>
      group.beatIds.some((id) => selected.has(id)),
    );
    const existing = overlaps.find(
      (group) =>
        group.beatIds.length === memberIds.length &&
        group.beatIds.every((id, index) => id === memberIds[index]),
    );
    if (overlaps.some((group) => !group.beatIds.every((id) => selected.has(id))))
      return fail("TUPLET_OVERLAP", "请扩大选区以覆盖完整的原连音组");
    if (existing && isSameTupletRatio(existing.ratio, command.ratio))
      return { ok: true, changed: false, measure };
    const group = {
      id: existing?.id ?? factory.createTupletId(),
      beatIds: memberIds,
      ratio: { ...command.ratio },
    };
    tuplets = [...tuplets.filter((item) => !overlaps.includes(item)), group].sort(
      (a, b) =>
        measure.beats.findIndex((beat) => beat.id === a.beatIds[0]) -
        measure.beats.findIndex((beat) => beat.id === b.beatIds[0]),
    );
    const context = createMeasureRhythmContext({ ...measure, tuplets });
    for (const beat of members) {
      const duration = context.getBeatDurationTicks(beat);
      if (!duration.ok)
        return fail(duration.code, "连音实际时长无法精确表示为整数 tick");
    }
  }
  // 移除关系后仍保护原成员，包括尾部全休止组，防止成员被容量缓冲吞掉。
  const result = reconcileMeasureTimeline(
    { ...measure, tuplets },
    {
      createBeatId: factory.createBeatId,
      protectedBeatIds: new Set([...memberIds, ...externalProtectedBeatIds]),
    },
  );
  if (!result.ok)
    return fail(
      result.code,
      result.code === "MEASURE_OVERFLOW"
        ? "小节容量不足，无法保留全部连音成员"
        : "剩余容量无法精确分解为休止符",
    );
  return { ok: true, changed: true, measure: result.measure };
};
