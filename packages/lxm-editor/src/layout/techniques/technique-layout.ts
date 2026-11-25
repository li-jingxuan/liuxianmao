/**
 * MVP v5 技巧布局 Module。
 *
 * 外部只调用 layoutTrackTechniques(track, baseSystems)。Module 内部完成四件事：
 * 1. 把领域技巧解析为当前自动断行下的 system segment；
 * 2. 弧线保留目标弦位，其他技巧按二维碰撞范围分配向上的 lane；
 * 3. 统一下移 staff 正文并重新排列后续 system；
 * 4. 输出页面可直接渲染的 SVG path、文字与命中 bounds。
 *
 * 这样 website 完全不理解 Tie 换行、扫弦方向或 P.M. 续接规则；改变 systemWidth
 * 也只会重算视觉 segment，不会修改 track.techniques 中的领域事实。
 */
import { buildTechniqueIndex } from "../../core/techniques/technique-rules";
import type { ILXMTechnique, ILXMTrack } from "../../core/types";
import {
  LXM_TECHNIQUE_AREA_PADDING_TOP,
  LXM_TECHNIQUE_LANE_HEIGHT,
  LXM_TECHNIQUE_PATH_STROKE_WIDTH,
  LXM_TECHNIQUE_TEXT_FONT_SIZE,
  LXM_TECHNIQUE_TEXT_HALO_WIDTH,
  LXM_TECHNIQUE_NOTE_CLEARANCE_Y,
  LXM_TECHNIQUE_FRET_GAP_X,
  LXM_TECHNIQUE_CURVE_HEIGHT,
  LXM_TECHNIQUE_CURVE_INK_GAP,
  LXM_TECHNIQUE_CURVE_FRET_GAP_Y,
  LXM_TECHNIQUE_STAFF_CLEARANCE_Y,
  LXM_NATURAL_HARMONIC_TEXT_FONT_SIZE,
  LXM_FRET_TEXT_BASELINE_OFFSET_Y,
} from "../layout-constants";
import type {
  ILXMNoteLayout,
  ILXMSystemLayout,
  ILXMTechniqueContinuation,
  ILXMTechniqueSegmentLayout,
  ILXMTextLayout,
} from "../layout-types";
import { translateBarline, translateMeasure } from "../layout-translation";

import {
  boundsIntersect,
  compactRangeTechnique,
  getFretTextBounds,
  getTextBounds,
  getTechniqueInkBounds,
  getTechniqueMarkerArrowPoints,
  hasChordTraversalRange,
  placeCurveLabelAboveApex,
  translateTechniqueSegment,
  withTechniqueBounds,
} from "./technique-geometry";
import {
  isAnchoredCurve,
  placeAnchoredCurve,
  techniqueInkIntersects,
} from "./technique-curve-placement";
import {
  TECHNIQUE_BEND_RISE,
  TECHNIQUE_BEND_RUN,
  TECHNIQUE_LABEL_GAP,
  TECHNIQUE_WAVE_MAX_WIDTH,
  TECHNIQUE_WAVE_MIN_WIDTH,
  strumOffsetFromFrets,
  techniqueLabelWidth,
  vibratoStartOffset,
} from "./technique-spacing";

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

const SLIDE_LABEL_CLEARANCE = 3;

interface ILXMAnchorMaps {
  /** 只关联同一音符上的推弦与揉弦，不改变领域技巧对象。 */
  bendNoteIds: Set<string>;
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
  return { notes, beats, bendNoteIds: new Set() };
};

/**
 * 收集应隐藏基础品位文本和同拍休止符的 Beat × 弦范围。
 *
 * 范围端点来自用户的矩形选区，不要求端点上预先存在 Note；只要弦号能解析到当前
 * staff 的真实 Y 坐标即可。非法范围不会进入投影，避免技巧无路径时误隐藏品位。
 */
interface ILXMChordTraversalSuppressionRange {
  beatId: string;
  minString: number;
  maxString: number;
}

const getChordTraversalSuppressionRanges = (
  techniques: ILXMTechnique[],
  anchors: ILXMAnchorMaps,
): readonly ILXMChordTraversalSuppressionRange[] =>
  techniques.flatMap((technique) => {
    if (technique.type === "strum" && technique.showFrets) return [];
    return hasChordTraversalRange(technique) && anchors.beats.has(technique.beatId)
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
 * 在建立完整的技巧 anchor 后，裁剪最终可见的基础品位和休止符。
 * 休止符属于整拍，只要该拍存在有效扫弦/琶音范围就隐藏；源 Beat 保留以便删除技巧后恢复。
 * 保持结构共享既减少无关对象变化，也让调用方可以可靠判断哪些 system/measure
 * 真正受到了投影影响。
 */
const applyChordTraversalVisibilityProjection = (
  systems: ILXMSystemLayout[],
  suppressionRanges: readonly ILXMChordTraversalSuppressionRange[],
): ILXMSystemLayout[] => {
  if (suppressionRanges.length === 0) return systems;
  const suppressedBeatIds = new Set(
    suppressionRanges.map((range) => range.beatId),
  );

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
      const restMarks = measure.restMarks.filter(
        (rest) => !suppressedBeatIds.has(rest.beatId),
      );
      if (
        notes.length === measure.notes.length &&
        restMarks.length === measure.restMarks.length
      )
        return measure;
      systemChanged = true;
      return { ...measure, notes, restMarks };
    });
    return systemChanged ? { ...system, measures } : system;
  });
};

const isStaffLocal = (technique: ILXMTechnique): boolean =>
  technique.type === "slideUp" ||
  technique.type === "slideDown" ||
  technique.type === "naturalHarmonic" ||
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
          endX: technique.type === "traversalTie" ? to.x : to.x + to.width,
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
      !hasChordTraversalRange(technique)
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

/** 弧线固定端点并局部避让；其它技巧使用稳定二维 first-fit 分配向上 lane。 */
const assignLanes = (
  candidates: ILXMTechniqueCandidate[],
  naturalPlans: Map<ILXMTechniqueCandidate, ILXMTechniqueSegmentLayout>,
  anchors: ILXMAnchorMaps,
  visibleSystems: ILXMSystemLayout[],
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
  // 以路径真实端点 Y 排序，不能用含 H/P 标签的包围框上缘推断弦位。
  const curveY = (candidate: ILXMTechniqueCandidate) =>
    Number(naturalPlans.get(candidate)!.path!.d.split(" ")[2]);
  const laneCandidates = ordered.filter(
    (candidate) => !candidate.staffLocal && !isAnchoredCurve(candidate.technique),
  );
  // 先登记固定的 staffLocal 障碍，避免遍历顺序让后加入的泛音/扫弦撞到局部技巧。
  [
    ...ordered.filter((candidate) => candidate.staffLocal),
    // 弧线优先按弦的自然 Y 从上到下放置，避免技巧 ID/添加顺序决定互相抬升。
    ...ordered
      .filter(
        (candidate) =>
          !candidate.staffLocal && isAnchoredCurve(candidate.technique),
      )
      .sort((a, b) => curveY(a) - curveY(b) || a.x1 - b.x1),
    // 扫弦／琶音连音线优先贴近拍锚点，区间说明与单音标记再向上避让。
    ...laneCandidates.filter(
      ({ technique }) => technique.type === "traversalTie",
    ),
    ...laneCandidates.filter(
      ({ technique }) => technique.type !== "traversalTie",
    ),
  ].forEach((candidate) => {
    const natural = naturalPlans.get(candidate)!;
    const placed = segmentsBySystem.get(candidate.systemIndex) ?? [];
    const technique = candidate.technique;
    const relatedBend =
      technique.type === "vibrato"
        ? candidates.find(
            (c) =>
              c.systemIndex === candidate.systemIndex &&
              c.technique.type === "bend" &&
              c.technique.fromNoteId === technique.fromNoteId,
          )
        : undefined;
    const bendLane = relatedBend
      ? (placed.find((s) => s.techniqueId === relatedBend.technique.id)?.lane ??
        0)
      : 0;
    const ownNoteIds = new Set<string>();
    if ("fromNoteId" in technique) ownNoteIds.add(technique.fromNoteId);
    if ("toNoteId" in technique) ownNoteIds.add(technique.toNoteId);
    if ("beatId" in technique) {
      anchors.beats
        .get(technique.beatId)
        ?.notes.forEach((note) => ownNoteIds.add(note.id));
    }
    // 扫弦延音线贴近谱线，需避让实际可见的品位；区间说明仍保持较高位置。
    const obstacles =
      technique.type === "traversalTie"
        ? visibleSystems[candidate.systemIndex]!.measures.flatMap((measure) =>
            measure.notes.map(getFretTextBounds),
          )
        : candidate.staffLocal || "fromBeatId" in technique
          ? []
          : [...anchors.notes.values()]
              .filter(
                (note) =>
                  note.systemIndex === candidate.systemIndex &&
                  !ownNoteIds.has(note.layout.id),
              )
              .map((note) => getFretTextBounds(note.layout));
    let lane = candidate.staffLocal ? -1 : bendLane;
    let segment =
      lane > 0
        ? translateTechniqueSegment(natural, -lane * LXM_TECHNIQUE_LANE_HEIGHT)
        : natural;
    if (isAnchoredCurve(technique)) {
      segment = placeAnchoredCurve(natural, obstacles, placed);
      lane = 0;
    } else if (!candidate.staffLocal) {
      while (
        placed.some((other) => techniqueInkIntersects(segment, other)) ||
        (technique.type === "traversalTie"
          ? getTechniqueInkBounds(segment).some((piece) =>
              obstacles.some((bounds) => boundsIntersect(piece, bounds)),
            )
          : obstacles.some((bounds) =>
              boundsIntersect(segment.collisionBounds, bounds),
            ))
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
  // 弧线轮廓与端点先按原规则避让，再单独压紧 H/P；不改变弧高或挤占其它弦。
  for (const [systemIndex, segments] of segmentsBySystem) {
    const notes = [...anchors.notes.values()]
      .filter((note) => note.systemIndex === systemIndex)
      .map((note) => getFretTextBounds(note.layout));
    segments.forEach((segment, index) => {
      if ((segment.type !== "hammerOn" && segment.type !== "pullOff") ||
          !segment.texts.length || !segment.path ||
          (segment.path.d.match(/Q/g) ?? []).length !== 1) return;
      const values = segment.path.d.match(/-?(?:\d*\.)?\d+(?:e[+-]?\d+)?/gi)!.map(Number);
      if (values.length !== 6) return; // 内嵌标签的分段弧线保持既有规则。
      const apexY = (values[1]! + 2 * values[3]! + values[5]!) / 4;
      const compact = withTechniqueBounds({
        ...segment,
        texts: segment.texts.map((label) => placeCurveLabelAboveApex(label, apexY, segment.path!.strokeWidth)),
      });
      const labelBounds = getTechniqueInkBounds({ texts: compact.texts, path: null });
      if (labelBounds.some((label) => notes.some((note) => boundsIntersect(label, note))) ||
          segments.some((other, otherIndex) => otherIndex !== index && techniqueInkIntersects(compact, other))) return;
      segments[index] = compact;
    });
    for (const [index, segment] of segments.entries()) {
      const label = segment.texts[0];
      if (!label || (segment.type !== "slideUp" && segment.type !== "slideDown")) continue;
      const ink = getTextBounds(label, LXM_TECHNIQUE_TEXT_HALO_WIDTH);
      const obstacles = [...notes, ...segments.flatMap((other, otherIndex) =>
        index === otherIndex ? [] : getTechniqueInkBounds(other))];
      let bottom = ink.y + ink.height;
      while (true) {
        const bounds = { ...ink, y: bottom - ink.height };
        const blockers = obstacles.filter(obstacle => boundsIntersect(bounds, obstacle));
        if (!blockers.length) break;
        bottom = Math.min(...blockers.map(obstacle => obstacle.y)) - 0.5;
      }
      const shift = bottom - (ink.y + ink.height);
      if (shift) segments[index] = withTechniqueBounds({ ...segment, texts: [{ ...label, y: label.y + shift }] });
    }
    // H/P 已收紧后再回收区间标记按 12 单位整档避让留下的空白。
    // 从低到高收紧，保证相互覆盖的区间仍按原层级排列。
    const ranges = segments.map((segment, index) => ({ segment, index }))
      .filter(({ segment }) => segment.type === "palmMute" || segment.type === "letRing")
      .sort((a, b) => b.segment.visualBounds.y - a.segment.visualBounds.y);
    for (const { index } of ranges) {
      const segment = segments[index]!;
      const obstacles = [...notes, ...segments.flatMap((other, otherIndex) =>
        otherIndex === index ? [] : isAnchoredCurve(other)
          ? getTechniqueInkBounds(other) : [other.visualBounds])];
      let compact = compactRangeTechnique(segment,
        Math.max(0, segment.lane) * LXM_TECHNIQUE_LANE_HEIGHT, obstacles);
      // 区间标记尝试下移时，扫弦和琶音仍要留足整个符号的碰撞净空。
      // 若逐笔计算的落点越过该净空，贴到允许的边缘即可，避免退回整档高度。
      for (const other of segments) {
        if (
          (other.type !== "strum" && other.type !== "arpeggio") ||
          !techniqueInkIntersects(compact, other)
        ) continue;
        const compactBottom = compact.collisionBounds.y + compact.collisionBounds.height;
        const clearanceShift = other.collisionBounds.y - compactBottom;
        const originalShift = segment.visualBounds.y - compact.visualBounds.y;
        compact = translateTechniqueSegment(compact, Math.max(clearanceShift, originalShift));
      }
      // 仍遵守最终通用碰撞合同；极密组合不为压紧空白引入交叠。
      if (!segments.some((other, otherIndex) => otherIndex !== index && techniqueInkIntersects(compact, other))) {
        segments[index] = compact;
      }
    }
  }
  return segmentsBySystem;
};

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

const upwardCurvePath = (
  x1: number,
  x2: number,
  y: number,
): NonNullable<ILXMTechniqueSegmentLayout["path"]> => ({
  d: `M ${x1} ${y} Q ${(x1 + x2) / 2} ${y - LXM_TECHNIQUE_CURVE_HEIGHT} ${x2} ${y}`,
  strokeWidth: LXM_TECHNIQUE_PATH_STROKE_WIDTH,
});

const wavePath = (x1: number, x2: number, y: number): string => {
  const parts = [`M ${x1} ${y}`];
  for (let x = x1; x < x2; x += 6) {
    const end = Math.min(x + 6, x2);
    // 尾段不足一个周期时按剩余长度缩放，控制点也不能越过右端。
    const length = end - x;
    parts.push(`Q ${x + length / 4} ${y - 1.5} ${x + length / 2} ${y}`);
    parts.push(`Q ${x + (length * 3) / 4} ${y + 1.5} ${end} ${y}`);
  }
  return parts.join(" ");
};

/** 成品和端点拖动预览共用波线；y1 是起笔位置，y2 是箭头底边。 */
export const getArpeggioWavePath = (x: number, y1: number, y2: number): string => {
  const parts = [`M ${x} ${y1}`];
  // 以约 6 个布局单位为一个周期，把完整波形均匀铺到箭头底边。最短的相邻两弦
  // 也保留左右各一段曲线；带方向的插值让两种走向的控制点都留在路径范围内，尾部不会折返。
  const length = y2 - y1;
  const cycles = Math.max(1, Math.round(Math.abs(length) / 6));
  const step = length / cycles;
  for (let cycle = 0; cycle < cycles; cycle++) {
    const y = y1 + cycle * step;
    parts.push(`Q ${x - 2} ${y + step / 4} ${x} ${y + step / 2}`);
    parts.push(`Q ${x + 2} ${y + (step * 3) / 4} ${x} ${y + step}`);
  }
  return parts.join(" ");
};

/** 以 base system 页面坐标一次生成自然几何，后续阶段只做整体平移。 */
const createNaturalSegmentLayout = (
  candidate: ILXMTechniqueCandidate,
  system: ILXMSystemLayout,
  anchors: ILXMAnchorMaps,
  traversalTieAnchors?: {
    topByBeatId: ReadonlyMap<string, number>;
    visibleNoteIds: ReadonlySet<string>;
  },
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
      const fromBounds = getFretTextBounds(from);
      const toBounds = getFretTextBounds(to);
      x1 = fromIsLocal
        ? fromBounds.x + fromBounds.width + LXM_TECHNIQUE_FRET_GAP_X
        : candidate.x1;
      x2 = Math.max(
        x1,
        toIsLocal ? toBounds.x - LXM_TECHNIQUE_FRET_GAP_X : candidate.x2,
      );
      const localStringY =
        system.measures[0]?.strings.find(
          (string) => string.index === from.string,
        )?.y1 ?? staffTop;
      // 同弦两音的弦线 Y 相同，必须显式画斜率才能区分上滑与下滑。
      const slope = technique.type === "slideUp" ? -3 : 3;
      const startY = (fromIsLocal ? from.y : localStringY) - slope;
      const endY = (toIsLocal ? to.y : localStringY) + slope;
      path = {
        d: `M ${x1} ${startY} L ${x2} ${endY}`,
        strokeWidth: LXM_TECHNIQUE_PATH_STROKE_WIDTH,
      };
      if (candidate.segmentIndex === 0) {
        const label = text("S", (x1 + x2) / 2, 0);
        const ink = getTextBounds(label, LXM_TECHNIQUE_TEXT_HALO_WIDTH);
        const radius = path.strokeWidth / 2;
        const span = x2 - x1;
        const yAt = (x: number) => startY + (endY - startY) * Math.max(0, Math.min(1, (x - x1) / span));
        const highest = span > 0 ? Math.min(yAt(ink.x - radius), yAt(ink.x + ink.width + radius)) : Math.min(startY, endY);
        texts = [{ ...label, y: highest - radius - SLIDE_LABEL_CLEARANCE - (ink.y + ink.height) }];
      }
    } else {
      // 弧线在数字中心上方起落；连同线宽避开品位描边，紧凑短音也保留完整跨度。
      // 只读取本行锚点的上缘，跨行续接继续使用各自谱行的坐标与安全边。
      const curveY = anchorNotes.length ? Math.min(
        ...anchorNotes.map(
          (note) =>
            getFretTextBounds(note).y -
            LXM_TECHNIQUE_CURVE_FRET_GAP_Y -
            LXM_TECHNIQUE_PATH_STROKE_WIDTH / 2,
        ),
      ) : laneY;
      const startX =
        candidate.continuation === "none" || candidate.continuation === "toNext"
          ? (from?.x ?? candidate.x1)
          : candidate.x1;
      const endX =
        candidate.continuation === "none" ||
        candidate.continuation === "fromPrevious"
          ? (to?.x ?? candidate.x2)
          : candidate.x2;
      // 非法或重合坐标仍不生成反向路径；合法短音不再被两端字形宽度压成零宽。
      x1 = startX;
      x2 = Math.max(startX, endX);
      path = upwardCurvePath(x1, x2, curveY);
      if (
        candidate.segmentIndex === 0 &&
        (technique.type === "hammerOn" || technique.type === "pullOff")
      )
        texts = [
          text(
            technique.type === "hammerOn" ? "H" : "P",
            (x1 + x2) / 2,
            // 保守模板先参与弧线避让；压紧标签在全部技巧定位完成后单独执行。
            curveY -
              LXM_TECHNIQUE_CURVE_HEIGHT -
              LXM_TECHNIQUE_NOTE_CLEARANCE_Y,
          ),
        ];
    }
  } else if (technique.type === "traversalTie") {
    const inkTop = Math.min(
      staffTop,
      ...candidate.coveredBeatIds.map(
        (id) => traversalTieAnchors?.topByBeatId.get(id) ?? staffTop,
      ),
      ...rangeNotes
        .filter((note) => traversalTieAnchors?.visibleNoteIds.has(note.id))
        .map((note) => getFretTextBounds(note).y),
    );
    const tieY =
      inkTop - LXM_TECHNIQUE_CURVE_INK_GAP - LXM_TECHNIQUE_PATH_STROKE_WIDTH / 2;
    x1 = candidate.x1;
    x2 = Math.max(x1, candidate.x2);
    path = upwardCurvePath(x1, x2, tieY);
    focusEndpoints = {
      start: { x: x1, y: tieY },
      end: { x: x2, y: tieY },
    };
  } else if ("fromBeatId" in technique) {
    const label = technique.type === "palmMute" ? "P.M." : "let ring";
    const labelWidth = techniqueLabelWidth(label);
    const lineStart =
      candidate.segmentIndex === 0
        ? Math.min(
            candidate.x2,
            candidate.x1 + labelWidth + TECHNIQUE_LABEL_GAP,
          )
        : candidate.x1;
    path = {
      d: `M ${lineStart} ${laneY} L ${candidate.x2} ${laneY} L ${candidate.x2} ${laneY + 4}`,
      strokeWidth: LXM_TECHNIQUE_PATH_STROKE_WIDTH,
      dashArray: "4 3",
    };
    if (candidate.segmentIndex === 0)
      // 左端锚定让视觉测量缩小时，原字号的命中包络仍覆盖完整旧标签范围。
      texts = [{ ...text(label, candidate.x1, laneY + 3), textAnchor: "start" }];
  } else if ("beatId" in technique) {
    const beat = anchors.beats.get(technique.beatId);
    if (beat) {
      if (technique.type === "pickStroke") {
        const x = beat.notes[0]?.x ?? beat.x;
        // 下拨门形与上拨 V 使用路径，避免系统字体把符号替换成不一致的箭头。
        path = {
          d:
            technique.stroke === "down"
              ? `M ${x - 3} ${laneY} L ${x - 3} ${laneY - 5} L ${x + 3} ${laneY - 5} L ${x + 3} ${laneY}`
              : `M ${x - 3} ${laneY - 5} L ${x} ${laneY} L ${x + 3} ${laneY - 5}`,
          strokeWidth: LXM_TECHNIQUE_PATH_STROKE_WIDTH,
        };
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
        const x = technique.type === "strum" && technique.showFrets
          ? beat.x - strumOffsetFromFrets(Math.max(0, ...beat.notes.map((note) => getFretTextBounds(note).width / 2)))
          : beat.x;
        // TAB 的低音弦在下方，上行琶音与 down 扫弦都从下往上画；起止点继续用于点击选端。
        const goesUp = technique.type === "arpeggio"
          ? technique.direction === "ascending"
          : technique.stroke === "down";
        const directionStartY = goesUp ? y2 : y1;
        const directionEndY = goesUp ? y1 : y2;
        focusEndpoints = {
          start: { x, y: directionStartY },
          end: { x, y: directionEndY },
        };
        if (technique.type === "arpeggio") {
          // 同弦范围的扫弦与琶音从同一高度起笔，箭尖也落在同一高度。琶音保留显式的
          // 垂直箭头，避免随波线末端切线倾斜；波线收到三角形底边，两者直接相接。
          const [firstBase, tip, secondBase] = getTechniqueMarkerArrowPoints(
            [x, directionEndY],
            goesUp ? -Math.PI / 2 : Math.PI / 2,
          );
          path = {
            d: getArpeggioWavePath(x, directionStartY, firstBase[1]),
            strokeWidth: LXM_TECHNIQUE_PATH_STROKE_WIDTH,
          };
          arrowHead = {
            direction: goesUp ? "up" : "down",
            points: [tip, firstBase, secondBase],
          };
        } else {
          path = {
            d: `M ${x} ${directionStartY} L ${x} ${directionEndY}`,
            strokeWidth: LXM_TECHNIQUE_PATH_STROKE_WIDTH,
            markerEnd: "arrow",
          };
        }
      }
    }
  } else {
    const note = anchors.notes.get(technique.fromNoteId)?.layout;
    if (note) {
      const noteBounds = getFretTextBounds(note);
      const afterNote =
        noteBounds.x + noteBounds.width + LXM_TECHNIQUE_FRET_GAP_X;
      const annotationY = Math.min(laneY, noteBounds.y - 4);
      // 自适应长度只表达视觉展开，不推断技巧延迟起奏或修改领域时值。
      const waveWidth = (startX: number) =>
        Math.max(
          TECHNIQUE_WAVE_MIN_WIDTH,
          Math.min(
            TECHNIQUE_WAVE_MAX_WIDTH,
            (anchors.beats.get(note.beatId)?.width ?? 0) -
              (startX - note.x) -
              4,
          ),
        );
      if (technique.type === "naturalHarmonic") {
        const label = {
          ...text(
            `<${note.fret}>`,
            note.x,
            note.y + LXM_FRET_TEXT_BASELINE_OFFSET_Y,
          ),
          fontSize: LXM_NATURAL_HARMONIC_TEXT_FONT_SIZE,
        };
        // 泛音替代基础数字，但保留技巧 segment 的 ID、完整描边边界和点击能力。
        return withTechniqueBounds({
          techniqueId: technique.id,
          type: technique.type,
          systemIndex: candidate.systemIndex,
          segmentIndex: candidate.segmentIndex,
          continuation: candidate.continuation,
          lane: -1,
          path: null,
          texts: [label],
        });
      } else if (technique.type === "artificialHarmonic") {
        texts = [text("A.H.", note.x, annotationY)];
      } else if (technique.type === "vibrato") {
        const bendOnNote = anchors.bendNoteIds.has(technique.fromNoteId);
        const startX =
          note.x + vibratoStartOffset(noteBounds.width / 2, bendOnNote);
        path = {
          d: wavePath(
            startX,
            startX + waveWidth(startX),
            bendOnNote ? laneY - TECHNIQUE_BEND_RISE : laneY,
          ),
          strokeWidth: LXM_TECHNIQUE_PATH_STROKE_WIDTH,
        };
      } else if (technique.type === "bend") {
        const tipX = afterNote + TECHNIQUE_BEND_RUN;
        const tipY = laneY - TECHNIQUE_BEND_RISE;
        path = {
          // 控制点与终点 X 相同，使末端切线向上；Full 与完整箭头保持独立净空。
          d: `M ${afterNote} ${laneY + 3} Q ${tipX} ${laneY + 3} ${tipX} ${tipY}`,
          strokeWidth: LXM_TECHNIQUE_PATH_STROKE_WIDTH,
          markerEnd: "arrow",
        };
        texts = [
          text(technique.semitones === 1 ? "1/2" : "Full", tipX, tipY - 9),
        ];
      } else if (technique.type === "tapping") {
        texts = [text("T", note.x, annotationY)];
      } else if (technique.type === "trill") {
        const label = {
          ...text(`tr ${technique.auxiliaryFret}`, note.x, annotationY),
          textAnchor: "start" as const,
        };
        const waveStart =
          note.x + techniqueLabelWidth(label.text) + TECHNIQUE_LABEL_GAP;
        texts = [label];
        path = {
          d: wavePath(
            waveStart,
            waveStart + waveWidth(waveStart),
            annotationY - 3,
          ),
          strokeWidth: LXM_TECHNIQUE_PATH_STROKE_WIDTH,
        };
      }
    }
  }

  return withTechniqueBounds({
    techniqueId: technique.id,
    type: technique.type,
    ...(technique.type === "strum" && path ? {
      strum: { beatId: technique.beatId, minString: technique.minString, maxString: technique.maxString },
    } : {}),
    ...(technique.type === "arpeggio" && path ? {
      arpeggio: { beatId: technique.beatId, minString: technique.minString, maxString: technique.maxString },
    } : {}),
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
  const naturalNoteIds = new Set(
    track.techniques.flatMap((t) =>
      t.type === "naturalHarmonic" ? [t.fromNoteId] : [],
    ),
  );
  // 先投影完整泛音字形用于连接端点与其它技巧避让，最终只由技巧层绘制一次。
  const projectedSystems = naturalNoteIds.size
    ? baseSystems.map((system) => ({
        ...system,
        measures: system.measures.map((measure) => ({
          ...measure,
          notes: measure.notes.map((note) =>
            naturalNoteIds.has(note.id)
              ? { ...note, fretText: `<${note.fret}>` }
              : note,
          ),
        })),
      }))
    : baseSystems;
  const baseAnchors = buildAnchorMaps(projectedSystems);
  baseAnchors.bendNoteIds = new Set(
    track.techniques.flatMap((t) => (t.type === "bend" ? [t.fromNoteId] : [])),
  );
  const candidates = createCandidates(track, baseSystems, baseAnchors);
  // 隐藏品位不参与扫弦延音线的避让，其他技巧仍使用完整的音符锚点。
  const visibleSystems = applyChordTraversalVisibilityProjection(
    projectedSystems,
    getChordTraversalSuppressionRanges(track.techniques, baseAnchors),
  );
  const naturalPlans = new Map<ILXMTechniqueCandidate, ILXMTechniqueSegmentLayout>();
  const topByBeatId = new Map<string, number>();
  const ties = candidates.filter(({ technique }) => technique.type === "traversalTie");
  for (const candidate of candidates) {
    if (candidate.technique.type === "traversalTie") continue;
    const plan = createNaturalSegmentLayout(
      candidate, projectedSystems[candidate.systemIndex]!, baseAnchors,
    );
    naturalPlans.set(candidate, plan);
    if (ties.length && hasChordTraversalRange(candidate.technique) && plan.path) {
      const { beatId } = candidate.technique;
      topByBeatId.set(beatId, Math.min(
        topByBeatId.get(beatId) ?? Infinity,
        ...getTechniqueInkBounds(plan).map((bounds) => bounds.y),
      ));
    }
  }
  if (ties.length) {
    const visibleNoteIds = new Set(visibleSystems.flatMap((system) =>
      system.measures.flatMap((measure) => measure.notes.map((note) => note.id)),
    ));
    for (const candidate of ties) {
      naturalPlans.set(candidate, createNaturalSegmentLayout(
        candidate,
        projectedSystems[candidate.systemIndex]!,
        baseAnchors,
        { topByBeatId, visibleNoteIds },
      ));
    }
  }
  const segmentsBySystem = assignLanes(candidates, naturalPlans, baseAnchors, visibleSystems);
  const systemsWithTechniques = visibleSystems.map((system) => ({
    ...system,
    techniques: (segmentsBySystem.get(system.index) ?? []).sort(
      (left, right) =>
        left.lane - right.lane ||
        left.bounds.x - right.bounds.x ||
        left.techniqueId.localeCompare(right.techniqueId),
    ),
  }));
  return naturalNoteIds.size
    ? systemsWithTechniques.map((system) => ({
        ...system,
        measures: system.measures.map((measure) => ({
          ...measure,
          notes: measure.notes.filter((note) => !naturalNoteIds.has(note.id)),
        })),
      }))
    : systemsWithTechniques;
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
