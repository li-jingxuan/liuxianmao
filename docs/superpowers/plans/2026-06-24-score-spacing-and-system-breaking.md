# Score Spacing And System Breaking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前固定等宽小节和线性 tick 映射升级为可解释的节奏列宽、可变小节宽度和自动分行排版。

**Architecture:** 在 `packages/lxm-tabeditor` 的 layout 层新增 engraving spacing pass：先把小节内 beat 转成 `RhythmicColumn`，再计算小节 `minWidth/idealWidth/assignedWidth`，最后由 system breaker 决定每行放哪些小节。React SVG 层继续只消费 `layoutScore()` 输出，不参与坐标推导；歌词和简谱只预留列宽/lane 接口，具体输入与渲染放入后续迭代。

**Tech Stack:** TypeScript, Vitest, React SVG, Next.js, SCSS Modules

---

## Scope

本计划只解决两个核心问题：

- 规范不同时值音符之间的水平距离。
- 支持小节可变宽和自动分行，替代当前固定每行 4 小节的等宽排版。

本计划不实现歌词输入、简谱渲染、和弦图避碰、PDF 分页或移动端响应式。这些能力只作为未来迭代的排版接口预留：

- 歌词未来通过 `RhythmicColumn.contentMinWidth` 反向影响列宽。
- 简谱未来通过同一组 `RhythmicColumn` 与 TAB 对齐。
- 垂直 lane 未来承载 `lyrics`、`jianpu`、`chord`、`technique` 等轨道。

## Current Context

当前关键文件：

- `packages/lxm-tabeditor/src/layout/layout-helpers.ts`
  - `getBeatX()` 使用 `tick / capacityTicks` 做线性 x 映射。
  - `getBeatTicks()` 使用节奏和连音组计算真实 tick 长度。
- `packages/lxm-tabeditor/src/layout/measure-layout.ts`
  - 每个 beat、note、rest、duration mark 都各自调用 `getBeatX()`。
  - beat 命中区宽度根据真实 tick 直接换算。
- `packages/lxm-tabeditor/src/layout/score-layout.ts`
  - `layoutSystem()` 当前将一行内小节等宽分配。
  - `layoutScore()` 当前默认固定每行 4 小节。
- `packages/lxm-tabeditor/tests/layout.test.ts`
  - 已覆盖固定宽度、每行 4 小节、beam、tie、hit test 和 100 小节布局。

这次改造后的核心原则：

- 音乐时间仍然由 `tick` 和 `rhythm` 表达，不为视觉间距修改领域数据。
- 所有 x 坐标必须来自同一份 spacing 结果，不能让 note、duration、hit area 分别计算。
- 自动分行只在 layout 层发生，页面层继续遍历 `layout.systems`。
- MVP 可以保留固定 system 宽度，但 system 内小节不再等宽。

## Planned File Structure

**Create**

- `packages/lxm-tabeditor/src/layout/measure-spacing.ts`
  - 负责小节内部节奏列、视觉权重、最小列宽、理想列宽和 beat x/width 的计算。
- `packages/lxm-tabeditor/src/layout/system-breaking.ts`
  - 负责根据小节 spacing summary 将 measures 切成 systems。

**Modify**

- `packages/lxm-tabeditor/src/layout/layout-constants.ts`
  - 增加 spacing policy 常量。
- `packages/lxm-tabeditor/src/layout/layout-types.ts`
  - 增加 `RhythmicColumn`、`BeatSpacingSlot`、`MeasureSpacingSummary`、`SystemBreak` 等类型。
- `packages/lxm-tabeditor/src/layout/layout-helpers.ts`
  - 保留节奏和弦号 helper；逐步停止在 layout 主流程中直接使用 `getBeatX()`。
- `packages/lxm-tabeditor/src/layout/measure-layout.ts`
  - 改为接收并消费 `MeasureSpacingSummary`，所有 x/width 从 spacing slot 读取。
- `packages/lxm-tabeditor/src/layout/score-layout.ts`
  - 先计算每个小节 spacing summary，再自动分行，再按 assigned width 布局 system。
- `packages/lxm-tabeditor/tests/layout.test.ts`
  - 补充 spacing、可变小节宽度、自动分行和 hit index 回归测试。
- `docs/guitar-tab-editor-iteration-plan.md`
  - 增加本轮排版改造进度记录；歌词和简谱保留在后续迭代说明中。
- `docs/guitar-tab-editor-technical-plan.md`
  - 更新 Layout Pass：从线性 tick 映射升级为 rhythmic columns + system breaking。

## Spacing Model

新增类型建议：

```ts
export interface RhythmicColumn {
  tick: number;
  beatIds: string[];
  durationWeight: number;
  minWidth: number;
  idealWidth: number;
}

export interface BeatSpacingSlot {
  beatId: string;
  tick: number;
  x: number;
  width: number;
  columnIndex: number;
}

export interface MeasureSpacingSummary {
  measureId: string;
  minWidth: number;
  idealWidth: number;
  assignedWidth: number;
  columns: RhythmicColumn[];
  slotsByBeatId: Record<string, BeatSpacingSlot>;
}
```

初始 spacing policy：

```ts
export const DURATION_VISUAL_WEIGHT = {
  whole: 4,
  half: 3,
  quarter: 2.2,
  eighth: 1.45,
  sixteenth: 1,
  thirtySecond: 0.72,
} as const;

export const DURATION_MIN_COLUMN_WIDTH = {
  whole: 54,
  half: 44,
  quarter: 34,
  eighth: 24,
  sixteenth: 17,
  thirtySecond: 12,
} as const;

export const MEASURE_MIN_WIDTH = 112;
export const MEASURE_IDEAL_WIDTH_PADDING = 36;
```

这些数值是 MVP 初始值，后续用视觉回归截图微调。不要把它们散落在 JSX、SCSS 或测试里。

## Final Width And Breaking Rules

用户确认后的最终规则：

- 小节是不可拆分单元，自动分行只能发生在小节之间，不能把小节内部拆到下一行。
- 不设置默认 `1/4` 行宽上限，也不设置单小节最大宽度比例。小节宽度由时值、音符密度和后续歌词/简谱等内容自然决定。
- 每个小节先计算 `minWidth` 与 `idealWidth`。如果一行内所有小节的 `idealWidth` 总和小于可用宽度，则直接使用 `idealWidth`，剩余空间留在行尾，不平均拉伸。
- 如果一行内 `idealWidth` 总和超过可用宽度，但 `minWidth` 总和可以放下，则按可压缩空间等比例压缩到 `minWidth ~ idealWidth` 之间。
- 如果单个小节的 `minWidth` 已经超过整行可用宽度，小节仍不可拆分，允许它单独成行并产生横向溢出或后续 warning。
- 不处理最后一行单小节，不从上一行借小节。
- 不强制每行至少 2 个小节。自动分行按当前行宽度累加自然决定。

因此，system breaker 采用贪心规则：

```ts
if (currentLineIdealWidth + nextMeasure.idealWidth <= availableWidth) {
  // 理想宽度可放下，继续放入当前行。
}

if (currentLineMinWidth + nextMeasure.minWidth <= availableWidth) {
  // 理想宽度放不下但最小宽度可放下，仍可放入当前行，后续由宽度分配压缩。
}

// 否则换行；如果当前行为空，则该超宽小节单独成行。
```

## Task 1: Define Spacing Types And Failing Unit Tests

**Files:**

- Modify: `packages/lxm-tabeditor/src/layout/layout-types.ts`
- Test: `packages/lxm-tabeditor/tests/layout.test.ts`

**Interfaces:**

- Produces:
  - `RhythmicColumn`
  - `BeatSpacingSlot`
  - `MeasureSpacingSummary`
  - `LaidOutMeasure["spacing"]`

- [ ] **Step 1: Add temporary test-side type expectations**

Add these helper types near existing test interfaces in `packages/lxm-tabeditor/tests/layout.test.ts`:

```ts
interface TestBeatSpacingSlot {
  beatId: string;
  tick: number;
  x: number;
  width: number;
  columnIndex: number;
}

interface TestRhythmicColumn {
  tick: number;
  beatIds: string[];
  durationWeight: number;
  minWidth: number;
  idealWidth: number;
}

interface TestMeasureSpacingSummary {
  measureId: string;
  minWidth: number;
  idealWidth: number;
  assignedWidth: number;
  columns: TestRhythmicColumn[];
  slotsByBeatId: Record<string, TestBeatSpacingSlot>;
}

interface TestMeasureWithSpacing {
  spacing?: TestMeasureSpacingSummary;
}
```

- [ ] **Step 2: Write the failing spacing shape test**

Add this test inside `describe("六线谱只读排版", () => { ... })`:

```ts
it("为每个小节输出节奏列和 beat spacing slot", () => {
  const document = createExampleDocument();
  const layout = layoutScore(document.score);
  const firstMeasure = layout.systems[0]!.measures[0]! as
    typeof layout.systems[number]["measures"][number] & TestMeasureWithSpacing;

  expect(firstMeasure.spacing).toBeDefined();
  expect(firstMeasure.spacing?.measureId).toBe("measure-001");
  expect(firstMeasure.spacing?.columns.length).toBeGreaterThan(0);
  expect(firstMeasure.spacing?.slotsByBeatId["beat-001-01"]).toEqual(
    expect.objectContaining({
      beatId: "beat-001-01",
      tick: 0,
      columnIndex: 0,
    }),
  );
});
```

- [ ] **Step 3: Run the test and verify RED**

Run:

```bash
pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/layout.test.ts
```

Expected:

```text
FAIL ... expected undefined to be defined
```

- [ ] **Step 4: Add exported layout types**

In `packages/lxm-tabeditor/src/layout/layout-types.ts`, add:

```ts
export interface RhythmicColumn {
  /** 小节内 tick 位置；同一 tick 上的 TAB、歌词、简谱未来共享同一列。 */
  tick: number;
  /** 落在该 tick 上的 beat id。 */
  beatIds: string[];
  /** 该列由时值推导出的视觉权重，不等于真实 tick 比例。 */
  durationWeight: number;
  /** 保证短时值、两位品位和未来歌词不会挤压到不可读的最小宽度。 */
  minWidth: number;
  /** 正常显示时希望获得的列宽。 */
  idealWidth: number;
}

export interface BeatSpacingSlot {
  /** 对应 beat id。 */
  beatId: string;
  /** 小节内 tick 位置。 */
  tick: number;
  /** 绝对 SVG x 坐标。 */
  x: number;
  /** 该 beat 到下一列或小节尾的视觉宽度。 */
  width: number;
  /** 对应 rhythmic column 下标。 */
  columnIndex: number;
}

export interface MeasureSpacingSummary {
  /** 对应 measure id。 */
  measureId: string;
  /** 小节在当前内容下不可再压缩的宽度。 */
  minWidth: number;
  /** 小节在当前内容下的理想宽度。 */
  idealWidth: number;
  /** system 分配给该小节的最终宽度。 */
  assignedWidth: number;
  /** 小节内部节奏列。 */
  columns: RhythmicColumn[];
  /** beat id 到最终 x/width 的映射。 */
  slotsByBeatId: Record<string, BeatSpacingSlot>;
}
```

Then extend `LaidOutMeasure`:

```ts
spacing: MeasureSpacingSummary;
```

- [ ] **Step 5: Add the smallest compile-only spacing object in layoutMeasure**

In `packages/lxm-tabeditor/src/layout/measure-layout.ts`, before the return object, add the smallest object needed to compile while the RED test continues to fail on missing columns:

```ts
const spacing: MeasureSpacingSummary = {
  measureId: measure.id,
  minWidth: context.width,
  idealWidth: context.width,
  assignedWidth: context.width,
  columns: [],
  slotsByBeatId: {},
};
```

Import the type:

```ts
import type {
  LayoutHitIndex,
  LaidOutDurationMark,
  LaidOutMeasure,
  LaidOutTuplet,
  MeasureSpacingSummary,
} from "./layout-types";
```

And include it in the returned `LaidOutMeasure`:

```ts
spacing,
```

- [ ] **Step 6: Run the test and confirm it still fails for missing columns**

Run:

```bash
pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/layout.test.ts
```

Expected:

```text
FAIL ... expected 0 to be greater than 0
```

- [ ] **Step 7: Commit**

```bash
git add packages/lxm-tabeditor/src/layout/layout-types.ts packages/lxm-tabeditor/src/layout/measure-layout.ts packages/lxm-tabeditor/tests/layout.test.ts
git commit -m "test: add spacing layout shape coverage"
```

## Task 2: Implement Measure Spacing Pass

**Files:**

- Create: `packages/lxm-tabeditor/src/layout/measure-spacing.ts`
- Modify: `packages/lxm-tabeditor/src/layout/layout-constants.ts`
- Modify: `packages/lxm-tabeditor/src/layout/measure-layout.ts`
- Test: `packages/lxm-tabeditor/tests/layout.test.ts`

**Interfaces:**

- Produces:
  - `layoutMeasureSpacing(measure, context) => MeasureSpacingSummary`
  - `getBeatSpacingSlot(spacing, beatId) => BeatSpacingSlot`

- [ ] **Step 1: Add spacing constants**

In `packages/lxm-tabeditor/src/layout/layout-constants.ts`, add:

```ts
/** 不同时值在水平排版中的光学权重；它用于视觉距离，不改变真实 tick。 */
export const DURATION_VISUAL_WEIGHT = {
  whole: 4,
  half: 3,
  quarter: 2.2,
  eighth: 1.45,
  sixteenth: 1,
  thirtySecond: 0.72,
} as const;

/** 每种时值对应的最小列宽，避免短时值挤压到不可读。 */
export const DURATION_MIN_COLUMN_WIDTH = {
  whole: 54,
  half: 44,
  quarter: 34,
  eighth: 24,
  sixteenth: 17,
  thirtySecond: 12,
} as const;

/** 小节左右视觉缓冲，用于把列宽汇总成理想小节宽度。 */
export const MEASURE_IDEAL_WIDTH_PADDING = 36;
/** 小节最低宽度，保证小节线、拍号和命中区域仍有可读空间。 */
export const MEASURE_MIN_WIDTH = 112;
```

- [ ] **Step 2: Create measure spacing implementation**

Create `packages/lxm-tabeditor/src/layout/measure-spacing.ts`:

```ts
import type { Beat, Measure } from "../core/schema";
import {
  DURATION_MIN_COLUMN_WIDTH,
  DURATION_VISUAL_WEIGHT,
  MEASURE_IDEAL_WIDTH_PADDING,
  MEASURE_MIN_WIDTH,
  MEASURE_PADDING_X,
} from "./layout-constants";
import { getBeatTicks } from "./layout-helpers";
import type {
  BeatSpacingSlot,
  MeasureSpacingSummary,
  RhythmicColumn,
} from "./layout-types";

const getBeatDurationWeight = (beat: Beat): number =>
  DURATION_VISUAL_WEIGHT[beat.rhythm.base];

const getBeatMinColumnWidth = (beat: Beat): number =>
  DURATION_MIN_COLUMN_WIDTH[beat.rhythm.base];

/**
 * 将小节 beats 合并为节奏列。
 *
 * 当前数据模型中通常一个 tick 对应一个 beat；这里仍按 tick 聚合，是为了给后续
 * TAB、歌词、简谱和和弦在同一时间点共享列宽留接口。
 */
export const buildRhythmicColumns = (
  measure: Measure,
): RhythmicColumn[] => {
  const beatsByTick = new Map<number, Beat[]>();
  for (const beat of measure.beats) {
    const beats = beatsByTick.get(beat.tick) ?? [];
    beats.push(beat);
    beatsByTick.set(beat.tick, beats);
  }

  return [...beatsByTick.entries()]
    .sort(([leftTick], [rightTick]) => leftTick - rightTick)
    .map(([tick, beats]) => {
      const durationWeight = Math.max(...beats.map(getBeatDurationWeight));
      const minWidth = Math.max(...beats.map(getBeatMinColumnWidth));
      return {
        tick,
        beatIds: beats.map((beat) => beat.id),
        durationWeight,
        minWidth,
        idealWidth: minWidth * durationWeight,
      };
    });
};

const distributeColumnWidths = (
  columns: RhythmicColumn[],
  availableWidth: number,
): number[] => {
  const totalIdealWidth = columns.reduce(
    (total, column) => total + column.idealWidth,
    0,
  );
  const totalMinWidth = columns.reduce(
    (total, column) => total + column.minWidth,
    0,
  );

  if (columns.length === 0) return [];

  if (availableWidth <= totalMinWidth) {
    const scale = totalMinWidth > 0 ? availableWidth / totalMinWidth : 1;
    return columns.map((column) => column.minWidth * scale);
  }

  if (totalIdealWidth <= availableWidth) {
    const extraWidth = availableWidth - totalIdealWidth;
    const extraPerColumn = extraWidth / columns.length;
    return columns.map((column) => column.idealWidth + extraPerColumn);
  }

  const compressibleWidth = totalIdealWidth - totalMinWidth;
  const targetCompression = totalIdealWidth - availableWidth;
  return columns.map((column) => {
    const columnCompression =
      compressibleWidth > 0
        ? ((column.idealWidth - column.minWidth) / compressibleWidth) *
          targetCompression
        : 0;
    return column.idealWidth - columnCompression;
  });
};

/**
 * 计算单个小节内部所有 beat 的最终 x/width。
 *
 * assignedWidth 由 system 分配，函数内部只负责在该宽度内排列列，不决定分行。
 */
export const layoutMeasureSpacing = (
  measure: Measure,
  context: {
    x: number;
    assignedWidth: number;
  },
): MeasureSpacingSummary => {
  const columns = buildRhythmicColumns(measure);
  const minWidth =
    Math.max(
      MEASURE_MIN_WIDTH,
      columns.reduce((total, column) => total + column.minWidth, 0) +
        MEASURE_PADDING_X * 2,
    );
  const idealWidth =
    Math.max(
      minWidth,
      columns.reduce((total, column) => total + column.idealWidth, 0) +
        MEASURE_IDEAL_WIDTH_PADDING,
    );
  const assignedWidth = Math.max(context.assignedWidth, minWidth);
  const availableWidth = Math.max(0, assignedWidth - MEASURE_PADDING_X * 2);
  const columnWidths = distributeColumnWidths(columns, availableWidth);
  const slotsByBeatId: Record<string, BeatSpacingSlot> = {};

  let cursorX = context.x + MEASURE_PADDING_X;
  columns.forEach((column, columnIndex) => {
    const width = columnWidths[columnIndex] ?? 0;
    for (const beatId of column.beatIds) {
      const beat = measure.beats.find((item) => item.id === beatId);
      slotsByBeatId[beatId] = {
        beatId,
        tick: column.tick,
        x: cursorX,
        width: Math.max(width, beat ? getBeatTicks(beat, measure.tuplets) / 12 : 0),
        columnIndex,
      };
    }
    cursorX += width;
  });

  return {
    measureId: measure.id,
    minWidth,
    idealWidth,
    assignedWidth,
    columns,
    slotsByBeatId,
  };
};

export const getBeatSpacingSlot = (
  spacing: MeasureSpacingSummary,
  beatId: string,
): BeatSpacingSlot => {
  const slot = spacing.slotsByBeatId[beatId];
  if (!slot) {
    return {
      beatId,
      tick: 0,
      x: 0,
      width: 0,
      columnIndex: -1,
    };
  }
  return slot;
};
```

- [ ] **Step 3: Consume spacing in measure-layout**

In `packages/lxm-tabeditor/src/layout/measure-layout.ts`, import:

```ts
import {
  getBeatSpacingSlot,
  layoutMeasureSpacing,
} from "./measure-spacing";
```

At the start of `layoutMeasure`, after `capacityTicks`, replace the compile-only spacing object from Task 1 with:

```ts
const spacing = layoutMeasureSpacing(measure, {
  x: context.x,
  assignedWidth: context.width,
});
```

Replace each beat x calculation:

```ts
const slot = getBeatSpacingSlot(spacing, beat.id);
const x = slot.x;
```

Replace beat width calculation with:

```ts
const width = Math.max(10, slot.width);
```

For notes, rests, duration marks and tuplets, read the x position from `getBeatSpacingSlot(spacing, beat.id).x`.

- [ ] **Step 4: Add test for thirty-second spacing minimum**

In `packages/lxm-tabeditor/tests/layout.test.ts`, add:

```ts
it("三十二分音符也保留可读的最小视觉列宽", () => {
  const document = createExampleDocument();
  const layout = layoutScore(document.score);
  const measures = layout.systems.flatMap((system) => system.measures) as Array<
    typeof layout.systems[number]["measures"][number] & TestMeasureWithSpacing
  >;
  const measureWithThirtySecond = measures.find((measure) =>
    measure.spacing?.columns.some((column) =>
      column.beatIds.some((beatId) =>
        measure.durationMarks.some(
          (mark) => mark.beatId === beatId && mark.base === "thirtySecond",
        ),
      ),
    ),
  );
  const thirtySecondColumn = measureWithThirtySecond?.spacing?.columns.find(
    (column) =>
      column.beatIds.some((beatId) =>
        measureWithThirtySecond.durationMarks.some(
          (mark) => mark.beatId === beatId && mark.base === "thirtySecond",
        ),
      ),
  );

  expect(thirtySecondColumn).toEqual(
    expect.objectContaining({
      minWidth: 12,
    }),
  );
});
```

- [ ] **Step 5: Run layout tests and verify GREEN**

Run:

```bash
pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/layout.test.ts
```

Expected:

```text
✓ tests/layout.test.ts
```

- [ ] **Step 6: Run type check**

Run:

```bash
pnpm --filter @liuxianmao/lxm-tabeditor type-check
```

Expected:

```text
tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add packages/lxm-tabeditor/src/layout/layout-constants.ts packages/lxm-tabeditor/src/layout/layout-types.ts packages/lxm-tabeditor/src/layout/measure-spacing.ts packages/lxm-tabeditor/src/layout/measure-layout.ts packages/lxm-tabeditor/tests/layout.test.ts
git commit -m "feat: add measure rhythmic spacing"
```

## Task 3: Add Variable Measure Widths In Systems

**Files:**

- Modify: `packages/lxm-tabeditor/src/layout/layout-types.ts`
- Modify: `packages/lxm-tabeditor/src/layout/score-layout.ts`
- Modify: `packages/lxm-tabeditor/src/layout/measure-layout.ts`
- Test: `packages/lxm-tabeditor/tests/layout.test.ts`

**Interfaces:**

- Produces:
  - `MeasureSpacingSummary.assignedWidth` reflects system allocation.
  - `LaidOutMeasure.width` is no longer always equal for measures in the same system.

- [ ] **Step 1: Write failing variable-width test**

In `packages/lxm-tabeditor/tests/layout.test.ts`, add:

```ts
it("同一行内小节可根据内容获得不同宽度", () => {
  const document = createExampleDocument();
  const layout = layoutScore(document.score);
  const firstSystemWidths = layout.systems[0]!.measures.map(
    (measure) => measure.width,
  );
  const uniqueWidths = new Set(firstSystemWidths.map((width) => Math.round(width)));

  expect(uniqueWidths.size).toBeGreaterThan(1);
});
```

Run:

```bash
pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/layout.test.ts
```

Expected:

```text
FAIL ... expected 1 to be greater than 1
```

- [ ] **Step 2: Precompute measure width summaries in score-layout**

In `packages/lxm-tabeditor/src/layout/score-layout.ts`, import:

```ts
import { buildRhythmicColumns } from "./measure-spacing";
import {
  MEASURE_IDEAL_WIDTH_PADDING,
  MEASURE_MIN_WIDTH,
  MEASURE_PADDING_X,
} from "./layout-constants";
```

Add:

```ts
interface MeasureWidthSummary {
  measureId: string;
  minWidth: number;
  idealWidth: number;
}

const summarizeMeasureWidth = (measure: Measure): MeasureWidthSummary => {
  const columns = buildRhythmicColumns(measure);
  const minWidth = Math.max(
    MEASURE_MIN_WIDTH,
    columns.reduce((total, column) => total + column.minWidth, 0) +
      MEASURE_PADDING_X * 2,
  );
  const idealWidth = Math.max(
    minWidth,
    columns.reduce((total, column) => total + column.idealWidth, 0) +
      MEASURE_IDEAL_WIDTH_PADDING,
  );
  return {
    measureId: measure.id,
    minWidth,
    idealWidth,
  };
};

const allocateMeasureWidths = (
  summaries: MeasureWidthSummary[],
  availableWidth: number,
): number[] => {
  const totalMinWidth = summaries.reduce(
    (total, summary) => total + summary.minWidth,
    0,
  );
  const totalIdealWidth = summaries.reduce(
    (total, summary) => total + summary.idealWidth,
    0,
  );

  if (summaries.length === 0) return [];

  if (availableWidth <= totalMinWidth) {
    return summaries.map((summary) => summary.minWidth);
  }

  if (availableWidth >= totalIdealWidth) {
    return summaries.map((summary) => summary.idealWidth);
  }

  /**
   * system 宽度介于最小宽度和理想宽度之间时，按每个小节可压缩空间等比例压缩。
   * 如果理想宽度没有占满整行，则不会把剩余空间强行塞回小节，而是留在行尾。
   */
  const compressibleWidth = totalIdealWidth - totalMinWidth;
  const targetCompression = totalIdealWidth - availableWidth;
  return summaries.map((summary) => {
    const compression =
      compressibleWidth > 0
        ? ((summary.idealWidth - summary.minWidth) / compressibleWidth) *
          targetCompression
        : 0;
    return summary.idealWidth - compression;
  });
};
```

- [ ] **Step 3: Change layoutSystem to allocate widths by content**

Inside `layoutSystem`, replace fixed `measureWidth` with:

```ts
const availableMeasureWidth = context.width - SYSTEM_HEADER_WIDTH;
const measureSummaries = measures.map(summarizeMeasureWidth);
const measureWidths = allocateMeasureWidths(
  measureSummaries,
  availableMeasureWidth,
);
let measureX = context.x + SYSTEM_HEADER_WIDTH;
```

In `measures.map`, pass:

```ts
const width = measureWidths[offset] ?? availableMeasureWidth / Math.max(1, measures.length);
const laidOutMeasure = layoutMeasure(measure, {
  index: context.startMeasureIndex + offset,
  x: measureX,
  y: context.y,
  width,
  timeSignature: nextTimeSignature,
  showTimeSignature,
  hitIndex: context.hitIndex,
});
measureX += width;
return laidOutMeasure;
```

Remove old `context.x + SYSTEM_HEADER_WIDTH + offset * measureWidth` usage.

- [ ] **Step 4: Run layout tests**

Run:

```bash
pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/layout.test.ts
```

Expected:

```text
✓ tests/layout.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/lxm-tabeditor/src/layout/score-layout.ts packages/lxm-tabeditor/tests/layout.test.ts
git commit -m "feat: allocate variable measure widths"
```

## Task 4: Implement Automatic System Breaking

**Files:**

- Create: `packages/lxm-tabeditor/src/layout/system-breaking.ts`
- Modify: `packages/lxm-tabeditor/src/layout/layout-constants.ts`
- Modify: `packages/lxm-tabeditor/src/layout/score-layout.ts`
- Test: `packages/lxm-tabeditor/tests/layout.test.ts`

**Interfaces:**

- Produces:
  - `createSystemBreaks(measures, options) => SystemBreak[]`
  - `layoutScore(score, { measuresPerSystem })` remains supported for deterministic tests.

- [ ] **Step 1: Add failing auto-break tests**

In `packages/lxm-tabeditor/tests/layout.test.ts`, add:

```ts
it("内容理想宽度未占满整行时保留行尾空白而不拉伸小节", () => {
  const document = createExampleDocument();
  const track = document.score.tracks[0]!;
  track.measures = [track.measures[0]!];

  const layout = layoutScore(document.score);
  const firstSystemMeasures = layout.systems[0]!.measures;
  const assignedWidth = firstSystemMeasures.reduce(
    (total, measure) => total + measure.width,
    0,
  );
  const idealWidth = firstSystemMeasures.reduce(
    (total, measure) => total + measure.spacing.idealWidth,
    0,
  );

  expect(assignedWidth).toBe(idealWidth);
  expect(assignedWidth).toBeLessThan(layout.width - 88);
});

it("自动分行按小节内容宽度累加，超过行宽才换行", () => {
  const document = createExampleDocument();
  const track = document.score.tracks[0]!;
  const denseMeasure = track.measures[6]!;
  track.measures = Array.from({ length: 8 }, (_, measureIndex) => ({
    ...denseMeasure,
    id: `auto-break-measure-${measureIndex + 1}`,
    beats: denseMeasure.beats.map((beat, beatIndex) => ({
      ...beat,
      id: `auto-break-beat-${measureIndex + 1}-${beatIndex + 1}`,
      ...(beat.kind === "notes"
        ? {
            notes: beat.notes.map((note, noteIndex) => ({
              ...note,
              id: `auto-break-note-${measureIndex + 1}-${beatIndex + 1}-${noteIndex + 1}`,
            })),
          }
        : {}),
    })),
  }));

  const layout = layoutScore(document.score);
  const firstSystemWidth = layout.systems[0]!.measures.reduce(
    (total, measure) => total + measure.width,
    0,
  );

  expect(layout.systems.length).toBeGreaterThan(1);
  expect(firstSystemWidth).toBeLessThanOrEqual(layout.width - 88);
});
```

Run:

```bash
pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/layout.test.ts
```

Expected:

```text
FAIL ...
```

- [ ] **Step 2: Create system-breaking module**

Create `packages/lxm-tabeditor/src/layout/system-breaking.ts`:

```ts
import type { Measure } from "../core/schema";

export interface MeasureBreakSummary {
  measureId: string;
  minWidth: number;
  idealWidth: number;
}

export interface SystemBreak {
  startMeasureIndex: number;
  endMeasureIndex: number;
  compressed: boolean;
}

export const createSystemBreaks = (
  measures: Measure[],
  summariesByMeasureId: Record<string, MeasureBreakSummary>,
  context: {
    availableWidth: number;
    forcedMeasuresPerSystem?: number;
  },
): SystemBreak[] => {
  if (context.forcedMeasuresPerSystem) {
    const breaks: SystemBreak[] = [];
    for (
      let startMeasureIndex = 0;
      startMeasureIndex < measures.length;
      startMeasureIndex += context.forcedMeasuresPerSystem
    ) {
      breaks.push({
        startMeasureIndex,
        endMeasureIndex: Math.min(
          measures.length,
          startMeasureIndex + context.forcedMeasuresPerSystem,
        ),
        compressed: false,
      });
    }

    return breaks;
  }

  const breaks: SystemBreak[] = [];
  let startMeasureIndex = 0;
  let currentIdealWidth = 0;
  let currentMinWidth = 0;
  let currentCompressed = false;

  measures.forEach((measure, measureIndex) => {
    const summary = summariesByMeasureId[measure.id];
    if (!summary) return;

    const nextIdealWidth = currentIdealWidth + summary.idealWidth;
    const nextMinWidth = currentMinWidth + summary.minWidth;
    const hasCurrentMeasures = measureIndex > startMeasureIndex;
    const fitsIdeally = nextIdealWidth <= context.availableWidth;
    const fitsMinimally = nextMinWidth <= context.availableWidth;

    /**
     * 自动分行按内容宽度贪心累加：
     * - idealWidth 可放下时直接放入当前行；
     * - idealWidth 放不下但 minWidth 可放下时也放入，后续由宽度分配压缩；
     * - 两者都放不下时换行；如果当前行为空，则超宽小节单独成行。
     */
    if (hasCurrentMeasures && !fitsIdeally && !fitsMinimally) {
      breaks.push({
        startMeasureIndex,
        endMeasureIndex: measureIndex,
        compressed: currentCompressed,
      });
      startMeasureIndex = measureIndex;
      currentIdealWidth = summary.idealWidth;
      currentMinWidth = summary.minWidth;
      currentCompressed = summary.idealWidth > context.availableWidth;
      return;
    }

    currentIdealWidth = nextIdealWidth;
    currentMinWidth = nextMinWidth;
    currentCompressed ||= !fitsIdeally && fitsMinimally;
  });

  if (startMeasureIndex < measures.length) {
    breaks.push({
      startMeasureIndex,
      endMeasureIndex: measures.length,
      compressed: currentCompressed,
    });
  }

  return breaks;
};
```

- [ ] **Step 3: Wire system breaking into layoutScore**

In `packages/lxm-tabeditor/src/layout/score-layout.ts`, import:

```ts
import {
  createSystemBreaks,
  type MeasureBreakSummary,
} from "./system-breaking";
```

When preparing the first track, build summaries:

```ts
const measureSummaries = Object.fromEntries(
  track.measures.map((measure) => {
    const summary = summarizeMeasureWidth(measure);
    return [
      measure.id,
      {
        measureId: measure.id,
        minWidth: summary.minWidth,
        idealWidth: summary.idealWidth,
      } satisfies MeasureBreakSummary,
    ];
  }),
);
const systemBreaks = createSystemBreaks(track.measures, measureSummaries, {
  availableWidth: layoutWidth - SYSTEM_HEADER_WIDTH,
  forcedMeasuresPerSystem: options?.measuresPerSystem,
});
```

Replace fixed chunking with `systemBreaks.map(...)`:

```ts
const systems = systemBreaks.map((systemBreak, systemIndex) => {
  const measures = track.measures.slice(
    systemBreak.startMeasureIndex,
    systemBreak.endMeasureIndex,
  );
  return layoutSystem(measures, {
    index: systemIndex,
    startMeasureIndex: systemBreak.startMeasureIndex,
    x: 0,
    y: systemIndex * (SYSTEM_HEIGHT + SYSTEM_GAP),
    width: layoutWidth,
    initialTimeSignature: score.meta.timeSignature,
    previousTimeSignature: getPreviousTimeSignature(
      track.measures,
      systemBreak.startMeasureIndex,
      score.meta.timeSignature,
    ),
    hitIndex,
  });
});
```

Add helper:

```ts
const getPreviousTimeSignature = (
  measures: Measure[],
  startMeasureIndex: number,
  fallback: TimeSignature,
): TimeSignature => {
  let active = fallback;
  for (let index = 0; index < startMeasureIndex; index += 1) {
    active = measures[index]?.timeSignature ?? active;
  }
  return active;
};
```

- [ ] **Step 4: Keep deterministic fixed-measures tests**

Update existing fixed layout test to pass explicit `measuresPerSystem: 4`:

```ts
const layout = layoutScore(document.score, { measuresPerSystem: 4 });
```

This preserves tests that specifically assert fixed 4-measure behavior while allowing default layout to auto-break.

- [ ] **Step 5: Run layout tests**

Run:

```bash
pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/layout.test.ts
```

Expected:

```text
✓ tests/layout.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add packages/lxm-tabeditor/src/layout/layout-constants.ts packages/lxm-tabeditor/src/layout/score-layout.ts packages/lxm-tabeditor/src/layout/system-breaking.ts packages/lxm-tabeditor/tests/layout.test.ts
git commit -m "feat: add automatic system breaking"
```

## Task 5: Preserve Rendering And Hit-Test Alignment

**Files:**

- Modify: `packages/lxm-tabeditor/tests/layout.test.ts`
- Verify: `apps/website/components/editor-shell/ScorePreview/ScorePreviewSvg.tsx`
- Verify: `apps/website/components/editor-shell/ScorePreview/ScoreMeasureLayer.tsx`
- Verify: `apps/website/components/editor-shell/ScorePreview/MeasureDurationLayer.tsx`

**Interfaces:**

- Ensures:
  - `notes[*].x`
  - `durationMarks[*].x`
  - `rests[*].x`
  - `hitIndex.beats[beatId].x`
  - `spacing.slotsByBeatId[beatId].x`
  all match for the same beat.

- [ ] **Step 1: Add coordinate alignment test**

In `packages/lxm-tabeditor/tests/layout.test.ts`, add:

```ts
it("音符、时值标记和命中区共享同一 beat spacing x 坐标", () => {
  const document = createExampleDocument();
  const layout = layoutScore(document.score, { measuresPerSystem: 4 });
  const measures = layout.systems.flatMap((system) => system.measures) as Array<
    typeof layout.systems[number]["measures"][number] & TestMeasureWithSpacing
  >;
  const firstMeasure = measures[0]!;
  const slot = firstMeasure.spacing!.slotsByBeatId["beat-001-01"]!;
  const note = firstMeasure.notes.find((item) => item.beatId === "beat-001-01")!;
  const durationMark = firstMeasure.durationMarks.find(
    (item) => item.beatId === "beat-001-01",
  )!;
  const hitBounds = layout.hitIndex.beats["beat-001-01"]!;

  expect(note.x).toBe(slot.x);
  expect(durationMark.x).toBe(slot.x);
  expect(hitBounds.x).toBeLessThanOrEqual(slot.x);
  expect(hitBounds.x + hitBounds.width).toBeGreaterThan(slot.x);
});
```

- [ ] **Step 2: Run layout tests**

Run:

```bash
pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/layout.test.ts
```

Expected:

```text
✓ tests/layout.test.ts
```

- [ ] **Step 3: Run website type-check**

Run:

```bash
pnpm --filter @liuxianmao/website type-check
```

Expected:

```text
tsc --noEmit
```

- [ ] **Step 4: Browser verification at 1280 x 720**

Start the website dev server if it is not already running:

```bash
pnpm --filter @liuxianmao/website dev
```

Open `http://localhost:3000` and verify:

- No page-level unexpected horizontal scrollbar.
- Systems use automatic line breaks.
- Fret numbers, duration heads, stems, beams, rests and active cell highlights remain aligned.
- Clicking a note still activates the expected beat/string.
- Browser console has no warnings or errors from layout/rendering.

- [ ] **Step 5: Commit**

```bash
git add packages/lxm-tabeditor/tests/layout.test.ts
git commit -m "test: assert spacing coordinate alignment"
```

## Task 6: Document Iteration And Future Lyrics/Jianpu Hooks

**Files:**

- Modify: `docs/guitar-tab-editor-technical-plan.md`
- Modify: `docs/guitar-tab-editor-iteration-plan.md`

**Interfaces:**

- Documents:
  - rhythmic columns
  - variable measure widths
  - automatic system breaking
  - future lyrics/jianpu integration points

- [ ] **Step 1: Update technical plan Layout Pass**

In `docs/guitar-tab-editor-technical-plan.md`, update section `5.2 Layout Pass` to describe:

```markdown
排版流程升级为 engraving pipeline：

1. 读取 Score 并建立 beat、note、tuplet、tie 等索引。
2. 为每个小节生成 RhythmicColumn，列是后续 TAB、歌词、简谱和和弦共同对齐的时间锚点。
3. 根据时值光学权重、最小可读宽度和未来内容占用计算每个小节的 minWidth 与 idealWidth。
4. 使用 system breaker 在固定 system 宽度内选择每行小节范围，不再强制每行 4 小节。
5. 在每个 system 内按 assignedWidth 分配小节宽度，并生成 beat spacing slot。
6. note、rest、duration、beam、tuplet、tie、hitIndex 全部消费 spacing slot，不直接重复 tick 到 x 的映射。
7. 后续歌词与简谱通过 RhythmicColumn 反向增加列宽，通过 vertical lane 增加系统高度。
```

- [ ] **Step 2: Update iteration plan**

In `docs/guitar-tab-editor-iteration-plan.md`, add a new progress record under the current active iteration:

```markdown
- [ ] 2026-06-24：规划节奏列宽与自动分行排版改造。目标是先解决时值音符水平距离和过宽小节自动换行；歌词与简谱只预留排版列/lane 接口，具体输入与渲染放入后续迭代。
```

If the implementation has completed, update the line to `[x]` and include verification commands.

- [ ] **Step 3: Run markdown and type checks**

Run:

```bash
pnpm --filter @liuxianmao/lxm-tabeditor type-check
pnpm --filter @liuxianmao/website type-check
```

Expected:

```text
tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add docs/guitar-tab-editor-technical-plan.md docs/guitar-tab-editor-iteration-plan.md
git commit -m "docs: plan engraving spacing evolution"
```

## Final Verification

Run these commands after all tasks:

```bash
pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/layout.test.ts
pnpm --filter @liuxianmao/lxm-tabeditor type-check
pnpm --filter @liuxianmao/website type-check
pnpm build
```

Expected:

```text
layout.test.ts passes
tsc --noEmit passes for core package
tsc --noEmit passes for website
turbo build exits 0
```

Manual browser verification:

- `1280 x 720` viewport has no accidental page-level overflow.
- Dense thirty-second-note measures either receive wider measure width or break earlier.
- Systems do not force exactly 4 measures when content is too dense.
- Notes, duration marks, rests, beams, tuplets, ties and hit areas stay horizontally aligned.
- Existing `layoutScore(score, { measuresPerSystem: 4 })` tests still allow deterministic fixed-line snapshots.

## Future Iteration Notes

Lyrics:

- Add `LyricLine` and multi-verse layout after rhythmic columns are stable.
- Each lyric segment should attach to `beatId` or resolved rhythmic column, not raw pixel x.
- Text measurement should increase `RhythmicColumn.minWidth`.

Jianpu:

- Add pitch derivation from `TabNote + tuning + capo + keySignature`.
- Render jianpu as a vertical lane aligned to `RhythmicColumn`.
- Jianpu duration underline, dots and octave marks should consume the same spacing slots as TAB duration marks.

Vertical lanes:

- Add a separate plan for `LayoutLane` after horizontal spacing and automatic system breaking are stable.
- Candidate lanes: `chord`, `jianpu`, `techniqueAbove`, `duration`, `tab`, `lyrics`, `techniqueBelow`.

## Self-Review Checklist

- [x] Plan focuses on one subsystem: horizontal spacing and automatic system breaking.
- [x] Lyrics and jianpu are explicitly deferred to future iterations with interface notes.
- [x] Every implementation task has concrete file paths.
- [x] Tests are written before implementation tasks.
- [x] No task requires React to infer layout coordinates.
- [x] Existing fixed-measures behavior remains available through `layoutScore(score, { measuresPerSystem: 4 })`.
