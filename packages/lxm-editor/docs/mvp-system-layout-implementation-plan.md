# MVP System Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 MVP 小节布局方案上增加 system 行布局能力，让多小节六线谱可以根据可用宽度自动换行。

**Architecture:** 新增 `system` 层作为整谱 layout 和小节 layout 之间的中间层：`ILXMLayout -> ILXMSystemLayout[] -> ILXMMeasureLayout[]`。小节自身仍由 `layoutMeasure` 负责，system 层只负责换行、行内 x 分配、行 y 分配和整体高度汇总。

**Tech Stack:** TypeScript、Vitest、现有 `ILXM*` 类型、纯函数布局算法，不引入新的第三方库。

---

## Scope

本轮只扩展多行六线谱布局：

- 支持按 `availableWidth` 自动把 measures 拆成多个 systems。
- 支持 `systemGap` 控制行与行之间的距离。
- 支持每个 system 内部复用现有 `layoutMeasure`。
- 支持 `layout.height` 根据所有 systems 的实际高度计算。
- 保持 MVP 只处理第一条 track。

本轮不做：

- 分散对齐、两端对齐或复杂小节宽度压缩。
- 行头 TAB 标识、拍号重复显示。
- 跨行连线。
- 虚拟滚动。
- 多轨道同步 system。

## File Structure

- Modify: `packages/lxm-editor/src/layout/layout-types.ts`
  - 增加 `ILXMSystemLayout`，把 `ILXMLayout.measures` 改成 `ILXMLayout.systems`。
- Modify: `packages/lxm-editor/src/layout/layout-constants.ts`
  - 增加 `LXM_LAYOUT_DEFAULT_WIDTH` 和 `LXM_SYSTEM_GAP`。
- Create: `packages/lxm-editor/src/layout/system-breaking.ts`
  - 只负责根据小节宽度摘要和可用行宽计算每一行包含哪些小节。
- Create: `packages/lxm-editor/src/layout/system-layout.ts`
  - 负责把一行小节布局成一个 `ILXMSystemLayout`。
- Modify: `packages/lxm-editor/src/layout/index.ts`
  - `buildLayout` 改为先换行，再逐 system 布局。
- Create: `packages/lxm-editor/tests/layout/system-breaking.test.ts`
  - 覆盖按宽度换行、单个超宽小节独占一行。
- Create: `packages/lxm-editor/tests/layout/system-layout.test.ts`
  - 覆盖 system 内小节横向排列和 system 高度计算。
- Modify: `packages/lxm-editor/tests/layout/build-layout.test.ts`
  - 从断言 `layout.measures` 改为断言 `layout.systems`。

## Design Rules

- 小节宽度仍由 `measure-spacing.ts` 计算，system 不重新理解 beat、column 或 note。
- system breaking 使用小节 `idealWidth` 做换行依据，先不做压缩和拉伸。
- `ILXMLayout.height` 是所有 systems 排完后的实际内容高度，不是输入约束。
- `ILXMMeasureLayout.height` 是单小节实际内容高度，未来歌词/简谱可继续撑开。
- `ILXMSystemLayout.height` 等于该行内所有小节高度最大值。

---

### Task 1: Extend Layout Types and Constants

**Files:**
- Modify: `packages/lxm-editor/src/layout/layout-types.ts`
- Modify: `packages/lxm-editor/src/layout/layout-constants.ts`

- [ ] **Step 1: Update layout type declarations**

Modify `packages/lxm-editor/src/layout/layout-types.ts`:

```ts
import type { ILXMBeat, ILXMRhythm, ILXMTrack } from "../core/types";

/** buildLayout 的可选配置，MVP 保持纯计算，不读取 DOM。 */
export interface ILXMLayoutOptions {
  x?: number;
  y?: number;
  width?: number;
  measureGap?: number;
  systemGap?: number;
  widthContributors?: ILXMColumnWidthContributors;
}

/** 可复用的矩形形状；命中检测可直接接收满足该结构的 layout item。 */
export interface ILXMLayoutRectLike {
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

/** 小节布局结果，x/y/width/height 表示小节实际占用区域。 */
export interface ILXMMeasureLayout extends ILXMLayoutRectLike {
  id: string;
  index: number;
  columns: ILXMRhythmicColumn[];
  beats: ILXMBeatLayout[];
  strings: ILXMStringLineLayout[];
  notes: ILXMNoteLayout[];
}

/** 一行六线谱布局结果；system 负责承载同一行内的多个小节。 */
export interface ILXMSystemLayout extends ILXMLayoutRectLike {
  id: string;
  index: number;
  startMeasureIndex: number;
  endMeasureIndex: number;
  measures: ILXMMeasureLayout[];
}

/** 整体布局结果，height 表示所有 systems 排版后的实际内容高度。 */
export interface ILXMLayout extends ILXMLayoutRectLike {
  trackId: ILXMTrack["id"];
  systems: ILXMSystemLayout[];
}
```

- [ ] **Step 2: Update layout constants**

Modify `packages/lxm-editor/src/layout/layout-constants.ts`:

```ts
import { GUITAR_STRING_COUNT } from "../core/constants";

/** MVP 小节布局常量集中放置，避免魔法数字散落在算法中。 */
export const LXM_LAYOUT_DEFAULT_X = 0;
export const LXM_LAYOUT_DEFAULT_Y = 0;
export const LXM_LAYOUT_DEFAULT_WIDTH = 960;
export const LXM_MEASURE_GAP = 12;
export const LXM_SYSTEM_GAP = 32;
export const LXM_MEASURE_PADDING_X = 18;
export const LXM_MEASURE_MIN_WIDTH = 112;
export const LXM_MEASURE_PADDING_BOTTOM = 16;
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

/** 当前 MVP 的小节高度由六线谱区域和底部留白计算得出。 */
export const calculateMvpMeasureHeight = (): number =>
  LXM_STAFF_TOP + LXM_STAFF_HEIGHT + LXM_MEASURE_PADDING_BOTTOM;
```

- [ ] **Step 3: Run type check**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.json --noEmit
```

Expected: PASS.

---

### Task 2: System Breaking

**Files:**
- Create: `packages/lxm-editor/src/layout/system-breaking.ts`
- Create: `packages/lxm-editor/tests/layout/system-breaking.test.ts`

- [ ] **Step 1: Write failing system breaking tests**

Create `packages/lxm-editor/tests/layout/system-breaking.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { breakMeasuresIntoSystems } from "../../src/layout/system-breaking";

describe("breakMeasuresIntoSystems", () => {
  it("按可用宽度把小节拆成多行 system", () => {
    const result = breakMeasuresIntoSystems(
      [
        { measureId: "m1", idealWidth: 120, minWidth: 100 },
        { measureId: "m2", idealWidth: 120, minWidth: 100 },
        { measureId: "m3", idealWidth: 120, minWidth: 100 },
      ],
      { availableWidth: 260, measureGap: 12 },
    );

    expect(result).toEqual([
      { index: 0, startMeasureIndex: 0, endMeasureIndex: 2 },
      { index: 1, startMeasureIndex: 2, endMeasureIndex: 3 },
    ]);
  });

  it("单个超宽小节可以独占一行", () => {
    const result = breakMeasuresIntoSystems(
      [
        { measureId: "wide", idealWidth: 400, minWidth: 320 },
        { measureId: "normal", idealWidth: 120, minWidth: 100 },
      ],
      { availableWidth: 260, measureGap: 12 },
    );

    expect(result).toEqual([
      { index: 0, startMeasureIndex: 0, endMeasureIndex: 1 },
      { index: 1, startMeasureIndex: 1, endMeasureIndex: 2 },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
./node_modules/.bin/vitest run tests/layout/system-breaking.test.ts
```

Expected: FAIL because `system-breaking.ts` does not exist.

- [ ] **Step 3: Implement system breaking**

Create `packages/lxm-editor/src/layout/system-breaking.ts`:

```ts
export interface ILXMMeasureBreakSummary {
  measureId: string;
  minWidth: number;
  idealWidth: number;
}

export interface ILXMSystemBreak {
  index: number;
  startMeasureIndex: number;
  endMeasureIndex: number;
}

export interface ILXMSystemBreakContext {
  availableWidth: number;
  measureGap: number;
}

const getNextWidth = (
  currentMeasureCount: number,
  measureWidth: number,
  measureGap: number,
): number =>
  currentMeasureCount > 0 ? measureGap + measureWidth : measureWidth;

/** 按小节理想宽度拆分 system；本函数只决定分行，不计算坐标。 */
export const breakMeasuresIntoSystems = (
  summaries: ILXMMeasureBreakSummary[],
  context: ILXMSystemBreakContext,
): ILXMSystemBreak[] => {
  const systems: ILXMSystemBreak[] = [];
  let startMeasureIndex = 0;
  let currentWidth = 0;

  summaries.forEach((summary, measureIndex) => {
    const currentMeasureCount = measureIndex - startMeasureIndex;
    const nextWidth = getNextWidth(
      currentMeasureCount,
      summary.idealWidth,
      context.measureGap,
    );
    const shouldBreak =
      currentMeasureCount > 0 &&
      currentWidth + nextWidth > context.availableWidth;

    if (shouldBreak) {
      systems.push({
        index: systems.length,
        startMeasureIndex,
        endMeasureIndex: measureIndex,
      });
      startMeasureIndex = measureIndex;
      currentWidth = summary.idealWidth;
      return;
    }

    currentWidth += nextWidth;
  });

  if (startMeasureIndex < summaries.length) {
    systems.push({
      index: systems.length,
      startMeasureIndex,
      endMeasureIndex: summaries.length,
    });
  }

  return systems;
};
```

- [ ] **Step 4: Run system breaking tests**

Run:

```bash
./node_modules/.bin/vitest run tests/layout/system-breaking.test.ts
```

Expected: PASS.

---

### Task 3: System Layout

**Files:**
- Create: `packages/lxm-editor/src/layout/system-layout.ts`
- Create: `packages/lxm-editor/tests/layout/system-layout.test.ts`

- [ ] **Step 1: Write failing system layout tests**

Create `packages/lxm-editor/tests/layout/system-layout.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { layoutSystem } from "../../src/layout/system-layout";
import type { ILXMMeasure } from "../../src/core/types";

const createMeasure = (id: string): ILXMMeasure => ({
  id,
  timeSignature: { numerator: 4, denominator: 4 },
  barline: "single",
  chordSymbols: [],
  beats: [
    {
      id: `${id}-beat-1`,
      tick: 0,
      rhythm: { base: "quarter", dots: 0 },
      kind: "notes",
      notes: [{ id: `${id}-note-1`, string: 1, fret: 0 }],
    },
  ],
});

describe("layoutSystem", () => {
  it("把同一行内的小节按 x 横向排列", () => {
    const system = layoutSystem([createMeasure("m1"), createMeasure("m2")], {
      index: 0,
      x: 10,
      y: 20,
      startMeasureIndex: 0,
      measureGap: 12,
    });

    expect(system.measures).toHaveLength(2);
    expect(system.measures[1]!.x).toBeGreaterThan(system.measures[0]!.x);
  });

  it("system height 等于行内小节最大高度", () => {
    const system = layoutSystem([createMeasure("m1")], {
      index: 0,
      x: 0,
      y: 0,
      startMeasureIndex: 0,
      measureGap: 12,
    });

    expect(system.height).toBe(system.measures[0]!.height);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
./node_modules/.bin/vitest run tests/layout/system-layout.test.ts
```

Expected: FAIL because `system-layout.ts` does not exist.

- [ ] **Step 3: Implement system layout**

Create `packages/lxm-editor/src/layout/system-layout.ts`:

```ts
import type { ILXMMeasure } from "../core/types";
import { layoutMeasure } from "./measure-layout";
import type {
  ILXMColumnWidthContributors,
  ILXMSystemLayout,
} from "./layout-types";

export interface ILXMLayoutSystemContext {
  index: number;
  x: number;
  y: number;
  startMeasureIndex: number;
  measureGap: number;
  widthContributors?: ILXMColumnWidthContributors;
}

/** 布局一行 system；它只负责行内小节坐标，不重新计算分行。 */
export const layoutSystem = (
  measures: ILXMMeasure[],
  context: ILXMLayoutSystemContext,
): ILXMSystemLayout => {
  let cursorX = context.x;
  const laidOutMeasures = measures.map((measure, offset) => {
    const laidOutMeasure = layoutMeasure(measure, {
      index: context.startMeasureIndex + offset,
      x: cursorX,
      y: context.y,
      widthContributors: context.widthContributors,
    });

    cursorX += laidOutMeasure.width + context.measureGap;
    return laidOutMeasure;
  });
  const width =
    laidOutMeasures.length > 0 ? cursorX - context.x - context.measureGap : 0;
  const height = laidOutMeasures.reduce(
    (maxHeight, measure) => Math.max(maxHeight, measure.height),
    0,
  );

  return {
    id: `system-${context.index + 1}`,
    index: context.index,
    x: context.x,
    y: context.y,
    width,
    height,
    startMeasureIndex: context.startMeasureIndex,
    endMeasureIndex: context.startMeasureIndex + measures.length,
    measures: laidOutMeasures,
  };
};
```

- [ ] **Step 4: Run system layout tests**

Run:

```bash
./node_modules/.bin/vitest run tests/layout/system-layout.test.ts
```

Expected: PASS.

---

### Task 4: Build Layout With Systems

**Files:**
- Modify: `packages/lxm-editor/src/layout/index.ts`
- Modify: `packages/lxm-editor/tests/layout/build-layout.test.ts`

- [ ] **Step 1: Update failing build layout test**

Modify `packages/lxm-editor/tests/layout/build-layout.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import * as exampleMvp1Module from "../../example/example-mvp1.json";
import { buildLayout } from "../../src/layout";

const EXAMPLE_MVP_1 = exampleMvp1Module.default;

describe("buildLayout with systems", () => {
  it("基于 MVP 示例输出第一条轨道的 system 布局", () => {
    const layout = buildLayout(EXAMPLE_MVP_1);

    expect(layout.trackId).toBe("track-guitar-001");
    expect(layout.systems).toHaveLength(1);
    expect(layout.systems[0]!.measures).toHaveLength(1);
    expect(layout.systems[0]!.measures[0]!.strings).toHaveLength(6);
  });

  it("可用宽度不足时会自动拆成多行 system", () => {
    const document = structuredClone(EXAMPLE_MVP_1);
    const firstMeasure = document.score.tracks[0]!.measures[0]!;

    document.score.tracks[0]!.measures = Array.from({ length: 4 }, (_, index) => ({
      ...firstMeasure,
      id: `measure-${index + 1}`,
      beats: firstMeasure.beats.map((beat) => ({
        ...beat,
        id: `beat-${index + 1}`,
        notes: beat.notes.map((note) => ({
          ...note,
          id: `note-${index + 1}`,
        })),
      })),
    }));

    const layout = buildLayout(document, { width: 220 });

    expect(layout.systems.length).toBeGreaterThan(1);
    expect(layout.systems[1]!.y).toBeGreaterThan(layout.systems[0]!.y);
    expect(layout.height).toBeGreaterThan(layout.systems[0]!.height);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
./node_modules/.bin/vitest run tests/layout/build-layout.test.ts
```

Expected: FAIL because `buildLayout` still returns flat measures or is not implemented.

- [ ] **Step 3: Implement buildLayout with systems**

Modify `packages/lxm-editor/src/layout/index.ts`:

```ts
import type { ILXMDocument } from "../core/types";
import {
  LXM_LAYOUT_DEFAULT_WIDTH,
  LXM_LAYOUT_DEFAULT_X,
  LXM_LAYOUT_DEFAULT_Y,
  LXM_MEASURE_GAP,
  LXM_SYSTEM_GAP,
} from "./layout-constants";
import { summarizeMeasureSpacingWidth } from "./measure-spacing";
import { breakMeasuresIntoSystems } from "./system-breaking";
import { layoutSystem } from "./system-layout";
import type { ILXMLayout, ILXMLayoutOptions } from "./layout-types";

export * from "./layout-constants";
export * from "./layout-types";
export * from "./measure-layout";
export * from "./measure-spacing";
export * from "./system-breaking";
export * from "./system-layout";

/** 构建 MVP 版本整谱 layout；当前只取第一条轨道，并按 system 自动换行。 */
export const buildLayout = (
  document: ILXMDocument,
  options: ILXMLayoutOptions = {},
): ILXMLayout => {
  const track = document.score.tracks[0];
  const startX = options.x ?? LXM_LAYOUT_DEFAULT_X;
  const startY = options.y ?? LXM_LAYOUT_DEFAULT_Y;
  const width = options.width ?? LXM_LAYOUT_DEFAULT_WIDTH;
  const measureGap = options.measureGap ?? LXM_MEASURE_GAP;
  const systemGap = options.systemGap ?? LXM_SYSTEM_GAP;

  if (!track) {
    return {
      trackId: "",
      x: startX,
      y: startY,
      width,
      height: 0,
      systems: [],
    };
  }

  const measureSummaries = track.measures.map((measure) =>
    summarizeMeasureSpacingWidth(measure, options.widthContributors),
  );
  const systemBreaks = breakMeasuresIntoSystems(measureSummaries, {
    availableWidth: width,
    measureGap,
  });

  let cursorY = startY;
  const systems = systemBreaks.map((systemBreak) => {
    const systemMeasures = track.measures.slice(
      systemBreak.startMeasureIndex,
      systemBreak.endMeasureIndex,
    );
    const system = layoutSystem(systemMeasures, {
      index: systemBreak.index,
      x: startX,
      y: cursorY,
      startMeasureIndex: systemBreak.startMeasureIndex,
      measureGap,
      widthContributors: options.widthContributors,
    });

    cursorY += system.height + systemGap;
    return system;
  });
  const height =
    systems.length > 0 ? cursorY - startY - systemGap : 0;

  return {
    trackId: track.id,
    x: startX,
    y: startY,
    width,
    height,
    systems,
  };
};
```

- [ ] **Step 4: Run build layout tests**

Run:

```bash
./node_modules/.bin/vitest run tests/layout/build-layout.test.ts
```

Expected: PASS.

---

### Task 5: Verification

**Files:**
- Verify: `packages/lxm-editor/src/layout/*.ts`
- Verify: `packages/lxm-editor/tests/layout/*.test.ts`

- [ ] **Step 1: Run layout tests**

Run:

```bash
./node_modules/.bin/vitest run tests/layout
```

Expected: PASS for measure spacing, measure layout, system breaking, system layout and build layout tests.

- [ ] **Step 2: Run all package tests**

Run:

```bash
./node_modules/.bin/vitest run
```

Expected: PASS for all `packages/lxm-editor` tests.

- [ ] **Step 3: Run TypeScript check**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.json --noEmit
```

Expected: PASS.

- [ ] **Step 4: Run lint**

Run:

```bash
./node_modules/.bin/eslint src tests --max-warnings=0
```

Expected: PASS.

## Self-Review

- Spec coverage: The plan adds `system` type, system breaking, system layout, `buildLayout` integration, and tests for multi-line layout.
- Marker scan: The plan contains no deferred implementation markers.
- Type consistency: The data flow is `ILXMLayout -> ILXMSystemLayout[] -> ILXMMeasureLayout[]`; `ILXMLayout.measures` is intentionally replaced by `ILXMLayout.systems`.
- Scope guard: The plan does not include line header rendering, cross-system ties, virtual scrolling, or multi-track system synchronization.
