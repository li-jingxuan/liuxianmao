# 六线谱编辑器技术方案

## 0. MVP SVG 素材与渲染边界

`docs/extracted-svg-icons/` 保存原始参考素材，不能直接作为运行时资源。接入时需要标准化并复制到 `apps/website/assets/svg/music-controls/`，由统一资源清单导出为 React SVG 组件。

### 0.1 当前素材清单

| 状态 | 素材 | 用途 |
| --- | --- | --- |
| `[x]` | `note-whole.svg`、`note-half.svg`、`note-quarter.svg` | 工具栏基础音符时值图标 |
| `[x]` | `note-eighth.svg`、`note-sixteenth.svg`、`note-thirty-second.svg` | 工具栏八分、十六分、三十二分音符图标 |
| `[x]` | `note-dot.svg`、`note-double-dotted.svg` | 工具栏附点与双附点图标 |
| `[x]` | `duplet.svg`、`triplet.svg`、`quadruplet.svg`、`quintuplet-5-4.svg`、`quintuplet-5-3.svg`、`sextuplet.svg` | 工具栏二至六连音图标 |
| `[x]` | `note-tie.svg` | 工具栏延音线命令图标，不直接用于谱面连线 |
| `[ ]` | `brand/liuxianmao-logo.svg` | 顶部品牌图形，不包含品牌文字 |
| `[ ]` | `techniques/*.svg` | 击弦、勾弦、上下滑音、推弦、颤音、泛音、手掌闷音、死音工具图标 |

素材说明以 `docs/extracted-svg-icons/README.txt` 为准；README 中声明但目录中不存在的文件保持待办状态，不允许在代码中引用。

### 0.2 使用边界

- **工具栏图标**：优先使用标准化后的本地 SVG，确保外观与设计稿一致。
- **谱面点状音乐符号**：音符、休止符、谱号、升降号等优先使用已验收 SVG；缺失时使用本地 Bravura/SMuFL 字形作为明确 fallback。
- **谱面跨度图形**：延音线、连音括号、击弦/勾弦弧线、滑音线、手掌闷音范围必须根据 layout 坐标动态生成，不能拉伸工具栏 SVG。
- **和弦图**：弦线、品格、指法点和横按线根据 `ChordDefinition` 动态生成。
- **通用操作图标**：撤销、重做、保存、导出、设置、播放、音量和循环使用 `lucide-react`。
- **文本内容**：TAB 字母、品位数字、歌词、和弦名称及技巧文字使用 HTML/SVG 文本与界面字体，不转曲为静态 SVG。

### 0.3 标准化流程

原始 SVG 允许保留来源工具生成的属性，但运行时版本必须经过以下处理：

1. 校验素材来源与使用许可，并在资源清单中记录 `source` 和 `license`。
2. 保留 `viewBox`，移除固定 `width`、`height`、编辑器元数据、脚本、外部链接和位图内容。
3. 单色图形统一改为 `fill="currentColor"` 或 `stroke="currentColor"`；不得保留 `#000` 等主题不可控颜色。
4. 运行 SVG 优化并人工检查 path、clipPath、fill-rule 等属性没有被破坏。
5. 在 `svg-assets-manifest.ts` 中以语义 ID 注册，组件不得直接拼接文件路径。
6. 为默认、hover、active、disabled 四种状态建立视觉回归截图。

```ts
export interface SvgAssetDefinition {
  id: MusicControlIcon;
  sourcePath: string;
  runtimePath: string;
  usage: "toolbar" | "scoreGlyph";
  fallbackSmuflCodepoint?: string;
  source: string;
  license: string;
}
```

### 0.4 SVG 制作规范

- 工具图标统一使用 `24 × 24` 设计网格并保留约 `2px` 安全区，实际尺寸由组件控制。
- 单色线性图标建议线宽 `1.75` 至 `2`，使用圆角端点和圆角连接。
- 品牌图形可以使用填充色，但不包含“六线猫”文字。
- 技巧图标不内嵌 `H`、`P`、`AH`、`NH`、`P.M.` 等文字，文字由组件单独渲染。
- 文件名只使用小写英文与连字符，同组图标保持一致的视觉重量和基线。

## 1. 背景与目标

本项目目标是实现一个面向吉他用户的六线谱编辑器，核心体验参考常见 TAB 编辑软件：用户可以在六线谱上输入品位音符，添加常用演奏技巧、歌词、和弦与和弦图，并能持续扩展到播放、导入导出、协作等能力。

本方案优先解决以下问题：

- 六线谱可稳定渲染，支持多行、多小节固定宽度排版。
- 支持品位音符输入、删除、移动、复制、撤销重做。
- 支持常用技巧标记：击弦、勾弦、上滑音、下滑音、推弦、颤音、泛音、闷音等。
- 支持添加小节、修改拍号、速度、调号等基础谱面信息。
- 支持歌词输入，并与小节/拍点对齐。
- 支持和弦名称与和弦图的输入和渲染。
- 数据结构清晰，为后续播放、MusicXML/GP 导出、云端保存留出空间。

### 1.1 MVP 视口边界

MVP 不做响应式适配，只验收桌面端 `1280 × 720` 及以上视口。谱面画布采用固定逻辑宽度，窗口宽度变化不改变每行小节数量，也不触发重新断行。

首版固定每行 4 小节，允许编辑器内部出现必要的画布滚动；页面外层不得出现非预期滚动条。移动端、平板端、适应宽度、动态断点和分页打印排版全部放到 MVP 之后。

## 2. 技术选型

### 2.1 前端框架

继续使用当前项目技术栈：

- `Next.js + React + TypeScript`
- 样式依赖使用 `TailwindCSS`、`sass` 和统一的 className 组合工具；通用操作图标使用 `lucide-react`。
- 状态管理统一使用 `Zustand`；撤销重做使用 `zundo` 的 temporal store，并通过领域 command 约束所有谱面写操作。
- 文档边界使用 `Zod` 做运行时结构验证，业务内部类型优先由 Zod schema 推导。
- 样式层使用 `TailwindCSS + SCSS Modules`：TailwindCSS 处理布局和通用视觉原子，组件专属样式统一使用 `*.module.scss`。
- Ant Design 可用于弹窗、表单、下拉菜单和输入框等常规 UI，通过主题变量与项目样式保持一致。
- 谱面渲染区域独立封装为编辑器核心包，建议放在 `packages/lxm-tabeditor`，避免业务页面和谱面逻辑耦合。

### 2.2 样式架构

样式职责必须清晰，避免同一规则同时由 TailwindCSS 和 SCSS Modules 控制：

- TailwindCSS：页面布局、Flex/Grid、间距、尺寸、常用文字和颜色工具类；MVP 不定义响应式断点。
- `*.module.scss`：编辑器复杂状态、伪元素、SVG 子元素选择器、画布命中区域、技巧连线、动画和浏览器兼容规则。
- 全局样式：仅保留 TailwindCSS 入口、字体声明、CSS Reset 补充和主题 CSS Variables，文件使用 `globals.scss`。
- 动态样式：坐标、宽高和缩放等 layout 计算结果通过 React `style` 或 SVG attributes 注入，不生成动态 Tailwind class。
- Ant Design 覆盖：优先使用 `ConfigProvider` theme token；确需局部覆盖时放入对应组件的 `.module.scss`，避免大范围全局选择器。

推荐约束：

- React 组件必须通过 `import styles from "./ComponentName.module.scss"` 使用模块样式。
- 通用布局优先写 Tailwind class，出现三处以上且语义稳定时再抽取组件，不使用大量 `@apply` 复制工具类。
- className 条件组合使用统一工具函数，不手工拼接带空格的魔法字符串。
- 颜色、层级、谱面尺寸、弦距和命中区域等共享值定义为 CSS Variables 或 TypeScript 常量。
- `.module.scss` 中嵌套层级控制在三层以内；谱面 SVG 使用明确的语义类名，不依赖 `nth-child` 定位业务元素。
- TailwindCSS content 扫描范围必须包含 `apps/website` 与 `packages/lxm-tabeditor`，保证核心包中的类名被正确生成。

### 2.3 渲染方案（svg）

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
      TabEditor.module.scss
      ScoreCanvas.tsx
      ScoreCanvas.module.scss
      MeasureView.tsx
      MeasureView.module.scss
      TechniqueLayer.tsx
      TechniqueLayer.module.scss
      LyricsLayer.tsx
      LyricsLayer.module.scss
      ChordDiagram.tsx
      ChordDiagram.module.scss
    input/
      keyboard-map.ts
      pointer-controller.ts
      note-input-controller.ts
      lyrics-input-controller.ts
      chord-input-controller.ts
    store/
      score-store.ts
      editor-store.ts
      viewport-store.ts
      history-config.ts
    commands/
      command-types.ts
      note-commands.ts
      measure-commands.ts
      technique-commands.ts
      chord-commands.ts
    import-export/
      lxm-json.ts
      musicxml.ts
      gp-adapter.ts
```

页面侧目录：

```text
apps/website/app/
  page.tsx
  globals.scss
apps/website/components/
  editor-shell/
    HeaderBar.tsx
    HeaderBar.module.scss
    Toolbar.tsx
    Toolbar.module.scss
    Sidebar.tsx
    Sidebar.module.scss
    PlaybackBar.tsx
    PlaybackBar.module.scss
apps/website/assets/
  fonts/
    Bravura.otf
  svg/
    brand/
    music-controls/
    techniques/
    svg-assets-manifest.ts
```

核心原则：

- `packages/lxm-tabeditor` 只关心乐谱数据、排版、渲染和编辑命令。
- `apps/website` 只负责页面框架、按钮、弹窗、保存状态、导入导出入口。
- 所有谱面编辑行为都通过 command 进入 Zustand store，不允许组件直接修改 `score`。
- 选区、悬停、弹窗、视口等临时 UI 状态不进入撤销历史。

## 4. 核心数据模型

### 4.0 基础类型

持久化模型中的基础类型必须显式定义，避免 JSON 生产方自行猜测字段格式：

```ts
export type BaseDuration =
  | "whole"
  | "half"
  | "quarter"
  | "eighth"
  | "sixteenth"
  | "thirtySecond";

export interface RhythmValue {
  base: BaseDuration;
  dots: 0 | 1 | 2;
}

export interface TimeSignature {
  numerator: number;
  denominator: 1 | 2 | 4 | 8 | 16 | 32;
}

export type BarlineType = "single" | "double" | "final" | "repeatStart" | "repeatEnd";

export interface TieLink {
  targetNoteId: string;
}
```

`RhythmValue` 只保存基础时值与附点数，实际 tick 数由节奏计算函数派生。延音线只在起始音符保存 `TieLink`，结束状态通过目标音符反向索引推导，避免同时维护 start/stop 两份状态。

### 4.1 Score

```ts
export interface Score {
  id: string;
  title: string;
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
  timeSignature?: TimeSignature;
  beats: Beat[];
  tuplets: TupletGroup[];
  barline?: BarlineType;
  chordSymbols: ChordSymbol[];
  lyrics: LyricSegment[];
  pickup?: boolean;
}

export interface BeatBase {
  id: string;
  tick: number;
  rhythm: RhythmValue;
}

export interface NoteBeat extends BeatBase {
  kind: "notes";
  notes: TabNote[];
}

export interface RestBeat extends BeatBase {
  kind: "rest";
}

export type Beat = NoteBeat | RestBeat;

export interface TupletGroup {
  id: string;
  actualNotes: 2 | 3 | 4 | 5 | 6;
  normalNotes: 2 | 3 | 4;
  beatIds: string[];
  bracket: "auto" | "show" | "hide";
}
```

模型约束：

- `NoteBeat.notes` 至少包含一个音符，`RestBeat` 不允许存在 `notes` 字段，从类型层消除“休止拍同时有音符”的非法状态。
- `TupletGroup.beatIds` 按时间顺序引用同一小节内的连续拍点；拍点所属连音组通过 selector 反向索引，不在 Beat 上重复保存 group ID。
- `actualNotes` 表示实际演奏数量，`normalNotes` 表示占用的普通音符数量，例如五连音 `5:4`。
- `pickup=true` 表示弱起/不完整小节，此时允许小节容量小于有效拍号容量；普通小节必须严格等于容量。
- 小节顺序由 `Track.measures` 数组位置唯一决定，不持久化容易失效的 `index` 字段；界面小节号由 selector 派生。

### 4.4 TabNote

```ts
export interface TabNote {
  id: string;
  string: number;
  fret: number | "x";
  techniques: Technique[];
  tie?: TieLink;
  ghost?: boolean;
}
```

说明：

- `string` 使用 1 到 6，1 表示最细的高音 E 弦。
- `fret` 支持数字与 `x`，用于闷音。
- 多音同时按下时，多个 `TabNote` 放在同一个 `Beat.notes` 中。
- 时值属于拍点而不是单个音符；MVP 单声部中同一拍点的全部音符共享 `Beat.rhythm`。
- `fret="x"` 是死音的唯一持久化表达，不再额外保存 `deadNote` 技巧，避免同一语义存在两份状态。

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
  | { type: "palmMute"; targetNoteId?: string };
```

技巧建议以“音符关系”为中心存储，而不是只存一段装饰线。比如击弦、勾弦、滑音都应指向 `targetNoteId`，这样编辑、删除和导出更可靠。

- `palmMute.targetNoteId` 缺省时只作用于当前音符；存在时表示从当前音符持续到目标音符。
- 技巧使用 `type` 作为 Zod discriminated union 判别字段，禁止退化为 `Record<string, unknown>`。
- 延音线属于音高持续关系，保存在 `TabNote.tie`，不放入 `Technique`。

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
  chordDefinitionId: string;
  label?: string;
  display: ChordDisplayMode;
}

export type ChordDisplayMode = "nameAndDiagram" | "nameOnly" | "hidden";

export interface ChordDefinition {
  id: string;
  name: string;
  frets: Array<number | "x">;
  fingers?: Array<number | null>;
  baseFret?: number;
  barres?: ChordBarre[];
}

export interface ChordBarre {
  fret: number;
  fromString: number;
  toString: number;
  finger?: number;
}
```

和弦名称与按法定义分离，但在谱面展示时组成一个整体：

- 每个 `ChordSymbol` 必须通过 `chordDefinitionId` 关联一个具体按法，默认名称从 `ChordDefinition.name` 派生；`label` 仅用于显式覆盖谱面显示名称。
- 默认 `display` 为 `nameAndDiagram`，在对应拍点的谱面上方同时展示和弦图和名称，如 `Am`、`G/B`。
- 当同一和弦在后续小节重复出现时，可由用户切换为 `nameOnly`，减少谱面纵向占用；这属于显式显示配置，不由渲染器猜测。
- 同名和弦可以有多个按法，用户输入时从和弦库选择或新建按法。
- `frets` 与 `fingers` 均按 1 弦到 6 弦排列；`0` 表示空弦，`"x"` 表示不弹。
- 横按使用 `barres` 表达，不能只依赖多个相同品位的圆点推断。

## 5. 时间与排版模型

### 5.1 Tick 体系

建议使用固定 PPQ：

```ts
export const TICKS_PER_QUARTER = 960;
```

常用时值：

```ts
export const BASE_DURATION_TICKS = {
  whole: 3840,
  half: 1920,
  quarter: 960,
  eighth: 480,
  sixteenth: 240,
  thirtySecond: 120,
} as const;
```

节奏 tick 计算：

```ts
export const getRhythmTicks = (
  rhythm: RhythmValue,
  tuplet?: TupletGroup,
): number => {
  const baseTicks = BASE_DURATION_TICKS[rhythm.base];
  const dottedMultiplier = rhythm.dots === 0 ? 1 : rhythm.dots === 1 ? 1.5 : 1.75;
  const tupletMultiplier = tuplet ? tuplet.normalNotes / tuplet.actualNotes : 1;

  return baseTicks * dottedMultiplier * tupletMultiplier;
};
```

当前 PPQ 为 960，MVP 支持的基础时值、0 至 2 个附点及二至六连音组合都必须得到整数 tick；Zod 和语义校验器需要拒绝非整数结果或不受支持的比例。

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
  tuplets: LayoutTuplet[];
}

export interface LayoutTuplet {
  tupletGroupId: string;
  startX: number;
  endX: number;
  y: number;
  label: string;
  showBracket: boolean;
}
```

排版流程：

1. 使用固定谱面逻辑宽度作为 system 宽度，页面容器变化不直接改变内部坐标系。
2. 为每个小节生成 `RhythmicColumn`，同一 tick 上的 TAB、歌词、简谱和和弦未来共享同一列。
3. 根据时值光学权重、最小可读列宽和未来内容占用计算小节 `minWidth` 与 `idealWidth`。
4. 默认由 system breaker 在固定 system 宽度内选择每行小节范围；测试和特殊场景可通过 `measuresPerSystem` 强制固定每行小节数。
5. 在每个 system 内按小节 `minWidth/idealWidth` 分配 `assignedWidth`，不再对同一行小节平均分配。
6. 在小节内部生成 `BeatSpacingSlot`，note、rest、duration、beam、tuplet、tie 和 hitIndex 全部消费同一份 spacing slot。
7. 根据弦号计算 y 坐标，根据 `TupletGroup.beatIds` 计算连音组首尾坐标、编号和括号策略。
8. 后续歌词与简谱通过 `RhythmicColumn` 反向增加列宽，通过 vertical lane 增加 system 高度。
9. 运行碰撞检测，必要时扩大谱表顶部/底部留白或调整同层元素位置。

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
- 附点、双附点和连音组编号/括号。
- 选中态、悬停态、输入预览态。

品位数字使用普通文本，不使用 Bravura。原因是 TAB 数字需要清晰、稳定、可选中。

附点可以使用标准化后的点状 SVG 或动态圆点；连音图标只用于工具栏，谱面中的连音括号必须根据 `TupletGroup.beatIds` 对应的首尾 layout 坐标动态绘制。

### 6.3 技巧层

技巧层单独渲染，避免和音符数字混在一起：

- 击弦：两音之间弧线 + `H`。
- 勾弦：两音之间弧线 + `P`。
- 上滑音：斜线 `/` 或连接线。
- 下滑音：斜线 `\` 或连接线。
- 推弦：上方弧线/箭头 + 半音数。
- 颤音：波浪线。
- 泛音：菱形或 `AH/NH` 文本。
- 死音/制音：渲染 `fret="x"` 的品位文本，不再维护重复的 `deadNote` 技巧状态。

技巧渲染依赖 `LayoutNote`，当目标音符不存在时 validation 应清理或提示。

### 6.4 歌词层

歌词层放在当前谱表下方：

- 每个 `LyricSegment` 根据 tick 对齐到 x。
- 支持单行歌词，第二阶段支持多段歌词。
- 文本编辑时使用一个浮动 input/textarea 覆盖在 SVG 上方。

### 6.5 和弦图层

和弦图和和弦名称作为一个 `ChordMarker` 渲染在对应 tick 的谱面上方。`ChordMarker` 使用 SVG 渲染，并保持固定视觉结构：

- 和弦名称必须展示，并与和弦图水平居中对齐。
- 和弦图默认位于名称下方；若最终视觉规范要求名称在图下方，只调整布局常量，不改变数据模型。
- `ChordMarker` 的锚点是 `ChordSymbol.tick`，整体优先居中对齐该拍点。
- 同一行多个和弦图发生重叠时，先增加小节最小宽度；仍不足时增加该谱表的和弦区域高度并分层排列。
- 换行时和弦图必须跟随所属小节，不允许单独留在上一行。

和弦图内部包含：

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
- 保存后立即在当前拍点上方生成“和弦名称 + 和弦图”，并自动加入或复用 `chordLibrary` 中的按法。

建议增加独立布局模型，避免渲染组件重复计算：

```ts
export interface LayoutChordMarker {
  chordSymbolId: string;
  chordDefinitionId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  display: ChordDisplayMode;
}
```

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
  deadNoteInput: "x",
} as const;
```

`deadNoteInput` 是将当前音符品位设置为 `"x"` 的输入命令，不会向 `Technique[]` 写入数据。

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

采用“领域 Command + Zustand/zundo 历史快照”的组合方案：

- Command 负责表达业务意图、参数校验和原子更新，例如添加音符、改变品位、添加技巧、插入小节。
- Zustand 是唯一写入入口；command 最终调用 store action 更新 `score`。
- `zundo` 负责保存 `score` 的 temporal history，提供 `undo`、`redo`、`clear`、`pause` 和 `resume`。
- 不实现一套与 `zundo` 重复的 `apply/revert` 命令栈；command 不保存反向操作，历史恢复由 `zundo` 完成。

```ts
export type ScoreCommand =
  | { type: "note.add"; payload: AddNotePayload }
  | { type: "note.updateFret"; payload: UpdateFretPayload }
  | { type: "note.delete"; payload: DeleteNotePayload }
  | { type: "measure.add"; payload: AddMeasurePayload }
  | { type: "technique.apply"; payload: ApplyTechniquePayload }
  | { type: "chord.upsert"; payload: UpsertChordPayload };

export interface ScoreActions {
  executeCommand: (command: ScoreCommand) => void;
  executeTransaction: (commands: ScoreCommand[]) => void;
}
```

历史策略：

- 连续输入两位品位数字、拖拽移动、歌词连续输入需要合并为一次历史记录；操作开始时 `pause`，提交时 `resume` 并记录一次快照。
- 批量粘贴、插入小节并填充默认拍点等复合操作使用 `executeTransaction`，保证一次撤销完整恢复。
- `selectedNoteIds`、hover、当前工具、缩放和滚动位置不进入历史。
- 加载新文档后调用 `clear`，防止撤销回到上一份文档。
- 自动保存、服务端同步和 layout 计算不得产生历史记录。
- 默认限制历史为 100 步，并根据实际文档规模做内存压测。

## 8. 状态管理

状态管理统一使用 Zustand，并按职责拆分：

- `useScoreStore`：乐谱文档与 command actions；仅该 store 接入 `zundo`，可持久化。
- `useEditorStore`：选区、模式、当前时值、当前工具、输入草稿；不进入撤销历史，仅按需持久化偏好设置。
- `useViewportStore`：画布尺寸、缩放、滚动位置、可见谱表范围；不进入撤销历史。
- `layoutState` 不作为可写 store 保存，它由 score、字体度量和 viewport 通过 selector/layout service 派生。缓存以不可变 `score` 对象引用和 viewport 参数为键，确保 undo/redo 后不会误用旧排版。

```ts
export interface EditorState {
  mode: EditorMode;
  selectedNoteIds: string[];
  selectedMeasureIds: string[];
  activeBeat?: { measureId: string; tick: number; string: number };
  currentRhythm: RhythmValue;
  currentTechnique?: Technique["type"];
}
```

React 层建议：

- Zustand selector 必须细粒度订阅，组合返回值使用 `useShallow`，避免整个画布订阅完整 store。
- `useMemo` 缓存当前谱表的 layout 和命中索引。
- `useCallback` 包装 command dispatch、键盘和指针事件。
- 大谱面时对行级 `SystemView` 使用 `React.memo`。
- React 组件优先使用 `const ComponentName: React.FC<Props> = (props) => {}`，关键状态转换和复杂排版逻辑添加中文注释。

示意代码：

```ts
export const useScoreStore = create<ScoreStore>()(
  temporal(
    (set, get) => ({
      score: createEmptyScore(),
      executeCommand: (command) => {
        // 所有谱面变更统一经过领域命令，确保校验、历史和持久化行为一致。
        const nextScore = reduceScoreCommand(get().score, command);
        set({ score: nextScore });
      },
    }),
    {
      limit: 100,
      partialize: (state) => ({ score: state.score }),
    },
  ),
);
```

## 9. 输入校验

关键校验：

- `string` 必须在调弦范围内。
- `fret` 范围建议默认 0 到 24，可根据乐器配置修改。
- 同一 beat 同一 string 不允许多个音符。
- `NoteBeat.notes` 不得为空，`RestBeat` 不得携带 `notes`。
- 普通小节总时值必须等于拍号容量；弱起小节允许小于容量，但不能超过容量。
- `RhythmValue.dots` 只允许 0、1、2，派生 tick 必须为整数。
- `TupletGroup.beatIds` 必须引用同一小节内连续、按 tick 递增的拍点。
- 每个拍点最多属于一个连音组，连音组成员数必须等于 `actualNotes`。
- 关系型技巧的 `targetNoteId` 必须存在。
- 击弦/勾弦通常要求同弦且目标音符在后方。
- 延音目标必须位于后方、同弦且计算后的实际音高一致。
- `fret="x"` 时不得同时存在延音线、击弦、勾弦或推弦等要求确定音高的关系。
- 和弦图的 `frets` 长度必须等于弦数。
- `ChordSymbol.chordDefinitionId` 必须指向存在的和弦按法。
- 同一小节同一 tick 默认只允许一个可见和弦标记。

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
  documentRevision: number;
  score: Score;
}
```

优点：

- 与编辑器模型完全一致。
- `schemaVersion` 可以快速识别不受支持的文档版本。
- 后续可增加 MusicXML、MIDI、Guitar Pro 的导入导出适配器。

当前不考虑向下兼容：加载器只接受当前 `schemaVersion`，其他版本直接返回 `UNSUPPORTED_SCHEMA_VERSION`，不维护 migration 链。版本升级时同步升级示例数据、Zod schema 和相关测试。

### 10.1 Zod 结构验证

建议使用 `Zod` 作为 JSON 文档的运行时结构验证工具，并由 Zod schema 推导 TypeScript 类型，避免手写 interface 与校验规则逐渐不一致：

```ts
export const lxmScoreDocumentSchema = z.object({
  schema: z.literal("lxm-tab-score"),
  schemaVersion: z.literal(1),
  documentRevision: z.number().int().nonnegative(),
  score: scoreSchema,
});

export type LxmScoreDocument = z.infer<typeof lxmScoreDocumentSchema>;
```

文档加载管线固定为：

1. 使用 `JSON.parse` 检查 JSON 语法并得到 `unknown`，捕获解析异常。
2. 只读取 `schema` 与 `schemaVersion`；版本不是当前值时立即拒绝，禁止直接断言为业务类型。
3. 使用 `lxmScoreDocumentSchema.safeParse` 验证字段类型、枚举、数值范围和数组长度。
4. 运行独立的 `validateScoreSemantics`，检查 Zod 不适合承担的跨引用规则。

Zod schema 负责：

- 必填字段、枚举值和 discriminated union。
- 品位、弦号、速度、拍号等数值范围。
- 调弦、和弦品位和指法数组长度。
- 技巧类型对应参数是否完整。

语义校验器负责：

- `targetNoteId`、`chordDefinitionId` 等 ID 引用是否存在。
- 击弦、勾弦、滑音和延音目标是否位于合法时间与弦上。
- 小节时值总量、同一拍同一弦冲突、和弦标记冲突。
- ID 全局唯一性和跨小节关系完整性。

不建议仅用 JSON Schema 替代 Zod：编辑器内部以 TypeScript 为主，Zod 在类型推导、错误路径和 discriminated union 上更适合当前工程。需要对外开放格式时，可以从 Zod schema 生成 JSON Schema，而不是维护两套规则。

完整 TypeScript 示例通过 `docs/guitar-tab-editor-example.ts` 指向核心包规范夹具，避免文档与测试维护两份数据。

### 10.2 Iteration 1 已落地接口

核心包通过 `@liuxianmao/lxm-tabeditor` 暴露当前版本 schema、推导类型、节奏工具、加载器、语义校验、Command reducer 和三类 Zustand store；规范夹具仅通过 `@liuxianmao/lxm-tabeditor/testing` 暴露。

- `loadScoreDocument(json)` 严格执行 JSON 解析、版本预检、Zod 结构校验和语义校验，返回带 `code`、`path`、`level` 与可选 `targetId` 的判别联合结果。
- `reduceScoreCommand(score, command)` 和 `reduceScoreTransaction(score, commands)` 是纯函数；失败时返回问题列表，不修改输入 score。
- `useScoreStore` 是乐谱写入唯一入口，仅 `score` 进入 zundo 历史；`documentRevision`、命令错误、编辑器状态和视口状态不进入历史。
- `executeTransaction` 在内存完成全部命令后只提交一次；加载新文档会清空历史，默认最多保存 100 步。
- `pnpm test` 运行核心模型、节奏、语义、Command、历史和 SVG 流水线测试；`pnpm assets:build` 重建标准化 SVG。

## 11. 性能策略

第一版目标：

- 100 小节内编辑流畅。
- 只重新排版受影响行。
- 输入数字、切换选区、添加技巧不明显卡顿。

策略：

- 使用结构化数据，尽量保持引用稳定。
- layout 使用 `useMemo`，依赖不可变 score 引用和 viewport；深层排版缓存使用 `WeakMap<Score, LayoutCache>`。
- 行级渲染组件 `SystemView` 使用 `React.memo`。
- 长谱面使用虚拟列表，只渲染可见行与上下缓冲行。
- 命中检测优先使用 layout 索引，不在每次 pointer move 中扫描整份 score。

## 12. 迭代计划

详细计划、验收标准和完成状态统一维护在 `docs/guitar-tab-editor-iteration-plan.md`。

当前状态：

- Iteration 0 技术与视觉基线已完成。
- Iteration 1 至 Iteration 8 属于 MVP，均等待确认后开始。
- Iteration 9 为播放与高级能力，不属于当前 MVP。
- 未经用户确认，不开始下一迭代；只有完整通过验收的迭代才标记完成。

## 13. 风险与取舍

### 13.1 不直接依赖完整打谱库

VexFlow 等打谱库可以作为参考或局部辅助，但第一版不建议把整个编辑器状态绑定到第三方库内部模型。原因：

- 六线谱编辑器需要大量自定义交互。
- 技巧、歌词、和弦图的输入体验很难完全依赖库提供。
- 后续导入导出、自动保存、撤销重做都更适合使用自己的文档模型。

### 13.2 SVG 排版复杂度

自研 SVG 排版需要投入，但收益是交互可控、样式可控、后续扩展成本低。第一版排版规则保持固定行高、固定谱面宽度和固定每行小节数，先保证 `1280 × 720` 桌面视口稳定，再逐步优化拥挤小节的宽度分配。

### 13.3 音符字体

Bravura 是 SMuFL 字体，适合渲染音乐符号，但 TAB 数字、中文、按钮文字不要使用 Bravura。音乐字体只用于休止符、谱号、升降号、拍号等符号，避免字体度量导致 UI 异常。

## 14. 推荐落地顺序

1. 建立 `packages/lxm-tabeditor`、Zod schema、语义校验和测试夹具。
2. 建立 Zustand stores、领域 Command reducer 与 zundo 历史基础设施。
3. 实现 `layoutScore(score)` 与只读 SVG 六线谱渲染。
4. 实现点击定位、品位输入、时值编辑和小节操作。
5. 接入选区、剪贴板和面向用户的撤销重做。
6. 依次实现技巧、歌词与和弦图，避免多个复杂输入模式同时开发。
7. 最后完成保存恢复、自动保存、打印导出、可访问性和性能验收。

具体范围和完成状态以 `docs/guitar-tab-editor-iteration-plan.md` 为准。该顺序确保渲染和交互始终建立在已经验证的数据与历史模型上。

## 15. 方案完整性补充

再次检查后，除核心输入和渲染外，还需要纳入以下能力，避免进入开发后再反复调整底层模型。

### 15.1 节奏表达

- MVP 正式支持 0 至 2 个附点、二至六连音、延音线和跨小节延音。
- 弱起小节通过 `Measure.pickup` 明确表达，普通小节必须满足拍号容量。
- MVP 限制为单声部，同一拍点上的多弦音符共享节奏；多声部通过后续新增 voice 模型实现，不在当前结构中预埋半成品字段。

### 15.2 编辑器基础能力

- 框选、跨小节多选、复制、剪切、粘贴和重复小节。
- 光标移动、范围删除、批量修改时值和批量应用技巧。
- 输入法焦点管理：普通快捷键不能干扰歌词和和弦名称的中文输入。
- 键盘操作、ARIA 标签、焦点可见性和高对比选中态。

### 15.3 文档可靠性

- 自动保存需要 debounce、保存状态提示、失败重试和离开页面保护。
- 本地草稿与服务端版本都应带 `documentRevision`，检测并发覆盖；该字段属于持久化元数据，不进入 zundo 历史。第一版可提示冲突，不要求实时协作。
- 加载文档先做 schema 与版本校验，失败时保留原始数据并给出可恢复提示。
- 字体加载完成后再进行首次精确排版；Bravura 加载失败时显示错误状态，避免用错误字体静默渲染。

### 15.4 排版与导出

- 统一屏幕、打印、SVG/PDF 导出的字号和度量常量，避免导出结果与编辑画布不同。
- MVP 之后再支持缩放、适应宽度、分页预览、纸张尺寸和页边距。
- 建立文本和图形碰撞测试，覆盖技巧线、歌词、和弦图、谱表换行和跨行关系技巧。

### 15.5 测试策略

- 单元测试：command reducer、时值计算、Zod 结构验证、语义 validation、和弦按法校验。
- 属性/随机测试：连续执行 command 后 undo/redo 应恢复完全一致的 score。
- 视觉回归：固定乐谱在常见视口和打印尺寸下截图对比，重点覆盖和弦图与技巧避碰。
- 端到端测试：品位输入、技巧连接、添加小节、歌词输入、和弦输入、撤销重做、保存再加载。

### 15.6 暂不纳入首版

- 实时多人协作、完整 Guitar Pro 高保真导入、自动和弦识别、多声部编辑和专业级音频引擎不进入 MVP。
- 这些能力保留适配边界，但不提前增加首版数据流和交互复杂度。
