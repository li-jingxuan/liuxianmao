# MVP v3 修复方案：System 行宽对齐

## 1. 问题说明

当前规范谱例包含 8 个小节，在页面传入 `systemWidth = 1380` 时被分为两条 System，每条 System 包含 4 个小节，但两行右侧边界没有对齐。

核心布局的实际输出为：

| System | 小节固有宽度 | System 实际宽度 | 距离目标宽度的空余 |
| --- | --- | ---: | ---: |
| 第一行 | `295.2 + 314.4 + 308 + 249.2` | `1166.8` | `213.2` |
| 第二行 | `317.6 + 324 + 323.2 + 330` | `1294.8` | `85.2` |

这不是 SVG 或 CSS 缩放造成的视觉误差。`buildLayout` 在进入页面渲染前已经输出了两个不同的 System 宽度。

## 2. 根因

问题由两个现有规则共同产生：

1. `measure-spacing.ts` 根据每个小节的 beat 数量、基础时值和最小列宽计算小节固有宽度。不同节奏内容得到不同宽度属于正确行为。
2. `system-layout.ts` 仅将 `systemWidth` 用作贪心断行的最大宽度。提交 System 时，最终宽度取“最后一个小节右边界减去行起点”，没有把行内剩余空间分配给小节。

当前流程是：

```text
计算小节固有宽度
  → 按 systemWidth 贪心断行
  → 用固有宽度依次摆放
  → System.width = 本行内容实际宽度
```

因此，只要两行小节的固有宽度之和不同，右边界就必然不齐。浮点数只产生末尾的小数误差，不是 `128` 像素级差异的原因。

## 3. 修复目标

修复后，普通 System 应满足以下不变量：

```text
system.x === options.startX
system.width === options.systemWidth
lastMeasure.x + lastMeasure.width === system.x + system.width
```

具体规则：

- 所有未超宽的 System，包括最后一行，都对齐到 `systemWidth`。
- 每个小节先保留其固有宽度，只分配额外空间，不压缩已有节奏内容。
- 单个小节固有宽度超过 `systemWidth` 时继续独占一行，并保留真实宽度；不缩放、不截断。
- 空轨道继续返回空 systems，不制造虚拟宽度。
- 最终小节宽度、beat slot、音符、弦线、小节线和命中索引必须使用同一套最终坐标。

MVP v3 暂不增加“末行不拉伸”等页面配置。若后续产品明确需要出版式末行策略，再在 layout interface 上增加一个真实可变的对齐模式；当前只有一种需要实现的行为，不提前引入假设性的 seam。

## 4. 模块设计

### 4.1 外部 interface 保持不变

页面继续只调用：

```ts
buildLayout(document, {
  x: 0,
  y: 0,
  systemWidth: 1380,
});
```

React 不需要知道剩余空间、缩放比例或小节分配结果。`buildLayout` 保持为整谱布局的唯一外部 seam，使行宽分配、坐标生成和命中修复都集中在核心 layout 模块内。

行为契约发生如下收紧：

- 修复前：`systemWidth` 只是断行上限，`system.width` 是内容实际宽度。
- 修复后：`systemWidth` 同时是断行上限和普通 System 的最终目标宽度。
- 超宽小节仍是例外，允许 `system.width > systemWidth`。

### 4.2 内部 context 增加 assignedWidth

`layoutMeasure` 的内部 context 增加可选的最终分配宽度：

```ts
interface ILXMLayoutMeasureContext {
  index: number;
  systemIndex: number;
  x: number;
  y: number;
  assignedWidth?: number;
}
```

`layoutMeasureSpacing` 同步接收 `assignedWidth?: number`。这是 `system-layout` 与 `measure-layout` 之间的内部 seam，不从 `packages/lxm-editor` 根入口单独暴露。

- 未传入 `assignedWidth`：返回现有固有宽度，用于断行预计算和独立单小节测试。
- 传入合法的更大宽度：重新分配 beat columns，使所有内部几何使用最终宽度。
- `assignedWidth < minWidth`：核心实现抛出或返回明确布局错误；本次算法只扩张，正常流程不会触发该分支。

## 5. 宽度分配算法

### 5.1 第一阶段：固有宽度与断行

保持现有顺序贪心规则：

1. 对每个小节调用不带 `assignedWidth` 的布局摘要，得到 `intrinsicWidth`。
2. 按 `intrinsicWidth + measureGap` 顺序装入当前 System。
3. 加入下一个小节会超过 `systemWidth` 时提交当前 System。
4. 单个超宽小节独占一行。

该阶段只决定 System 分组，不生成最终子元素坐标。

### 5.2 第二阶段：将 System 空余分配给小节

对一个普通 System：

```text
intrinsicSystemWidth
  = sum(measure.intrinsicWidth) + measureGap * (measureCount - 1)

remainingWidth
  = systemWidth - intrinsicSystemWidth
```

`remainingWidth` 按小节的可伸展内容宽度成比例分配：

```text
measureFlexibleWidth
  = measure.intrinsicWidth - 2 * measurePaddingX

measureExtraWidth
  = remainingWidth
    * measureFlexibleWidth
    / sum(allMeasureFlexibleWidth)

measureAssignedWidth
  = measure.intrinsicWidth + measureExtraWidth
```

这样可以保留原有节奏密度关系：内容较多的小节获得更多额外空间，内容较少的小节不会被强制变成与密集小节同宽。

若所有小节的 `measureFlexibleWidth` 都为 `0`，则退化为平均分配，避免除零。

### 5.3 第三阶段：将小节空余分配给 beat columns

单个小节得到 `assignedWidth` 后：

```text
extraWidth = assignedWidth - intrinsicWidth
```

额外宽度按 column 的固有 `idealWidth` 比例分配：

```text
columnAssignedWidth
  = column.idealWidth
    + extraWidth * column.idealWidth / sum(column.idealWidth)
```

随后使用 `columnAssignedWidth` 推导 beat slot 的 `x/width`。音符、休止符、符干、连梁、小节线与 hit index 继续消费这些最终 slot 和 measure 坐标。

空小节若没有 columns，则额外宽度保留在小节左右内容区域中；当前语义校验要求小节具有完整 beat 时间轴，正常 V3 文档不会进入该退化分支。

### 5.4 浮点残差处理

比例分配会产生浮点残差。不能让残差累积后造成最后一条小节线偏离目标右边界。

实现规则：

- 前 `n - 1` 个小节或 columns 使用比例计算结果。
- 最后一个小节吸收 `systemWidth - 已分配宽度` 的剩余值。
- 小节内部最后一个 column 同样吸收 `assignedContentWidth - 已分配列宽` 的剩余值。
- 测试比较坐标时允许极小 epsilon，但最终右边界应通过残差吸收达到精确目标。

## 6. 预计修改范围

```text
packages/lxm-editor/src/layout/
  measure-spacing.ts   # 支持 assignedWidth，分配最终 column 宽度
  measure-layout.ts    # 将 assignedWidth 传入 spacing
  system-layout.ts     # 断行后计算每个小节的 assignedWidth
  layout-types.ts      # 如有必要记录 intrinsic/assigned 调试字段

packages/lxm-editor/tests/layout/
  measure-spacing.test.ts
  system-layout.test.ts
  hit-test.test.ts
```

原则上不需要修改：

- `apps/website`：页面继续渲染 layout，不参与对齐。
- `core/commands.ts`：文档编辑与视觉宽度无关。
- `ILXMDocument` schema：对齐是布局状态，不进入持久化文档。

## 7. 测试方案

### 7.1 最小回归用例

使用两个固有宽度不同的小节，将 `systemWidth` 设置为只能各放一个小节：

```text
修复前：systems.width = [295.2, 317.6]
修复后：systems.width = [400, 400]
```

断言：

- 两条 System 的 `width` 都等于 `400`。
- 两条 System 的最后小节右边界都等于 `startX + 400`。
- 两个小节内部最后一个 beat slot 均未超过小节右边界。

### 7.2 8 小节规范谱例

使用 `EXAMPLE_MVP_2` 和页面当前的 `systemWidth = 1380`：

```text
修复前：systems.width = [1166.8, 1294.8]
修复后：systems.width = [1380, 1380]
```

同时断言：

- 每行仍为 4 个小节，断行分组未改变。
- 两行最后一条小节线 X 坐标一致。
- 每个小节 X 坐标单调递增，相邻小节不重叠。
- layout 重复运行结果完全一致。

### 7.3 边界回归

- 恰好填满 `systemWidth` 时不额外改变宽度。
- 单个超宽小节仍独占一行，保持固有宽度。
- `measureGap > 0` 时只分配扣除 gap 后的剩余空间。
- 不同 `startX` 下最终右边界正确。
- stretched beat slot 的 hit test 仍命中正确 `measureId + beatId + string`。
- 音符、休止符、附点、符干与连梁在拉伸后使用最新坐标。

## 8. 不采用的方案

### 8.1 页面 CSS/SVG 横向缩放

不对 System `<g>` 使用 `scaleX`，也不通过不同 `viewBox` 强行撑满。该方案会让文字、线宽和音乐符号产生非预期形变，并使页面视觉坐标与核心 hit index 不一致。

### 8.2 直接把所有小节设为相同宽度

不采用简单的 `systemWidth / measureCount`。不同小节节奏密度差异明显，强制等宽会让密集小节过于拥挤、稀疏小节过于松散，也可能低于某个小节的最小宽度。

### 8.3 只修改 System.width 字段

不能只把返回值中的 `system.width` 改为 `systemWidth`。如果小节、弦线和小节线仍停留在旧坐标，数据尺寸看似一致，用户看到的右边界仍不会对齐。

## 9. 验收标准

- 8 小节规范谱例的所有普通 System 右侧边界对齐到 `systemWidth`。
- System、小节、beat slot、SVG 图形和 hit index 使用同一套最终坐标。
- 节奏密集度的相对宽度关系保留，没有小节被压缩到固有最小宽度以下。
- 既有断行、超宽小节、命中、时值与休止符测试通过。
- `pnpm test`、`pnpm type-check`、`pnpm lint`、`pnpm build` 全部通过。
- 固定桌面视口完成浏览器检查，确认两行右边界、小节线和点击位置一致。

## 10. 实施顺序

1. 先将最小复现和 8 小节输出写为失败回归测试。
2. 为 `layoutMeasureSpacing` 增加 `assignedWidth` 并完成 column 分配测试。
3. 为 `layoutMeasure` 透传最终宽度。
4. 在 `layoutSystems` 中实现 System → Measure 的剩余空间分配。
5. 运行核心测试，确认坐标和命中结果。
6. 运行全量检查并完成浏览器视觉验收。
7. 实际行为稳定后，同步修订 V2 文档中“`systemWidth` 仅为最大宽度、System 使用实际内容宽度”的旧契约。
