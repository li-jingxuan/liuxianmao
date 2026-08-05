# MVP v4 Fix：Beat 单元格选框居中对齐

## 1. 背景与问题

MVP v4 已支持点击、拖动和键盘操作形成 `Beat × String` 的 TAB 单元格矩形选区。当前选择某一个 Beat 时，选框没有围绕该 Beat 的音符时间锚点展开，而是从锚点开始向右延伸，视觉上表现为选框整体偏向 Beat 右侧。

问题同时影响两层高亮：

- `selectionRange`：当前规范选区的半透明范围背景；
- `focusCaret`：当前 focus 单元格的强调描边。

这不是 SVG 缩放或 CSS `text-anchor` 导致的偏移。页面只是原样渲染核心 layout 返回的 `x` 和 `width`，错误已经存在于 selection layout 的水平几何中。

## 2. 根因

`measure-spacing.ts` 为每个 Beat 输出：

```ts
interface ILXMBeatLayout {
  x: number;
  width: number;
}
```

其中：

- `beat.x` 是音符、休止符和符干共用的时间锚点；
- `beat.width` 是当前节奏列向后占用的布局宽度。

音符布局直接使用 `slot.x`：

```ts
{
  x: slot.x,
  width: slot.width,
}
```

但 `selection-layout.ts` 将同一组数据解释为矩形左边界和矩形宽度：

```ts
{
  x: beat.x,
  width: beat.width,
}
```

因此形成以下几何：

```text
当前：
Beat ●──────────┐
     └──选择框──┘

期望：
┌─────●─────┐
└──选择框───┘
```

此外，`hit-test.ts` 已经使用相邻 Beat 锚点的中点划分点击归属，而 selection layout 使用 `beat.x → beat.x + beat.width`。这使“点击属于哪个 Beat”和“高亮显示哪个水平区域”采用两套不同的边界语义。

现有 selection layout 测试直接断言 `rect.x === beat.x` 和 `rect.width === beat.width`，因此测试把当前错误行为固化为了契约，无法发现视觉偏移。

## 3. 修复目标

完成后应满足：

- 单 Beat 选框围绕目标 Beat 的时间锚点分布，不再单向向右延伸；
- 相邻 Beat 的单元格以两个时间锚点的中点为共同边界；
- 多 Beat 选区从首个 Beat 的单元格左边界连续覆盖到末个 Beat 的单元格右边界；
- selection range、focus caret 和 hit-test 使用同一套 Beat 单元格边界；
- 第一个和最后一个 Beat 的单元格不越过所属 measure；
- 跨 measure 或 system 的范围仍按现有规则拆分，不绘制跨行矩形；
- 不修改音符、休止符、符干、连梁和附点的坐标；
- 不修改 `ILXMDocument`、选区业务模型、领域命令或历史行为。

## 4. 非目标

本 fix 不包含：

- 重新设计 rhythm column 或改变 Beat 的节奏间距；
- 修改音符、休止符、符干、连梁或附点的水平位置；
- 改变跨小节、跨 system 的选区业务语义；
- 增加选框圆角、动画、主题或其他视觉样式；
- 修改最多 512 个 TAB 单元格的范围限制；
- 修改点击、Shift+点击、拖动或键盘导航规则。

## 5. 统一 Beat 单元格边界

### 5.1 纯布局 helper

在 layout 层新增内部纯函数：

```ts
interface ILXMBeatCellBounds {
  left: number;
  right: number;
  width: number;
}

function getBeatCellBounds(
  measure: ILXMMeasureLayout,
  beatId: string,
): ILXMBeatCellBounds | null;
```

该函数只消费最终 `ILXMMeasureLayout`，不得读取 document tick、页面尺寸、DOM 或 React 状态。

Beat 必须先按最终 `x` 升序排列。目标 Beat 不存在、边界不是有限数值或最终宽度小于等于零时返回 `null`，调用方不得输出无效 SVG 几何。

### 5.2 边界算法

对于中间 Beat：

```text
left  = (previous.x + current.x) / 2
right = (current.x + next.x) / 2
```

对于第一个 Beat：

```text
left  = measure.x
right = (current.x + next.x) / 2
```

对于最后一个 Beat：

```text
left  = (previous.x + current.x) / 2
right = measure.x + measure.width
```

只有一个 Beat 时：

```text
left  = measure.x
right = measure.x + measure.width
```

最终统一计算：

```ts
width = right - left;
```

首尾使用 measure 边界，保证小节左右区域没有无法点击的盲区，也避免选框越过小节线。对于等间距的内部 Beat，时间锚点恰好位于选框水平中心；对于不等间距节奏，边界仍服从“距离最近的 Beat”规则，并确保相邻单元格连续且不重叠。

### 5.3 Module 位置

建议新增内部文件：

```text
packages/lxm-editor/src/layout/beat-cell-bounds.ts
```

由以下模块共同复用：

```text
beat-cell-bounds.ts
  ├─ selection-layout.ts
  └─ hit-test.ts
```

该 helper 属于 layout 内部 seam。除非外部消费者出现明确需求，本 fix 不从包根入口公开导出，避免扩大公共 API。

## 6. Selection layout 修改

### 6.1 单 Beat focus caret

`layoutTabCellCaret` 找到 focus Beat 后，不再直接返回：

```ts
x: beat.x,
width: beat.width,
```

改为：

```ts
const bounds = getBeatCellBounds(measure, beat.id);
if (!bounds) return null;

return {
  // 其他稳定业务字段保持不变
  x: bounds.left,
  width: bounds.width,
};
```

垂直边界继续复用 `getStringCellBounds`，本 fix 不改变弦方向的单元格高度。

### 6.2 多 Beat selection range

`getBeatSpan` 继续筛选当前 measure 中被选中的 Beat，但水平范围改为：

```ts
const firstBounds = getBeatCellBounds(measure, first.id);
const lastBounds = getBeatCellBounds(measure, last.id);

return {
  beats,
  x: firstBounds.left,
  width: lastBounds.right - firstBounds.left,
};
```

这样单格、横向范围和二维矩形使用同一套水平边界。跨 measure/system 时，每个片段分别根据所属 measure 的首尾 Beat 计算，不跨小节线或换行连接。

## 7. Hit-test 修改

`hit-test.ts` 不再单独维护一份相邻中点算法。命中流程调整为：

1. 使用既有 measure bounds 找到目标 measure；
2. 按 `x` 排序该 measure 的 Beat；
3. 为每个 Beat 调用 `getBeatCellBounds`；
4. 找到满足 `point.x >= left && point.x <= right` 的 Beat；
5. 继续使用既有弦线 Y 容差确定 string；
6. 返回稳定的 `trackId + measureId + beatId + string`。

公共边界上的点可能同时满足左右两个单元格。为保持确定性，按 Beat 文档/布局顺序选择第一个匹配项，行为与当前 `find` 的右边界包含规则一致。

修复后必须满足：指针落在选框水平范围内时命中同一个 Beat；重新 layout 后，命中与选框共同使用新的最终坐标。

## 8. 预计修改范围

```text
packages/lxm-editor/src/layout/
  beat-cell-bounds.ts       # 新增统一 Beat 单元格边界 helper
  selection-layout.ts      # range/caret 改用统一边界
  hit-test.ts              # 命中改用统一边界

packages/lxm-editor/tests/layout/
  beat-cell-bounds.test.ts # 新增边界算法单元测试
  selection-layout.test.ts # 更新单格和范围几何断言
  hit-test.test.ts         # 增加高亮边界一致性回归
```

原则上不需要修改：

- `apps/website/components/EditorShell/index.tsx`：页面继续原样消费 layout 几何；
- `apps/website/components/EditorShell/index.module.scss`：填充和描边样式不是偏移原因；
- `editing/tab-cell-selection.ts`：稳定 ID 和范围解析语义不变；
- `core/commands.ts`：批量 Note 命令与视觉边界无关；
- `apps/website/stores/editor-store.ts`：document、selection 和 history 行为不变。

## 9. 测试方案

### 9.1 Beat 单元格边界

- 中间 Beat 的左右边界分别等于相邻锚点中点；
- 等间距内部 Beat 的 `current.x` 等于 `(left + right) / 2`；
- 第一个 Beat 左边界等于 `measure.x`；
- 最后一个 Beat 右边界等于 `measure.x + measure.width`；
- 单 Beat measure 使用完整 measure 宽度；
- Beat 数组输入顺序变化不影响结果；
- 不存在的 Beat 返回 `null`；
- 输出始终为有限数值且 `width > 0`。

### 9.2 Selection layout

- 单格范围和 focus caret 具有相同的 `x/width`；
- 单格选框不再断言 `x === beat.x`；
- 同 measure 多 Beat 范围宽度等于末端右边界减起端左边界；
- 正向和反向选择得到相同 selection range 几何；
- compact、comfortable 和 System 拉伸后都使用最终锚点；
- 跨 measure/system 仍按实际布局拆分；
- 选区几何不改变 layout 总尺寸。

### 9.3 Hit-test 一致性

- 每个 Beat 单元格水平中心命中该 Beat；
- 相邻边界两侧分别命中对应 Beat；
- 首 Beat 左侧区域与末 Beat 右侧区域不存在命中盲区；
- selection rect 内采样点命中的 `beatId` 与 rect 对应 Beat 一致；
- CSS 缩放和 SVG 坐标转换后的既有命中测试无回归。

### 9.4 全量回归

```bash
pnpm test
pnpm type-check
pnpm lint
pnpm build
```

## 10. 浏览器验收

在固定 A4 桌面页面完成：

- 依次点击一个小节的首个、中间和末尾 Beat，观察选框不再从音符锚点单向向右展开；
- 使用方向键逐 Beat 移动，focus caret 与目标 Beat 同步移动；
- Shift+方向键形成横向范围，范围之间无空隙或重叠；
- 横向、纵向和对角拖动后，selection range 与 focus caret 对应正确单元格；
- 跨 measure 和跨 system 选择仍正确拆分；
- compact/comfortable 密度及重新断行后选框继续使用最新坐标；
- 点击选框左右边缘附近时，命中的 Beat 与高亮区域一致；
- 控制台无 error/warning，输入、删除和 undo/redo 无回归；
- 打印预览继续隐藏 selection layer。

## 11. 完成定义

本 fix 仅在以下条件全部满足后完成：

- Beat 单元格水平边界只有一个核心 layout 实现；
- selection range、focus caret 和 hit-test 全部复用该实现；
- 单 Beat 选框不再从 Beat 锚点向右单向延伸；
- 相邻单元格连续、无重叠、无负宽度；
- 首尾单元格不越过 measure，且 measure 内没有命中盲区；
- 跨 measure/system 的矩形拆分无回归；
- 聚焦测试与全量自动化检查通过；
- 固定桌面浏览器完成真实指针和键盘验收；
- 验收结果与已知限制回写本文档。

## 12. 实施记录

| 日期       | 状态     | 说明                                                                                                            |
| ---------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| 2026-08-06 | 修复完成 | 新增统一 Beat 单元格边界，selection range、focus caret 和 hit-test 已完成复用，并补充中文注释与自动化回归测试。 |

### 2026-08-06 验收结果

- 自动化：核心包 114 项测试、website store 6 项测试全部通过；`pnpm test`、`pnpm type-check`、`pnpm lint`、`pnpm build` 全部通过。
- 构建环境：Turbopack 在受限沙箱内因禁止绑定本地端口而失败；使用获准的正常执行环境重跑后构建成功，该失败与代码无关。
- 浏览器：Codex In-app Browser，本地网站 `http://localhost:3000/`。
- 已验证：实际点击 Beat 后，selection range 与 focus caret 的 `x/width` 完全一致；选框从 Beat 时间锚点两侧展开，不再从锚点单向向右绘制。
- 已验证：选框水平中心采样命中同一 `beatId`，首尾 Beat 继续覆盖小节边界，页面控制台无 warning/error。
