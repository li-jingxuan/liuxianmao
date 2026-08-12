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
8. lane 分配使用最终视觉包围框判断二维碰撞，不能因不同弦的自然 Y 与 lane 偏移组合
   产生新的重叠。

## 4. 非目标

- 不修改 `track.techniques[]` 的领域模型和持久化格式。
- 不加入通用 Slur、预推弦、释放推弦或复合推弦链。
- 不实现任意曲线优化或全局二维排版求解器；本次只实现 system 内稳定、局部的二维
  first-fit 碰撞检测。
- 不调整 staff 内局部技巧 `slideUp`、`slideDown`、泛音、扫弦和琶音的既有语义，
  但需要回归确认它们未受 system 平移影响。
- 不在 React 页面层添加技巧几何计算。

## 5. 核心设计

### 5.1 分离锚点、完整几何与碰撞位移

每个 technique segment 分三步布局：

1. 解析 Note/Beat、跨 system 安全边和 Beat 区间覆盖范围；
2. 一次生成不考虑其他技巧时的完整自然几何 `naturalPlan`；
3. lane 分配完成后，沿 Y 轴整体应用 `laneOffsetY`，得到最终几何。

建议增加内部结构：

```ts
interface ILXMRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ILXMTechniqueAnchorGeometry {
  x1: number;
  y1: number;
  /** 单音技巧可以省略第二锚点。 */
  x2?: number;
  y2?: number;
}

interface ILXMTechniqueGeometryPlan {
  anchors: ILXMTechniqueAnchorGeometry;
  path: ILXMTechniquePathLayout | null;
  texts: ILXMTextLayout[];
  /** stroke、文字、箭头等全部可见内容的确定性包围框。 */
  visualBounds: ILXMRect;
  /** visualBounds 加碰撞净空，供 lane 分配使用。 */
  collisionBounds: ILXMRect;
}

interface ILXMTechniqueCandidate {
  // 保留既有字段
  /** 区间技巧必须保存当前 segment 实际覆盖的 Beat，不能只保留首尾 X。 */
  coveredBeatIds: string[];
  naturalPlan: ILXMTechniqueGeometryPlan;
}
```

这里的结构只属于 layout 内部，不进入公开文档 schema。lane 分配消费
`collisionBounds`，system 顶部扩展消费 `visualBounds`，命中 bounds 则由最终
`visualBounds` 加 `LXM_TECHNIQUE_HIT_PADDING` 得到。不得在三个阶段分别用不同的
近似公式重新推导范围。

### 5.2 统一净空常量

在 `layout-constants.ts` 中新增并集中维护：

```ts
export const LXM_TECHNIQUE_NOTE_CLEARANCE_Y = 5;
export const LXM_FRET_TEXT_FONT_SIZE = 12;
export const LXM_FRET_TEXT_HALO_WIDTH = 2.5;
export const LXM_TECHNIQUE_FRET_GAP_X = 2;
export const LXM_TECHNIQUE_CURVE_HEIGHT = 8;
export const LXM_TECHNIQUE_COLLISION_PADDING = 2;
export const LXM_TECHNIQUE_ARROW_WIDTH = 5;
export const LXM_TECHNIQUE_ARROW_HEIGHT = 5;
```

具体数值以浏览器视觉验收为准，但不得继续散落 `- 4`、`+ 3`、`- 8` 等无法说明
语义的魔法数字。页面当前通过 CSS 为品位文本设置 `12px` 字号、粗体和白色描边；
修复后字号与描边占用必须成为核心 layout 的明确契约，页面只消费或镜像同一常量，
不能继续让 Tie 端点依赖页面私有 CSS。

SVG marker 也属于几何契约。bend、strum、arpeggio 使用的箭头尺寸、参考点和视觉外延
应由核心常量描述，`visualBounds` 必须覆盖 marker；React 中的 `<marker>` 只按同一组
值渲染，不能成为核心 layout 不知道的额外外延。

品位文本半宽使用确定性估算函数，而不是固定 `6px`：

```ts
const getFretTextHalfWidth = (note: ILXMNoteLayout): number =>
  estimateFretTextWidth(note.fretText, LXM_FRET_TEXT_FONT_SIZE) / 2 +
  LXM_FRET_TEXT_HALO_WIDTH +
  LXM_TECHNIQUE_FRET_GAP_X;
```

首版可以使用按字符数和目标字体校准的保守估算；若未来引入字体度量表，函数 interface
保持不变。禁止在浏览器中临时测量后反向改变核心布局。

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

自然锚点位于不同弦时，仅按水平区间分 lane 不能保证正确性。例如弦距为 12、lane
高度为 14 时，下方弦的 lane 1 可能被上移到上方弦 lane 0 附近，形成新的重叠。因此
本次必须使用稳定的二维 first-fit，而不是把二维检测留作紧凑度优化：

1. 按 `collisionBounds.x`、右边界、`techniqueId`、`segmentIndex` 稳定排序；
2. 对每个 candidate 从 lane 0 开始依次尝试；
3. 将其完整 `collisionBounds` 上移 `lane * LXM_TECHNIQUE_LANE_HEIGHT`；
4. 只对 X 范围相交的已放置 segment 检查二维矩形是否相交；Note 局部技巧还要检查
   当前水平跨度内除自身端点外的品位文字静态障碍 bounds；
5. 选择第一个无碰撞的 lane，并保存平移后的完整几何；
6. staffLocal 技巧继续使用 lane `-1`，不参与上方技巧的 lane 分配。

静态障碍只用于把 Note 局部技巧提升到不会压住其他品位文字的位置，不把六根弦线视为
障碍；否则低音弦局部技巧永远无法保持邻近语义。每次增加 lane 都使 Y 严格减小，有限
障碍集合下 first-fit 最终必然找到位置，不设置依赖数据规模的任意最大 lane。

同 lane 不再表示一条贯穿 system 的绝对水平带，只表示“相对各自自然锚点使用相同
级别的避让偏移”。因此 `techniqueLaneCount` 只保留为布局诊断信息，不能再用于推导
system technique area 高度。

## 6. 各技巧的自然几何

### 6.1 Tie

同 system：

- 起点为起始 fret 完整视觉包围框右侧：`from.x + getFretTextHalfWidth(from)`；
- 终点为目标 fret 完整视觉包围框左侧：`to.x - getFretTextHalfWidth(to)`；
- 弧线两端位于音符 Y 上方 `noteClearanceY`；
- 控制点继续向上 `curveHeight`，形成浅弧线；
- 不绘制标签或箭头。

这同时落实 v5 技术设计中“弧线不能穿过品位数字”的约束，并覆盖一位、两位品位以及
品位文字白色描边。若净空后 `x2 <= x1`，应使用明确的极短距离模板或安全降级，不能
输出反向弧线。

### 6.2 Hammer-on / Pull-off

- 端点和弧线规则与 Tie 相同；
- `H` / `P` 位于弧线中点上方；
- 标签包围框必须进入 segment 的碰撞区间和命中 bounds；
- 跨 system 时标签只出现在首 segment。

### 6.3 Bend

- 曲线从目标 Note 的上边缘附近开始，而不是从 system technique area 顶部开始；
- 起点 X 保持为 `note.x` 或经视觉校准后略偏右；
- 曲线向右上方延伸并带箭头；
- `Full` 位于箭头附近，文字与箭头共同计入 `visualBounds` 和 `collisionBounds`；
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

这两类属于 Beat 区间标记，仍使用水平延续线。候选阶段必须依据稳定文档 Beat 顺序，
为每个 segment 保存 `coveredBeatIds`，不能只保存 `fromBeat/toBeat` 的 X。自然 Y 从
当前 segment 实际覆盖的音符几何推导：

- 收集当前 segment 内 Beat 的所有 Note；
- 取最靠上的 Note Y，再减去 `noteClearanceY`；最终 Y 使用该值与 staff 顶部安全
  基线中的较小值，使区间说明保持在 staff 上方，不进入弦间区域；
- 标签、虚线和结束钩作为一个整体应用 lane 偏移；
- 无 Note 的 continuation segment 使用当前 system 的 staff 顶部安全基线。

因此局部 Note 技巧与区间说明采用不同的垂直语义：Tie、H/P、bend、vibrato、tapping、
trill 和 pickStroke 属于 `noteLocal`，允许进入弦间区域；palm mute、let ring 属于
`staffAbove`，始终位于整个 staff 上方；slide、泛音、strum、arpeggio 继续属于
`staffLocal`。

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
按最终几何反推顶部扩展量，并保证技巧模板只生成一次：

1. 先生成 base systems 与 Note/Beat 锚点；
2. 一次生成所有 segment 的完整自然 plan；
3. 使用最终 `collisionBounds` 分配 lane，并整体平移 path、texts 与 bounds；
4. 对每个 system 根据最终 `visualBounds` 计算顶部扩展量；
5. 将 staff、measure、所有子布局及 technique plan 统一增加同一个 `contentDy`；
6. 增加 `system.height`，重排后续 system.y；
7. 直接 materialize 已平移的 plan，不使用新锚点重新生成第二套几何；
8. 从最终 segment bounds 重建 hit index。

顶部扩展量使用最终可见几何，而不是 lane 数量：

```ts
const topExtension = Math.max(
  0,
  baseSystem.y + LXM_TECHNIQUE_AREA_PADDING_TOP - minTechniqueVisualY,
);
```

同一个 system 内 staff 和技巧 plan 接受相同的后续平移，因此它们的相对距离保持不变。
无上方技巧的 system 必须保持 `topExtension === 0`，与基线几何深相等。

为避免自然锚点在 staff 平移后发生循环依赖，可以让自然几何使用 base system 页面
坐标或 staff-local Y，但单次布局中只能选择一种坐标空间。最终通过统一平移得到页面
坐标，不得在扩高前后重新求模板，也不要混用平移前后的锚点。

## 9. 建议实现拆分

为减少 `createSegmentLayout()` 的分支复杂度，建议拆为以下纯函数：

```ts
const resolveTechniqueAnchors = (...): ILXMTechniqueResolvedAnchors;
const createNaturalTechniquePlan = (...): ILXMTechniqueGeometryPlan;
const assignTechniqueLanes = (...): ILXMTechniqueLaneAssignment;
const translateTechniquePlan = (...): ILXMTechniqueGeometryPlan;
const getTechniqueSystemTopExtension = (...): number;
const materializeTechniqueSegment = (...): ILXMTechniqueSegmentLayout;
```

每个函数只处理一个阶段，输入相同则输出相同，不读取页面 DOM 或字体测量结果。
`createNaturalTechniquePlan()` 是每种技巧模板唯一的几何来源；其他阶段只允许整体平移
或由既有 bounds 加 padding，禁止重新拼 path 或重新估算文字范围。

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

### 10.3 二维 lane 与方向测试

分别构造同一自然锚点和相邻弦上的水平重叠技巧：

- 同一自然锚点发生碰撞时 lane 分别为 0 和 1；
- 对同一个自然 plan，lane 1 的最终 Y 比 lane 0 小
  `LXM_TECHNIQUE_LANE_HEIGHT`；
- 相邻弦技巧必须按平移后的二维 `collisionBounds` 判定，不能只因 lane 不同就视为
  已避让；
- X 重叠但 Y 不重叠的技巧允许复用 lane 0；
- system 顶部扩展后，两者均不得被 SVG viewBox 裁切。

### 10.4 Tie 端点测试

- 分别使用一位品位与两位品位构造 Tie/H/P；
- 同 system 起点位于 `from` 的完整文字包围框右侧；
- 终点位于 `to` 的完整文字包围框左侧；
- 路径不进入品位文本及其白色描边范围；
- 极短水平距离不输出反向或含 `NaN/Infinity` 的路径；
- 跨 system 两段分别贴近真实起始和目标 Note；
- 任一 segment 的命中仍返回同一个 `techniqueId`。

### 10.5 系统布局与非回归测试

- 技巧不会与页面顶部、staff、TAB 行头或前一 system 的 rhythm lane 重叠；
- 每个 segment 的 hit bounds 完全位于所属 `system.y..system.y + height` 内；
- `system.height` 和下一 `system.y` 覆盖最终技巧几何；
- 无上方技巧的 system 与基线布局深相等；
- bend 的箭头和 `Full` 文本进入视觉、碰撞与命中范围；
- Note 局部技巧避开水平跨度内非锚点品位文字，弦线本身不触发 lane 提升；
- X 或 Y 不相交的技巧继续复用 lane；
- staff 内的 slide、泛音、strum、arpeggio 坐标不发生回归；
- strum/arpeggio 投影隐藏基础 Note 后，其他技巧仍使用投影前完整 anchors；
- `visualBounds` 被 `collisionBounds` 与 hit bounds 完整覆盖；
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

1. 定义品位文字 bounds、技巧 `visualBounds/collisionBounds` 及坐标空间契约。
2. 添加音符距离、相邻弦二维碰撞、两位品位端点和无技巧基线的失败测试。
3. 建立稳定 Beat 顺序索引，为区间 candidate 保存每个 segment 的 `coveredBeatIds`。
4. 一次生成 Tie、H/P 与跨 system segment 的完整自然 plan。
5. 完成 bend、vibrato、tapping、trill、pickStroke 的完整自然 plan。
6. 实现基于最终 bounds 的二维 first-fit 和相对自然几何向上的 lane 偏移。
7. 按最终 `visualBounds` 计算 system 顶部扩展并统一平移已有 plan。
8. 完成 palm mute、let ring 的 staffAbove 语义及 continuation 兼容。
9. materialize segment、重建 hit index，并回归投影前完整 anchors 与 staffLocal 技巧。
10. 运行 `lxm-editor` 的 test、type-check、lint，并完成网站视觉验收。

## 12. 验收标准

- Tie、H/P 的弧线端点视觉上紧贴起止品位文字且不穿过数字。
- bend 曲线从目标 Note 附近开始，`Full` 与箭头作为整体随 lane 移动。
- vibrato、tapping、trill、pickStroke 与目标 Note 保持稳定、可配置的净空。
- 技巧放在不同弦时，其 Y 坐标跟随目标 Note，而不是固定在 system 顶部。
- lane 0 最靠近自然锚点，lane 越大越向上远离 staff。
- 相邻弦上水平相交的技巧通过最终二维 bounds 避让，不因 lane 偏移产生新重叠。
- 一位和两位品位的 Tie、H/P 均避开完整文字及白色描边。
- 多技巧、跨 system 和页面顶部场景均无重叠、裁切或命中漂移。
- React 页面仍只消费核心 layout 输出，不包含技巧坐标推导。
- 所有新增回归测试和现有测试通过。

## 13. 风险与后续

### 13.1 低音弦局部技巧可能位于弦间

“紧贴目标音符”意味着第六弦上的 Note 局部技巧可能位于第五、六弦之间，而不是统一
放到 staff 之外。这是本方案的明确语义，不只是实现风险。它必须通过二维
`collisionBounds` 检查同拍品位与其他技巧；发生碰撞时提升 lane，而不是重新退回
system 顶部绝对定位。palm mute、let ring 不采用此规则，始终保持在 staff 上方。

### 13.2 文字包围框仍为估算值

当前核心 layout 不读取浏览器字体测量。首版继续使用确定性字号与保守宽度常量；若
后续字形差异造成明显碰撞，应引入可复现的字体度量表，而不是在页面层临时测量并
改变布局。

### 13.3 确定性估算与真实字形差异

本次二维检测基于核心 layout 的确定性估算 bounds，而不是浏览器实时字形包围框。若
目标字体或浏览器渲染产生超出估算的外延，应校准集中常量或引入版本化字体度量表；
不得在 React 中追加局部偏移，否则渲染、命中与 system 高度会再次分裂。
