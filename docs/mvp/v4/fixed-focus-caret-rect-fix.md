# MVP v4 Fix：固定尺寸 Focus Caret

## 1. 背景与问题

MVP v4 使用两层几何表达 TAB 选区：

- `selectionRange`：表示完整的 Beat × String 选择范围；
- `focusCaret`：表示当前接收品位输入和键盘导航的活动单元格。

前一项 [Beat 单元格选框居中修复](./beat-cell-selection-centering-fix.md) 已统一 Beat 单元格边界，解决了选框直接从 `beat.x` 向右绘制的问题。但当前 `focusCaret` 仍然完整复用 Beat 单元格的水平命中边界，其宽度会随以下因素变化：

- 前后 Beat 的节奏时值；
- compact/comfortable 横向密度；
- System 对小节和节奏列的拉伸；
- Beat 位于小节首部、尾部或中间的位置。

这使 `focusCaret` 同时承担了“宽命中区域”和“当前输入光标”两种职责。对于单 Beat 选择，用户看到的描边可能很宽，并且在前后 Beat 间距不一致时无法以 `beat.x` 为几何中心。

本 fix 将两种职责拆开：Beat 单元格边界继续服务于命中和多 Beat 范围；`focusCaret` 改为以 Beat/string 锚点为中心的固定尺寸 Rect。

## 2. 目标

完成后应满足：

- `focusCaret` 始终以 `beat.x + string.y1` 为几何中心；
- `focusCaret` 的逻辑宽高固定，不随 rhythm、System 拉伸或横向 density 改变；
- 单 Beat、单弦选择显示一个固定尺寸的活动框；
- 单 Beat、多弦选择使用固定水平宽度表达所选弦范围，并由 caret 标出 focus 弦；
- 多 Beat 选择继续使用完整 `selectionRange`，同时在 focus 单元格显示固定 caret；
- hit-test 继续保留较宽的可点击区域，不因 caret 变窄而降低操作容错；
- caret 只是派生 layout，不进入 `ILXMDocument`、selection 业务状态或历史。

## 3. 非目标

本 fix 不包含：

- 改变 Beat 的节奏列宽度或音乐元素位置；
- 缩小 hit-test 的点击区域；
- 修改矩形选区的 anchor/focus 业务语义；
- 修改批量 Note 命令、undo/redo 或 512 单元格上限；
- 增加 caret 闪烁、动画、拖拽控制点或缩放手柄；
- 使用 DOM 文本测量动态决定 caret 尺寸；
- 根据 fret 是一位数还是两位数改变 caret 宽度。

## 4. 几何职责拆分

### 4.1 Beat cell bounds

已有 `getBeatCellBounds` 保持不变，继续负责：

- hit-test 的宽水平命中区域；
- 多 Beat `selectionRange` 的首尾边界；
- 首尾 Beat 覆盖到 measure 边界，避免点击盲区。

该几何表达“哪个区域归属于这个 Beat”，宽度可以随布局变化。

### 4.2 Focus caret bounds

新增固定尺寸的 caret 几何，负责表达“当前输入发生在哪一个 TAB 单元格”。它只依赖：

- `beat.x`：水平中心；
- 目标弦的 `string.y1`：垂直中心；
- 核心 layout 常量：固定宽高。

```text
宽命中区域：|-----------------------------|
                    ┌──────┐
固定 caret：        │  ●   │
                    └──────┘
                       ↑
                    beat.x
```

用户可以在宽命中区域内轻松点击，但选中后看到的是紧凑、稳定并以 Beat 锚点居中的输入框。

## 5. 固定尺寸常量

在 `layout-constants.ts` 增加：

```ts
/** TAB 活动输入框的固定逻辑宽度。 */
export const LXM_TAB_FOCUS_CARET_WIDTH = 20;

/** TAB 活动输入框的固定逻辑高度。 */
export const LXM_TAB_FOCUS_CARET_HEIGHT = 14;
```

首版使用 `20 × 14` 个 SVG 逻辑单位：

- `20` 可以更舒适地覆盖当前 12px 加粗的一位/两位品位文本，并在文字两侧保留清晰空隙；
- `14` 比当前 12px 弦距上下各多 1 个逻辑单位，让描边不会紧贴弦单元格边缘；
- caret 必须严格以 Beat/string 锚点居中，不为了留在 measure 内而 clamp；compact 模式首 Beat 最多向左视觉越界 2 个逻辑单位，由 SVG `overflow: visible` 保证描边不被裁掉；
- 常量位于核心 layout，不放入 React、SCSS 或页面配置；
- 后续若视觉验收需要微调，只修改常量和对应快照/几何断言，不改变算法。

该尺寸是 SVG 逻辑尺寸。页面缩放时它与谱面一起等比缩放，不使用 `vector-effect` 固定屏幕像素尺寸；只有描边继续使用现有 `non-scaling-stroke`。

## 6. Focus caret layout

### 6.1 新增纯 helper

建议在 `selection-layout.ts` 内先增加私有纯函数；暂时没有第二个消费者，不单独制造公共 Module：

```ts
function getFocusCaretRect(
  beat: ILXMBeatLayout,
  string: ILXMStringLineLayout,
): Pick<ILXMTabCellCaretLayout, "x" | "y" | "width" | "height"> {
  return {
    x: beat.x - LXM_TAB_FOCUS_CARET_WIDTH / 2,
    y: string.y1 - LXM_TAB_FOCUS_CARET_HEIGHT / 2,
    width: LXM_TAB_FOCUS_CARET_WIDTH,
    height: LXM_TAB_FOCUS_CARET_HEIGHT,
  };
}
```

必须保持以下不变量：

```ts
caret.x + caret.width / 2 === beat.x;
caret.y + caret.height / 2 === string.y1;
```

`layoutTabCellCaret` 不再调用 `getBeatCellBounds` 或 `getStringCellBounds` 推导 caret 尺寸。它仍通过稳定的 `measureId + beatId + string` 找到最终 layout 锚点，因此重新断行或密度变化后会使用新坐标，但 Rect 尺寸保持不变。

### 6.2 防御性校验

正常 layout 一定能得到合法锚点。实现仍应拒绝输出无效 SVG 几何：

- Beat 或 string 不存在时返回 `null`；
- `beat.x`、`string.y1` 或固定尺寸不是有限数值时返回 `null`；
- 固定宽高小于等于零时返回 `null`。

固定常量由源码控制，最后两项主要用于保护未来重构。

## 7. Selection range 规则

### 7.1 单 Beat、单弦

当规范范围只有一个 Beat 且 `startString === endString`：

- `selectionRange` 使用与 `focusCaret` 相同的固定 `20 × 14` 矩形；
- range 提供现有半透明填充；
- caret 提供现有强调描边；
- 两个 Rect 完全重合，页面无需增加条件渲染或 CSS 特例。

最终视觉上只表现为一个带淡色背景的固定活动框。

### 7.2 单 Beat、多弦

当规范范围只有一个 Beat、但覆盖连续多根弦：

- selection range 的 `x/width` 使用固定 caret 水平边界；
- selection range 的上边界为首弦中心减去 `7`，下边界为末弦中心加上 `7`，保证完整覆盖首尾弦的固定 caret；
- focus caret 使用相同固定宽度，但高度只覆盖 focus 弦。

```text
┌────────┐  String 2  ← anchor
│        │
├────────┤  String 3  ← focus caret 独立描边
│        │
└────────┘  String 4
```

### 7.3 多 Beat

当规范范围包含两个或以上 Beat：

- selection range 继续使用 `getBeatCellBounds`，按 measure/system 拆分并覆盖完整范围；
- focus caret 始终使用固定 `20 × 14` Rect；
- 不因 focus 位于范围起点、终点或中间而改变 caret 尺寸；
- 正向和反向选择得到相同 range，但 caret 继续准确表达原始 focus 方向。

## 8. `getBeatSpan` 调整

`selection-layout.ts` 的 `getBeatSpan` 增加单 Beat 分支：

```ts
if (first.id === last.id) {
  return {
    beats,
    x: first.x - LXM_TAB_FOCUS_CARET_WIDTH / 2,
    width: LXM_TAB_FOCUS_CARET_WIDTH,
  };
}
```

多 Beat 分支保持：

```ts
x = firstCellBounds.left;
width = lastCellBounds.right - firstCellBounds.left;
```

这样单 Beat 的范围填充与固定 caret 对齐，多 Beat 仍完整表达选择范围。

不能在 React 中根据 `rect.beatIds.length` 修改 SVG 属性；单 Beat 和多 Beat 的最终几何必须由核心 layout 直接返回。

## 9. 页面渲染与样式

`EditorShell` 原有 SVG 结构可以保持：

```tsx
<g className={styles.selectionLayer} pointerEvents="none">
  {selectionRects.map((rect) => (
    <rect className={styles.selectionRange} {...rect} />
  ))}
  {focusCaret && <rect className={styles.focusCaret} {...focusCaret} />}
</g>
```

样式保持当前职责：

- `.selectionRange`：淡色填充；
- `.focusCaret`：更弱的填充和强调描边；
- `pointer-events: none`：选区层不参与命中；
- `vector-effect: non-scaling-stroke`：页面缩放时描边保持可见；
- `@media print`：整个 selection layer 继续隐藏。

不通过 CSS `transform: translateX(...)` 或固定 HTML 像素宽度修正位置，否则 layout 几何、滚动定位和页面渲染会再次分裂。

## 10. 预计修改范围

```text
packages/lxm-editor/src/layout/
  layout-constants.ts      # 增加固定 caret 宽高常量
  selection-layout.ts      # 固定 caret；单 Beat range 使用固定矩形基准

packages/lxm-editor/tests/layout/
  selection-layout.test.ts # 固定尺寸、严格居中和三种选区规则

apps/website/components/EditorShell/
  index.module.scss        # 允许居中 caret 在 SVG viewBox 边缘少量可见溢出

docs/mvp/v4/
  README.md
  fixed-focus-caret-rect-fix.md
```

原则上不需要修改：

- `hit-test.ts` 和 `beat-cell-bounds.ts`：宽命中区域语义保持不变；
- `EditorShell/index.tsx`：页面继续只消费核心 layout 几何；
- `tab-cell-selection.ts`：anchor/focus 和规范范围不变；
- `commands.ts`、editor store 和 history：持久化编辑行为不变。

## 11. 测试方案

### 11.1 Focus caret

- 单格 caret 的宽高严格等于 `20 × 14`；
- `caret.x + width / 2` 严格等于目标 `beat.x`；
- `caret.y + height / 2` 严格等于目标弦的 `y1`；
- compact 和 comfortable 下尺寸相同，但中心使用各自最终坐标；
- System 拉伸和重新断行后尺寸不变；
- 首 Beat、中间 Beat 和末 Beat 使用相同尺寸；
- focus 业务引用失效时返回 `null`。

### 11.2 Selection range

- 单 Beat、单弦 range 与 caret 完全重合；
- 单 Beat、多弦 range 宽度固定，高度覆盖连续弦区间；
- 多 Beat range 继续使用首尾 Beat cell bounds；
- 正向和反向多 Beat 选择得到相同 range；
- 跨 measure/system 仍按最终布局拆分；
- focus caret 不改变 selection range 的 beatIds 或 cellCount。

### 11.3 Hit-test 与交互

- 点击固定 caret 内部命中目标 Beat/string；
- 点击 caret 外、但仍在 Beat cell bounds 内时仍命中目标，随后显示居中的固定 caret；
- 方向键移动时 caret 每次只改变中心坐标，不改变尺寸；
- Shift+方向键扩展后 range 变化，caret 尺寸保持固定；
- 数字输入、删除和 undo/redo 不改变 caret 几何契约。

### 11.4 全量回归

```bash
pnpm test
pnpm type-check
pnpm lint
pnpm build
```

## 12. 浏览器验收

在固定 A4 桌面页面验证：

- 依次选择不同时值的首个、中间和末尾 Beat，caret 尺寸肉眼一致；
- 使用开发者几何读取确认 caret 中心严格等于品位文字的 `x` 和目标弦 `y`；
- 单 Beat、单弦只呈现一个固定大小的活动框，不出现两层错位；
- 单 Beat、多弦显示固定宽度的纵向范围，focus 弦描边清晰；
- 多 Beat 和跨 system 范围保持完整，focus caret 仍为固定尺寸；
- 从较宽命中区域边缘点击后，caret 回到 Beat 锚点中心；
- compact/comfortable 及页面 CSS 缩放下 caret 与谱面等比变化；
- 页面控制台无 warning/error，打印预览不显示选区。

## 13. 完成定义

本 fix 仅在以下条件全部满足后完成：

- focus caret 使用核心 layout 中定义的固定逻辑宽高；
- caret 水平、垂直中心严格等于 Beat/string 锚点；
- 单 Beat range 使用固定水平宽度，多 Beat range 保留完整范围语义；
- hit-test 保持宽命中区域，没有因视觉框变窄产生点击回归；
- 页面没有根据 Beat 数量或 CSS 像素重新推导几何；
- 聚焦测试和全量自动化检查通过；
- 固定桌面浏览器完成单格、多弦、多 Beat 和跨 system 验收；
- 实施结果、视觉微调和已知限制回写本文档。

## 14. 实施记录

| 日期       | 状态     | 说明                                                                                                      |
| ---------- | -------- | --------------------------------------------------------------------------------------------------------- |
| 2026-08-06 | 修复完成 | 使用 `20 × 14` 固定 caret，单 Beat range 复用固定矩形基准，多 Beat range 与宽 hit-test 保留原有范围语义。 |

### 2026-08-06 验收结果

- 自动化：核心包 117 项测试、website store 6 项测试全部通过；`pnpm test`、`pnpm type-check`、`pnpm lint`、`pnpm build` 全部通过。
- 浏览器：Codex In-app Browser，本地网站 `http://localhost:3000/`。
- 单格实测：selection range 与 focus caret 均为 `20 × 14`；compact 首 Beat 的最终几何为 `x = -2, y = 81, width = 20, height = 14`，中心严格等于 `beat.x = 8` 与目标弦 `y = 88`。
- 多 Beat 实测：Shift+右方向键扩展后，selection range 使用完整范围宽度 `53.503...`，focus caret 仍保持 `20 × 14`。
- 边界实测：`.scoreSvg` 的最终 `overflow` 为 `visible`，compact 首 Beat 左侧描边未被 viewBox 裁切。
- 页面控制台无 warning/error；单格与多 Beat 选区视觉层次符合方案。
