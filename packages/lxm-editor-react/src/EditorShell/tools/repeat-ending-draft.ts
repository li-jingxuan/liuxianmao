import {
  getMissingRepeatEndingPasses, suggestRepeatEndingGroup, validateRepeatEndingGroup,
  type ILXMRepeatEnding, type ILXMRepeatEndingGroup, type ILXMTrack,
} from "@liuxianmao/lxm-editor";

export const measureLabel = (index: number) => `第 ${index + 1} 小节`;
export const repeatPasses = (count: number) => Array.from({ length: count }, (_, index) => index + 1);

export function createRepeatEndingDraftModel(track: ILXMTrack) {
  const { measures, repeatEndingGroups: groups = [] } = track;
  const indexes = new Map(measures.map(({ id }, index) => [id, index]));
  const indexOf = (id: string) => indexes.get(id) ?? -1;
  const range = (start: string, end: string) => start === end ? measureLabel(indexOf(start))
    : `第 ${indexOf(start) + 1}–${indexOf(end) + 1} 小节`;
  const intersects = ({ startMeasureId, endMeasureId }: ILXMRepeatEndingGroup | ILXMRepeatEnding, from: number, through: number) =>
    from <= indexOf(endMeasureId) && indexOf(startMeasureId) <= through;

  function addEnding(group: ILXMRepeatEndingGroup, selection?: readonly [number, number], pass?: number) {
    const first = indexOf(group.sharedEndMeasureId) + 1;
    const last = indexOf(group.endMeasureId);
    const available = measures.find((_, index) => index >= first && index <= last &&
      !group.endings.some((ending) => intersects(ending, index, index)));
    // 无空位时仍可先新增草稿，再移动组边界／房子；核心结构校验会阻止重叠的草稿写入。
    const fallback = available?.id ?? measures[first]?.id ?? group.endMeasureId;
    const preferred = selection && selection[0] >= first && selection[1] <= last ? selection : undefined;
    const nextPass = pass ?? getMissingRepeatEndingPasses(group)[0];
    return { ...group, endings: [...group.endings, {
      id: "", startMeasureId: preferred ? measures[preferred[0]]!.id : fallback,
      endMeasureId: preferred ? measures[preferred[1]]!.id : fallback,
      passes: nextPass ? [nextPass] : [],
    }] };
  }

  function create(measureIds: readonly string[], preferredId?: string, pass?: number) {
    if (measures.length < 2) return undefined;
    const selected = measureIds.map(indexOf).filter((index) => index >= 0);
    const start = selected.length ? Math.min(...selected) : 1;
    const end = Math.max(start, ...selected);
    // 明确选择「新建」时跳过自动归组。普通入口在组内整组打开；紧邻缺房组时兼容原来的续接入口。
    const matching = preferredId === undefined ? groups.find((group) =>
      start >= indexOf(group.startMeasureId) && end <= indexOf(group.endMeasureId)) : undefined;
    const preceding = preferredId === undefined && !matching ? groups.find((group) =>
      start === indexOf(group.endMeasureId) + 1 && getMissingRepeatEndingPasses(group).length > 0 &&
      !groups.some((other) => other !== group && intersects(other, start, end))) : undefined;
    const group = groups.find(({ id }) => id === preferredId) ?? matching ??
      (preceding && { ...preceding, endMeasureId: measures[end]!.id });
    if (!group) {
      const beginning = Math.max(1, start);
      const ending = Math.max(beginning, end);
      const suggested = suggestRepeatEndingGroup(track, beginning, ending);
      return suggested && addEnding(suggested, [beginning, ending]);
    }
    const draft = { ...group, endings: [...group.endings].sort((a, b) => indexOf(a.startMeasureId) - indexOf(b.startMeasureId)) };
    const canPrefill = preferredId === undefined && start > indexOf(draft.sharedEndMeasureId) &&
      getMissingRepeatEndingPasses(draft).length > 0 && !draft.endings.some((room) => intersects(room, start, end));
    return pass !== undefined ? addEnding(draft, undefined, pass) : canPrefill ? addEnding(draft, [start, end]) : draft;
  }

  function unusedRanges(group: ILXMRepeatEndingGroup) {
    const unused: [number, number][] = [];
    for (let index = indexOf(group.sharedEndMeasureId) + 1; index <= indexOf(group.endMeasureId); index++) {
      if (group.endings.some((ending) => intersects(ending, index, index))) continue;
      const previous = unused.at(-1);
      if (previous?.[1] === index - 1) previous[1] = index;
      else unused.push([index, index]);
    }
    return unused.map(([from, through]) => range(measures[from]!.id, measures[through]!.id));
  }

  return { addEnding, create, indexOf, intersects, range, unusedRanges };
}

type GroupField = "startMeasureId" | "sharedEndMeasureId" | "endMeasureId" | "passCount" | "group" | "add";
type EndingField = "startMeasureId" | "endMeasureId" | "passes";
export type RepeatEndingDraftIssue =
  | { fields: GroupField[]; row?: undefined; message: string }
  | { fields: EndingField[]; row: number; message: string; pass?: number };

export function findRepeatEndingDraftIssue(
  track: ILXMTrack, group: ILXMRepeatEndingGroup, model: ReturnType<typeof createRepeatEndingDraftModel>,
): RepeatEndingDraftIssue | undefined {
  const { indexOf, intersects, range } = model;
  const { measures } = track;
  const others = (track.repeatEndingGroups ?? []).filter(({ id }) => id !== group.id);
  const start = indexOf(group.startMeasureId);
  const shared = indexOf(group.sharedEndMeasureId);
  const end = indexOf(group.endMeasureId);
  if (shared < 0) return { fields: ["sharedEndMeasureId"], message: "请选择有效的共享段末小节。" };
  if (start < 0 || start > shared) return { fields: ["startMeasureId"], message: "把反复起点移到共享段末小节或之前。" };
  if (end <= shared) return { fields: ["endMeasureId"], message: "把结尾区末小节移到共享段之后。" };
  const conflict = others.find((other) => intersects(other, start, end));
  if (conflict) {
    const before = indexOf(conflict.startMeasureId) - 1;
    const after = indexOf(conflict.endMeasureId) + 1;
    const otherRange = range(conflict.startMeasureId, conflict.endMeasureId);
    const message = `与既有反复组（${otherRange}）相交。`;
    // 优先标记单独移动就能解除冲突的字段。相交边界两边没有足够空间时才建议改其他字段或改用原组。
    if (shared < before) return { fields: ["endMeasureId"], message: `${message}把结尾区末小节改到${measureLabel(before)}或更早。` };
    if (after <= shared) return { fields: ["startMeasureId"], message: `${message}把反复起点改到${measureLabel(after)}或更晚。` };
    const reuse = group.id ? "" : `可在「所属反复组」选择${otherRange}来编辑该组，或`;
    if (start < before) return { fields: ["endMeasureId", "sharedEndMeasureId"],
      message: `${message}${reuse}把结尾区末小节改到${measureLabel(before)}或更早，并把共享段末移到它之前。` };
    if (after < end) return { fields: ["startMeasureId", "sharedEndMeasureId"],
      message: `${message}${reuse}把反复起点改到${measureLabel(after)}或更晚，并把共享段末移到新起点与结尾区末之间。` };
    const spaces = [before >= 1 ? range(measures[0]!.id, measures[before]!.id) : "",
      after < measures.length - 1 ? range(measures[after]!.id, measures.at(-1)!.id) : ""].filter(Boolean);
    if (spaces.length) return { fields: ["startMeasureId", "sharedEndMeasureId", "endMeasureId"],
      message: `${message}${reuse}把反复起点、共享段末和结尾区末都移到${spaces.join("或")}内。` };
    return group.id ? { fields: ["startMeasureId", "endMeasureId"], message: `${message}该组前后都没有足够的小节。请取消本次编辑。` }
      : { fields: ["group"], message: `${message}请在「所属反复组」选择${otherRange}来编辑该组。` };
  }
  if (!group.id && !group.endings.length) return { fields: ["add"], message: "请为新建反复组添加至少一个房子。" };

  // 共用核心校验，按照字段位置补充实际可执行的操作。缺房和结尾区空档由演奏预览单独呈现。
  const validation = validateRepeatEndingGroup(track, group);
  const issue = validation.issues.find(({ groupIndex }) => groupIndex === others.length);
  if (!issue && !validation.ok) return { fields: ["group"], message: "其他反复组仍有无效设置，请先修复该组。" };
  if (!issue) return undefined;
  const { endingIndex: row, field, message } = issue;
  if (row === undefined) return { fields: [field === "id" ? "group" : field === "endings" ? "add" : "passCount"], message: `${message}。` };
  if (field === "id") return { row, fields: [], message: `${message}。请取消后重新打开设置。` };
  const room = group.endings[row]!;
  const from = indexOf(room.startMeasureId);
  const through = indexOf(room.endMeasureId);
  if (from <= shared || from > end) return { row, fields: ["startMeasureId"], message: "把起始小节移到本组结尾区内。" };
  if (through < from || through > end) return { row, fields: ["endMeasureId"], message: "把结束小节移到起始小节至本组结尾区末之间。" };
  const previous = group.endings.slice(0, row);
  if (field === "startMeasureId") {
    const otherRow = previous.findIndex((ending) => intersects(ending, from, through));
    const other = previous[otherRow];
    if (!other) return { row, fields: ["startMeasureId"], message: `${message}。` };
    const overlap = `与房子 ${otherRow + 1}（${range(other.startMeasureId, other.endMeasureId)}）重叠。`;
    if (from < indexOf(other.startMeasureId)) return { row, fields: ["endMeasureId"], message: `${overlap}把结束小节移到房子 ${otherRow + 1} 之前。` };
    if (through > indexOf(other.endMeasureId)) return { row, fields: ["startMeasureId"], message: `${overlap}把起始小节移到房子 ${otherRow + 1} 之后。` };
    return { row, fields: ["startMeasureId", "endMeasureId"], message: `${overlap}请将起止小节移到结尾区的空位，或调整结尾区范围。` };
  }
  const pass = room.passes.find((value) => previous.some((ending) => ending.passes.includes(value)));
  if (pass && room.passes.every((value) => repeatPasses(group.passCount).includes(value))) {
    const otherRow = previous.findIndex((ending) => ending.passes.includes(pass));
    return { row, fields: ["passes"], pass, message: `第 ${pass} 遍已分给房子 ${otherRow + 1}。请在其中一个房子取消勾选第 ${pass} 遍。` };
  }
  return { row, fields: ["passes"], message: `请在总遍数范围内勾选至少一遍（第 1–${group.passCount} 遍）。` };
}
