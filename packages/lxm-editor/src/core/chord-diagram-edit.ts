import { cloneChordDiagram, validateChordDiagramIssues, type ChordDiagramIssue } from "./chord-diagram";
import type { ILXMChordBarre, ILXMChordDiagram, ILXMChordString } from "./types";

export type ChordDiagramEditIntent =
  | { type: "set-string"; string: ILXMChordString["string"]; fret: ILXMChordString["fret"]; finger?: ILXMChordString["finger"] }
  | { type: "add-barre"; barre: ILXMChordBarre }
  | { type: "edit-barre"; index: number; barre: ILXMChordBarre }
  | { type: "delete-barre"; index: number }
  | { type: "set-window"; startFret: number };

export type ChordDiagramEditResult =
  | { ok: true; diagram: ILXMChordDiagram; clearedStrings: number[] }
  | { ok: false; issues: ChordDiagramIssue[] };

/** 删除/修改仅清理因该横按移除而失去解释的重复手指，保留实际品位。 */
function removeBarre(diagram: ILXMChordDiagram, index: number): number[] {
  const [removed] = diagram.barres.splice(index, 1);
  if (!removed) return [];
  const members = diagram.strings.filter((s) => s.finger === removed.finger);
  if (members.length < 2 || diagram.barres.some((b) => b.finger === removed.finger && members.every((s) => s.fret === b.fret && s.string >= b.minString && s.string <= b.maxString))) return [];
  for (const s of members) s.finger = null;
  return members.map((s) => s.string);
}

/** 原子语义编辑；从不修改入参，失败不发布候选值，也不修复其他横按。 */
export function editChordDiagram(diagram: ILXMChordDiagram, intent: ChordDiagramEditIntent): ChordDiagramEditResult {
  const candidate = cloneChordDiagram(diagram);
  let clearedStrings: number[] = [];
  if (intent.type === "set-string") {
    const s = candidate.strings.find((item) => item.string === intent.string);
    if (!s) return { ok: false, issues: [{ code: "string", message: "弦号应为 1–6", string: intent.string, field: "strings" }] };
    s.fret = intent.fret;
    s.finger = intent.fret === "x" || intent.fret === 0 ? null : intent.finger === undefined ? s.finger : intent.finger;
  } else if (intent.type === "set-window") {
    candidate.startFret = intent.startFret;
  } else {
    if (intent.type !== "add-barre") {
      if (!Number.isInteger(intent.index) || !candidate.barres[intent.index]) return { ok: false, issues: [{ code: "barre-index", message: "该横按不存在", barreIndex: intent.index, field: "barres" }] };
      clearedStrings = removeBarre(candidate, intent.index);
    }
    if (intent.type !== "delete-barre") {
      const b = { ...intent.barre, minString: Math.min(intent.barre.minString, intent.barre.maxString), maxString: Math.max(intent.barre.minString, intent.barre.maxString) };
      const index = intent.type === "edit-barre" ? intent.index : candidate.barres.length;
      candidate.barres.splice(index, 0, b);
      for (const s of candidate.strings) {
        if (s.string < b.minString || s.string > b.maxString) continue;
        if (s.fret === "x" || s.fret <= b.fret) {
          s.fret = b.fret;
          s.finger = b.finger;
        }
      }
    }
  }
  const issues = validateChordDiagramIssues(candidate);
  if (issues.length) return { ok: false, issues };
  // 新覆盖区可重新建立解释，只报告最终实际被清理的弦。
  clearedStrings = clearedStrings.filter((string) => candidate.strings.find((s) => s.string === string)?.finger === null);
  return { ok: true, diagram: candidate, clearedStrings };
}
