# MVP v3 Fix：A4 单页预览

## 1. 背景与问题

当前页面把谱面直接放在可滚动的编辑器容器中，页面没有“纸张”这一层视觉与尺寸约束。同时，`EditorShell` 使用：

```ts
const MVP_V2_SYSTEM_WIDTH = 345 * 4;
```

即 `systemWidth = 1380`。SVG 又使用 layout 返回的宽高作为自身 `width`、`height`，因此谱面按 1380 个逻辑单位原尺寸渲染。结果是：

- 谱面宽度跟随内容布局，而不是跟随 A4 纸张；
- 常见桌面视口需要横向滚动；
- 屏幕预览与打印纸张没有共同的尺寸模型；
- 如果只用 CSS 把现有 1380 宽 SVG 缩小到 A4，谱线、文字和交互命中区域都会整体缩小，可读性较差。

本 fix 为 MVP v3 增加第一阶段的 A4 单页预览，让布局算法按照 A4 内容区重新断行，并让页面以真实纸张比例展示结果。

## 2. 目标

完成后应具备以下行为：

- 编辑区中央显示一张纵向 A4 白色纸张；
- 纸张外框使用 `210mm × 297mm` 的真实比例；
- 纸张四周保留 `15mm` 内边距，谱面内容区宽度为 `180mm`；
- 核心 layout 按约 180mm 的内容宽度重新执行 System 断行；
- SVG 自适应纸张内容区宽度，保持纵横比，不发生横向非等比压缩；
- 纸张在窄视口中不被压扁，由编辑器外层提供水平滚动；
- 工具栏、输入提示和错误信息仍属于编辑器 UI，不进入纸张内容区；
- 为后续单页打印提供稳定的 A4 尺寸基础，但本阶段不实现多页拆分。

## 3. 非目标

本 fix 不包含：

- 按 System 自动拆分为多张 A4；
- 页眉、页脚、页码、曲名、作者等出版信息；
- 横向 A4、Letter 或自定义纸张规格；
- 缩放控件、适应宽度/适应整页等视图模式；
- 根据浏览器窗口动态改变 `systemWidth`；
- 将一个超高 SVG 强行裁切到 297mm；
- PDF 导出或打印对话框控制。

若谱面高度超过单页可打印内容区，本阶段不得通过裁切隐藏内容。页面可以继续向下展示完整谱面，并把“自动分页”保留为第二阶段工作；因此本阶段的 `297mm` 是纸张最小高度，而不是内容裁切边界。

## 4. 尺寸模型

### 4.1 纸张与内容区

采用以下固定尺寸：

| 项目           |    尺寸 |
| -------------- | ------: |
| A4 宽度        | `210mm` |
| A4 最小高度    | `297mm` |
| 上下左右内边距 |  `15mm` |
| 内容区宽度     | `180mm` |
| 单页内容区高度 | `267mm` |

浏览器按照 CSS 规范以 `96px = 1in` 换算绝对单位：

```text
180mm / 25.4mm × 96px ≈ 680.31px
```

核心 layout 使用无单位的 SVG 逻辑坐标，因此本阶段取整定义：

```ts
const A4_CONTENT_WIDTH = 680;
```

`680` 是页面预览和核心断行之间的显式契约，不应继续用“小节估算宽度 × 固定小节数”表达。每行实际容纳几个小节应由既有 `layoutSystems` 根据小节固有宽度决定。

### 4.2 单位职责

- `mm` 只用于页面层的纸张物理尺寸和留白；
- layout 继续使用无单位逻辑坐标，不引入 `mm`、DPI 或浏览器 API；
- SVG `viewBox` 使用 layout 的逻辑宽高；
- SVG 的 CSS 展示宽度为纸张内容区的 `100%`，高度按比例自动计算；
- `ILXMDocument` 不保存纸张尺寸或预览状态。

这种分工让核心包继续保持与 DOM、打印机和设备像素密度无关，同时让网站负责纸张呈现。

## 5. 页面结构

建议将工具 UI 与纸张内容明确分层：

```tsx
<div className={styles.editor}>
  <EditorToolbar />
  <EditorFeedback />

  <div className={styles.pageViewport}>
    <main className={styles.paper} aria-label="A4 乐谱页面">
      <svg className={styles.scoreSvg} />
    </main>
  </div>
</div>
```

当前组件可以先不抽出 `EditorToolbar` 和 `EditorFeedback` 子组件，但最终 DOM 层级必须表达相同边界：工具栏与反馈在 `.paper` 外，只有可打印的谱面进入 `.paper`。

职责如下：

- `.editor`：承载编辑器工具和反馈；
- `.pageViewport`：提供纸张周围留白、居中和窄屏滚动；
- `.paper`：定义 A4 物理宽度、最小高度和页边距；
- `.scoreSvg`：渲染核心 layout，并填满纸张内容区宽度。

## 6. Layout 接入

页面调用修改为：

```ts
const A4_CONTENT_WIDTH = 680;

const lxmLayout = useMemo<ILXMLayout | null>(() => {
  if (!document) return null;

  return buildLayout(document, {
    x: 0,
    y: 0,
    systemWidth: A4_CONTENT_WIDTH,
  });
}, [document]);
```

要求：

- 常量名称表达纸张内容区，不继续沿用 `MVP_V2_SYSTEM_WIDTH`；
- 不把 `680` 下沉为核心包默认值。A4 是网站的呈现策略，不是 `@liuxianmao/lxm-editor` 对所有消费者的默认约束；
- 不固定“每行两个”或“每行四个”小节；
- 继续复用既有 System 贪心断行和行宽对齐算法；
- 单个小节固有宽度超过 680 时，沿用核心布局的超宽小节规则。本阶段不缩放该小节，页面验收需要记录横向溢出这一已知边界。

## 7. 样式方案

建议在 `EditorShell/index.module.scss` 中增加：

```scss
.pageViewport {
  overflow: auto;
  padding: 24px;
}

.paper {
  width: 210mm;
  min-height: 297mm;
  margin: 0 auto;
  padding: 15mm;
  background: #fff;
  box-shadow: 0 4px 24px rgb(0 0 0 / 12%);
}

.scoreSvg {
  display: block;
  width: 100%;
  height: auto;
  cursor: crosshair;
  outline: none;
}
```

还需检查现有外层滚动关系：

- 页面只能保留一个主要的谱面滚动容器，避免 `.editorContentContainer`、`.editor` 和 `.pageViewport` 同时产生嵌套滚动条；
- A4 的 `210mm` 不使用 `max-width: 100%` 压缩，否则窄屏下纸张比例和实际内容字号会变化；
- 容器宽度不足时允许水平滚动；
- `box-sizing: border-box` 已由全局样式提供，因此 `width: 210mm` 包含 `padding: 15mm`，内部可用宽度正好为 180mm；
- 阴影仅用于屏幕区分纸张边界，不属于打印内容。

## 8. SVG 与交互约束

SVG 保留 layout 返回的 `viewBox`：

```tsx
<svg
  viewBox={`0 0 ${lxmLayout.width} ${lxmLayout.height}`}
  width={lxmLayout.width}
  height={lxmLayout.height}
  className={styles.scoreSvg}
/>
```

CSS 的 `width: 100%; height: auto` 只负责等比映射视口；不得修改 `viewBox` 来伪造 A4 宽度，也不得对谱面 `<g>` 使用 `scaleX(...)`。

交互命中必须继续通过 SVG 屏幕坐标到 `viewBox` 坐标的变换完成。验收时需要特别确认：

- CSS 缩放后的每根弦仍可点击；
- 首拍、末拍以及小节边界附近不会发生系统性偏移；
- 页面滚动后点击位置仍然正确；
- 高 DPI 和浏览器缩放不影响命中的逻辑坐标；
- active cursor 与目标 beat 对齐。

如果当前指针处理直接用 `clientX/clientY - boundingRect` 作为 layout 坐标，则必须改为基于 SVG `getScreenCTM().inverse()` 的坐标转换；如果已使用等价转换，只补回归验收，不重复实现。

## 9. 单页打印基线

本阶段可以补充最小打印样式，使能放入一页的谱面按照 A4 输出：

```scss
@page {
  size: A4 portrait;
  margin: 0;
}

@media print {
  .editorToolbar,
  .inputHint,
  .errorMessage {
    display: none;
  }

  .pageViewport {
    overflow: visible;
    padding: 0;
  }

  .paper {
    width: 210mm;
    min-height: 297mm;
    margin: 0;
    box-shadow: none;
  }

  .cursorLayer {
    display: none;
  }
}
```

该样式只是单页打印基线，不承诺长谱分页质量。打印验收必须关闭浏览器默认页眉页脚，并使用 `100%` 缩放；不能依赖用户选择“适合页面”来修复错误尺寸。

## 10. 预计修改范围

```text
apps/website/components/EditorShell/
  index.tsx          # A4 内容宽度、纸张 DOM 层级
  index.module.scss  # A4 纸张、滚动容器、SVG 和打印样式

apps/website/app/
  page.module.scss   # 仅在需要消除重复滚动容器时调整
  globals.scss       # 原则上无需修改
```

原则上不修改：

- `packages/lxm-editor/src/layout/*`：现有 `systemWidth` 已能表达目标内容宽度；
- `packages/lxm-editor/src/core/*`：纸张预览不改变领域数据和编辑命令；
- `ILXMDocument` schema：预览尺寸不是可持久化乐谱内容。

## 11. 测试与验收

### 11.1 自动化检查

页面层至少补充或保留以下可自动验证的契约：

- `buildLayout` 收到的 `systemWidth` 为 `680`；
- A4 常量不从小节数量推导；
- SVG 保留与 layout 一致的 `viewBox`；
- 既有 core layout、命中和编辑测试全部通过；
- TypeScript、lint 和生产构建通过。

本 fix 不要求用 jsdom 验证 `mm` 到像素的浏览器换算；物理尺寸、滚动和打印效果应进入真实浏览器验收。

### 11.2 屏幕验收

使用 MVP v3 规范谱例，在目标桌面浏览器检查：

- 页面出现宽高比正确的白色 A4 纸张，四周留白一致；
- 纸张在宽视口居中，背景与阴影能清楚表达页面边界；
- 谱面完整落在 180mm 内容区内，没有非预期横向溢出；
- System 根据 680 宽度重新断行，所有普通 System 右边界对齐；
- 不再出现由 1380 宽谱面造成的页面级横向滚动；
- 窄于纸张的视口通过谱面容器滚动，纸张本身不被压缩；
- 工具栏和提示不覆盖纸张；
- 点击、输入品位、修改时值、新增/复制/删除小节后，光标与目标位置一致；
- 控制台没有 error 或 React warning。

### 11.3 打印验收

对能容纳在一页内的规范谱例执行打印预览：

- 纸张规格为 A4 纵向；
- 内容没有被浏览器额外缩放；
- 四周可打印留白视觉上约为 15mm；
- 工具栏、提示、错误信息、纸张阴影和编辑光标不出现在打印结果中；
- 谱线、品位数字和节奏符号清晰，没有横向形变或裁切。

## 12. 已知限制与第二阶段接口

本阶段仍然以一个 SVG 渲染整首谱。浏览器不能可靠地从一个 SVG 图形内部按 System 分页，因此长谱打印可能跨页失败、整体缩放或被裁切。

第二阶段应在页面渲染前按可用内容高度对 `lxmLayout.systems` 分组：

```text
layout.systems
  → 按 267mm 对应的逻辑高度分组
  → 每组创建一个独立 A4 .paper
  → 每页渲染独立 SVG/viewBox
  → 使用 break-after: page 打印
```

因此第一阶段不要加入针对单个 System 的 CSS 分页规则，也不要依赖 `break-inside: avoid` 切割当前整谱 SVG。这些规则无法替代真正的 System 分页模型。

## 13. 实施顺序

1. 将页面常量改为 `A4_CONTENT_WIDTH = 680`，确认核心 layout 重新断行。
2. 调整 DOM 层级，把工具栏/反馈与纸张内容分离。
3. 实现 `.pageViewport`、`.paper` 和等比 SVG 样式。
4. 清理重复滚动容器，验证宽屏居中与窄屏横向滚动。
5. 验证 CSS 缩放和滚动后的 SVG 命中坐标。
6. 增加最小 `@page` 与 `@media print` 样式。
7. 运行全量检查，完成屏幕与单页打印验收。

## 14. 完成标准

- MVP v3 规范谱例以 A4 纵向纸张形式显示，页面宽度不再由 1380 逻辑单位撑开；
- layout 使用 `680` 内容宽度主动断行，没有通过非等比 CSS 缩放压缩谱面；
- 工具 UI 与纸张内容边界清晰，打印时只保留谱面；
- 宽屏、窄屏、滚动后及浏览器缩放下的点击命中正确；
- 单页打印预览尺寸、留白和可读性符合本方案；
- 长谱不会被静默裁切，并明确保留为第二阶段自动分页任务；
- `pnpm test`、`pnpm type-check`、`pnpm lint`、`pnpm build` 全部通过。
