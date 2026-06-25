# Full-Measure Edit Grid Gap Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `lxm-tabeditor` 的编辑网格覆盖整小节时间轴，使 4/4 等普通小节在数据未写满、或中间存在时间空洞时，尾部 / gap 区域仍然可点击、可输入，并通过领域命令正确落盘。

**Architecture:** 保持 `measure.beats` 只表示真实音乐事件，不往 schema 注入 placeholder beat。`layout` 层新增“时间覆盖段（coverage segment）”派生：把一个小节拆成 `beat` 覆盖段和 `gap` 空洞段，再基于当前 `editingRhythm` 为两类 segment 统一生成 `editGrid`。命令层保留现有“拆已有 beat”路径，同时新增“往 gap 写入”的 materialize 路径；页面和 store 只保存 slot 元信息，不持久化编辑脚手架。

**Tech Stack:** TypeScript 6、Vitest、Zod、Zustand、React 19、SVG、pnpm workspace

## Global Constraints

- **不要**给 `packages/lxm-tabeditor/src/core/schema.ts` 增加 `placeholder` / `gap` beat kind；完整小节编辑网格只存在于 layout / editor 层。
- 所有 score 写操作仍然必须走 `packages/lxm-tabeditor/src/commands/` 的领域命令，保持撤销重做兼容。
- `packages/lxm-tabeditor/src/core/validation.ts` 中“普通小节容量必须等于拍号容量”的规则保持不变；这次只增强编辑态容错，不放宽领域校验。
- 涉及 tick 区间拆分、gap 投影到 x 坐标、slot 命中与 materialize 的数学逻辑必须补详细中文注释。
- 延续现有约束：tuplet beat 在 `editGrid` 中仍保持单槽回退；本轮不做 tuplet 内部 gap 细分。
- 编辑态数据必须继续通过 `slotId` 驱动选中态；新增的 gap 信息只能进入 `layout` / `editor-store` / `command payload`，不能写回 score。

---

## Planned File Structure

**Create**
- `docs/superpowers/plans/2026-06-25-full-measure-edit-grid-gap-coverage.md`

**Modify**
- `packages/lxm-tabeditor/src/layout/layout-types.ts`
- `packages/lxm-tabeditor/src/layout/edit-grid.ts`
- `packages/lxm-tabeditor/src/layout/measure-layout.ts`
- `packages/lxm-tabeditor/src/layout/score-layout.ts`
- `packages/lxm-tabeditor/src/layout/measure-spacing.ts`
- `packages/lxm-tabeditor/src/store/editor-store.ts`
- `packages/lxm-tabeditor/src/commands/command-types.ts`
- `packages/lxm-tabeditor/src/commands/timeline-materialization.ts`
- `packages/lxm-tabeditor/src/commands/score-command-reducer.ts`
- `packages/lxm-tabeditor/tests/edit-grid.test.ts`
- `packages/lxm-tabeditor/tests/layout.test.ts`
- `packages/lxm-tabeditor/tests/commands.test.ts`

**Why these files**
- `layout-types.ts`：定义 `beat slot / gap slot` 联合类型，以及命中结果的精确数据形状。
- `edit-grid.ts`：从“只细分已有 beat”升级到“按 coverage segment 生成整小节网格”。
- `measure-spacing.ts`：提供把任意 tick 投影到小节 x 坐标的 helper，供 gap slot 几何计算复用。
- `measure-layout.ts` / `score-layout.ts`：挂接新的 `editGrid` 生成与命中返回值。
- `editor-store.ts` / `command-types.ts`：让页面可以把 gap slot 元信息稳定传给命令层。
- `timeline-materialization.ts` / `score-command-reducer.ts`：新增 gap 写入路径，并在 reducer 内按 slot 种类分流。
- `tests/*.test.ts`：分别锁定 layout 几何、命中行为和命令落盘结果。

## Design Decisions

### 1. 为什么不在 `measure.beats` 里预补真实 rest

这样虽然实现更快，但会把“编辑辅助状态”混入真实时间线：

- `validation.ts` 会把这些预补 beat 当成真实内容校验；
- `score-command-reducer.ts` 删除 / 恢复音符时会碰到“这是用户写入的 rest，还是系统临时补的 rest”；
- 撤销重做、导出、播放都会受到污染。

因此本计划坚持：

- `score` 只保存真实 beat；
- `editGrid` 在 layout 层派生；
- 用户真正写入时，命令层才把 gap materialize 成真实 beat / rest。

### 2. 为什么需要 `projectTickToX`

现有 spacing 只为已有 beat 分配列宽，gap 区域没有天然的 x 坐标。要让 gap 可点击，必须有一个把“任意 tick”映射成小节内部 x 的稳定算法：

- 落在已有 beat 覆盖段内：沿用该 beat 的 `x + 内部比例`；
- 落在两 beat 之间的 gap：在前一个 beat 右边缘与后一个 beat 起点之间线性插值；
- 落在尾部 gap：在最后一个 beat 右边缘与小节右内边距之间线性插值。

这样可以最小改动接上现有 spacing 体系，不重写整套小节排版。

### 3. 命令层如何区分 beat slot 和 gap slot

不要复用现有“`beatId + tick != beat.tick` 就是空槽”的隐含约定，因为 gap slot 根本没有 `coveringBeatId`。需要在 payload 中显式区分：

- `beat slot`：`slotKind: "beat"`，继续走 `materializeBeatAtTick(...)`
- `gap slot`：`slotKind: "gap"`，新增 `gapStartTick / gapEndTick`，走 `materializeBeatIntoGap(...)`

这能避免 reducer 再次猜测来源，也让 store 和页面层的数据流更清晰。

## Task 1: 固化 gap slot 类型与失败测试，锁定新接口边界

**Files:**
- Modify: `packages/lxm-tabeditor/src/layout/layout-types.ts`
- Modify: `packages/lxm-tabeditor/src/store/editor-store.ts`
- Modify: `packages/lxm-tabeditor/src/commands/command-types.ts`
- Test: `packages/lxm-tabeditor/tests/edit-grid.test.ts`
- Test: `packages/lxm-tabeditor/tests/commands.test.ts`

**Interfaces:**
- Consumes:
  - `export interface ActiveCursorPosition`
  - `export interface TimelineTargetPayload`
  - `export interface ScoreLayoutHit`
- Produces:
  - `export type LaidOutEditGridSlot = LaidOutBeatEditGridSlot | LaidOutGapEditGridSlot`
  - `export interface LaidOutGapEditGridSlot { kind: "gap"; gapStartTick: number; gapEndTick: number; ... }`
  - `export interface ScoreLayoutHit { slotId?: string; slotKind?: "beat" | "gap"; gapStartTick?: number; gapEndTick?: number; ... }`
  - `export interface TimelineTargetPayload { slotKind?: "beat" | "gap"; gapStartTick?: number; gapEndTick?: number; ... }`
  - `export interface ActiveCursorPosition { slotKind: "beat" | "gap"; gapStartTick?: number; gapEndTick?: number; ... }`

- [ ] **Step 1: 在 `edit-grid.test.ts` 中写失败测试，锁定“尾部 gap 也会生成 slot”**

```ts
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

  expect(
    measure.editGrid?.slots.filter((slot) => slot.kind === "gap"),
  ).toHaveLength(3);
  expect(
    measure.editGrid?.slots.filter(
      (slot) =>
        slot.kind === "gap" &&
        slot.gapStartTick === 960 &&
        slot.gapEndTick === 3840,
    ),
  ).toHaveLength(3);
});
```

- [ ] **Step 2: 在 `edit-grid.test.ts` 中写失败测试，锁定“命中 gap slot 返回 gap 元信息”**

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
    tick: 960,
    slotId: gapSlot.id,
    slotKind: "gap",
    gapStartTick: 960,
    gapEndTick: 3840,
  });
});
```

- [ ] **Step 3: 在 `commands.test.ts` 中写失败测试，锁定“往 gap slot 写入音符”**

```ts
it("支持在 gap slot 内按当前时值写入音符", () => {
  const score = createEmptyScore();
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

- [ ] **Step 4: 运行测试确认失败**

Run: `pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/edit-grid.test.ts tests/commands.test.ts`

Expected: FAIL with messages similar to:
- `Property 'kind' does not exist on type 'TestEditGridSlot'`
- `Expected slotKind: "gap", received undefined`
- `BEAT_NOT_FOUND`

- [ ] **Step 5: 在类型文件中落最小接口定义，让测试编译通过但运行仍失败**

```ts
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
```

- [ ] **Step 6: 同步扩展 `TimelineTargetPayload`、`ActiveCursorPosition` 与 `ScoreLayoutHit`**

```ts
export interface TimelineTargetPayload {
  trackId: string;
  measureId: string;
  beatId?: string;
  tick?: number;
  slotKind?: "beat" | "gap";
  gapStartTick?: number;
  gapEndTick?: number;
}
```

- [ ] **Step 7: 再跑一次目标测试，确认现在失败点转移到 layout / reducer 逻辑，而不是类型缺失**

Run: `pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/edit-grid.test.ts tests/commands.test.ts`

Expected: FAIL with runtime assertion mismatch such as `expected 3 received 0` and `BEAT_NOT_FOUND`

- [ ] **Step 8: Commit**

```bash
git add packages/lxm-tabeditor/src/layout/layout-types.ts \
  packages/lxm-tabeditor/src/store/editor-store.ts \
  packages/lxm-tabeditor/src/commands/command-types.ts \
  packages/lxm-tabeditor/tests/edit-grid.test.ts \
  packages/lxm-tabeditor/tests/commands.test.ts
git commit -m "test: define gap slot interfaces and failing cases"
```

### Task 2: 让 layout 基于 coverage segment 生成整小节 edit grid

**Files:**
- Modify: `packages/lxm-tabeditor/src/layout/edit-grid.ts`
- Modify: `packages/lxm-tabeditor/src/layout/measure-layout.ts`
- Modify: `packages/lxm-tabeditor/src/layout/measure-spacing.ts`
- Modify: `packages/lxm-tabeditor/src/layout/layout-types.ts`
- Test: `packages/lxm-tabeditor/tests/edit-grid.test.ts`
- Test: `packages/lxm-tabeditor/tests/layout.test.ts`

**Interfaces:**
- Consumes:
  - `calculateRhythmTicks(...)`
  - `getMeasureCapacityTicks(...)`
  - `type Measure`
  - `type MeasureSpacingSummary`
  - `type TimeSignature`
- Produces:
  - `interface MeasureCoverageSegment`
  - `buildMeasureCoverageSegments(measure, timeSignature): MeasureCoverageSegment[]`
  - `projectTickToMeasureX(spacing, measure, timeSignature, tick): number`
  - `buildMeasureEditGrid(measure, spacing, laidOutBeats, timeSignature, editingRhythm): MeasureEditGrid | undefined`

- [ ] **Step 1: 在 `layout.test.ts` 中写失败测试，锁定 `projectTickToMeasureX` 对尾部 gap 的单调性**

```ts
it("尾部 gap 中的 slot x 坐标按 tick 单调递增", () => {
  const score = createEmptyScore();
  score.tracks[0]!.measures[0] = {
    ...score.tracks[0]!.measures[0]!,
    beats: [
      {
        id: "beat-gap-01",
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
});
```

- [ ] **Step 2: 运行 layout 测试确认失败**

Run: `pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/edit-grid.test.ts tests/layout.test.ts`

Expected: FAIL with `expected 3 received 0` / `gapSlots[0] is undefined`

- [ ] **Step 3: 在 `edit-grid.ts` 中新增 coverage segment 构建函数**

```ts
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
  const capacity = getMeasureCapacityTicks(timeSignature);
  const sortedBeats = [...measure.beats].sort((a, b) => a.tick - b.tick);
  const segments: MeasureCoverageSegment[] = [];
  let cursor = 0;

  for (const beat of sortedBeats) {
    const beatTicks = calculateRhythmTicks(beat.rhythm);
    if (!beatTicks.ok) continue;

    if (cursor < beat.tick) {
      segments.push({
        kind: "gap",
        startTick: cursor,
        endTick: beat.tick,
      });
    }

    segments.push({
      kind: "beat",
      beatId: beat.id,
      startTick: beat.tick,
      endTick: beat.tick + beatTicks.ticks,
    });
    cursor = Math.max(cursor, beat.tick + beatTicks.ticks);
  }

  if (cursor < capacity) {
    segments.push({ kind: "gap", startTick: cursor, endTick: capacity });
  }

  return segments;
};
```

- [ ] **Step 4: 在 `measure-spacing.ts` 中实现 `projectTickToMeasureX(...)`**

```ts
export const projectTickToMeasureX = (
  spacing: MeasureSpacingSummary,
  measure: Measure,
  timeSignature: TimeSignature,
  tick: number,
): number => {
  const columns = spacing.columns;
  const capacity = getMeasureCapacityTicks(timeSignature);
  const measureLeft = spacing.slotsByBeatId[measure.beats[0]?.id ?? ""]?.x ?? MEASURE_PADDING_X;
  const measureRight = spacing.assignedWidth - MEASURE_PADDING_X;

  if (columns.length === 0) return measureLeft;

  // 先处理落在已有 beat 覆盖区间内的 tick。
  for (const beat of measure.beats) {
    const slot = spacing.slotsByBeatId[beat.id];
    const beatTicks = calculateRhythmTicks(beat.rhythm);
    if (!slot || !beatTicks.ok) continue;

    const start = beat.tick;
    const end = beat.tick + beatTicks.ticks;
    if (tick >= start && tick <= end) {
      const ratio = beatTicks.ticks === 0 ? 0 : (tick - start) / beatTicks.ticks;
      return slot.x + slot.width * ratio;
    }
  }

  // 处理列间 gap 与尾部 gap。
  const sortedColumns = [...columns].sort((a, b) => a.tick - b.tick);
  for (let index = 0; index < sortedColumns.length - 1; index += 1) {
    const current = sortedColumns[index]!;
    const next = sortedColumns[index + 1]!;
    if (tick >= current.tick && tick <= next.tick) {
      const currentSlot = spacing.slotsByBeatId[current.beatIds[0]!]!;
      const nextSlot = spacing.slotsByBeatId[next.beatIds[0]!]!;
      const ratio = next.tick === current.tick ? 0 : (tick - current.tick) / (next.tick - current.tick);
      return currentSlot.x + currentSlot.width + (nextSlot.x - (currentSlot.x + currentSlot.width)) * ratio;
    }
  }

  const lastColumn = sortedColumns[sortedColumns.length - 1]!;
  const lastSlot = spacing.slotsByBeatId[lastColumn.beatIds[0]!]!;
  const tailStartX = lastSlot.x + lastSlot.width;
  const tailRatio = capacity === lastColumn.tick ? 0 : (tick - lastColumn.tick) / (capacity - lastColumn.tick);
  return tailStartX + (measureRight - tailStartX) * tailRatio;
};
```

- [ ] **Step 5: 重写 `buildMeasureEditGrid(...)`，让 `gap` 和 `beat` 统一按 segment 生成 slot**

```ts
export const buildMeasureEditGrid = (
  measure: Measure,
  spacing: MeasureSpacingSummary,
  laidOutBeats: LaidOutBeat[],
  timeSignature: TimeSignature,
  editingRhythm: RhythmValue | undefined,
): MeasureEditGrid | undefined => {
  if (!editingRhythm) return undefined;
  const slotTicksResult = calculateRhythmTicks(editingRhythm);
  if (!slotTicksResult.ok) return undefined;

  const beatById = new Map(laidOutBeats.map((beat) => [beat.id, beat] as const));
  const tupletBeatIds = new Set(measure.tuplets.flatMap((tuplet) => tuplet.beatIds));
  const segments = buildMeasureCoverageSegments(measure, timeSignature);
  const slots: LaidOutEditGridSlot[] = [];

  for (const segment of segments) {
    const segmentTicks = segment.endTick - segment.startTick;
    if (segment.kind === "beat" && segment.beatId && tupletBeatIds.has(segment.beatId)) {
      const laidOutBeat = beatById.get(segment.beatId);
      if (laidOutBeat) {
        slots.push({
          id: `${measure.id}-${segment.beatId}-slot-0`,
          kind: "beat",
          measureId: measure.id,
          beatId: segment.beatId,
          coveringBeatId: segment.beatId,
          tick: laidOutBeat.tick,
          x: laidOutBeat.x,
          width: laidOutBeat.width,
          isBeatStart: true,
        });
      }
      continue;
    }

    if (segmentTicks % slotTicksResult.ticks !== 0) {
      continue;
    }

    const slotCount = segmentTicks / slotTicksResult.ticks;
    for (let index = 0; index < slotCount; index += 1) {
      const tick = segment.startTick + index * slotTicksResult.ticks;
      const x = projectTickToMeasureX(spacing, measure, timeSignature, tick);
      const nextX = projectTickToMeasureX(
        spacing,
        measure,
        timeSignature,
        tick + slotTicksResult.ticks,
      );

      if (segment.kind === "beat" && segment.beatId) {
        slots.push({
          id: `${measure.id}-${segment.beatId}-slot-${index}`,
          kind: "beat",
          measureId: measure.id,
          ...(index === 0 ? { beatId: segment.beatId } : {}),
          coveringBeatId: segment.beatId,
          tick,
          x,
          width: nextX - x,
          isBeatStart: index === 0,
        });
      } else {
        slots.push({
          id: `${measure.id}-gap-${segment.startTick}-${segment.endTick}-slot-${index}`,
          kind: "gap",
          measureId: measure.id,
          tick,
          x,
          width: nextX - x,
          gapStartTick: segment.startTick,
          gapEndTick: segment.endTick,
          isBeatStart: false,
        });
      }
    }
  }

  return { rhythm: editingRhythm, slots };
};
```

- [ ] **Step 6: 在 `measure-layout.ts` 中改用新签名**

```ts
const editGrid = buildMeasureEditGrid(
  measure,
  spacing,
  beats,
  context.timeSignature,
  context.editingRhythm,
);
```

- [ ] **Step 7: 运行 layout 相关测试，确认 gap slot 几何与数量正确**

Run: `pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/edit-grid.test.ts tests/layout.test.ts`

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/lxm-tabeditor/src/layout/edit-grid.ts \
  packages/lxm-tabeditor/src/layout/measure-layout.ts \
  packages/lxm-tabeditor/src/layout/measure-spacing.ts \
  packages/lxm-tabeditor/src/layout/layout-types.ts \
  packages/lxm-tabeditor/tests/edit-grid.test.ts \
  packages/lxm-tabeditor/tests/layout.test.ts
git commit -m "feat: generate full-measure edit grid from coverage segments"
```

### Task 3: 升级命中与命令分流，让 gap slot 可真正写入

**Files:**
- Modify: `packages/lxm-tabeditor/src/layout/score-layout.ts`
- Modify: `packages/lxm-tabeditor/src/commands/timeline-materialization.ts`
- Modify: `packages/lxm-tabeditor/src/commands/score-command-reducer.ts`
- Modify: `packages/lxm-tabeditor/src/commands/command-types.ts`
- Modify: `packages/lxm-tabeditor/src/store/editor-store.ts`
- Test: `packages/lxm-tabeditor/tests/edit-grid.test.ts`
- Test: `packages/lxm-tabeditor/tests/commands.test.ts`

**Interfaces:**
- Consumes:
  - `type LaidOutEditGridSlot`
  - `partitionTickRangeToRhythms(...)`
  - `type TimelineTargetPayload`
  - `findTargetContext(score, payload)`
- Produces:
  - `materializeBeatIntoGap({ measure, tick, rhythm, nextBeat, gapStartTick, gapEndTick, timeSignature }): Beat[]`
  - `ScoreLayoutHit["slotKind"]`
  - `TimelineTargetPayload["slotKind"]`

- [ ] **Step 1: 在 `commands.test.ts` 中写失败测试，锁定 `beat.setRest` 也支持 gap 写入**

```ts
it("支持在 gap slot 内按当前时值写入休止符", () => {
  const score = createEmptyScore();
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
  expect(
    result.value.tracks[0]!.measures[0]!.beats.some(
      (beat) => beat.tick === 960 && beat.kind === "rest",
    ),
  ).toBe(true);
});
```

- [ ] **Step 2: 在 `edit-grid.test.ts` 中补失败测试，锁定 `beat slot` 老行为不回退**

```ts
it("命中 beat slot 时仍返回 covering beat 语义", () => {
  const document = createExampleDocument();
  const layout = layoutScore(document.score, {
    editingRhythm: { base: "thirtySecond", dots: 0 },
  });
  const measure = layout.systems.flatMap((system) => system.measures)[4]!;
  const beatSlot = measure.editGrid?.slots.find(
    (slot) => slot.kind === "beat" && slot.beatId === "beat-005-07",
  );
  expect(beatSlot).toBeDefined();
  if (!beatSlot) return;

  const hit = hitTestScoreLayout(layout, {
    x: beatSlot.x + beatSlot.width / 2,
    y: measure.y + measure.staffTop + measure.stringSpacing * 2,
  });

  expect(hit).toMatchObject({
    slotKind: "beat",
    beatId: "beat-005-07",
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/edit-grid.test.ts tests/commands.test.ts`

Expected: FAIL with `slotKind expected "gap" received undefined` and `BEAT_NOT_FOUND`

- [ ] **Step 4: 在 `timeline-materialization.ts` 中新增 `materializeBeatIntoGap(...)`**

```ts
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

  const targetEnd = tick + targetTicks.ticks;
  if (tick < gapStartTick || targetEnd > gapEndTick) {
    throw new Error("目标 slot 超出 gap 时间范围");
  }

  const before = partitionTickRangeToRhythms(
    gapStartTick,
    tick,
    timeSignature,
  ).map((fragment, index) => ({
    id: `${nextBeat.id}__gap_before_${index}`,
    tick: fragment.tick,
    rhythm: fragment.rhythm,
    kind: "rest" as const,
  }));
  const after = partitionTickRangeToRhythms(
    targetEnd,
    gapEndTick,
    timeSignature,
  ).map((fragment, index) => ({
    id: `${nextBeat.id}__gap_after_${index}`,
    tick: fragment.tick,
    rhythm: fragment.rhythm,
    kind: "rest" as const,
  }));

  return [...measure.beats, ...before, nextBeat, ...after].sort(
    (left, right) => left.tick - right.tick,
  );
};
```

- [ ] **Step 5: 在 `score-command-reducer.ts` 中按 `slotKind` 分流**

```ts
if (command.payload.slotKind === "gap") {
  if (!command.payload.rhythm) {
    return commandFailure(
      "RHYTHM_REQUIRED_FOR_SLOT_WRITE",
      "在 gap 空槽写入时必须提供目标时值",
      command.payload.measureId,
    );
  }
  if (
    command.payload.gapStartTick === undefined ||
    command.payload.gapEndTick === undefined
  ) {
    return commandFailure(
      "GAP_RANGE_REQUIRED",
      "gap slot 写入缺少时间范围",
      command.payload.measureId,
    );
  }

  const measureResult = findMeasureContext(score, command.payload);
  if (!measureResult.ok) return measureResult;

  const nextBeats = materializeBeatIntoGap({
    measure: measureResult.value.measure,
    tick: command.payload.tick ?? command.payload.gapStartTick,
    rhythm: command.payload.rhythm,
    nextBeat: {
      id: `gap-beat-${command.payload.tick}`,
      tick: command.payload.tick ?? command.payload.gapStartTick,
      rhythm: command.payload.rhythm,
      kind: "notes",
      notes: [command.payload.note],
    },
    gapStartTick: command.payload.gapStartTick,
    gapEndTick: command.payload.gapEndTick,
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
}
```

- [ ] **Step 6: 在 `score-layout.ts` 中命中 slot 后返回 `slotKind` / `gapStartTick` / `gapEndTick`**

```ts
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
```

- [ ] **Step 7: 同步更新 store 中光标结构，保证页面层能原样透传**

```ts
export interface ActiveCursorPosition {
  trackId: string;
  measureId: string;
  beatId?: string;
  tick: number;
  slotId: string;
  slotKind: "beat" | "gap";
  gapStartTick?: number;
  gapEndTick?: number;
  string: number;
}
```

- [ ] **Step 8: 运行命令与命中测试，确认 gap 写入和旧行为同时通过**

Run: `pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/edit-grid.test.ts tests/commands.test.ts`

Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/lxm-tabeditor/src/layout/score-layout.ts \
  packages/lxm-tabeditor/src/commands/timeline-materialization.ts \
  packages/lxm-tabeditor/src/commands/score-command-reducer.ts \
  packages/lxm-tabeditor/src/commands/command-types.ts \
  packages/lxm-tabeditor/src/store/editor-store.ts \
  packages/lxm-tabeditor/tests/edit-grid.test.ts \
  packages/lxm-tabeditor/tests/commands.test.ts
git commit -m "feat: support writing into gap edit-grid slots"
```

### Task 4: 全量回归验证并清理计划范围内的边界行为

**Files:**
- Modify: `packages/lxm-tabeditor/tests/layout.test.ts`
- Modify: `packages/lxm-tabeditor/tests/edit-grid.test.ts`
- Modify: `packages/lxm-tabeditor/tests/commands.test.ts`

**Interfaces:**
- Consumes:
  - `layoutScore(...)`
  - `hitTestScoreLayout(...)`
  - `reduceScoreCommand(...)`
- Produces:
  - 覆盖尾部 gap / 中间 gap / beat slot 兼容 / gap 写入后 beat 有序 的回归测试矩阵

- [ ] **Step 1: 在 `edit-grid.test.ts` 中补“中间 gap”用例**

```ts
it("中间存在时间空洞时，也会为 gap 生成 slot", () => {
  const score = createEmptyScore();
  score.tracks[0]!.measures[0] = {
    ...score.tracks[0]!.measures[0]!,
    beats: [
      { id: "beat-a", tick: 0, rhythm: { base: "quarter", dots: 0 }, kind: "rest" },
      { id: "beat-b", tick: 1920, rhythm: { base: "quarter", dots: 0 }, kind: "rest" },
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
        slot.gapStartTick === 960 &&
        slot.gapEndTick === 1920,
    ),
  ).toBeDefined();
});
```

- [ ] **Step 2: 在 `commands.test.ts` 中补“写入后 beat 依 tick 排序”用例**

```ts
it("gap 写入后 beats 仍按 tick 升序排列", () => {
  const score = createEmptyScore();
  const result = reduceScoreCommand(score, {
    type: "beat.setRest",
    payload: {
      trackId: "track-guitar-main",
      measureId: "measure-001",
      tick: 2880,
      slotKind: "gap",
      gapStartTick: 960,
      gapEndTick: 3840,
      rhythm: { base: "quarter", dots: 0 },
    },
  });

  expect(result.ok).toBe(true);
  if (!result.ok) return;

  const ticks = result.value.tracks[0]!.measures[0]!.beats.map((beat) => beat.tick);
  expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
});
```

- [ ] **Step 3: 跑核心测试集**

Run: `pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/rhythm.test.ts tests/layout.test.ts tests/edit-grid.test.ts tests/commands.test.ts`

Expected: PASS

- [ ] **Step 4: 跑类型检查与 lint**

Run: `pnpm --filter @liuxianmao/lxm-tabeditor type-check`
Expected: PASS

Run: `pnpm --filter @liuxianmao/lxm-tabeditor lint`
Expected: PASS

- [ ] **Step 5: 做一次全量单测回归**

Run: `pnpm --filter @liuxianmao/lxm-tabeditor test`

Expected: PASS with all Vitest suites green

- [ ] **Step 6: Commit**

```bash
git add packages/lxm-tabeditor/tests/layout.test.ts \
  packages/lxm-tabeditor/tests/edit-grid.test.ts \
  packages/lxm-tabeditor/tests/commands.test.ts
git commit -m "test: cover full-measure edit-grid gap scenarios"
```

## Self-Review

- **Spec coverage:** 已覆盖类型建模、整小节网格生成、gap 命中、gap 写入、回归验证五个需求面；没有遗漏“尾部缺拍”和“中间空洞”两个核心场景。
- **Placeholder scan:** 计划中没有 `TODO` / `TBD` / “适当处理异常” 一类占位语句；每个任务都有明确测试与命令。
- **Type consistency:** 统一使用 `slotKind: "beat" | "gap"`、`gapStartTick`、`gapEndTick`；没有在后文切换成其他命名。

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-25-full-measure-edit-grid-gap-coverage.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
