# lxm-editor 附点布局 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `packages/lxm-editor` 的时值布局为每个附点输出稳定、可直接渲染的中心坐标。

**Architecture:** 附点几何从属于每个 `ILXMDurationMarkLayout`，而不是连梁段：每个 beat 都会生成一个 duration mark，即使它没有任何连梁。`duration-beam-layout.ts` 根据符干 X 坐标和连梁基线创建 `dotAnchors`；调用方只消费布局结果，不重算附点位置。

**Tech Stack:** TypeScript 6、Vitest 3、`@liuxianmao/lxm-editor`。

## Global Constraints

- 只修改 `packages/lxm-editor`；不修改 `apps/website`。
- 使用 TypeScript 与 ES6+ 语法；关键类型和计算增加中文注释。
- `rhythm.dots` 维持现有语义：仅 rhythm 层支持的 0、1、2 个附点进入 layout。
- 不改变 tick 换算、拍组分段和连梁 segment 的既有行为。
- 布局层不依赖 React、SVG 字形或具体渲染实现。

---

## 文件结构

- 修改 `packages/lxm-editor/src/layout/layout-types.ts`：声明附点锚点类型，并把附点数量和锚点数组加入每 beat 的 duration mark。
- 修改 `packages/lxm-editor/src/layout/duration-beam-layout.ts`：定义附点几何常量、构建锚点，并将其接入 `buildDurationMark`；移除调试日志。
- 修改 `packages/lxm-editor/tests/layout/duration-beam-layout.test.ts`：以最终 `layoutDurationBeams` 结果验证零、单、双附点的输出以及连梁回归。

### Task 1: 定义并产出附点布局数据

**Files:**
- Modify: `packages/lxm-editor/src/layout/layout-types.ts:164-179`
- Modify: `packages/lxm-editor/src/layout/duration-beam-layout.ts:29-42,228-259,261-294`
- Test: `packages/lxm-editor/tests/layout/duration-beam-layout.test.ts`

**Interfaces:**
- Consumes: `ILXMBeat["rhythm"]`, `ILXMBeatLayout`, `ILXMNoteLayout`, `ILXMStringLineLayout`。
- Produces: `ILXMDurationDotAnchor`, `ILXMDurationMarkLayout.dots`, `ILXMDurationMarkLayout.dotAnchors`。
- Preserves: `layoutDurationBeams(...)` 的返回结构 `ILXMDurationBeamLayoutResult`，其 `durationMarks` 项新增字段但不改变已有字段。

- [ ] **Step 1: 写出最终布局结果的失败测试**

在 `packages/lxm-editor/tests/layout/duration-beam-layout.test.ts` 的 import 中加入：

```ts
import {
  LXM_DURATION_BEAM_TOP_OFFSET_Y,
  LXM_DURATION_DOT_GAP_X,
  LXM_DURATION_DOT_OFFSET_X,
  LXM_DURATION_DOT_OFFSET_Y,
  layoutDurationBeams,
} from "../../src/layout/duration-beam-layout";
```

在现有 helper 之后加入以下 fixture 与断言。它使用真实 `layoutDurationBeams`，确保锚点进入对外的小节布局产物：

```ts
const createDurationLayoutInputs = (dots: number) => {
  const beat = createBeat("beat-dots", 0, "eighth", dots);
  const measure = createMeasure([beat]);
  const beatLayouts: ILXMBeatLayout[] = [
    {
      id: beat.id,
      measureId: measure.id,
      tick: beat.tick,
      x: 40,
      width: 24,
      rhythm: beat.rhythm,
      columnIndex: 0,
    },
  ];
  const noteLayouts: ILXMNoteLayout[] = [
    {
      id: "beat-dots-note",
      beatId: beat.id,
      measureId: measure.id,
      string: 3,
      fret: 2,
      fretText: "2",
      x: 40,
      y: 60,
    },
  ];
  const strings: ILXMStringLineLayout[] = [
    { index: 1, x1: 0, y1: 20, x2: 100, y2: 20 },
    { index: 6, x1: 0, y1: 70, x2: 100, y2: 70 },
  ];

  return { measure, beatLayouts, noteLayouts, strings };
};

describe("layoutDurationBeams 附点布局", () => {
  it("无附点 beat 保留空锚点数组", () => {
    const { measure, beatLayouts, noteLayouts, strings } =
      createDurationLayoutInputs(0);

    expect(
      layoutDurationBeams(measure, beatLayouts, noteLayouts, strings)
        .durationMarks[0],
    ).toMatchObject({ dots: 0, dotAnchors: [] });
  });

  it("单附点 beat 输出一个相对符干和连梁基线的锚点", () => {
    const { measure, beatLayouts, noteLayouts, strings } =
      createDurationLayoutInputs(1);

    expect(
      layoutDurationBeams(measure, beatLayouts, noteLayouts, strings)
        .durationMarks[0],
    ).toMatchObject({
      dots: 1,
      dotAnchors: [
        {
          x: 40 + LXM_DURATION_DOT_OFFSET_X,
          y: 70 + LXM_DURATION_BEAM_TOP_OFFSET_Y + LXM_DURATION_DOT_OFFSET_Y,
        },
      ],
    });
  });

  it("双附点 beat 输出两个等高且按固定间距排列的锚点", () => {
    const { measure, beatLayouts, noteLayouts, strings } =
      createDurationLayoutInputs(2);

    expect(
      layoutDurationBeams(measure, beatLayouts, noteLayouts, strings)
        .durationMarks[0],
    ).toMatchObject({
      dots: 2,
      dotAnchors: [
        {
          x: 40 + LXM_DURATION_DOT_OFFSET_X,
          y: 70 + LXM_DURATION_BEAM_TOP_OFFSET_Y + LXM_DURATION_DOT_OFFSET_Y,
        },
        {
          x: 40 + LXM_DURATION_DOT_OFFSET_X + LXM_DURATION_DOT_GAP_X,
          y: 70 + LXM_DURATION_BEAM_TOP_OFFSET_Y + LXM_DURATION_DOT_OFFSET_Y,
        },
      ],
    });
  });
});
```

同时将 type import 扩展为：

```ts
import type {
  ILXMBeatLayout,
  ILXMDurationMarkLayout,
  ILXMNoteLayout,
  ILXMStringLineLayout,
} from "../../src/layout/layout-types";
```

- [ ] **Step 2: 运行新增测试，确认因附点布局尚未实现而失败**

Run:

```bash
pnpm --filter @liuxianmao/lxm-editor test -- duration-beam-layout.test.ts
```

Expected: FAIL，原因是 `durationMarks[0]` 缺少 `dots` / `dotAnchors`，且新增附点常量尚未导出。

- [ ] **Step 3: 扩展 duration mark 类型**

在 `packages/lxm-editor/src/layout/layout-types.ts`、`ILXMDurationMarkLayout` 前增加：

```ts
/** 单个附点的中心坐标；渲染器据此绘制圆点或对应字形。 */
export interface ILXMDurationDotAnchor {
  x: number;
  y: number;
}
```

然后将 `ILXMDurationMarkLayout` 完整改为：

```ts
export interface ILXMDurationMarkLayout {
  beatId: string;
  measureId: string;
  stemX: number;
  stemY1: number;
  stemY2: number;
  beamY: number;
  beamLevel: number;

  /** 原始 rhythm 中的附点数量。 */
  dots: number;
  /** 每个附点的布局中心；无附点时为空数组。 */
  dotAnchors: ILXMDurationDotAnchor[];
}
```

- [ ] **Step 4: 以最小逻辑生成附点锚点并接入 duration mark**

在 `packages/lxm-editor/src/layout/duration-beam-layout.ts` 的 beam 常量之后添加：

```ts
// 第一个附点相对符干的水平偏移，以及多附点之间的水平间距。
export const LXM_DURATION_DOT_OFFSET_X = 8;
export const LXM_DURATION_DOT_GAP_X = 5;
// 附点相对连梁基线的纵向偏移，避免与横梁重叠。
export const LXM_DURATION_DOT_OFFSET_Y = 7;
```

在 `buildDurationMark` 前添加内部纯函数：

```ts
const buildDurationDotAnchors = (
  stemX: number,
  beamBaseY: number,
  dots: number,
) => Array.from({ length: dots }, (_, index) => ({
  x: stemX + LXM_DURATION_DOT_OFFSET_X + index * LXM_DURATION_DOT_GAP_X,
  y: beamBaseY + LXM_DURATION_DOT_OFFSET_Y,
}));
```

在 `buildDurationMark` 的返回对象中，在 `beamLevel` 后加入：

```ts
dots: beat.rhythm.dots,
dotAnchors: buildDurationDotAnchors(
  currentBeat.x,
  beamBaseY,
  beat.rhythm.dots,
),
```

最后删除 `layoutDurationBeams` 中的以下调试副作用：

```ts
console.log('beamGroups: ', beamGroups)
```

- [ ] **Step 5: 运行新增测试，确认附点几何通过**

Run:

```bash
pnpm --filter @liuxianmao/lxm-editor test -- duration-beam-layout.test.ts
```

Expected: PASS，包含既有连梁断言及新增的 3 个附点布局断言。

- [ ] **Step 6: 运行包级验证**

Run:

```bash
pnpm --filter @liuxianmao/lxm-editor test
pnpm --filter @liuxianmao/lxm-editor type-check
pnpm --filter @liuxianmao/lxm-editor lint
```

Expected: 三个命令均以 exit code 0 结束；测试不出现失败，类型检查和 lint 不出现错误或 warning。

- [ ] **Step 7: 提交实现**

```bash
git add \
  packages/lxm-editor/src/layout/layout-types.ts \
  packages/lxm-editor/src/layout/duration-beam-layout.ts \
  packages/lxm-editor/tests/layout/duration-beam-layout.test.ts
git commit -m "feat: add duration dot layout"
```

---

## Plan self-review

- Spec coverage: Task 1 覆盖了目标类型、附点锚点算法、单/双附点、零附点、既有连梁回归、日志清理和包级验证。
- Placeholder scan: 计划中的代码、命令、预期结果、常量值和提交内容均已明确，不含待定事项。
- Type consistency: 测试消费的 `ILXMDurationMarkLayout.dots`、`dotAnchors` 与实现定义一致；锚点输入使用 `stemX`、`beamBaseY`，输出为 `{ x, y }[]`。
