# Placeholder Edit Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为六线谱编辑器增加“占位网格”能力，让缺失的细分时值在编辑态保持可见、可点击、可输入，同时不把占位信息持久化进 score schema。

**Architecture:** 不在 `schema.ts` 中新增 `kind: "placeholder"` 之类的持久化 beat，而是在 layout / editor 层派生 `editGrid`。`editGrid` 以“当前编辑时值 `currentRhythm`”为分辨率，在已有 beat 的几何宽度内部再细分出可点击 slot；命令层从“只能命中 beat 起点”升级为“可命中 beat 内部 slot”，通过拆分 / 合并真实 beat 的方式把输入落到 score 上。这样 schema、验证、播放等领域模型仍然只处理真实音乐事件，不会混入编辑脚手架。

**Tech Stack:** TypeScript 6、Vitest、Zod、Zustand、React 19、Next.js 16、SVG

## Global Constraints

- **不要**给 `packages/lxm-tabeditor/src/core/schema.ts` 增加 `placeholder` beat kind；占位网格只存在于 layout / editor 层。
- 所有 score 写操作仍然必须走 `packages/lxm-tabeditor/src/commands/` 的领域命令，保持撤销重做兼容。
- 涉及 tick 拆分、beat 合并、slot 命中的数学逻辑必须补详细中文注释。
- `ScorePreview` 的新增渲染层仍然放在 `apps/website/components/editor-shell/ScorePreview/` 目录下，不把职责重新打散。
- 第一轮交付聚焦 **常规拍号 + 非 tuplet beat 内部细分**；tuplet 区域先保持单槽回退，不在这轮强行做全量细分。

---

## Design Decision

### 为什么不选“把 placeholder 存进 Measure.beats”

当前项目的核心约束是：`measure.beats` 是**真实音乐时间线**，并被这些模块直接消费：

- `validation.ts`：容量、重叠、tuplet 连续性校验
- `score-command-reducer.ts`：命令定位和写入
- `measure-layout.ts` / `duration-layout.ts`：时值、beam、rest 排版
- 后续播放/导出能力

如果把 placeholder 持久化成 beat：

1. schema 会混入“编辑脚手架”，不再只表达真实谱面；
2. 命令层、校验层、排版层都要把 placeholder 当第三种 beat 分支处理；
3. 删除音符、导出、播放都会面对“这个占位 beat 到底是音乐内容还是编辑 UI” 的语义污染。

所以推荐方案是：

- **score 仍然只存真实 beat**
- **editGrid 根据当前编辑时值派生**
- **命令层在 slot 写入时把真实 beat 拆开 / 合并**

---

## Planned File Structure

**Create**
- `packages/lxm-tabeditor/src/layout/edit-grid.ts`
- `packages/lxm-tabeditor/src/commands/timeline-materialization.ts`
- `packages/lxm-tabeditor/tests/edit-grid.test.ts`
- `apps/website/components/editor-shell/ScorePreview/MeasureGridLayer.tsx`

**Modify**
- `packages/lxm-tabeditor/src/core/rhythm.ts`
- `packages/lxm-tabeditor/src/layout/layout-types.ts`
- `packages/lxm-tabeditor/src/layout/measure-layout.ts`
- `packages/lxm-tabeditor/src/layout/score-layout.ts`
- `packages/lxm-tabeditor/src/store/editor-store.ts`
- `packages/lxm-tabeditor/src/commands/command-types.ts`
- `packages/lxm-tabeditor/src/commands/score-command-reducer.ts`
- `packages/lxm-tabeditor/tests/layout.test.ts`
- `packages/lxm-tabeditor/tests/commands.test.ts`
- `apps/website/components/editor-shell/Sidebar.tsx`
- `apps/website/components/editor-shell/ScorePreview/index.tsx`
- `apps/website/components/editor-shell/ScorePreview/score-preview-types.ts`
- `apps/website/components/editor-shell/ScorePreview/ScoreMeasureLayer.tsx`

**Why these files**
- `edit-grid.ts`：派生“一个 beat 内部的 slot 网格”，不污染 score schema。
- `timeline-materialization.ts`：命令层统一处理“在长 beat 内部写入更短 beat” 的拆分 / 合并算法。
- `layout-types.ts` / `score-layout.ts` / `measure-layout.ts`：把 slot 几何和命中索引挂到 layout 输出。
- `editor-store.ts` / `Sidebar.tsx` / `ScorePreview/*`：把选区从“beat 起点”升级为“slot 光标”，并渲染占位格。

### Task 1: 增加 beat 区间拆分 helper，为空槽写入打基础

**Files:**
- Modify: `packages/lxm-tabeditor/src/core/rhythm.ts`
- Test: `packages/lxm-tabeditor/tests/rhythm.test.ts`

**Interfaces:**
- Consumes:
  - `calculateRhythmTicks(rhythm, tuplet?)`
  - `type RhythmValue`
  - `type TimeSignature`
- Produces:
  - `export interface BeatFragment { tick: number; rhythm: RhythmValue }`
  - `export const partitionTickRangeToRhythms(startTick: number, endTick: number, timeSignature: TimeSignature): BeatFragment[]`

- [ ] **Step 1: 写失败测试，锁定“长 beat 被切开后要能还原成合法时值片段”**

```ts
it("把四分音符内部的 32 分音符写入切分成前后合法片段", () => {
  expect(
    partitionTickRangeToRhythms(0, 240, { numerator: 4, denominator: 4 }),
  ).toEqual([
    { tick: 0, rhythm: { base: "sixteenth", dots: 0 } },
  ]);

  expect(
    partitionTickRangeToRhythms(360, 960, { numerator: 4, denominator: 4 }),
  ).toEqual([
    { tick: 360, rhythm: { base: "sixteenth", dots: 0 } },
    { tick: 600, rhythm: { base: "eighth", dots: 0 } },
  ]);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/rhythm.test.ts`

Expected: FAIL with `partitionTickRangeToRhythms is not defined`

- [ ] **Step 3: 在 `core/rhythm.ts` 中实现最小版区间拆分 helper**

```ts
export interface BeatFragment {
  tick: number;
  rhythm: RhythmValue;
}

const CANONICAL_RHYTHMS: RhythmValue[] = [
  { base: "whole", dots: 0 },
  { base: "half", dots: 1 },
  { base: "half", dots: 0 },
  { base: "quarter", dots: 1 },
  { base: "quarter", dots: 0 },
  { base: "eighth", dots: 1 },
  { base: "eighth", dots: 0 },
  { base: "sixteenth", dots: 0 },
  { base: "thirtySecond", dots: 0 },
];

export const partitionTickRangeToRhythms = (
  startTick: number,
  endTick: number,
  timeSignature: TimeSignature,
): BeatFragment[] => {
  const fragments: BeatFragment[] = [];
  let cursor = startTick;

  while (cursor < endTick) {
    const next = CANONICAL_RHYTHMS.find((rhythm) => {
      const result = calculateRhythmTicks(rhythm);
      return result.ok && cursor + result.ticks <= endTick;
    });

    if (!next) {
      throw new Error(`无法把 ${startTick}-${endTick} 切成合法节奏片段`);
    }

    fragments.push({ tick: cursor, rhythm: next });
    cursor += calculateRhythmTicks(next).ok
      ? calculateRhythmTicks(next).ticks
      : 0;
  }

  return fragments;
};
```

- [ ] **Step 4: 为 helper 补充中文注释并让测试通过**

Run: `pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/rhythm.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/lxm-tabeditor/src/core/rhythm.ts \
  packages/lxm-tabeditor/tests/rhythm.test.ts
git commit -m "feat: add canonical tick partition helper"
```

### Task 2: 在 layout 层派生 edit grid，并把命中从 beat 起点升级为 slot

**Files:**
- Create: `packages/lxm-tabeditor/src/layout/edit-grid.ts`
- Modify: `packages/lxm-tabeditor/src/layout/layout-types.ts`
- Modify: `packages/lxm-tabeditor/src/layout/measure-layout.ts`
- Modify: `packages/lxm-tabeditor/src/layout/score-layout.ts`
- Test: `packages/lxm-tabeditor/tests/edit-grid.test.ts`
- Test: `packages/lxm-tabeditor/tests/layout.test.ts`

**Interfaces:**
- Consumes:
  - `partitionTickRangeToRhythms(...)`
  - `calculateRhythmTicks(...)`
  - `type RhythmValue`
  - `type Beat`
  - `type LaidOutBeat`
- Produces:
  - `export interface LaidOutEditGridSlot`
  - `export interface MeasureEditGrid`
  - `export const buildMeasureEditGrid(...)`
  - `ScoreLayoutOptions["editingRhythm"]?: RhythmValue`
  - `ScoreLayoutHit = { measureId: string; beatId?: string; tick: number; string: number; slotId: string }`

- [ ] **Step 1: 写失败测试，覆盖“长 beat 内部生成空槽”和“命中空槽返回 slot tick”**

```ts
it("按当前编辑时值在长 beat 内部生成占位 slot", () => {
  const document = createExampleDocument();
  const layout = layoutScore(document.score, {
    editingRhythm: { base: "thirtySecond", dots: 0 },
  });
  const measure = layout.systems.flatMap((system) => system.measures)[4]!;

  expect(
    measure.editGrid.slots.filter((slot) => slot.coveringBeatId === "beat-005-11"),
  ).toHaveLength(8);
  expect(
    measure.editGrid.slots.filter(
      (slot) =>
        slot.coveringBeatId === "beat-005-11" && slot.beatId === undefined,
    ),
  ).toHaveLength(7);
});

it("命中长 beat 内部的空槽时返回 slotId 和 tick，而不是回退到 beat 起点", () => {
  const document = createExampleDocument();
  const layout = layoutScore(document.score, {
    editingRhythm: { base: "thirtySecond", dots: 0 },
  });
  const measure = layout.systems.flatMap((system) => system.measures)[4]!;
  const secondSlot = measure.editGrid.slots.filter(
    (slot) => slot.coveringBeatId === "beat-005-11",
  )[1]!;

  const hit = hitTestScoreLayout(layout, {
    x: secondSlot.x + secondSlot.width / 2,
    y: measure.y + measure.staffTop + measure.stringSpacing * 2,
  });

  expect(hit).toMatchObject({
    measureId: "measure-005",
    beatId: "beat-005-11",
    tick: secondSlot.tick,
    slotId: secondSlot.id,
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/edit-grid.test.ts tests/layout.test.ts`

Expected: FAIL with `measure.editGrid is undefined`

- [ ] **Step 3: 在 `layout-types.ts` 中增加 edit grid 类型**

```ts
export interface LaidOutEditGridSlot {
  id: string;
  measureId: string;
  beatId?: string;
  coveringBeatId: string;
  tick: number;
  x: number;
  width: number;
  isBeatStart: boolean;
}

export interface MeasureEditGrid {
  rhythm: RhythmValue;
  slots: LaidOutEditGridSlot[];
}

export interface LaidOutMeasure {
  // ...
  editGrid?: MeasureEditGrid;
}

export interface ScoreLayoutOptions {
  zoom?: number;
  width?: number;
  measuresPerSystem?: number;
  editingRhythm?: RhythmValue;
}
```

- [ ] **Step 4: 在 `edit-grid.ts` 中实现“按 beat 宽度细分 slot”的 builder**

```ts
export const buildMeasureEditGrid = (
  measure: Measure,
  laidOutBeats: LaidOutBeat[],
  editingRhythm: RhythmValue | undefined,
): MeasureEditGrid | undefined => {
  if (!editingRhythm) return undefined;
  const slotTicksResult = calculateRhythmTicks(editingRhythm);
  if (!slotTicksResult.ok) return undefined;

  const slots = laidOutBeats.flatMap((beat) => {
    const beatTicksResult = calculateRhythmTicks(beat.rhythm);
    if (!beatTicksResult.ok) return [];
    const beatTicks = beatTicksResult.ticks;
    if (beatTicks % slotTicksResult.ticks !== 0) {
      return [
        {
          id: `${measure.id}-${beat.id}-slot-0`,
          measureId: measure.id,
          beatId: beat.id,
          coveringBeatId: beat.id,
          tick: beat.tick,
          x: beat.x,
          width: beat.width,
          isBeatStart: true,
        },
      ];
    }

    const slotCount = beatTicks / slotTicksResult.ticks;
    return Array.from({ length: slotCount }, (_, index) => ({
      id: `${measure.id}-${beat.id}-slot-${index}`,
      measureId: measure.id,
      beatId: index === 0 ? beat.id : undefined,
      coveringBeatId: beat.id,
      tick: beat.tick + index * slotTicksResult.ticks,
      x: beat.x + (beat.width / slotCount) * index,
      width: beat.width / slotCount,
      isBeatStart: index === 0,
    }));
  });

  return { rhythm: editingRhythm, slots };
};
```

- [ ] **Step 5: 在 `measure-layout.ts` 和 `score-layout.ts` 中接入 editGrid 与 slot hit-test**

```ts
const editGrid = buildMeasureEditGrid(measure, beats, context.editingRhythm);

return {
  // ...
  beats,
  editGrid,
};
```

```ts
const slot = measure.editGrid?.slots.find((item) =>
  containsPoint(
    { x: item.x, y: measure.y + measure.staffTop - HIT_PADDING, width: item.width, height: STAFF_HEIGHT + HIT_PADDING * 2 },
    point.x,
    point.y,
  ),
);

if (slot) {
  return {
    measureId: measure.id,
    beatId: slot.coveringBeatId,
    tick: slot.tick,
    string: clamp(Math.round(rawString), 1, GUITAR_STRING_COUNT),
    slotId: slot.id,
  };
}
```

- [ ] **Step 6: 运行 layout / edit-grid 测试**

Run:

```bash
pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/edit-grid.test.ts tests/layout.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/lxm-tabeditor/src/layout/edit-grid.ts \
  packages/lxm-tabeditor/src/layout/layout-types.ts \
  packages/lxm-tabeditor/src/layout/measure-layout.ts \
  packages/lxm-tabeditor/src/layout/score-layout.ts \
  packages/lxm-tabeditor/tests/edit-grid.test.ts \
  packages/lxm-tabeditor/tests/layout.test.ts
git commit -m "feat: add layout edit grid and slot hit test"
```

### Task 3: 让命令层支持“在 slot 上写入”，并在长 beat 内部拆分真实 beat

**Files:**
- Create: `packages/lxm-tabeditor/src/commands/timeline-materialization.ts`
- Modify: `packages/lxm-tabeditor/src/commands/command-types.ts`
- Modify: `packages/lxm-tabeditor/src/commands/score-command-reducer.ts`
- Test: `packages/lxm-tabeditor/tests/commands.test.ts`

**Interfaces:**
- Consumes:
  - `partitionTickRangeToRhythms(...)`
  - `type Beat`
  - `type RhythmValue`
  - `type ScoreCommand`
- Produces:
  - `export interface TimelineTargetPayload { trackId: string; measureId: string; tick: number; beatId?: string }`
  - `export const materializeBeatAtTick(...)`
  - `AddNotePayload["rhythm"]?: RhythmValue`
  - `SetBeatRestPayload["rhythm"]?: RhythmValue`

- [ ] **Step 1: 写失败测试，锁定“在 quarter rest 内部写 32 分音符会拆成 rest + note + rest”**

```ts
it("支持在长 rest 内部按当前时值写入音符", () => {
  const score = createEmptyScore();
  const result = reduceScoreCommand(score, {
    type: "note.add",
    payload: {
      trackId: "track-guitar-main",
      measureId: "measure-001",
      tick: 120,
      beatId: "beat-001-1",
      rhythm: { base: "thirtySecond", dots: 0 },
      note: { id: "note-slot", string: 2, fret: 3, techniques: [] },
    },
  });

  expect(result.ok).toBe(true);
  if (!result.ok) return;

  expect(result.value.tracks[0]!.measures[0]!.beats).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ tick: 0, kind: "rest" }),
      expect.objectContaining({ tick: 120, kind: "notes", rhythm: { base: "thirtySecond", dots: 0 } }),
      expect.objectContaining({ tick: 240, kind: "rest" }),
    ]),
  );
});
```

- [ ] **Step 2: 运行命令测试确认失败**

Run: `pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/commands.test.ts`

Expected: FAIL with payload type mismatch or reducer not handling `tick`

- [ ] **Step 3: 在 `command-types.ts` 中把命令定位从 beat 起点升级为 timeline target**

```ts
export interface TimelineTargetPayload {
  trackId: string;
  measureId: string;
  tick: number;
  beatId?: string;
}

export interface AddNotePayload extends TimelineTargetPayload {
  note: TabNote;
  rhythm?: RhythmValue;
}

export interface SetBeatRhythmPayload extends TimelineTargetPayload {
  rhythm: RhythmValue;
}

export type SetBeatRestPayload = TimelineTargetPayload & {
  rhythm?: RhythmValue;
};
```

- [ ] **Step 4: 在 `timeline-materialization.ts` 中实现 beat 拆分 / 合并 helper**

```ts
export const materializeBeatAtTick = ({
  measure,
  tick,
  rhythm,
  nextBeat,
  timeSignature,
}: {
  measure: Measure;
  tick: number;
  rhythm: RhythmValue;
  nextBeat: Beat;
  timeSignature: TimeSignature;
}): Beat[] => {
  // 1. 找到覆盖 tick 的原始 beat
  // 2. 把原 beat 的前半段拆成 canonical rest / notes 片段
  // 3. 插入 nextBeat
  // 4. 把后半段拆成 canonical 片段
  // 5. 合并相邻可合并 rest，避免 measure.beats 过碎
};
```

- [ ] **Step 5: 在 reducer 中让 `note.add` / `beat.setRest` 支持 slot 写入**

```ts
if (command.payload.tick !== context.beat.tick) {
  if (!command.payload.rhythm) {
    return commandFailure("RHYTHM_REQUIRED_FOR_SLOT_WRITE", "在空槽写入时必须提供目标时值");
  }
  const nextBeats = materializeBeatAtTick({
    measure: context.measure,
    tick: command.payload.tick,
    rhythm: command.payload.rhythm,
    nextBeat: {
      id: context.beat.id,
      tick: command.payload.tick,
      rhythm: command.payload.rhythm,
      kind: "notes",
      notes: [command.payload.note],
    },
    timeSignature: context.measure.timeSignature ?? score.meta.timeSignature,
  });
  return replaceMeasureBeats(score, context, nextBeats);
}
```

- [ ] **Step 6: 运行命令测试**

Run: `pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/commands.test.ts`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/lxm-tabeditor/src/commands/command-types.ts \
  packages/lxm-tabeditor/src/commands/timeline-materialization.ts \
  packages/lxm-tabeditor/src/commands/score-command-reducer.ts \
  packages/lxm-tabeditor/tests/commands.test.ts
git commit -m "feat: support slot-targeted score commands"
```

### Task 4: 把编辑光标改成 slot 光标，并在 ScorePreview 渲染占位格

**Files:**
- Create: `apps/website/components/editor-shell/ScorePreview/MeasureGridLayer.tsx`
- Modify: `packages/lxm-tabeditor/src/store/editor-store.ts`
- Modify: `apps/website/components/editor-shell/ScorePreview/index.tsx`
- Modify: `apps/website/components/editor-shell/ScorePreview/score-preview-types.ts`
- Modify: `apps/website/components/editor-shell/ScorePreview/ScoreMeasureLayer.tsx`
- Modify: `apps/website/components/editor-shell/ScorePreview/hooks/useScorePreviewPointerHit.ts`
- Modify: `apps/website/components/editor-shell/ScorePreview/hooks/useScorePreviewInput.ts`
- Modify: `apps/website/components/editor-shell/Sidebar.tsx`

**Interfaces:**
- Consumes:
  - `ScoreLayoutHit["slotId"]`
  - `LaidOutMeasure["editGrid"]`
  - `TimelineTargetPayload`
- Produces:
  - `ActiveBeatPosition` -> `ActiveCursorPosition`
  - `MeasureGridLayer`
  - 在 UI 层把 `currentRhythm` 同时用于 slot grid 分辨率和新建 beat 的目标时值

- [ ] **Step 1: 写失败测试或类型断言，确保 UI 已拿到 `slotId`**

```ts
// 以类型检查为主：ActiveCursorPosition 需要能持有 slotId 和可选 beatId
export interface ActiveCursorPosition {
  trackId: string;
  measureId: string;
  beatId?: string;
  tick: number;
  slotId: string;
  string: number;
}
```

- [ ] **Step 2: 在 `editor-store.ts` 中把 activeBeat 升级为 slot 光标**

```ts
export interface ActiveCursorPosition {
  trackId: string;
  measureId: string;
  beatId?: string;
  tick: number;
  slotId: string;
  string: number;
}

export interface EditorStoreState {
  activeBeat?: ActiveCursorPosition;
}
```

- [ ] **Step 3: 新增 `MeasureGridLayer.tsx`，只在 active measure 渲染细分占位格**

```tsx
export const MeasureGridLayer: React.FC<{
  measure: LaidOutMeasure;
  activeSlotId?: string;
}> = ({ measure, activeSlotId }) => (
  <>
    {measure.editGrid?.slots.map((slot) => (
      <rect
        key={slot.id}
        className={
          slot.id === activeSlotId
            ? styles["active-grid-slot-svg"]
            : slot.beatId
              ? styles["occupied-grid-slot-svg"]
              : styles["empty-grid-slot-svg"]
        }
        x={slot.x}
        y={measure.y + measure.staffTop - 6}
        width={Math.max(1, slot.width)}
        height={measure.staffHeight + 12}
        rx={2}
      />
    ))}
  </>
);
```

- [ ] **Step 4: 在 `ScoreMeasureLayer.tsx` 中把 grid layer 放在弦线之后、音符之前**

```tsx
<MeasureGridLayer
  measure={measure}
  activeSlotId={selection.activeSlotId}
/>
<MeasureDurationLayer measure={measure} />
<MeasureNotesLayer measure={measure} activeNoteId={selection.activeNoteId} />
```

- [ ] **Step 5: 更新 pointer hit / keyboard input / Sidebar 逻辑**

```ts
// useScorePreviewPointerHit.ts
setActiveBeat({
  trackId: track.id,
  measureId: hit.measureId,
  beatId: hit.beatId,
  tick: hit.tick,
  slotId: hit.slotId,
  string: hit.string,
});

// useScorePreviewInput.ts
executeCommand({
  type: "note.add",
  payload: {
    ...activeBeat,
    rhythm: currentRhythm,
    note,
  },
});

// Sidebar.tsx
// 光标落在 beat 起点时仍允许直接改现有 beat 时值；
// 光标落在 beat 内部空槽时只更新 currentRhythm，不立刻改 score。
if (activeBeat?.beatId && activeBeat.tick === context?.beat.tick) {
  executeCommand({ type: "beat.setRhythm", payload: { ...activeBeat, rhythm } });
}
```

- [ ] **Step 6: 运行页面和 layout 回归**

Run:

```bash
pnpm --filter @liuxianmao/website type-check
pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/edit-grid.test.ts tests/layout.test.ts tests/commands.test.ts
```

Expected:
- `tsc --noEmit` PASS
- `edit-grid/layout/commands` PASS

- [ ] **Step 7: Commit**

```bash
git add packages/lxm-tabeditor/src/store/editor-store.ts \
  apps/website/components/editor-shell/Sidebar.tsx \
  apps/website/components/editor-shell/ScorePreview
git commit -m "feat: render and edit placeholder grid slots"
```

### Task 5: 加入回归夹具、修正示例注释，并明确 tuplet 回退策略

**Files:**
- Modify: `packages/lxm-tabeditor/src/testing/example-document.ts`
- Modify: `packages/lxm-tabeditor/tests/layout.test.ts`
- Modify: `packages/lxm-tabeditor/tests/commands.test.ts`
- Modify: `docs/superpowers/plans/2026-06-24-placeholder-edit-grid.md`

**Interfaces:**
- Consumes:
  - `editGrid`
  - `slot-targeted commands`
- Produces:
  - 示例数据中的“长 beat + 细分输入”回归场景
  - 明确注释：fixture 中的 `// 第二小节` 等字样是局部节奏段注释，不是实际 `measure`

- [ ] **Step 1: 修正示例文档中的误导性节奏段注释**

```ts
// 第二拍：四个连续 32 分音符
// 第三拍起：回到较长时值，供 edit grid 验证长 beat 内部空槽
```

- [ ] **Step 2: 在 layout 测试中明确断言“grid 不改变真实 beam 语义，只补充空槽可见性”**

```ts
expect(
  measure.beamSegments,
).toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      kind: "shared",
      beatIds: ["beat-005-07", "beat-005-08", "beat-005-09", "beat-005-10"],
    }),
  ]),
);

expect(
  measure.editGrid?.slots.filter((slot) => slot.coveringBeatId === "beat-005-11"),
).toHaveLength(8);
```

- [ ] **Step 3: 在计划和代码注释里写清 tuplet 区域第一轮回退**

```md
- 如果当前 beat 位于 tuplet group 中，且 `beatTicks % editingRhythmTicks !== 0`，
  `editGrid` 只输出单个 slot，不在这一轮伪造额外 tuplet 子槽。
```

- [ ] **Step 4: 跑最终回归**

Run:

```bash
pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/rhythm.test.ts tests/edit-grid.test.ts tests/layout.test.ts tests/commands.test.ts
pnpm --filter @liuxianmao/website type-check
```

Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/lxm-tabeditor/src/testing/example-document.ts \
  packages/lxm-tabeditor/tests \
  docs/superpowers/plans/2026-06-24-placeholder-edit-grid.md
git commit -m "test: add placeholder grid regression coverage"
```

## Self-Review

- **Spec coverage:** 计划覆盖了“占位网格”真正需要动到的四层：layout slot 派生、命中模型、命令拆分/合并、UI 渲染与输入。也显式说明了不把 placeholder 持久化到 schema 的约束。
- **Placeholder scan:** 没有使用 TBD / TODO / “后续再实现” 作为主线步骤；tuplet 仅被明确为第一轮单槽回退，不是假装已支持。
- **Type consistency:** 计划统一采用 `editGrid / slotId / TimelineTargetPayload / ActiveCursorPosition / partitionTickRangeToRhythms / materializeBeatAtTick` 这组命名，后续任务引用保持一致。
