# Partial Beam Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 TAB 预览补齐 partial beam（短横线）渲染，并统一 beam 几何模型，使附点八分音符 + 十六分音符等组合按标准记谱显示共享连梁与补充短横线，而不是退回成独立符尾。

**Architecture:** 继续以 `packages/lxm-tabeditor` 的 layout 层为唯一几何来源，在现有“门面 + 子模块”结构上增量扩展：`layout-types.ts` 负责 beam 联合类型，`duration-layout.ts` 负责把完整连梁和 partial beam 统一产出为 `beamSegments`，`measure-layout.ts` 负责把新几何接回小节产物，`score-layout.ts` 继续只做对外门面与编排。页面层 `ScorePreview` 只消费 `beamSegments` 和 `durationMarks` 渲染 SVG，不在 React 中重算节奏几何。

**Tech Stack:** TypeScript, Vitest, React, SVG, SCSS Modules

## Global Constraints

- 只补 partial beam 能力，不改第 2 小节示例数据的节奏语义。
- 时值归属仍绑定 `beat.rhythm`，不能从单个 `note` 反推。
- layout 层继续负责几何与分组规则，页面层只负责渲染。
- 复杂坐标和分组判断必须补中文注释。
- 使用判别联合类型统一表示 beam 几何；不允许通过 `beatIds.length === 1` 之类的隐式约定区分 partial beam。
- 新的 `beamSegments` 行为必须保持与当前 `beamGroups` 一致的完整连梁效果，且不能破坏已有八分连梁与三连音显示。
- 至少运行 layout 单测、`@liuxianmao/lxm-tabeditor` 类型检查和 `@liuxianmao/website` 类型检查。

---

### Task 1: 先写 beamSegments 失败测试

**Files:**
- Modify: `packages/lxm-tabeditor/tests/layout.test.ts`

**Interfaces:**
- Consumes: `layoutScore(score) => ScoreLayout`
- Produces: 新的测试断言，覆盖 `measure.beamSegments` 中的 `shared` / `partial` 两类片段，以及“partial beam 覆盖后不该再依赖独立 flag”的布局前提

- [ ] **Step 1: 在测试文件中补充 beamSegments 测试辅助类型**

```ts
interface TestBeamSegment {
  kind: "shared" | "partial";
  level: number;
  beatIds?: string[];
  beatId?: string;
  direction?: "left" | "right";
}

interface TestMeasureWithBeamSegments {
  beamSegments?: TestBeamSegment[];
}
```

- [ ] **Step 2: 为第 2 小节新增失败断言**

```ts
it("为附点八分加十六分组合输出 shared 和 partial 两类 beam segment", () => {
  const document = createExampleDocument();
  const layout = layoutScore(document.score);
  const measures = layout.systems.flatMap((system) => system.measures);
  const secondMeasure = measures[1]! as typeof measures[number] &
    TestMeasureWithDuration &
    TestMeasureWithBeamSegments;

  expect(secondMeasure.beamSegments).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "shared",
        level: 1,
        beatIds: ["beat-002-02", "beat-002-03", "beat-002-04"],
      }),
      expect.objectContaining({
        kind: "partial",
        beatId: "beat-002-04",
        level: 2,
        direction: "left",
      }),
    ]),
  );
});
```

- [ ] **Step 3: 为孤立十六分音符保留 flag fallback 写失败断言**

```ts
it("孤立高层时值不强制生成 partial beam", () => {
  const document = createExampleDocument();
  const layout = layoutScore(document.score);
  const measures = layout.systems.flatMap((system) => system.measures);
  const firstMeasure = measures[0]! as typeof measures[number] &
    TestMeasureWithBeamSegments;

  expect(firstMeasure.beamSegments ?? []).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "partial",
        beatId: "beat-001-07",
      }),
    ]),
  );
});
```

- [ ] **Step 4: 运行测试确认当前失败**

Run:

```bash
pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/layout.test.ts
```

Expected:

```text
FAIL ... Property 'beamSegments' does not exist
```

- [ ] **Step 5: Commit**

```bash
git add packages/lxm-tabeditor/tests/layout.test.ts
git commit -m "test: add failing beam segment layout coverage"
```

### Task 2: 在 layout 子模块中输出统一的 beamSegments 几何

**Files:**
- Modify: `packages/lxm-tabeditor/src/layout/layout-types.ts`
- Modify: `packages/lxm-tabeditor/src/layout/duration-layout.ts`
- Modify: `packages/lxm-tabeditor/src/layout/measure-layout.ts`
- Verify: `packages/lxm-tabeditor/src/layout/score-layout.ts`
- Test: `packages/lxm-tabeditor/tests/layout.test.ts`

**Interfaces:**
- Consumes: `measure.beats`, `durationMarks: LaidOutDurationMark[]`
- Produces:
  - `type LaidOutBeamSegment = LaidOutSharedBeam | LaidOutPartialBeam`
  - `LaidOutMeasure["beamSegments"]: LaidOutBeamSegment[]`

- [ ] **Step 1: 在 `layout-types.ts` 中把 beam 抽象成判别联合类型**

```ts
interface BaseBeamSegment {
  measureId: string;
  level: 1 | 2 | 3;
  x1: number;
  x2: number;
  y: number;
}

export interface LaidOutSharedBeam extends BaseBeamSegment {
  kind: "shared";
  beatIds: string[];
}

export interface LaidOutPartialBeam extends BaseBeamSegment {
  kind: "partial";
  beatId: string;
  direction: "left" | "right";
}

export type LaidOutBeamSegment = LaidOutSharedBeam | LaidOutPartialBeam;

/** 判断 beam segment 是否为完整共享连梁，供 filter/find 时获得准确类型收窄。 */
export const isLaidOutSharedBeam = (
  segment: LaidOutBeamSegment,
): segment is LaidOutSharedBeam => segment.kind === "shared";

/** 判断 beam segment 是否为 partial beam，避免调用方用隐式字段猜测片段类型。 */
export const isLaidOutPartialBeam = (
  segment: LaidOutBeamSegment,
): segment is LaidOutPartialBeam => segment.kind === "partial";

export interface LaidOutMeasure {
  // ...
  durationMarks: LaidOutDurationMark[];
  beamSegments: LaidOutBeamSegment[];
}
```

- [ ] **Step 2: 在 `duration-layout.ts` 中扩展统一构建函数签名**

```ts
const buildBeamGeometry = (
  beats: Measure["beats"],
  durationMarkByBeatId: Map<string, LaidOutDurationMark>,
): LaidOutBeamSegment[] => {
  // implementation
};
```

- [ ] **Step 3: 在 `duration-layout.ts` 中统一产出 `shared` 与 `partial` 两类 segment**

```ts
if (run.length >= 2) {
  beamSegments.push({
    kind: "shared",
    measureId,
    level,
    beatIds: run.map((mark) => mark.beatId),
    x1: run[0]!.stemX,
    x2: run[run.length - 1]!.stemX,
    y: run[0]!.stemBaseY + (level - 1) * DURATION_LEVEL_GAP,
  });
} else if (run.length === 1) {
  const mark = run[0]!;
  const hasLeftNeighbor = index > 0 && eligibleMarks[index - 1] !== null;
  const hasRightNeighbor =
    index + 1 < eligibleMarks.length && eligibleMarks[index + 1] !== null;

  if (hasLeftNeighbor || hasRightNeighbor) {
    const direction = hasLeftNeighbor ? "left" : "right";
    beamSegments.push({
      kind: "partial",
      measureId: mark.measureId,
      beatId: mark.beatId,
      level,
      direction,
      x1: direction === "left" ? mark.stemX - 10 : mark.stemX,
      x2: direction === "left" ? mark.stemX : mark.stemX + 10,
      y: mark.stemBaseY + (level - 1) * DURATION_LEVEL_GAP,
    });
  }
}
```

- [ ] **Step 4: 为方向规则补中文注释，并保留时值模块职责边界**

```ts
/**
 * 当某一层连梁只有单个 beat 时，统一输出 kind="partial" 的 beam segment，
 * 而不是退回为 flag。
 * 如果它左侧存在同段较低层节奏上下文，则短横线朝左；
 * 否则朝右。这样可以覆盖“附点八分 + 十六分”的常见记谱。
 */
```

- [ ] **Step 5: 在 `measure-layout.ts` 的 `layoutMeasure` 中接回 `beamSegments`**

```ts
const beamSegments = buildBeamGeometry(measure.beats, durationMarkByBeatId);

return {
  // ...
  durationMarks,
  beamSegments,
};
```

- [ ] **Step 6: 确认 `score-layout.ts` 仍只做门面导出，不回收 partial beam 细节逻辑**

```ts
export * from "./layout-types";
export { layoutMeasure } from "./measure-layout";
```

- [ ] **Step 7: 跑测试确认通过**

Run:

```bash
pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/layout.test.ts
```

Expected:

```text
PASS packages/lxm-tabeditor/tests/layout.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add packages/lxm-tabeditor/src/layout/layout-types.ts packages/lxm-tabeditor/src/layout/duration-layout.ts packages/lxm-tabeditor/src/layout/measure-layout.ts packages/lxm-tabeditor/src/layout/score-layout.ts packages/lxm-tabeditor/tests/layout.test.ts
git commit -m "feat: add unified beam segment geometry to score layout"
```

### Task 3: 页面按 beamSegments 渲染，并抑制已覆盖层级的 flag

**Files:**
- Modify: `apps/website/components/editor-shell/ScorePreview.tsx`

**Interfaces:**
- Consumes:
  - `measure.beamSegments: LaidOutBeamSegment[]`
  - `mark.flagCount: 0 | 1 | 2 | 3`
- Produces:
  - `shared` / `partial` 两类 beam segment 的 `<rect />` 渲染
  - flag 只在未被任意 beam segment 覆盖的层级上输出

- [ ] **Step 1: 按 `kind` 过滤并渲染 beam segment**

```tsx
{measure.beamSegments.map((beam) => (
  <rect
    className={styles["duration-beam-svg"]}
    height={2}
    key={
      beam.kind === "shared"
        ? `${measure.id}-beam-shared-${beam.level}-${beam.beatIds.join("-")}`
        : `${measure.id}-beam-partial-${beam.beatId}-${beam.level}`
    }
    rx={1.5}
    width={Math.max(0, beam.x2 - beam.x1)}
    x={beam.x1}
    y={beam.y - 1.5}
  />
))}
```

- [ ] **Step 2: 为单个 mark 计算 partial beam 覆盖的层级**

```tsx
const coveredBeamLevels = new Set(
  measure.beamSegments
    .filter((beam) =>
      beam.kind === "shared"
        ? beam.beatIds.includes(mark.beatId)
        : beam.beatId === mark.beatId,
    )
    .map((beam) => beam.level),
);
```

- [ ] **Step 3: 调整 flag 兜底判断**

```tsx
if (coveredBeamLevels.has(level)) return null;
```

- [ ] **Step 4: 保持现有 flag path 不变，只改变是否渲染的判定**

```tsx
<path
  className={styles["duration-flag-svg"]}
  d={`
    M ${mark.stemX} ${flagY}
    Q ${mark.stemX + 4} ${flagY - 2} ${mark.stemX + 8} ${flagY - 6}
    Q ${mark.stemX + 8.5} ${flagY - 8} ${mark.stemX + 8} ${flagY - 10}
  `}
  key={`${mark.beatId}-flag-${level}`}
/>
```

- [ ] **Step 5: 运行页面类型检查**

Run:

```bash
pnpm --filter @liuxianmao/website type-check
```

Expected:

```text
exit 0
```

- [ ] **Step 6: Commit**

```bash
git add apps/website/components/editor-shell/ScorePreview.tsx
git commit -m "feat: render partial beams in score preview"
```

### Task 4: 全量验证与回归检查

**Files:**
- Test: `packages/lxm-tabeditor/tests/layout.test.ts`
- Verify: `packages/lxm-tabeditor/src/layout/layout-types.ts`
- Verify: `packages/lxm-tabeditor/src/layout/duration-layout.ts`
- Verify: `packages/lxm-tabeditor/src/layout/measure-layout.ts`
- Verify: `packages/lxm-tabeditor/src/layout/score-layout.ts`
- Verify: `apps/website/components/editor-shell/ScorePreview.tsx`

**Interfaces:**
- Consumes: 以上全部改动
- Produces: 可复核的测试结果与人工验收要点

- [ ] **Step 1: 跑 layout 单测**

```bash
pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/layout.test.ts
```

- [ ] **Step 2: 跑核心包类型检查**

```bash
pnpm --filter @liuxianmao/lxm-tabeditor type-check
```

- [ ] **Step 3: 跑网站类型检查**

```bash
pnpm --filter @liuxianmao/website type-check
```

- [ ] **Step 4: 人工浏览器验收第 2 小节**

```text
验收点：
1. beat-002-02 / beat-002-03 / beat-002-04 共享第一层连梁。
2. beat-002-04 的第二层显示为朝左的短横线，而不是独立符尾。
3. beat-002-03 仍显示附点，不改数据语义。
4. 第 1 小节孤立十六分音符仍保留 flag fallback。
5. 页面层没有通过 `beatIds.length === 1` 这类隐式规则猜测 partial beam，而是显式依赖 `kind`。
```

- [ ] **Step 5: Commit**

```bash
git add packages/lxm-tabeditor/src/layout/layout-types.ts packages/lxm-tabeditor/src/layout/duration-layout.ts packages/lxm-tabeditor/src/layout/measure-layout.ts packages/lxm-tabeditor/src/layout/score-layout.ts packages/lxm-tabeditor/tests/layout.test.ts apps/website/components/editor-shell/ScorePreview.tsx
git commit -m "test: verify beam segment rendering end to end"
```

## Self-Review

- 计划范围只覆盖 beam 几何抽象和 partial beam 补齐，不混入新的时值模型或数据重排。
- 所有后续任务都基于当前已有的 `durationMarks` 结构增量扩展，把完整连梁和 partial beam 统一建模为 `beamSegments`，没有把几何逻辑推回 React，也不把时值细节重新塞回 `score-layout.ts` 门面文件。
- 已覆盖“附点八分 + 十六分”和“孤立十六分 fallback”两类关键边界，避免只修一个示例。

**Plan complete and saved to `docs/superpowers/plans/2026-06-22-partial-beam-rendering.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
