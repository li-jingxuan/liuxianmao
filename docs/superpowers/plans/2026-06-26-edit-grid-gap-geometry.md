# Edit Grid Gap Geometry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 edit grid 在前导 gap 场景下 `gap` slot 宽度塌缩为 `1px`、且与首个 `beat` slot 共享命中边界的问题，保证 gap 可点击且命中语义稳定。

**Architecture:** 保持现有 `layoutMeasureSpacing` 的真实 beat 排版规则不变，只修正 edit-grid 使用的“tick -> x”投影边界。前导 gap 需要拥有独立的时间轴左边界，而不是绑定到首个真实 beat 的 `x`。命中层则只收紧 edit-grid slot 的 x 边界判定，避免相邻 slot 在共享边界处双命中。

**Tech Stack:** TypeScript, Vitest, 现有 `layoutScore` / `hitTestScoreLayout` 布局链路

## Global Constraints

- 使用整数 tick 时间轴，不引入浮点领域语义。
- 写操作语义保持不变，只修复 layout/edit-grid 和 hit-test。
- 复杂几何与时间轴投影逻辑必须保留详细中文注释。
- 不做未经授权的全局重构；`layoutMeasureSpacing` 的 beat 列宽分配模型保持原样。
- 测试优先，先补失败用例，再做最小实现。

---

### Task 1: 用测试锁定“前导 gap 塌缩 + 边界重叠”现象

**Files:**
- Modify: `packages/lxm-tabeditor/tests/edit-grid.test.ts`

**Interfaces:**
- Consumes: `layoutScore(score, { editingRhythm })`, `hitTestScoreLayout(layout, point)`
- Produces: 失败测试，明确要求前导 gap 具有独立宽度与稳定命中语义

- [ ] **Step 1: 在 `tests/edit-grid.test.ts` 添加前导 gap 宽度断言**

```ts
  it("前导 gap 会生成独立宽度，而不是退化为 1px", () => {
    const layout = layoutScore(createLongBeatScore(), {
      editingRhythm: { base: "quarter", dots: 0 },
    });
    const measure = layout.systems[0]!.measures[0]! as
      (typeof layout.systems)[number]["measures"][number] &
        TestMeasureWithEditGrid;
    const leadingGapSlot = measure.editGrid?.slots.find(
      (slot) => slot.kind === "gap" && slot.tick === 0,
    );
    const firstBeatSlot = measure.editGrid?.slots.find(
      (slot) => slot.kind === "beat" && slot.tick === 960,
    );

    expect(leadingGapSlot).toBeDefined();
    expect(firstBeatSlot).toBeDefined();
    expect(leadingGapSlot?.width).toBeGreaterThan(1);
    expect(leadingGapSlot?.x).toBeLessThan(firstBeatSlot!.x);
    expect(leadingGapSlot?.x + leadingGapSlot!.width).toBe(firstBeatSlot!.x);
  });
```

- [ ] **Step 2: 在同一文件添加前导 gap 命中断言**

```ts
  it("命中前导 gap 内部时返回 gap 语义，而不是首个 beat", () => {
    const layout = layoutScore(createLongBeatScore(), {
      editingRhythm: { base: "quarter", dots: 0 },
    });
    const measure = layout.systems[0]!.measures[0]! as
      (typeof layout.systems)[number]["measures"][number] &
        TestMeasureWithEditGrid;
    const leadingGapSlot = measure.editGrid?.slots.find(
      (slot) => slot.kind === "gap" && slot.tick === 0,
    );
    expect(leadingGapSlot).toBeDefined();
    if (!leadingGapSlot) return;

    const hit = hitTestScoreLayout(layout, {
      x: leadingGapSlot.x + leadingGapSlot.width / 2,
      y: measure.y + measure.staffTop + measure.stringSpacing * 2,
    });

    expect(hit).toMatchObject({
      measureId: "measure-001",
      tick: 0,
      slotId: leadingGapSlot.id,
      slotKind: "gap",
      gapStartTick: 0,
      gapEndTick: 960,
    });
  });
```

- [ ] **Step 3: 在同一文件添加共享边界命中归属断言**

```ts
  it("前导 gap 与首个 beat 共边界时，边界点归属于 beat", () => {
    const layout = layoutScore(createLongBeatScore(), {
      editingRhythm: { base: "quarter", dots: 0 },
    });
    const measure = layout.systems[0]!.measures[0]! as
      (typeof layout.systems)[number]["measures"][number] &
        TestMeasureWithEditGrid;
    const firstBeatSlot = measure.editGrid?.slots.find(
      (slot) => slot.kind === "beat" && slot.tick === 960,
    );
    expect(firstBeatSlot).toBeDefined();
    if (!firstBeatSlot || firstBeatSlot.kind !== "beat") return;

    const hit = hitTestScoreLayout(layout, {
      x: firstBeatSlot.x,
      y: measure.y + measure.staffTop + measure.stringSpacing * 2,
    });

    expect(hit).toMatchObject({
      slotKind: "beat",
      beatId: firstBeatSlot.coveringBeatId,
      tick: 960,
      slotId: firstBeatSlot.id,
    });
  });
```

- [ ] **Step 4: 运行失败测试，确认问题已被测试捕获**

Run: `pnpm --filter @liuxianmao/lxm-tabeditor test -- edit-grid.test.ts`  
Expected: 新增前导 gap 用例失败，表现为 `width` 仍为 `1` 或命中结果落到错误 slot。

- [ ] **Step 5: 提交测试基线**

```bash
git add packages/lxm-tabeditor/tests/edit-grid.test.ts
git commit -m "test: capture leading gap edit-grid regression"
```

### Task 2: 修复前导 gap 的时间轴投影几何

**Files:**
- Modify: `packages/lxm-tabeditor/src/layout/measure-spacing.ts`
- Modify: `packages/lxm-tabeditor/src/layout/layout-helpers.ts`
- Modify: `packages/lxm-tabeditor/src/layout/edit-grid.ts`
- Test: `packages/lxm-tabeditor/tests/edit-grid.test.ts`

**Interfaces:**
- Consumes: `projectTickToMeasureX(spacing, measure, { measureX, timeSignature, tick })`
- Produces: 前导 gap 拥有独立宽度；beat 的既有 x 不变；中间 gap / 尾部 gap 行为保持稳定

- [ ] **Step 1: 在 `layout-helpers.ts` 收紧左边界语义，避免把非空小节左边界绑定到首个 beat**

```ts
/**
 * edit-grid 的时间轴左边界始终从小节内部 padding 开始。
 *
 * 真实 beat 的视觉列起点仍由 spacing.slotsByBeatId 决定；这里返回的是“时间轴”
 * 左边界，而不是“首个真实音乐事件”的起点。这样前导 gap 才能拥有独立水平空间。
 */
export const getMeasureInnerLeftX = (
  _spacing: MeasureSpacingSummary,
  measureX: number,
): number => measureX + MEASURE_PADDING_X;
```

- [ ] **Step 2: 在 `measure-spacing.ts` 保持 beat slot 不动，只修正投影 anchor 解释**

```ts
  const leftX = getMeasureInnerLeftX(spacing, context.measureX);
  const rightX = getMeasureInnerRightX(spacing, context.measureX);
  const sortedBeats = [...measure.beats].sort((left, right) => left.tick - right.tick);
  const timelineAnchors = [
    { tick: 0, x: leftX },
    ...sortedBeats.flatMap((beat, index) => {
      const slot = spacing.slotsByBeatId[beat.id];
      if (!slot) return [];

      const beatTicks = getBeatTicks(beat, measure.tuplets);
      const nextBeat = sortedBeats[index + 1];
      const nextSlot = nextBeat ? spacing.slotsByBeatId[nextBeat.id] : undefined;
      const nextBoundaryTick = nextBeat?.tick ?? capacityTicks;
      const nextBoundaryX = nextSlot?.x ?? rightX;
      const beatEndTick = Math.min(beat.tick + beatTicks, capacityTicks);

      const anchors = [{ tick: beat.tick, x: slot.x }];
      if (beatEndTick > beat.tick && beatEndTick < nextBoundaryTick) {
        const ratio =
          nextBoundaryTick === beat.tick
            ? 0
            : (beatEndTick - beat.tick) / (nextBoundaryTick - beat.tick);
        anchors.push({
          tick: beatEndTick,
          x: slot.x + (nextBoundaryX - slot.x) * ratio,
        });
      }

      return anchors;
    }),
    { tick: capacityTicks, x: rightX },
  ].sort((left, right) => left.tick - right.tick);
```

说明：代码结构基本不改，重点是让 `tick=0` anchor 真正落在 padding 左边界；这样 `tick=0 -> firstBeat.tick` 的线性插值自然形成前导 gap 宽度。

- [ ] **Step 3: 在 `edit-grid.ts` 保留 width 兜底，但加中文注释说明 1px 只用于异常几何，不应再覆盖正常前导 gap**

```ts
      /**
       * 正常情况下，slot 宽度应来自相邻两个 tick 投影点的差值。
       * 这里只保留 1px 兜底，防御异常数据或浮点舍入，不再承担“前导 gap 没有空间”的补偿职责。
       */
      const width = Math.max(1, nextX - x);
```

- [ ] **Step 4: 运行 edit-grid 测试，确认前导 / 中间 / 尾部 gap 全部通过**

Run: `pnpm --filter @liuxianmao/lxm-tabeditor test -- edit-grid.test.ts`  
Expected: PASS，且已有中间 gap、尾部 gap 用例不回归。

- [ ] **Step 5: 提交几何修复**

```bash
git add \
  packages/lxm-tabeditor/src/layout/layout-helpers.ts \
  packages/lxm-tabeditor/src/layout/measure-spacing.ts \
  packages/lxm-tabeditor/src/layout/edit-grid.ts \
  packages/lxm-tabeditor/tests/edit-grid.test.ts
git commit -m "fix: project leading gap geometry in edit grid"
```

### Task 3: 修复 edit-grid 相邻 slot 的共享边界命中

**Files:**
- Modify: `packages/lxm-tabeditor/src/layout/score-layout.ts`
- Test: `packages/lxm-tabeditor/tests/edit-grid.test.ts`

**Interfaces:**
- Consumes: `measure.editGrid?.slots`
- Produces: edit-grid 命中使用半开区间；共享边界点不再被前一个 slot 抢占

- [ ] **Step 1: 在 `score-layout.ts` 提取 edit-grid 专用命中判断，避免复用闭区间 `containsPoint`**

```ts
const containsEditGridSlotPoint = (
  context: { x: number; width: number; y: number; height: number },
  point: { x: number; y: number },
): boolean =>
  point.x >= context.x &&
  point.x < context.x + context.width &&
  point.y >= context.y &&
  point.y <= context.y + context.height;
```

- [ ] **Step 2: 用 edit-grid 专用判定替换当前 `.find(...)` 内的 x 命中逻辑**

```ts
      const slot = measure.editGrid?.slots.find((item) => {
        return containsEditGridSlotPoint(
          {
            x: item.x,
            y: measure.y + measure.staffTop - HIT_PADDING,
            width: item.width,
            height: measure.staffHeight + HIT_PADDING * 2,
          },
          point,
        );
      });
```

说明：这里仅把 x 方向改为半开区间；y 方向继续沿用现有矩形高度判断，避免扩大改动面。

- [ ] **Step 3: 运行与 hit test 相关的测试文件**

Run: `pnpm --filter @liuxianmao/lxm-tabeditor test -- edit-grid.test.ts layout.test.ts`  
Expected: PASS，新增边界归属用例通过，已有点击定位用例不回归。

- [ ] **Step 4: 运行类型检查**

Run: `pnpm --filter @liuxianmao/lxm-tabeditor type-check`  
Expected: PASS

- [ ] **Step 5: 提交命中修复**

```bash
git add \
  packages/lxm-tabeditor/src/layout/score-layout.ts \
  packages/lxm-tabeditor/tests/edit-grid.test.ts
git commit -m "fix: resolve edit grid slot boundary hit overlap"
```

### Task 4: 做回归验证并整理结论

**Files:**
- Modify: `packages/lxm-tabeditor/tests/edit-grid.test.ts`（仅当断言文案或夹具需要微调）

**Interfaces:**
- Consumes: 上述所有改动
- Produces: 最终验证结论，可用于 code review / merge

- [ ] **Step 1: 运行最小回归集**

Run: `pnpm --filter @liuxianmao/lxm-tabeditor test -- edit-grid.test.ts commands.test.ts layout.test.ts`  
Expected: PASS

- [ ] **Step 2: 运行完整包测试**

Run: `pnpm --filter @liuxianmao/lxm-tabeditor test`  
Expected: PASS

- [ ] **Step 3: 记录人工验证点**

```text
1. 前导 gap 中点点击后，返回 slotKind=gap、tick=0。
2. 首个 beat 起点点击后，返回 slotKind=beat，不再被前导 gap 抢占。
3. 中间 gap 与尾部 gap 的点击行为保持不变。
4. 长 beat 内部细分 slot 的命中行为保持不变。
```

- [ ] **Step 4: 提交最终验证**

```bash
git add packages/lxm-tabeditor/tests/edit-grid.test.ts
git commit -m "test: verify edit grid gap hit geometry"
```
