# MVP v3 修复方案：稀疏 System 的受控拉伸

## 1. 问题说明

当前 System 在完成贪心断行后，会把所有未超宽行统一拉伸到调用方传入的
`systemWidth`。当某条 System 只有一个较短的小节，或者末行只有两个内容较少的
小节时，行内所有 beat column 会共同吸收整行剩余空间，结果是拍点间距被异常放大，
稀疏内容仍然占据完整一行。

这个问题不是页面 CSS 或 SVG 缩放造成的。核心 layout 在页面渲染前已经把该行的
剩余宽度全部分配给各小节的 `assignedWidth`，页面只是按最终几何结果绘制。

现有关键逻辑等价于：

```ts
const targetSystemWidth = Math.max(pendingWidth, options.systemWidth);
```

因此，只要 System 固有宽度没有超过行宽，无论它是否为末行、包含多少小节，都会被
无条件拉满。仅对单小节做特判仍不完整：两个短小节组成的末行同样可能过度松散。

## 2. 修复目标

- 末行无论包含多少小节，都根据整行节奏内容有上限地展开；
- 任意位置的单小节 System 同样受内容拉伸上限约束；
- 内容已经接近行宽的受限 System 仍可自然填满；
- 非末行且包含多个小节的 System 保持现有整行对齐行为；
- 单个超宽小节继续独占一行，并保持真实宽度，不缩放、不截断；
- 小节 padding 保持固定，只限制节奏内容区的拉伸比例；
- System、小节、beat slot、音符、弦线、小节线与 hit index 使用同一套最终坐标；
- 稀疏 System 没有填满一行时，SVG 画布仍保持页面可用宽度，不随内容一起缩窄；
- 不修改 `ILXMDocument` schema，不把排版结果持久化到乐谱数据。

## 3. 非目标

本修复不包含：

- 重新设计 System 贪心断行算法；
- 让末行完全禁止拉伸；
- 压缩低于小节固有宽度的节奏内容；
- 通过 CSS `scaleX` 或 SVG transform 改变谱面几何；
- 在页面层重新计算小节或 beat 坐标；
- 为不同拍号分别配置固定小节宽度；
- 第一版向业务调用方开放任意数值型拉伸参数。

## 4. 设计原则

### 4.1 控制内容密度，而不是控制小节外框比例

小节固有宽度由两部分组成：

```text
intrinsicWidth = horizontalPadding + intrinsicContentWidth
horizontalPadding = leftPadding + rightPadding
```

左右 padding 是固定视觉留白，不应随着 System 的剩余空间一起放大。真正需要保护的
是节奏内容区，即 beat columns 的总宽度。因此拉伸上限必须基于
`intrinsicContentWidth` 计算，而不能简单使用 `intrinsicWidth × ratio`。

### 4.2 使用连续上限，不使用硬阈值分支

不采用“占行宽超过 60% 就拉满，否则完全不拉伸”一类硬阈值。硬阈值会导致内容只
增加少量时，最终宽度突然从固有宽度跳到整行宽度。

本方案始终先计算允许的最大可读宽度，再与 `systemWidth` 取较小值。随着内容增加，
最终宽度连续增长；当最大可读宽度自然覆盖整行时，才填满 System。

## 5. 拉伸策略

### 5.1 首版参数

在核心 layout 常量模块增加内部常量：

```ts
const LXM_SPARSE_SYSTEM_MAX_CONTENT_SCALE = 1.6;
```

`1.6` 表示受限 System 的节奏内容区总宽度最多扩张到固有内容宽度总和的 `1.6`
倍。各小节左右 padding 和 `measureGap` 不参与倍数计算。

该值首版保持为内部实现常量，不加入 `ILXMLayoutOptions`。如果后续确认编辑模式、
打印模式需要不同策略，再将其提升为语义化的 fill policy，而不是直接向页面暴露
任意浮点参数。

### 5.2 目标宽度计算

增加一个纯函数集中决定 System 的最终目标宽度：

```ts
interface ILXMResolveSystemTargetWidthContext {
  systemWidth: number;
  intrinsicSystemWidth: number;
  measures: ILXMPendingMeasure[];
  isFinalSystem: boolean;
}

const resolveSystemTargetWidth = ({
  systemWidth,
  intrinsicSystemWidth,
  measures,
  isFinalSystem,
}: ILXMResolveSystemTargetWidthContext): number => {
  if (intrinsicSystemWidth >= systemWidth) {
    return intrinsicSystemWidth;
  }

  const shouldLimitStretch = isFinalSystem || measures.length === 1;
  if (!shouldLimitStretch) {
    return systemWidth;
  }

  const totalContentWidth = measures.reduce(
    (total, measure) => total + measure.intrinsicContentWidth,
    0,
  );
  const fixedWidth = intrinsicSystemWidth - totalContentWidth;
  const maxReadableWidth =
    fixedWidth + totalContentWidth * LXM_SPARSE_SYSTEM_MAX_CONTENT_SCALE;

  return Math.min(systemWidth, maxReadableWidth);
};
```

这里的 `fixedWidth` 已包含所有小节的左右 padding 和小节之间的 `measureGap`。这些
固定几何只保留原值，只有 `totalContentWidth` 参与 `1.6` 倍上限计算。

### 5.3 识别真正的末行

当前 `flushSystem()` 既在加入下一个小节会超宽时调用，也在遍历结束后调用。为了让
目标宽度函数可靠区分正文换行和文档末行，应显式传入提交原因：

```ts
type ILXMSystemFlushReason = "wrapped" | "final";

const flushSystem = (reason: ILXMSystemFlushReason) => {
  if (pendingMeasures.length === 0) return;

  const targetSystemWidth = resolveSystemTargetWidth({
    systemWidth: options.systemWidth,
    intrinsicSystemWidth: pendingWidth,
    measures: pendingMeasures,
    isFinalSystem: reason === "final",
  });

  // 继续执行既有剩余空间分配和最终布局。
};
```

调用点必须分别表达语义：

```ts
if (pendingMeasures.length > 0 && nextWidth > options.systemWidth) {
  flushSystem("wrapped");
}

// measures 遍历结束后
flushSystem("final");
```

不能使用 `systemIndex === systems.length - 1` 判断末行，因为在布局尚未结束时无法知道
当前行是否真的是最终 System。

`flushSystem()` 随后使用目标宽度替换当前无条件拉满的计算，并沿用既有剩余宽度
分配：

```ts
const remainingWidth = targetSystemWidth - pendingWidth;
```

后续既有的 System → Measure、Measure → Beat column 剩余空间分配逻辑保持不变。
这样所有子元素会自然消费受控后的 `assignedWidth`，无需在渲染层增加特殊分支。

### 5.4 行为矩阵

| 场景                           | 最终 System 宽度                                   |
| ------------------------------ | -------------------------------------------------- |
| 非末行且包含多个小节           | `systemWidth`                                      |
| 非末行且只有一个短小节         | `fixedWidth + totalContentWidth × 1.6`，不超过行宽 |
| 末行包含一个或多个稀疏小节     | 同上，按整行内容总宽度受控拉伸                     |
| 受限 System 的内容足够填满行宽 | `systemWidth`                                      |
| 单个固有宽度超过行宽的小节     | `intrinsicWidth`                                   |
| 空轨道                         | 不生成 System，整谱宽高继续为 `0`                  |

例如末行包含两个小节，固定 padding 与 gap 合计 `44`、固有内容宽度总和为 `260`、
行宽为 `733`：

```text
maxReadableWidth = 44 + 260 × 1.6 = 460
targetSystemWidth = min(733, 460) = 460
```

如果同一末行的固有内容宽度总和为 `500`：

```text
maxReadableWidth = 44 + 500 × 1.6 = 844
targetSystemWidth = min(733, 844) = 733
```

因此稀疏末行保留合理右侧留白，内容足够多的末行仍然对齐页面右边界。

### 5.5 空内容退化行为

若异常或未来文档允许一条受限 System 的所有小节都没有 beat columns，则
`totalContentWidth === 0`，最终宽度退化为固有 System 宽度，不执行无意义扩张，也
不发生除零。当前合法文档通常不会进入该分支，但核心算法应保持有限且确定。

## 6. 画布宽度与 System 宽度解耦

采用受控拉伸后，`system.width` 不再保证等于 `options.systemWidth`。它表示当前行
实际绘制到的宽度；页面可用画布宽度仍由 `options.systemWidth` 决定。

当前网站使用 `layout.width` 同时设置 SVG 的 `viewBox` 和 `width`。如果整首谱只有
一条稀疏 System，而 `layout.width` 继续取 System 实际宽度，SVG 本身也会缩窄，右侧
页面空间无法继续作为画布使用。

因此，非空布局的整谱宽度应至少等于配置行宽，同时继续容纳超宽小节：

```ts
const contentWidth = systems.reduce(
  (maxWidth, system) => Math.max(maxWidth, system.width),
  0,
);

const layoutWidth =
  systems.length === 0 ? 0 : Math.max(resolvedSystemWidth, contentWidth);
```

最终语义为：

- `ILXMSystemLayout.width`：该 System 的实际绘制宽度；
- `ILXMLayout.width`：整谱画布宽度，非空时至少为可用 `systemWidth`；
- 超宽小节存在时，`ILXMLayout.width` 随实际内容扩展，避免裁剪。

需要同步修订 `layout-types.ts` 中“普通行等于配置的 systemWidth”的旧注释。

## 7. 命中测试契约

`buildHitIndex()` 当前根据每个 measure 的最终 `x/y/width/height` 建立边界。受控拉伸
后应继续保持该规则，不得把 System 右侧留白并入最后一个小节的命中区域。

具体行为：

- 点击小节最终右边界以内，继续按既有逻辑命中首拍或末拍；
- 点击 `measure.x + measure.width` 到 `system.x + systemWidth` 之间的留白，返回
  `null`；
- 不允许为了保留整行 SVG 宽度而扩大 `measureBounds`；
- 音符、休止符、符干、连梁和 barline 全部停留在小节实际右边界以内。

画布宽度和命中宽度必须分别由 `layout.width` 与 measure bounds 表达，不能共用一个
虚假的满行小节宽度。

## 8. 外部 interface 与兼容性

本修复不要求修改 `ILXMLayoutOptions`：

```ts
buildLayout(document, {
  systemWidth: 733,
  density: "compact",
});
```

调用方式保持不变，行为调整集中在核心 layout 内部。

兼容性变化：

- 非末行多小节 System 的宽度契约不变；
- 末行从“必定占满”改为“按整行内容受拉伸上限约束”；
- 任意位置的单小节 System 同样受拉伸上限约束；
- `layout.width` 对非空谱面继续保留调用方提供的可用画布宽度；
- 页面组件无需感知末行、比例、padding 或小节数量判断。

## 9. 预计修改范围

```text
packages/lxm-editor/src/layout/
  layout-constants.ts  # 增加稀疏 System 内容区最大拉伸比例
  system-layout.ts     # 区分换行/末行提交并应用受控拉伸策略
  index.ts             # 保持非空 layout 的画布宽度下限
  layout-types.ts      # 修订 System.width 与 Layout.width 注释契约

packages/lxm-editor/tests/layout/
  system-layout.test.ts
  hit-test.test.ts
```

原则上不需要修改：

- `measure-spacing.ts`：已经支持 `assignedWidth` 并按最终宽度重排 columns；
- `measure-layout.ts`：已经透传最终宽度；
- `apps/website`：继续只消费核心 layout 结果；
- `core/commands.ts`：编辑命令和视觉拉伸策略无关；
- `ILXMDocument` schema：布局状态不进入持久化数据。

## 10. 测试方案

### 10.1 目标宽度纯函数

若 `resolveSystemTargetWidth()` 可在模块内直接测试，覆盖：

- 单小节和多小节末行的总内容区均按 `1.6` 倍封顶；
- 计算时各小节固定 padding 和 `measureGap` 不参与倍数放大；
- 最大可读宽度超过 `systemWidth` 时填满整行；
- 非末行多小节继续返回 `systemWidth`；
- 相同 measures 分别以 `wrapped` 和 `final` 提交时得到正确的不同策略；
- 超宽单小节返回 `intrinsicSystemWidth`；
- 零内容宽度返回固有宽度；
- 所有输出均为有限数值且不小于固有宽度。

如果不单独导出内部函数，则通过 `buildLayout()` 对同样的输入输出关系进行黑盒测试。

### 10.2 System 布局回归

替换现有“所有未超宽 System，包括末行，都拉伸到目标宽度”的过宽断言，拆成：

1. 非末行多小节 System 仍拉伸到目标宽度；
2. 包含两个短小节的末行不超过整行内容区最大拉伸宽度；
3. 短单小节 System 不超过内容区最大拉伸宽度；
4. 内容接近满行的末行仍等于目标宽度；
5. 超宽单小节仍大于目标宽度且不被压缩；
6. `measureGap` 在末行最大宽度计算中保持固定，在正文行中继续不参与内容拉伸；
7. 不同 `startX` 下 System 和 measure 的最终右边界正确；
8. 文档恰好断成完整多小节末行时，仍依据内容密度决定是否铺满，而不是依据小节数。

### 10.3 画布宽度

- 末行内容不足以铺满时，`system.width < layout.width`；
- 上述场景中 `layout.width === systemWidth`；
- 包含超宽小节时，`layout.width === max(system.width)`；
- 空轨道继续返回 `layout.width === 0`。

### 10.4 命中边界

- 点击末行最后一个 beat 到最后小节实际右边界之间，仍命中最后一拍；
- 点击小节实际右边界右侧的 System 留白，返回 `null`；
- 小节最后一条 barline 的 X 坐标等于实际右边界；
- hit index 中的 measure width 等于受控拉伸后的 measure width，而不是画布宽度。

### 10.5 页面视觉验收

使用 A4 `systemWidth = 733`、`density = "compact"` 检查：

- 包含一个或两个短小节的末行不会横跨整页；
- 小节右侧保留自然留白，左侧起点与其他 System 对齐；
- 接近满行的复杂末行仍能使用完整页面宽度；
- 非末行多小节行继续左右对齐；
- 光标、点击位置、小节线和节奏符号没有漂移；
- 只有一个短小节的文档仍保留完整 A4 内容画布。

## 11. 不采用的方案

### 11.1 稀疏 System 完全不拉伸

始终使用固有宽度会让接近满行的末行也留下少量不自然空白，并失去现有 System
对齐能力。受控拉伸允许内容密度足够时自然填满，同时改善稀疏行的节奏间距。

### 11.2 使用固定像素宽度

固定成 `300px` 或 `systemWidth / 2` 无法适应不同 beat 数量、时值密度、density
profile 和页面宽度，也可能把复杂小节压缩到固有宽度以下。

### 11.3 使用占行比例硬阈值

“固有宽度超过 60% 才拉满”会在阈值附近产生宽度跳变。最大内容拉伸比例能够得到
连续结果，同时隐式决定何时可以填满。

### 11.4 只修改 `system.width`

如果仅缩小 `system.width`，但仍把完整 `systemWidth` 传给 measure，视觉小节和命中
区域依旧占满整行，布局数据还会互相矛盾。必须先确定 `targetSystemWidth`，再用它生成
所有子元素坐标。

### 11.5 页面层裁切或缩放

页面 CSS/SVG 变换无法修复核心 hit index，并会造成文字、线宽和音乐符号形变。该
策略必须属于核心 layout。

## 12. 验收标准

- 末行的内容区总宽度拉伸不超过固有内容宽度总和的 `1.6` 倍；
- 任意位置的单小节 System 同样遵守 `1.6` 倍上限；
- 内容足够多时，末行仍可自然填满 `systemWidth`；
- 非末行多小节 System 继续完整对齐到 `systemWidth`；
- 超宽单小节不缩放、不截断；
- 固定 padding 和 `measureGap` 不参与内容拉伸倍数计算；
- `system.width`、measure 右边界、barline 和 hit bounds 使用一致的实际宽度；
- System 右侧留白不命中任何 measure 或 beat；
- 非空 `layout.width` 至少等于配置的 `systemWidth`，超宽内容不被裁剪；
- 既有紧凑密度、断行、节奏符号和编辑命令测试无回归；
- `pnpm test`、`pnpm type-check`、`pnpm lint`、`pnpm build` 全部通过；
- A4 页面完成浏览器视觉与点击验收。

## 13. 实施顺序

1. 先补充双短小节末行、短单小节、接近满行末行和右侧留白命中的失败测试；
2. 在 `layout-constants.ts` 增加稀疏 System 内容区最大拉伸比例；
3. 在 `system-layout.ts` 为 `flushSystem` 增加 `wrapped/final` 原因；
4. 提取目标宽度纯函数并替换无条件拉满逻辑；
5. 在 `index.ts` 解耦整谱画布宽度与实际 System 宽度；
6. 修订 `layout-types.ts` 的宽度语义注释；
7. 运行核心测试并检查所有最终坐标为有限值；
8. 运行全量检查；
9. 在单短小节、双短小节末行、复杂末行和正文多小节 A4 谱例上完成视觉及点击验收；
10. 根据视觉结果仅在合理范围内微调 `1.6`，不改变 interface 和算法结构。
