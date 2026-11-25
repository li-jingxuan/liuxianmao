import type { ILXMJumpMark, ILXMJumpMarkKind, ILXMMeasure } from "../types";

export const JUMP_MARK_LABEL = {
  segno: "Segno",
  coda: "Coda",
  ds: "D.S.",
  dsAlCoda: "D.S. al Coda",
  toCoda: "To Coda",
  dc: "D.C.",
  fine: "Fine",
  dcAlFine: "D.C. al Fine",
  dsAlFine: "D.S. al Fine",
  dcAlCoda: "D.C. al Coda",
} satisfies Record<ILXMJumpMarkKind, string>;

const targetKinds = { segnoId: "segno", toCodaId: "toCoda", codaId: "coda", fineId: "fine" } as const;
export type JumpMarkField = keyof typeof targetKinds;

const fields: Record<ILXMJumpMarkKind, readonly JumpMarkField[]> = {
  segno: [], coda: [], ds: ["segnoId"], dsAlCoda: ["segnoId", "toCodaId"], toCoda: ["codaId"],
  dc: [], fine: [], dcAlFine: ["fineId"], dsAlFine: ["segnoId", "fineId"], dcAlCoda: ["toCodaId"],
};

export const getJumpMarkFields = (kind: ILXMJumpMarkKind) => fields[kind];
export const getJumpMarkSide = (kind: ILXMJumpMarkKind) =>
  kind === "segno" || kind === "coda" ? "start" : "end";

export const isCapoJumpMark = (kind: ILXMJumpMarkKind): kind is "dc" | "dcAlFine" | "dcAlCoda" =>
  kind === "dc" || kind === "dcAlFine" || kind === "dcAlCoda";

export interface JumpMarkEntry {
  mark: ILXMJumpMark;
  measureId: string;
  measureIndex: number;
}

export interface JumpMarkIssue {
  markId: string;
  field: JumpMarkField;
  message: string;
}

export function createJumpMarkIndex(measures: readonly ILXMMeasure[]) {
  const entries: JumpMarkEntry[] = [];
  const byId = new Map<string, JumpMarkEntry>();
  const byKind = new Map<ILXMJumpMarkKind, JumpMarkEntry[]>();
  for (const [measureIndex, measure] of measures.entries()) {
    for (const mark of measure.jumpMarks ?? []) {
      const entry = { mark, measureId: measure.id, measureIndex };
      entries.push(entry);
      byId.set(mark.id, entry);
      const candidates = byKind.get(mark.kind) ?? [];
      candidates.push(entry);
      byKind.set(mark.kind, candidates);
    }
  }
  return { entries, byId, byKind };
}

type JumpMarkIndex = ReturnType<typeof createJumpMarkIndex>;

/** 按草稿目的地和当前 Segno 筛选候选；失效的已存 ID 由校验保留并提示修复。 */
export function getJumpMarkCandidates(mark: ILXMJumpMark, field: JumpMarkField, index: JumpMarkIndex, measureIndex?: number) {
  const segno = mark.segnoId ? index.byId.get(mark.segnoId) : undefined;
  const replayStart = isCapoJumpMark(mark.kind) ? 0 : segno?.mark.kind === "segno" ? segno.measureIndex : undefined;
  return (index.byKind.get(targetKinds[field]) ?? []).filter((target) => {
    if (target.mark.id === mark.id) return false;
    if (measureIndex === undefined) return true;
    if (field === "segnoId") return target.measureIndex <= measureIndex;
    if (field === "codaId") return target.measureIndex > measureIndex;
    // Fine 和 To Coda 可以和起点同小节，仍须位于回跳指令之前。
    return replayStart !== undefined && target.measureIndex >= replayStart && target.measureIndex < measureIndex;
  });
}

/** 候选只在应用草稿时自动填入。现有悬空 ID 始终原样保留，防止误用另一处落点。 */
export function resolveJumpMarkDraft(mark: ILXMJumpMark, index: JumpMarkIndex, measureIndex = index.byId.get(mark.id)?.measureIndex): ILXMJumpMark {
  const next: ILXMJumpMark = { id: mark.id, kind: mark.kind };
  for (const field of getJumpMarkFields(mark.kind)) {
    // 先解析 Segno，再用已确定的重奏起点查找唯一的 Fine 或 To Coda。
    const candidates = getJumpMarkCandidates(next, field, index, measureIndex);
    const id = mark[field] || (candidates.length === 1 ? candidates[0]?.mark.id : undefined);
    if (id) next[field] = id;
  }
  return next;
}

/** 试听和属性面板共用同一套方向、范围和实际配对校验。尾声问题定位到拥有 Coda 的 To Coda。 */
export function inspectJumpMark(entry: JumpMarkEntry, index: JumpMarkIndex) {
  const issues: JumpMarkIssue[] = [];
  const add = (owner: JumpMarkEntry, field: JumpMarkField, message: string) => {
    issues.push({ markId: owner.mark.id, field, message });
  };
  const read = (owner: JumpMarkEntry, field: JumpMarkField) => {
    const kind = targetKinds[field];
    const label = JUMP_MARK_LABEL[kind];
    const id = owner.mark[field];
    const target = id ? index.byId.get(id) : undefined;
    if (target?.mark.kind === kind) return target;
    const count = getJumpMarkCandidates(owner.mark, field, index, owner.measureIndex).length;
    add(owner, field, id ? `原配对的 ${label} 已删除或改类` : count > 1
      ? `有 ${count} 个 ${label}，请指定一处` : count === 1
        ? `请应用唯一候选 ${label}` : `缺少可用的 ${label}，请检查记号位置与配对`);
    return undefined;
  };

  const { kind } = entry.mark;
  const markFields = getJumpMarkFields(kind);
  const segno = markFields.includes("segnoId") ? read(entry, "segnoId") : undefined;
  if (segno && segno.measureIndex > entry.measureIndex)
    add(entry, "segnoId", "Segno 须位于回跳指令之前或该小节开头");
  const replayStart = isCapoJumpMark(kind) ? 0 : segno?.measureIndex;
  const checkExit = (field: "toCodaId" | "fineId") => {
    if (!markFields.includes(field)) return undefined;
    const target = read(entry, field);
    if (target && replayStart !== undefined && (target.measureIndex < replayStart || target.measureIndex >= entry.measureIndex))
      add(entry, field, `${JUMP_MARK_LABEL[target.mark.kind]} 须位于${isCapoJumpMark(kind) ? "曲首" : " Segno"}起、回跳指令之前`);
    return target;
  };
  const fine = checkExit("fineId");
  const toCoda = kind === "toCoda" ? entry : checkExit("toCodaId");
  const coda = toCoda ? read(toCoda, "codaId") : undefined;
  if (coda && toCoda && coda.measureIndex <= toCoda.measureIndex)
    add(toCoda, "codaId", "Coda 须位于 To Coda 之后");
  return { segno, toCoda, coda, fine, issues };
}

/** 删除 Coda 时也提示依赖该 To Coda 的回跳指令；只有已存的身份关系参与影响计算。 */
export function getJumpMarkDependents(markId: string, index: JumpMarkIndex): JumpMarkEntry[] {
  const seen = new Set([markId]);
  const queue = [markId];
  const dependents: JumpMarkEntry[] = [];
  for (const id of queue) {
    const target = index.byId.get(id);
    for (const entry of index.entries) {
      if (seen.has(entry.mark.id) || !getJumpMarkFields(entry.mark.kind).some(
        (field) => target?.mark.kind === targetKinds[field] && entry.mark[field] === id,
      )) continue;
      seen.add(entry.mark.id);
      queue.push(entry.mark.id);
      dependents.push(entry);
    }
  }
  return dependents;
}
