import { createMeasureRhythmContext } from "../../core/rhythm/tuplet";
import { createNumberedRhythmContext } from "../../core/numbered/numbered-rhythm";
import { getMeasureCapacityTicks, calculateRhythmTicks } from "../../core/rhythm/rhythm";
import { TICKS_PER_QUARTER } from "../../core/constants";
import type { ILXMMeasure } from "../../core/types";
import type {
  ILXMLayoutDensity,
  ILXMLayoutPurpose,
  ILXMRhythmicColumn,
} from "../layout-types";
import { numberedLayoutProfile } from "../music-text/numbered-layout-profile";
import { planNumberedInputRanges } from "../../core/numbered/numbered-input-ranges";
import {
  LXM_LAYOUT_DENSITY_PROFILES,
  LXM_DURATION_MIN_COLUMN_WIDTH,
  LXM_DURATION_VISUAL_WEIGHT,
  LXM_DURATION_SUSTAIN_MIN_WIDTH,
  LXM_DURATION_SUSTAIN_HORIZONTAL_PADDING,
} from "../layout-constants";
import {
  musicTextGlyph,
  musicTextRequest,
  MUSIC_LYRIC_FONT_SIZE,
  type ILXMMusicTextMetrics,
} from "../music-text/music-text-metrics";
import { layoutNumbered } from "../music-text/numbered-notation-layout";
import { fretHalfWidth, type TechniqueInsets } from "../techniques/technique-spacing";
import { createChordBlock } from "../music-text/music-text-layout";

interface Source {
  id: string;
  layer: "tab" | "numbered";
  start: number;
  end: number;
  min: number;
  ideal: number;
}
interface Extent {
  tick: number;
  left: number;
  right: number;
  lane: string;
}
interface Constraint {
  a: number;
  b: number;
  min: number;
  ideal: number;
}
/** 两个谱层共享真实时间点；间距约束只向未来指向，使用前向最长路径求解。 */
export const summarizeTimeGrid = (
  measure: ILXMMeasure,
  density: ILXMLayoutDensity,
  leading: number,
  metrics?: ILXMMusicTextMetrics,
  techniqueInsets?: ReadonlyMap<string, TechniqueInsets>,
  purpose: ILXMLayoutPurpose = "presentation",
) => {
  const profile = LXM_LAYOUT_DENSITY_PROFILES[density];
  const numberedProfile = numberedLayoutProfile(purpose, density);
  const tabGlyphGap = density === "compact" ? 2 : 6;
  const capacity = getMeasureCapacityTicks(measure.timeSignature);
  const tab = createMeasureRhythmContext(measure),
    numbered = createNumberedRhythmContext(measure.numberedVoice);
  const tickSet = new Set([0, capacity]);
  const sources: Source[] = [],
    extents: Extent[] = [];
  const addSource = (
    id: string,
    layer: Source["layer"],
    tick: number,
    actual: number,
    base: keyof typeof LXM_DURATION_MIN_COLUMN_WIDTH,
    dots: number,
    hasSustain = true,
  ) => {
    const end = tick + actual;
    tickSet.add(tick);
    tickSet.add(end);
    let min =
      layer === "numbered"
        ? (density === "compact" ? 10 : 15)
         : (profile.minColumnWidth ?? LXM_DURATION_MIN_COLUMN_WIDTH[base]);
    // TAB 长时值绘制器将 slot 分为四分单位，压缩后每单位仍须容纳真实短横。
    if (density === "compact" && layer === "tab" && (base === "half" || base === "whole"))
      min = Math.max(min, (base === "whole" ? 4 : 2) *
        (LXM_DURATION_SUSTAIN_MIN_WIDTH + 2 * LXM_DURATION_SUSTAIN_HORIZONTAL_PADDING));
    const ideal =
      layer === "numbered"
        ? numberedProfile.widths[base] * (density === "comfortable" ? 1.25 : 1)
        : Math.max(
            min,
            LXM_DURATION_MIN_COLUMN_WIDTH[base] *
              LXM_DURATION_VISUAL_WEIGHT[base] *
              profile.idealColumnScale,
          );
    sources.push({ id, layer, start: tick, end, min, ideal });
    const written = calculateRhythmTicks({ base, dots });
    if (hasSustain && written.ok && written.ticks > TICKS_PER_QUARTER) {
      for (
        let units = TICKS_PER_QUARTER;
        units < written.ticks;
        units += TICKS_PER_QUARTER
      ) {
        const offset = (actual * units) / written.ticks;
        if (Number.isInteger(offset)) {
          tickSet.add(tick + offset);
          extents.push({
            tick: tick + offset,
            left: 6,
            right: 6,
            lane: layer === "tab" && density !== "compact" ? "tab-sustain" : layer,
          });
        }
      }
    }
  };
  for (const b of measure.beats) {
    const duration = tab.getBeatDurationTicks(b);
    if (!duration.ok) throw new Error("TAB 时值无效");
    addSource(
      b.id,
      "tab",
      b.tick,
      duration.ticks,
      b.rhythm.base,
      b.rhythm.dots,
    );
    const half = Math.max(density === "compact" ? 0 : 5, ...b.notes.map((n) => fretHalfWidth(n.fret)));
    const inset = techniqueInsets?.get(b.id);
    extents.push({
      tick: b.tick,
      left: Math.max(half, inset?.left ?? 0),
      right: Math.max(half, inset?.right ?? 0),
      lane: "tab",
    });
  }
  for (const e of measure.numberedVoice.events) {
    const duration = numbered.getEventDurationTicks(e);
    if (!duration.ok) throw new Error("简谱时值无效");
    addSource(
      e.id,
      "numbered",
      e.tick,
      duration.ticks,
      e.rhythm.base,
      e.rhythm.dots,
      e.kind !== "gap",
    );
    if (e.kind === "gap") {
      // 空成员有音乐时间与连音结构，成品不为输入框预留整音符列宽。
      const source = sources.at(-1)!;
      source.min = 1;
      source.ideal = 1;
      continue;
    }
    const glyph = layoutNumbered(
      e.id,
      e.items.map((i) => i.token),
      0,
      0,
      metrics,
      numberedProfile,
    );
    // numbered-rhythm-layout 的点心：正文 bounds.right + 1（减时线）+ 4，
    // 半径 1.3；后续点心间隔 4。按真实圆点外缘约束，不能只累加 dots * 4。
    const written = calculateRhythmTicks(e.rhythm);
    const units = written.ok ? written.ticks / TICKS_PER_QUARTER : 0;
    const lastSustainUnit = Math.floor(units) - 1;
    const dotCount = units > 1
      ? (units % 1 === 0.5 ? 1 : units % 1 === 0.75 ? 2 : 0)
      : e.rhythm.dots;
    const bodyRight = Math.max(...glyph.labels
      .filter((g) => g.fontFamily !== "Bravura")
      .map((g) => g.bounds.x + g.bounds.width));
    let right = glyph.bounds.x + glyph.bounds.width - 2;
    if (density === "compact" && dotCount > 0) {
      if (lastSustainUnit > 0) {
        const tick = e.tick + duration.ticks * lastSustainUnit / units;
        extents.push({ tick, left: 6, right: 9 + (dotCount - 1) * 4 + 1.3, lane: "numbered" });
      } else right = Math.max(right, bodyRight + 1 + 4 + (dotCount - 1) * 4 + 1.3);
    } else if (density !== "compact") right += e.rhythm.dots * 4;
    extents.push({
      tick: e.tick,
      // 字形已自带两侧保护边界；音乐边缘间隔只按墨迹计算一次。
      left: -glyph.bounds.x - 2,
      right,
      lane: "numbered",
    });
  }
  const tabById = new Map(measure.beats.map((b) => [b.id, b]));
  const numberedById = new Map(
    measure.numberedVoice.events.map((e) => [e.id, e]),
  );
  for (const l of measure.lyrics) {
    const event = numberedById.get(l.eventId);
    if (!event) continue;
    const g = musicTextGlyph(musicTextRequest(l.text, MUSIC_LYRIC_FONT_SIZE), 0, 0, metrics);
    extents.push({
      tick: event.tick,
      left: -g.bounds.x,
      right: g.bounds.x + g.bounds.width,
      lane: `lyric-${l.verse}`,
    });
  }
  for (const c of measure.chordSymbols) {
    const b = tabById.get(c.beatId)!;
    const g = createChordBlock(c, metrics).bounds;
    extents.push({
      tick: b.tick,
      left: -g.x,
      right: g.x + g.width,
      lane: "chord",
    });
  }
  const inputRanges =
    purpose === "editing" ? planNumberedInputRanges(measure) : [];
  for (const range of inputRanges) {
    tickSet.add(range.startTick);
    tickSet.add(range.endTick);
  }
  const ticks = [...tickSet].sort((a, b) => a - b);
  const index = new Map(ticks.map((t, i) => [t, i]));
  const incoming: Constraint[][] = ticks.map(() => []);
  const edge = (from: number, to: number, min: number, ideal = min) => {
    const a = index.get(from)!,
      b = index.get(to)!;
    if (a < b)
      incoming[b]!.push({
        a,
        b,
        min: Math.max(1, min),
        ideal: Math.max(min, ideal),
      });
  };
  const layers = [
    sources.filter((s) => s.layer === "tab"),
    sources.filter((s) => s.layer === "numbered"),
  ];
  const cursors = [0, 0];
  for (let i = 0; i < ticks.length - 1; i++) {
    const a = ticks[i]!,
      b = ticks[i + 1]!;
    let ideal = 1;
    layers.forEach((layer, j) => {
      while (cursors[j]! < layer.length && layer[cursors[j]!]!.end <= a)
        cursors[j] = cursors[j]! + 1;
      const source = layer[cursors[j]!];
      if (source && source.start <= a && source.end >= b)
        ideal = Math.max(
          ideal,
          (source.ideal * (b - a)) / (source.end - source.start),
        );
    });
    edge(a, b, 1, ideal);
  }
  sources.forEach((s) => edge(s.start, s.end, s.min, s.ideal));
  for (const lane of new Set(extents.map((e) => e.lane))) {
    const values = extents
      .filter((e) => e.lane === lane)
      .sort((a, b) => a.tick - b.tick);
    for (let i = 1; i < values.length; i++)
      edge(
        values[i - 1]!.tick,
        values[i]!.tick,
        values[i - 1]!.right +
          values[i]!.left +
          (lane === "numbered"
            ? numberedProfile.glyphGap
            : lane === "tab" ? tabGlyphGap : 6),
      );
  }
  for (const g of measure.numberedVoice.tuplets) {
    const members = g.eventIds.map((id) => numberedById.get(id)!);
    const first = members[0]!,
      last = members.at(-1)!;
    const d = numbered.getEventDurationTicks(last);
    if (d.ok)
      edge(
        first.tick,
        last.tick + d.ticks,
        String(g.ratio.actual).length * 8 + 16,
      );
  }
  /** 时间有序 DAG 中所有候选入边取最大，不迭代挤压音符。 */
  const solve = (ideal: boolean) => {
    const p = ticks.map(() => 0);
    for (let j = 1; j < ticks.length; j++)
      p[j] = Math.max(
        ...incoming[j]!.map((e) => p[e.a]! + (ideal ? e.ideal : e.min)),
      );
    return p;
  };
  if (inputRanges.length) {
    const musicWidth = solve(true).at(-1)!;
    const budget = musicWidth * 1.25;
    const numberedExtents = extents
      .filter((e) => e.lane === "numbered")
      .sort((a, b) => a.tick - b.tick);
    // 较宽槽优先；每次候选仅追加入边，超出预算便回退，密集细分继续用窄标记。
    for (const range of [...inputRanges].sort(
      (a, b) =>
        b.endTick - b.startTick - (a.endTick - a.startTick) ||
        a.startTick - b.startTick,
    )) {
      const lengths = incoming.map((edges) => edges.length);
      const inputWidth = density === "compact" ? 20 : 24;
      const inputEdge = (from: number, to: number, width: number) =>
        edge(from, to, density === "compact" ? 1 : width, width);
      inputEdge(range.startTick, range.endTick, inputWidth + 4);
      const previous = numberedExtents
        .filter((e) => e.tick < range.startTick)
        .at(-1);
      const next = numberedExtents.find((e) => e.tick > range.startTick);
      if (previous)
        inputEdge(
          previous.tick,
          range.startTick,
          previous.right + inputWidth / 2 + numberedProfile.glyphGap,
        );
      if (next)
        inputEdge(
          range.startTick,
          next.tick,
          inputWidth / 2 + next.left + numberedProfile.glyphGap,
        );
      if (solve(true).at(-1)! > budget)
        incoming.forEach((edges, i) => edges.splice(lengths[i]!));
    }
  }
  const minPositions = solve(false),
    idealPositions = solve(true);
  const contentWidth = idealPositions.at(-1)!;
  const leftInset = (positions: number[]) => Math.max(
    0,
    ...extents.map(
      (e) =>
        e.left +
        6 -
        positions[index.get(e.tick)!]! -
        profile.measurePaddingX -
        leading,
    ),
  );
  const tailInset = (positions: number[]) => Math.max(
    0,
    ...extents.map(
      (e) =>
        positions[index.get(e.tick)!]! +
        e.right +
        6 -
        positions.at(-1)! -
        profile.measurePaddingX,
    ),
  );
  const leftExtra = leftInset(idealPositions);
  const tailExtra = tailInset(idealPositions);
  const hardLeftExtra = leftInset(minPositions);
  const hardTailExtra = tailInset(minPositions);
  const fixed = 2 * profile.measurePaddingX + leading;
  const sourceStarts = new Map<number, Source[]>();
  for (const source of sources)
    sourceStarts.set(source.start, [
      ...(sourceStarts.get(source.start) ?? []),
      source,
    ]);
  const columns: ILXMRhythmicColumn[] = ticks.slice(0, -1).map((tick, i) => ({
    tick,
    endTick: ticks[i + 1]!,
    tabBeatIds: (sourceStarts.get(tick) ?? [])
      .filter((s) => s.layer === "tab")
      .map((s) => s.id),
    numberedEventIds: (sourceStarts.get(tick) ?? [])
      .filter((s) => s.layer === "numbered")
      .map((s) => s.id),
    rhythmTicks: ticks[i + 1]! - tick,
    durationWeight: 1,
    // 两套完整最长路径的相邻差值；只能以同一比例插值整套位置。
    minWidth: density === "compact"
      ? minPositions[i + 1]! - minPositions[i]!
      : idealPositions[i + 1]! - idealPositions[i]!,
    idealWidth: idealPositions[i + 1]! - idealPositions[i]!,
  }));
  return {
    measureId: measure.id,
    leadingWidth: leading,
    columns,
    minWidth: minPositions.at(-1)! + fixed + hardLeftExtra + hardTailExtra,
    idealWidth: contentWidth + fixed + leftExtra + tailExtra,
    assignedWidth: contentWidth + fixed + leftExtra + tailExtra,
    contentWidth,
    leftExtra,
    tailExtra,
    hardLeftExtra,
    hardTailExtra,
  };
};
