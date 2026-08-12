# MVP v5 技巧音符锚点布局修复方案

## 1. 问题概述

当前 `tie`、`hammerOn`、`pullOff`、`bend`、`vibrato`、`tapping`、
`trill`、`pickStroke` 等位于 TAB 上方的技巧虽然在 X 轴上锚定了 Note 或
Beat，但其 Y 坐标统一来自 system 顶部的 `laneY`，没有以实际音符作为自然锚点。

这会导致技巧与目标音符之间出现明显脱离：单 lane 下，第六弦音符与技巧的纵向
距离约为 95～98px，第一弦仍约为 38px。技巧所作用的音符越靠下，视觉距离越大，
读者难以快速判断技巧属于哪颗音符。

此外，现有 lane 方向与 v5 技术设计不一致。技术设计规定“越大的 lane 越远离
staff”，当前公式却让 lane 编号越大、SVG Y 越大，即越靠近 staff。

## 2. 根因

### 2.1 候选阶段丢失纵向锚点

`getTechniqueEndpoints()` 和 `ILXMTechniqueCandidate` 只保留 `x1`、`x2` 与
system 信息，没有保留起止 Note 的 Y 坐标、Beat 内目标音符范围或技巧的自然几何。

### 2.2 laneY 取代了自然几何

`createSegmentLayout()` 先依据 system 顶部计算绝对 `laneY`，随后直接用它绘制
连接弧线、推弦、波浪线及文字。lane 本应只负责碰撞后的额外位移，现在却同时承担
技巧锚点与碰撞避让两个职责。

### 2.3 system 技巧区先下移 staff，进一步放大距离

系统会先根据 lane 数量扩大 technique area，再整体下移 staff。技巧仍停留在
technique area 顶部，因此技巧与 staff 的距离包含了完整 technique area、staff
顶部留白以及目标弦相对第一弦的偏移。

### 2.4 缺少音符邻近性回归测试

现有测试验证技巧类型、SVG path、跨行分段、命中和 lane 数量，但没有断言技巧端点
与 Note/Beat 锚点的距离，也没有验证 lane 编号的视觉方向。

## 3. 修复目标

1. Note 技巧必须以实际 Note 几何为自然锚点，而不是以 system 顶部为锚点。
2. Beat 技巧必须以 Beat 内实际目标音符几何为自然锚点。
3. lane 仅表达碰撞避让偏移；lane 0 最靠近自然锚点，lane 越大越向上远离 staff。
4. Tie、H/P 的真实端点避开品位文字，不穿过品位数字。
5. 跨 system 技巧的真实首尾端紧贴 Note，开放续接端锚定 staff 安全边。
6. system.height、后续 system.y、命中区域与页面裁切继续覆盖全部技巧几何。
7. 相同文档与 layout options 始终产生确定性的布局结果。

## 4. 非目标

- 不修改 `track.techniques[]` 的领域模型和持久化格式。
- 不加入通用 Slur、预推弦、释放推弦或复合推弦链。
- 不实现任意曲线优化或全局二维排版求解器。
- 不调整 staff 内局部技巧 `slideUp`、`slideDown`、泛音、扫弦和琶音的既有语义，
  但需要回归确认它们未受 system 平移影响。
- 不在 React 页面层添加技巧几何计算。

## 5. 核心设计

### 5.1 分离自然几何与碰撞位移

每个 technique segment 分两步布局：

1. 根据 Note/Beat 计算不考虑其他技巧时的自然几何 `naturalGeometry`；
2. lane 分配完成后，沿 Y 轴向上应用 `laneOffsetY`，得到最终几何。

建议增加内部结构：

```ts
interface ILXMTechniqueNaturalGeometry {
  x1: number;
  x2: number;
  /** 自然几何的顶部和底部，用于碰撞及 system 上边界计算。 */
  minY: number;
  maxY: number;
  /** lane 0 使用的自然绘制基线；具体含义由技巧模板解释。 */
  baselineY: number;
}

interface ILXMTechniqueCandidate {
  // 保留既有字段
  naturalGeometry: ILXMTechniqueNaturalGeometry;
}
```

这里的结构只属于 layout 内部，不进入公开文档 schema。

### 5.2 统一净空常量

在 `layout-constants.ts` 中新增并集中维护：

```ts
export const LXM_TECHNIQUE_NOTE_CLEARANCE_Y = 5;
export const LXM_TECHNIQUE_FRET_TEXT_CLEARANCE_X = 6;
export const LXM_TECHNIQUE_CURVE_HEIGHT = 8;
```

具体数值以浏览器视觉验收为准，但不得继续散落 `- 4`、`+ 3`、`- 8` 等无法说明
语义的魔法数字。

### 5.3 Note 上方的定义

对绑定单颗 Note 或同弦连接 Note 的技巧，自然基线定义为：

```ts
const naturalBaselineY =
  Math.min(...anchorNotes.map((note) => note.y)) -
  LXM_TECHNIQUE_NOTE_CLEARANCE_Y;
```

当前连接技巧要求同弦，因此同 system 的起止 Note 通常具有相同 Y。仍使用
`Math.min()`，避免布局层依赖隐含前提，也便于未来扩展。

最终基线为：

```ts
const finalBaselineY =
  naturalBaselineY - lane * LXM_TECHNIQUE_LANE_HEIGHT;
```

因此 lane 0 最接近音符，lane 1、2 依次向上远离 staff。

### 5.4 lane 分配策略

首版继续使用稳定的 first-fit interval partitioning，保持算法简单且确定：

- 按自然水平碰撞区间 `[x1, x2]` 排序；
- 水平区间不相交的技巧可复用 lane；
- 水平区间相交的技巧进入更高 lane；
- lane 编号只决定从自然位置向上的偏移量；
- 最终使用所有 segment 的真实 `minY/maxY` 计算 system 顶部扩展量。

注意：自然锚点可能位于不同弦，同一 lane 的两个技巧即使 X 区间相交，Y 区间也可能
不相交。为控制本次修复范围，首版仍按水平区间保守分 lane，不在此次引入二维区间
复用。后续可在有明确密度收益时升级为二维碰撞检测。

## 6. 各技巧的自然几何

### 6.1 Tie

同 system：

- 起点为起始 fret 文本右侧：`from.x + fretClearanceX`；
- 终点为目标 fret 文本左侧：`to.x - fretClearanceX`；
- 弧线两端位于音符 Y 上方 `noteClearanceY`；
- 控制点继续向上 `curveHeight`，形成浅弧线；
- 不绘制标签或箭头。

这同时落实 v5 技术设计中“弧线不能穿过品位数字”的约束。

### 6.2 Hammer-on / Pull-off

- 端点和弧线规则与 Tie 相同；
- `H` / `P` 位于弧线中点上方；
- 标签包围框必须进入 segment 的碰撞区间和命中 bounds；
- 跨 system 时标签只出现在首 segment。

### 6.3 Bend

- 曲线从目标 Note 的上边缘附近开始，而不是从 system technique area 顶部开始；
- 起点 X 保持为 `note.x` 或经视觉校准后略偏右；
- 曲线向右上方延伸并带箭头；
- `Full` 位于箭头附近，文字与箭头共同计入 bounds；
- lane 偏移作用于整条曲线及标签，不能只移动其中一部分。

### 6.4 Vibrato、Tapping、Trill

- `vibrato` 波浪线以目标 Note 上方自然基线绘制；
- `tapping` 的 `T` 以目标 Note 为水平中心并紧邻其上方；
- `trill` 的 `tr <fret>` 与后续波浪线共享同一自然基线；
- lane 偏移整体作用于文字、路径和 bounds。

### 6.5 Pick Stroke

`pickStroke` 首版只允许绑定恰好包含一颗 Note 的 Beat，因此：

- X 使用该 Note 的 `x`，不再依赖 Beat slot 左边界的隐含语义；
- Y 使用该 Note 上方自然基线；
- 上拨/下拨符号的实际字形边界纳入 bounds；
- 若未来允许整拍多音符，应明确改为绑定该 Beat 的最高视觉音符或 staff 上方区域，
  不能静默复用当前单音规则。

### 6.6 Palm Mute / Let Ring

这两类属于 Beat 区间标记，仍使用水平延续线，但自然 Y 应从区间覆盖的实际音符
几何推导：

- 收集当前 segment 内 Beat 的所有 Note；
- 取最靠上的 Note Y，再减去 `noteClearanceY`；
- 标签、虚线和结束钩作为一个整体应用 lane 偏移；
- 无 Note 的 continuation segment 使用当前 system 的 staff 顶部安全基线。

## 7. 跨 System 连接技巧

跨 system 时，每个 segment 独立计算自然端点：

### 首 segment（`toNext`）

- 起点紧贴真实起始 Note；
- 终点位于当前 system 右侧安全边；
- 自然 Y 由起始 Note 决定；
- 弧线在右端保持开放，不添加人为终止钩。

### 末 segment（`fromPrevious`）

- 起点位于当前 system 左侧安全边；
- 终点紧贴真实目标 Note；
- 自然 Y 由目标 Note 决定；
- 左端保持开放。

### 中间 segment（`both`）

- 当前领域规则下 Tie 最多跨一次 system，但 H/P 等公共布局代码仍保留 `both`；
- 无真实 Note 端点时使用 staff 顶部安全基线；
- 两端均保持开放，不能伪装成完整的同 system 弧线。

跨 system 的不同 segment 可以具有不同 Y，这是换行后各自贴近本行 staff 的正常
结果，不应强制维持页面全局水平线。

## 8. System 垂直布局调整

现有流程先根据 `laneCount` 计算固定 technique area 高度，再下移 staff。修复后应改为
按最终几何反推顶部扩展量：

1. 先生成 base systems 与 Note/Beat 锚点；
2. 计算所有 segment 的自然几何；
3. 分配 lane 并得到最终 `minY/maxY`；
4. 对每个 system 计算技巧超出 base system 顶部的距离；
5. 以该距离加顶部/底部净空作为 `techniqueHeight`；
6. 平移 staff、measure 及所有子布局；
7. 使用平移后的锚点重新生成最终 technique path/text/bounds；
8. 重排后续 system.y，并重建 hit index。

为避免自然锚点在 staff 平移后发生循环依赖，可以让自然几何首先使用
`staff-local Y`，最终一次性加上 system/staff 的全局偏移。不要在同一阶段混用平移前
和生效后的页面全局坐标。

## 9. 建议实现拆分

为减少 `createSegmentLayout()` 的分支复杂度，建议拆为以下纯函数：

```ts
const createNaturalTechniqueGeometry = (...): ILXMTechniqueNaturalGeometry;
const assignTechniqueLanes = (...): ILXMTechniqueLaneAssignment;
const applyTechniqueLaneOffset = (...): ILXMTechniqueNaturalGeometry;
const createTechniqueSegmentLayout = (...): ILXMTechniqueSegmentLayout;
const getTechniqueSystemTopExtension = (...): number;
```

每个函数只处理一个阶段，输入相同则输出相同，不读取页面 DOM 或字体测量结果。

## 10. 测试方案

### 10.1 音符邻近性回归测试

为以下技巧分别创建仅包含单个技巧的布局：

- `tie`
- `hammerOn`
- `pullOff`
- `bend`
- `vibrato`
- `tapping`
- `trill`
- `pickStroke`

断言其自然端点、文字或路径起点与目标 Note 的纵向距离不超过集中定义的净空与
字形高度之和。测试应比较结构化几何或路径模板参数，避免使用随意的宽松阈值掩盖
回归。

### 10.2 不同弦位置测试

将同一种单音技巧分别放到第一弦和第六弦：

- 技巧 Y 必须随 Note Y 同步变化；
- 两种情况下相对 Note 的净空必须相同；
- 不允许再次出现技巧 Y 固定、Note Y 改变的情况。

### 10.3 lane 方向测试

构造两个水平区间相交的技巧：

- lane 分别为 0 和 1；
- lane 1 的最终 Y 必须小于 lane 0；
- 两者的垂直间距等于 `LXM_TECHNIQUE_LANE_HEIGHT`；
- system 顶部扩展后，两者均不得被 SVG viewBox 裁切。

### 10.4 Tie 端点测试

- 同 system Tie 起点严格位于 `from.x` 右侧；
- 终点严格位于 `to.x` 左侧；
- 路径不穿过任一品位文字中心；
- 跨 system 两段分别贴近真实起始和目标 Note；
- 任一 segment 的命中仍返回同一个 `techniqueId`。

### 10.5 系统布局与非回归测试

- 技巧不会与页面顶部、staff、TAB 行头或前一 system 的 rhythm lane 重叠；
- `system.height` 和下一 `system.y` 覆盖最终技巧几何；
- 不相交技巧继续复用 lane；
- staff 内的 slide、泛音、strum、arpeggio 坐标不发生回归；
- hit bounds 完整覆盖应用 lane 偏移后的文字和 path；
- 相同输入重复布局得到完全相同的 JSON 几何。

### 10.6 页面视觉验收

在网站中至少检查：

- 第一弦与第六弦上的单音技巧；
- 相邻低音弦上的 Tie、H/P；
- 同一区域叠加两种技巧；
- system 行尾到下一行行首的 Tie；
- 选中技巧时命中框与实际图形一致；
- compact 与 comfortable 两种 density。

## 11. 实施顺序

1. 添加可稳定复现当前距离问题的失败测试。
2. 为 candidate 增加 Note/Beat 自然锚点几何。
3. 修正 Tie、H/P 的端点与自然弧线。
4. 修正 bend、vibrato、tapping、trill、pickStroke 的自然几何。
5. 将 lane 改为相对自然几何向上的偏移，并修正 lane 方向。
6. 按最终几何计算 system 顶部扩展和后续 system.y。
7. 完成 palm mute、let ring 及跨 system continuation 的兼容。
8. 重建 bounds/hit index 并补充命中测试。
9. 运行 `lxm-editor` 的 test、type-check、lint，并完成网站视觉验收。

## 12. 验收标准

- Tie、H/P 的弧线端点视觉上紧贴起止品位文字且不穿过数字。
- bend 曲线从目标 Note 附近开始，`Full` 与箭头作为整体随 lane 移动。
- vibrato、tapping、trill、pickStroke 与目标 Note 保持稳定、可配置的净空。
- 技巧放在不同弦时，其 Y 坐标跟随目标 Note，而不是固定在 system 顶部。
- lane 0 最靠近自然锚点，lane 越大越向上远离 staff。
- 多技巧、跨 system 和页面顶部场景均无重叠、裁切或命中漂移。
- React 页面仍只消费核心 layout 输出，不包含技巧坐标推导。
- 所有新增回归测试和现有测试通过。

## 13. 风险与后续

### 13.1 低音弦局部技巧可能穿越其他弦线

“紧贴目标音符”意味着第六弦上的弧线可能位于第五、六弦之间，而不是统一放到 staff
之外。这符合音符局部技巧的可读性目标，但必须视觉检查其与同拍其他品位数字的碰撞。
必要时应基于真实几何提升 lane，而不是重新退回 system 顶部绝对定位。

### 13.2 文字包围框仍为估算值

当前核心 layout 不读取浏览器字体测量。首版继续使用确定性字号与保守宽度常量；若
后续字形差异造成明显碰撞，应引入可复现的字体度量表，而不是在页面层临时测量并
改变布局。

### 13.3 二维 lane 复用

本次保留按水平区间分 lane 的保守策略，可能让不同弦、实际并不碰撞的技巧仍进入
不同 lane。这只影响紧凑度，不影响正确性。待真实谱例证明有必要后，再独立设计二维
碰撞区间复用。
