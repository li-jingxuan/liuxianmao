import type { ILXMJumpMarkKind, ILXMTrack } from "../types";
import { createJumpMarkIndex, getJumpMarkSide, inspectJumpMark, isCapoJumpMark, type JumpMarkEntry } from "./jump-marks";
import { resolvePlaybackReplay } from "./replay";

type CapoJumpKind = Extract<ILXMJumpMarkKind, "dc" | "dcAlFine" | "dcAlCoda">;
type MarkJumpKind = Extract<ILXMJumpMarkKind, "ds" | "dsAlCoda" | "dsAlFine" | "toCoda">;

export type PlaybackJumpTransition = {
  fromMeasureId: string;
  fromMarkId: string;
} & ({ kind: CapoJumpKind; toMarkId?: never } | { kind: MarkJumpKind; toMarkId: string });

export interface PlaybackJumpIssue {
  measureId: string;
  measureIndex: number;
  /** 出错指令可能依赖另一小节的 To Coda，修复入口直接定位该记号。 */
  repairMarkId: string;
  message: string;
}

interface OrderedVisit { index: number; jump?: PlaybackJumpTransition }

export type PlaybackJumpEnd = {
  measureId: string;
  measureIndex: number;
} & ({ kind: "fine"; markId: string } | { kind: "scoreEnd" });

export interface PlaybackRepeatEndingIssue {
  groupId: string;
  pass: number;
  measureId: string;
  measureIndex: number;
  message: string;
  /** 落点进入当前遍不演奏的房子时，也可定位触发该落点的跳转记号。 */
  reason?: "invalidDestination";
  repairMarkId?: string;
}

export type PlaybackRepeatBoundary = { kind: "jump"; toIndex: number } |
  { kind: "stop"; repeatEndingIssue: PlaybackRepeatEndingIssue };

/** 房子解析器按路线实例持有遍次，在已演奏的小节末提供分岔、回跳或缺房结果。 */
export type PlaybackRepeatBoundaryResolver = (index: number, context: {
  inReplay: boolean;
  repeated: ReadonlySet<number>;
}) => PlaybackRepeatBoundary | undefined;

interface JumpPlaybackRoute {
  visits: OrderedVisit[];
  issue?: PlaybackJumpIssue;
  end?: PlaybackJumpEnd;
  repeatEndingIssue?: PlaybackRepeatEndingIssue;
}

type ArmedExit = { command: JumpMarkEntry; exit: JumpMarkEntry; coda?: JumpMarkEntry };

/** 沿着谱面依次执行真实小节。已执行身份与普通反复遍数跨回跳保留，直到本次试听结束。 */
export function jumpPlaybackOrder(
  track: ILXMTrack,
  repeats: ReadonlyMap<number, number>,
  startIndex = 0,
  repeatBoundary?: PlaybackRepeatBoundaryResolver,
): JumpPlaybackRoute {
  const marks = createJumpMarkIndex(track.measures);
  const commands = new Map(marks.entries.filter(({ mark }) => getJumpMarkSide(mark.kind) === "end")
    .map((entry) => [entry.measureIndex, entry]));
  const replay = track.playbackReplay && resolvePlaybackReplay(track.measures, track.playbackReplay);
  // 普通反复范围内的锚点须等到第二遍，兼容 BUG-083 的「在常规末次到访后重奏」。
  const enclosingRepeat = replay?.ok ? [...repeats].find(([end, start]) =>
    replay.afterIndex >= start && replay.afterIndex <= end,
  )?.[0] : undefined;
  const repeated = new Set<number>();
  const executed = new Set<string>();
  const visits: OrderedVisit[] = [];
  let armed: ArmedExit | undefined;
  let replayed = false;
  let inReplay = false;
  let index = startIndex;
  let jump: PlaybackJumpTransition | undefined;
  const stop = (repairMarkId: string, message: string, measureIndex = index): JumpPlaybackRoute => ({
    visits, issue: { measureId: track.measures[measureIndex]!.id, measureIndex, repairMarkId, message },
  });

  while (index < track.measures.length) {
    visits.push(jump ? { index, jump } : { index });
    jump = undefined;
    const command = commands.get(index);
    const repeatStart = !inReplay && !repeated.has(index) ? repeats.get(index) : undefined;
    const startReplay = replay?.ok && !replayed && index === replay.afterIndex &&
      (enclosingRepeat === undefined || repeated.has(enclosingRepeat));
    const ending = repeatBoundary?.(index, { inReplay, repeated });
    if (command) {
      const { id, kind } = command.mark;
      const activeExit = armed?.exit.mark.id === id ? armed : undefined;
      const takeCapo = isCapoJumpMark(kind);
      const takeSegno = kind === "ds" || kind === "dsAlCoda" || kind === "dsAlFine";
      // 辅助记号只响应本次明确启用的身份。普通跳转再次到访自身时照常顺行。
      if (activeExit || ((takeCapo || takeSegno) && !executed.has(id))) {
        const { segno, toCoda, coda, fine, issues } = inspectJumpMark(command, marks);
        const issue = issues[0];
        if (issue) return stop(issue.markId, issue.message);
        // 同一边界只能沿一种路线离开。共址冲突保留已完整演奏的小节，供编辑者修正谱面。
        if (repeatStart !== undefined || ending || startReplay || inReplay)
          return stop(id, "此处的跳转或结束记号与反复线、反复房子或重奏冲突，请调整记号位置");
        if (!activeExit && armed)
          return stop(id, "上一条回跳指令的 Fine 或 To Coda 尚未经过，请调整记号位置或配对");
        if (toCoda && kind !== "toCoda" && executed.has(toCoda.mark.id))
          return stop(id, "配对的 To Coda 本次试听已执行，请改用另一处出口");

        if (kind === "fine" && activeExit)
          return { visits, end: { kind: "fine", measureId: command.measureId, measureIndex: index, markId: id } };

        const source = { fromMeasureId: command.measureId, fromMarkId: id };
        executed.add(id);
        if (kind === "toCoda" && activeExit?.coda) {
          armed = undefined;
          jump = { ...source, kind, toMarkId: activeExit.coda.mark.id };
          index = activeExit.coda.measureIndex;
          continue;
        }
        const exit = fine ?? toCoda;
        if (exit) armed = { command, exit, coda };
        if (takeCapo) {
          jump = { ...source, kind };
          index = 0;
          continue;
        }
        if (takeSegno && segno) {
          jump = { ...source, kind, toMarkId: segno.mark.id };
          index = segno.measureIndex;
          continue;
        }
      }
    }

    if (ending?.kind === "stop") {
      return { visits, repeatEndingIssue: ending.repeatEndingIssue };
    } else if (ending?.kind === "jump") {
      index = ending.toIndex;
    } else if (repeatStart !== undefined) {
      repeated.add(index);
      index = repeatStart;
    } else if (replay?.ok && startReplay) {
      replayed = true;
      inReplay = true;
      index = replay.fromIndex;
    } else if (replay?.ok && inReplay && index === replay.throughIndex) {
      inReplay = false;
      index = replay.afterIndex + 1;
    } else {
      index++;
    }
  }
  const lastIndex = visits.at(-1)?.index;
  if (lastIndex === undefined) return { visits };
  // 房子或其他结构可能越过已配对的记号。到曲尾仍未命中时指出待修复的原指令。
  if (armed) return stop(armed.command.mark.id, "重奏路线未经过配对的 Fine 或 To Coda，请调整配对或反复范围", lastIndex);
  return marks.entries.length ? {
    visits, end: { kind: "scoreEnd", measureId: track.measures[lastIndex]!.id, measureIndex: lastIndex },
  } : { visits };
}
