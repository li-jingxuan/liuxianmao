import { buildNumberedIndex } from "./numbered-rhythm";
import type { ILXMNumberedMark, ILXMTrack } from "./types";

/** 同音比较不把还原号和未升降音误判为不同音。 */
const pitchKey = (token: string) => token.replace(/^n/, "");
export const numberedMarkEventIds = (
  track: ILXMTrack,
  mark: ILXMNumberedMark,
): string[] => {
  const index = buildNumberedIndex(track);
  if (mark.type === "fermata") return [mark.eventId];
  if (mark.type === "slur") return [mark.fromEventId, mark.toEventId];
  return [
    index.items.get(mark.fromItemId)?.event.id,
    index.items.get(mark.toItemId)?.event.id,
  ].filter((id): id is string => !!id);
};
/** 所有入口共享端点、音乐时间、结构边界和重复关系校验。 */
export const validateNumberedMarks = (
  track: ILXMTrack,
  prepared = buildNumberedIndex(track),
): string | null => {
  const { events, items } = prepared;
  const incoming = new Set<string>(),
    outgoing = new Set<string>(),
    keys = new Set<string>();
  const slurs: { start: number; end: number }[] = [];
  for (const mark of track.numberedMarks) {
    let key: string;
    if (mark.type === "fermata") {
      const e = events.get(mark.eventId)?.event;
      if (!e || (e.kind !== "notes" && e.kind !== "rest"))
        return "延长记号需要真实简谱音或休止";
      key = `fermata:${mark.eventId}`;
    } else {
      const from =
        mark.type === "tie"
          ? items.get(mark.fromItemId)
          : events.get(mark.fromEventId);
      const to =
        mark.type === "tie"
          ? items.get(mark.toItemId)
          : events.get(mark.toEventId);
      if (
        !from ||
        !to ||
        from.event.kind !== "notes" ||
        to.event.kind !== "notes" ||
        from.start >= to.start
      )
        return "简谱连接两端需要按时间顺序的普通音";
      for (let i = from.measureIndex; i < to.measureIndex; i++) {
        if (!["single", "double"].includes(track.measures[i]!.barline))
          return "简谱连接不能跨反复或终止边界";
      }
      if (mark.type === "tie") {
        const a = items.get(mark.fromItemId)!,
          b = items.get(mark.toItemId)!;
        if (a.order + 1 !== b.order || a.end !== b.start)
          return "简谱延音线需要时间连续的相邻音";
        if (pitchKey(a.item.token) !== pitchKey(b.item.token))
          return "简谱延音线两端音高须相同";
        if (outgoing.has(mark.fromItemId) || incoming.has(mark.toItemId))
          return "同一简谱音不能重复添加入线或出线";
        outgoing.add(mark.fromItemId);
        incoming.add(mark.toItemId);
        key = `tie:${mark.fromItemId}:${mark.toItemId}`;
      } else {
        slurs.push({ start: from.start, end: to.start });
        key = `slur:${mark.fromEventId}:${mark.toEventId}`;
      }
    }
    if (keys.has(key)) return "简谱记号重复";
    keys.add(key);
  }
  // 排序后用包含栈验证交叉范围，避免对全部标记做两两扫描。
  slurs.sort((a, b) => a.start - b.start || b.end - a.end);
  const stack: { start: number; end: number }[] = [];
  for (const range of slurs) {
    while (stack.length && stack.at(-1)!.end <= range.start) stack.pop();
    const parent = stack.at(-1);
    if (parent && range.start > parent.start && range.end > parent.end)
      return "简谱连音线不能形成交叉范围";
    stack.push(range);
    if (stack.length > 8) return "简谱连音线最多嵌套八层";
  }
  return null;
};
