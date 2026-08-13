# MVP1 Next.js 实施计划

> 状态：已完成  
> 设计基线：`docs/design/mvp1.png`  
> 计划目录：`apps/web`

## 目标

实现设计稿中的移动端优先图片转拼豆流程：上传图片、设置参数、展示同步转换进度、Canvas 预览结果并在浏览器导出 PNG。页面在桌面端居中展示，预览和导出复用同一套纯 Canvas 渲染函数。

## 设计稿落地约定

- 页面由品牌头部、参数设置卡片、转换状态/结果卡片组成。
- 网格快捷项按设计稿使用 `24 / 48 / 72 / 96`，均符合后端 `8..156` 约束；MVP1 暂不展示自定义尺寸入口。
- MARD 颜色组从 `/api/v1/color-sets` 动态读取，不能在前端硬编码。
- 设计稿未提供“最大颜色数”控件；MVP1 固定提交 `18`，后续增加高级参数区时再开放。
- 背景模式对应后端 `transparent / solid / keep`；纯色模式展示颜色选择器。
- “处理中”进度是同步请求的等待反馈，不伪装成服务端精确进度；请求完成后才切换为成功态。
- 结果区“使用颜色”展示实际使用颜色数与所选 MARD 色组容量，色点来自响应 `palette`。
- 设计稿中的 AI 文案改为中性的图像分析文案，因为 MVP1 使用 `PassThroughEnhancer`，不调用 AI 服务。

## N1：工程与 API Client

- [x] 创建 Next.js App Router + React + TypeScript 工程。
- [x] 配置 `/api/*` 到 FastAPI 的开发代理，浏览器只调用同源相对地址。
- [x] 定义与 OpenAPI 一致的 `ColorSetsResponse`、`ConversionResponse`。
- [x] 实现 `getColorSets()`、`createConversion()` 和稳定错误码解析。

## N2：参数设置卡片

- [x] 实现 JPG、PNG、WebP 上传、缩略图、文件名、图片尺寸与移除操作。
- [x] 在浏览器前置校验文件类型和 10 MiB 大小限制，并正确释放预览 Object URL。
- [x] 实现 `24 / 48 / 72 / 96` 网格快捷选择，默认 `48`。
- [x] 动态加载 MARD 颜色组，默认优先选择 48 色组，接口无 48 时使用 `default_size`。
- [x] 实现透明、纯色、保留原图三种背景模式和纯色色值选择。
- [x] 实现禁用、Loading 与错误提示状态。

## N3：转换状态与结果卡片

- [x] 请求期间展示处理状态、循环进度条和状态文案。
- [x] 请求成功后展示预览、网格大小、实际颜色数、总豆数和主要颜色。
- [x] 实现“重试”回到可编辑状态并保留当前图片与参数。
- [x] 页面采用移动端单列布局，并为平板/桌面提供合理的居中宽度和结果区响应式降级。

## N4：Canvas 预览与 PNG 导出

- [x] 实现纯函数 `drawBeadGrid(ctx, grid, options)`。
- [x] 坐标严格使用 `rows[y][x]`；`-1` 跳过，颜色只读取 `palette`。
- [x] 预览按 DPR 扩大 backing store，CSS 控制显示尺寸。
- [x] 独立导出 canvas，默认 `cellSize=20`，不读取页面缩放和 DPR。
- [x] 使用 `canvas.toBlob("image/png")` 下载，并及时释放 Object URL。

## N5：测试与联调

- [x] 覆盖 Canvas 尺寸、透明格、调色板索引与网格线绘制。
- [x] 覆盖上传校验、API 错误解析和 FormData 字段。
- [x] 执行 TypeScript、ESLint、单元测试和生产构建。
- [x] 与 FastAPI 联调颜色组列表及至少一次实际图片转换。

## 验收

- 页面结构、视觉层级和三种状态与 `docs/design/mvp1.png` 一致。
- 用户能上传图片，选择网格尺寸、MARD 颜色组与背景模式并完成转换。
- 切换颜色组后，每次请求显式提交 `color_set_size`，结果色号全部来自所选组。
- Canvas 预览与 PNG 导出使用同一网格和绘制逻辑，前端不请求图片下载接口。
- 重新上传、移除图片和重复导出不会遗留 Object URL 或旧结果。
