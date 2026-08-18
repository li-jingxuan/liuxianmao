# Web 图片裁剪功能落地方案

> 状态：待实施  
> 适用范围：`apps/web` 图片转换页面  
> 目标：在图片提交转换前增加简单的本地裁剪能力，不修改现有 API 契约。

## 1. 背景与目标

当前 `apps/web/src/components/pindou-converter.tsx` 在选择图片后直接将文件提交给 `createConversion()`。后端会把图片按原比例放入方形网格，非方形图片会产生补边。

本次增加客户端裁剪，目标是：

- 用户可以在上传后调整图片主体范围。
- 默认使用 `1:1` 方形裁剪，适配当前方形拼豆网格。
- 裁剪发生在浏览器本地，未选中的图片区域不上传到后端。
- 裁剪后的文件继续复用现有校验、转换和导出流程。
- 不改变 `POST /api/v1/conversions` 的请求字段和后端处理逻辑。

本期不做自由比例、服务端裁剪、历史裁剪记录和图片编辑滤镜。

## 2. 技术选型

安装依赖：

```bash
cd apps/web
pnpm add react-easy-crop browser-image-compression
```

| 能力 | 选型 | 用途 |
| --- | --- | --- |
| 裁剪交互 | `react-easy-crop` | 提供拖动、触控、缩放、旋转和裁剪区域回调 |
| 文件体积兜底 | `browser-image-compression` | 裁剪结果超过限制时，在浏览器端压缩和限制最大边长 |
| 裁剪结果导出 | Canvas Adapter | 将第三方组件返回的像素区域转换为 `File` |

`react-easy-crop` 负责交互，不在项目内重复实现拖拽、触控和裁剪框。Canvas 只承担浏览器原生的最后一步像素导出，这是第三方裁剪 UI 没有覆盖的适配工作。

依赖版本由 `pnpm-lock.yaml` 锁定，不在业务代码中使用浮动版本。

## 3. 用户交互流程

```text
选择文件
  ↓
复用 validateImage() 校验
  ↓
打开裁剪弹窗（默认 1:1）
  ├─ 取消：放弃本次新文件，保留原有选择
  ├─ 跳过裁剪：直接使用原文件
  └─ 确认裁剪：生成新的 File 并替换当前上传文件
           ↓
       预览尺寸重新读取
           ↓
       开始转换
```

裁剪弹窗建议提供：

- 方形裁剪框。
- 鼠标和触控拖动。
- `1x–3x` 缩放滑块。
- 可选的 `-90° / +90°` 旋转按钮。
- “取消”“跳过裁剪”“确认裁剪”三个操作。

重新裁剪必须基于原始文件，不能基于上一次生成的裁剪文件，避免多次有损编码。

## 4. 模块设计

新增文件：

```text
apps/web/src/components/image-crop-modal.tsx
apps/web/src/components/image-crop-modal.module.scss
apps/web/src/lib/image-crop.ts
apps/web/tests/image-crop.test.ts
```

现有文件调整：

```text
apps/web/src/components/pindou-converter.tsx
apps/web/src/components/pindou-converter.module.scss
```

### 4.1 裁剪模块接口

页面组件只依赖一个小接口，隐藏 Canvas、Blob、EXIF 和压缩细节：

```ts
// src/lib/image-crop.ts
import type { Area } from "react-easy-crop";

export type CropImageOptions = {
  mimeType?: string;
  quality?: number;
  maxSizeMB?: number;
  maxWidthOrHeight?: number;
};

/** 将裁剪区域转换为可直接提交给后端的 File。 */
export function cropImageToFile(
  sourceFile: File,
  area: Area,
  options?: CropImageOptions,
): Promise<File>;
```

这个接口是裁剪模块的 seam。页面不需要知道第三方裁剪组件如何计算区域，也不需要知道最终使用 Canvas 还是其他图像处理实现。

### 4.2 裁剪弹窗接口

```ts
type ImageCropModalProps = {
  imageUrl: string;
  onConfirm: (area: Area) => Promise<void>;
  onSkip: () => void;
  onCancel: () => void;
};
```

组件内部使用 `react-easy-crop`：

```tsx
const Cropper = dynamic(() => import("react-easy-crop"), {
  ssr: false,
});

<Cropper
  image={imageUrl}
  crop={crop}
  zoom={zoom}
  rotation={rotation}
  aspect={1}
  objectFit="contain"
  onCropChange={setCrop}
  onZoomChange={setZoom}
  onRotationChange={setRotation}
  onCropComplete={(_, croppedAreaPixels) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }}
/>
```

裁剪舞台的父元素必须设置 `position: relative` 和明确高度，否则裁剪组件无法正确计算显示区域。

## 5. `PindouConverter` 状态改造

建议将“原始文件”和“实际提交文件”分开保存：

```ts
const [originalFile, setOriginalFile] = useState<File | null>(null);
const [file, setFile] = useState<File | null>(null);
const [cropSourceUrl, setCropSourceUrl] = useState<string | null>(null);
const [isCropOpen, setIsCropOpen] = useState(false);
```

状态职责：

- `originalFile`：本次选择的原始文件，重新裁剪时使用。
- `file`：当前真正提交给 `createConversion()` 和 `exportPatternSheet()` 的文件。
- `cropSourceUrl`：仅供裁剪弹窗展示的 Object URL。
- `isCropOpen`：控制裁剪弹窗显示。

选择文件时不立即替换 `file`，而是先校验并打开弹窗：

```ts
const handleFileSelected = (nextFile: File) => {
  const validationError = validateImage(nextFile);
  if (validationError) {
    setError(validationError);
    return;
  }

  const url = URL.createObjectURL(nextFile);
  setOriginalFile(nextFile);
  setCropSourceUrl(url);
  setIsCropOpen(true);
};
```

确认裁剪时生成新文件，再复用现有的预览替换逻辑：

```ts
const handleCropConfirm = async (area: Area) => {
  if (!originalFile) return;

  const croppedFile = await cropImageToFile(originalFile, area, {
    mimeType: originalFile.type,
    quality: 0.92,
    maxSizeMB: 10,
    maxWidthOrHeight: 4096,
  });

  setFile(croppedFile);
  setIsCropOpen(false);
  await replacePreviewWithFile(croppedFile);
};
```

`convert()` 无需改变请求结构：

```ts
await createConversion({
  image: file,
  gridSize,
  colorSetSize,
  backgroundMode,
  backgroundColor,
});
```

现有导出逻辑中的 `sourceFile: file` 也继续成立，因为 `file` 已经是裁剪后的文件。

## 6. 图片处理细节

### 6.1 EXIF 方向

手机照片可能包含 EXIF Orientation。裁剪适配器优先使用：

```ts
const bitmap = await createImageBitmap(sourceFile, {
  imageOrientation: "from-image",
});
```

`createImageBitmap` 不可用或不支持当前格式时，回退到项目现有的 `<img>` 解码路径。裁剪区域和 Canvas 解码必须采用同一方向，否则会出现裁剪框与最终图片错位。

### 6.2 输出格式

- PNG 保留 `image/png`，避免透明区域丢失。
- JPEG 保留 `image/jpeg`，质量建议 `0.90–0.92`。
- WebP 保留 `image/webp`。

裁剪后的文件名使用原文件名加 `-cropped` 后缀，扩展名与输出 MIME 保持一致。

### 6.3 体积和像素限制

后端当前限制文件大小为 10 MiB、像素总数为 25,000,000。前端处理策略：

- 未裁剪时不重新编码，避免不必要的质量损失。
- 只在确认裁剪时生成 Blob。
- 裁剪结果超过 10 MiB 时调用 `browser-image-compression`。
- 最大边长建议先限制为 4096，避免移动端 Canvas 内存过高。
- 压缩后仍需再次调用 `validateImage()`。

### 6.4 Object URL 生命周期

以下场景必须调用 `URL.revokeObjectURL()`：

- 选择新文件并替换旧预览。
- 关闭裁剪弹窗并放弃新文件。
- 裁剪完成后释放裁剪源 URL。
- 组件卸载。

不要在 React state 中保存 Base64 图片，避免内存和渲染开销。

## 7. 测试计划

### 单元测试

在 `apps/web/tests/image-crop.test.ts` 覆盖：

- `Area` 被正确转换为 Canvas 绘制区域。
- Canvas 输出 Blob 为空时返回明确错误。
- 输出文件名和 MIME 扩展名正确。
- PNG、JPEG、WebP 的输出格式正确。
- `createImageBitmap` 不可用时走 fallback。
- 大文件经过压缩后仍满足 10 MiB 限制。

Canvas、`createImageBitmap` 和 `toBlob` 在 Vitest/jsdom 中使用 mock，不依赖真实浏览器图形环境。

### 组件测试

- 选择合法图片后打开裁剪弹窗。
- 非法类型和超大文件不会打开弹窗。
- 点击取消不会覆盖当前文件。
- 点击跳过裁剪直接使用原始文件。
- 点击确认后 `createConversion()` 收到新的裁剪文件。
- 重新裁剪使用原始文件，而不是上一次裁剪文件。

### 手工验收

- Chrome、Safari、移动端 Safari、Android Chrome。
- 横向、纵向和带 EXIF 方向的手机照片。
- 透明 PNG。
- 10 MiB 附近的大图。
- 连续选择同一文件。
- 取消裁剪、重新裁剪、移除图片和重复转换。

## 8. 实施顺序

1. 安装依赖并锁定版本。
2. 实现 `image-crop.ts`，先完成 `Area -> File` 和 Blob/URL 清理。
3. 实现 `ImageCropModal` 及其样式。
4. 改造 `PindouConverter` 的文件状态和预览流程。
5. 接入裁剪后大小兜底压缩。
6. 增加单元测试和组件测试。
7. 执行 `pnpm lint`、`pnpm test`、`pnpm build`，再做移动端手工验收。

## 9. 验收标准

- 用户上传图片后可以完成方形裁剪。
- 未选中的图片区域不会提交到后端。
- 转换接口、后端参数和结果结构保持兼容。
- 裁剪后的预览尺寸、转换结果和导出图纸使用同一份文件。
- PNG 透明度和手机照片方向正确。
- 取消、重选、重裁剪和卸载不会造成 Object URL 泄漏。
- 现有上传校验、转换错误提示和下载功能不回归。
