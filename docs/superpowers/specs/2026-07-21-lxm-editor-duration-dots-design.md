# lxm-editor 附点布局设计

## 目标与范围

为 `packages/lxm-editor` 补齐附点的布局数据，使任意 SVG、Canvas 或其他渲染器都能直接绘制附点，无须从 `rhythm.dots` 再次推导位置。

本次只修改 `lxm-editor` 的数据模型、布局计算和测试；不迁移网站页面，也不参考或修改旧版 `packages/lxm-tabeditor`。

## 当前状态

- `ILXMRhythm` 已用 `dots` 表示附点数量。
- `calculateRhythmTicks` 已支持 0、1、2 个附点的时值换算。
- `duration-beam-layout.ts` 已把 `dots` 传入连梁算法，用于高层连梁的分段。
- `ILXMDurationMarkLayout` 目前只包含符干与连梁几何，未提供附点的几何信息。因此渲染器无法只依赖 layout 产物绘制附点。

## 方案选择

采用“附点从属于时值标记”的方案：扩展 `ILXMDurationMarkLayout`，而不新增独立的顶层附点集合。

理由：附点的锚点与一个 beat 的符干、连梁基线天然绑定；将它们一起输出可让渲染器按同一个 `beatId` 完成绘制，并维持 layout 层负责几何、渲染层只消费几何的边界。

## 数据模型

在 `ILXMDurationMarkLayout` 新增：

```ts
interface ILXMDurationDotAnchor {
  x: number;
  y: number;
}

interface ILXMDurationMarkLayout {
  // 保留现有字段
  dots: number;
  dotAnchors: ILXMDurationDotAnchor[];
}
```

约束：

- `dots` 直接保留原始 `beat.rhythm.dots`，便于渲染器决定字形或交互语义。
- `dotAnchors.length === dots`。
- 无附点时 `dotAnchors` 必须是空数组。
- 当前 rhythm 层只支持 0、1、2 个附点；布局层不额外改变该限制。

## 布局算法

在 `duration-beam-layout.ts` 中声明并导出附点布局常量：

- `LXM_DURATION_DOT_OFFSET_X`：第一个附点相对 `stemX` 的水平距离。
- `LXM_DURATION_DOT_GAP_X`：相邻附点的水平距离。
- `LXM_DURATION_DOT_OFFSET_Y`：附点相对 `beamBaseY` 的纵向距离。

新增纯函数（名称可按现有文件风格微调）负责创建锚点：

```ts
buildDurationDotAnchors(stemX, beamBaseY, dots): ILXMDurationDotAnchor[]
```

它按以下规则生成第 `index` 个附点：

```ts
x = stemX + LXM_DURATION_DOT_OFFSET_X + index * LXM_DURATION_DOT_GAP_X
y = beamBaseY + LXM_DURATION_DOT_OFFSET_Y
```

`buildDurationMark` 在构建每个 mark 时调用此函数，并填充 `dots`、`dotAnchors`。附点锚点以符干和连梁的共同基线为参照，因此横向与时值符干关联，纵向可通过常量稳定地避开 TAB 数字与连梁。

## 兼容性与边界

- 不改动 `calculateRhythmTicks`、拍组边界计算或连梁分组规则。
- 现有 `layoutBeamSegments` 对带附点短时值的高层 partial beam 行为保持不变。
- 不引入 React、SVG 或字体字形依赖；layout 仅输出点中心坐标。
- 删除 `layoutDurationBeams` 中遗留的 `console.log`，避免布局函数产生副作用。

## 测试策略

在 `packages/lxm-editor/tests/layout/duration-beam-layout.test.ts` 中补充：

1. 无附点 beat 产出 `dots: 0` 和空 `dotAnchors`。
2. 单附点 beat 产出一个预期坐标的锚点。
3. 双附点 beat 产出两个等高、按常量间距水平排列的锚点。
4. 通过 `layoutDurationBeams` 验证附点锚点进入最终 `durationMarks`，而非只测试内部辅助函数。
5. 保留并运行现有“附点 beat 在高层级生成 partial beam”的回归测试。

测试先以预期 API 失败，再实现最小布局逻辑使其通过；随后执行 `lxm-editor` 的完整测试、类型检查和 lint。

## 验收标准

- 任何 `rhythm.dots` 为 1 或 2 的 beat，在 `layoutDurationBeams` 结果的对应 `durationMark` 中得到等数量的附点锚点。
- 锚点位置完全由 `lxm-editor` 的 layout 常量和输入布局决定；调用方不需要自行计算。
- 无附点和既有连梁布局的测试继续通过。
- `packages/lxm-editor` 的 test、type-check 与 lint 均通过。
