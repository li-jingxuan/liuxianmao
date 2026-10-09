/**
 * MVP v5 技巧布局 Module。
 *
 * 外部只调用 layoutTrackTechniques(track, baseSystems)。Module 内部完成四件事：
 * 1. 把领域技巧解析为当前自动断行下的 system segment；
 * 2. 对自然几何按二维碰撞范围分配向上的 lane；
 * 3. 统一下移 staff 正文并重新排列后续 system；
 * 4. 输出页面可直接渲染的 SVG path、文字与命中 bounds。
 *
 * 这样 website 完全不理解 Tie 换行、扫弦方向或 P.M. 续接规则；改变 systemWidth
 * 也只会重算视觉 segment，不会修改 track.techniques 中的领域事实。
 */
import { buildTechniqueIndex } from "../core/technique-rules";
import type { ILXMTechnique, ILXMTrack } from "../core/types";
import {
  LXM_TECHNIQUE_AREA_PADDING_TOP,
  LXM_TECHNIQUE_ARROW_HEIGHT,
  LXM_TECHNIQUE_ARROW_WIDTH,
  LXM_TECHNIQUE_LANE_HEIGHT,
  LXM_TECHNIQUE_PATH_STROKE_WIDTH,
  LXM_TECHNIQUE_TEXT_FONT_SIZE,
  LXM_DURATION_STEM_NOTE_GAP,
  LXM_TECHNIQUE_ARROW_OFFSET_Y,
  LXM_TECHNIQUE_NOTE_CLEARANCE_Y,
  LXM_TECHNIQUE_FRET_GAP_X,
  LXM_TECHNIQUE_CURVE_HEIGHT,
  LXM_TECHNIQUE_STAFF_CLEARANCE_Y,
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

import {
  boundsIntersect,
  getFretTextBounds,
  translateTechniqueSegment,
  withTechniqueBounds,
} from "./technique-geometry";

interface ILXMTechniqueCandidate {
  technique: ILXMTechnique;
  systemIndex: number;
  segmentIndex: number;
  continuation: ILXMTechniqueContinuation;
  x1: number;
  x2: number;
  /** staffLocal 技巧不占 system 上方 lane。 */
  staffLocal: boolean;
  /** 当前分段覆盖的稳定 Beat ID，按领域时间顺序保存。 */
  coveredBeatIds: string[];
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
            stringY + LXM_DURATION_STEM_NOTE_GAP + techniqueBottomOffset,
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
): ILXMTechniqueCandidate[] => {
  // 一次建立领域时间顺序，区间分段只读取稳定索引，不按像素或技巧反复扫描谱面。
  const beatIds = track.measures.flatMap((measure) =>
    measure.beats.map((beat) => beat.id),
  );
  const beatIndexById = new Map(beatIds.map((id, index) => [id, index]));
  return track.techniques.flatMap((technique) => {
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
    const rangeStart =
      "fromBeatId" in technique
        ? (beatIndexById.get(technique.fromBeatId) ?? -1)
        : -1;
    const rangeEnd =
      "toBeatId" in technique
        ? (beatIndexById.get(technique.toBeatId) ?? -1)
        : -1;
    const coveredBeatIds =
      rangeStart >= 0 && rangeEnd >= rangeStart
        ? beatIds.slice(rangeStart, rangeEnd + 1)
        : [];
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
        coveredBeatIds: coveredBeatIds.filter(
          (id) => anchors.beats.get(id)?.systemIndex === systemIndex,
        ),
      });
    }
    return candidates;
  });
};

/** 稳定二维 first-fit；每次向上移动完整自然 plan，直到避开已放置图形和品位文字。 */
const assignLanes = (
  candidates: ILXMTechniqueCandidate[],
  naturalPlans: Map<ILXMTechniqueCandidate, ILXMTechniqueSegmentLayout>,
  anchors: ILXMAnchorMaps,
): Map<number, ILXMTechniqueSegmentLayout[]> => {
  const segmentsBySystem = new Map<number, ILXMTechniqueSegmentLayout[]>();
  const ordered = [...candidates].sort((left, right) => {
    const a = naturalPlans.get(left)!.collisionBounds;
    const b = naturalPlans.get(right)!.collisionBounds;
    return (
      left.systemIndex - right.systemIndex ||
      a.x - b.x ||
      a.x + a.width - b.x - b.width ||
      left.technique.id.localeCompare(right.technique.id) ||
      left.segmentIndex - right.segmentIndex
    );
  });
  // 先登记固定的 staffLocal 障碍，避免遍历顺序让后加入的泛音/扫弦撞到局部技巧。
  [
    ...ordered.filter((candidate) => candidate.staffLocal),
    ...ordered.filter((candidate) => !candidate.staffLocal),
  ].forEach((candidate) => {
    const natural = naturalPlans.get(candidate)!;
    const placed = segmentsBySystem.get(candidate.systemIndex) ?? [];
    const technique = candidate.technique;
    const ownNoteIds = new Set<string>();
    if ("fromNoteId" in technique) ownNoteIds.add(technique.fromNoteId);
    if ("toNoteId" in technique) ownNoteIds.add(technique.toNoteId);
    if ("beatId" in technique) {
      anchors.beats
        .get(technique.beatId)
        ?.notes.forEach((note) => ownNoteIds.add(note.id));
    }
    // 区间说明始终位于 staff 上方；只有音符局部技巧需要避让其它品位文字。
    const obstacles =
      candidate.staffLocal || "fromBeatId" in technique
        ? []
        : [...anchors.notes.values()]
            .filter(
              (note) =>
                note.systemIndex === candidate.systemIndex &&
                !ownNoteIds.has(note.layout.id),
            )
            .map((note) => getFretTextBounds(note.layout));
    let lane = candidate.staffLocal ? -1 : 0;
    let segment = natural;
    if (!candidate.staffLocal) {
      while (
        placed.some((other) =>
          boundsIntersect(segment.collisionBounds, other.collisionBounds),
        ) ||
        obstacles.some((bounds) =>
          boundsIntersect(segment.collisionBounds, bounds),
        )
      ) {
        lane += 1;
        segment = translateTechniqueSegment(
          natural,
          -lane * LXM_TECHNIQUE_LANE_HEIGHT,
        );
      }
    }
    placed.push({ ...segment, lane });
    segmentsBySystem.set(candidate.systemIndex, placed);
  });
  return segmentsBySystem;
};

export const translateBarline = (
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
export const translateMeasure = (
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
  tuplets: measure.tuplets.map((group) => ({
    ...group,
    label: { ...group.label, y: group.label.y + dy },
    bracket: group.bracket
      ? {
          ...group.bracket,
          y: group.bracket.y + dy,
          lines: group.bracket.lines.map((line) => ({
            ...line,
            y1: line.y1 + dy,
            y2: line.y2 + dy,
          })),
        }
      : null,
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
  segmentsBySystem: Map<number, ILXMTechniqueSegmentLayout[]>,
  systemGapY: number,
): ILXMSystemLayout[] => {
  let nextTop = systems[0]?.y ?? 0;
  return systems.map((system) => {
    const segments = segmentsBySystem.get(system.index) ?? [];
    const laneCount = Math.max(
      0,
      ...segments.map((segment) => segment.lane + 1),
    );
    // 从最终图形而非 lane 数量反推扩高，顶部 padding 同时覆盖命中净空。
    const minVisualY = Math.min(
      ...segments.map((segment) => segment.visualBounds.y),
    );
    const techniqueHeight = Math.max(
      0,
      system.y + LXM_TECHNIQUE_AREA_PADDING_TOP - minVisualY,
    );
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
      techniques: segments.map((segment) =>
        translateTechniqueSegment(segment, contentDy),
      ),
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

/** 以 base system 页面坐标一次生成自然几何，后续阶段只做整体平移。 */
const createNaturalSegmentLayout = (
  candidate: ILXMTechniqueCandidate,
  system: ILXMSystemLayout,
  anchors: ILXMAnchorMaps,
): ILXMTechniqueSegmentLayout => {
  const technique = candidate.technique;
  const anchorNotes: ILXMNoteLayout[] = [];
  if ("fromNoteId" in technique) {
    const from = anchors.notes.get(technique.fromNoteId);
    if (from?.systemIndex === candidate.systemIndex)
      anchorNotes.push(from.layout);
  }
  if ("toNoteId" in technique) {
    const to = anchors.notes.get(technique.toNoteId);
    if (to?.systemIndex === candidate.systemIndex) anchorNotes.push(to.layout);
  }
  if ("beatId" in technique)
    anchorNotes.push(...(anchors.beats.get(technique.beatId)?.notes ?? []));
  const staffTop = system.measures[0]?.strings[0]?.y1 ?? system.y;
  const staffBaseline = staffTop - LXM_TECHNIQUE_STAFF_CLEARANCE_Y;
  const rangeNotes = candidate.coveredBeatIds.flatMap(
    (id) => anchors.beats.get(id)?.notes ?? [],
  );
  const laneY =
    "fromBeatId" in technique
      ? Math.min(
          staffBaseline,
          ...rangeNotes.map((note) => note.y - LXM_TECHNIQUE_NOTE_CLEARANCE_Y),
        )
      : anchorNotes.length > 0
        ? Math.min(...anchorNotes.map((note) => note.y)) -
          LXM_TECHNIQUE_NOTE_CLEARANCE_Y
        : staffBaseline;
  let path: ILXMTechniqueSegmentLayout["path"] = null;
  let arrowHead: ILXMTechniqueSegmentLayout["arrowHead"];
  let focusEndpoints: ILXMTechniqueSegmentLayout["focusEndpoints"];
  let texts: ILXMTextLayout[] = [];
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
      const fromIsLocal =
        anchors.notes.get(technique.fromNoteId)?.systemIndex ===
        candidate.systemIndex;
      const toIsLocal =
        anchors.notes.get(technique.toNoteId)?.systemIndex ===
        candidate.systemIndex;
      x1 = fromIsLocal ? from.x + 6 : candidate.x1;
      x2 = toIsLocal ? to.x - 6 : candidate.x2;
      const localStringY =
        system.measures[0]?.strings.find(
          (string) => string.index === from.string,
        )?.y1 ?? staffTop;
      path = {
        d: `M ${x1} ${fromIsLocal ? from.y : localStringY} L ${x2} ${toIsLocal ? to.y : localStringY}`,
        strokeWidth: LXM_TECHNIQUE_PATH_STROKE_WIDTH,
      };
    } else {
      const curveY = laneY;
      // 真实首尾端避开完整品位与白色描边；续接端保持在本行 staff 安全边。
      const fromBounds = from ? getFretTextBounds(from) : null;
      const toBounds = to ? getFretTextBounds(to) : null;
      const startX =
        candidate.continuation === "none" || candidate.continuation === "toNext"
          ? fromBounds
            ? fromBounds.x + fromBounds.width + LXM_TECHNIQUE_FRET_GAP_X
            : candidate.x1
          : candidate.x1;
      const endX =
        candidate.continuation === "none" ||
        candidate.continuation === "fromPrevious"
          ? toBounds
            ? toBounds.x - LXM_TECHNIQUE_FRET_GAP_X
            : candidate.x2
          : candidate.x2;
      // 极短距离退化为零长安全弧线，不生成方向反转的路径。
      x1 = startX;
      x2 = Math.max(startX, endX);
      path = {
        d: `M ${x1} ${curveY} Q ${(x1 + x2) / 2} ${curveY - LXM_TECHNIQUE_CURVE_HEIGHT} ${x2} ${curveY}`,
        strokeWidth: LXM_TECHNIQUE_PATH_STROKE_WIDTH,
      };
      if (
        candidate.segmentIndex === 0 &&
        (technique.type === "hammerOn" || technique.type === "pullOff")
      )
        texts = [
          text(
            technique.type === "hammerOn" ? "H" : "P",
            (x1 + x2) / 2,
            curveY - LXM_TECHNIQUE_NOTE_CLEARANCE_Y,
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
        texts = [
          text(
            technique.stroke === "down" ? "⌄" : "⌃",
            beat.notes[0]?.x ?? beat.x,
            laneY,
          ),
        ];
      } else {
        const fromY = beat.stringYByIndex.get(technique.minString);
        const toY = beat.stringYByIndex.get(technique.maxString);
        // createCandidates 已过滤非法范围；这里保留窄化守卫，防止未来 anchor 构建
        // 契约变化时把 undefined 坐标传播到 SVG path。
        if (fromY === undefined || toY === undefined) {
          return withTechniqueBounds({
            techniqueId: technique.id,
            type: technique.type,
            systemIndex: candidate.systemIndex,
            segmentIndex: candidate.segmentIndex,
            continuation: candidate.continuation,
            lane: -1,
            path: null,
            texts: [],
          });
        }
        const y1 = Math.min(fromY, toY) - 2;
        const y2 = Math.max(fromY, toY) + 2;
        // 基础品位在投影阶段隐藏，因此记号应与 Beat/Note 的时间中心重合。
        const x = beat.x;
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
          const offsetTipY =
            direction === "up"
              ? -LXM_TECHNIQUE_ARROW_OFFSET_Y
              : LXM_TECHNIQUE_ARROW_OFFSET_Y;
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
        }
      }
    }
  } else {
    const note = anchors.notes.get(technique.fromNoteId)?.layout;
    if (note) {
      if (technique.type === "naturalHarmonic") {
        texts = [text(`<${note.fret}>`, note.x, note.y + 4)];
      } else if (technique.type === "artificialHarmonic") {
        texts = [text(`[${note.fret}]`, note.x, note.y + 4)];
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
      } else if (technique.type === "tapping") {
        texts = [text("T", note.x, laneY)];
      } else if (technique.type === "trill") {
        texts = [text(`tr ${technique.auxiliaryFret}`, note.x, laneY)];
        path = {
          d: wavePath(note.x + 10, note.x + 28, laneY - 3),
          strokeWidth: LXM_TECHNIQUE_PATH_STROKE_WIDTH,
        };
      }
    }
  }

  return withTechniqueBounds({
    techniqueId: technique.id,
    type: technique.type,
    systemIndex: candidate.systemIndex,
    segmentIndex: candidate.segmentIndex,
    continuation: candidate.continuation,
    lane: candidate.staffLocal ? -1 : 0,
    path,
    ...(arrowHead ? { arrowHead } : {}),
    ...(focusEndpoints ? { focusEndpoints } : {}),
    texts,
  });
};

export const planTrackTechniques = (
  track: ILXMTrack,
  baseSystems: ILXMSystemLayout[],
): ILXMSystemLayout[] => {
  if (baseSystems.length === 0) return baseSystems;
  // 建索引也在这里验证所有引用的目标形态，避免 layout 通过数组扫描反复寻找。
  buildTechniqueIndex(track);
  const baseAnchors = buildAnchorMaps(baseSystems);
  const candidates = createCandidates(track, baseSystems, baseAnchors);
  const naturalPlans = new Map(
    candidates.map((candidate) => [
      candidate,
      createNaturalSegmentLayout(
        candidate,
        baseSystems[candidate.systemIndex]!,
        baseAnchors,
      ),
    ]),
  );
  const segmentsBySystem = assignLanes(candidates, naturalPlans, baseAnchors);
  const systems = baseSystems.map((system) => ({
    ...system,
    techniques: segmentsBySystem.get(system.index) ?? [],
  }));
  const systemsWithTechniques = systems.map((system) => ({
    ...system,
    techniques: [...system.techniques].sort(
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
    getFretSuppressionRanges(track.techniques, baseAnchors),
  );
};

/** 原公开门面复用同一规划；新联合布局在文本规划后统一平移。 */
export const layoutTrackTechniques = (
  track: ILXMTrack,
  baseSystems: ILXMSystemLayout[],
  systemGapY: number,
) => {
  const planned = planTrackTechniques(track, baseSystems);
  return translateSystems(
    planned,
    new Map(planned.map((system) => [system.index, system.techniques])),
    systemGapY,
  );
};
