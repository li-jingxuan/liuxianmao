# Editor Shell Style Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `apps/website/components/editor-shell` 下集中在 `EditorShell.module.scss` 的样式按组件和共享职责拆分，降低维护成本，同时不改变现有 UI 结构与行为。

**Architecture:** 保留 `EditorShell` 壳层样式在单独模块中；将按钮、图标、激活态等横跨多个组件的样式抽到共享 CSS Module；为 `HeaderBar`、`Toolbar`、`Sidebar`、`ScorePreview`、`PlaybackBar` 分别建立独立模块，组件通过多模块并行引入复用共享类。

**Tech Stack:** Next.js, React, CSS Modules, SCSS

## Global Constraints

- 仅调整 `apps/website/components/editor-shell` 范围内的样式组织，不改动组件语义和交互逻辑。
- 不能覆盖工作区已有未提交改动，必须在当前文件内容基础上增量修改。
- 删除 `EditorShell.module.scss` 中已无组件引用的旧样式，避免死代码继续残留。
- 验证方式以样式引用完整性和项目现有校验命令为准，不引入额外框架。

---

### Task 1: 拆分样式文件边界

**Files:**
- Create: `apps/website/components/editor-shell/shared.module.scss`
- Create: `apps/website/components/editor-shell/HeaderBar.module.scss`
- Create: `apps/website/components/editor-shell/Toolbar.module.scss`
- Create: `apps/website/components/editor-shell/Sidebar.module.scss`
- Create: `apps/website/components/editor-shell/ScorePreview.module.scss`
- Create: `apps/website/components/editor-shell/PlaybackBar.module.scss`
- Modify: `apps/website/components/editor-shell/EditorShell.module.scss`

**Interfaces:**
- Consumes: 现有 `EditorShell.module.scss` 中的 class 定义。
- Produces: 每个组件独立的 CSS Module 文件，以及保留壳层布局的 `EditorShell.module.scss`。

- [ ] 识别壳层样式、共享样式、组件专属样式的归属。
- [ ] 新建共享样式模块，承接按钮、图标、激活态、紧凑按钮等复用 class。
- [ ] 为每个组件新建对应模块，仅迁移该组件实际使用的 class。
- [ ] 精简 `EditorShell.module.scss`，仅保留 `music-editor`、`workspace-shell`、`editor-body` 等壳层布局 class。

### Task 2: 更新组件样式引用

**Files:**
- Modify: `apps/website/components/editor-shell/HeaderBar.tsx`
- Modify: `apps/website/components/editor-shell/Toolbar.tsx`
- Modify: `apps/website/components/editor-shell/Sidebar.tsx`
- Modify: `apps/website/components/editor-shell/ScorePreview.tsx`
- Modify: `apps/website/components/editor-shell/PlaybackBar.tsx`

**Interfaces:**
- Consumes: Task 1 产出的模块文件。
- Produces: 各组件从独立模块和共享模块读取 className。

- [ ] 为每个组件增加本组件模块 import。
- [ ] 对复用按钮、图标、状态类改为从共享模块取值。
- [ ] 对组件布局和局部样式改为从对应组件模块取值。
- [ ] 保持现有 DOM 结构与逻辑不变，仅调整 class 来源。

### Task 3: 清理与验证

**Files:**
- Modify: `apps/website/components/editor-shell/EditorShell.module.scss`

**Interfaces:**
- Consumes: Task 2 的最终样式引用关系。
- Produces: 无死代码的样式结构和可通过校验的组件引用。

- [ ] 二次扫描 `editor-shell` 下所有 `styles[...]` / `styles.xxx` 引用，确认无遗漏。
- [ ] 删除旧模块中未被任何组件使用的残留样式。
- [ ] 运行项目现有校验命令，确认 TSX 样式 import 与类型检查通过。
