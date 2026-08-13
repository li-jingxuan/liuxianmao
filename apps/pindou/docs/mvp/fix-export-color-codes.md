# Fix：导出拼豆图纸时显示 MARD 色号

> 状态：已完成  
> 影响范围：`apps/web`  
> 关联计划：[MVP1 Next.js 实施计划](./mvp1-nextjs-plan.md)

## 1. 问题

当前 Canvas 预览和 PNG 导出都只绘制拼豆色块与网格线。用户导出后只能看到颜色，无法直接得知每个格子应该使用的 MARD 色号（例如 `A7`、`B20`），不适合作为实际制作时使用的拼豆图纸。

页面预览尺寸受容器宽度限制。以 48×48 网格和 480px 预览为例，每格只有 10px，加入色号后文字难以辨认，也会干扰成品效果预览。因此，本 Fix 只在导出的 PNG 中显示色号，页面预览保持现状。

## 2. 目标

- 页面 Canvas 预览继续只显示色块和网格线，不显示色号。
- PNG 导出改为带色号的方格施工图。
- 导出时增大单格像素尺寸，保证 `A7`、`B20` 等二至三字符色号清晰可读。
- 色号直接读取现有 `palette[].code`，不修改后端量化逻辑和 API 契约。
- 透明格继续保持透明，不绘制颜色和色号。

## 3. 非目标

- 不在页面预览中增加色号或“显示色号”开关。
- 不修改 `BeadGrid`、`palette` 或 `rows[y][x]` 的数据结构。
- 不在后端生成、保存或下载 PNG。
- 不增加色纸照片、纹理或其他图片资源。
- 本 Fix 不增加色号图例、页眉、页码或分块打印能力。

## 4. 数据映射

后端响应已经包含绘制所需的全部数据：

```ts
const paletteIndex = grid.rows[y][x];

if (paletteIndex !== -1) {
  const color = grid.palette[paletteIndex];
  color.hex;  // 格子背景颜色
  color.rgb;  // 判断文字使用深色或白色
  color.code; // 绘制到格子中的 MARD 色号
}
```

渲染层不得重新排列 `palette`，也不得根据 HEX 重新推断色号。

## 5. 技术设计

### 5.1 扩展统一绘制函数

在 `apps/web/src/lib/canvas.ts` 的 `DrawOptions` 中增加 `showColorCode`：

```ts
export type DrawOptions = {
  cellSize: number;
  gridLine?: boolean;
  beadShape?: "circle" | "square";
  clear?: boolean;
  /** 是否在非透明格中央绘制 MARD 色号，默认关闭。 */
  showColorCode?: boolean;
};
```

`showColorCode` 默认值必须为 `false`，确保现有预览调用不发生视觉变化：

```ts
drawBeadGrid(context, grid, {
  cellSize: displaySize / grid.width,
  gridLine: true,
  showColorCode: false,
});
```

### 5.2 导出尺寸

带色号图纸的默认单格尺寸调整为 `36px`：

```ts
const PATTERN_EXPORT_CELL_SIZE = 36;
```

常见网格对应的 PNG 尺寸如下：

| 网格尺寸 | 导出尺寸 |
| --- | --- |
| 24×24 | 864×864px |
| 48×48 | 1728×1728px |
| 72×72 | 2592×2592px |
| 96×96 | 3456×3456px |
| 156×156 | 5616×5616px |

`36px` 能为三字符色号提供足够空间，同时不会让常用网格产生过大的文件。导出尺寸固定由网格尺寸和 `cellSize` 决定，不读取页面缩放、CSS 尺寸或 `devicePixelRatio`。

最大 156×156 网格会产生约 3154 万像素的离屏 Canvas，浏览器内部 RGBA 缓冲区约占 120MiB。导出期间 UI 需要保持 Loading 状态；若 `getContext("2d")` 或 `toBlob()` 失败，应显示“图纸尺寸过大，请降低网格尺寸后重试”，不能静默失败。

### 5.3 绘制顺序

每次绘制严格遵循以下顺序：

1. 清空目标 Canvas。
2. 遍历 `rows[y][x]` 绘制非透明格的背景色。
3. 在同一格中央绘制对应的 `palette[].code`。
4. 最后统一绘制网格线，保证格子边界完整、清晰。

透明格 `-1` 不绘制背景、色号或其他占位内容。

导出图纸固定使用 `square`，即使未来页面预览允许使用圆珠效果，也不影响施工图的方格布局。

### 5.4 色号文字样式

推荐文字参数：

- 字体大小：`Math.floor(cellSize * 0.36)`，36px 单格对应 12px 字号。
- 字重：`600`。
- 字体：等宽字体栈 `ui-monospace, SFMono-Regular, Menlo, monospace`。
- 对齐：水平、垂直居中。
- 最大宽度：`cellSize * 0.82`，避免三字符色号压住格线。
- 浅色格使用深色文字，深色格使用白色文字。

```ts
const drawColorCode = (
  context: CanvasRenderingContext2D,
  color: PaletteColor,
  x: number,
  y: number,
  cellSize: number,
) => {
  const [red, green, blue] = color.rgb;
  // 根据背景亮度选择文字颜色，保证深浅色拼豆上的色号都可读。
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;

  context.save();
  context.fillStyle = luminance > 0.58
    ? "rgba(15, 25, 54, 0.9)"
    : "rgba(255, 255, 255, 0.96)";
  context.font = `600 ${Math.floor(cellSize * 0.36)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(
    color.code,
    (x + 0.5) * cellSize,
    (y + 0.5) * cellSize,
    cellSize * 0.82,
  );
  context.restore();
};
```

第一版只做深浅文字自适应，不增加描边或阴影。若实测发现中等亮度背景的文字对比不足，再单独增加轻量描边。

### 5.5 导出接口

保留预览和导出共用 `drawBeadGrid` 的设计，只在导出调用中开启色号：

```ts
export const exportBeadGrid = (
  grid: BeadGrid,
  cellSize = PATTERN_EXPORT_CELL_SIZE,
): Promise<Blob> => {
  const canvas = document.createElement("canvas");
  canvas.width = grid.width * cellSize;
  canvas.height = grid.height * cellSize;

  const context = canvas.getContext("2d");
  if (!context) {
    return Promise.reject(new Error("当前浏览器无法创建图纸画布"));
  }

  drawBeadGrid(context, grid, {
    cellSize,
    gridLine: true,
    beadShape: "square",
    showColorCode: true,
  });

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob
        ? resolve(blob)
        : reject(new Error("图纸尺寸过大，请降低网格尺寸后重试")),
      "image/png",
    );
  });
};
```

页面现有导出按钮不需要增加新选项；点击后直接下载带色号的施工图。

## 6. 实施范围

### F1：Canvas 渲染

- [x] 为 `DrawOptions` 增加默认关闭的 `showColorCode`。
- [x] 实现内部函数 `drawColorCode()`。
- [x] 非透明格在色块绘制后按需绘制 `palette[].code`。
- [x] 保持网格线最后绘制。
- [x] 保持页面预览不显示色号。

### F2：PNG 导出

- [x] 默认导出单格尺寸由 `20px` 调整为 `36px`。
- [x] 导出固定使用方格并开启 `showColorCode`。
- [x] 保持导出尺寸与 DPR、CSS 和页面缩放无关。
- [x] 为 Canvas 创建或编码失败提供可理解的错误提示。

### F3：测试

- [x] 开启 `showColorCode` 时，每个非透明格绘制一次正确的色号。
- [x] `-1` 透明格不调用 `fillText`。
- [x] `showColorCode` 默认关闭时不调用 `fillText`。
- [x] 浅色背景使用深色文字，深色背景使用白色文字。
- [x] `fillText` 的最大宽度不超过单格宽度的 82%。
- [x] 色号绘制发生在网格线绘制之前。
- [x] 默认导出 Canvas 尺寸为 `grid.width * 36 × grid.height * 36`。
- [x] 导出 Blob 的 MIME 为 `image/png` 且内容非空。

## 7. 验收标准

- 页面预览效果与本 Fix 实施前一致，不显示任何色号。
- 导出的每个非透明方格均显示与该格 `palette[].code` 一致的 MARD 色号。
- `A7`、`B20` 等二至三字符色号在 100% 查看导出 PNG 时清晰、居中且不压住格线。
- 深色和浅色拼豆上的色号均可辨认。
- 透明格保持透明且不显示色号。
- 48×48 网格默认导出为 1728×1728px，尺寸不受设备 DPR 影响。
- 后端接口和量化结果不发生变化。

## 8. 回滚方式

如果带色号导出影响实际使用，可将导出调用的 `showColorCode` 改回 `false`，并将默认 `cellSize` 恢复为 `20`。该回滚不涉及后端接口或存量数据。
