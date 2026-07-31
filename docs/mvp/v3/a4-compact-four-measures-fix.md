# MVP v3 补充：A4 紧凑排版与常规四小节成行

## 1. 背景

现有 [A4 单页预览方案](./a4-page-preview-fix.md) 已把页面外框约束为 A4，并让核心 layout 按页面传入的 `systemWidth` 自动断行。实际调整后，A4 纸张左右 padding 已从 `15mm` 缩小为 `8mm`，但页面仍传入：

```ts
const A4_CONTENT_WIDTH = 680;
```

当前状态存在两个独立问题：

1. 页面物理内容区与 SVG 逻辑内容区不再一致；
2. 小节的固有宽度仍按舒适编辑密度计算，即使把 `systemWidth` 修正为 A4 内容宽度，常规谱例仍无法做到一行四小节。

本补充方案在不破坏现有布局兼容性的前提下，为核心 layout 增加紧凑排版密度，使常规 A4 六线谱优先按每行四小节排版。

## 2. 当前宽度分析

### 2.1 A4 内容区

纸张宽度为 `210mm`，左右 padding 均为 `8mm`：

```text
contentWidth = 210mm - 8mm × 2 = 194mm
194mm / 25.4mm × 96px ≈ 733.23px
```

因此页面传给核心 layout 的目标宽度应取：

```ts
const A4_CONTENT_WIDTH = 733;
```

CSS 继续使用物理单位，核心 layout 继续使用无单位逻辑坐标；两者只在网站 adapter 中建立近似一比一的尺寸映射。

### 2.2 当前小节固有宽度

MVP v2/v3 规范谱例八个小节的现有固有宽度约为：

```text
295.2, 314.4, 308, 249.2,
317.6, 324, 323.2, 330
```

四小节成行时：

| System | 当前四小节固有宽度总和 | A4 可用宽度 |    超出 |
| ------ | ---------------------: | ----------: | ------: |
| 第一行 |               `1166.8` |       `733` | `433.8` |
| 第二行 |               `1294.8` |       `733` | `561.8` |

所以把 `systemWidth` 从 680 调整到 733 只能修复物理尺寸映射，不能单独解决四小节成行问题。必须降低小节内部 beat column 的排版密度。

## 3. 目标

- A4 纸张 `8mm` 左右 padding 与 `systemWidth = 733` 保持一致；
- 当前八小节规范谱例稳定生成两个 System，每行四小节；
- 四小节是紧凑模式下常规内容的优先目标，不是所有文档的强制不变量；
- 内容过密时允许自然退化为每行三、二或一个小节；
- 紧凑模式不通过 CSS 非等比缩放实现；
- 音符、品位数字、休止、符干、连梁、占位线和 hit index 使用同一套紧凑布局坐标；
- 不传密度选项时保持现有舒适排版及测试结果；
- 页面只选择排版密度，不学习每种时值的底层宽度参数。

## 4. 非目标

本补充方案不包含：

- 强制任意四个小节都挤入一行；
- 按小节数量平均分配宽度并忽略内容复杂度；
- A4 多页拆分、页码、页眉或页脚；
- 动态缩放控件；
- 修改 `ILXMDocument` schema；
- 将纸张 padding 继续缩小以换取排版空间；
- 为每份文档持久化 UI 预览密度。

## 5. 外部 interface

在核心 layout 的现有 interface 上增加一个可选密度：

```ts
export type ILXMLayoutDensity = "comfortable" | "compact";

export interface ILXMLayoutOptions {
  x?: number;
  y?: number;
  measureGap?: number;
  systemWidth?: number;
  systemGapY?: number;
  density?: ILXMLayoutDensity;
}
```

规则：

- `density` 省略时等价于 `comfortable`；
- `comfortable` 完全保持当前固有宽度计算；
- `compact` 使用本方案定义的紧凑 spacing profile；
- density 是纯 layout 状态，不写入 `ILXMDocument`；
- 调用方不能直接传入 `measurePaddingX`、`idealColumnScale`、`minColumnWidth` 等底层参数。

这个 interface 将变化收敛在一个真实 seam 上：网站选择舒适或紧凑模式，核心 layout 隐藏具体压缩算法。相比向页面暴露多个数值参数，它具有更高的 depth 和 locality。

页面接入为：

```ts
const A4_CONTENT_WIDTH = 733;

buildLayout(document, {
  x: 0,
  y: 0,
  systemWidth: A4_CONTENT_WIDTH,
  density: "compact",
});
```

## 6. 内部 spacing profile

建议将 profile 集中定义在 layout 常量模块，首版参数为：

```ts
const LXM_LAYOUT_DENSITY_PROFILES = {
  comfortable: {
    measurePaddingX: 18,
    idealColumnScale: 1,
    minColumnWidth: null,
  },
  compact: {
    measurePaddingX: 8,
    idealColumnScale: 0.48,
    minColumnWidth: 15,
  },
} as const;
```

这些参数属于核心 layout 的 implementation，不从包入口单独导出。浏览器视觉验收可以微调 compact 数值，但页面 interface 保持不变。

参数含义：

- `measurePaddingX`：小节内容左右留白；
- `idealColumnScale`：基于当前时值理想列宽进行压缩；
- `minColumnWidth`：紧凑模式下任意 beat column 的最低可读宽度。

`15` 的初始下限用于保护 12px 品位数字，尤其是双位数品位和连续三十二分音符。最终值允许在 `14–16` 范围内根据真实浏览器视觉结果调整。

## 7. 紧凑列宽算法

舒适模式保持现有算法：

```ts
const durationMinWidth = LXM_DURATION_MIN_COLUMN_WIDTH[rhythm.base];
const durationWeight = LXM_DURATION_VISUAL_WEIGHT[rhythm.base];

const baseIdealWidth = Math.max(
  durationMinWidth,
  durationMinWidth * durationWeight,
);
```

紧凑模式计算：

```ts
const compactMinWidth = profile.minColumnWidth;
const compactIdealWidth = Math.max(
  compactMinWidth,
  baseIdealWidth * profile.idealColumnScale,
);
```

最终 column 至少满足：

```text
column.width >= compactMinWidth
```

紧凑模式重新定义的是当前排版上下文中的固有宽度，不是在 System 分配阶段绕过限制强行压缩。因此现有不变量继续成立：

```text
assignedWidth >= intrinsicWidth
```

System 仍然只负责：

1. 使用当前 density 得到小节固有宽度；
2. 按固有宽度贪心断行；
3. 把当前行剩余空间分配给小节；
4. 保证普通 System 的右边界等于 `systemWidth`。

## 8. 模块职责与传递路径

建议传递路径：

```text
buildLayout(options.density)
  → layoutSystems(density)
  → summarizeMeasureSpacingWidth(measure, density)
  → layoutMeasure(measure, density, assignedWidth)
  → layoutMeasureSpacing(measure, density, assignedWidth)
```

### 8.1 `layout-types.ts`

- 声明并导出 `ILXMLayoutDensity`；
- 为 `ILXMLayoutOptions` 增加 `density?`；
- 不在最终 `ILXMLayout` 上重复保存整个 profile。

### 8.2 `layout-constants.ts`

- 保留当前常量作为 comfortable profile 的行为来源；
- 增加内部 compact profile；
- 不允许页面 import profile 中的底层数字。

### 8.3 `measure-spacing.ts`

- 统一解析 density 和 profile；
- 计算当前模式下的 column `minWidth`、`idealWidth`；
- 使用当前 profile 的 `measurePaddingX`；
- `summarizeMeasureSpacingWidth` 返回 `contentWidth`，隐藏 padding 推导。

### 8.4 `system-layout.ts`

当前 System implementation 使用全局 `LXM_MEASURE_PADDING_X` 反推小节可伸展宽度。引入 density 后不应让 System 同时理解两套 padding。

应在断行摘要阶段缓存：

```ts
interface ILXMPendingMeasure {
  measure: ILXMMeasure;
  index: number;
  intrinsicWidth: number;
  intrinsicContentWidth: number;
}
```

System 剩余空间权重直接使用 `intrinsicContentWidth`，从而把 profile 细节留在 measure spacing 模块内。

### 8.5 `measure-layout.ts`

- 将 density 透传给 spacing；
- 小节弦线、音符、休止符、时值符号和命中数据继续只消费最终 slot；
- 不在各图形模块重复做 compact 判断。

## 9. 当前谱例估算结果

使用以下 compact 参数：

```text
measurePaddingX = 8
idealColumnScale = 0.48
minColumnWidth = 15
systemWidth = 733
```

八个小节的预估固有宽度约为：

```text
177.0, 149.6, 256.0, 132.0,
151.2, 167.9, 181.2, 157.1
```

分行结果：

| System | 紧凑固有宽度总和 | 剩余可分配空间 |
| ------ | ---------------: | -------------: |
| 第一行 |          `714.6` |         `18.4` |
| 第二行 |          `657.4` |         `75.6` |

两行都能容纳四个小节。随后既有 System 拉伸算法将剩余空间按小节内容宽度比例分配，使两行最终宽度都等于 `733`。

上述数值是对方案可行性的静态估算，最终实现必须以核心 layout 测试的真实输出为准。

## 10. 断行规则

本方案不增加 `measuresPerSystem: 4`。

最终规则仍然是：

```text
当前行已有小节
且加入下一小节后的固有宽度总和 > systemWidth
  → 提交当前行
否则
  → 继续加入当前行
```

因此：

- 当前规范谱例得到 `4 + 4`；
- 普通内容优先接近四小节；
- 某小节因大量三十二分音符、双位数品位或未来歌词贡献而过宽时自动减少本行小节数；
- 单个超宽小节继续独占一行，不缩放、不截断、不覆盖相邻内容。

## 11. 可读性保护

紧凑模式必须同时满足几何宽度和视觉可读性。

浏览器验收重点：

- 相邻双位数品位数字不重叠；
- 品位文字的白色描边不吞掉相邻数字或小节线；
- 连续三十二分音符的符干、旗帜或连梁仍可区分；
- sustain mark 不越过所属 beat slot；
- 附点与相邻符干保持净空；
- 反复小节线和相邻首末 beat 不碰撞；
- 点击命中容差不能大于紧凑 slot 后错误覆盖相邻 beat。

如视觉验收失败，调参优先级为：

1. 在 `14–16` 内提高 `minColumnWidth`；
2. 小幅降低品位文字描边宽度；
3. 调整 `idealColumnScale`；
4. 允许特定复杂 System 自动退化为少于四小节。

不能为了保持四小节而突破最低可读宽度。

## 12. 测试方案

### 12.1 默认模式兼容性

既有不传 density 的测试必须保持原输出：

- 当前小节 `minWidth`、`idealWidth` 和 slot 坐标不变；
- `systemWidth = 1380` 时仍得到 `4 + 4`；
- 既有 hit test 和时值图形坐标测试不需要改期望值。

### 12.2 Compact spacing 测试

新增测试断言：

- `density = "compact"` 使用 8px 单侧小节 padding；
- 任意 compact column 宽度不小于 15；
- 四分、八分、十六分等基础理想宽度按 profile 缩放；
- System 拉伸后最后一个 slot 仍停在右 padding 前；
- compact `assignedWidth` 小于 compact 固有宽度时仍抛出明确错误。

### 12.3 A4 规范谱例

```ts
const layout = buildLayout(EXAMPLE_MVP_2, {
  systemWidth: 733,
  density: "compact",
});
```

断言：

- `layout.systems` 长度为 2；
- 每行小节数为 `[4, 4]`；
- 两行 `system.width` 都为 733；
- 每行最后小节右边界等于 733；
- 所有小节和 beat slot 坐标单调递增且不重叠；
- 最小 beat slot 宽度不低于 15。

### 12.4 退化测试

构造一个超过 compact 宽度的密集小节，确认：

- 不会为了四小节强行压缩到 15 以下；
- 贪心断行自动减少当前行小节数量；
- 单个超宽小节保持真实宽度并独占一行；
- hit index 与退化后的 System 归属一致。

## 13. 页面验收

在真实浏览器使用 A4 页面检查：

- `.paper` 宽度仍为 `210mm`，左右 padding 为 `8mm`；
- SVG 内容区约为 `194mm / 733px`；
- 当前八小节谱例显示为两行，每行四小节；
- 两行小节线右边界对齐；
- 页面没有额外横向缩放或横向滚动；
- 点击首拍、末拍、相邻 beat 和小节边界均命中正确；
- 修改时值、新增或复制小节后重新断行稳定；
- 打印预览保持与屏幕相同的四小节密度；
- 控制台没有 error 或 warning。

## 14. 不采用的方案

### 14.1 将 1380 宽 SVG 整体缩放到 A4

该方案会把谱线、品位字号、描边、符干和点击容差整体缩小约一半。它只是视觉塞入，没有建立新的可读排版密度。

### 14.2 全局缩小现有宽度常量

直接修改 `LXM_DURATION_MIN_COLUMN_WIDTH` 和 `LXM_MEASURE_PADDING_X` 会改变所有调用者，使舒适编辑模式无法保留，也会导致大量既有测试被动改期望。

### 14.3 强制每个小节宽度等于 `systemWidth / 4`

该方案忽略小节内容复杂度，也会让 `assignedWidth < intrinsicWidth`，破坏当前只扩张、不强制压缩的布局契约。

### 14.4 暴露三个数值参数给页面

不在 `ILXMLayoutOptions` 中分别暴露 `measurePaddingX`、`idealColumnScale` 和 `minColumnWidth`。这会形成浅 interface，让每个调用者都必须理解核心 spacing implementation，并产生难以维护的参数组合。

### 14.5 继续缩小纸张 padding

从 15mm 改到 8mm 只增加约 53 个逻辑单位，远不足以容纳当前 1166.8–1294.8 的四小节固有宽度。继续侵占纸张边距不能替代紧凑排版。

## 15. 预计修改范围

```text
packages/lxm-editor/src/layout/
  layout-types.ts
  layout-constants.ts
  layout-helpers.ts
  measure-spacing.ts
  measure-layout.ts
  system-layout.ts

packages/lxm-editor/tests/layout/
  measure-spacing.test.ts
  system-layout.test.ts
  hit-test.test.ts

apps/website/components/EditorShell/
  index.tsx
```

原则上不修改：

- `ILXMDocument` schema；
- core commands 和节奏容量规则；
- React SVG 图形的坐标推导；
- 当前用户已调整的 A4 `8mm` 纸张 padding。

## 16. 实施顺序

1. 先增加 compact spacing 和 A4 `4 + 4` 的失败测试；
2. 增加 `ILXMLayoutDensity`，默认解析为 comfortable；
3. 在 measure spacing 模块内部实现 density profile；
4. 让 spacing summary 返回真实 `intrinsicContentWidth`；
5. 通过 System 和 Measure 传递 density，不在子图形模块重复判断；
6. 页面把逻辑宽度改为 733，并选择 compact；
7. 运行核心测试、类型检查、lint 和生产构建；
8. 完成 A4 浏览器视觉、交互和打印预览验收；
9. 根据视觉结果只调整 compact profile 内部参数，不扩大外部 interface。

## 17. 完成标准

- A4 `8mm` padding 与 `systemWidth = 733` 一致；
- 页面仅通过 `density: "compact"` 选择紧凑模式；
- 当前规范谱例稳定得到两行、每行四小节；
- 默认 comfortable 模式输出及既有测试保持不变；
- 最小 compact beat slot 满足可读性下限；
- 复杂内容放不下时安全换行，不重叠、不裁切；
- System、小节、beat、SVG 图形和 hit index 共用最终坐标；
- 全量测试、类型检查、lint、生产构建和真实浏览器验收通过。
