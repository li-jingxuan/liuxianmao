# Full-Measure Edit Grid Gap Coverage Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让编辑网格覆盖整小节时间轴，使 4/4 等普通小节在真实 beat 未写满或中间存在时间空洞时，仍然显示足够 Grid 并支持点击、输入和命令落盘。

**Architecture:** 不向 `Measure.beats` 注入 placeholder/gap beat，仍保持 score schema 只保存真实音乐事件。layout 层先把小节时间轴拆成 `beat segment` 与 `gap segment`，再按当前编辑时值统一生成 `editGrid`；命中层显式返回 `slotKind`，命令层按 `beat/gap` 分流 materialize。

**Tech Stack:** TypeScript 6、Vitest、Zod、Zustand、React 19、SVG、pnpm workspace

---

## Current Diagnosis

当前 `packages/lxm-tabeditor/src/layout/edit-grid.ts` 的 `buildMeasureEditGrid(...)` 只遍历 `laidOutBeats`，所以只能为已有 beat 生成 slot。它能解决“长 beat 内部细分”，但无法覆盖“没有任何 beat 的 tick 区间”。

当前数据流的失败点是：

- `LaidOutEditGridSlot` 没有 `kind`，只能表达被真实 beat 覆盖的 slot。
- `buildMeasureEditGrid(...)` 不接收 `spacing/timeSignature`，没有能力为 gap 计算 x 坐标。
- `hitTestScoreLayout(...)` 命中 slot 后总是返回 `beatId: slot.coveringBeatId`，无法表达 gap slot。
- `findTargetContext(...)` 要求命令 payload 能找到真实 beat；gap 写入会失败为 `BEAT_NOT_FOUND`。
- 页面 store 只透传 `beatId/tick/slotId`，没有保存 `slotKind/gapStartTick/gapEndTick`。

## File Structure

**Modify**

- `packages/lxm-tabeditor/src/layout/layout-types.ts`
  - 定义 `LaidOutBeatEditGridSlot | LaidOutGapEditGridSlot` 联合类型。
  - 扩展 `ScoreLayoutHit`，让命中结果能表达 gap slot。
- `packages/lxm-tabeditor/src/layout/edit-grid.ts`
  - 新增 coverage segment 构建。
  - 基于整小节 segment 生成 `beat/gap` slot。
- `packages/lxm-tabeditor/src/layout/measure-spacing.ts`
  - 新增 `projectTickToMeasureX(...)`，把任意小节内 tick 投影到 SVG x。
- `packages/lxm-tabeditor/src/layout/measure-layout.ts`
  - 调整 `buildMeasureEditGrid(...)` 调用签名。
- `packages/lxm-tabeditor/src/layout/score-layout.ts`
  - 命中 slot 时按 `slot.kind` 返回不同 payload。
- `packages/lxm-tabeditor/src/store/editor-store.ts`
  - 扩展 `ActiveCursorPosition`，透传 gap slot 元信息。
- `packages/lxm-tabeditor/src/commands/command-types.ts`
  - 扩展 `TimelineTargetPayload`，支持 `slotKind/gapStartTick/gapEndTick`。
- `packages/lxm-tabeditor/src/commands/timeline-materialization.ts`
  - 新增 `materializeBeatIntoGap(...)`。
- `packages/lxm-tabeditor/src/commands/score-command-reducer.ts`
  - `note.add` 和 `beat.setRest` 按 `slotKind` 分流。
- `apps/website/components/editor-shell/ScorePreview/hooks/useScorePreviewPointerHit.ts`
  - 点击时把 `slotKind/gapStartTick/gapEndTick` 放进 active cursor。
- `apps/website/components/editor-shell/ScorePreview/hooks/useScorePreviewInput.ts`
  - gap cursor 下写品位时不再要求能先找到真实 beat。
- `apps/website/components/editor-shell/ScorePreview/MeasureGridLayer.tsx`
  - 根据 `slot.kind` 判断空格状态，避免 gap slot 因没有 `beatId` 被错误归类。
- `packages/lxm-tabeditor/tests/edit-grid.test.ts`
  - 覆盖尾部 gap、中间 gap、gap hit、beat hit 兼容。
- `packages/lxm-tabeditor/tests/layout.test.ts`
  - 覆盖 gap slot x 单调递增与小节右边界约束。
- `packages/lxm-tabeditor/tests/commands.test.ts`
  - 覆盖 gap slot 写入 notes/rest 与排序。

## Constants and Naming

Implementation should avoid magic strings by adding constants near the relevant modules:

```ts
const EDIT_GRID_SLOT_KIND = {
  beat: "beat",
  gap: "gap",
} as const;

type EditGridSlotKind =
  (typeof EDIT_GRID_SLOT_KIND)[keyof typeof EDIT_GRID_SLOT_KIND];
```

如果局部文件不需要导出常量，可以直接使用字面量联合类型；跨文件 payload 必须统一为 `"beat" | "gap"`，不要引入 `"empty"`、`"placeholder"` 等第二套命名。

---

### Task 1: Lock Slot Types and Failing Gap Tests

**Files:**

- Modify: `packages/lxm-tabeditor/src/layout/layout-types.ts`
- Modify: `packages/lxm-tabeditor/src/store/editor-store.ts`
- Modify: `packages/lxm-tabeditor/src/commands/command-types.ts`
- Modify: `packages/lxm-tabeditor/tests/edit-grid.test.ts`
- Modify: `packages/lxm-tabeditor/tests/commands.test.ts`

- [ ] **Step 1: Extend edit grid and hit types**

Replace the current `LaidOutEditGridSlot` and `ScoreLayoutHit` definitions in `packages/lxm-tabeditor/src/layout/layout-types.ts` with:

```ts
/** 编辑网格 slot 的来源类型：beat 表示真实 beat 覆盖区，gap 表示小节时间空洞。 */
export type EditGridSlotKind = "beat" | "gap";

export interface LaidOutBeatEditGridSlot {
  id: string;
  kind: "beat";
  measureId: string;
  beatId?: string;
  coveringBeatId: string;
  tick: number;
  x: number;
  width: number;
  isBeatStart: boolean;
}

export interface LaidOutGapEditGridSlot {
  id: string;
  kind: "gap";
  measureId: string;
  tick: number;
  x: number;
  width: number;
  gapStartTick: number;
  gapEndTick: number;
  isBeatStart: false;
}

export type LaidOutEditGridSlot =
  | LaidOutBeatEditGridSlot
  | LaidOutGapEditGridSlot;

export interface MeasureEditGrid {
  rhythm: RhythmValue;
  slots: LaidOutEditGridSlot[];
}

export interface ScoreLayoutHit {
  measureId: string;
  beatId?: string;
  tick: number;
  string: number;
  slotId?: string;
  slotKind?: EditGridSlotKind;
  gapStartTick?: number;
  gapEndTick?: number;
}
```

- [ ] **Step 2: Extend editor cursor type**

Update `ActiveCursorPosition` in `packages/lxm-tabeditor/src/store/editor-store.ts`:

```ts
import type { EditorMode, RhythmValue, Technique } from "../core/schema";
import type { EditGridSlotKind } from "../layout/layout-types";

export interface ActiveCursorPosition {
  /** 光标所在轨道 id。 */
  trackId: string;
  /** 光标所在小节 id。 */
  measureId: string;
  /** beat slot 对应的真实 beat；gap slot 没有真实 beat。 */
  beatId?: string;
  /** 当前 slot 在小节时间线中的起始 tick。 */
  tick: number;
  /** layout/editGrid 派生的 slot id，用于渲染占位网格选中态。 */
  slotId: string;
  /** 当前 slot 来源，命令层据此决定拆 beat 还是写 gap。 */
  slotKind: EditGridSlotKind;
  /** gap slot 所属空洞的起始 tick；beat slot 不传。 */
  gapStartTick?: number;
  /** gap slot 所属空洞的结束 tick；beat slot 不传。 */
  gapEndTick?: number;
  /** 当前活跃弦序号，范围 1..6。 */
  string: number;
}
```

- [ ] **Step 3: Extend command payload type**

Update `TimelineTargetPayload` in `packages/lxm-tabeditor/src/commands/command-types.ts`:

```ts
import type { EditGridSlotKind } from "../layout/layout-types";

export interface TimelineTargetPayload {
  /** 目标轨道 id。 */
  trackId: string;
  /** 目标小节 id。 */
  measureId: string;
  /** beat slot 对应的真实 beat；gap slot 没有真实 beat。 */
  beatId?: string;
  /** 小节内目标 tick。旧调用方不传时默认使用 beat.tick。 */
  tick?: number;
  /** 当前写入目标来源，用于区分拆已有 beat 与写入 gap。 */
  slotKind?: EditGridSlotKind;
  /** gap slot 所属空洞的起始 tick。 */
  gapStartTick?: number;
  /** gap slot 所属空洞的结束 tick。 */
  gapEndTick?: number;
}
```

- [ ] **Step 4: Add failing layout tests for tail and middle gaps**

Append these tests to `packages/lxm-tabeditor/tests/edit-grid.test.ts`:

```ts
import { createEmptyScore } from "../src/core/score-factory";

it("4/4 小节未写满时，会为尾部 gap 生成可点击 slot", () => {
  const score = createEmptyScore();
  score.tracks[0]!.measures[0] = {
    ...score.tracks[0]!.measures[0]!,
    beats: [
      {
        id: "beat-gap-01",
        tick: 0,
        rhythm: { base: "quarter", dots: 0 },
        kind: "notes",
        notes: [{ id: "note-gap-01", string: 2, fret: 3, techniques: [] }],
      },
    ],
  };

  const layout = layoutScore(score, {
    editingRhythm: { base: "quarter", dots: 0 },
  });
  const measure = layout.systems[0]!.measures[0]!;
  const gapSlots = measure.editGrid?.slots.filter((slot) => slot.kind === "gap");

  expect(gapSlots).toHaveLength(3);
  expect(gapSlots?.map((slot) => slot.tick)).toEqual([960, 1920, 2880]);
  expect(gapSlots?.every((slot) => slot.gapStartTick === 960)).toBe(true);
  expect(gapSlots?.every((slot) => slot.gapEndTick === 3840)).toBe(true);
});

it("小节中间存在时间空洞时，会为中间 gap 生成 slot", () => {
  const score = createEmptyScore();
  score.tracks[0]!.measures[0] = {
    ...score.tracks[0]!.measures[0]!,
    beats: [
      {
        id: "beat-gap-left",
        tick: 0,
        rhythm: { base: "quarter", dots: 0 },
        kind: "rest",
      },
      {
        id: "beat-gap-right",
        tick: 1920,
        rhythm: { base: "quarter", dots: 0 },
        kind: "rest",
      },
    ],
  };

  const layout = layoutScore(score, {
    editingRhythm: { base: "quarter", dots: 0 },
  });
  const measure = layout.systems[0]!.measures[0]!;

  expect(
    measure.editGrid?.slots.find(
      (slot) =>
        slot.kind === "gap" &&
        slot.tick === 960 &&
        slot.gapStartTick === 960 &&
        slot.gapEndTick === 1920,
    ),
  ).toBeDefined();
});
```

- [ ] **Step 5: Add failing command test for gap note write**

Append this test to `packages/lxm-tabeditor/tests/commands.test.ts`:

```ts
it("支持在 gap slot 内按当前时值写入音符", () => {
  const score = createEmptyScore();
  score.tracks[0]!.measures[0] = {
    ...score.tracks[0]!.measures[0]!,
    beats: [
      {
        id: "beat-gap-existing",
        tick: 0,
        rhythm: { base: "quarter", dots: 0 },
        kind: "rest",
      },
    ],
  };

  const result = reduceScoreCommand(score, {
    type: "note.add",
    payload: {
      trackId: "track-guitar-main",
      measureId: "measure-001",
      tick: 960,
      slotKind: "gap",
      gapStartTick: 960,
      gapEndTick: 3840,
      rhythm: { base: "quarter", dots: 0 },
      note: { id: "note-gap-write", string: 2, fret: 5, techniques: [] },
    },
  });

  expect(result.ok).toBe(true);
  if (!result.ok) return;

  expect(result.value.tracks[0]!.measures[0]!.beats).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ tick: 960, kind: "notes" }),
      expect.objectContaining({ tick: 1920, kind: "rest" }),
      expect.objectContaining({ tick: 2880, kind: "rest" }),
    ]),
  );
});
```

- [ ] **Step 6: Run target tests and confirm failure**

Run:

```bash
CI=true pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/edit-grid.test.ts tests/commands.test.ts
```

Expected:

- `edit-grid.test.ts` fails because gap slot count is `0`.
- `commands.test.ts` fails with `BEAT_NOT_FOUND` or equivalent command failure.

---

### Task 2: Generate Full-Measure Grid from Coverage Segments

**Files:**

- Modify: `packages/lxm-tabeditor/src/layout/edit-grid.ts`
- Modify: `packages/lxm-tabeditor/src/layout/measure-spacing.ts`
- Modify: `packages/lxm-tabeditor/src/layout/measure-layout.ts`
- Modify: `packages/lxm-tabeditor/tests/layout.test.ts`

- [ ] **Step 1: Add projection test**

Append this test to `packages/lxm-tabeditor/tests/layout.test.ts`:

```ts
import { createEmptyScore } from "../src/core/score-factory";

it("尾部 gap 中的 slot x 坐标按 tick 单调递增且留在小节内", () => {
  const score = createEmptyScore();
  score.tracks[0]!.measures[0] = {
    ...score.tracks[0]!.measures[0]!,
    beats: [
      {
        id: "beat-tail-gap",
        tick: 0,
        rhythm: { base: "half", dots: 0 },
        kind: "rest",
      },
    ],
  };

  const layout = layoutScore(score, {
    editingRhythm: { base: "quarter", dots: 0 },
  });
  const measure = layout.systems[0]!.measures[0]!;
  const gapSlots = measure.editGrid?.slots.filter((slot) => slot.kind === "gap") ?? [];

  expect(gapSlots.map((slot) => slot.tick)).toEqual([1920, 2880]);
  expect(gapSlots[0]!.x).toBeLessThan(gapSlots[1]!.x);
  expect(gapSlots[1]!.x + gapSlots[1]!.width).toBeLessThanOrEqual(
    measure.x + measure.width,
  );
});
```

- [ ] **Step 2: Implement tick projection helper**

Add imports and `projectTickToMeasureX(...)` to `packages/lxm-tabeditor/src/layout/measure-spacing.ts`:

```ts
import { calculateRhythmTicks, getMeasureCapacityTicks } from "../core/rhythm";
import type { Beat, Measure, TimeSignature } from "../core/schema";
```

```ts
const getMeasureInnerLeftX = (
  spacing: MeasureSpacingSummary,
  measureX: number,
): number => {
  const firstSlot = Object.values(spacing.slotsByBeatId).sort(
    (left, right) => left.x - right.x,
  )[0];
  return firstSlot?.x ?? measureX + MEASURE_PADDING_X;
};

const getMeasureInnerRightX = (
  spacing: MeasureSpacingSummary,
  measureX: number,
): number => measureX + spacing.assignedWidth - MEASURE_PADDING_X;

/**
 * 把小节内任意 tick 投影到 SVG x 坐标。
 *
 * 已有 beat 内部使用 beat 自身宽度按 tick 比例插值；gap 区间使用相邻视觉边界插值。
 * 这样 layout 不需要创建临时 beat，也能为尾部和中间空洞生成稳定可点击区域。
 */
export const projectTickToMeasureX = (
  spacing: MeasureSpacingSummary,
  measure: Measure,
  context: { measureX: number; timeSignature: TimeSignature; tick: number },
): number => {
  const capacityTicks = getMeasureCapacityTicks(context.timeSignature);
  const clampedTick = Math.max(0, Math.min(context.tick, capacityTicks));
  const leftX = getMeasureInnerLeftX(spacing, context.measureX);
  const rightX = getMeasureInnerRightX(spacing, context.measureX);

  const sortedBeats = [...measure.beats].sort((left, right) => left.tick - right.tick);

  for (const beat of sortedBeats) {
    const slot = spacing.slotsByBeatId[beat.id];
    const beatTicks = calculateRhythmTicks(beat.rhythm);
    if (!slot || !beatTicks.ok) continue;

    const beatStart = beat.tick;
    const beatEnd = beat.tick + beatTicks.ticks;
    if (clampedTick >= beatStart && clampedTick <= beatEnd) {
      const ratio =
        beatTicks.ticks === 0 ? 0 : (clampedTick - beatStart) / beatTicks.ticks;
      return slot.x + slot.width * ratio;
    }
  }

  const anchors = sortedBeats
    .map((beat) => {
      const slot = spacing.slotsByBeatId[beat.id];
      const beatTicks = calculateRhythmTicks(beat.rhythm);
      if (!slot || !beatTicks.ok) return undefined;
      return {
        startTick: beat.tick,
        endTick: beat.tick + beatTicks.ticks,
        startX: slot.x,
        endX: slot.x + slot.width,
      };
    })
    .filter((anchor): anchor is NonNullable<typeof anchor> => Boolean(anchor));

  const previous = [...anchors]
    .reverse()
    .find((anchor) => anchor.endTick <= clampedTick);
  const next = anchors.find((anchor) => anchor.startTick >= clampedTick);

  const rangeStartTick = previous?.endTick ?? 0;
  const rangeEndTick = next?.startTick ?? capacityTicks;
  const rangeStartX = previous?.endX ?? leftX;
  const rangeEndX = next?.startX ?? rightX;
  const ratio =
    rangeEndTick === rangeStartTick
      ? 0
      : (clampedTick - rangeStartTick) / (rangeEndTick - rangeStartTick);

  return rangeStartX + (rangeEndX - rangeStartX) * ratio;
};
```

- [ ] **Step 3: Replace edit-grid implementation**

Replace `packages/lxm-tabeditor/src/layout/edit-grid.ts` with:

```ts
import { calculateRhythmTicks, getMeasureCapacityTicks } from "../core/rhythm";
import type { Measure, RhythmValue, TimeSignature } from "../core/schema";
import { projectTickToMeasureX } from "./measure-spacing";
import type {
  LaidOutBeat,
  LaidOutEditGridSlot,
  MeasureEditGrid,
  MeasureSpacingSummary,
} from "./layout-types";

interface MeasureCoverageSegment {
  kind: "beat" | "gap";
  startTick: number;
  endTick: number;
  beatId?: string;
}

const buildMeasureCoverageSegments = (
  measure: Measure,
  timeSignature: TimeSignature,
): MeasureCoverageSegment[] => {
  const capacityTicks = getMeasureCapacityTicks(timeSignature);
  const segments: MeasureCoverageSegment[] = [];
  const sortedBeats = [...measure.beats].sort((left, right) => left.tick - right.tick);
  let cursorTick = 0;

  for (const beat of sortedBeats) {
    const beatTicks = calculateRhythmTicks(beat.rhythm);
    if (!beatTicks.ok) continue;

    const beatStartTick = Math.max(0, Math.min(beat.tick, capacityTicks));
    const beatEndTick = Math.max(
      beatStartTick,
      Math.min(beat.tick + beatTicks.ticks, capacityTicks),
    );

    if (cursorTick < beatStartTick) {
      segments.push({
        kind: "gap",
        startTick: cursorTick,
        endTick: beatStartTick,
      });
    }

    if (beatStartTick < beatEndTick) {
      segments.push({
        kind: "beat",
        beatId: beat.id,
        startTick: beatStartTick,
        endTick: beatEndTick,
      });
      cursorTick = Math.max(cursorTick, beatEndTick);
    }
  }

  if (cursorTick < capacityTicks) {
    segments.push({
      kind: "gap",
      startTick: cursorTick,
      endTick: capacityTicks,
    });
  }

  return segments;
};

const buildBeatSingleSlot = (
  measure: Measure,
  beat: LaidOutBeat,
): LaidOutEditGridSlot => ({
  id: `${measure.id}-${beat.id}-slot-0`,
  kind: "beat",
  measureId: measure.id,
  beatId: beat.id,
  coveringBeatId: beat.id,
  tick: beat.tick,
  x: beat.x,
  width: beat.width,
  isBeatStart: true,
});

export const buildMeasureEditGrid = (
  measure: Measure,
  spacing: MeasureSpacingSummary,
  laidOutBeats: LaidOutBeat[],
  context: {
    measureX: number;
    timeSignature: TimeSignature;
    editingRhythm?: RhythmValue;
  },
): MeasureEditGrid | undefined => {
  if (!context.editingRhythm) return undefined;

  const slotTicksResult = calculateRhythmTicks(context.editingRhythm);
  if (!slotTicksResult.ok) return undefined;

  const slotTicks = slotTicksResult.ticks;
  const beatById = new Map(laidOutBeats.map((beat) => [beat.id, beat] as const));
  const tupletBeatIds = new Set(
    measure.tuplets.flatMap((tuplet) => tuplet.beatIds),
  );
  const slots: LaidOutEditGridSlot[] = [];

  for (const segment of buildMeasureCoverageSegments(measure, context.timeSignature)) {
    const segmentTicks = segment.endTick - segment.startTick;
    if (segmentTicks <= 0) continue;

    if (segment.kind === "beat" && segment.beatId && tupletBeatIds.has(segment.beatId)) {
      const beat = beatById.get(segment.beatId);
      if (beat) slots.push(buildBeatSingleSlot(measure, beat));
      continue;
    }

    if (segmentTicks % slotTicks !== 0) {
      if (segment.kind === "beat" && segment.beatId) {
        const beat = beatById.get(segment.beatId);
        if (beat) slots.push(buildBeatSingleSlot(measure, beat));
      }
      continue;
    }

    const slotCount = segmentTicks / slotTicks;
    for (let index = 0; index < slotCount; index += 1) {
      const tick = segment.startTick + index * slotTicks;
      const x = projectTickToMeasureX(spacing, measure, {
        measureX: context.measureX,
        timeSignature: context.timeSignature,
        tick,
      });
      const nextX = projectTickToMeasureX(spacing, measure, {
        measureX: context.measureX,
        timeSignature: context.timeSignature,
        tick: tick + slotTicks,
      });
      const width = Math.max(1, nextX - x);

      if (segment.kind === "beat" && segment.beatId) {
        slots.push({
          id: `${measure.id}-${segment.beatId}-slot-${index}`,
          kind: "beat",
          measureId: measure.id,
          ...(index === 0 ? { beatId: segment.beatId } : {}),
          coveringBeatId: segment.beatId,
          tick,
          x,
          width,
          isBeatStart: index === 0,
        });
      } else {
        slots.push({
          id: `${measure.id}-gap-${segment.startTick}-${segment.endTick}-slot-${index}`,
          kind: "gap",
          measureId: measure.id,
          tick,
          x,
          width,
          gapStartTick: segment.startTick,
          gapEndTick: segment.endTick,
          isBeatStart: false,
        });
      }
    }
  }

  return { rhythm: context.editingRhythm, slots };
};
```

- [ ] **Step 4: Update measure-layout call site**

In `packages/lxm-tabeditor/src/layout/measure-layout.ts`, replace:

```ts
const editGrid = buildMeasureEditGrid(
  measure,
  beats,
  context.editingRhythm,
);
```

with:

```ts
const editGrid = buildMeasureEditGrid(measure, spacing, beats, {
  measureX: context.x,
  timeSignature: context.timeSignature,
  editingRhythm: context.editingRhythm,
});
```

- [ ] **Step 5: Run layout tests**

Run:

```bash
CI=true pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/edit-grid.test.ts tests/layout.test.ts
```

Expected: gap slot tests pass; existing long-beat subdivision tests still pass after updating their assertions to include `slot.kind === "beat"` where needed.

---

### Task 3: Return Gap Hit Metadata and Preserve Beat Hit Behavior

**Files:**

- Modify: `packages/lxm-tabeditor/src/layout/score-layout.ts`
- Modify: `packages/lxm-tabeditor/tests/edit-grid.test.ts`

- [ ] **Step 1: Add hit tests**

Append these tests to `packages/lxm-tabeditor/tests/edit-grid.test.ts`:

```ts
it("命中 gap slot 时返回 slotKind 和 gap 范围，而不是最近 beat", () => {
  const score = createEmptyScore();
  score.tracks[0]!.measures[0] = {
    ...score.tracks[0]!.measures[0]!,
    beats: [
      {
        id: "beat-gap-01",
        tick: 0,
        rhythm: { base: "quarter", dots: 0 },
        kind: "rest",
      },
    ],
  };

  const layout = layoutScore(score, {
    editingRhythm: { base: "quarter", dots: 0 },
  });
  const measure = layout.systems[0]!.measures[0]!;
  const gapSlot = measure.editGrid?.slots.find(
    (slot) => slot.kind === "gap" && slot.tick === 960,
  );
  expect(gapSlot).toBeDefined();
  if (!gapSlot) return;

  const hit = hitTestScoreLayout(layout, {
    x: gapSlot.x + gapSlot.width / 2,
    y: measure.y + measure.staffTop + measure.stringSpacing * 2,
  });

  expect(hit).toMatchObject({
    measureId: "measure-001",
    beatId: undefined,
    tick: 960,
    slotId: gapSlot.id,
    slotKind: "gap",
    gapStartTick: 960,
    gapEndTick: 3840,
  });
});

it("命中 beat slot 时仍返回 covering beat 语义", () => {
  const document = createExampleDocument();
  const layout = layoutScore(document.score, {
    editingRhythm: { base: "thirtySecond", dots: 0 },
  });
  const measure = layout.systems.flatMap((system) => system.measures)[4]!;
  const beatSlot = measure.editGrid?.slots.find(
    (slot) => slot.kind === "beat" && slot.beatId,
  );
  expect(beatSlot).toBeDefined();
  if (!beatSlot || beatSlot.kind !== "beat") return;

  const hit = hitTestScoreLayout(layout, {
    x: beatSlot.x + beatSlot.width / 2,
    y: measure.y + measure.staffTop + measure.stringSpacing * 2,
  });

  expect(hit).toMatchObject({
    slotKind: "beat",
    beatId: beatSlot.coveringBeatId,
    tick: beatSlot.tick,
    slotId: beatSlot.id,
  });
});
```

- [ ] **Step 2: Update hitTestScoreLayout slot branch**

In `packages/lxm-tabeditor/src/layout/score-layout.ts`, replace the `if (slot) { return ... }` block with:

```ts
if (slot) {
  if (slot.kind === "gap") {
    return {
      measureId: measure.id,
      tick: slot.tick,
      string,
      slotId: slot.id,
      slotKind: "gap",
      gapStartTick: slot.gapStartTick,
      gapEndTick: slot.gapEndTick,
    };
  }

  return {
    measureId: measure.id,
    beatId: slot.coveringBeatId,
    tick: slot.tick,
    string,
    slotId: slot.id,
    slotKind: "beat",
  };
}
```

- [ ] **Step 3: Run hit tests**

Run:

```bash
CI=true pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/edit-grid.test.ts
```

Expected: all edit-grid tests pass.

---

### Task 4: Materialize Gap Writes in Command Layer

**Files:**

- Modify: `packages/lxm-tabeditor/src/commands/timeline-materialization.ts`
- Modify: `packages/lxm-tabeditor/src/commands/score-command-reducer.ts`
- Modify: `packages/lxm-tabeditor/tests/commands.test.ts`

- [ ] **Step 1: Add rest and ordering tests**

Append to `packages/lxm-tabeditor/tests/commands.test.ts`:

```ts
it("支持在 gap slot 内按当前时值写入休止符", () => {
  const score = createEmptyScore();
  score.tracks[0]!.measures[0] = {
    ...score.tracks[0]!.measures[0]!,
    beats: [
      {
        id: "beat-gap-existing",
        tick: 0,
        rhythm: { base: "quarter", dots: 0 },
        kind: "rest",
      },
    ],
  };

  const result = reduceScoreCommand(score, {
    type: "beat.setRest",
    payload: {
      trackId: "track-guitar-main",
      measureId: "measure-001",
      tick: 960,
      slotKind: "gap",
      gapStartTick: 960,
      gapEndTick: 3840,
      rhythm: { base: "quarter", dots: 0 },
    },
  });

  expect(result.ok).toBe(true);
  if (!result.ok) return;

  expect(result.value.tracks[0]!.measures[0]!.beats).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ tick: 960, kind: "rest" }),
      expect.objectContaining({ tick: 1920, kind: "rest" }),
      expect.objectContaining({ tick: 2880, kind: "rest" }),
    ]),
  );
});

it("gap 写入后 beats 仍按 tick 升序排列", () => {
  const score = createEmptyScore();
  score.tracks[0]!.measures[0] = {
    ...score.tracks[0]!.measures[0]!,
    beats: [
      {
        id: "beat-gap-existing",
        tick: 0,
        rhythm: { base: "quarter", dots: 0 },
        kind: "rest",
      },
    ],
  };

  const result = reduceScoreCommand(score, {
    type: "note.add",
    payload: {
      trackId: "track-guitar-main",
      measureId: "measure-001",
      tick: 2880,
      slotKind: "gap",
      gapStartTick: 960,
      gapEndTick: 3840,
      rhythm: { base: "quarter", dots: 0 },
      note: { id: "note-gap-late", string: 1, fret: 7, techniques: [] },
    },
  });

  expect(result.ok).toBe(true);
  if (!result.ok) return;

  const ticks = result.value.tracks[0]!.measures[0]!.beats.map((beat) => beat.tick);
  expect(ticks).toEqual([...ticks].sort((left, right) => left - right));
});
```

- [ ] **Step 2: Add gap materializer**

Append to `packages/lxm-tabeditor/src/commands/timeline-materialization.ts`:

```ts
const createGapRest = (
  sourceId: string,
  suffix: string,
  tick: number,
  rhythm: RhythmValue,
): Beat => ({
  id: `${sourceId}__${suffix}`,
  tick,
  rhythm,
  kind: "rest",
});

/**
 * 将 gap slot 写入真实时间线。
 *
 * gap 不对应任何已有 beat，因此不能复用 materializeBeatAtTick 的替换逻辑。
 * 这里只在 gap 范围内生成 before/target/after，并与原 beats 合并排序。
 */
export const materializeBeatIntoGap = ({
  measure,
  tick,
  rhythm,
  nextBeat,
  gapStartTick,
  gapEndTick,
  timeSignature,
}: {
  measure: Measure;
  tick: number;
  rhythm: RhythmValue;
  nextBeat: Beat;
  gapStartTick: number;
  gapEndTick: number;
  timeSignature: TimeSignature;
}): Beat[] => {
  const targetTicks = calculateRhythmTicks(rhythm);
  if (!targetTicks.ok) {
    throw new Error("无法 materialize 非整数 tick 时值");
  }

  const targetEndTick = tick + targetTicks.ticks;
  if (tick < gapStartTick || targetEndTick > gapEndTick) {
    throw new Error("目标 slot 超出 gap 时间范围");
  }

  const before = partitionTickRangeToRhythms(
    gapStartTick,
    tick,
    timeSignature,
  ).map((fragment, index) =>
    createGapRest(nextBeat.id, `gap_before_${index}`, fragment.tick, fragment.rhythm),
  );
  const after = partitionTickRangeToRhythms(
    targetEndTick,
    gapEndTick,
    timeSignature,
  ).map((fragment, index) =>
    createGapRest(nextBeat.id, `gap_after_${index}`, fragment.tick, fragment.rhythm),
  );

  return [...measure.beats, ...before, nextBeat, ...after].sort(
    (left, right) => left.tick - right.tick,
  );
};
```

- [ ] **Step 3: Add reducer helpers**

In `packages/lxm-tabeditor/src/commands/score-command-reducer.ts`, update imports:

```ts
import {
  materializeBeatAtTick,
  materializeBeatIntoGap,
} from "./timeline-materialization";
```

Add helper functions near `findMeasureContext(...)`:

```ts
const validateGapPayload = (
  payload: TimelineTargetPayload & { rhythm?: unknown },
): CommandResult<{ tick: number; gapStartTick: number; gapEndTick: number }> => {
  if (payload.tick === undefined) {
    return commandFailure("TICK_REQUIRED_FOR_GAP_WRITE", "gap slot 写入缺少目标 tick");
  }
  if (payload.gapStartTick === undefined || payload.gapEndTick === undefined) {
    return commandFailure("GAP_RANGE_REQUIRED", "gap slot 写入缺少时间范围");
  }
  if (!payload.rhythm) {
    return commandFailure(
      "RHYTHM_REQUIRED_FOR_SLOT_WRITE",
      "在 gap 空槽写入时必须提供目标时值",
    );
  }
  return {
    ok: true,
    value: {
      tick: payload.tick,
      gapStartTick: payload.gapStartTick,
      gapEndTick: payload.gapEndTick,
    },
  };
};
```

- [ ] **Step 4: Add gap branch to note.add**

At the top of `applyNoteAdd(...)`, before `findTargetContext(...)`, add:

```ts
if (command.payload.slotKind === "gap") {
  const gapResult = validateGapPayload(command.payload);
  if (!gapResult.ok) return gapResult;
  if (!command.payload.rhythm) {
    return commandFailure(
      "RHYTHM_REQUIRED_FOR_SLOT_WRITE",
      "在 gap 空槽写入时必须提供目标时值",
      command.payload.measureId,
    );
  }

  const measureResult = findMeasureContext(score, command.payload);
  if (!measureResult.ok) return measureResult;
  const { tick, gapStartTick, gapEndTick } = gapResult.value;
  const nextBeat: Beat = {
    id: `beat-gap-${command.payload.measureId}-${tick}`,
    tick,
    rhythm: command.payload.rhythm,
    kind: "notes",
    notes: [command.payload.note],
  };

  try {
    const nextBeats = materializeBeatIntoGap({
      measure: measureResult.value.measure,
      tick,
      rhythm: command.payload.rhythm,
      nextBeat,
      gapStartTick,
      gapEndTick,
      timeSignature:
        measureResult.value.measure.timeSignature ?? score.meta.timeSignature,
    });
    return {
      ok: true as const,
      value: replaceMeasure(score, measureResult.value, {
        ...measureResult.value.measure,
        beats: nextBeats,
      }),
    };
  } catch (error) {
    return commandFailure(
      "INVALID_GAP_WRITE",
      error instanceof Error ? error.message : "gap 空槽写入失败",
      command.payload.measureId,
    );
  }
}
```

- [ ] **Step 5: Add gap branch to beat.setRest**

At the top of `applyBeatSetRest(...)`, before `findTargetContext(...)`, add:

```ts
if (command.payload.slotKind === "gap") {
  const gapResult = validateGapPayload(command.payload);
  if (!gapResult.ok) return gapResult;
  if (!command.payload.rhythm) {
    return commandFailure(
      "RHYTHM_REQUIRED_FOR_SLOT_WRITE",
      "在 gap 空槽写入时必须提供目标时值",
      command.payload.measureId,
    );
  }

  const measureResult = findMeasureContext(score, command.payload);
  if (!measureResult.ok) return measureResult;
  const { tick, gapStartTick, gapEndTick } = gapResult.value;
  const nextBeat: Beat = {
    id: `beat-gap-rest-${command.payload.measureId}-${tick}`,
    tick,
    rhythm: command.payload.rhythm,
    kind: "rest",
  };

  try {
    const nextBeats = materializeBeatIntoGap({
      measure: measureResult.value.measure,
      tick,
      rhythm: command.payload.rhythm,
      nextBeat,
      gapStartTick,
      gapEndTick,
      timeSignature:
        measureResult.value.measure.timeSignature ?? score.meta.timeSignature,
    });
    return {
      ok: true as const,
      value: replaceMeasure(score, measureResult.value, {
        ...measureResult.value.measure,
        beats: nextBeats,
      }),
    };
  } catch (error) {
    return commandFailure(
      "INVALID_GAP_WRITE",
      error instanceof Error ? error.message : "gap 空槽写入失败",
      command.payload.measureId,
    );
  }
}
```

- [ ] **Step 6: Run command tests**

Run:

```bash
CI=true pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/commands.test.ts
```

Expected: all command tests pass, including existing beat-internal slot writes.

---

### Task 5: Wire Frontend Cursor and Grid Rendering

**Files:**

- Modify: `apps/website/components/editor-shell/ScorePreview/hooks/useScorePreviewPointerHit.ts`
- Modify: `apps/website/components/editor-shell/ScorePreview/hooks/useScorePreviewInput.ts`
- Modify: `apps/website/components/editor-shell/ScorePreview/MeasureGridLayer.tsx`

- [ ] **Step 1: Preserve slot metadata on pointer hit**

In `useScorePreviewPointerHit.ts`, replace `nextActiveBeat` creation with:

```ts
const nextActiveBeat = {
  trackId: track.id,
  ...hit,
  slotKind: hit.slotKind ?? "beat",
  slotId:
    hit.slotId ??
    `${hit.measureId}-${hit.beatId ?? hit.tick.toString()}-slot-0`,
};
```

Keep the existing beat lookup, but allow it to be undefined for gap slots:

```ts
const beat = track.measures
  .find((measure) => measure.id === hit.measureId)
  ?.beats.find((item) =>
    hit.beatId ? item.id === hit.beatId : item.tick === hit.tick,
  );
const note = getBeatNoteOnString(beat, hit.string);
```

- [ ] **Step 2: Allow fret input on gap cursor**

In `useScorePreviewInput.ts`, update the beginning of `writeFret(...)`:

```ts
if (!activeBeat) return;
const context = getActiveBeat(score, activeBeat);
const existingNote =
  context && activeBeat.slotKind !== "gap"
    ? getBeatNoteOnString(context.beat, activeBeat.string)
    : undefined;
```

Replace:

```ts
if (!context) return;
```

with no-op removal, because gap writes intentionally do not have a real beat context.

When updating an existing note, keep requiring `context`:

```ts
if (existingNote && context) {
  executeCommand({
    type: "note.updateFret",
    payload: {
      ...activeBeat,
      beatId: context.beat.id,
      noteId: existingNote.id,
      fret,
    },
  });
  setSelectedNoteIds([existingNote.id]);
  return;
}
```

The `note.add` branch remains:

```ts
executeCommand({
  type: "note.add",
  payload: {
    ...activeBeat,
    rhythm: currentRhythm,
    note,
  },
});
```

- [ ] **Step 3: Make grid visual state kind-aware**

In `MeasureGridLayer.tsx`, replace class selection:

```tsx
slot.id === activeSlotId
  ? styles["active-grid-slot-svg"]
  : slot.beatId
    ? styles["occupied-grid-slot-svg"]
    : styles["empty-grid-slot-svg"]
```

with:

```tsx
slot.id === activeSlotId
  ? styles["active-grid-slot-svg"]
  : slot.kind === "beat" && slot.beatId
    ? styles["occupied-grid-slot-svg"]
    : styles["empty-grid-slot-svg"]
```

- [ ] **Step 4: Run frontend type check**

Run:

```bash
CI=true pnpm --filter @liuxianmao/website type-check
```

Expected: no TypeScript errors for active cursor or slot kind narrowing.

---

### Task 6: Regression Verification

**Files:**

- No production file changes expected.

- [ ] **Step 1: Run focused tabeditor tests**

Run:

```bash
CI=true pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/rhythm.test.ts tests/layout.test.ts tests/edit-grid.test.ts tests/commands.test.ts
```

Expected: all focused suites pass.

- [ ] **Step 2: Run tabeditor type check and lint**

Run:

```bash
CI=true pnpm --filter @liuxianmao/lxm-tabeditor type-check
CI=true pnpm --filter @liuxianmao/lxm-tabeditor lint
```

Expected: both pass.

- [ ] **Step 3: Run website type check**

Run:

```bash
CI=true pnpm --filter @liuxianmao/website type-check
```

Expected: pass.

- [ ] **Step 4: Run full package test**

Run:

```bash
CI=true pnpm --filter @liuxianmao/lxm-tabeditor test
```

Expected: all Vitest suites pass.

- [ ] **Step 5: Manual QA in editor**

Start the website dev server using the repo's existing command, then verify:

1. Select quarter rhythm.
2. Open a 4/4 measure containing only the first quarter beat.
3. Confirm three trailing grid cells appear after tick `960`.
4. Click the second trailing grid cell and type a fret number.
5. Confirm a real `notes` beat appears at tick `1920` and remaining gap is represented by rest beats after command execution.
6. Open the example measure with missing early beats and confirm the middle gap cells are clickable.

## Implementation Notes

- 所有新增数学逻辑必须加中文注释，尤其是 coverage segment、tick-to-x 投影、gap materialization。
- 不要修改 `schema.ts` 增加 `placeholder` 或 `gap` beat kind。
- 不要放宽 `validation.ts` 的容量校验；编辑态容错属于 layout/editor/command 的协作。
- 不做 tuplet 内部 gap 细分；tuplet beat 仍然单槽回退。
- 不做旧 payload 的兼容迁移；但未携带 `slotKind` 的旧调用路径应按 beat slot 处理，避免现有按钮行为损坏。

## Self-Review

- **Spec coverage:** 覆盖了尾部 gap、中间 gap、gap hit、beat hit 兼容、note/rest gap 写入、前端 active cursor 透传和 Grid 视觉态。
- **Placeholder scan:** 文档没有使用待补充占位表述；每个任务都有具体代码或命令。
- **Type consistency:** 统一使用 `slotKind: "beat" | "gap"`、`gapStartTick`、`gapEndTick`；layout/store/command 三层命名一致。
- **Known risk:** `projectTickToMeasureX(...)` 依赖当前 spacing 模型的视觉列宽；若后续重写 spacing，需保留“任意 tick 可投影”的公共契约。

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-26-full-measure-edit-grid-gap-coverage-rework.md`. Two execution options:

**1. Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
