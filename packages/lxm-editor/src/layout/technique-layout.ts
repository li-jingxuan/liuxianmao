/**
 * MVP v5 技巧布局 Module。
 *
 * 外部只调用 layoutTrackTechniques(track, baseSystems)。Module 内部完成四件事：
 * 1. 把领域技巧解析为当前自动断行下的 system segment；
 * 2. 对上方技巧按水平碰撞区间分配 lane；
 * 3. 统一下移 staff 正文并重新排列后续 system；
 * 4. 输出页面可直接渲染的 SVG path、文字与命中 bounds。
 *
 * 这样 website 完全不理解 Tie 换行、扫弦方向或 P.M. 续接规则；改变 systemWidth
 * 也只会重算视觉 segment，不会修改 track.techniques 中的领域事实。
 */
import { buildTechniqueIndex } from "../core/technique-rules";
import type { ILXMTechnique, ILXMTrack } from "../core/types";
import {
  LXM_TECHNIQUE_AREA_PADDING_BOTTOM,
  LXM_TECHNIQUE_AREA_PADDING_TOP,
  LXM_TECHNIQUE_ARROW_HEIGHT,
  LXM_TECHNIQUE_ARROW_WIDTH,
  LXM_TECHNIQUE_HIT_PADDING,
  LXM_TECHNIQUE_HORIZONTAL_CLEARANCE,
  LXM_TECHNIQUE_LANE_HEIGHT,
  LXM_TECHNIQUE_PATH_STROKE_WIDTH,
  LXM_TECHNIQUE_TEXT_FONT_SIZE,
  LXM_DURATION_STEM_NOTE_GAP,
  LXM_TECHNIQUE_ARROW_OFFSET_Y,
} from "./layout-constants";
import type {
  ILXMBarlineLayout,
  ILXMMeasureLayout,
  ILXMNoteLayout,
  ILXMSystemLayout,
  ILXMTechniqueContinuation,
  ILXMTechniqueSegmentLayout,
  ILXMTextLayout,
} from "./layout-types";

interface ILXMTechniqueCandidate {
  technique: ILXMTechnique;
  systemIndex: number;
  segmentIndex: number;
  continuation: ILXMTechniqueContinuation;
  x1: number;
  x2: number;
  /** staffLocal 技巧不占 system 上方 lane。 */
  staffLocal: boolean;
}

interface ILXMAnchorMaps {
  notes: Map<string, { layout: ILXMNoteLayout; systemIndex: number }>;
  beats: Map<
    string,
    {
      x: number;
      width: number;
      notes: ILXMNoteLayout[];
      /** 当前 measure 六根弦的最终 Y 坐标，供显式选择范围技巧使用。 */
      stringYByIndex: ReadonlyMap<number, number>;
      systemIndex: number;
    }
  >;
}

const getSystemRight = (system: ILXMSystemLayout): number =>
  system.measures.reduce(
    (right, measure) => Math.max(right, measure.x + measure.width),
    system.header.staffX,
  );

const buildAnchorMaps = (systems: ILXMSystemLayout[]): ILXMAnchorMaps => {
  const notes = new Map<
    string,
    { layout: ILXMNoteLayout; systemIndex: number }
  >();
  const beats = new Map<
    string,
    {
      x: number;
      width: number;
      notes: ILXMNoteLayout[];
      stringYByIndex: ReadonlyMap<number, number>;
      systemIndex: number;
    }
  >();
  systems.forEach((system) =>
    system.measures.forEach((measure) => {
      measure.notes.forEach((note) =>
        notes.set(note.id, { layout: note, systemIndex: system.index }),
      );
      measure.beats.forEach((beat) =>
        beats.set(beat.id, {
          x: beat.x,
          width: beat.width,
          notes: measure.notes.filter((note) => note.beatId === beat.id),
          stringYByIndex: new Map(
            measure.strings.map((string) => [string.index, string.y1]),
          ),
          systemIndex: system.index,
        }),
      );
    }),
  );
  return { notes, beats };
};

/**
 * 收集应隐藏基础品位文本的 Beat × 弦范围。
 *
 * 范围端点来自用户的矩形选区，不要求端点上预先存在 Note；只要弦号能解析到当前
 * staff 的真实 Y 坐标即可。非法范围不会进入投影，避免技巧无路径时误隐藏品位。
 */
interface ILXMFretSuppressionRange {
  beatId: string;
  minString: number;
  maxString: number;
}

const getFretSuppressionRanges = (
  techniques: ILXMTechnique[],
  anchors: ILXMAnchorMaps,
): readonly ILXMFretSuppressionRange[] =>
  techniques.flatMap((technique) => {
    if (technique.type !== "strum" && technique.type !== "arpeggio") return [];
    const beat = anchors.beats.get(technique.beatId);
    const hasValidRange =
      beat?.stringYByIndex.has(technique.minString) &&
      beat.stringYByIndex.has(technique.maxString) &&
      technique.minString < technique.maxString;
    return hasValidRange
      ? [
          {
            beatId: technique.beatId,
            minString: technique.minString,
            maxString: technique.maxString,
          },
        ]
      : [];
  });

/**
 * 在所有时值、技巧 anchor 与 SVG segment 完成后，只裁剪最终可见的基础品位。
 * 保持结构共享既减少无关对象变化，也让调用方可以可靠判断哪些 system/measure
 * 真正受到了投影影响。
 */
const applyFretVisibilityProjection = (
  systems: ILXMSystemLayout[],
  suppressionRanges: readonly ILXMFretSuppressionRange[],
): ILXMSystemLayout[] => {
  if (suppressionRanges.length === 0) return systems;

  return systems.map((system) => {
    let systemChanged = false;
    const measures = system.measures.map((measure) => {
      const notes = measure.notes.filter(
        (note) =>
          !suppressionRanges.some(
            (range) =>
              range.beatId === note.beatId &&
              note.string >= range.minString &&
              note.string <= range.maxString,
          ),
      );
      if (notes.length === measure.notes.length) return measure;
      systemChanged = true;
      return { ...measure, notes };
    });
    return systemChanged ? { ...system, measures } : system;
  });
};

/**
 * 让符干避开同 Beat 的扫弦/琶音范围。
 *
 * duration layout 仍先用完整 Note 计算 beam/flag；技巧范围确定后这里只扩大 stem
 * 起点到“最低 Note 与最下方技巧弦线”两者中更靠下的位置，不改其他节奏几何。
 */
const applyChordTraversalDurationProjection = (
  systems: ILXMSystemLayout[],
  techniques: ILXMTechnique[],
): ILXMSystemLayout[] => {
  type ChordTraversalTechnique = Extract<
    ILXMTechnique,
    { type: "strum" | "arpeggio" }
  >;
  const techniquesByBeatId = new Map<string, ChordTraversalTechnique[]>();
  techniques.forEach((technique) => {
    if (technique.type !== "strum" && technique.type !== "arpeggio") return;
    const beatTechniques = techniquesByBeatId.get(technique.beatId) ?? [];
    beatTechniques.push(technique);
    techniquesByBeatId.set(technique.beatId, beatTechniques);
  });
  if (techniquesByBeatId.size === 0) return systems;

  return systems.map((system) => {
    let systemChanged = false;
    const measures = system.measures.map((measure) => {
      let measureChanged = false;
      const durationMarks = measure.durationMarks.map((mark) => {
        const beatTechniques = techniquesByBeatId.get(mark.beatId);
        if (!beatTechniques) return mark;
        const stemY1 = beatTechniques.reduce((lowestY, technique) => {
          const stringY = measure.strings.find(
            (string) => string.index === technique.maxString,
          )?.y1;
          if (stringY === undefined) return lowestY;
          // 下行琶音的显式箭头会越过最下方弦线；复用同一个 offset 常量，保证
          // 箭头视觉几何与符干避让始终同步。扫弦和上行琶音没有底部延伸。
          const techniqueBottomOffset =
            technique.type === "arpeggio" &&
            technique.direction === "descending"
              ? LXM_TECHNIQUE_ARROW_OFFSET_Y
              : 0;
          return Math.max(
            lowestY,
            stringY +
              LXM_DURATION_STEM_NOTE_GAP +
              techniqueBottomOffset,
          );
        }, mark.stemY1);
        if (stemY1 === mark.stemY1) return mark;
        measureChanged = true;
        return { ...mark, stemY1 };
      });
      if (!measureChanged) return measure;
      systemChanged = true;
      return { ...measure, durationMarks };
    });
    return systemChanged ? { ...system, measures } : system;
  });
};

const isStaffLocal = (technique: ILXMTechnique): boolean =>
  technique.type === "slideUp" ||
  technique.type === "slideDown" ||
  technique.type === "naturalHarmonic" ||
  technique.type === "artificialHarmonic" ||
  technique.type === "strum" ||
  technique.type === "arpeggio";

const getTechniqueEndpoints = (
  technique: ILXMTechnique,
  anchors: ILXMAnchorMaps,
): {
  startSystem: number;
  endSystem: number;
  startX: number;
  endX: number;
} | null => {
  if ("toNoteId" in technique) {
    const from = anchors.notes.get(technique.fromNoteId);
    const to = anchors.notes.get(technique.toNoteId);
    return from && to
      ? {
          startSystem: from.systemIndex,
          endSystem: to.systemIndex,
          startX: from.layout.x,
          endX: to.layout.x,
        }
      : null;
  }
  if ("fromBeatId" in technique) {
    const from = anchors.beats.get(technique.fromBeatId);
    const to = anchors.beats.get(technique.toBeatId);
    return from && to
      ? {
          startSystem: from.systemIndex,
          endSystem: to.systemIndex,
          startX: from.x,
          endX: to.x + to.width,
        }
      : null;
  }
  if ("beatId" in technique) {
    const beat = anchors.beats.get(technique.beatId);
    return beat
      ? {
          startSystem: beat.systemIndex,
          endSystem: beat.systemIndex,
          startX: beat.x - 10,
          endX: beat.x + 10,
        }
      : null;
  }
  const note = anchors.notes.get(technique.fromNoteId);
  return note
    ? {
        startSystem: note.systemIndex,
        endSystem: note.systemIndex,
        startX: note.layout.x - 10,
        endX: note.layout.x + 10,
      }
    : null;
};

/** 将一个领域区间按当前 system 分组拆成互不跨行的候选 segment。 */
const createCandidates = (
  track: ILXMTrack,
  systems: ILXMSystemLayout[],
  anchors: ILXMAnchorMaps,
): ILXMTechniqueCandidate[] =>
  track.techniques.flatMap((technique) => {
    const endpoints = getTechniqueEndpoints(technique, anchors);
    if (!endpoints) return [];
    if (
      (technique.type === "strum" || technique.type === "arpeggio") &&
      (technique.minString >= technique.maxString ||
        !anchors.beats
          .get(technique.beatId)
          ?.stringYByIndex.has(technique.minString) ||
        !anchors.beats
          .get(technique.beatId)
          ?.stringYByIndex.has(technique.maxString))
    )
      // buildLayout 是公开函数，不能假设所有调用者都先执行过语义校验。非法整拍
      // 技巧直接跳过，比输出含 Infinity/NaN 的 path 与 bounds 更安全、可预测。
      return [];
    const candidates: ILXMTechniqueCandidate[] = [];
    for (
      let systemIndex = endpoints.startSystem;
      systemIndex <= endpoints.endSystem;
      systemIndex += 1
    ) {
      const system = systems[systemIndex];
      if (!system) continue;
      const isFirst = systemIndex === endpoints.startSystem;
      const isLast = systemIndex === endpoints.endSystem;
      candidates.push({
        technique,
        systemIndex,
        segmentIndex: candidates.length,
        continuation:
          isFirst && isLast
            ? "none"
            : isFirst
              ? "toNext"
              : isLast
                ? "fromPrevious"
                : "both",
        x1: isFirst ? endpoints.startX : system.header.staffX + 4,
        x2: isLast ? endpoints.endX : getSystemRight(system) - 4,
        staffLocal: isStaffLocal(technique),
      });
    }
    return candidates;
  });

/** first-fit interval partitioning：稳定、确定且能复用最低空闲 lane。 */
const assignLanes = (
  candidates: ILXMTechniqueCandidate[],
  systemCount: number,
): { lanes: Map<ILXMTechniqueCandidate, number>; laneCounts: number[] } => {
  const lanes = new Map<ILXMTechniqueCandidate, number>();
  const laneCounts = Array.from({ length: systemCount }, () => 0);
  for (let systemIndex = 0; systemIndex < systemCount; systemIndex += 1) {
    const laneEnds: number[] = [];
    const ordered = candidates
      .filter(
        (candidate) =>
          candidate.systemIndex === systemIndex && !candidate.staffLocal,
      )
      .sort(
        (left, right) =>
          left.x1 - right.x1 ||
          left.x2 - right.x2 ||
          left.technique.id.localeCompare(right.technique.id),
      );
    ordered.forEach((candidate) => {
      const lane = laneEnds.findIndex(
        (end) => end + LXM_TECHNIQUE_HORIZONTAL_CLEARANCE < candidate.x1,
      );
      const assigned = lane < 0 ? laneEnds.length : lane;
      laneEnds[assigned] = candidate.x2;
      lanes.set(candidate, assigned);
    });
    laneCounts[systemIndex] = laneEnds.length;
  }
  candidates
    .filter((candidate) => candidate.staffLocal)
    .forEach((candidate) => lanes.set(candidate, -1));
  return { lanes, laneCounts };
};

const translateBarline = (
  barline: ILXMBarlineLayout | null,
  dy: number,
): ILXMBarlineLayout | null =>
  barline
    ? {
        ...barline,
        parts: barline.parts.map((part) =>
          part.kind === "line"
            ? { ...part, y1: part.y1 + dy, y2: part.y2 + dy }
            : { ...part, cy: part.cy + dy },
        ),
      }
    : null;

/**
 * 平移完整 measure，而不是只改 measure.y。
 *
 * layout 产物是渲染和命中的唯一坐标来源；若遗漏 Note、beam 或 rest 中任一个子项，
 * 页面就会出现“弦线下移但技巧/选择仍停在旧位置”的隐蔽漂移。
 */
const translateMeasure = (
  measure: ILXMMeasureLayout,
  dy: number,
): ILXMMeasureLayout => ({
  ...measure,
  y: measure.y + dy,
  strings: measure.strings.map((line) => ({
    ...line,
    y1: line.y1 + dy,
    y2: line.y2 + dy,
  })),
  notes: measure.notes.map((note) => ({ ...note, y: note.y + dy })),
  restMarks: measure.restMarks.map((rest) => ({ ...rest, y: rest.y + dy })),
  barline: translateBarline(measure.barline, dy)!,
  timeSignature: measure.timeSignature
    ? {
        ...measure.timeSignature,
        numerator: {
          ...measure.timeSignature.numerator,
          y: measure.timeSignature.numerator.y + dy,
        },
        denominator: {
          ...measure.timeSignature.denominator,
          y: measure.timeSignature.denominator.y + dy,
        },
      }
    : null,
  beamSegments: measure.beamSegments.map((beam) => ({
    ...beam,
    y: beam.y + dy,
  })),
  durationMarks: measure.durationMarks.map((mark) => ({
    ...mark,
    head: { ...mark.head, y: mark.head.y + dy },
    stemY1: mark.stemY1 + dy,
    stemY2: mark.stemY2 + dy,
    beamY: mark.beamY + dy,
    sustainMarks: mark.sustainMarks.map((item) => ({
      ...item,
      y: item.y + dy,
    })),
    flag: mark.flag ? { ...mark.flag, y: mark.flag.y + dy } : null,
    dotAnchors: mark.dotAnchors.map((dot) => ({ ...dot, y: dot.y + dy })),
  })),
});

const translateSystems = (
  systems: ILXMSystemLayout[],
  laneCounts: number[],
  systemGapY: number,
): ILXMSystemLayout[] => {
  let nextTop = systems[0]?.y ?? 0;
  return systems.map((system) => {
    const laneCount = laneCounts[system.index] ?? 0;
    const techniqueHeight =
      laneCount === 0
        ? 0
        : LXM_TECHNIQUE_AREA_PADDING_TOP +
          laneCount * LXM_TECHNIQUE_LANE_HEIGHT +
          LXM_TECHNIQUE_AREA_PADDING_BOTTOM;
    const newTop = nextTop;
    const contentDy = newTop + techniqueHeight - system.y;
    const translated: ILXMSystemLayout = {
      ...system,
      y: newTop,
      height: system.height + techniqueHeight,
      techniqueLaneCount: laneCount,
      header: {
        ...system.header,
        tabLetters: system.header.tabLetters.map((letter) => ({
          ...letter,
          y: letter.y + contentDy,
        })),
        strings: system.header.strings.map((line) => ({
          ...line,
          y1: line.y1 + contentDy,
          y2: line.y2 + contentDy,
        })),
        leadingBarline: translateBarline(
          system.header.leadingBarline,
          contentDy,
        ),
      },
      measures: system.measures.map((measure) =>
        translateMeasure(measure, contentDy),
      ),
      techniques: [],
    };
    nextTop = translated.y + translated.height + systemGapY;
    return translated;
  });
};

const text = (value: string, x: number, y: number): ILXMTextLayout => ({
  text: value,
  x,
  y,
  fontSize: LXM_TECHNIQUE_TEXT_FONT_SIZE,
  textAnchor: "middle",
});

const wavePath = (x1: number, x2: number, y: number): string => {
  const parts = [`M ${x1} ${y}`];
  for (let x = x1; x < x2; x += 6) {
    const end = Math.min(x + 6, x2);
    parts.push(`Q ${x + 1.5} ${y - 2} ${x + 3} ${y}`);
    parts.push(`Q ${x + 4.5} ${y + 2} ${end} ${y}`);
  }
  return parts.join(" ");
};

const verticalWavePath = (x: number, y1: number, y2: number): string => {
  const parts = [`M ${x} ${y1}`];
  const direction = y2 >= y1 ? 1 : -1;
  // 琶音既可能从低音弦向高音弦，也可能反向；步长携带方向后，两种路径共用
  // 同一算法，箭头始终落在音乐语义中的终点。
  for (let y = y1; direction > 0 ? y < y2 : y > y2; y += 6 * direction) {
    const candidateEnd = y + 6 * direction;
    const end =
      direction > 0 ? Math.min(candidateEnd, y2) : Math.max(candidateEnd, y2);
    parts.push(`Q ${x - 2} ${y + 1.5 * direction} ${x} ${y + 3 * direction}`);
    parts.push(`Q ${x + 2} ${y + 4.5 * direction} ${x} ${end}`);
  }
  return parts.join(" ");
};

const getTranslatedAnchorMaps = (systems: ILXMSystemLayout[]) =>
  buildAnchorMaps(systems);

const createSegmentLayout = (
  candidate: ILXMTechniqueCandidate,
  lane: number,
  system: ILXMSystemLayout,
  anchors: ILXMAnchorMaps,
): ILXMTechniqueSegmentLayout => {
  const technique = candidate.technique;
  const laneY =
    system.y +
    LXM_TECHNIQUE_AREA_PADDING_TOP +
    (lane + 1) * LXM_TECHNIQUE_LANE_HEIGHT -
    4;
  let path: ILXMTechniqueSegmentLayout["path"] = null;
  let arrowHead: ILXMTechniqueSegmentLayout["arrowHead"];
  let focusEndpoints: ILXMTechniqueSegmentLayout["focusEndpoints"];
  let texts: ILXMTextLayout[] = [];
  let minY = laneY - 8;
  let maxY = laneY + 4;
  let x1 = Math.min(candidate.x1, candidate.x2);
  let x2 = Math.max(candidate.x1, candidate.x2);

  if ("toNoteId" in technique) {
    const from = anchors.notes.get(technique.fromNoteId)?.layout;
    const to = anchors.notes.get(technique.toNoteId)?.layout;
    if (
      (technique.type === "slideUp" || technique.type === "slideDown") &&
      from &&
      to
    ) {
      x1 = from.x + 6;
      x2 = to.x - 6;
      minY = Math.min(from.y, to.y) - 4;
      maxY = Math.max(from.y, to.y) + 4;
      path = {
        d: `M ${x1} ${from.y} L ${x2} ${to.y}`,
        strokeWidth: LXM_TECHNIQUE_PATH_STROKE_WIDTH,
      };
    } else {
      const curveY = laneY;
      path = {
        d: `M ${candidate.x1} ${curveY} Q ${(candidate.x1 + candidate.x2) / 2} ${curveY - 8} ${candidate.x2} ${curveY}`,
        strokeWidth: LXM_TECHNIQUE_PATH_STROKE_WIDTH,
      };
      if (
        candidate.segmentIndex === 0 &&
        (technique.type === "hammerOn" || technique.type === "pullOff")
      )
        texts = [
          text(
            technique.type === "hammerOn" ? "H" : "P",
            (candidate.x1 + candidate.x2) / 2,
            curveY - 5,
          ),
        ];
    }
  } else if ("fromBeatId" in technique) {
    const label = technique.type === "palmMute" ? "P.M." : "let ring";
    const labelWidth = technique.type === "palmMute" ? 22 : 38;
    const lineStart =
      candidate.segmentIndex === 0 ? candidate.x1 + labelWidth : candidate.x1;
    path = {
      d: `M ${lineStart} ${laneY} L ${candidate.x2} ${laneY} L ${candidate.x2} ${laneY + 4}`,
      strokeWidth: LXM_TECHNIQUE_PATH_STROKE_WIDTH,
      dashArray: "4 3",
    };
    if (candidate.segmentIndex === 0)
      texts = [text(label, candidate.x1 + labelWidth / 2, laneY + 3)];
  } else if ("beatId" in technique) {
    const beat = anchors.beats.get(technique.beatId);
    if (beat) {
      if (technique.type === "pickStroke") {
        texts = [text(technique.stroke === "down" ? "⌄" : "⌃", beat.x, laneY)];
      } else {
        const fromY = beat.stringYByIndex.get(technique.minString);
        const toY = beat.stringYByIndex.get(technique.maxString);
        // createCandidates 已过滤非法范围；这里保留窄化守卫，防止未来 anchor 构建
        // 契约变化时把 undefined 坐标传播到 SVG path。
        if (fromY === undefined || toY === undefined) return {
            techniqueId: technique.id,
            type: technique.type,
            systemIndex: candidate.systemIndex,
            segmentIndex: candidate.segmentIndex,
            continuation: candidate.continuation,
            lane,
            path: null,
            texts: [],
            bounds: { x: beat.x, y: 0, width: 0, height: 0 },
          };
        const y1 = Math.min(fromY, toY) - 2;
        const y2 = Math.max(fromY, toY) + 2;
        // 基础品位在投影阶段隐藏，因此记号应与 Beat/Note 的时间中心重合。
        const x = beat.x;
        x1 = x - 3;
        x2 = x + 3;
        minY = y1;
        maxY = y2;
        const directionStartY =
          technique.type === "arpeggio"
            ? technique.direction === "ascending"
              ? y2
              : y1
            : technique.stroke === "down"
              ? y2
              : y1;
        const directionEndY = directionStartY === y1 ? y2 : y1;
        focusEndpoints = {
          start: { x, y: directionStartY },
          end: { x, y: directionEndY },
        };
        path =
          technique.type === "arpeggio"
            ? {
                // TAB 的低音弦在视觉下方：上行音高从 y2 走向 y1，下行反之。
                d:
                  technique.direction === "ascending"
                    ? verticalWavePath(x, y2, y1)
                    : verticalWavePath(x, y1, y2),
                strokeWidth: LXM_TECHNIQUE_PATH_STROKE_WIDTH,
              }
            : {
                // down/up 是演奏手方向。TAB 的低音弦在下方，因此 down 从 y2 指向
                // y1；up 反向。页面只渲染 marker，不接触这层坐标语义。
                d:
                  technique.stroke === "down"
                    ? `M ${x} ${y2} L ${x} ${y1}`
                    : `M ${x} ${y1} L ${x} ${y2}`,
                strokeWidth: LXM_TECHNIQUE_PATH_STROKE_WIDTH,
                markerEnd: "arrow",
              };
        if (technique.type === "arpeggio") {
          const direction = technique.direction === "ascending" ? "up" : "down";
          const offsetTipY = direction === "up" ? -LXM_TECHNIQUE_ARROW_OFFSET_Y : LXM_TECHNIQUE_ARROW_OFFSET_Y;
          const tipY = (direction === "up" ? y1 : y2) + offsetTipY;
          const baseY =
            direction === "up"
              ? tipY + LXM_TECHNIQUE_ARROW_HEIGHT
              : tipY - LXM_TECHNIQUE_ARROW_HEIGHT;
          arrowHead = {
            direction,
            points: [
              [x, tipY],
              [x - LXM_TECHNIQUE_ARROW_WIDTH / 2, baseY],
              [x + LXM_TECHNIQUE_ARROW_WIDTH / 2, baseY],
            ],
          };
          minY = Math.min(minY, tipY, baseY);
          maxY = Math.max(maxY, tipY, baseY);
          x1 = Math.min(x1, x - LXM_TECHNIQUE_ARROW_WIDTH / 2);
          x2 = Math.max(x2, x + LXM_TECHNIQUE_ARROW_WIDTH / 2);
        }
      }
    }
  } else {
    const note = anchors.notes.get(technique.fromNoteId)?.layout;
    if (note) {
      if (technique.type === "naturalHarmonic") {
        texts = [text(`<${note.fret}>`, note.x, note.y + 4)];
        minY = note.y - 8;
        maxY = note.y + 6;
      } else if (technique.type === "artificialHarmonic") {
        texts = [text(`[${note.fret}]`, note.x, note.y + 4)];
        minY = note.y - 8;
        maxY = note.y + 6;
      } else if (technique.type === "vibrato") {
        path = {
          d: wavePath(note.x - 8, note.x + 12, laneY),
          strokeWidth: LXM_TECHNIQUE_PATH_STROKE_WIDTH,
        };
      } else if (technique.type === "bend") {
        path = {
          d: `M ${note.x} ${laneY + 3} Q ${note.x + 8} ${laneY - 8} ${note.x + 16} ${laneY - 8}`,
          strokeWidth: LXM_TECHNIQUE_PATH_STROKE_WIDTH,
          markerEnd: "arrow",
        };
        texts = [text("Full", note.x + 20, laneY - 5)];
        x2 = note.x + 36;
      } else if (technique.type === "tapping") {
        texts = [text("T", note.x, laneY)];
      } else if (technique.type === "trill") {
        texts = [text(`tr ${technique.auxiliaryFret}`, note.x, laneY)];
        path = {
          d: wavePath(note.x + 10, note.x + 28, laneY - 3),
          strokeWidth: LXM_TECHNIQUE_PATH_STROKE_WIDTH,
        };
        x2 = note.x + 30;
      }
    }
  }

  const padding = LXM_TECHNIQUE_HIT_PADDING;
  return {
    techniqueId: technique.id,
    type: technique.type,
    systemIndex: candidate.systemIndex,
    segmentIndex: candidate.segmentIndex,
    continuation: candidate.continuation,
    lane,
    path,
    ...(arrowHead ? { arrowHead } : {}),
    ...(focusEndpoints ? { focusEndpoints } : {}),
    texts,
    bounds: {
      x: x1 - padding,
      y: minY - padding,
      width: Math.max(8, x2 - x1 + padding * 2),
      height: Math.max(8, maxY - minY + padding * 2),
    },
  };
};

export const layoutTrackTechniques = (
  track: ILXMTrack,
  baseSystems: ILXMSystemLayout[],
  systemGapY: number,
): ILXMSystemLayout[] => {
  if (baseSystems.length === 0) return baseSystems;
  // 建索引也在这里验证所有引用的目标形态，避免 layout 通过数组扫描反复寻找。
  buildTechniqueIndex(track);
  const baseAnchors = buildAnchorMaps(baseSystems);
  const candidates = createCandidates(track, baseSystems, baseAnchors);
  const { lanes, laneCounts } = assignLanes(candidates, baseSystems.length);
  const systems = translateSystems(baseSystems, laneCounts, systemGapY);
  const anchors = getTranslatedAnchorMaps(systems);

  const segmentsBySystem = new Map<number, ILXMTechniqueSegmentLayout[]>();
  candidates.forEach((candidate) => {
    const system = systems[candidate.systemIndex];
    if (!system) return;
    const segment = createSegmentLayout(
      candidate,
      lanes.get(candidate) ?? -1,
      system,
      anchors,
    );
    const segments = segmentsBySystem.get(candidate.systemIndex) ?? [];
    segments.push(segment);
    segmentsBySystem.set(candidate.systemIndex, segments);
  });

  const systemsWithTechniques = systems.map((system) => ({
    ...system,
    techniques: (segmentsBySystem.get(system.index) ?? []).sort(
      (left, right) =>
        left.lane - right.lane ||
        left.bounds.x - right.bounds.x ||
        left.techniqueId.localeCompare(right.techniqueId),
    ),
  }));
  // anchors 在投影前由完整 Note layout 建立；技巧跨度、时值符干与其他 Note 技巧
  // 均已消费真实坐标。这里过滤只影响最终 adapter 可见的基础品位文本。
  return applyFretVisibilityProjection(
    applyChordTraversalDurationProjection(
      systemsWithTechniques,
      track.techniques,
    ),
    getFretSuppressionRanges(track.techniques, anchors),
  );
};
