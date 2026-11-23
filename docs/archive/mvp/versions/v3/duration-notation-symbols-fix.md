# MVP v3 Fix：谱面时值符号补全

## 1. 问题说明

当前音符 beat 的时值图形由 `duration-beam-layout.ts` 输出，页面主要绘制符干、附点和连梁。现有结果无法完整表达基础时值：

- `whole`、`half`、`quarter` 的 `beamLevel` 都是 `0`，缺少可区分它们的节奏头。
- `eighth`、`sixteenth`、`thirtySecond` 只有在能组成 shared/partial beam 时才可通过连梁层数识别。
- 单独出现的短时值没有相邻 beat，现有 `layoutBeamSegments` 不会生成连梁，也没有 flag，因此看起来与四分音符相同。
- 附点只能表达基础时值的延长次数，不能代替基础时值符号。
- 当前符干起点取决于 beat 中最低音符所在弦，同一行节奏符号的垂直位置可能跳动，不适合作为稳定的时值阅读层。

工具栏高亮只能反馈当前选中 beat，不能让未选中的整份谱面保持可读。因此本 fix 在核心 layout 中补齐谱面时值符号，工具栏状态不属于本方案的替代物。

## 2. 修复目标

修复后，每个 `kind === "notes"` 且含有至少一个音符的 beat，应仅凭谱面图形区分以下基础时值：

| 基础时值       | 节奏头         | 符干 | 旗帜或连梁 |
| -------------- | -------------- | ---- | ---------- |
| `whole`        | 空心全音符头   | 无   | 无         |
| `half`         | 空心二分音符头 | 有   | 无         |
| `quarter`      | 实心音符头     | 有   | 无         |
| `eighth`       | 实心音符头     | 有   | 1 层       |
| `sixteenth`    | 实心音符头     | 有   | 2 层       |
| `thirtySecond` | 实心音符头     | 有   | 3 层       |

具体不变量：

- 一个 beat 即使包含多个 TAB 音符（和弦），也只生成一套时值符号。
- 连续短时值优先使用现有 shared/partial beam。
- 没有任何连梁覆盖的孤立短时值使用一个 composite flag glyph，层数与 `beamLevel` 一致。
- `whole` 不生成符干；`half` 及更短音符按规则生成符干。
- 附点跟随节奏头，而不是跟随 TAB 品位数字、符干末端或连梁基线。
- 休止 beat 继续由 `rest-layout.ts` 的休止符 glyph 表达时值，不重复生成节奏头、符干或 flag。
- 页面只消费 layout 产物，不根据 `rhythm.base` 自行推导时值图形。

## 3. 视觉决策：六线谱下方的独立节奏符号行

### 3.1 不把节奏头叠加到品位数字

TAB 品位数字承担音高/指法位置语义，不能像五线谱音符头一样直接切换为空心或实心。把椭圆音符头叠在数字上还会带来以下问题：

- 两位品位数字宽度不同，音符头很难稳定包围。
- 和弦包含多个数字，但时值属于 beat，只应显示一次。
- 数字描边、选中光标和音符头容易互相遮挡。

因此本方案在第六弦下方建立独立的 rhythm lane：

```text
TAB staff       ───3────────5────7──────

rhythm lane        ●        ●────●
                   │        │    │
                            shared beam
```

节奏头横坐标继续使用 beat slot 的时间锚点；纵坐标使用同一小节共享的固定 rhythm lane，不再取决于某个音符位于第几弦。

### 3.2 字形来源

优先复用网站已经加载的 Bravura 字体和 SMuFL 字形：

| 用途                 | SMuFL 名称      | 码位     |
| -------------------- | --------------- | -------- |
| 全音符头             | `noteheadWhole` | `U+E0A2` |
| 二分音符头           | `noteheadHalf`  | `U+E0A3` |
| 四分及更短音符头     | `noteheadBlack` | `U+E0A4` |
| 八分音符向下旗帜     | `flag8thDown`   | `U+E241` |
| 十六分音符向下旗帜   | `flag16thDown`  | `U+E243` |
| 三十二分音符向下旗帜 | `flag32ndDown`  | `U+E245` |

参考：

- [SMuFL Noteheads](https://www.w3.org/2021/03/smufl14/tables/noteheads.html)
- [SMuFL Flags](https://www.w3.org/2021/03/smufl14/tables/flags.html)

符干与连梁继续使用 SVG primitive 绘制，以便由 layout 精确控制长度和层间距。字形码位必须集中维护在核心 layout 文件中，不散落在 React JSX 或 SCSS 中。

## 4. 外部接口与领域模型

### 4.1 文档 schema 不变

`ILXMBeat.rhythm` 已包含完整时值数据：

```ts
interface ILXMRhythm {
  base: "whole" | "half" | "quarter" | "eighth" | "sixteenth" | "thirtySecond";
  dots: number;
}
```

时值符号是派生布局状态，不写入 `ILXMDocument`，不新增持久化字段，也不修改 `beat.setRhythm` 命令。

### 4.2 `ILXMDurationMarkLayout` 扩展

在 `packages/lxm-editor/src/layout/layout-types.ts` 中新增：

```ts
export interface ILXMDurationGlyphLayout {
  glyph: string;
  x: number;
  y: number;
  fontSize: number;
}

export interface ILXMDurationMarkLayout {
  beatId: string;
  measureId: string;

  /** 固定 rhythm lane 中的节奏头。 */
  head: ILXMDurationGlyphLayout;

  /** whole 为 false；half 及更短时值为 true。 */
  stemVisible: boolean;
  stemX: number;
  stemY1: number;
  stemY2: number;

  beamY: number;
  beamLevel: number;

  /** 仅孤立短时值生成；连续短时值继续使用 beamSegments。 */
  flag: ILXMDurationGlyphLayout | null;

  dots: number;
  dotAnchors: ILXMDurationDotAnchor[];
}
```

选择单个 composite `flag` 而不是 `flags[]`，原因是 SMuFL 的 `flag16thDown` 和 `flag32ndDown` 已经包含完整层数。混合节奏组中的额外层级继续由现有 partial beam 表达，不需要把 composite flag 与 beam 混画。

`head` 必须始终存在于 notes beat 的 duration mark；`flag` 可以为空。这样页面渲染分支简单，调试 layout 时也能直接读取最终 glyph 和坐标。

## 5. 布局算法

### 5.1 固定 rhythm lane 坐标

在 `layout-constants.ts` 中集中增加建议初值：

```ts
export const LXM_DURATION_HEAD_OFFSET_Y = 10;
export const LXM_DURATION_HEAD_FONT_SIZE = 16;
export const LXM_DURATION_STEM_ATTACH_OFFSET_X = 4;
export const LXM_DURATION_STEM_LENGTH = 28;
export const LXM_DURATION_FLAG_FONT_SIZE = 18;
export const LXM_DURATION_FLAG_OFFSET_X = 0;
export const LXM_DURATION_FLAG_OFFSET_Y = 0;
export const LXM_DURATION_FLAG_DESCENT = 36;
export const LXM_DURATION_LANE_BOTTOM_PADDING = 12;
```

最终数值允许在浏览器视觉验收阶段小幅调整，但各模块必须只读取这些常量，不复制魔法数字。`FLAG_DESCENT` 不能直接等于 `FLAG_FONT_SIZE`：Bravura flag 的 glyph bounding box 明显大于 CSS 字号，当前值由目标浏览器实测包围框向上取整得到。

对一个小节：

```text
lastStringY = 最下方弦线 y
headY       = lastStringY + LXM_DURATION_HEAD_OFFSET_Y
stemX       = headX - LXM_DURATION_STEM_ATTACH_OFFSET_X
stemY1      = headY
stemY2      = headY + LXM_DURATION_STEM_LENGTH
beamY       = stemY2
```

所有 beat 共享相同的 `headY / stemY2 / beamY`。节奏头和符干不再穿过下方未演奏的弦线，也不会因和弦最低音变化而上下跳动。

`head.x` 使用对应 `ILXMBeatLayout.x`。向下符干通过集中常量连接到节奏头左侧，不能穿过节奏头中心。head 使用 `textAnchor="middle"` 和 `dominantBaseline="middle"`，使 `head.x/head.y` 表达视觉中心；flag 的字形原点则通过 `LXM_DURATION_FLAG_OFFSET_X/Y` 对齐符干末端。页面不得针对某个 glyph 写单独坐标偏移。

### 5.2 节奏头与符干映射

在 `duration-beam-layout.ts` 中维护纯映射：

```ts
const DURATION_HEAD_GLYPH = {
  whole: "\uE0A2",
  half: "\uE0A3",
  quarter: "\uE0A4",
  eighth: "\uE0A4",
  sixteenth: "\uE0A4",
  thirtySecond: "\uE0A4",
} satisfies Record<ILXMRhythmBase, string>;

const DURATION_HAS_STEM = {
  whole: false,
  half: true,
  quarter: true,
  eighth: true,
  sixteenth: true,
  thirtySecond: true,
} satisfies Record<ILXMRhythmBase, boolean>;
```

`buildDurationMark` 不再读取 `noteLayouts` 来决定纵坐标。`noteLayouts` 可以从该函数参数中移除；是否生成 mark 仍由上层对 `beat.kind === "notes" && beat.notes.length > 0` 的过滤决定。

### 5.3 连梁覆盖与孤立 flag

布局顺序调整为：

```text
生成 duration marks（head + stem）
  → 按拍组生成 beam groups
  → 生成 shared / partial beamSegments
  → 根据 beamSegments 判断哪些短时值完全没有连梁覆盖
  → 为孤立短时值补 composite flag
  → 将 flag 回填到对应 duration mark
```

flag 映射：

```ts
const DURATION_FLAG_GLYPH = {
  eighth: "\uE241",
  sixteenth: "\uE243",
  thirtySecond: "\uE245",
} as const;
```

判定规则：

```ts
const coveredBeatIds = new Set(
  beamSegments.flatMap((segment) => segment.beatIds),
);

flag =
  mark.beamLevel > 0 && !coveredBeatIds.has(mark.beatId)
    ? glyphFor(mark.rhythm.base)
    : null;
```

当前 `layoutBeamSegments` 对一个有邻居的短时值会为所需层级生成 shared 或 partial beam；只有完全孤立的短时值不会出现在任何 segment 中。因此使用 beat 级覆盖集合足够，不需要在本次 fix 中引入 `beatId + level` 覆盖矩阵。

若后续修改连梁算法，使某个 beat 可能只覆盖部分层级，则必须把覆盖键升级为 `${beatId}:${level}`，不能同时绘制重复层级。

### 5.4 附点位置

附点属于 rhythm，而不是 TAB 数字或 beam。改为：

```text
dot.x = head.x + headVisualHalfWidth + dotOffsetX + index * dotGapX
dot.y = head.y
```

首版可以使用集中常量近似 `headVisualHalfWidth`；若视觉验收发现三种 head glyph 的宽度差异明显，再将其扩展为按 head kind 映射。附点必须与节奏头处于同一 rhythm lane，不得继续使用最低音符 Y 或 beam level 推导 Y。

### 5.5 小节和 System 高度

新增 rhythm lane 后，现有 `calculateMeasureHeight()` 必须覆盖最下方 flag/glyph，避免 SVG viewBox 裁剪：

```text
measureHeight
  = LXM_STAFF_Y
  + LXM_STAFF_HEIGHT
  + LXM_DURATION_HEAD_OFFSET_Y
  + LXM_DURATION_STEM_LENGTH
  + flagDescent
  + LXM_DURATION_LANE_BOTTOM_PADDING
```

`flagDescent` 使用集中常量按最大三十二分旗帜预留。所有小节使用相同 rhythm lane 高度，System 现有的 `max(measure.height)` 逻辑保持不变。新增高度会自然传递到 `system.y`、整谱 `layout.height` 和 SVG viewBox。

## 6. 页面渲染

修改 `apps/website/components/EditorShell/index.tsx`：

```tsx
<g className={styles.durationLayer} pointerEvents="none">
  {measure.durationMarks.map((mark) => (
    <g key={mark.beatId}>
      <text
        className={styles.durationGlyph}
        x={mark.head.x}
        y={mark.head.y}
        fontSize={mark.head.fontSize}
        textAnchor="middle"
        dominantBaseline="middle"
      >
        {mark.head.glyph}
      </text>

      {mark.stemVisible && <line ... />}

      {mark.flag && (
        <text
          className={styles.durationGlyph}
          x={mark.flag.x}
          y={mark.flag.y}
          fontSize={mark.flag.fontSize}
        >
          {mark.flag.glyph}
        </text>
      )}

      {mark.dotAnchors.map(...)}
    </g>
  ))}
</g>
```

要求：

- `durationLayer` 使用 `font-family: Bravura, serif`。
- 页面只判断 `stemVisible`、`flag !== null`，不读取 `rhythm.base`。
- head、flag、dot、stem 和 beam 全部设置 `pointerEvents="none"`；编辑命中仍由核心 beat slot 决定。
- 不复用工具栏 SVG 图标。工具栏图标用于操作，谱面 glyph 用于排版，两者尺寸与定位语义不同。

## 7. 命中与编辑状态

本 fix 不改变 hit target：点击 rhythm lane 或原 TAB 弦线仍应返回稳定的 `measureId + beatId + string`。

当前 hit test 要求点击点接近某一根弦，因此 rhythm lane 本身默认不可点击。MVP v3 保持该行为，避免本 fix 扩大交互范围。如果产品需要直接点击节奏头选中 beat，应作为独立交互 fix：

- 新增 beat-level hit bounds；
- rhythm lane 点击只选择 beat，不伪造 string；
- 扩展 selection 类型，使 `string` 可选或拆分 beat/note selection。

不得为了让节奏头可点击而临时映射到第六弦。

修改 `beat.setRhythm` 后，store 重新调用 `buildLayout`，head、stem、flag、beam 和 dots 必须由最新 `beat.rhythm` 一次性重建，不保存临时 UI 状态。

## 8. 预计修改范围

```text
packages/lxm-editor/src/layout/
  layout-constants.ts       # rhythm lane、head、flag 尺寸常量
  layout-types.ts           # head / flag layout 类型与 stemVisible
  duration-beam-layout.ts   # head、stem、beam coverage、flag、dot 算法
  layout-helpers.ts         # measureHeight 覆盖新增 rhythm lane

packages/lxm-editor/tests/layout/
  duration-beam-layout.test.ts
  system-layout.test.ts     # 新高度和相邻 System Y 回归

apps/website/components/EditorShell/
  index.tsx                 # 渲染 layout 产出的 glyph
  index.module.scss         # Bravura duration layer 样式
```

原则上不修改：

- `core/types.ts`、`core/schema.ts`：领域时值已经完整。
- `core/commands.ts`：时值编辑命令不负责视觉符号。
- `rest-layout.ts`：休止符已有独立时值 glyph。
- System 宽度分配：新增内容只改变纵向 rhythm lane，不贡献横向列宽。

## 9. 测试方案

### 9.1 基础时值矩阵

对六种 `rhythm.base` 分别断言：

- `head.glyph` 映射正确；
- `stemVisible` 符合表格；
- `beamLevel` 为 `0 / 0 / 0 / 1 / 2 / 3`；
- 无附点时 `dotAnchors` 为空。

### 9.2 孤立短时值

对单个 eighth、sixteenth、thirtySecond beat：

- `beamSegments` 为空；
- `flag.glyph` 分别为 8th、16th、32nd down flag；
- flag 锚点与该 beat 的 `stemX / stemY2` 一致；
- 三种短时值仅看 layout 结果即可区分。

### 9.3 连续与混合连梁

- 两个连续 eighth：生成一层 shared beam，两个 mark 的 `flag` 都为 `null`。
- eighth + two sixteenth：第一层 shared beam、第二层 shared/partial 结果保持现有规则，不生成 flag。
- 附点导致高层 beam 断开时：保留现有 partial beam，不重复生成 composite flag。
- 跨拍组边界时：继续按现有 `groupContiguousMarks` 断开。

### 9.4 全、二分、四分

- whole：全音符头、`stemVisible === false`、无 flag、无 beam。
- half：二分音符头、`stemVisible === true`、无 flag、无 beam。
- quarter：实心音符头、`stemVisible === true`、无 flag、无 beam。

### 9.5 附点与坐标

- 0/1/2 个附点分别输出 0/1/2 个 anchor。
- 附点 Y 等于 `head.y`。
- 多附点只沿 X 轴递增。
- rhythm lane 坐标不随音符所在弦或和弦最低音变化。

### 9.6 休止符与空 notes beat

- rest beat 仍只输出 `restMarks`，不输出 duration mark。
- `kind === "notes"` 但 `notes.length === 0` 时不生成时值符号，避免出现没有 TAB 音高内容的孤立节奏头。

### 9.7 页面与 System 回归

- 新 measure height 足以包住 thirtySecond flag，不被 SVG viewBox 裁剪。
- 相邻 System 的 Y 间距继续等于前一行高度加 `systemGapY`。
- 8 小节规范谱例的 System 宽度仍全部等于 `1380`。
- 修改选中 beat 时值后，旧 head/flag/beam 消失，新符号出现。
- 页面控制台无 React key、SVG 属性或字体加载警告。

## 10. 不采用的方案

### 10.1 仅依赖工具栏高亮

工具栏只能表达当前选择，无法阅读未选中的谱面。它可以作为编辑反馈补充，但不能替代谱面时值符号。

### 10.2 仅改变符干长度、颜色或粗细

这些视觉变量没有稳定的时值语义，缩放和打印后辨识度差，也不符合用户对常规节奏符号的预期。

### 10.3 把工具栏 SVG 图标直接放入谱面

工具栏图标是固定尺寸操作素材，不包含 beat 坐标、字体基线、连梁覆盖和附点布局语义。直接复用会造成页面层重新判断 rhythm，并与核心 layout 分叉。

### 10.4 给每个短时值同时画 flag 和 beam

同一个 beat 的同一层时值只能由 flag 或 beam 表达一次。重复绘制会制造错误记谱，因此 flag 只能用于完全没有连梁覆盖的孤立短时值。

## 11. 实施顺序

1. 先为六种基础时值、孤立 flag 和连续 beam 写失败测试。
2. 扩展 layout types，加入 head、stemVisible 和 flag。
3. 增加集中 SMuFL 映射与 rhythm lane 常量。
4. 重构 `buildDurationMark`，使纵坐标脱离最低音符位置。
5. 保持现有 beam 算法，增加 beam coverage 与孤立 flag 回填。
6. 将附点锚点迁移到 head 坐标。
7. 更新 measure height 与 System Y 回归测试。
8. 页面增加 Bravura duration layer，删除页面对旧裸符干结构的假设。
9. 运行核心测试、`pnpm type-check`、`pnpm lint`、`pnpm build`。
10. 在固定桌面视口检查六种基础时值、孤立/连续短时值、附点和多 System 裁剪情况。

## 12. 验收标准

- 不选择任何 beat 时，谱面中的六种基础时值仍可直接区分。
- whole、half、quarter 不再显示为相同的裸符干。
- 孤立 eighth、sixteenth、thirtySecond 分别显示 1、2、3 层 composite flag。
- 连续短时值使用 shared/partial beam，且不重复显示 flag。
- 和弦 beat 只显示一套时值符号。
- 时值符号垂直位置不受音符所在弦影响。
- 附点与节奏头对齐，0/1/2 个附点输出正确。
- 休止符不重复生成音符时值头和符干。
- rhythm lane 不被 SVG viewBox 裁剪，多 System 间距正确。
- System 行宽对齐和 hit test 行为无回归。
- 新增单元测试及既有检查通过，并完成 Bravura 目标浏览器视觉验收。
