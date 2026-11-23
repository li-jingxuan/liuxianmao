# MVP Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `@liuxianmao/lxm-editor` 中实现 MVP 版本六线谱 layout 纯计算层，支持小节、弦线、音符、节奏列宽和自适应小节宽度。

**Architecture:** layout 层只接收已通过 schema 校验的 `ILXMDocument` / `ILXMTrack` / `ILXMMeasure`，输出 SVG/Canvas/React 均可消费的坐标数据。节奏 tick 计算和视觉宽度计算分离：`calculateRhythmTicks` 只表达音乐时间，`buildRhythmicColumns` / `layoutMeasureSpacing` 负责把 TAB、未来歌词、简谱等视觉贡献合并为列宽。

**Tech Stack:** TypeScript、Vitest、现有 `ILXM*` 类型、纯函数布局算法，不引入新的第三方库。

---

## Scope

本轮只做 MVP 小节渲染能力：

- 支持第一条吉他轨道的 measures 布局。
- 支持六根弦线坐标。
- 支持 notes beat 的音符坐标，音符文本为 `fret` 字符串。
- 支持基于节奏列的 beat `x` 和 `width`。
- 支持小节宽度根据内容自适应。
- 支持未来歌词、简谱、和弦等内容通过 width contributor 扩展列宽。

本轮不做：

- 自动换行。
- 休止符。
- 连梁、符干、附点图形。
- 歌词、简谱、和弦图真实渲染。
- 编辑命中区域。
- 多轨道同步排版。

## File Structure

- Create: `packages/lxm-editor/src/core/rhythm.ts`
  - 负责节奏到 tick 的纯语义换算，以及拍号到小节容量 tick 的换算。
- Create: `packages/lxm-editor/tests/core/rhythm.test.ts`
  - 覆盖基础时值、附点、小节容量。
- Create: `packages/lxm-editor/src/layout/layout-constants.ts`
  - 集中维护 MVP 几何常量和时值视觉权重。
- Modify: `packages/lxm-editor/src/layout/layout-types.ts`
  - 定义 layout 输出结构、节奏列、beat slot、measure layout、score layout。
- Create: `packages/lxm-editor/src/layout/measure-spacing.ts`
  - 负责把 beats 聚合为 rhythmic columns，并根据视觉贡献分配列宽。
- Create: `packages/lxm-editor/tests/layout/measure-spacing.test.ts`
  - 覆盖不同时值列宽、小节宽度自适应、未来扩展 contributor。
- Create: `packages/lxm-editor/src/layout/measure-layout.ts`
  - 负责单个小节的弦线、beat、note 坐标计算。
- Modify: `packages/lxm-editor/src/layout/index.ts`
  - 对外导出 `buildLayout`、`layoutMeasure` 和 layout 类型。
- Create: `packages/lxm-editor/tests/layout/measure-layout.test.ts`
  - 覆盖弦线、音符 y 坐标、音符 x 与 beat slot 对齐。
- Create: `packages/lxm-editor/tests/layout/build-layout.test.ts`
  - 覆盖 `buildLayout(document)` 对 MVP 示例文档的整合输出。

## Design Rules

- `calculateRhythmTicks` 不参与视觉宽度决策，只输出音乐 tick。
- 视觉列宽由 `ILXMColumnWidthContributors` 统一扩展。
- 小节宽度先计算 `minWidth` 和 `idealWidth`，本轮直接使用 `idealWidth` 作为 assigned width。
- 所有 layout 结果使用绝对坐标，渲染层不重新理解乐谱结构。
- 所有函数和关键算法位置添加中文注释。
- 不做向下兼容，不接受旧字段或隐式迁移。

---

### Task 1: Rhythm Tick Utilities

**Files:**
- Create: `packages/lxm-editor/src/core/rhythm.ts`
- Create: `packages/lxm-editor/tests/core/rhythm.test.ts`
- Modify: `packages/lxm-editor/src/index.ts`

- [ ] **Step 1: Write the failing rhythm tests**

Create `packages/lxm-editor/tests/core/rhythm.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  calculateRhythmTicks,
  getMeasureCapacityTicks,
} from "../../src/core/rhythm";

describe("calculateRhythmTicks", () => {
  it("把基础时值换算为稳定 tick", () => {
    expect(calculateRhythmTicks({ base: "whole", dots: 0 })).toEqual({
      ok: true,
      ticks: 3840,
    });
    expect(calculateRhythmTicks({ base: "quarter", dots: 0 })).toEqual({
      ok: true,
      ticks: 960,
    });
    expect(calculateRhythmTicks({ base: "thirtySecond", dots: 0 })).toEqual({
      ok: true,
      ticks: 120,
    });
  });

  it("支持单附点和双附点 tick", () => {
    expect(calculateRhythmTicks({ base: "quarter", dots: 1 })).toEqual({
      ok: true,
      ticks: 1440,
    });
    expect(calculateRhythmTicks({ base: "quarter", dots: 2 })).toEqual({
      ok: true,
      ticks: 1680,
    });
  });

  it("拒绝当前 MVP 未支持的附点数量", () => {
    expect(calculateRhythmTicks({ base: "quarter", dots: 3 })).toEqual({
      ok: false,
      code: "UNSUPPORTED_DOTS",
    });
  });
});

describe("getMeasureCapacityTicks", () => {
  it("根据拍号计算小节容量", () => {
    expect(getMeasureCapacityTicks({ numerator: 4, denominator: 4 })).toBe(3840);
    expect(getMeasureCapacityTicks({ numerator: 3, denominator: 4 })).toBe(2880);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
./node_modules/.bin/vitest run tests/core/rhythm.test.ts
```

Expected: FAIL because `../../src/core/rhythm` does not exist.

- [ ] **Step 3: Implement rhythm utilities**

Create `packages/lxm-editor/src/core/rhythm.ts`:

```ts
import { TICKS_PER_QUARTER } from "./constants";
import type { ILXMRhythm, ILXMTimeSignature } from "./types";

export const BASE_RHYTHM_TICKS = {
  whole: TICKS_PER_QUARTER * 4,
  half: TICKS_PER_QUARTER * 2,
  quarter: TICKS_PER_QUARTER,
  eighth: TICKS_PER_QUARTER / 2,
  sixteenth: TICKS_PER_QUARTER / 4,
  thirtySecond: TICKS_PER_QUARTER / 8,
} as const;

const DOTTED_RHYTHM_MULTIPLIERS = {
  0: { numerator: 1, denominator: 1 },
  1: { numerator: 3, denominator: 2 },
  2: { numerator: 7, denominator: 4 },
} as const;

export type RhythmTickResult =
  | { ok: true; ticks: number }
  | { ok: false; code: "UNSUPPORTED_DOTS" | "NON_INTEGER_RHYTHM_TICKS" };

/** 只计算音乐时间轴 tick，不参与任何视觉宽度决策。 */
export const calculateRhythmTicks = (rhythm: ILXMRhythm): RhythmTickResult => {
  const dottedMultiplier =
    DOTTED_RHYTHM_MULTIPLIERS[
      rhythm.dots as keyof typeof DOTTED_RHYTHM_MULTIPLIERS
    ];

  if (!dottedMultiplier) {
    return { ok: false, code: "UNSUPPORTED_DOTS" };
  }

  const numerator =
    BASE_RHYTHM_TICKS[rhythm.base] * dottedMultiplier.numerator;
  const denominator = dottedMultiplier.denominator;

  if (numerator % denominator !== 0) {
    return { ok: false, code: "NON_INTEGER_RHYTHM_TICKS" };
  }

  return { ok: true, ticks: numerator / denominator };
};

/** 根据拍号计算完整小节容量，4/4 等于 3840 tick。 */
export const getMeasureCapacityTicks = (
  timeSignature: ILXMTimeSignature,
): number =>
  (TICKS_PER_QUARTER * 4 * timeSignature.numerator) /
  timeSignature.denominator;
```

Modify `packages/lxm-editor/src/index.ts`:

```ts
export * from './layout'
export * from './core/constants'
export * from './core/loader'
export * from './core/rhythm'
export * from './core/schema'
export * from './core/types'

export * as EXAMPLE from '../example'
```

- [ ] **Step 4: Run rhythm tests**

Run:

```bash
./node_modules/.bin/vitest run tests/core/rhythm.test.ts
```

Expected: PASS, 3 tests for `calculateRhythmTicks`, 1 test for `getMeasureCapacityTicks`.

---

### Task 2: Layout Types and Constants

**Files:**
- Create: `packages/lxm-editor/src/layout/layout-constants.ts`
- Modify: `packages/lxm-editor/src/layout/layout-types.ts`

- [ ] **Step 1: Replace layout type declarations**

Modify `packages/lxm-editor/src/layout/layout-types.ts`:

```ts
import type { ILXMBeat, ILXMRhythm, ILXMTrack } from "../core/types";

/** buildLayout 的可选配置，MVP 保持纯计算，不读取 DOM。 */
export interface ILXMLayoutOptions {
  x?: number;
  y?: number;
  measureGap?: number;
  widthContributors?: ILXMColumnWidthContributors;
}

/** 基础矩形边界，未来 hit-test 可以直接复用。 */
export interface ILXMBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 后续歌词、简谱、和弦等内容通过 beatId 贡献额外列宽。 */
export interface ILXMColumnWidthContributors {
  lyricWidthByBeatId?: Record<string, number>;
  numberedNotationWidthByBeatId?: Record<string, number>;
  chordSymbolWidthByBeatId?: Record<string, number>;
}

/** 小节内部节奏列，是 TAB、歌词、简谱未来共享的横向对齐单位。 */
export interface ILXMRhythmicColumn {
  tick: number;
  beatIds: string[];
  rhythmTicks: number;
  durationWeight: number;
  minWidth: number;
  idealWidth: number;
}

/** beat slot 是一个真实 beat 在小节中的最终水平位置。 */
export interface ILXMBeatLayout {
  id: string;
  measureId: string;
  tick: number;
  x: number;
  width: number;
  rhythm: ILXMRhythm;
  columnIndex: number;
}

/** 单根弦线布局结果。 */
export interface ILXMStringLineLayout {
  index: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** 音符布局结果，fretText 供渲染层直接显示。 */
export interface ILXMNoteLayout {
  id: string;
  beatId: string;
  measureId: string;
  string: number;
  fret: number;
  fretText: string;
  x: number;
  y: number;
}

/** 小节布局结果，包含弦线、beat slot 和音符坐标。 */
export interface ILXMMeasureLayout {
  id: string;
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  bounds: ILXMBounds;
  columns: ILXMRhythmicColumn[];
  beats: ILXMBeatLayout[];
  strings: ILXMStringLineLayout[];
  notes: ILXMNoteLayout[];
}

/** 整体布局结果，MVP 暂时只处理一个 track。 */
export interface ILXMLayout {
  trackId: ILXMTrack["id"];
  x: number;
  y: number;
  width: number;
  height: number;
  measures: ILXMMeasureLayout[];
}

export type ILXMBeatWidthResolver = (beat: ILXMBeat) => number;
```

- [ ] **Step 2: Add layout constants**

Create `packages/lxm-editor/src/layout/layout-constants.ts`:

```ts
import { GUITAR_STRING_COUNT } from "../core/constants";

/** MVP 小节布局常量集中放置，避免魔法数字散落在算法中。 */
export const LXM_LAYOUT_DEFAULT_X = 0;
export const LXM_LAYOUT_DEFAULT_Y = 0;
export const LXM_MEASURE_GAP = 12;
export const LXM_MEASURE_PADDING_X = 18;
export const LXM_MEASURE_MIN_WIDTH = 112;
export const LXM_MEASURE_HEIGHT = 96;
export const LXM_STAFF_TOP = 28;
export const LXM_STRING_SPACING = 12;
export const LXM_STAFF_HEIGHT = LXM_STRING_SPACING * (GUITAR_STRING_COUNT - 1);

/** 不同时值的视觉权重只影响横向距离，不改变音乐 tick。 */
export const LXM_DURATION_VISUAL_WEIGHT = {
  whole: 4,
  half: 3,
  quarter: 2.2,
  eighth: 1.45,
  sixteenth: 1,
  thirtySecond: 0.72,
} as const;

/** 每种时值最低列宽，保证短时值仍可读。 */
export const LXM_DURATION_MIN_COLUMN_WIDTH = {
  whole: 54,
  half: 44,
  quarter: 34,
  eighth: 24,
  sixteenth: 17,
  thirtySecond: 12,
} as const;
```

- [ ] **Step 3: Run type check**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.json --noEmit
```

Expected: PASS.

---

### Task 3: Measure Spacing and Extensible Width Contributors

**Files:**
- Create: `packages/lxm-editor/src/layout/measure-spacing.ts`
- Create: `packages/lxm-editor/tests/layout/measure-spacing.test.ts`

- [ ] **Step 1: Write failing spacing tests**

Create `packages/lxm-editor/tests/layout/measure-spacing.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { layoutMeasureSpacing, summarizeMeasureSpacingWidth } from "../../src/layout/measure-spacing";
import type { ILXMMeasure } from "../../src/core/types";

const createMeasure = (beats: ILXMMeasure["beats"]): ILXMMeasure => ({
  id: "measure-test",
  timeSignature: { numerator: 4, denominator: 4 },
  barline: "single",
  chordSymbols: [],
  beats,
});

describe("measure spacing", () => {
  it("长时值列的 idealWidth 大于短时值列", () => {
    const measure = createMeasure([
      {
        id: "beat-quarter",
        tick: 0,
        rhythm: { base: "quarter", dots: 0 },
        kind: "notes",
        notes: [{ id: "note-1", string: 1, fret: 0 }],
      },
      {
        id: "beat-sixteenth",
        tick: 960,
        rhythm: { base: "sixteenth", dots: 0 },
        kind: "notes",
        notes: [{ id: "note-2", string: 2, fret: 3 }],
      },
    ]);

    const summary = summarizeMeasureSpacingWidth(measure);

    expect(summary.columns[0]!.idealWidth).toBeGreaterThan(
      summary.columns[1]!.idealWidth,
    );
  });

  it("外部视觉贡献可以撑开对应 beat 列宽", () => {
    const measure = createMeasure([
      {
        id: "beat-lyric",
        tick: 0,
        rhythm: { base: "sixteenth", dots: 0 },
        kind: "notes",
        notes: [{ id: "note-1", string: 1, fret: 0 }],
      },
    ]);

    const spacing = layoutMeasureSpacing(measure, {
      x: 0,
      assignedWidth: 160,
      widthContributors: {
        lyricWidthByBeatId: { "beat-lyric": 120 },
      },
    });

    expect(spacing.columns[0]!.minWidth).toBe(120);
    expect(spacing.slotsByBeatId["beat-lyric"]!.width).toBeGreaterThanOrEqual(120);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
./node_modules/.bin/vitest run tests/layout/measure-spacing.test.ts
```

Expected: FAIL because `measure-spacing.ts` does not exist.

- [ ] **Step 3: Implement measure spacing**

Create `packages/lxm-editor/src/layout/measure-spacing.ts`:

```ts
import { calculateRhythmTicks } from "../core/rhythm";
import type { ILXMBeat, ILXMMeasure } from "../core/types";
import {
  LXM_DURATION_MIN_COLUMN_WIDTH,
  LXM_DURATION_VISUAL_WEIGHT,
  LXM_MEASURE_MIN_WIDTH,
  LXM_MEASURE_PADDING_X,
} from "./layout-constants";
import type {
  ILXMBeatLayout,
  ILXMColumnWidthContributors,
  ILXMRhythmicColumn,
} from "./layout-types";

export interface ILXMMeasureSpacingSummary {
  measureId: string;
  minWidth: number;
  idealWidth: number;
  assignedWidth: number;
  columns: ILXMRhythmicColumn[];
  slotsByBeatId: Record<string, ILXMBeatLayout>;
}

const getContributorWidth = (
  beatId: string,
  contributors?: ILXMColumnWidthContributors,
): number =>
  Math.max(
    contributors?.lyricWidthByBeatId?.[beatId] ?? 0,
    contributors?.numberedNotationWidthByBeatId?.[beatId] ?? 0,
    contributors?.chordSymbolWidthByBeatId?.[beatId] ?? 0,
  );

const getBeatRhythmTicks = (beat: ILXMBeat): number => {
  const result = calculateRhythmTicks(beat.rhythm);
  return result.ok ? result.ticks : 0;
};

/** 构建节奏列；同一 tick 的 TAB、歌词、简谱未来会共享这一列。 */
export const buildRhythmicColumns = (
  measure: ILXMMeasure,
  contributors?: ILXMColumnWidthContributors,
): ILXMRhythmicColumn[] => {
  const beatsByTick = new Map<number, ILXMBeat[]>();

  for (const beat of measure.beats) {
    const beats = beatsByTick.get(beat.tick) ?? [];
    beats.push(beat);
    beatsByTick.set(beat.tick, beats);
  }

  return [...beatsByTick.entries()]
    .sort(([leftTick], [rightTick]) => leftTick - rightTick)
    .map(([tick, beats]) => {
      const rhythmTicks = Math.max(...beats.map(getBeatRhythmTicks));
      const durationWeight = Math.max(
        ...beats.map((beat) => LXM_DURATION_VISUAL_WEIGHT[beat.rhythm.base]),
      );
      const minWidth = Math.max(
        ...beats.map((beat) =>
          Math.max(
            LXM_DURATION_MIN_COLUMN_WIDTH[beat.rhythm.base],
            getContributorWidth(beat.id, contributors),
          ),
        ),
      );

      return {
        tick,
        beatIds: beats.map((beat) => beat.id),
        rhythmTicks,
        durationWeight,
        minWidth,
        idealWidth: Math.max(minWidth, minWidth * durationWeight),
      };
    });
};

export const summarizeMeasureSpacingWidth = (
  measure: ILXMMeasure,
  contributors?: ILXMColumnWidthContributors,
): Omit<ILXMMeasureSpacingSummary, "assignedWidth" | "slotsByBeatId"> => {
  const columns = buildRhythmicColumns(measure, contributors);
  const columnsMinWidth = columns.reduce(
    (total, column) => total + column.minWidth,
    0,
  );
  const columnsIdealWidth = columns.reduce(
    (total, column) => total + column.idealWidth,
    0,
  );
  const minWidth = Math.max(
    LXM_MEASURE_MIN_WIDTH,
    columnsMinWidth + LXM_MEASURE_PADDING_X * 2,
  );
  const idealWidth = Math.max(
    minWidth,
    columnsIdealWidth + LXM_MEASURE_PADDING_X * 2,
  );

  return {
    measureId: measure.id,
    minWidth,
    idealWidth,
    columns,
  };
};

/** 将节奏列转换成 beat slot，assignedWidth 本轮默认取小节 idealWidth。 */
export const layoutMeasureSpacing = (
  measure: ILXMMeasure,
  context: {
    x: number;
    assignedWidth?: number;
    widthContributors?: ILXMColumnWidthContributors;
  },
): ILXMMeasureSpacingSummary => {
  const summary = summarizeMeasureSpacingWidth(measure, context.widthContributors);
  const assignedWidth = Math.max(
    context.assignedWidth ?? summary.idealWidth,
    summary.minWidth,
  );
  const availableWidth = Math.max(0, assignedWidth - LXM_MEASURE_PADDING_X * 2);
  const totalIdealWidth = summary.columns.reduce(
    (total, column) => total + column.idealWidth,
    0,
  );
  const scale = totalIdealWidth > 0 ? availableWidth / totalIdealWidth : 1;
  const slotsByBeatId: Record<string, ILXMBeatLayout> = {};
  let cursorX = context.x + LXM_MEASURE_PADDING_X;

  summary.columns.forEach((column, columnIndex) => {
    const width = Math.max(column.minWidth, column.idealWidth * scale);

    for (const beatId of column.beatIds) {
      const beat = measure.beats.find((item) => item.id === beatId);
      if (!beat) continue;

      slotsByBeatId[beatId] = {
        id: beatId,
        measureId: measure.id,
        tick: column.tick,
        x: cursorX,
        width,
        rhythm: beat.rhythm,
        columnIndex,
      };
    }

    cursorX += width;
  });

  return {
    ...summary,
    assignedWidth,
    slotsByBeatId,
  };
};
```

- [ ] **Step 4: Run spacing tests**

Run:

```bash
./node_modules/.bin/vitest run tests/layout/measure-spacing.test.ts
```

Expected: PASS.

---

### Task 4: Single Measure Layout

**Files:**
- Create: `packages/lxm-editor/src/layout/measure-layout.ts`
- Create: `packages/lxm-editor/tests/layout/measure-layout.test.ts`

- [ ] **Step 1: Write failing measure layout tests**

Create `packages/lxm-editor/tests/layout/measure-layout.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { layoutMeasure } from "../../src/layout/measure-layout";
import type { ILXMMeasure } from "../../src/core/types";

const measure: ILXMMeasure = {
  id: "measure-001",
  timeSignature: { numerator: 4, denominator: 4 },
  barline: "single",
  chordSymbols: [],
  beats: [
    {
      id: "beat-001",
      tick: 0,
      rhythm: { base: "quarter", dots: 0 },
      kind: "notes",
      notes: [{ id: "note-001", string: 1, fret: 0 }],
    },
    {
      id: "beat-002",
      tick: 960,
      rhythm: { base: "quarter", dots: 0 },
      kind: "notes",
      notes: [{ id: "note-002", string: 6, fret: 3 }],
    },
  ],
};

describe("layoutMeasure", () => {
  it("输出六根弦线", () => {
    const result = layoutMeasure(measure, { index: 0, x: 10, y: 20 });

    expect(result.strings).toHaveLength(6);
    expect(result.strings[0]!.x1).toBe(10);
    expect(result.strings[0]!.x2).toBe(result.width + 10);
  });

  it("音符 y 坐标随 string 增大向下排列", () => {
    const result = layoutMeasure(measure, { index: 0, x: 0, y: 0 });
    const firstStringNote = result.notes.find((note) => note.id === "note-001")!;
    const sixthStringNote = result.notes.find((note) => note.id === "note-002")!;

    expect(sixthStringNote.y).toBeGreaterThan(firstStringNote.y);
  });

  it("音符 x 坐标与所属 beat slot 对齐", () => {
    const result = layoutMeasure(measure, { index: 0, x: 0, y: 0 });
    const beat = result.beats.find((item) => item.id === "beat-001")!;
    const note = result.notes.find((item) => item.id === "note-001")!;

    expect(note.x).toBe(beat.x);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
./node_modules/.bin/vitest run tests/layout/measure-layout.test.ts
```

Expected: FAIL because `measure-layout.ts` does not exist.

- [ ] **Step 3: Implement single measure layout**

Create `packages/lxm-editor/src/layout/measure-layout.ts`:

```ts
import { GUITAR_STRING_COUNT } from "../core/constants";
import type { ILXMMeasure } from "../core/types";
import {
  LXM_MEASURE_HEIGHT,
  LXM_STAFF_TOP,
  LXM_STRING_SPACING,
} from "./layout-constants";
import { layoutMeasureSpacing } from "./measure-spacing";
import type {
  ILXMColumnWidthContributors,
  ILXMMeasureLayout,
  ILXMNoteLayout,
  ILXMStringLineLayout,
} from "./layout-types";

export interface ILXMLayoutMeasureContext {
  index: number;
  x: number;
  y: number;
  assignedWidth?: number;
  widthContributors?: ILXMColumnWidthContributors;
}

const getStringY = (measureY: number, stringIndex: number): number =>
  measureY + LXM_STAFF_TOP + (stringIndex - 1) * LXM_STRING_SPACING;

const buildStringLines = (
  context: { x: number; y: number; width: number },
): ILXMStringLineLayout[] =>
  Array.from({ length: GUITAR_STRING_COUNT }, (_, index) => {
    const stringIndex = index + 1;
    const y = getStringY(context.y, stringIndex);

    return {
      index: stringIndex,
      x1: context.x,
      y1: y,
      x2: context.x + context.width,
      y2: y,
    };
  });

/** 根据 beat slot 和弦号生成音符绝对坐标。 */
const layoutNotes = (
  measure: ILXMMeasure,
  slotsByBeatId: ReturnType<typeof layoutMeasureSpacing>["slotsByBeatId"],
  measureY: number,
): ILXMNoteLayout[] =>
  measure.beats.flatMap((beat) => {
    const slot = slotsByBeatId[beat.id];
    if (!slot) return [];

    return beat.notes.map((note) => ({
      id: note.id,
      beatId: beat.id,
      measureId: measure.id,
      string: note.string,
      fret: note.fret,
      fretText: String(note.fret),
      x: slot.x,
      y: getStringY(measureY, note.string),
    }));
  });

/** 布局单个小节，渲染层只需要消费返回的坐标。 */
export const layoutMeasure = (
  measure: ILXMMeasure,
  context: ILXMLayoutMeasureContext,
): ILXMMeasureLayout => {
  const spacing = layoutMeasureSpacing(measure, {
    x: context.x,
    assignedWidth: context.assignedWidth,
    widthContributors: context.widthContributors,
  });
  const width = spacing.assignedWidth;
  const strings = buildStringLines({ x: context.x, y: context.y, width });
  const notes = layoutNotes(measure, spacing.slotsByBeatId, context.y);

  return {
    id: measure.id,
    index: context.index,
    x: context.x,
    y: context.y,
    width,
    height: LXM_MEASURE_HEIGHT,
    bounds: {
      x: context.x,
      y: context.y,
      width,
      height: LXM_MEASURE_HEIGHT,
    },
    columns: spacing.columns,
    beats: Object.values(spacing.slotsByBeatId),
    strings,
    notes,
  };
};
```

- [ ] **Step 4: Run measure layout tests**

Run:

```bash
./node_modules/.bin/vitest run tests/layout/measure-layout.test.ts
```

Expected: PASS.

---

### Task 5: Build Whole MVP Layout

**Files:**
- Modify: `packages/lxm-editor/src/layout/index.ts`
- Create: `packages/lxm-editor/tests/layout/build-layout.test.ts`

- [ ] **Step 1: Write failing build layout test**

Create `packages/lxm-editor/tests/layout/build-layout.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import * as exampleMvp1Module from "../../example/example-mvp1.json";
import { buildLayout } from "../../src/layout";

const EXAMPLE_MVP_1 = exampleMvp1Module.default;

describe("buildLayout", () => {
  it("基于 MVP 示例输出第一条轨道的小节布局", () => {
    const layout = buildLayout(EXAMPLE_MVP_1);

    expect(layout.trackId).toBe("track-guitar-001");
    expect(layout.measures).toHaveLength(1);
    expect(layout.measures[0]!.strings).toHaveLength(6);
    expect(layout.measures[0]!.notes).toHaveLength(1);
  });

  it("多个小节会按自适应宽度横向排列", () => {
    const document = structuredClone(EXAMPLE_MVP_1);
    const firstMeasure = document.score.tracks[0]!.measures[0]!;
    document.score.tracks[0]!.measures = [
      firstMeasure,
      {
        ...firstMeasure,
        id: "measure-002",
        beats: [
          ...firstMeasure.beats,
          {
            id: "beat-002",
            tick: 480,
            rhythm: { base: "sixteenth", dots: 0 },
            kind: "notes",
            notes: [{ id: "note-002", string: 2, fret: 3 }],
          },
        ],
      },
    ];

    const layout = buildLayout(document);

    expect(layout.measures[1]!.x).toBeGreaterThan(layout.measures[0]!.x);
    expect(layout.measures[1]!.width).toBeGreaterThanOrEqual(
      layout.measures[0]!.width,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
./node_modules/.bin/vitest run tests/layout/build-layout.test.ts
```

Expected: FAIL because current `buildLayout` returns `undefined`.

- [ ] **Step 3: Implement buildLayout and exports**

Modify `packages/lxm-editor/src/layout/index.ts`:

```ts
import type { ILXMDocument } from "../core/types";
import {
  LXM_LAYOUT_DEFAULT_X,
  LXM_LAYOUT_DEFAULT_Y,
  LXM_MEASURE_GAP,
} from "./layout-constants";
import { layoutMeasure } from "./measure-layout";
import type { ILXMLayout, ILXMLayoutOptions } from "./layout-types";

export * from "./layout-constants";
export * from "./layout-types";
export * from "./measure-layout";
export * from "./measure-spacing";

/** 构建 MVP 版本整谱 layout；当前只取第一条轨道。 */
export const buildLayout = (
  document: ILXMDocument,
  options: ILXMLayoutOptions = {},
): ILXMLayout => {
  const track = document.score.tracks[0];
  const startX = options.x ?? LXM_LAYOUT_DEFAULT_X;
  const startY = options.y ?? LXM_LAYOUT_DEFAULT_Y;
  const measureGap = options.measureGap ?? LXM_MEASURE_GAP;

  if (!track) {
    return {
      trackId: "",
      x: startX,
      y: startY,
      width: 0,
      height: 0,
      measures: [],
    };
  }

  let cursorX = startX;
  const measures = track.measures.map((measure, index) => {
    const laidOutMeasure = layoutMeasure(measure, {
      index,
      x: cursorX,
      y: startY,
      widthContributors: options.widthContributors,
    });

    cursorX += laidOutMeasure.width + measureGap;
    return laidOutMeasure;
  });
  const width =
    measures.length > 0 ? cursorX - startX - measureGap : 0;
  const height = measures.reduce(
    (maxHeight, measure) => Math.max(maxHeight, measure.y + measure.height - startY),
    0,
  );

  return {
    trackId: track.id,
    x: startX,
    y: startY,
    width,
    height,
    measures,
  };
};
```

- [ ] **Step 4: Run build layout test**

Run:

```bash
./node_modules/.bin/vitest run tests/layout/build-layout.test.ts
```

Expected: PASS.

---

### Task 6: Full Verification and Cleanup

**Files:**
- Verify: `packages/lxm-editor/src/core/rhythm.ts`
- Verify: `packages/lxm-editor/src/layout/*.ts`
- Verify: `packages/lxm-editor/tests/core/rhythm.test.ts`
- Verify: `packages/lxm-editor/tests/layout/*.test.ts`

- [ ] **Step 1: Run all lxm-editor tests**

Run from `packages/lxm-editor`:

```bash
./node_modules/.bin/vitest run
```

Expected: PASS for loader, rhythm, measure-spacing, measure-layout, build-layout tests.

- [ ] **Step 2: Run TypeScript check**

Run from `packages/lxm-editor`:

```bash
./node_modules/.bin/tsc -p tsconfig.json --noEmit
```

Expected: PASS.

- [ ] **Step 3: Run lint**

Run from `packages/lxm-editor`:

```bash
./node_modules/.bin/eslint src tests --max-warnings=0
```

Expected: PASS.

- [ ] **Step 4: Confirm build config status**

Run from `packages/lxm-editor`:

```bash
./node_modules/.bin/tsc -p tsconfig.build.json
```

Expected: If `src/index.ts` still exports `../example`, this command fails with `TS6059` because `example/` is outside `rootDir: src`. Record this as an existing packaging boundary issue unless the implementation also moves examples under `src` or removes example export from the build entry.

## Self-Review

- Spec coverage: The plan covers小节渲染、六根弦、音符坐标、自适应小节宽度、不同时值宽度计算、未来歌词/简谱宽度扩展。
- Placeholder scan: The plan contains no unfinished marker text or deferred implementation notes.
- Type consistency: All public names use `ILXM*` prefix and match existing `types.ts` naming. `calculateRhythmTicks` consumes `ILXMRhythm`; layout consumes `ILXMDocument` / `ILXMMeasure`.
- Scope guard: Automatic line wrapping, rest rendering, beaming, lyrics, numbered notation and hit-test are intentionally outside this MVP.
