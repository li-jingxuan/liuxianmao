import type { ILXMMeasure, ILXMRepeatEnding, ILXMRepeatEndingGroup, ILXMTrack } from "../types";

export interface ResolvedRepeatEnding {
  ending: ILXMRepeatEnding;
  start: number;
  end: number;
}

export interface ResolvedRepeatEndingGroup {
  group: ILXMRepeatEndingGroup;
  start: number;
  sharedEnd: number;
  end: number;
  endings: ResolvedRepeatEnding[];
}

export interface RepeatEndingValidationIssue {
  groupIndex: number;
  endingIndex?: number;
  field: "startMeasureId" | "sharedEndMeasureId" | "endMeasureId" | "passCount" | "passes";
  message: string;
}

/** 以当前小节顺序统一解析稳定 ID。插入／复制到两个端点之间时，新小节自然进入范围。 */
export function inspectRepeatEndingGroups(measures: readonly ILXMMeasure[], groups: readonly ILXMRepeatEndingGroup[]) {
  const indexes = new Map(measures.map(({ id }, index) => [id, index]));
  const indexOf = (id: string) => indexes.get(id) ?? -1;
  const resolved: ResolvedRepeatEndingGroup[] = [];
  const issues: RepeatEndingValidationIssue[] = [];
  groups.forEach((group, groupIndex) => {
    const start = indexOf(group.startMeasureId);
    const sharedEnd = indexOf(group.sharedEndMeasureId);
    const end = indexOf(group.endMeasureId);
    const issue = (field: RepeatEndingValidationIssue["field"], message: string, endingIndex?: number) =>
      issues.push({ groupIndex, endingIndex, field, message });
    if (start < 0 || (sharedEnd >= 0 && start > sharedEnd))
      issue("startMeasureId", "反复起点须在共享段末小节或之前");
    if (sharedEnd < 0) issue("sharedEndMeasureId", "请选择有效的共享段末小节");
    if (end < 0 || end <= sharedEnd) issue("endMeasureId", "结尾区末小节须在共享段之后");
    if (resolved.some((other) => start <= other.end && other.start <= end))
      issue("startMeasureId", "反复组范围不能相交或嵌套");
    if (group.passCount !== 2 && group.passCount !== 3) issue("passCount", "反复组支持二遍或三遍");
    const endings: ResolvedRepeatEnding[] = [];
    const usedPasses = new Set<number>();
    group.endings.forEach((ending, endingIndex) => {
      const from = indexOf(ending.startMeasureId);
      const through = indexOf(ending.endMeasureId);
      if (from < 0 || from <= sharedEnd || from > end)
        issue("startMeasureId", "房子起始小节须在本组结尾区内", endingIndex);
      if (through < 0 || through < from || through > end)
        issue("endMeasureId", "房子结束小节须在起始小节到本组结尾区末之间", endingIndex);
      if (endings.some((other) => from <= other.end && other.start <= through))
        issue("startMeasureId", "这里与同组的其他房子重叠", endingIndex);
      if (!ending.passes.length || ending.passes.some((pass) => !Number.isInteger(pass) || pass < 1 || pass > group.passCount))
        issue("passes", "请勾选至少一个有效遍次", endingIndex);
      for (const pass of ending.passes) {
        if (usedPasses.has(pass)) issue("passes", `第 ${pass} 遍已有房子`, endingIndex);
        usedPasses.add(pass);
      }
      endings.push({ ending, start: from, end: through });
    });
    resolved.push({ group, start, sharedEnd, end, endings });
  });
  return { groups: resolved, issues };
}

export function getMissingRepeatEndingPasses(group: ILXMRepeatEndingGroup) {
  return Array.from({ length: group.passCount }, (_, index) => index + 1)
    .filter((pass) => !group.endings.some((ending) => ending.passes.includes(pass)));
}

/** 新建表单可借用覆盖选区的普通反复线；最终组范围仍由表单显式确认。 */
export function suggestRepeatEndingGroup(track: ILXMTrack, selectionStart: number, selectionEnd: number): ILXMRepeatEndingGroup | undefined {
  const { measures } = track;
  if (selectionStart < 0 || !measures[selectionEnd]) return undefined;
  let start = 0;
  let candidate = 0;
  let end = selectionEnd;
  for (let index = 0; index < measures.length; index++) {
    const { barline } = measures[index]!;
    if ((barline === "repeatEnd" || barline === "repeatBoth") && index >= selectionStart && start < selectionStart) {
      candidate = start;
      end = Math.max(index, end);
      break;
    }
    if ((barline === "repeatStart" || barline === "repeatBoth") && index + 1 < selectionStart) {
      start = index + 1;
      candidate = start;
    }
  }
  return {
    id: "",
    startMeasureId: measures[candidate]!.id,
    sharedEndMeasureId: measures[Math.max(0, selectionStart - 1)]!.id,
    endMeasureId: measures[end]!.id,
    passCount: 2,
    endings: [],
  };
}

/** 删除房子端点移除该房并留下缺房诊断；删除组端点解除整个显式组，避免误绑相邻小节。 */
export function withoutRepeatEndingMeasure(track: ILXMTrack, measureId: string): ILXMTrack {
  const { repeatEndingGroups, ...rest } = track;
  if (!repeatEndingGroups?.length) return track;
  const groups = repeatEndingGroups.flatMap((group) => {
    if ([group.startMeasureId, group.sharedEndMeasureId, group.endMeasureId].includes(measureId)) return [];
    const endings = group.endings.filter((ending) => ending.startMeasureId !== measureId && ending.endMeasureId !== measureId);
    return [endings.length === group.endings.length ? group : { ...group, endings }];
  });
  return groups.length ? { ...track, repeatEndingGroups: groups } : rest;
}
