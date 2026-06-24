# Tie Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 TAB 预览补齐真实的 tie 几何渲染，让 `note.tie.targetNoteId` 能从数据层一路传到 layout / 预览层，正确连接源音与目标音，并在跨行时自动拆成多个视觉 segment，而不是只在源音头顶画一段固定小弧线。

**Architecture:** 继续以 `packages/lxm-tabeditor` 的 layout 层作为唯一几何来源。`measure-layout.ts` 只保留 note 上的 tie 目标信息，`score-layout.ts` 在汇总整首谱 layout 时基于所有 laid out note 生成逻辑级 `ties`，并进一步按 system 边界拆成可直接渲染的 `segments`。页面层 `ScorePreview.tsx` 只消费 `layout.ties[*].segments` 生成 SVG path，不在 React 中重新解析领域数据或猜测目标坐标。

**Tech Stack:** TypeScript, Vitest, React, SVG, Next.js, SCSS Modules

## Global Constraints

- 本轮只处理同一 score layout 内的 tie 几何输出与渲染，不扩展新的编辑命令。
- tie 的关系来源必须仍然是 `TabNote["tie"]`，不能在页面层通过音高或相邻音符反推。
- layout 层负责关系解析和端点几何，页面层只负责 path 样式渲染。
- 保持最小化改动，不借机重构 `ScorePreview.tsx` 的其他渲染分支。
- 复杂坐标和跨小节关系判断必须补中文注释。
- 继续兼容当前门面导出结构：调用方仍通过 `@liuxianmao/lxm-tabeditor` / `layoutScore` 获取 layout。
- 本轮必须支持同一 system 内和跨 system 的 tie；跨行时必须拆成多个视觉 segment，不能画一条穿越行间空白的长曲线。
- 至少运行 `packages/lxm-tabeditor` 的 layout 单测、`@liuxianmao/lxm-tabeditor` 类型检查和 `@liuxianmao/website` 类型检查。

---

### Task 1: 先补 tie 的失败测试和验收断言

**Files:**
- Modify: `packages/lxm-tabeditor/tests/layout.test.ts`

**Interfaces:**
- Consumes: `createExampleDocument(): LxmScoreDocument`
- Consumes: `layoutScore(score): ScoreLayout`
- Produces:
  - `ScoreLayout["ties"]` 的测试断言
  - 跨小节 tie 的源/目标 note id、measure id、几何方向断言
  - `measuresPerSystem: 3` 下跨行 tie 的 segment 断言

- [ ] **Step 1: 在测试文件中补充 tie 辅助类型**

```ts
interface TestTie {
  id: string;
  fromNoteId: string;
  toNoteId: string;
  fromMeasureId: string;
  toMeasureId: string;
  segments: Array<{
    id: string;
    systemIndex: number;
    role: "single" | "start" | "middle" | "end";
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }>;
}
```

- [ ] **Step 2: 为示例中的跨小节 tie 新增失败断言**

```ts
it("为跨小节延音输出逻辑 tie 和单段 segment", () => {
  const document = createExampleDocument();
  const layout = layoutScore(document.score) as typeof layoutScore extends (
    ...args: never[]
  ) => infer T
    ? T & { ties?: TestTie[] }
    : never;

  expect(layout.ties).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        fromNoteId: "note-003-03-01",
        toNoteId: "note-004-01-01",
        fromMeasureId: "measure-003",
        toMeasureId: "measure-004",
        segments: [
          expect.objectContaining({
            role: "single",
          }),
        ],
      }),
    ]),
  );
});
```

- [ ] **Step 3: 为同一行 tie 的方向性补充 segment 断言**

```ts
it("同一行 tie 的单段 segment 右端点必须位于目标音方向", () => {
  const document = createExampleDocument();
  const layout = layoutScore(document.score) as typeof layoutScore extends (
    ...args: never[]
  ) => infer T
    ? T & { ties?: TestTie[] }
    : never;

  const tie = layout.ties?.find(
    (item) => item.fromNoteId === "note-003-03-01",
  );
  const segment = tie?.segments[0];

  expect(tie).toBeDefined();
  expect(segment).toBeDefined();
  expect(segment!.role).toBe("single");
  expect(segment!.x2).toBeGreaterThan(segment!.x1);
  expect(segment!.y2).toBe(segment!.y1);
});
```

- [ ] **Step 4: 为跨行 tie 补充失败断言**

```ts
it("跨行 tie 会按 system 边界拆成 start 和 end 两段", () => {
  const document = createExampleDocument();
  const layout = layoutScore(document.score, {
    measuresPerSystem: 3,
  }) as typeof layoutScore extends (...args: never[]) => infer T
    ? T & { ties?: TestTie[] }
    : never;

  const tie = layout.ties?.find(
    (item) => item.fromNoteId === "note-003-03-01",
  );

  expect(tie?.segments).toEqual([
    expect.objectContaining({
      systemIndex: 0,
      role: "start",
    }),
    expect.objectContaining({
      systemIndex: 1,
      role: "end",
    }),
  ]);
});
```

- [ ] **Step 5: 运行测试确认当前失败**

Run:

```bash
pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/layout.test.ts
```

Expected:

```text
FAIL ... Property 'ties' does not exist on type 'ScoreLayout'
```

- [ ] **Step 6: Commit**

```bash
git add packages/lxm-tabeditor/tests/layout.test.ts
git commit -m "test: add failing tie layout coverage"
```

### Task 2: 在 layout 层保留 tie 目标信息并生成支持跨行的 ties / segments

**Files:**
- Modify: `packages/lxm-tabeditor/src/layout/layout-types.ts`
- Modify: `packages/lxm-tabeditor/src/layout/measure-layout.ts`
- Modify: `packages/lxm-tabeditor/src/layout/score-layout.ts`
- Verify: `packages/lxm-tabeditor/src/index.ts`
- Test: `packages/lxm-tabeditor/tests/layout.test.ts`

**Interfaces:**
- Consumes:
  - `TabNote["tie"]`
  - `LaidOutMeasure["notes"]`
  - `layoutScore(score): ScoreLayout`
- Produces:
  - `LaidOutNote["tieTargetNoteId"]?: string`
  - `interface LaidOutTieSegment`
  - `interface LaidOutTie`
  - `ScoreLayout["ties"]: LaidOutTie[]`

- [ ] **Step 1: 在 `layout-types.ts` 中把 note 的 tie 目标保留下来，并新增 `LaidOutTieSegment` / `LaidOutTie`**

```ts
export interface LaidOutNote {
  id: string;
  beatId: string;
  measureId: string;
  fret: string;
  string: number;
  x: number;
  y: number;
  tieTargetNoteId?: string;
  ghost: boolean;
}

export interface LaidOutTieSegment {
  id: string;
  tieId: string;
  systemIndex: number;
  role: "single" | "start" | "middle" | "end";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface LaidOutTie {
  id: string;
  fromNoteId: string;
  toNoteId: string;
  fromMeasureId: string;
  toMeasureId: string;
  segments: LaidOutTieSegment[];
}

export interface ScoreLayout {
  width: number;
  height: number;
  zoom: number;
  tempo: number;
  systems: LaidOutSystem[];
  ties: LaidOutTie[];
  hitIndex: LayoutHitIndex;
}
```

- [ ] **Step 2: 在 `measure-layout.ts` 中保留 `tieTargetNoteId`，不再压缩成 `tied: boolean`**

```ts
return {
  id: note.id,
  beatId: beat.id,
  measureId: measure.id,
  fret: String(note.fret),
  string: note.string,
  x,
  y,
  ...(note.tie ? { tieTargetNoteId: note.tie.targetNoteId } : {}),
  ghost: Boolean(note.ghost),
};
```

- [ ] **Step 3: 在 `score-layout.ts` 中新增 tie 汇总函数**

```ts
type TieAnchor = {
  note: LaidOutNote;
  systemIndex: number;
  systemX: number;
  systemWidth: number;
};

const buildLaidOutTies = (systems: LaidOutSystem[]): LaidOutTie[] => {
  const anchors = systems.flatMap((system) =>
    system.measures.flatMap((measure) =>
      measure.notes.map((note) => ({
        note,
        systemIndex: system.index,
        systemX: system.x,
        systemWidth: system.width,
      })),
    ),
  );
  const anchorByNoteId = new Map(
    anchors.map((anchor) => [anchor.note.id, anchor] as const),
  );

  return anchors.flatMap((sourceAnchor) => {
    const targetId = sourceAnchor.note.tieTargetNoteId;
    if (!targetId) return [];
    const targetAnchor = anchorByNoteId.get(targetId);
    if (!targetAnchor) return [];

    return [
      {
        id: `${sourceAnchor.note.id}__${targetAnchor.note.id}`,
        fromNoteId: sourceAnchor.note.id,
        toNoteId: targetAnchor.note.id,
        fromMeasureId: sourceAnchor.note.measureId,
        toMeasureId: targetAnchor.note.measureId,
        segments: buildTieSegments(sourceAnchor, targetAnchor),
      },
    ];
  });
};
```

- [ ] **Step 4: 在 `score-layout.ts` 中实现按 system 拆分的 `buildTieSegments`**

```ts
const TIE_SYSTEM_PADDING = 12;

const buildTieSegments = (
  source: TieAnchor,
  target: TieAnchor,
): LaidOutTieSegment[] => {
  if (source.systemIndex === target.systemIndex) {
    return [
      {
        id: `${source.note.id}__${target.note.id}__single`,
        tieId: `${source.note.id}__${target.note.id}`,
        systemIndex: source.systemIndex,
        role: "single",
        x1: source.note.x,
        y1: source.note.y,
        x2: target.note.x,
        y2: target.note.y,
      },
    ];
  }

  return [
    {
      id: `${source.note.id}__${target.note.id}__start`,
      tieId: `${source.note.id}__${target.note.id}`,
      systemIndex: source.systemIndex,
      role: "start",
      x1: source.note.x,
      y1: source.note.y,
      x2: source.systemX + source.systemWidth - TIE_SYSTEM_PADDING,
      y2: source.note.y,
    },
    {
      id: `${source.note.id}__${target.note.id}__end`,
      tieId: `${source.note.id}__${target.note.id}`,
      systemIndex: target.systemIndex,
      role: "end",
      x1: target.systemX + TIE_SYSTEM_PADDING,
      y1: target.note.y,
      x2: target.note.x,
      y2: target.note.y,
    },
  ];
};
```

- [ ] **Step 5: 把 `ties` 挂到 `layoutScore` 的返回值上**

```ts
const ties = buildLaidOutTies(systems);

return {
  width,
  height:
    systems.length * SYSTEM_HEIGHT +
    Math.max(0, systems.length - 1) * SYSTEM_GAP,
  zoom,
  tempo: score.meta.tempo,
  systems,
  ties,
  hitIndex,
};
```

- [ ] **Step 6: 为跨 system 分段规则补中文注释**

```ts
/**
 * tie 是逻辑关系，segment 才是实际渲染片段。
 * 同一行内输出 single；跨行时拆成 start / end，
 * 避免页面层画出一条穿越 system 间空白区域的长曲线。
 */
const buildLaidOutTies = (systems: LaidOutSystem[]): LaidOutTie[] => {
  // ...
};
```

- [ ] **Step 7: 运行测试确认 layout 输出已补齐**

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
git add \
  packages/lxm-tabeditor/src/layout/layout-types.ts \
  packages/lxm-tabeditor/src/layout/measure-layout.ts \
  packages/lxm-tabeditor/src/layout/score-layout.ts \
  packages/lxm-tabeditor/tests/layout.test.ts
git commit -m "feat: emit tie geometry from layout"
```

### Task 3: 在 `ScorePreview` 中改为消费 `layout.ties[*].segments` 渲染真实延音线

**Files:**
- Modify: `apps/website/components/editor-shell/ScorePreview.tsx`
- Modify: `apps/website/components/editor-shell/ScorePreview.module.scss`
- Verify: `packages/lxm-tabeditor/src/index.ts`
- Test: `packages/lxm-tabeditor/tests/layout.test.ts`

**Interfaces:**
- Consumes:
  - `layoutScore(score, { zoom }): ScoreLayout`
  - `ScoreLayout["ties"][number]["segments"]`
- Produces:
  - 基于 tie segment 几何的 SVG tie path
  - 删除基于 `note.tied` 的局部假弧线渲染

- [ ] **Step 1: 在 `ScorePreview.tsx` 中新增基于 segment 的 tie path 生成函数**

```ts
const getTiePath = (segment: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}) => {
  const startX = segment.x1 + 8;
  const endX = segment.x2 - 8;
  const baselineY = segment.y1 - 11;
  const controlOffsetX = Math.max(12, (endX - startX) / 3);
  const controlY = baselineY - 10;

  return `
    M ${startX} ${baselineY}
    C ${startX + controlOffsetX} ${controlY}
      ${endX - controlOffsetX} ${controlY}
      ${endX} ${baselineY}
  `;
};
```

- [ ] **Step 2: 删除单音本地 `note.tied` 弧线渲染**

把这一段：

```tsx
{note.tied ? (
  <path
    className={styles["tie-svg"]}
    d={`M ${note.x - 14} ${note.y - 11} Q ${note.x} ${note.y - 22} ${note.x + 14} ${note.y - 11}`}
  />
) : null}
```

改为仅保留 fret 文本渲染：

```tsx
<g key={note.id}>
  <text
    className={
      note.id === activeNote?.id
        ? `${styles["fret-note-svg"]} ${styles["active-note-svg"]}`
        : note.ghost
          ? `${styles["fret-note-svg"]} ${styles["ghost-note-svg"]}`
          : styles["fret-note-svg"]
    }
    x={note.x}
    y={note.y + 4}
  >
      {note.fret}
  </text>
</g>
```

- [ ] **Step 3: 在音符层之前统一渲染所有 `segments`**

```tsx
{layout.ties.flatMap((tie) =>
  tie.segments.map((segment) => (
    <path
      key={segment.id}
      className={styles["tie-svg"]}
      d={getTiePath(segment)}
    />
  )),
)}
```

- [ ] **Step 4: 如有必要，在样式中确认 tie 的层级和描边**

```scss
.tie-svg {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  opacity: 0.9;
}
```

- [ ] **Step 5: 运行类型检查与回归验证**

Run:

```bash
pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/layout.test.ts
pnpm --filter @liuxianmao/lxm-tabeditor type-check
pnpm --filter @liuxianmao/website type-check
```

Expected:

```text
PASS packages/lxm-tabeditor/tests/layout.test.ts
Done in ...s
Done in ...s
```

- [ ] **Step 6: Commit**

```bash
git add \
  apps/website/components/editor-shell/ScorePreview.tsx \
  apps/website/components/editor-shell/ScorePreview.module.scss \
  packages/lxm-tabeditor/src/layout/layout-types.ts \
  packages/lxm-tabeditor/src/layout/measure-layout.ts \
  packages/lxm-tabeditor/src/layout/score-layout.ts \
  packages/lxm-tabeditor/tests/layout.test.ts
git commit -m "feat: render ties from layout geometry"
```

## Self-Review

- **Spec coverage:** 计划覆盖了 tie 的测试、layout 关系透传、全局几何输出、跨行 segment 拆分和预览层真实渲染，没有遗漏当前讨论的跨小节 / 跨行 tie 场景。
- **Placeholder scan:** 所有任务都给出了明确文件、接口、命令和代码片段，没有保留 TBD/TODO。
- **Type consistency:** 计划统一使用 `tieTargetNoteId`、`LaidOutTieSegment`、`LaidOutTie`、`ScoreLayout["ties"]` 这组命名，避免再次退回 `tied: boolean` 的弱信息模型。

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-23-tie-rendering.md`.

Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
