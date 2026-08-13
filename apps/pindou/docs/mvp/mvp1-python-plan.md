# MVP1 Python / FastAPI 实施计划

> 状态：实施中  
> 预计：1.5–2.5 人日  
> 工程目录：`apps/api`

## 目标

实现无状态同步 API：接收图片及量化参数，使用用户选择的 MARD 累计颜色组生成 N×N 拼豆网格 JSON。MVP1 不调用 AI、不生成 PNG、不保存图片。

## API

### `GET /healthz`

返回服务健康状态。

### `GET /api/v1/color-sets`

从 `docs/MARD_色卡.json` 的 `sets[]` 返回 24–264 共 11 个累计颜色组和默认组。列表、数量和 schema 版本不能硬编码成另一份数据。

### `POST /api/v1/conversions`

`multipart/form-data`：

```text
image: JPG | PNG | WebP, <= 10 MiB
grid_size: integer, 8..156
max_colors: integer, 8..24
color_set_size: one of color-sets[].size
background_mode: keep | transparent | solid
background_color: #RRGGBB when solid
```

返回 `schema_version`、`algorithm_version`、`width/height`、带 MARD 色号的 `palette`、`rows` 和 `meta`。

## 实施阶段

### P1：工程与公共契约

- [x] 建立 src-layout、`pyproject.toml` 和 FastAPI 入口。
- [x] 定义 Pydantic 响应模型和背景枚举。
- [x] 增加 request ID 与统一业务错误结构。
- [x] 增加健康检查。

### P2：色卡与颜色距离

- [x] 加载并校验 MARD 色卡 schema、色号、RGB/Lab。
- [x] 校验每个累计组恰好包含 `size` 个唯一已知色号。
- [x] 实现 sRGB → Lab。
- [x] 实现 CIEDE2000 和已知参考值测试。
- [x] 按 `color_set_size` 形成严格白名单。

### P3：图像与量化

- [x] JPG/PNG/WebP 解码、EXIF 转置、体积和像素限制。
- [x] `contain + 居中补边` 生成 N×N RGBA 工作图。
- [x] Alpha 阈值与 `-1` 透明格。
- [x] Median Cut 提取不超过 `max_colors` 个代表色，关闭抖动。
- [x] 只在所选组内执行 CIEDE2000 最近色匹配。
- [x] 合并重复色号并生成稳定 `palette + rows`。

### P4：HTTP 路由

- [x] `ImageEnhancer` 与默认 `PassThroughEnhancer`。
- [x] 颜色组列表接口。
- [x] multipart 转换接口及参数校验。
- [x] Pydantic 响应过滤，不返回图片、URL 或路径。
- [x] 请求结束释放 Pillow 图像。

### P5：验证与交付

- [x] 安装依赖并运行 Ruff。
- [x] 运行 pytest。
- [x] 修复静态检查和测试发现的问题。
- [x] 补充 API README、环境变量示例和 curl 示例。
- [ ] 用 52/78/104 与 24/48/264 组合做一次人工抽查。

## 必须通过的断言

- `width === height === grid_size`。
- `rows` 高宽正确，单元只可能是 `-1` 或合法调色板索引。
- `palette.length <= max_colors`。
- 所有 `palette[].code` 都存在于所选 `sets[size].colors`。
- 组外颜色即使距离更近也不会被选中。
- 相同输入和参数返回相同 `palette + rows`。
- 非法组返回 `COLOR_SET_INVALID`，非法网格返回 `GRID_SIZE_INVALID`。
- 成功与失败路径均不持久化上传图或结果图。

## 后续 Seedream 缝隙

未来只新增 `SeedreamEnhancer` 并通过依赖注入替换；不得修改量化核心、MARD 白名单约束或公开网格契约。
