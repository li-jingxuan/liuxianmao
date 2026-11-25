import type { ILXMTrack } from "../types";
import type { PlaybackRepeatBoundaryResolver, PlaybackRepeatEndingIssue } from "./jump-order";
import { inspectRepeatEndingGroups, type ResolvedRepeatEndingGroup } from "./repeat-endings";

export interface PlaybackRepeatEndingVisit {
  groupId: string;
  pass: number;
}

/** 只取代同起点、同结尾区内的普通反复；其他反复和回跳仍由原有路线执行。 */
export function collectRepeatEndingGroups(track: ILXMTrack, repeats: ReadonlyMap<number, number>) {
  const result = inspectRepeatEndingGroups(track.measures, track.repeatEndingGroups ?? []);
  const invalidGroups = new Set(result.issues.map(({ groupIndex }) => groupIndex));
  // 直接传入轨道的调用方可绕过文件校验。只执行有效、互不交叠的组。
  const groups = result.groups.filter((_, index) => !invalidGroups.has(index));
  const ordinary = new Map([...repeats].filter(([end, start]) => !groups.some((group) =>
    group.start === start && end >= group.sharedEnd && end <= group.end,
  )));
  return { groups, repeats: ordinary };
}

/** 每次规划都拥有独立的遍次状态；回跳继续当前遍次，旧谱重奏段照书写顺序经过。 */
export function createRepeatEndingTraversal(track: ILXMTrack, groups: readonly ResolvedRepeatEndingGroup[]) {
  const byIndex = new Map<number, ResolvedRepeatEndingGroup>();
  for (const group of groups) {
    for (let index = group.start; index <= group.end; index++) byIndex.set(index, group);
  }
  const passes = new Map<string, number>();
  const visits: (PlaybackRepeatEndingVisit | undefined)[] = [];
  let previousIndex: number | undefined;
  let invalidDestination: PlaybackRepeatEndingIssue | undefined;
  const atBoundary: PlaybackRepeatBoundaryResolver = (index, { inReplay }) => {
    const previous = previousIndex;
    previousIndex = index;
    const entry = inReplay ? undefined : byIndex.get(index);
    if (!entry) {
      visits.push(undefined);
      return undefined;
    }
    const { group, endings, sharedEnd, start, end } = entry;
    const pass = passes.get(group.id) ?? 1;
    visits.push({ groupId: group.id, pass });
    const ending = endings.find(({ ending }) => ending.passes.includes(pass));
    if (index > sharedEnd && (!ending || index < ending.start || index > ending.end)) {
      // 回跳可进入共享段或本遍房子。若落到其他房或空档，在进入它前停止，保留已演奏的来源小节。
      const measureIndex = previous ?? index;
      invalidDestination = {
        reason: "invalidDestination", groupId: group.id, pass, measureIndex,
        measureId: track.measures[measureIndex]!.id,
        message: `落点第 ${index + 1} 小节不属于本组第 ${pass} 遍的房子`,
      };
      return { kind: "stop", repeatEndingIssue: invalidDestination };
    }
    if (index === sharedEnd) {
      // 缺房时先演奏完共享段末小节。修复定位复用这次到访的组和缺少的遍次。
      if (!ending) return { kind: "stop", repeatEndingIssue: {
        groupId: group.id,
        pass,
        measureId: track.measures[index]!.id,
        measureIndex: index,
        message: `第 ${pass} 遍没有反复房子`,
      } };
      return { kind: "jump", toIndex: ending.start };
    }
    if (index !== ending?.end) return undefined;
    if (pass === group.passCount) return { kind: "jump", toIndex: end + 1 };
    passes.set(group.id, pass + 1);
    return { kind: "jump", toIndex: start };
  };
  return { atBoundary, visits, get invalidDestination() { return invalidDestination; } };
}
