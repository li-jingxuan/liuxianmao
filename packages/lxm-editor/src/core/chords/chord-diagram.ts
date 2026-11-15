import type { ILXMChordDiagram } from "../types";

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

export interface ChordDiagramIssue {
  code: string;
  message: string;
  field?: "startFret" | "fretCount" | "strings" | "barres" | "fret" | "finger" | "minString" | "maxString";
  /** 领域弦号 1–6，不是数组索引。 */
  string?: number;
  /** 横按数组索引。 */
  barreIndex?: number;
}

/** 声音由六弦 fret 决定，横按只描述指法；两种编辑表面共用同一校验。 */
export const validateChordDiagramIssues = (
  diagram: ILXMChordDiagram,
): ChordDiagramIssue[] => {
  const { startFret, fretCount, strings, barres } = diagram;
  const issues: ChordDiagramIssue[] = [];
  const add = (code: string, message: string, location: Omit<ChordDiagramIssue, "code" | "message"> = {}) => issues.push({ code, message, ...location });
  if (
    !Number.isInteger(startFret) ||
    startFret < 1 ||
    startFret > 20 ||
    fretCount !== 5
  )
    add("window", "起始品位应为 1–20，最多支持五个品格", { field: "startFret" });
  if (strings.length !== 6 || strings.some((s, i) => s.string !== i + 1))
    add("string-order", "六弦指法必须按弦号 1–6 保存", { field: "strings" });
  if (strings.every((s) => s.fret === "x")) add("silent", "至少一根弦应可发声", { field: "strings" });
  for (const s of strings) {
    if (
      s.fret !== "x" &&
      (!Number.isInteger(s.fret) || s.fret < 0 || s.fret > 24)
    )
      add("fret", "品位应为 x、0 或 1–24 的整数", { string: s.string, field: "fret" });
    if (
      s.finger !== null && s.finger !== "T" &&
      (!Number.isInteger(s.finger) || s.finger < 1 || s.finger > 4)
    )
      add("finger", "手指编号应为 1–4、T 或未指定", { string: s.string, field: "finger" });
    if ((s.fret === "x" || s.fret === 0) && s.finger !== null)
      add("open-finger", "空弦与禁奏弦不应指定手指", { string: s.string, field: "finger" });
  }
  if (barres.length > 4) add("barre-limit", "最多支持四条横按", { field: "barres" });
  for (const [barreIndex, b] of barres.entries()) {
    const validFinger = b.finger === null || b.finger === "T" || (Number.isInteger(b.finger) && b.finger >= 1 && b.finger <= 4);
    if (
      ![b.fret, b.minString, b.maxString].every(Number.isInteger) ||
      b.minString < 1 ||
      b.maxString > 6 ||
      b.minString >= b.maxString ||
      b.fret < 1 ||
      b.fret > 24 ||
      !validFinger
    ) {
      add("barre-range", "横按弦范围、品位或手指编号无效", { barreIndex, field: !Number.isInteger(b.fret) || b.fret < 1 || b.fret > 24 ? "fret" : !validFinger ? "finger" : "minString" });
      continue;
    }
    for (const s of strings.slice(b.minString - 1, b.maxString)) {
      if (s.fret === "x" || s.fret < b.fret)
        add("barre-low-fret", "横按区间不能包含空弦、禁奏或更低品位", { barreIndex, string: s.string, field: "fret" });
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
      add("barre-overlap", "同品位横按不能重叠", { barreIndex, field: "barres" });
  }
  const frets = getPressedFrets(diagram);
  // 先区分指法自身跨度与观察窗口问题，用户才能知道是否可通过起始品位修复。
  if (frets.length && Math.max(...frets) - Math.min(...frets) + 1 > 5)
    add("span", "指法跨度超过 5 个品格，暂不支持", { field: "strings" });
  for (const s of strings) if (typeof s.fret === "number" && s.fret > 0 && (s.fret < startFret || s.fret >= startFret + 5))
    add("outside-window", "按弦或横按品位超出当前 5 格窗口，请调整起始品位", { string: s.string, field: "fret" });
  for (const [barreIndex, b] of barres.entries()) if (b.fret < startFret || b.fret >= startFret + 5)
    add("outside-window", "按弦或横按品位超出当前 5 格窗口，请调整起始品位", { barreIndex, field: "fret" });
  return issues;
};

/** 旧 schema/命令入口保持首条错误文案兼容。 */
export const validateChordDiagram = (diagram: ILXMChordDiagram): string | null =>
  validateChordDiagramIssues(diagram)[0]?.message ?? null;

/** 草稿和已提交快照不共享可变数组。 */
export const cloneChordDiagram = (
  diagram: ILXMChordDiagram,
): ILXMChordDiagram => ({
  ...diagram,
  strings: diagram.strings.map((s) => ({ ...s })),
  barres: diagram.barres.map((b) => ({ ...b })),
});
