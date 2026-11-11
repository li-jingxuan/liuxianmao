import { validateChordDiagram, type ILXMChordDiagram } from "@liuxianmao/lxm-editor";

/** 仅把领域校验结果映射到可编辑字段，不决定图是否可以提交。 */
export const chordIssueField = (diagram: ILXMChordDiagram): string | null => {
  const issue = validateChordDiagram(diagram);
  if (!issue) return null;
  const fret = (string: number) => `${string}弦品位`;
  const finger = (string: number) => `${string}弦手指`;
  const barre = (index: number, field = "fret") => `横按${index + 1}${field}`;
  if (issue.includes("起始品位") || issue.includes("窗口")) return "起始品位";
  if (issue.includes("重复手指")) {
    const repeated = diagram.strings.find((string, index) => string.finger !== null &&
      diagram.strings.slice(0, index).some((previous) => previous.finger === string.finger));
    return repeated ? finger(repeated.string) : null;
  }
  if (issue.includes("至少一根弦")) return fret(6);
  if (issue.startsWith("品位应")) {
    const invalid = diagram.strings.find((string) => string.fret !== "x" &&
      (!Number.isInteger(string.fret) || string.fret < 0 || string.fret > 24));
    return invalid ? fret(invalid.string) : null;
  }
  if (issue.startsWith("手指编号")) {
    const invalid = diagram.strings.find((string) => string.finger !== null &&
      (!Number.isInteger(string.finger) || string.finger < 1 || string.finger > 4));
    return invalid ? (invalid.fret === 0 || invalid.fret === "x" ? fret(invalid.string) : finger(invalid.string)) : null;
  }
  if (issue.startsWith("空弦与禁奏")) {
    const invalid = diagram.strings.find((string) => (string.fret === 0 || string.fret === "x") && string.finger !== null);
    // 这些弦的手指控件禁用，重新选择品位会清掉手指，因此定位品位控件。
    return invalid ? fret(invalid.string) : null;
  }
  if (issue.startsWith("横按弦范围")) {
    for (const [index, value] of diagram.barres.entries()) {
      for (const field of ["fret", "minString", "maxString", "finger"] as const) {
        const max = field === "fret" ? 24 : field === "finger" ? 4 : 6;
        if (!Number.isInteger(value[field]) || value[field] < 1 || value[field] > max) return barre(index, field);
      }
      if (value.minString >= value.maxString) return barre(index, "minString");
    }
  }
  if (issue.startsWith("同一手指")) {
    const index = diagram.barres.findIndex((value, index) => diagram.barres.slice(0, index).some((previous) => previous.finger === value.finger));
    return index >= 0 ? barre(index, "finger") : null;
  }
  if (issue.startsWith("同品位横按")) {
    const index = diagram.barres.findIndex((value, index) => diagram.barres.slice(0, index).some((previous) => previous.fret === value.fret && previous.minString <= value.maxString && previous.maxString >= value.minString));
    return index >= 0 ? barre(index, "minString") : null;
  }
  if (issue.startsWith("横按区间") || issue.startsWith("横按与手指")) {
    for (const value of diagram.barres) {
      const invalid = diagram.strings.slice(value.minString - 1, value.maxString).find((string) =>
        issue.startsWith("横按区间")
          ? string.fret === "x" || string.fret < value.fret
          : string.finger !== null && ((string.fret === value.fret && string.finger !== value.finger) || (typeof string.fret === "number" && string.fret > value.fret && string.finger === value.finger)));
      if (invalid) return issue.startsWith("横按区间") ? fret(invalid.string) : finger(invalid.string);
    }
  }
  if (issue.includes("跨度")) {
    const highest = diagram.strings.filter((string) => typeof string.fret === "number" && string.fret > 0).sort((a, b) => Number(b.fret) - Number(a.fret))[0];
    const maxBarreIndex = diagram.barres.reduce((best, value, index) => value.fret > (diagram.barres[best]?.fret ?? 0) ? index : best, -1);
    if (maxBarreIndex >= 0 && diagram.barres[maxBarreIndex]!.fret > Number(highest?.fret ?? 0)) return barre(maxBarreIndex);
    return highest ? fret(highest.string) : null;
  }
  // 不可由当前字段表达的结构错误仍带到指法组，保留原始校验说明。
  return null;
};
