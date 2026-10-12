import type { ILXMDocument } from "./types";

export interface NumberedNotation {
  tokens: string[];
}
export type NumberedSequenceItem =
  | { kind: "skip" }
  | { kind: "set"; tokens: string[] };
export interface NumberedTarget {
  trackId: string;
  measureId: string;
  beatId: string;
}
/** 简谱编码仅表达音级、升降号及八度点，不参与 TAB 时值或音高推导。 */
export const isNumberedToken = (value: unknown): value is string =>
  typeof value === "string" &&
  /^(?:0|-|[#b]?[1-7](?:'{1,3}|\.{1,3})?)$/.test(value);
export const validNumberedTokens = (tokens: unknown): tokens is string[] =>
  Array.isArray(tokens) &&
  tokens.length >= 1 &&
  tokens.length <= 8 &&
  tokens.every(isNumberedToken) &&
  (tokens.length === 1 || tokens.every((t) => t !== "0" && t !== "-"));
/** 单拍与批次共享语法，空格只分拍，+ 只分同拍多音。 */
export const parseNumberedSequence = (
  raw: string,
):
  | { ok: true; items: NumberedSequenceItem[] }
  | { ok: false; message: string } => {
  if (typeof raw !== "string" || [...raw].length > 16384)
    return { ok: false, message: "简谱输入最多 16384 个字符。" };
  if (
    [...raw].some(
      (c) =>
        (/\s/u.test(c) && c !== " " && c !== "\u3000") ||
        c.codePointAt(0)! <= 31 ||
        (c.codePointAt(0)! >= 127 && c.codePointAt(0)! <= 159),
    )
  )
    return {
      ok: false,
      message: "只支持半角或全角空格分隔，不接受换行或制表符。",
    };
  const parts = raw.split(/[ \u3000]+/u).filter(Boolean);
  if (!parts.length || parts.length > 256 || parts.every((t) => t === "_"))
    return { ok: false, message: "每批须有有效简谱，最多对应 256 拍。" };
  const items: NumberedSequenceItem[] = [];
  for (const [i, part] of parts.entries()) {
    if (part === "_") items.push({ kind: "skip" });
    else {
      const tokens = part.split("+");
      if (!validNumberedTokens(tokens))
        return {
          ok: false,
          message: `第 ${i + 1} 项简谱无效；同拍多音用 +，高音用 '，低音用 .。`,
        };
      items.push({ kind: "set", tokens });
    }
  }
  return { ok: true, items };
};
/** 预览和命令共用真实 Beat 顺序，包含休止与连音成员，超出谱尾整批拒绝。 */
export const planNumberedSequence = (
  document: ILXMDocument,
  start: NumberedTarget,
  items: readonly NumberedSequenceItem[],
  allowOverwrite = false,
) => {
  const beats =
    document.score.tracks
      .find((t) => t.id === start.trackId)
      ?.measures.flatMap((m, mi) =>
        m.beats.map((b, bi) => ({ m, b, mi, bi })),
      ) ?? [];
  const offset = beats.findIndex(
    ({ m, b }) => m.id === start.measureId && b.id === start.beatId,
  );
  let issue: string | null = null,
    changes = 0,
    overwrites = 0;
  if (offset < 0) issue = "简谱起始拍已失效。";
  if (
    !Array.isArray(items) ||
    !items.length ||
    items.length > 256 ||
    !items.some((i) => i?.kind === "set")
  )
    issue = "每批须有有效简谱，最多 256 拍。";
  const rows = (Array.isArray(items) ? items : []).map((item, index) => {
    const entry = offset >= 0 ? beats[offset + index] : undefined;
    const previous = entry?.b.numberedNotation?.tokens.join("+") ?? null;
    let status: "add" | "change" | "same" | "skip" | "error" =
      item?.kind === "skip" ? "skip" : "add";
    const valid =
      item?.kind === "skip" ||
      (item?.kind === "set" && validNumberedTokens(item.tokens));
    if (!valid || !entry) {
      status = "error";
      issue ??= "简谱内容无效或谱尾拍数不足，整批未应用。";
    } else if (item.kind === "set") {
      const value = item.tokens.join("+");
      status = previous === value ? "same" : previous ? "change" : "add";
      if (status !== "same") changes++;
      if (status === "change") overwrites++;
    }
    return {
      index,
      item,
      target: entry
        ? { ...start, measureId: entry.m.id, beatId: entry.b.id }
        : null,
      measureNumber: entry ? entry.mi + 1 : null,
      beatNumber: entry ? entry.bi + 1 : null,
      previous,
      status,
    };
  });
  if (overwrites && !allowOverwrite)
    issue ??= `将替换 ${overwrites} 项已有简谱，请先确认允许覆盖。`;
  return { rows, issue, changes, overwrites };
};
