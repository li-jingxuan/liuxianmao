import type { ILXMChordDiagram } from "./types";

/** 普通按弦与横按共同决定可见品格，空弦和禁奏不占品位跨度。 */
const getPressedFrets = (diagram: ILXMChordDiagram): number[] => [
  ...diagram.strings.flatMap((s) =>
    typeof s.fret === "number" && s.fret > 0 ? [s.fret] : [],
  ),
  ...diagram.barres.map((b) => b.fret),
];

/** 合法指法按起始窗口裁掉尾部空格，最少 3 格；非法跨度由统一校验拒绝。 */
export const getChordDiagramFretCount = (diagram: ILXMChordDiagram): number =>
  Math.max(
    3,
    Math.max(diagram.startFret, ...getPressedFrets(diagram)) -
      diagram.startFret +
      1,
  );

/** 声音由六弦 fret 决定，横按只描述指法；校验不猜测和声名称。 */
export const validateChordDiagram = (
  diagram: ILXMChordDiagram,
): string | null => {
  const { startFret, fretCount, strings, barres } = diagram;
  if (
    !Number.isInteger(startFret) ||
    startFret < 1 ||
    startFret > 20 ||
    fretCount !== 5
  )
    return "起始品位应为 1–20，最多支持五个品格";
  if (strings.length !== 6 || strings.some((s, i) => s.string !== i + 1))
    return "六弦指法必须按弦号 1–6 保存";
  if (strings.every((s) => s.fret === "x")) return "至少一根弦应可发声";
  for (const s of strings) {
    if (
      s.fret !== "x" &&
      (!Number.isInteger(s.fret) || s.fret < 0 || s.fret > 24)
    )
      return "品位应为 x、0 或 1–24 的整数";
    if (
      s.finger !== null &&
      (!Number.isInteger(s.finger) || s.finger < 1 || s.finger > 4)
    )
      return "手指编号应为 1–4 或未指定";
    if ((s.fret === "x" || s.fret === 0) && s.finger !== null)
      return "空弦与禁奏弦不应指定手指";
  }
  if (barres.length > 4) return "最多支持四条横按";
  const usedFingers = new Set<number>();
  for (const b of barres) {
    if (
      ![b.fret, b.minString, b.maxString, b.finger].every(Number.isInteger) ||
      b.minString < 1 ||
      b.maxString > 6 ||
      b.minString >= b.maxString ||
      b.fret < 1 ||
      b.fret > 24 ||
      b.finger < 1 ||
      b.finger > 4
    )
      return "横按弦范围、品位或手指编号无效";
    if (usedFingers.has(b.finger)) return "同一手指只能定义一条横按";
    usedFingers.add(b.finger);
    for (const s of strings.slice(b.minString - 1, b.maxString)) {
      if (s.fret === "x" || s.fret < b.fret)
        return "横按区间不能包含空弦、禁奏或更低品位";
      if (
        s.finger !== null &&
        ((s.fret === b.fret && s.finger !== b.finger) ||
          (s.fret > b.fret && s.finger === b.finger))
      )
        return "横按与手指编号冲突";
    }
    if (
      barres.some(
        (other) =>
          other !== b &&
          other.fret === b.fret &&
          other.minString <= b.maxString &&
          other.maxString >= b.minString,
      )
    )
      return "同品位横按不能重叠";
  }
  for (const finger of [1, 2, 3, 4]) {
    const members = strings.filter((s) => s.finger === finger);
    if (
      members.length > 1 &&
      !barres.some(
        (b) =>
          b.finger === finger &&
          members.every(
            (s) =>
              s.fret === b.fret &&
              s.string >= b.minString &&
              s.string <= b.maxString,
          ),
      )
    )
      return "重复手指编号需要显式横按解释";
  }
  const frets = getPressedFrets(diagram);
  // 先区分指法自身跨度与观察窗口问题，用户才能知道是否可通过起始品位修复。
  if (frets.length && Math.max(...frets) - Math.min(...frets) + 1 > 5)
    return "指法跨度超过 5 个品格，暂不支持";
  if (frets.some((fret) => fret < startFret || fret >= startFret + 5))
    return "按弦或横按品位超出当前 5 格窗口，请调整起始品位";
  return null;
};

/** 草稿和已提交快照不共享可变数组。 */
export const cloneChordDiagram = (
  diagram: ILXMChordDiagram,
): ILXMChordDiagram => ({
  ...diagram,
  strings: diagram.strings.map((s) => ({ ...s })),
  barres: diagram.barres.map((b) => ({ ...b })),
});
