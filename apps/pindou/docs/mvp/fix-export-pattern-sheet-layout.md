# Fix：导出包含原图、色卡和图像信息的拼豆施工图

> 状态：已完成  
> 影响范围：`apps/web`  
> 前置 Fix：[导出拼豆图纸时显示 MARD 色号](./fix-export-color-codes.md)  
> 关联计划：[MVP1 Next.js 实施计划](./mvp1-nextjs-plan.md)

## 1. 问题

当前导出的 PNG 只有带 MARD 色号的拼豆网格。用户制作时还需要对照原图片、确认实际使用的色号，并查看网格尺寸、颜色数和豆子总数。若这些信息分散在页面和导出文件中，保存或打印图纸后便无法独立使用。

本 Fix 将导出结果升级为一张完整施工图：拼豆网格位于上方，原图片位于左下角，实际使用的色卡 code 和图像信息位于右下角。页面预览继续保持现状。

## 2. 目标

- 导出的 PNG 上方展示完整的带色号拼豆网格。
- 原图片按比例缩放后展示在左下信息区，不拉伸、不裁剪。
- 右下信息区先展示网格尺寸、原图尺寸、实际颜色数和总豆数。
- 图像信息下方展示本次实际使用的全部 MARD 色号和对应颜色。
- 导出仍完全发生在浏览器中，不把原图片或 Canvas 上传到后端。
- 页面预览、后端接口以及 `BeadGrid` 数据契约保持不变。

## 3. 非目标

- 不在页面结果预览中展示新的底部信息区。
- 不展示所选色卡套装中未被本次图像使用的颜色。
- 不改变颜色量化结果或 `palette` 顺序。
- 不增加 PDF、多页打印、自动分页、坐标轴或分块编号。
- 不在服务器生成或保存施工图。

## 4. 导出布局

施工图使用白色不透明背景，避免原图和说明文字在不同图片查看器中出现不可控的透明背景。整体从上到下分成主图区和底部信息区：

```text
┌──────────────────────────────────────────────────────┐
│                                                      │
│              带色号的拼豆网格                        │
│              每格 36px                               │
│                                                      │
├──────────────────────────┬───────────────────────────┤
│ 原图                     │ 图像信息                  │
│                          │ 网格 / 原图 / 颜色 / 豆数 │
│       等比 contain       │                           │
│                          │ 使用色卡                  │
│                          │ ● A7  ● B20  ● C3 ...     │
└──────────────────────────┴───────────────────────────┘
```

### 4.1 尺寸常量

沿用前置 Fix 的 `36px` 单格尺寸，并以此建立稳定的导出排版尺度：

```ts
const PATTERN_EXPORT_CELL_SIZE = 36;
const SHEET_PADDING = 36;
const SECTION_GAP = 36;
const FOOTER_COLUMN_GAP = 36;
const FOOTER_MIN_HEIGHT = 360;
const PALETTE_COLUMNS = 6;
```

布局计算：

```ts
const gridWidth = grid.width * cellSize;
const gridHeight = grid.height * cellSize;
const paletteRows = Math.ceil(grid.palette.length / PALETTE_COLUMNS);
const footerHeight = Math.max(
  FOOTER_MIN_HEIGHT,
  150 + paletteRows * 54,
);

const canvasWidth = gridWidth + SHEET_PADDING * 2;
const canvasHeight =
  SHEET_PADDING +
  gridHeight +
  SECTION_GAP +
  footerHeight +
  SHEET_PADDING;
```

主图网格保持每格 `36px`，额外尺寸只用于页边距和底部信息区。48×48 网格的主图仍为 1728×1728px；按默认常量计算，完整施工图约为 1800×2196px，最终高度会随实际色卡行数增加。

底部信息区左右等宽：

```ts
const footerContentWidth = gridWidth;
const footerColumnWidth = (footerContentWidth - FOOTER_COLUMN_GAP) / 2;
```

当网格宽度较小，右侧色卡固定 6 列可能导致内容拥挤。内部布局函数应根据列宽动态选择 3–6 列，而不是缩小文字到不可读：

```ts
const paletteColumns = footerColumnWidth >= 720 ? 6 : 3;
```

## 5. 导出模块设计

### 5.1 导出接口

当前 `exportBeadGrid(grid, cellSize)` 无法取得原图片。建议将导出模块的外部接口升级为一个参数对象：

```ts
export type SourceImageDetails = {
  width: number;
  height: number;
};

export type PatternSheetExportInput = {
  grid: BeadGrid;
  sourceFile: File;
  sourceDetails: SourceImageDetails;
  cellSize?: number;
};

export const exportPatternSheet = async (
  input: PatternSheetExportInput,
): Promise<Blob> => {
  // 图片解码、布局计算、Canvas 绘制和 PNG 编码均封装在此模块内。
};
```

页面调用方只需传入已有状态：

```ts
const blob = await exportPatternSheet({
  grid: result,
  sourceFile: file,
  sourceDetails: details,
});
```

`exportPatternSheet` 是新的导出 seam。图片解码、布局坐标、文字样式和 Canvas 编码都隐藏在模块实现中，React 页面不计算任何导出坐标。

### 5.2 文件组织

建议将职责拆分如下：

```text
apps/web/src/lib/
├── canvas.ts                 # 继续负责 drawBeadGrid
└── pattern-sheet-export.ts   # 完整施工图布局、原图解码和 PNG 导出
```

`drawBeadGrid()` 继续作为网格渲染的唯一实现。`pattern-sheet-export.ts` 在主图区域调用它，并设置 `clear: false`，避免网格绘制清空已经铺好的整页白色背景。

不建议继续把完整排版追加进 `canvas.ts`，否则网格渲染、图片生命周期和版面布局会混在同一个浅模块中。

## 6. 原图片解码与绘制

### 6.1 解码

优先使用 `createImageBitmap(sourceFile)` 解码原文件：

```ts
const sourceImage = await createImageBitmap(sourceFile, {
  imageOrientation: "from-image",
});
```

完成导出后必须在 `finally` 中调用 `sourceImage.close()` 释放位图内存。若目标浏览器不支持 `createImageBitmap`，可使用内部 `HTMLImageElement` adapter：为 `File` 创建临时 Object URL，等待 `load`，绘制完成后立即 `URL.revokeObjectURL()`。

两个 adapter 都应满足内部的 `CanvasImageSource` 解码 seam，不能把兼容逻辑散落到 React 页面。

解码失败时导出整体失败，并显示“无法读取原图片，请重新选择图片后重试”。不应静默省略左下原图，以免用户误以为导出内容完整。

### 6.2 contain 规则

左下原图区使用 `contain`，完整保留原图：

```ts
const scale = Math.min(
  targetWidth / sourceWidth,
  targetHeight / sourceHeight,
);
const drawWidth = sourceWidth * scale;
const drawHeight = sourceHeight * scale;
const drawX = targetX + (targetWidth - drawWidth) / 2;
const drawY = targetY + (targetHeight - drawHeight) / 2;

context.drawImage(sourceImage, drawX, drawY, drawWidth, drawHeight);
```

原图区域要求：

- 保持原始宽高比，不变形。
- 不裁剪主体，不使用 `cover`。
- 剩余区域使用浅灰背景 `#F5F6FA`。
- 原图外框使用 1–2px 中性灰描边。
- 区域顶部绘制标题“原图”。

## 7. 右下图像信息和色卡

右栏按从上到下的固定信息层级排版：先展示图像信息摘要，再展示实际使用的色卡。图像信息高度固定，色卡区域使用剩余空间并根据行数扩展整个底部信息区。

### 7.1 图像信息

图像信息位于右栏顶部，至少展示：

| 字段 | 数据来源 | 示例 |
| --- | --- | --- |
| 网格尺寸 | `grid.width × grid.height` | `48 × 48` |
| 原图尺寸 | `sourceDetails.width × sourceDetails.height` | `1920 × 1080` |
| 使用颜色 | `grid.palette.length` | `18` |
| 总豆数 | `rows` 中非 `-1` 的数量 | `2,176` |
| 色卡品牌 | `grid.meta.palette_brand` | `MARD` |
| 色卡套装 | `grid.meta.color_set_size` | `48 色` |

总豆数应在导出模块通过纯函数计算，避免依赖 React 页面中的 `useMemo`：

```ts
const occupiedBeads = grid.rows.reduce(
  (total, row) => total + row.filter((index) => index !== -1).length,
  0,
);
```

文字使用深色 `#0F1936`，说明标签使用次要色 `#667085`。信息区不依赖系统中文字体的精确字宽做关键定位，应采用固定行高和左右列坐标，避免不同操作系统字体导致重叠。

图像信息与下方色卡之间保留固定的区块间距，例如 `32px`，形成明确的信息层级。

### 7.2 色卡内容

只展示 `grid.palette` 中实际使用的颜色，并保持数组原顺序。每项由色块和 code 组成：

```text
● A7    ● B20    ● C3
```

建议样式：

- 色块尺寸：32×32px。
- 色块边框：`rgba(15, 25, 54, 0.18)`，保证白色和浅色可见。
- code 字体：18px、600、等宽字体。
- 色卡标题：`使用色卡（18）`，括号内为 `grid.palette.length`。
- 每个色号必须完整显示，禁止使用省略号或只显示前 N 项。

色卡列表由布局函数根据右栏宽度计算列数和行数；若未来实际颜色数超过当前 18 色限制，底部高度随色卡行数向下增长，不得挤压或覆盖上方图像信息。

## 8. 绘制流程

`exportPatternSheet()` 按以下顺序执行：

1. 校验 `grid`、`sourceFile` 和 `sourceDetails`。
2. 解码原图片。
3. 计算主图、底部左右栏、色卡行数和最终 Canvas 尺寸。
4. 创建离屏 Canvas，并铺满白色背景。
5. 调用 `drawBeadGrid()` 绘制上方网格，开启 `showColorCode`。
6. 绘制左下原图面板和等比缩放后的原图片。
7. 绘制右下图像信息。
8. 在图像信息下方绘制实际色卡列表。
9. 使用 `canvas.toBlob(..., "image/png")` 编码。
10. 在 `finally` 中释放 `ImageBitmap` 或临时 Object URL。

主图调用示例：

```ts
drawBeadGrid(context, grid, {
  cellSize,
  gridLine: true,
  beadShape: "square",
  showColorCode: true,
  clear: false,
});
```

因为主图需要页边距，绘制前可通过 `context.save()` 和 `context.translate(SHEET_PADDING, SHEET_PADDING)` 设置局部原点，绘制后再 `restore()`。不要为 `drawBeadGrid` 增加 `offsetX/offsetY`，避免扩大其 interface。

## 9. 页面接入

下载流程需要确保原文件和尺寸仍然有效：

```ts
if (!result || !file || !details || isExporting) return;

const blob = await exportPatternSheet({
  grid: result,
  sourceFile: file,
  sourceDetails: details,
});
```

现有文件替换流程已经会清空旧 `result`，可以保证网格与原图片属于同一次转换。导出按钮在缺少 `file` 或 `details` 时禁用，并沿用“正在导出…”状态防止重复触发大尺寸 Canvas。

建议下载文件名保留现有网格信息：

```ts
link.download = `pindou-pattern-${grid.width}x${grid.height}.png`;
```

## 10. 内存和兼容性

- 48×48 默认完整图纸约 1800×2196px，Canvas RGBA 缓冲区约 15MiB。
- 96×96 完整图纸约 3528×3948px，缓冲区约 53MiB。
- 156×156 完整图纸超过 5700px 宽，主 Canvas 与解码后的原图可能同时占用较多内存。
- 导出期间只能保留一个主 Canvas 和一个解码后的原图，不创建主图、原图、色卡三个全尺寸临时 Canvas。
- `toBlob()` 返回后及时解除对 Canvas、context 和图片对象的引用。
- Canvas 创建、图片解码或 PNG 编码失败时，统一提示“图纸尺寸过大或图片解码失败，请降低网格尺寸后重试”。

本 Fix 使用用户本地 `File` 解码，不加载跨域图片，因此不会污染 Canvas，也不会阻止 `toBlob()`。

## 11. 实施范围

### F1：导出布局模块

- [x] 新建 `pattern-sheet-export.ts` 和参数类型。
- [x] 实现纯函数 `calculatePatternSheetLayout()`。
- [x] 实现白色画布、页边距、主图和底部双栏布局。
- [x] 复用 `drawBeadGrid()` 绘制带色号主图。

### F2：原图和信息区

- [x] 实现原图异步解码及资源释放。
- [x] 实现左下原图 `contain` 绘制。
- [x] 实现右下顶部的图像信息和总豆数计算。
- [x] 在图像信息下方实现完整色卡 code 列表。
- [x] 色卡行数增加时向下动态扩展底部高度，不挤压图像信息。

### F3：页面接入

- [x] 下载时传入 `result`、`file` 和 `details`。
- [x] 原图或尺寸缺失时禁用导出。
- [x] 保持“正在导出…”状态和错误提示。
- [x] 下载文件名改为 `pindou-pattern-NxN.png`。

### F4：测试

- [x] 布局纯函数返回稳定的 Canvas、主图和左右栏坐标。
- [x] 主图仍以 `36px` 单格绘制色块、code 和网格线。
- [x] 原图片按 `contain` 规则居中，横图和竖图均不变形、不裁剪。
- [x] 实际使用的每个 `palette[].code` 都绘制在色卡区。
- [x] 图像信息的网格、原图、颜色、豆数、品牌和套装值正确。
- [x] 色卡从图像信息下方开始绘制，两区保持固定间距。
- [x] 色卡数量超过单行容量时正确换行并向下增加底部高度。
- [x] 透明格不计入总豆数。
- [x] PNG MIME 为 `image/png` 且 Blob 非空。
- [x] 解码成功和编码失败路径都正确释放图片资源。

## 12. 验收标准

- 页面预览与本 Fix 实施前一致。
- 导出的拼豆网格位于图片上方，每个非透明格继续清晰显示正确色号。
- 原图片完整、等比地展示在左下角，没有拉伸或裁剪。
- 右下角顶部展示正确的网格尺寸、原图尺寸、使用颜色数、总豆数、品牌和套装。
- 图像信息下方完整展示本次实际使用的全部色卡 code 及对应色块。
- 底部内容不覆盖、不溢出，三字符 code 清晰可读。
- 导出尺寸不依赖页面 CSS、浏览器缩放或设备 DPR。
- 原图片、网格结果和信息数据来自同一次转换。
- 后端接口及量化结果不发生变化。

## 13. 回滚方式

页面下载调用可以从 `exportPatternSheet()` 切回现有 `exportBeadGrid()`，恢复只导出网格的行为。由于本 Fix 不修改后端接口和 `BeadGrid`，回滚不会影响转换结果或存量数据。
