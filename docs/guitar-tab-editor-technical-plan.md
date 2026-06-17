# 六线谱编辑器技术方案

## 1. 背景与目标

本项目目标是实现一个面向吉他用户的六线谱编辑器，核心体验参考常见 TAB 编辑软件：用户可以在六线谱上输入品位音符，添加常用演奏技巧、歌词、和弦与和弦图，并能持续扩展到播放、导入导出、协作等能力。

本方案优先解决以下问题：

- 六线谱可稳定渲染，支持多行、多小节、自适应排版。
- 支持品位音符输入、删除、移动、复制、撤销重做。
- 支持常用技巧标记：击弦、勾弦、上滑音、下滑音、推弦、颤音、泛音、闷音等。
- 支持添加小节、修改拍号、速度、调号等基础谱面信息。
- 支持歌词输入，并与小节/拍点对齐。
- 支持和弦名称与和弦图的输入和渲染。
- 数据结构清晰，为后续播放、MusicXML/GP 导出、云端保存留出空间。

## 2. 技术选型

### 2.1 前端框架

继续使用当前项目技术栈：

- `Next.js + React + TypeScript`
- 样式层优先使用项目现有 CSS，后续如引入组件库，可使用 Ant Design 处理弹窗、表单、下拉菜单、输入框等常规 UI。
- 谱面渲染区域独立封装为编辑器核心包，建议放在 `packages/lxm-tabeditor`，避免业务页面和谱面逻辑耦合。

### 2.2 渲染方案

建议采用“双层渲染”：

- 谱面层：使用 SVG 渲染六线、品位数字、小节线、技巧连线、和弦名、歌词、播放光标等。
- 交互层：使用透明 HTML/SVG hit area 接收点击、拖拽、框选、键盘输入。

不建议第一版直接使用 Canvas 作为主渲染：

- SVG 更利于命中检测、局部更新、文本清晰度和导出。
- 六线谱主要是矢量线条与文本，SVG 的开发和调试成本更低。
- 后续如谱面规模很大，可以再做虚拟化和 Canvas 混合渲染。

音乐符号字体使用 `Bravura`，放在 `apps/website/assets/fonts/`，通过 `@font-face` 引入。TAB 数字、歌词、和弦名使用界面字体，不混用音乐字体。

## 3. 模块划分

建议目录结构：

```text
packages/lxm-tabeditor/
  src/
    core/
      constants.ts
      types.ts
      score-model.ts
      score-commands.ts
      score-selectors.ts
      validation.ts
    layout/
      layout-score.ts
      layout-system.ts
      layout-measure.ts
      layout-chord-diagram.ts
    render/
      TabEditor.tsx
      ScoreCanvas.tsx
      MeasureView.tsx
      TechniqueLayer.tsx
      LyricsLayer.tsx
      ChordDiagram.tsx
    input/
      keyboard-map.ts
      pointer-controller.ts
      note-input-controller.ts
      lyrics-input-controller.ts
      chord-input-controller.ts
    history/
      command-stack.ts
    import-export/
      lxm-json.ts
      musicxml.ts
      gp-adapter.ts
```

页面侧目录：

```text
apps/website/app/
  page.tsx
  globals.css
apps/website/components/
  editor-shell/
    HeaderBar.tsx
    Toolbar.tsx
    Sidebar.tsx
    PlaybackBar.tsx
```

核心原则：

- `packages/lxm-tabeditor` 只关心乐谱数据、排版、渲染和编辑命令。
- `apps/website` 只负责页面框架、按钮、弹窗、保存状态、导入导出入口。
- 所有编辑行为都走 command，不直接在组件中随手改对象。

## 4. 核心数据模型

### 4.1 Score

```ts
export interface Score {
  id: string;
  title: string;
  version: number;
  meta: ScoreMeta;
  tracks: Track[];
  chordLibrary: ChordDefinition[];
}

export interface ScoreMeta {
  tempo: number;
  timeSignature: TimeSignature;
  keySignature?: string;
  capo?: number;
}
```

### 4.2 Track

第一版可以只支持单吉他轨，但数据结构保留多轨：

```ts
export interface Track {
  id: string;
  name: string;
  instrument: "guitar";
  tuning: Tuning;
  measures: Measure[];
}

export interface Tuning {
  strings: GuitarString[];
}

export interface GuitarString {
  index: number;
  pitch: string;
  midi: number;
}
```

默认标准调弦：

```ts
export const STANDARD_GUITAR_TUNING = ["E4", "B3", "G3", "D3", "A2", "E2"] as const;
```

### 4.3 Measure

```ts
export interface Measure {
  id: string;
  index: number;
  timeSignature?: TimeSignature;
  beats: Beat[];
  barline?: BarlineType;
  chordSymbols: ChordSymbol[];
  lyrics: LyricSegment[];
}

export interface Beat {
  id: string;
  tick: number;
  duration: DurationValue;
  notes: TabNote[];
  rest?: boolean;
}
```

### 4.4 TabNote

```ts
export interface TabNote {
  id: string;
  string: number;
  fret: number | "x";
  duration?: DurationValue;
  techniques: Technique[];
  tie?: TieInfo;
  ghost?: boolean;
}
```

说明：

- `string` 使用 1 到 6，1 表示最细的高音 E 弦。
- `fret` 支持数字与 `x`，用于闷音。
- 多音同时按下时，多个 `TabNote` 放在同一个 `Beat.notes` 中。

### 4.5 Technique

```ts
export type Technique =
  | { type: "hammerOn"; targetNoteId: string }
  | { type: "pullOff"; targetNoteId: string }
  | { type: "slideUp"; targetNoteId: string }
  | { type: "slideDown"; targetNoteId: string }
  | { type: "bend"; semitones: number; release?: boolean }
  | { type: "vibrato"; width?: "small" | "medium" | "wide" }
  | { type: "harmonic"; harmonicType: "natural" | "artificial" }
  | { type: "palmMute" }
  | { type: "deadNote" };
```

技巧建议以“音符关系”为中心存储，而不是只存一段装饰线。比如击弦、勾弦、滑音都应指向 `targetNoteId`，这样编辑、删除和导出更可靠。

### 4.6 Lyrics

```ts
export interface LyricSegment {
  id: string;
  tick: number;
  text: string;
  syllable?: "single" | "begin" | "middle" | "end";
}
```

歌词第一版按小节内 tick 对齐。输入体验上可提供“歌词行编辑模式”：用户输入空格分词后自动分配到后续拍点。

### 4.7 Chord

```ts
export interface ChordSymbol {
  id: string;
  tick: number;
  name: string;
  chordId?: string;
}

export interface ChordDefinition {
  id: string;
  name: string;
  frets: Array<number | "x" | 0>;
  fingers?: Array<number | null>;
  baseFret?: number;
}
```

和弦名与和弦图分离：

- 和弦名用于谱面上方展示，如 `Am`、`G/B`。
- 和弦图用于弹窗、曲首和指定位置渲染。
- 同名和弦可存在多个按法，使用 `chordId` 关联具体按法。

## 5. 时间与排版模型

### 5.1 Tick 体系

建议使用固定 PPQ：

```ts
export const TICKS_PER_QUARTER = 960;
```

常用时值：

```ts
export const DURATION_TICKS = {
  whole: 3840,
  half: 1920,
  quarter: 960,
  eighth: 480,
  sixteenth: 240,
  thirtySecond: 120,
} as const;
```

优点：

- 易于处理附点、三连音、跨小节延音。
- 后续播放、MIDI 导出、MusicXML 导出更自然。

### 5.2 Layout Pass

渲染前先将 `Score` 转换为 `LayoutScore`：

```ts
export interface LayoutNote {
  noteId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutMeasure {
  measureId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  notes: LayoutNote[];
}
```

排版流程：

1. 按小节计算最小宽度。
2. 按容器宽度决定每行小节数量。
3. 为每行分配剩余宽度。
4. 在小节内按 tick 映射 x 坐标。
5. 根据弦号计算 y 坐标。
6. 计算技巧、歌词、和弦名、和弦图占用高度。

## 6. 渲染实现

### 6.1 六线谱基础层

基础层包含：

- 六条弦线。
- 小节线。
- 小节编号。
- 拍号、速度、调号。
- 当前播放/编辑光标。

### 6.2 音符层

音符层包含：

- 品位数字。
- 多音和弦纵向对齐。
- 休止符。
- 选中态、悬停态、输入预览态。

品位数字使用普通文本，不使用 Bravura。原因是 TAB 数字需要清晰、稳定、可选中。

### 6.3 技巧层

技巧层单独渲染，避免和音符数字混在一起：

- 击弦：两音之间弧线 + `H`。
- 勾弦：两音之间弧线 + `P`。
- 上滑音：斜线 `/` 或连接线。
- 下滑音：斜线 `\` 或连接线。
- 推弦：上方弧线/箭头 + 半音数。
- 颤音：波浪线。
- 泛音：菱形或 `AH/NH` 文本。
- 闷音：`x` 品位数字或单独 `deadNote` 标记。

技巧渲染依赖 `LayoutNote`，当目标音符不存在时 validation 应清理或提示。

### 6.4 歌词层

歌词层放在当前谱表下方：

- 每个 `LyricSegment` 根据 tick 对齐到 x。
- 支持单行歌词，第二阶段支持多段歌词。
- 文本编辑时使用一个浮动 input/textarea 覆盖在 SVG 上方。

### 6.5 和弦图层

和弦图可以用 SVG 渲染：

- 6 条竖线表示弦。
- 4 到 5 条横线表示品格。
- 顶部显示 `x`、`o` 或空。
- 指法圆点显示在对应弦/品上。
- `baseFret > 1` 时左侧显示起始品。

和弦图输入建议使用弹窗：

- 输入和弦名。
- 点击网格设置按弦位置。
- 顶部设置空弦/不弹。
- 可选设置手指编号。

## 7. 编辑交互设计

### 7.1 编辑模式

建议拆分模式：

- `note`：品位音符输入。
- `technique`：技巧输入。
- `lyrics`：歌词输入。
- `chord`：和弦/和弦图输入。
- `select`：框选、移动、复制。

```ts
export type EditorMode = "select" | "note" | "technique" | "lyrics" | "chord";
```

### 7.2 音符输入

推荐交互：

- 点击某根弦的某个拍点，激活 cell。
- 数字键输入品位。
- 连续输入两位数字支持 10 品以上。
- `Backspace/Delete` 删除当前音符。
- `ArrowLeft/ArrowRight` 移动拍点。
- `ArrowUp/ArrowDown` 切换弦。
- `1/2/4/8/16/32` 修改当前时值。

### 7.3 技巧输入

技巧输入优先支持快捷键：

```ts
export const TECHNIQUE_SHORTCUTS = {
  hammerOn: "h",
  pullOff: "p",
  slideUp: "/",
  slideDown: "\\",
  bend: "b",
  vibrato: "v",
  harmonic: "a",
  deadNote: "x",
} as const;
```

击弦、勾弦、滑音这类关系型技巧：

1. 先选中起始音符。
2. 按快捷键或点击技巧按钮。
3. 选择目标音符，或自动连接到同弦下一音。

### 7.4 添加小节

添加小节用 command：

```ts
interface AddMeasureCommand {
  type: "addMeasure";
  trackId: string;
  afterMeasureId?: string;
  measure?: Partial<Measure>;
}
```

默认继承前一小节的拍号、调号和显示规则。

### 7.5 撤销重做

所有变更封装为 command：

```ts
export interface EditorCommand {
  id: string;
  type: string;
  apply(score: Score): Score;
  revert(score: Score): Score;
}
```

第一版可以用 immutable 数据拷贝实现。后续数据量变大时，再引入 patch-based history。

## 8. 状态管理

建议拆成三层状态：

- `scoreState`：乐谱文档数据，可持久化。
- `editorState`：选区、模式、当前时值、当前工具，不持久化或部分持久化。
- `layoutState`：排版结果，由 score + viewport 派生，不直接编辑。

```ts
export interface EditorState {
  mode: EditorMode;
  selectedNoteIds: string[];
  selectedMeasureIds: string[];
  activeBeat?: { measureId: string; tick: number; string: number };
  currentDuration: DurationValue;
  currentTechnique?: Technique["type"];
}
```

React 层建议：

- `useReducer` 管理编辑状态。
- `useMemo` 计算 layout。
- `useCallback` 包装交互命令。
- 大谱面时对行级 `SystemView` 使用 `React.memo`。

## 9. 输入校验

关键校验：

- `string` 必须在调弦范围内。
- `fret` 范围建议默认 0 到 24，可根据乐器配置修改。
- 同一 beat 同一 string 不允许多个音符。
- 小节内总时值不能超过拍号容量，或标记为 overflow。
- 关系型技巧的 `targetNoteId` 必须存在。
- 击弦/勾弦通常要求同弦且目标音符在后方。
- 和弦图的 `frets` 长度必须等于弦数。

校验结果不应直接阻断全部编辑。建议返回 warning/error：

```ts
export interface ValidationIssue {
  level: "warning" | "error";
  code: string;
  message: string;
  targetId?: string;
}
```

## 10. 持久化格式

第一版使用自定义 JSON：

```ts
export interface LxmScoreDocument {
  schema: "lxm-tab-score";
  schemaVersion: 1;
  score: Score;
}
```

优点：

- 与编辑器模型完全一致。
- 易于版本迁移。
- 后续可增加 MusicXML、MIDI、Guitar Pro 的导入导出适配器。

需要提供 migration：

```ts
export type ScoreMigration = (doc: unknown) => LxmScoreDocument;
```

## 11. 性能策略

第一版目标：

- 100 小节内编辑流畅。
- 只重新排版受影响行。
- 输入数字、切换选区、添加技巧不明显卡顿。

策略：

- 使用结构化数据，尽量保持引用稳定。
- layout 使用 `useMemo`，依赖 score revision 和 viewport。
- 行级渲染组件 `SystemView` 使用 `React.memo`。
- 长谱面使用虚拟列表，只渲染可见行与上下缓冲行。
- 命中检测优先使用 layout 索引，不在每次 pointer move 中扫描整份 score。

## 12. 迭代计划

### Milestone 1：编辑器核心骨架

- 定义 `Score` 数据模型。
- 实现六线谱 SVG 渲染。
- 实现小节、拍点、品位数字渲染。
- 支持点击定位、数字输入、删除、修改时值。
- 支持添加小节。

### Milestone 2：技巧与歌词

- 支持击弦、勾弦、上滑音、下滑音。
- 支持推弦、颤音、泛音、闷音。
- 支持歌词输入模式。
- 支持撤销重做。

### Milestone 3：和弦图

- 支持和弦名输入。
- 支持和弦图库。
- 支持和弦图编辑弹窗。
- 支持谱面上方和曲首和弦图渲染。

### Milestone 4：工程化与导入导出

- 自定义 JSON 保存和加载。
- 自动保存与 schema migration。
- 导出 SVG/PDF。
- 预研 MusicXML/Guitar Pro 导入导出。

### Milestone 5：播放与高级能力

- 简单 MIDI 播放。
- 播放光标。
- 节拍器。
- 多轨支持。
- 大谱面虚拟化。

## 13. 风险与取舍

### 13.1 不直接依赖完整打谱库

VexFlow 等打谱库可以作为参考或局部辅助，但第一版不建议把整个编辑器状态绑定到第三方库内部模型。原因：

- 六线谱编辑器需要大量自定义交互。
- 技巧、歌词、和弦图的输入体验很难完全依赖库提供。
- 后续导入导出、自动保存、撤销重做都更适合使用自己的文档模型。

### 13.2 SVG 排版复杂度

自研 SVG 排版需要投入，但收益是交互可控、样式可控、后续扩展成本低。第一版排版规则可以简单，先支持固定行高和按小节换行，再逐步优化拥挤小节的宽度分配。

### 13.3 音符字体

Bravura 是 SMuFL 字体，适合渲染音乐符号，但 TAB 数字、中文、按钮文字不要使用 Bravura。音乐字体只用于休止符、谱号、升降号、拍号等符号，避免字体度量导致 UI 异常。

## 14. 推荐落地顺序

1. 先把当前静态页面拆成 `HeaderBar`、`Toolbar`、`Sidebar`、`ScoreCanvas`、`PlaybackBar`。
2. 在 `packages/lxm-tabeditor` 中建立 `types.ts` 与示例 `mockScore`。
3. 用 `mockScore` 替代当前页面里的静态常量。
4. 实现 `layoutScore(score, viewport)`。
5. 实现 SVG 六线谱渲染。
6. 实现点击定位和数字输入。
7. 再接入技巧、歌词、和弦图。

这样能最快从“静态设计稿”过渡到“真实编辑器”，同时不会过早把复杂功能揉在页面组件里。
