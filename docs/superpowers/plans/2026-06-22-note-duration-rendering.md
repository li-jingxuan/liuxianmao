# Note Duration Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 TAB 预览补齐音符时值视觉渲染，使四分、八分、十六分、三十二分及附点在谱面上可见。

**Architecture:** 扩展 `score-layout.ts` 输出音符时值几何数据，由页面层仅消费 `durationMarks` 与 `beamGroups` 进行 SVG 渲染。时值归属保持在 `beat` 级别，避免把和弦多音的共享时值拆散到单个 note 上。

**Tech Stack:** TypeScript, Vitest, React, SVG, SCSS Modules

## Global Constraints

- 时值渲染必须绑定 `beat.rhythm`，不能错误地从单个 `note` 派生。
- 只在现有 `layoutScore` 输出结构上增量扩展，不把排版几何推回到 React 组件中。
- 复杂坐标和分组规则必须补充中文注释。
- 验证至少包含 layout 单测和 `@liuxianmao/website` / `@liuxianmao/lxm-tabeditor` 的类型检查。

---

### Task 1: 定义 layout 输出与测试

**Files:**
- Modify: `packages/lxm-tabeditor/src/layout/score-layout.ts`
- Test: `packages/lxm-tabeditor/tests/layout.test.ts`

**Interfaces:**
- Consumes: `layoutScore(score, options?) => ScoreLayout`
- Produces: `LaidOutDurationMark[]`、`LaidOutBeamGroup[]`

- [ ] 为 `LaidOutMeasure` 补充音符时值几何输出类型。
- [ ] 先在 `layout.test.ts` 写失败测试，覆盖四分音符、八分音符连梁和附点输出。
- [ ] 跑目标测试确认当前实现失败。

### Task 2: 实现 layout 时值几何

**Files:**
- Modify: `packages/lxm-tabeditor/src/layout/score-layout.ts`

**Interfaces:**
- Consumes: `measure.beats`, `measure.tuplets`, `LaidOutNote[]`
- Produces: `durationMarks`, `beamGroups`

- [ ] 为每个 `notes` beat 生成统一的时值标记，而不是为每个 note 单独生成。
- [ ] 生成 stem/flag/dots 所需的基础几何数据。
- [ ] 按连续短时值 beat 生成 beam group，休止拍与较长时值会打断分组。
- [ ] 为关键公式补中文注释。

### Task 3: 页面渲染与样式

**Files:**
- Modify: `apps/website/components/editor-shell/ScorePreview.tsx`
- Modify: `apps/website/components/editor-shell/ScorePreview.module.scss`

**Interfaces:**
- Consumes: `measure.durationMarks`, `measure.beamGroups`
- Produces: SVG 中可见的时值头、符干、符尾、连梁和附点

- [ ] 删除当前空的“时值部分”占位渲染。
- [ ] 按 layout 几何渲染 notehead、stem、flag、beam、dots。
- [ ] 保持与当前 fret 数字、rest、tuplet 的渲染层级兼容。

### Task 4: 验证

**Files:**
- Test: `packages/lxm-tabeditor/tests/layout.test.ts`

**Interfaces:**
- Consumes: 以上所有改动
- Produces: 可验证的通过结果

- [ ] 运行新增/更新后的 layout 测试。
- [ ] 运行 `pnpm --filter @liuxianmao/lxm-tabeditor type-check`。
- [ ] 运行 `pnpm --filter @liuxianmao/website type-check`。
