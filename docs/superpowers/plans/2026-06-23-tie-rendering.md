# Tie Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 TAB 预览补齐真实的 tie 几何渲染，让 `note.tie.targetNoteId` 能从数据层一路传到 layout / 预览层，正确连接源音与目标音，而不是只在源音头顶画一段固定小弧线。

**Architecture:** 继续以 `packages/lxm-tabeditor` 的 layout 层作为唯一几何来源。`measure-layout.ts` 只保留 note 上的 tie 目标信息，`score-layout.ts` 在汇总整首谱 layout 时基于所有 laid out note 生成全局 `ties` 集合，页面层 `ScorePreview.tsx` 只消费 `layout.ties` 生成 SVG path，不在 React 中重新解析领域数据或猜测目标坐标。

**Tech Stack:** TypeScript, Vitest, React, SVG, Next.js, SCSS Modules

## Global Constraints

- 本轮只处理同一 score layout 内的 tie 几何输出与渲染，不扩展新的编辑命令。
- tie 的关系来源必须仍然是 `TabNote["tie"]`，不能在页面层通过音高或相邻音符反推。
- layout 层负责关系解析和端点几何，页面层只负责 path 样式渲染。
- 保持最小化改动，不借机重构 `ScorePreview.tsx` 的其他渲染分支。
- 复杂坐标和跨小节关系判断必须补中文注释。
- 继续兼容当前门面导出结构：调用方仍通过 `@liuxianmao/lxm-tabeditor` / `layoutScore` 获取 layout。
- 本轮先支持同一 system 内的跨 beat / 跨小节 tie；若未来出现跨 system tie，允许先输出为可识别但不渲染的几何数据或显式跳过。
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

- [ ] **Step 1: 在测试文件中补充 tie 辅助类型**

```ts
interface TestTie {
  id: string;
  fromNoteId: string;
  toNoteId: string;
  fromMeasureId: string;
  toMeasureId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
```

- [ ] **Step 2: 为示例中的跨小节 tie 新增失败断言**

```ts
it("为跨小节延音输出 tie 几何端点", () => {
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
      }),
    ]),
  );
});
```

- [ ] **Step 3: 为 tie 的方向性补充几何断言**

```ts
it("tie 几何右端点必须位于目标音方向", () => {
  const document = createExampleDocument();
  const layout = layoutScore(document.score) as typeof layoutScore extends (
    ...args: never[]
  ) => infer T
    ? T & { ties?: TestTie[] }
    : never;

  const tie = layout.ties?.find(
    (item) => item.fromNoteId === "note-003-03-01",
  );

  expect(tie).toBeDefined();
  expect(tie!.x2).toBeGreaterThan(tie!.x1);
  expect(tie!.y2).toBe(tie!.y1);
});
```

- [ ] **Step 4: 运行测试确认当前失败**

Run:

```bash
pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/layout.test.ts
```

Expected:

```text
FAIL ... Property 'ties' does not exist on type 'ScoreLayout'
```

- [ ] **Step 5: Commit**

```bash
git add packages/lxm-tabeditor/tests/layout.test.ts
git commit -m "test: add failing tie layout coverage"
```

### Task 2: 在 layout 层保留 tie 目标信息并生成全局 ties

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
  - `interface LaidOutTie`
  - `ScoreLayout["ties"]: LaidOutTie[]`

- [ ] **Step 1: 在 `layout-types.ts` 中把 note 的 tie 目标保留下来，并新增 `LaidOutTie`**

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

export interface LaidOutTie {
  id: string;
  fromNoteId: string;
  toNoteId: string;
  fromMeasureId: string;
  toMeasureId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
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
const buildLaidOutTies = (systems: LaidOutSystem[]): LaidOutTie[] => {
  const notes = systems.flatMap((system) =>
    system.measures.flatMap((measure) => measure.notes),
  );
  const noteById = new Map(notes.map((note) => [note.id, note] as const));

  return notes.flatMap((note) => {
    if (!note.tieTargetNoteId) return [];
    const target = noteById.get(note.tieTargetNoteId);
    if (!target) return [];

    return [
      {
        id: `${note.id}__${target.id}`,
        fromNoteId: note.id,
        toNoteId: target.id,
        fromMeasureId: note.measureId,
        toMeasureId: target.measureId,
        x1: note.x,
        y1: note.y,
        x2: target.x,
        y2: target.y,
      },
    ];
  });
};
```

- [ ] **Step 4: 把 `ties` 挂到 `layoutScore` 的返回值上**

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

- [ ] **Step 5: 为跨 system 预留最小保护和中文注释**

```ts
/**
 * 当前先输出单段 tie 几何。
 * 如果未来分页/换 system 后出现跨行 tie，需要在这里把一条 tie 拆成多个 segment；
 * 本轮先保持端点模型，避免把分页规则耦合进页面层。
 */
const buildLaidOutTies = (systems: LaidOutSystem[]): LaidOutTie[] => {
  // ...
};
```

- [ ] **Step 6: 运行测试确认 layout 输出已补齐**

Run:

```bash
pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/layout.test.ts
```

Expected:

```text
PASS packages/lxm-tabeditor/tests/layout.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add \
  packages/lxm-tabeditor/src/layout/layout-types.ts \
  packages/lxm-tabeditor/src/layout/measure-layout.ts \
  packages/lxm-tabeditor/src/layout/score-layout.ts \
  packages/lxm-tabeditor/tests/layout.test.ts
git commit -m "feat: emit tie geometry from layout"
```

### Task 3: 在 `ScorePreview` 中改为消费 `layout.ties` 渲染真实延音线

**Files:**
- Modify: `apps/website/components/editor-shell/ScorePreview.tsx`
- Modify: `apps/website/components/editor-shell/ScorePreview.module.scss`
- Verify: `packages/lxm-tabeditor/src/index.ts`
- Test: `packages/lxm-tabeditor/tests/layout.test.ts`

**Interfaces:**
- Consumes:
  - `layoutScore(score, { zoom }): ScoreLayout`
  - `ScoreLayout["ties"]`
- Produces:
  - 基于源/目标 note 几何的 SVG tie path
  - 删除基于 `note.tied` 的局部假弧线渲染

- [ ] **Step 1: 在 `ScorePreview.tsx` 中新增 tie path 生成函数**

```ts
const getTiePath = (tie: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}) => {
  const startX = tie.x1 + 8;
  const endX = tie.x2 - 8;
  const baselineY = tie.y1 - 11;
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

- [ ] **Step 3: 在音符层之前统一渲染 `layout.ties`**

```tsx
{layout.ties.map((tie) => (
  <path
    key={tie.id}
    className={styles["tie-svg"]}
    d={getTiePath(tie)}
  />
))}
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

- **Spec coverage:** 计划覆盖了 tie 的测试、layout 关系透传、全局几何输出和预览层真实渲染，没有遗漏当前讨论的跨小节 tie 场景。
- **Placeholder scan:** 所有任务都给出了明确文件、接口、命令和代码片段，没有保留 TBD/TODO。
- **Type consistency:** 计划统一使用 `tieTargetNoteId`、`LaidOutTie`、`ScoreLayout["ties"]` 这组命名，避免再次退回 `tied: boolean` 的弱信息模型。

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-23-tie-rendering.md`.

Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
