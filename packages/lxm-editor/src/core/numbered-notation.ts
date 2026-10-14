export interface NumberedNotation {
  tokens: string[];
}
export type NumberedSequenceItem =
  | { kind: "skip" }
  | { kind: "set"; tokens: string[] };
/** 简谱编码仅表达音级、升降号及八度点，不参与 TAB 时值或音高推导。 */
export const isNumberedToken = (value: unknown): value is string =>
  typeof value === "string" &&
  /^(?:0|-|[#bn]?[1-7](?:'{1,3}|\.{1,3})?)$/.test(value);
export const validNumberedTokens = (tokens: unknown): tokens is string[] =>
  Array.isArray(tokens) &&
  tokens.length >= 1 &&
  tokens.length <= 8 &&
  tokens.every(isNumberedToken) &&
  (tokens.length === 1 || tokens.every((t) => t !== "0" && t !== "-"));
/** 单事件与批次共享语法，空格分事件，+ 分同事件多音。 */
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
  raw = raw.replace(/[♯♭♮]/g, (c) => ({ "♯": "#", "♭": "b", "♮": "n" })[c]!);
  const parts = raw.split(/[ \u3000]+/u).filter(Boolean);
  if (!parts.length || parts.length > 256 || parts.every((t) => t === "_"))
    return { ok: false, message: "每批须有有效简谱，最多对应 256 个事件。" };
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
