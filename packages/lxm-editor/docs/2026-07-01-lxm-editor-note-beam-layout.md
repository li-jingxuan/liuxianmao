# LXM Editor Note Beam Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `packages/lxm-editor` 中为八分、十六分、三十二分音符生成 beat 级别的时值符干与连梁 layout，供 SVG 渲染层直接消费。

**Architecture:** 不在 `core` 数据模型中新增连梁字段，MVP 阶段完全从 `beat.rhythm` 和现有 beat slot 自动推导连梁。新增 `duration-beam-layout.ts` 负责时值符干和连梁几何，`measure-layout.ts` 只负责把结果接入 `ILXMMeasureLayout`，渲染层只遍历 layout 结果，不重新计算节奏分组。

**Tech Stack:** TypeScript, Vitest, React, SVG

---

## Current Code Context

- `packages/lxm-editor/src/core/rhythm.ts` 已提供 `BASE_RHYTHM_TICKS` 与 `calculateRhythmTicks`，连梁实现只需要读取 `beat.rhythm.base`，不需要新增 core schema 字段。
- `packages/lxm-editor/src/layout/measure-spacing.ts` 已输出 `slotsByBeatId`，每个 beat slot 有 `x / width / rhythm / columnIndex`，可作为符干和连梁的横向锚点。
- `packages/lxm-editor/src/layout/measure-layout.ts` 当前生成 `strings / notes / barline`，连梁应在 `strings` 和 `beats` 都生成后接入。
- `packages/lxm-editor/src/layout/layout-types.ts` 当前没有 duration/beam 类型，需要新增 `durationMarks` 与 `beamSegments`。
- `apps/website/app/editor/EditorShell/index.tsx` 当前直接渲染 `strings / notes / barline`，可以作为连梁 SVG 消费验证路径，但连梁几何必须来自 `lxm-editor`。

## Beam Layout Rules

- `whole / half / quarter` 不生成连梁。
- `eighth` 生成 1 层 beam，`sixteenth` 生成 2 层 beam，`thirtySecond` 生成 3 层 beam。
- 连续、相邻、可连梁的 beat 自动组成一个 run；较长时值或缺失 slot 会打断 run。
- run 长度大于等于 2 时生成 shared beam。
- 高层级 beam 如果只有单个 beat 需要显示，则生成 partial beam，方向优先指向同一个 run 中最近的相邻 beat。
- 完全孤立的短时值 beat 暂不生成 partial beam；独立符尾能力后续单独实现。
- 附点不改变 beam level；附点只影响 tick 和 spacing，不改变基础时值的连梁层级。
- MVP 使用水平连梁，不做斜梁、不做跨小节连梁、不做人工分组。

## File Structure

- Modify: `packages/lxm-editor/src/layout/layout-constants.ts`  
  增加符干横向偏移、符干与音符间距、连梁区域顶部偏移、连梁厚度、层间距等视觉常量。
- Modify: `packages/lxm-editor/src/layout/layout-types.ts`  
  增加 `ILXMDurationMarkLayout`、`ILXMBeamSegmentLayout`，并挂到 `ILXMMeasureLayout`。
- Create: `packages/lxm-editor/src/layout/duration-beam-layout.ts`  
  只负责从 `ILXMMeasure.beats`、`ILXMBeatLayout[]`、`ILXMNoteLayout[]`、`ILXMStringLineLayout[]` 生成 duration marks 和 beam segments。
- Modify: `packages/lxm-editor/src/layout/measure-layout.ts`  
  在 strings/beats/notes 生成后调用 `layoutDurationBeams(...)`。
- Create: `packages/lxm-editor/tests/layout/duration-beam-layout.test.ts`  
  覆盖 beam level、shared beam 分组、partial beam、长时值打断、完全孤立短时值不生成 beam。
- Modify: `apps/website/app/editor/EditorShell/index.tsx`  
  仅作为人工验证入口，按 layout 结果渲染 stem 和 beam；不把计算逻辑写进 React。

---

### Task 1: Add Failing Layout Tests

**Files:**
- Create: `packages/lxm-editor/tests/layout/duration-beam-layout.test.ts`

**Interfaces:**
- Consumes: `layoutMeasure(measure, { index, x, y })`
- Produces: 失败测试，先锁定 `durationMarks` 与 `beamSegments` 的目标结构

- [ ] **Step 1: Create the test file**

```ts
import { describe, expect, it } from "vitest";

import type { ILXMMeasure } from "../../src/core/types";
import { layoutMeasure } from "../../src/layout/measure-layout";

const createBeat = (
  id: string,
  tick: number,
  base: ILXMMeasure["beats"][number]["rhythm"]["base"],
): ILXMMeasure["beats"][number] => ({
  id,
  tick,
  rhythm: { base, dots: 0 },
  kind: "notes",
  notes: [{ id: `${id}-note`, string: 3, fret: 2 }],
});

const createMeasure = (beats: ILXMMeasure["beats"]): ILXMMeasure => ({
  id: "measure-beam-test",
  timeSignature: { numerator: 4, denominator: 4 },
  barline: "single",
  chordSymbols: [],
  beats,
});

describe("layoutDurationBeams", () => {
  it("为连续八分音符生成一层 shared beam", () => {
    const layout = layoutMeasure(
      createMeasure([
        createBeat("beat-1", 0, "eighth"),
        createBeat("beat-2", 480, "eighth"),
      ]),
      { index: 0, x: 10, y: 20 },
    );

    expect(layout.durationMarks).toHaveLength(2);
    expect(layout.beamSegments).toEqual([
      expect.objectContaining({
        kind: "shared",
        level: 1,
        beatIds: ["beat-1", "beat-2"],
      }),
    ]);
  });

  it("为连续十六分音符生成两层 shared beam", () => {
    const layout = layoutMeasure(
      createMeasure([
        createBeat("beat-1", 0, "sixteenth"),
        createBeat("beat-2", 240, "sixteenth"),
      ]),
      { index: 0, x: 10, y: 20 },
    );

    expect(layout.beamSegments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "shared", level: 1 }),
        expect.objectContaining({ kind: "shared", level: 2 }),
      ]),
    );
  });

  it("四分音符会打断短时值连梁分组", () => {
    const layout = layoutMeasure(
      createMeasure([
        createBeat("beat-1", 0, "eighth"),
        createBeat("beat-2", 480, "quarter"),
        createBeat("beat-3", 1440, "eighth"),
      ]),
      { index: 0, x: 10, y: 20 },
    );

    expect(layout.durationMarks.map((mark) => mark.beatId)).toEqual([
      "beat-1",
      "beat-3",
    ]);
    expect(layout.beamSegments).toEqual([]);
  });

  it("高层级 beam 只有单个 beat 时生成 partial beam", () => {
    const layout = layoutMeasure(
      createMeasure([
        createBeat("beat-1", 0, "eighth"),
        createBeat("beat-2", 480, "sixteenth"),
        createBeat("beat-3", 720, "eighth"),
      ]),
      { index: 0, x: 10, y: 20 },
    );

    expect(layout.beamSegments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "shared",
          level: 1,
          beatIds: ["beat-1", "beat-2", "beat-3"],
        }),
        expect.objectContaining({
          kind: "partial",
          level: 2,
          beatId: "beat-2",
          direction: "left",
        }),
      ]),
    );
  });

  it("完全孤立的短时值 beat 生成 duration mark 但不生成 beam", () => {
    const layout = layoutMeasure(
      createMeasure([createBeat("beat-1", 0, "sixteenth")]),
      { index: 0, x: 10, y: 20 },
    );

    expect(layout.durationMarks).toEqual([
      expect.objectContaining({ beatId: "beat-1", beamLevel: 2 }),
    ]);
    expect(layout.beamSegments).toEqual([]);
  });

  it("符干高度根据 beat 内音符位置和第六弦下方连梁区域动态计算", () => {
    const layout = layoutMeasure(
      createMeasure([
        {
          ...createBeat("beat-1", 0, "eighth"),
          notes: [{ id: "note-first-string", string: 1, fret: 2 }],
        },
        {
          ...createBeat("beat-2", 480, "eighth"),
          notes: [{ id: "note-sixth-string", string: 6, fret: 3 }],
        },
      ]),
      { index: 0, x: 10, y: 20 },
    );
    const firstStringMark = layout.durationMarks.find(
      (mark) => mark.beatId === "beat-1",
    )!;
    const sixthStringMark = layout.durationMarks.find(
      (mark) => mark.beatId === "beat-2",
    )!;

    expect(firstStringMark.stemY1).toBeLessThan(sixthStringMark.stemY1);
    expect(firstStringMark.stemY2).toBe(sixthStringMark.stemY2);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
./node_modules/.bin/vitest run packages/lxm-editor/tests/layout/duration-beam-layout.test.ts --config packages/lxm-editor/vitest.config.ts
```

Expected: FAIL because `ILXMMeasureLayout` does not yet contain `durationMarks` or `beamSegments`.

- [ ] **Step 3: Commit**

```bash
git add packages/lxm-editor/tests/layout/duration-beam-layout.test.ts
git commit -m "test: add lxm editor beam layout coverage"
```

---

### Task 2: Add Duration And Beam Layout Types

**Files:**
- Modify: `packages/lxm-editor/src/layout/layout-types.ts`

**Interfaces:**
- Produces:
  - `ILXMDurationMarkLayout`
  - `ILXMSharedBeamSegmentLayout`
  - `ILXMPartialBeamSegmentLayout`
  - `ILXMBeamSegmentLayout`
  - `ILXMMeasureLayout.durationMarks`
  - `ILXMMeasureLayout.beamSegments`

- [ ] **Step 1: Extend `layout-types.ts`**

Add these interfaces near `ILXMNoteLayout`:

```ts
/** beat 级别的时值符干布局；一个和弦 beat 只生成一个符干。 */
export interface ILXMDurationMarkLayout {
  beatId: string;
  measureId: string;
  beamLevel: number;
  stemX: number;
  stemY1: number;
  stemY2: number;
  beamY: number;
}

/** 连续短时值 beat 共享的水平连梁段。 */
export interface ILXMSharedBeamSegmentLayout {
  kind: "shared";
  measureId: string;
  level: number;
  beatIds: string[];
  x1: number;
  x2: number;
  y: number;
  thickness: number;
}

/** 高层级 beam 无法形成完整共享段时使用的短连梁。 */
export interface ILXMPartialBeamSegmentLayout {
  kind: "partial";
  measureId: string;
  level: number;
  beatId: string;
  direction: "left" | "right";
  x1: number;
  x2: number;
  y: number;
  thickness: number;
}

export type ILXMBeamSegmentLayout =
  | ILXMSharedBeamSegmentLayout
  | ILXMPartialBeamSegmentLayout;
```

Then extend `ILXMMeasureLayout`:

```ts
  // beat 级别的时值符干布局，供渲染层绘制 stem。
  durationMarks: ILXMDurationMarkLayout[],
  // 连梁布局，供渲染层绘制时值连接线。
  beamSegments: ILXMBeamSegmentLayout[],
```

- [ ] **Step 2: Run type check and verify current failures are expected**

Run:

```bash
./node_modules/.bin/tsc --noEmit -p packages/lxm-editor/tsconfig.json
```

Expected: FAIL in `measure-layout.ts` because returned `ILXMMeasureLayout` does not yet include `durationMarks` and `beamSegments`.

- [ ] **Step 3: Commit**

```bash
git add packages/lxm-editor/src/layout/layout-types.ts
git commit -m "feat: define lxm editor beam layout types"
```

---

### Task 3: Add Beam Geometry Constants

**Files:**
- Modify: `packages/lxm-editor/src/layout/layout-constants.ts`

**Interfaces:**
- Produces layout-only visual constants for duration stems and beam segments

- [ ] **Step 1: Add constants**

Append these constants after staff/barline constants:

```ts
// 时值符干相对 beat slot x 的横向偏移；MVP 先贴近品位数字右侧。
export const LXM_DURATION_STEM_OFFSET_X = 8;

// 时值符干和音符所在弦线之间的纵向间距，避免符干压住品位数字。
export const LXM_DURATION_STEM_NOTE_GAP = 6;

// 连梁区域相对第六弦向下的顶部距离；符干终点会落在这条 baseline 上。
export const LXM_DURATION_BEAM_TOP_OFFSET_Y = 28;

// 连梁矩形厚度。
export const LXM_DURATION_BEAM_THICKNESS = 4;

// 多层连梁之间的纵向距离。
export const LXM_DURATION_BEAM_LEVEL_GAP = 6;

// partial beam 的默认短横线长度。
export const LXM_DURATION_PARTIAL_BEAM_LENGTH = 12;

// 连梁需要额外占用的小节底部空间。
export const LXM_DURATION_BEAM_AREA_HEIGHT =
  LXM_DURATION_BEAM_TOP_OFFSET_Y +
  LXM_DURATION_BEAM_LEVEL_GAP * 2 +
  LXM_DURATION_BEAM_THICKNESS;
```

- [ ] **Step 2: Extend measure height**

Modify `packages/lxm-editor/src/layout/layout-helpers.ts`:

```ts
import {
  LXM_DURATION_BEAM_AREA_HEIGHT,
  LXM_STAFF_HEIGHT,
  LXM_STAFF_Y,
} from "./layout-constants";

/** 计算小节高度；底部预留时值符干和连梁区域。 */
export const calculateMeasureHeight = (): number =>
  LXM_STAFF_Y * 2 + LXM_STAFF_HEIGHT + LXM_DURATION_BEAM_AREA_HEIGHT;
```

- [ ] **Step 3: Run type check**

Run:

```bash
./node_modules/.bin/tsc --noEmit -p packages/lxm-editor/tsconfig.json
```

Expected: still FAIL in `measure-layout.ts` until Task 4 returns duration fields.

- [ ] **Step 4: Commit**

```bash
git add packages/lxm-editor/src/layout/layout-constants.ts packages/lxm-editor/src/layout/layout-helpers.ts
git commit -m "feat: add duration beam layout constants"
```

---

### Task 4: Implement Duration Beam Layout Module

**Files:**
- Create: `packages/lxm-editor/src/layout/duration-beam-layout.ts`

**Interfaces:**
- Consumes:
  - `measure: ILXMMeasure`
  - `beatLayouts: ILXMBeatLayout[]`
  - `noteLayouts: ILXMNoteLayout[]`
  - `strings: ILXMStringLineLayout[]`
- Produces:
  - `{ durationMarks: ILXMDurationMarkLayout[]; beamSegments: ILXMBeamSegmentLayout[] }`

- [ ] **Step 1: Create `duration-beam-layout.ts`**

```ts
import type { ILXMMeasure, ILXMRhythmBase } from "../core/types";
import {
  LXM_DURATION_BEAM_LEVEL_GAP,
  LXM_DURATION_BEAM_THICKNESS,
  LXM_DURATION_BEAM_TOP_OFFSET_Y,
  LXM_DURATION_PARTIAL_BEAM_LENGTH,
  LXM_DURATION_STEM_NOTE_GAP,
  LXM_DURATION_STEM_OFFSET_X,
} from "./layout-constants";
import type {
  ILXMBeamSegmentLayout,
  ILXMBeatLayout,
  ILXMDurationMarkLayout,
  ILXMNoteLayout,
  ILXMStringLineLayout,
} from "./layout-types";

interface ILXMDurationBeamLayoutResult {
  durationMarks: ILXMDurationMarkLayout[];
  beamSegments: ILXMBeamSegmentLayout[];
}

const LXM_RHYTHM_BEAM_LEVEL: Record<ILXMRhythmBase, number> = {
  whole: 0,
  half: 0,
  quarter: 0,
  eighth: 1,
  sixteenth: 2,
  thirtySecond: 3,
};

const getLastStringLine = (
  strings: ILXMStringLineLayout[],
): ILXMStringLineLayout | undefined =>
  strings.reduce<ILXMStringLineLayout | undefined>(
    (lastString, string) =>
      !lastString || string.index > lastString.index ? string : lastString,
    undefined,
  );

const getBeatStemAnchorY = (
  beatId: string,
  noteLayouts: ILXMNoteLayout[],
): number | null => {
  const beatNotes = noteLayouts.filter((note) => note.beatId === beatId);

  if (beatNotes.length === 0) return null;

  /**
   * TAB 中一个 beat 可能是和弦。符干向下连接到第六弦下方的连梁区域时，
   * 起点取 beat 内最靠近第六弦的音符，避免符干穿过同一 beat 的其他数字。
   */
  return Math.max(...beatNotes.map((note) => note.y));
};

const buildDurationMark = (
  measureId: string,
  beatLayout: ILXMBeatLayout,
  noteLayouts: ILXMNoteLayout[],
  beamBaseY: number,
): ILXMDurationMarkLayout | null => {
  const beamLevel = LXM_RHYTHM_BEAM_LEVEL[beatLayout.rhythm.base];

  if (beamLevel <= 0) return null;

  const stemAnchorY = getBeatStemAnchorY(beatLayout.id, noteLayouts);

  if (stemAnchorY === null) return null;

  return {
    beatId: beatLayout.id,
    measureId,
    beamLevel,
    stemX: beatLayout.x + LXM_DURATION_STEM_OFFSET_X,
    beamY: beamBaseY,
    stemY1: stemAnchorY + LXM_DURATION_STEM_NOTE_GAP,
    stemY2:
      beamBaseY +
      (beamLevel - 1) * LXM_DURATION_BEAM_LEVEL_GAP +
      LXM_DURATION_BEAM_THICKNESS,
  };
};

const groupContiguousMarks = (
  measure: ILXMMeasure,
  markByBeatId: Map<string, ILXMDurationMarkLayout>,
): ILXMDurationMarkLayout[][] => {
  const groups: ILXMDurationMarkLayout[][] = [];
  let currentGroup: ILXMDurationMarkLayout[] = [];

  for (const beat of [...measure.beats].sort((left, right) => left.tick - right.tick)) {
    const mark = markByBeatId.get(beat.id);

    if (!mark) {
      if (currentGroup.length > 0) groups.push(currentGroup);
      currentGroup = [];
      continue;
    }

    currentGroup.push(mark);
  }

  if (currentGroup.length > 0) groups.push(currentGroup);

  return groups;
};

const buildPartialBeamSegment = (
  mark: ILXMDurationMarkLayout,
  level: number,
  group: ILXMDurationMarkLayout[],
  index: number,
): ILXMBeamSegmentLayout | null => {
  const hasLeftNeighbor = index > 0;
  const hasRightNeighbor = index < group.length - 1;

  if (!hasLeftNeighbor && !hasRightNeighbor) return null;

  // partial beam 优先指向左侧相邻 beat，让附点八分 + 十六分这类组合更接近常见记谱。
  const direction = hasLeftNeighbor ? "left" : "right";
  const x1 =
    direction === "left"
      ? mark.stemX - LXM_DURATION_PARTIAL_BEAM_LENGTH
      : mark.stemX;
  const x2 =
    direction === "left"
      ? mark.stemX
      : mark.stemX + LXM_DURATION_PARTIAL_BEAM_LENGTH;

  return {
    kind: "partial",
    measureId: mark.measureId,
    level,
    beatId: mark.beatId,
    direction,
    x1,
    x2,
    y: mark.beamY + (level - 1) * LXM_DURATION_BEAM_LEVEL_GAP,
    thickness: LXM_DURATION_BEAM_THICKNESS,
  };
};

const buildBeamSegments = (
  group: ILXMDurationMarkLayout[],
): ILXMBeamSegmentLayout[] => {
  if (group.length < 2) return [];

  const maxLevel = Math.max(...group.map((mark) => mark.beamLevel));
  const firstMark = group[0]!;

  return Array.from({ length: maxLevel }, (_, levelIndex) => {
    const level = levelIndex + 1;
    const marksAtLevel = group.filter((mark) => mark.beamLevel >= level);

    if (marksAtLevel.length === 1) {
      const mark = marksAtLevel[0]!;
      const index = group.findIndex((item) => item.beatId === mark.beatId);
      return buildPartialBeamSegment(mark, level, group, index);
    }

    if (marksAtLevel.length < 2) return null;

    return {
      kind: "shared",
      measureId: firstMark.measureId,
      level,
      beatIds: marksAtLevel.map((mark) => mark.beatId),
      x1: marksAtLevel[0]!.stemX,
      x2: marksAtLevel[marksAtLevel.length - 1]!.stemX,
      y: firstMark.beamY + (level - 1) * LXM_DURATION_BEAM_LEVEL_GAP,
      thickness: LXM_DURATION_BEAM_THICKNESS,
    };
  }).filter((segment): segment is ILXMBeamSegmentLayout => Boolean(segment));
};

/** 从 beat slot 和弦线推导时值符干与共享连梁；不修改音乐数据。 */
export const layoutDurationBeams = (
  measure: ILXMMeasure,
  beatLayouts: ILXMBeatLayout[],
  noteLayouts: ILXMNoteLayout[],
  strings: ILXMStringLineLayout[],
): ILXMDurationBeamLayoutResult => {
  const lastString = getLastStringLine(strings);

  if (!lastString) {
    return { durationMarks: [], beamSegments: [] };
  }

  // 连梁 baseline 固定在第六弦下方；符干高度由各 beat 的音符 y 动态决定。
  const beamBaseY = lastString.y1 + LXM_DURATION_BEAM_TOP_OFFSET_Y;
  const beatLayoutById = new Map(beatLayouts.map((beat) => [beat.id, beat]));
  const durationMarks = measure.beats
    .map((beat) => {
      const beatLayout = beatLayoutById.get(beat.id);
      return beatLayout
        ? buildDurationMark(measure.id, beatLayout, noteLayouts, beamBaseY)
        : null;
    })
    .filter((mark): mark is ILXMDurationMarkLayout => Boolean(mark));
  const markByBeatId = new Map(durationMarks.map((mark) => [mark.beatId, mark]));
  const groups = groupContiguousMarks(measure, markByBeatId);
  const beamSegments = groups.flatMap(buildBeamSegments);

  return {
    durationMarks,
    beamSegments,
  };
};
```

- [ ] **Step 2: Run tests and verify measure layout still fails**

Run:

```bash
./node_modules/.bin/vitest run packages/lxm-editor/tests/layout/duration-beam-layout.test.ts --config packages/lxm-editor/vitest.config.ts
```

Expected: FAIL until Task 5 connects `layoutDurationBeams` into `layoutMeasure`.

- [ ] **Step 3: Commit**

```bash
git add packages/lxm-editor/src/layout/duration-beam-layout.ts
git commit -m "feat: add lxm editor duration beam layout module"
```

---

### Task 5: Connect Beam Layout Into Measure Layout

**Files:**
- Modify: `packages/lxm-editor/src/layout/measure-layout.ts`

**Interfaces:**
- Consumes: `layoutDurationBeams(measure, beats, notes, strings)`
- Produces: `ILXMMeasureLayout.durationMarks` and `ILXMMeasureLayout.beamSegments`

- [ ] **Step 1: Import the new layout function**

```ts
import { layoutBarline } from "./barline-layout";
import { layoutDurationBeams } from "./duration-beam-layout";
```

- [ ] **Step 2: Call it after `beats` and `strings` are available**

Inside `layoutMeasure`, after:

```ts
const beats = Object.values(slotsByBeatId)
const strings = buildStringLines(x, y, assignedWidth)
```

add:

```ts
const notes = layoutNodes(measure.id, measure.beats, slotsByBeatId, context.y)
// 时值符干依赖音符 y，连梁 baseline 依赖第六弦下方的固定区域。
const durationBeamLayout = layoutDurationBeams(measure, beats, notes, strings)
```

- [ ] **Step 3: Return duration fields from `layoutMeasure`**

Add these properties to the returned object:

```ts
durationMarks: durationBeamLayout.durationMarks,
beamSegments: durationBeamLayout.beamSegments,
notes,
```

- [ ] **Step 4: Run tests**

Run:

```bash
./node_modules/.bin/vitest run packages/lxm-editor/tests/layout/duration-beam-layout.test.ts --config packages/lxm-editor/vitest.config.ts
```

Expected: PASS.

- [ ] **Step 5: Run type check**

Run:

```bash
./node_modules/.bin/tsc --noEmit -p packages/lxm-editor/tsconfig.json
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/lxm-editor/src/layout/measure-layout.ts
git commit -m "feat: connect beam layout to measure layout"
```

---

### Task 6: Render Beam Layout In The Current Website Preview

**Files:**
- Modify: `apps/website/app/editor/EditorShell/index.tsx`

**Interfaces:**
- Consumes:
  - `measure.durationMarks`
  - `measure.beamSegments`
- Produces: visible SVG stems and horizontal beam rectangles

- [ ] **Step 1: Render duration stems**

Inside each measure group, add this SVG group after notes and before barlines:

```tsx
<g>
  {/* 绘制 beat 级别的时值符干 */}
  {measure.durationMarks.map((mark) => {
    return (
      <line
        key={`${mark.beatId}-stem`}
        x1={mark.stemX}
        y1={mark.stemY1}
        x2={mark.stemX}
        y2={mark.stemY2}
        stroke="black"
        strokeWidth={1}
      />
    )
  })}
</g>
```

- [ ] **Step 2: Render shared and partial beam segments**

Add this group after stems:

```tsx
<g>
  {/* 绘制短时值之间的共享连梁和 partial beam */}
  {measure.beamSegments.map((beam) => {
    const beamKey =
      beam.kind === "shared"
        ? `${beam.kind}-${beam.level}-${beam.beatIds.join("-")}`
        : `${beam.kind}-${beam.level}-${beam.beatId}-${beam.direction}`

    return (
      <rect
        key={beamKey}
        x={beam.x1}
        y={beam.y}
        width={beam.x2 - beam.x1}
        height={beam.thickness}
        fill="black"
      />
    )
  })}
</g>
```

- [ ] **Step 3: Fix barline rendering to respect layout stroke width while touching this SVG area**

Change the existing barline line render from:

```tsx
strokeWidth={1}
```

to:

```tsx
strokeWidth={part.strokeWidth}
```

- [ ] **Step 4: Run website type check**

Run:

```bash
./node_modules/.bin/tsc --noEmit -p apps/website/tsconfig.json
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/website/app/editor/EditorShell/index.tsx
git commit -m "feat: render lxm editor beam layout"
```

---

### Task 7: Final Verification

**Files:**
- Verify: `packages/lxm-editor/src/layout/duration-beam-layout.ts`
- Verify: `packages/lxm-editor/src/layout/measure-layout.ts`
- Verify: `apps/website/app/editor/EditorShell/index.tsx`

- [ ] **Step 1: Run package layout test**

Run:

```bash
./node_modules/.bin/vitest run packages/lxm-editor/tests/layout/duration-beam-layout.test.ts --config packages/lxm-editor/vitest.config.ts
```

Expected:

```text
PASS packages/lxm-editor/tests/layout/duration-beam-layout.test.ts
```

- [ ] **Step 2: Run package type check**

Run:

```bash
./node_modules/.bin/tsc --noEmit -p packages/lxm-editor/tsconfig.json
```

Expected: command exits with status 0.

- [ ] **Step 3: Run website type check**

Run:

```bash
./node_modules/.bin/tsc --noEmit -p apps/website/tsconfig.json
```

Expected: command exits with status 0.

- [ ] **Step 4: Manual preview**

Run:

```bash
pnpm --filter @liuxianmao/website dev
```

Expected: Next.js starts and prints a local URL such as `http://localhost:3000`.

Open the editor page in that local website and verify:

- eighth + eighth beats show one horizontal beam
- sixteenth + sixteenth beats show two horizontal beams
- quarter beats do not show stems or beams
- barline stroke widths still follow `measure.barline.parts`

- [ ] **Step 5: Commit verification cleanup**

```bash
git status --short
git add packages/lxm-editor/src/layout apps/website/app/editor/EditorShell/index.tsx packages/lxm-editor/tests/layout/duration-beam-layout.test.ts
git commit -m "feat: add lxm editor note beam layout"
```

---

## Self-Review

- Spec coverage: The plan covers type definitions, layout constants, pure beam geometry, measure integration, SVG consumption, and verification.
- Placeholder scan: No task depends on unnamed functions or undefined types; every new function and interface appears before use.
- Type consistency: `ILXMDurationMarkLayout`, `ILXMBeamSegmentLayout`, `durationMarks`, and `beamSegments` are introduced in Task 2 and used consistently afterward.
- Scope check: The plan includes shared beam and partial beam, but deliberately excludes manual beam grouping, slanted beams, flags, rests, and cross-measure beams. Those should be separate follow-up plans after the automatic horizontal beam path is stable.
