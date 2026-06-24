# Score Preview Component Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变现有谱面编辑行为和渲染结果的前提下，拆分 `ScorePreview.tsx`，把交互容器、system 级渲染、小节级渲染、交互 hooks 和 SVG 路径 helper 分离到统一的 `score-preview/` 目录下。

**Architecture:** 保留 `apps/website/components/editor-shell/ScorePreview.tsx` 作为容器入口，继续持有 store、`layoutScore()` 调用和最薄的一层页面拼装；把纯展示部分按坐标作用域拆到 `apps/website/components/editor-shell/score-preview/` 目录，把有状态且与交互强绑定的逻辑拆到同目录下的 `hooks/` 子目录。拆分优先遵循现有 layout 模型：`tie` 归 system 层，`beam/duration/note/rest/tuplet` 归 measure 层，输入/命中/字体状态抽为 hook，纯路径计算下沉到 helper 文件，避免继续在 React 组件中混写几何细节。

**Tech Stack:** Next.js 16、React 19、TypeScript 6、SCSS Modules、`@liuxianmao/lxm-tabeditor`

## Global Constraints

- 保持 `ScorePreview.tsx` 作为 Score Preview 的统一职责入口，不把这块拆散到 `editor-shell` 根目录的无关位置。
- 新增文件统一放在 `apps/website/components/editor-shell/score-preview/` 目录下，便于后续继续扩展歌词、和弦图等 Score Preview 子层。
- Hook 也必须放在 `apps/website/components/editor-shell/score-preview/hooks/` 下，保持 Score Preview 相关逻辑的物理邻近性。
- 不改 layout 层协议，不新增新的 layout 字段；拆分只重组页面层消费方式。
- 不改变键盘输入、点击命中、添加小节、激活态高亮、tie / tuplet / beam / duration / note / rest 的现有视觉行为。
- 复杂 SVG 路径计算保留详细中文注释，尤其是 tie 和时值 flag 的路径 helper。
- `apps/website` 当前没有现成组件测试 runner，本轮以 `pnpm --filter @liuxianmao/website type-check` 和 `pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/layout.test.ts` 作为主验证手段。

---

## Planned File Structure

**Modify**
- `apps/website/components/editor-shell/ScorePreview.tsx`

**Create**
- `apps/website/components/editor-shell/score-preview/score-preview-paths.ts`
- `apps/website/components/editor-shell/score-preview/score-preview-types.ts`
- `apps/website/components/editor-shell/score-preview/hooks/useBravuraFontStatus.ts`
- `apps/website/components/editor-shell/score-preview/hooks/useScorePreviewPointerHit.ts`
- `apps/website/components/editor-shell/score-preview/hooks/useScorePreviewInput.ts`
- `apps/website/components/editor-shell/score-preview/ScorePreviewSvg.tsx`
- `apps/website/components/editor-shell/score-preview/ScoreSystemLayer.tsx`
- `apps/website/components/editor-shell/score-preview/ScoreMeasureLayer.tsx`
- `apps/website/components/editor-shell/score-preview/MeasureDurationLayer.tsx`
- `apps/website/components/editor-shell/score-preview/MeasureNotesLayer.tsx`
- `apps/website/components/editor-shell/score-preview/MeasureTupletLayer.tsx`

**Why this structure**
- `ScorePreview.tsx` 保留“状态 + 命令 + 事件”容器职责。
- `ScorePreviewSvg.tsx` 负责 `<svg>` 外壳与 system 遍历。
- `ScoreSystemLayer.tsx` 负责 system 级 overlay，例如 `TAB` 前缀和跨小节 / 跨行 `tie`。
- `ScoreMeasureLayer.tsx` 负责小节壳层：拍号、弦线、barline、激活格。
- `MeasureDurationLayer.tsx` / `MeasureNotesLayer.tsx` / `MeasureTupletLayer.tsx` 负责小节内部三块稳定渲染区域。
- `hooks/useBravuraFontStatus.ts` / `hooks/useScorePreviewPointerHit.ts` / `hooks/useScorePreviewInput.ts` 负责字体探测、指针命中和键盘输入状态机。
- `score-preview-paths.ts` 集中存放 SVG path helper，避免散落在 JSX 中。

### Task 1: 搭建 `score-preview/` 目录并抽离共享类型、路径 helper 与基础 hooks

**Files:**
- Create: `apps/website/components/editor-shell/score-preview/score-preview-types.ts`
- Create: `apps/website/components/editor-shell/score-preview/score-preview-paths.ts`
- Create: `apps/website/components/editor-shell/score-preview/hooks/useBravuraFontStatus.ts`
- Modify: `apps/website/components/editor-shell/ScorePreview.tsx`

**Interfaces:**
- Consumes:
  - `type ScoreLayout`, `type LaidOutMeasure`, `type LaidOutSystem`, `type LaidOutTieSegment` from `@liuxianmao/lxm-tabeditor`
  - `type Beat`, `type Measure`, `type TabNote`, `type TimeSignature` from `@liuxianmao/lxm-tabeditor`
- Produces:
  - `export interface ScorePreviewSelectionState`
  - `export interface ScorePreviewSvgProps`
  - `export interface ScoreSystemLayerProps`
  - `export interface ScoreMeasureLayerProps`
  - `export const getTiePath(segment: Pick<LaidOutTieSegment, "x1" | "y1" | "x2" | "y2">): string`
  - `export const useBravuraFontStatus(): "loading" | "ready" | "failed"`

- [ ] **Step 1: 写一条失败的类型校验用例，证明新 helper/props 还不存在**

```bash
pnpm --filter @liuxianmao/website type-check
```

Expected: `Cannot find module './score-preview/score-preview-paths'` 或缺少导出类型，说明拆分目标还未建立。

- [ ] **Step 2: 新建统一的 Score Preview 子目录类型文件**

```ts
// apps/website/components/editor-shell/score-preview/score-preview-types.ts
import type {
  LaidOutMeasure,
  LaidOutSystem,
  LaidOutTieSegment,
  ScoreLayout,
} from "@liuxianmao/lxm-tabeditor";

export interface ScorePreviewSelectionState {
  activeBeatId?: string;
  activeMeasureId?: string;
  activeString?: number;
  activeNoteId?: string;
}

export interface ScorePreviewSvgProps {
  layout: ScoreLayout;
  title: string;
  selection: ScorePreviewSelectionState;
  onPointerDown: React.PointerEventHandler<SVGSVGElement>;
}

export interface ScoreSystemLayerProps {
  system: LaidOutSystem;
  ties: LaidOutTieSegment[];
  selection: ScorePreviewSelectionState;
}

export interface ScoreMeasureLayerProps {
  measure: LaidOutMeasure;
  selection: ScorePreviewSelectionState;
}
```

- [ ] **Step 3: 抽离 tie path helper，并补详细中文注释**

```ts
// apps/website/components/editor-shell/score-preview/score-preview-paths.ts
import type { LaidOutTieSegment } from "@liuxianmao/lxm-tabeditor";

/**
 * tie 的视觉弧线只消费 layout 层给出的端点坐标。
 * helper 保持纯函数，避免渲染组件里混入几何细节。
 */
export const getTiePath = (
  segment: Pick<LaidOutTieSegment, "x1" | "y1" | "x2" | "y2">,
) => {
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

- [ ] **Step 4: 在 `ScorePreview.tsx` 中改为从新 helper 文件导入 `getTiePath`，并删掉原地定义**

```ts
import { getTiePath } from "./score-preview/score-preview-paths";
```

- [ ] **Step 5: 把字体探测 hook 抽到 `hooks/useBravuraFontStatus.ts`**

```ts
// apps/website/components/editor-shell/score-preview/hooks/useBravuraFontStatus.ts
import { useEffect, useState } from "react";

/**
 * Bravura 只用于 SMuFL 音乐符号。这里显式探测字体加载状态，
 * 避免字体失败时用户看到私用区乱码却没有任何提示。
 */
export const useBravuraFontStatus = (): "loading" | "ready" | "failed" => {
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(
    "loading",
  );

  useEffect(() => {
    if (!("fonts" in document)) {
      queueMicrotask(() => setStatus("failed"));
      return;
    }

    let mounted = true;
    document.fonts
      .load("16px Bravura")
      .then((fonts) => {
        if (!mounted) return;
        setStatus(fonts.length > 0 ? "ready" : "failed");
      })
      .catch(() => {
        if (mounted) setStatus("failed");
      });

    return () => {
      mounted = false;
    };
  }, []);

  return status;
};
```

- [ ] **Step 6: 在 `ScorePreview.tsx` 中改为从 hook 文件导入 `useBravuraFontStatus`，删除原地定义**

```ts
import { useBravuraFontStatus } from "./score-preview/hooks/useBravuraFontStatus";
import { getTiePath } from "./score-preview/score-preview-paths";
```

- [ ] **Step 7: 运行类型检查，确认基础目录、helper 与字体 hook 已落地**

Run: `pnpm --filter @liuxianmao/website type-check`

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/website/components/editor-shell/ScorePreview.tsx \
  apps/website/components/editor-shell/score-preview/score-preview-types.ts \
  apps/website/components/editor-shell/score-preview/score-preview-paths.ts \
  apps/website/components/editor-shell/score-preview/hooks/useBravuraFontStatus.ts
git commit -m "refactor: extract score preview shared helpers and hooks"
```

### Task 2: 抽离 SVG 外壳和 system 级渲染层

**Files:**
- Create: `apps/website/components/editor-shell/score-preview/ScorePreviewSvg.tsx`
- Create: `apps/website/components/editor-shell/score-preview/ScoreSystemLayer.tsx`
- Modify: `apps/website/components/editor-shell/ScorePreview.tsx`

**Interfaces:**
- Consumes:
  - `ScorePreviewSvgProps`
  - `ScoreSystemLayerProps`
  - `getTiePath(...)`
- Produces:
  - `export const ScorePreviewSvg: React.FC<ScorePreviewSvgProps>`
  - `export const ScoreSystemLayer: React.FC<ScoreSystemLayerProps>`

- [ ] **Step 1: 先跑类型检查，确认 `ScorePreviewSvg` / `ScoreSystemLayer` 还不存在**

Run: `pnpm --filter @liuxianmao/website type-check`

Expected: FAIL after adding imports for missing components

- [ ] **Step 2: 创建 `ScorePreviewSvg.tsx`，只保留 SVG 外壳和 system 遍历**

```tsx
// apps/website/components/editor-shell/score-preview/ScorePreviewSvg.tsx
import type React from "react";
import { ScoreSystemLayer } from "./ScoreSystemLayer";
import type { ScorePreviewSvgProps } from "./score-preview-types";
import styles from "./index.module.scss";

export const ScorePreviewSvg: React.FC<ScorePreviewSvgProps> = ({
  layout,
  title,
  selection,
  onPointerDown,
}) => (
  <svg
    className={styles["score-svg"]}
    onPointerDown={onPointerDown}
    role="img"
    aria-label={title}
    viewBox={`0 0 ${layout.width} ${layout.height}`}
    width={layout.width * layout.zoom}
    height={layout.height * layout.zoom}
  >
    {layout.systems.map((system) => (
      <ScoreSystemLayer
        key={system.index}
        system={system}
        ties={layout.ties.flatMap((tie) =>
          tie.segments.filter((segment) => segment.systemIndex === system.index),
        )}
        selection={selection}
      />
    ))}
  </svg>
);
```

- [ ] **Step 3: 创建 `ScoreSystemLayer.tsx`，承接 system 级内容**

```tsx
// apps/website/components/editor-shell/score-preview/ScoreSystemLayer.tsx
import type React from "react";
import { ScoreMeasureLayer } from "./ScoreMeasureLayer";
import { getTiePath } from "./score-preview-paths";
import type { ScoreSystemLayerProps } from "./score-preview-types";
import styles from "./index.module.scss";

export const ScoreSystemLayer: React.FC<ScoreSystemLayerProps> = ({
  system,
  ties,
  selection,
}) => (
  <g>
    <text className={styles["tab-prefix-svg"]} x={18} y={58}>{/* ... */}</text>
    {system.measures.map((measure) => (
      <ScoreMeasureLayer
        key={measure.id}
        measure={measure}
        selection={selection}
      />
    ))}
    {ties.map((segment) => (
      <path
        key={segment.id}
        className={styles["tie-svg"]}
        d={getTiePath(segment)}
      />
    ))}
  </g>
);
```

- [ ] **Step 4: 将 `ScorePreview.tsx` 中的大块 `<svg>` JSX 替换为 `ScorePreviewSvg`**

```tsx
<ScorePreviewSvg
  layout={layout}
  title={score.title}
  selection={{
    activeBeatId: activeBeat?.beatId,
    activeMeasureId: activeBeat?.measureId,
    activeString: activeBeat?.string,
    activeNoteId: activeNote?.id,
  }}
  onPointerDown={handlePointerDown}
/>
```

- [ ] **Step 5: 运行类型检查，确保 system 级拆分后接口闭合**

Run: `pnpm --filter @liuxianmao/website type-check`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/website/components/editor-shell/ScorePreview.tsx \
  apps/website/components/editor-shell/score-preview/ScorePreviewSvg.tsx \
  apps/website/components/editor-shell/score-preview/ScoreSystemLayer.tsx
git commit -m "refactor: extract score preview svg shell"
```

### Task 3: 抽离小节壳层与内部三块渲染层

**Files:**
- Create: `apps/website/components/editor-shell/score-preview/ScoreMeasureLayer.tsx`
- Create: `apps/website/components/editor-shell/score-preview/MeasureDurationLayer.tsx`
- Create: `apps/website/components/editor-shell/score-preview/MeasureNotesLayer.tsx`
- Create: `apps/website/components/editor-shell/score-preview/MeasureTupletLayer.tsx`
- Modify: `apps/website/components/editor-shell/score-preview/ScoreSystemLayer.tsx`

**Interfaces:**
- Consumes:
  - `ScoreMeasureLayerProps`
  - `LaidOutMeasure`
  - `ScorePreviewSelectionState`
- Produces:
  - `export const ScoreMeasureLayer: React.FC<ScoreMeasureLayerProps>`
  - `export const MeasureDurationLayer: React.FC<{ measure: LaidOutMeasure }>`
  - `export const MeasureNotesLayer: React.FC<{ measure: LaidOutMeasure; activeNoteId?: string }>`
  - `export const MeasureTupletLayer: React.FC<{ measure: LaidOutMeasure }>`

- [ ] **Step 1: 先创建缺失导入并运行类型检查，确认新组件仍未实现**

Run: `pnpm --filter @liuxianmao/website type-check`

Expected: FAIL with `Cannot find module './MeasureDurationLayer'` 等缺失错误

- [ ] **Step 2: 创建 `ScoreMeasureLayer.tsx`，只负责小节外壳**

```tsx
// apps/website/components/editor-shell/score-preview/ScoreMeasureLayer.tsx
import type React from "react";
import { STAFF_STRINGS } from "../editor-data";
import { MeasureDurationLayer } from "./MeasureDurationLayer";
import { MeasureNotesLayer } from "./MeasureNotesLayer";
import { MeasureTupletLayer } from "./MeasureTupletLayer";
import type { ScoreMeasureLayerProps } from "./score-preview-types";
import styles from "./index.module.scss";

export const ScoreMeasureLayer: React.FC<ScoreMeasureLayerProps> = ({
  measure,
  selection,
}) => (
  <g aria-label={`第 ${measure.number} 小节`}>
    {/* measure number / time signature / staff lines / active cell / barlines */}
    <MeasureDurationLayer measure={measure} />
    <MeasureNotesLayer measure={measure} activeNoteId={selection.activeNoteId} />
    <MeasureTupletLayer measure={measure} />
  </g>
);
```

- [ ] **Step 3: 创建 `MeasureDurationLayer.tsx`，收纳 beam / stem / flag / duration dots**

```tsx
// apps/website/components/editor-shell/score-preview/MeasureDurationLayer.tsx
import {
  isLaidOutPartialBeam,
  isLaidOutSharedBeam,
  type LaidOutMeasure,
} from "@liuxianmao/lxm-tabeditor";

export const MeasureDurationLayer: React.FC<{ measure: LaidOutMeasure }> = ({
  measure,
}) => {
  // 把 beamSegments 和 durationMarks 的 JSX 原样迁移进来
  // 只允许提炼局部 helper，不改渲染顺序和几何公式
};
```

- [ ] **Step 4: 创建 `MeasureNotesLayer.tsx` 和 `MeasureTupletLayer.tsx`**

```tsx
// MeasureNotesLayer.tsx
export const MeasureNotesLayer: React.FC<{
  measure: LaidOutMeasure;
  activeNoteId?: string;
}> = ({ measure, activeNoteId }) => (
  <>
    {/* notes */}
    {/* rests */}
  </>
);

// MeasureTupletLayer.tsx
export const MeasureTupletLayer: React.FC<{ measure: LaidOutMeasure }> = ({
  measure,
}) => (
  <>
    {/* tuplets */}
  </>
);
```

- [ ] **Step 5: 运行类型检查和 layout 回归，确认页面层重组不影响 layout 协议消费**

Run: `pnpm --filter @liuxianmao/website type-check && pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/layout.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/website/components/editor-shell/score-preview/ScoreMeasureLayer.tsx \
  apps/website/components/editor-shell/score-preview/MeasureDurationLayer.tsx \
  apps/website/components/editor-shell/score-preview/MeasureNotesLayer.tsx \
  apps/website/components/editor-shell/score-preview/MeasureTupletLayer.tsx \
  apps/website/components/editor-shell/score-preview/ScoreSystemLayer.tsx
git commit -m "refactor: split score preview measure layers"
```

### Task 4: 收口 `ScorePreview.tsx` 容器职责并做最终验证

**Files:**
- Modify: `apps/website/components/editor-shell/ScorePreview.tsx`
- Modify: `apps/website/components/editor-shell/score-preview/score-preview-types.ts`

**Interfaces:**
- Consumes:
  - `ScorePreviewSvg`
  - `ScorePreviewSelectionState`
- Produces:
  - 一个只保留 store、输入事件、错误提示、添加小节按钮和 `ScorePreviewSvg` 组合的 `ScorePreview.tsx`

### Task 5: 抽离指针命中和键盘输入状态机 hooks

**Files:**
- Create: `apps/website/components/editor-shell/score-preview/hooks/useScorePreviewPointerHit.ts`
- Create: `apps/website/components/editor-shell/score-preview/hooks/useScorePreviewInput.ts`
- Modify: `apps/website/components/editor-shell/ScorePreview.tsx`

**Interfaces:**
- Consumes:
  - `type ScoreLayout`, `type Beat`, `type Measure`, `type TabNote` from `@liuxianmao/lxm-tabeditor`
  - `type ScorePreviewSelectionState`
- Produces:
  - `export const useScorePreviewPointerHit(...): { svgRef: RefObject<SVGSVGElement | null>; handlePointerDown: PointerEventHandler<SVGSVGElement> }`
  - `export const useScorePreviewInput(...): { inputIssue?: string; handleKeyDown: KeyboardEventHandler<HTMLElement> }`

- [ ] **Step 1: 先在容器中添加新 hook 的导入并运行类型检查，确认缺失实现会失败**

Run: `pnpm --filter @liuxianmao/website type-check`

Expected: FAIL with `Cannot find module './score-preview/hooks/useScorePreviewPointerHit'` 等缺失错误

- [ ] **Step 2: 创建 `useScorePreviewPointerHit.ts`，收口 SVG 坐标换算与命中逻辑**

```ts
// apps/website/components/editor-shell/score-preview/hooks/useScorePreviewPointerHit.ts
import { useCallback, useRef, type PointerEventHandler } from "react";
import {
  hitTestScoreLayout,
  type Beat,
  type ScoreLayout,
  type TabNote,
} from "@liuxianmao/lxm-tabeditor";

export const useScorePreviewPointerHit = (/* ... */): {
  svgRef: React.RefObject<SVGSVGElement | null>;
  handlePointerDown: PointerEventHandler<SVGSVGElement>;
} => {
  // 迁移原 handlePointerDown 逻辑
};
```

- [ ] **Step 3: 创建 `useScorePreviewInput.ts`，收口 `fretDraft`、`inputIssue`、`writeFret`、`moveActiveBeat` 与 `handleKeyDown`**

```ts
// apps/website/components/editor-shell/score-preview/hooks/useScorePreviewInput.ts
import {
  useCallback,
  useState,
  type KeyboardEventHandler,
} from "react";

export const useScorePreviewInput = (/* ... */): {
  inputIssue?: string;
  handleKeyDown: KeyboardEventHandler<HTMLElement>;
} => {
  // 迁移原输入状态机逻辑，并保留中文注释
};
```

- [ ] **Step 4: 在 `ScorePreview.tsx` 中使用新 hooks，删除原地的 `svgRef` / `fretDraft` / `inputIssue` / `handlePointerDown` / `moveActiveBeat` / `handleKeyDown`**

```ts
const { svgRef, handlePointerDown } = useScorePreviewPointerHit(/* ... */);
const { inputIssue, handleKeyDown } = useScorePreviewInput(/* ... */);
```

- [ ] **Step 5: 运行最终验证**

Run:

```bash
pnpm --filter @liuxianmao/website type-check
pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/layout.test.ts
```

Expected:
- `tsc --noEmit` PASS
- `layout.test.ts` PASS

- [ ] **Step 6: Commit**

```bash
git add apps/website/components/editor-shell/ScorePreview.tsx \
  apps/website/components/editor-shell/score-preview/hooks
git commit -m "refactor: extract score preview interaction hooks"
```

- [ ] **Step 1: 先跑类型检查，确认容器仍然依赖旧的内联 JSX/辅助函数**

Run: `pnpm --filter @liuxianmao/website type-check`

Expected: FAIL or warning due to未清理的旧 import / 未使用 helper

- [ ] **Step 2: 删除 `ScorePreview.tsx` 中已迁移出去的 system/measure 渲染块**

```tsx
// 保留这些职责
const layout = useMemo(() => layoutScore(score, { zoom }), [score, zoom]);
const activeContext = getActiveBeat(score, activeBeat);
const activeNote = getBeatNoteOnString(activeContext?.beat, activeBeat?.string ?? 1);
const handlePointerDown = useCallback(/* ... */);
const handleKeyDown = useCallback(/* ... */);
const handleAddMeasure = useCallback(/* ... */);

return (
  <main /* ... */>
    {/* tempo / font warning / issues */}
    <div className={styles["score-sheet"]}>
      <ScorePreviewSvg /* ... */ />
    </div>
    {/* add measure button */}
  </main>
);
```

- [ ] **Step 3: 清理容器 import，确保只剩交互所需依赖**

```ts
// 删除这些从容器中不再直接使用的 import：
// isLaidOutPartialBeam / isLaidOutSharedBeam / STAFF_STRINGS / BRAVURA_SYMBOLS 以外的多余 SVG 依赖
```

- [ ] **Step 4: 跑最终验证**

Run:

```bash
pnpm --filter @liuxianmao/website type-check
pnpm --filter @liuxianmao/lxm-tabeditor test -- tests/layout.test.ts
```

Expected:
- `tsc --noEmit` PASS
- `layout.test.ts` PASS

- [ ] **Step 5: Commit**

```bash
git add apps/website/components/editor-shell/ScorePreview.tsx \
  apps/website/components/editor-shell/score-preview
git commit -m "refactor: slim score preview container"
```

## Self-Review

- **Spec coverage:** 计划覆盖了你当前关心的拆分目标：统一目录、保留 `ScorePreview.tsx` 入口、抽离 system/measure 层、保留 tie 的 system 级职责、把路径 helper 下沉，并额外把适合的输入/命中/字体状态抽为 hooks，未引入 layout 协议变更。
- **Placeholder scan:** 没有 `TBD` / `TODO` / “类似 Task N” 这类占位描述；所有任务都写了目标文件、接口和验证命令。
- **Type consistency:** 计划统一使用 `ScorePreviewSelectionState`、`ScorePreviewSvgProps`、`ScoreSystemLayerProps`、`ScoreMeasureLayerProps`、`useScorePreviewPointerHit`、`useScorePreviewInput` 这组命名，system 层继续消费 `LaidOutTieSegment[]`，measure 层继续消费 `LaidOutMeasure`。
