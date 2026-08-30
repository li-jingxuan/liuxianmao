# Seedream 5.0 Pro 透明主体处理技术方案

> 状态：已实施  
> 目标版本：MVP2 量化增强版  
> 方案日期：2026-08-29  
> 适用范围：`apps/api`，兼容现有 `apps/web` 转换接口  
> 实施结果：已完成代码实现与 API 全量回归测试

## 1. 可行性结论

可行。本方案仅面向中国区 Ark，Solid 纯色背景模式使用 Seedream 5.0 Pro 图生图能力生成透明背景 PNG；不请求、不解析也不合成图层。

主路径如下：

    上传图片
      -> 转为 PNG RGBA，并将左上角 1 个像素设为透明
      -> Ark SDK 调用 Seedream 5.0 Pro（background=transparent）
      -> 解码单张透明 PNG
      -> 现有量化网格构建

本阶段默认信任模型返回透明背景，不做 Alpha 覆盖率、边缘连通性或主体完整性质量判定。ONNX 保留为“Ark 已成功返回、但其结果无法作为透明 PNG 使用”时的本地兜底；Ark 模型调用失败则直接向前端返回错误，绝不静默改走 ONNX。

Ark SDK 成功返回图片后立即将原始响应保存到配置的 `images/`（默认 `apps/api/src/pindou/assets/images`）目录；后续解码、量化或 ONNX 失败不影响该原始产物留存。Ark 请求本身报错时不保存。

Ark 调用失败会写入 `ark_upstream_failure` 结构化事件日志，包含上游状态码、错误码、上游 request id、截断后的错误说明、模型及本次转换参数；同时保留 API 层的请求级错误日志。日志不包含 Prompt、图片内容或密钥。

Keep 和 simplify 不调用本方案的透明主体处理，保持现有背景语义。

## 2. 约束与边界

### 2.1 中国区限定

- 只使用中国区 Ark Base URL、凭证与模型配置；不支持国际区，也不保留国际区模型 ID、路由或回退逻辑。
- 默认模型配置为 `doubao-seedream-5-0-pro-260628`。部署前须在实际中国区 Ark 账号或 Endpoint 中进行一次真实调用验证；若账号实际授权的完整模型 ID 不同，仅替换中国区配置值，不得改用国际区模型。
- 生产环境也可使用绑定该模型的中国区 `ep-...` Endpoint ID。

### 2.2 不处理图层

- 不发送 `layer_decomposition`，不引入图层 DTO、`z_index`、`bounding_box` 或图层合成器。
- 默认模型响应是一张带透明通道的 PNG。客户端只接受一张生成图，收到空响应、多图响应或不可解码的响应均视为结果异常。
- 不新增“图层分离”对外元数据，避免 Web 为并不存在的图层能力增加兼容逻辑。

### 2.3 Ark 失败语义

以下情况属于 Ark 调用失败，后端统一转换为既有 AI 上游错误（如 `AI_UPSTREAM_ERROR`）并直接返回前端：鉴权、限流、超时、网络错误、内容安全拒绝、5xx、Ark 返回业务错误或无生成结果。

此类错误不触发 ONNX，不重试为其他模型，也不静默降级为当前 5.0、Lite 或键色方案。前端沿用现有错误提示和重试交互。

## 3. 上传图片预处理

`background="transparent"` 的图生图输入需要 Alpha 通道。为让任意上传格式满足该要求，在调用 Ark 前执行唯一且确定的预处理：

1. 使用 Pillow 解码上传文件并处理 EXIF 方向；
2. 转换为 `RGBA`，保留其余全部像素；
3. 将左上角坐标 `(0, 0)` 设为透明像素：Alpha 固定为 `0`；建议同时将 RGB 设为 `0, 0, 0`，避免透明像素的隐藏颜色被下游工具错误利用；
4. 以 PNG 编码为数据 URL 或 Ark SDK 所需的图片输入字段。

该处理只改变一个像素，不承担抠图，也不尝试验证该像素是否属于主体。尺寸为零、解码失败、像素/文件超限等既有输入安全校验继续生效。

## 4. Ark SDK 调用设计

生产代码使用官方 Ark SDK，不调用 Ark CLI，也不使用 HTTP 请求拼装。以下 JSON 仅说明目标请求语义；图片 URL 是示例，实际传入的是预处理后的 PNG：

```json
{
  "model": "doubao-seedream-5-0-pro-260628",
  "prompt": "",
  "image": "https://example.invalid/input.png",
  "size": "2K",
  "output_format": "png",
  "watermark": false,
  "background": "transparent"
}
```

SDK 调用目标形态：

```python
response = ark.images.generate(
    model=settings.ark_doubao_model,
    prompt=prompt,
    image=preprocessed_png_data_url,
    size="2K",
    response_format="b64_json",
    output_format="png",
    watermark=False,
    extra_body={"background": "transparent"},
)
```

`background` 若已被项目锁定的 Ark SDK 版本正式类型化，则改为对应具名参数；否则仅通过 SDK 的 `extra_body` 透传该字段，禁止绕过 SDK 改用自行维护的 HTTP 客户端。实现前以当前 SDK 类型和中国区真实调用为准核对字段名称。

不发送 `layer_decomposition`、`stream` 或 `sequential_image_generation`。响应格式固定为 `b64_json` 和 PNG，避免下载临时 URL 造成额外的网络失败面。

## 5. 结果处理与 ONNX 兜底

### 5.1 正常路径

Ark 成功后，`SeedreamClient` 仅提取唯一的 `b64_json` 图片，严格 Base64 解码并使用 Pillow 校验：

- 文件可解码；
- 实际格式为 PNG；
- 容器支持 Alpha，且转换为 RGBA 成功；
- 图片和响应累计字节数、像素数均未超过应用上限。

校验通过即将模型图片直接交给 `ForegroundPreparer` 和现有网格量化流程。这里的“默认透明”是不做透明质量评分，不是放弃格式、资源和可用性安全校验。

### 5.2 ONNX 的适用条件

ONNX 仅在以下全部条件满足时启用：

1. Ark 已成功完成生成调用，且返回了候选图片；
2. 候选图片因 PNG/Alpha 容器、Base64 解码或像素可用性校验失败，不能安全进入量化；
3. 本地 ONNX 模型已配置且加载成功。

兜底输入为第 3 节生成的预处理 PNG（而不是不可信的 Ark 原始字节）。ONNX 输出仍经过现有 PNG、RGBA、尺寸和资源校验；ONNX 不可用或兜底失败时，向前端返回 `AI_BACKGROUND_SEPARATION_FAILED`。

不因“透明区域比例低”“边缘不连通”“全透明”“全不透明”而触发 ONNX。它们属于本版本明确不判定的模型质量问题。

### 5.3 失败决策表

| 场景 | 处理 | 前端结果 |
| --- | --- | --- |
| Ark 请求、模型或网络失败 | 不调用 ONNX | `AI_UPSTREAM_ERROR`（或现有等价错误） |
| Ark 成功且返回可用 RGBA PNG | 直接量化 | 成功 |
| Ark 成功但响应图片不可安全使用 | 尝试 ONNX | ONNX 成功则继续；失败为 `AI_BACKGROUND_SEPARATION_FAILED` |
| 上传图片预处理失败 | 不调用 Ark/ONNX | 既有输入图片错误 |

## 6. 目标调用链

    POST /api/v1/conversions（background_mode=solid）
      -> ForegroundPreparer：上传图解码、RGBA 化、左上角像素透明化
      -> SeedreamEnhancer
      -> SeedreamClient
      -> Ark.images.generate(background="transparent")
      -> 单张透明 PNG 校验与解码
      -> 成功：使用 Ark 图；结果异常：ONNX 处理预处理图
      -> build_bead_grid
      -> 现有 foreground.rows + background 响应

路由不感知 Ark 参数或 ONNX 决策。Ark 调用、响应归一化及错误映射集中于 Seedream 模块；`ForegroundPreparer` 负责图片预处理和量化前图片选择。

## 7. 对外契约

`POST /api/v1/conversions` 的 multipart 请求字段与 JSON 响应形状不变。

- Solid 模式下透明区域继续转换为 `foreground.rows` 中的 `null`；
- `background` 继续是独立的 Solid 渲染层，不进入前景 palette、颜色数或豆数；
- 不公开 Ark 原图、图层或 ONNX 处理细节；
- 可在现有 `meta.enhancer` 中保持 `seedream-5-pro`，`meta.background_processing` 使用 `transparent_background`，Web 仅同步该字面量；无需提升 `schema_version`。

## 8. 代码变更范围

| 文件 | 变更 |
| --- | --- |
| `apps/api/src/pindou/core/config.py` | 只保留中国区 Pro 模型/Endpoint 配置与现有资源上限 |
| `apps/api/src/pindou/api/dependencies.py` | 构造长生命周期 Ark SDK 客户端 |
| `apps/api/src/pindou/services/seedream_client.py` | 通过 Ark SDK 请求透明背景、解析唯一 PNG，并映射 Ark 上游错误 |
| `apps/api/src/pindou/services/seedream_enhancer.py` | 编排单图结果；只对成功响应的不可用结果调用 ONNX 兜底 |
| `apps/api/src/pindou/imaging/foreground.py` | 实现 RGBA/左上角透明像素预处理，保留 ONNX 适配入口 |
| `apps/api/src/pindou/services/seedream_prompt.py` | 更新为透明背景主体保留 Prompt，不再要求图层分离 |
| `apps/api/src/pindou/schemas/conversion.py` | 同步 `transparent_background` 元数据枚举（如现有枚举受限） |
| `apps/web/src/lib/types.ts` | 同步元数据字面量（如现有联合类型受限） |
| `apps/api/.env.example`、`deploy/.env.example`、`apps/api/README.md` | 说明中国区模型、透明背景和 ONNX 兜底边界 |
| `apps/api/tests/test_seedream.py`、`test_foreground.py`、`test_api.py` | 覆盖请求、单像素预处理、错误语义和 ONNX 兜底 |

实施时删除或不引入本文件旧版设想的图层 DTO、bbox、`z_index`、合成器和图层数量配置；不覆盖已有 ONNX、图片备份、事件日志和 Solid 独立渲染层的无关改动。

## 9. 测试方案

### 9.1 图片预处理

- JPEG、RGB PNG、RGBA PNG 都生成可解码的 RGBA PNG；
- 输出 `(0, 0)` 像素为 `(0, 0, 0, 0)`；其余像素保持转换后的预期值；
- EXIF 方向、空文件、损坏文件、超大文件与超大像素图遵守既有错误语义。

### 9.2 Ark SDK Adapter

- 仅使用中国区配置的模型或 Endpoint；
- 请求包含 `output_format="png"`、`watermark=False` 与 `background="transparent"`；
- 不发送 `layer_decomposition`；
- 正确解析唯一 `b64_json` PNG；
- Ark 鉴权、超时、限流、内容安全、5xx、空响应和多图响应直接映射上游错误，且断言 ONNX 未被调用。

### 9.3 ONNX 与 API 回归

- Ark 成功且图片可用时 ONNX 不被调用；
- Ark 成功但图片损坏、非 PNG 或无法转换 RGBA 时使用预处理图调用 ONNX；
- ONNX 成功可继续生成网格；ONNX 失败返回 `AI_BACKGROUND_SEPARATION_FAILED`；
- Solid 透明格仍为 `foreground.rows` 的 `null`，背景不计入颜色数和豆数；
- Keep/Simplify 保持现有背景语义；Web 预览、Canvas 与导出测试通过。

### 9.4 真实 Ark 门禁

真实调用会产生费用，不进入默认 CI。发布前在中国区账号/Endpoint 使用非敏感测试图确认：

1. `doubao-seedream-5-0-pro-260628` 或已配置 Endpoint 可用；
2. 预处理后的 PNG 可被接受；
3. `background="transparent"` 返回单张 PNG；
4. 返回图片能转为 RGBA 并进入量化；
5. Ark 调用失败时前端收到可识别错误，未发生 ONNX 降级。

## 10. 验收标准

1. 生产路径仅使用中国区 Ark 配置，默认模型为 `doubao-seedream-5-0-pro-260628`。
2. 每个送往 Ark 的输入图片均为 PNG RGBA，左上角一个像素为完全透明。
3. Solid 请求通过 Ark SDK 传入 `background="transparent"`、`output_format="png"` 和 `watermark=false`，不使用图层分离。
4. Ark 成功且图片可用时直接使用其输出，不进行 Alpha 质量判定。
5. ONNX 仅处理 Ark 成功响应后的图片可用性异常；Ark 模型或请求失败直接返回前端错误。
6. 公开请求契约、网格 Schema、Solid 渲染层和统计语义不变。
7. API 与 Web 回归测试通过，且中国区真实 Ark 门禁通过后才发布。

## 11. 发布与回滚

1. 先合入预处理、Ark SDK Adapter、错误映射和 Fake Ark/ONNX 测试，CI 不使用真实 Key。
2. 在测试环境完成中国区真实 Ark 门禁，记录实际模型或 Endpoint 配置。
3. 小流量发布，观测 Ark 成功率、P50/P95、`AI_UPSTREAM_ERROR`、ONNX 兜底次数及 `AI_BACKGROUND_SEPARATION_FAILED`。
4. 出现上游异常时向用户展示前端既有错误，不在运行时改用其他模型或图层方案。
5. 回滚使用上一版本容器镜像；保留 ONNX 代码一个发布周期，以便保留本方案定义的成功响应兜底能力。

## 12. 评审确认点

请确认：

1. 左上角像素透明化采用 `(0, 0, 0, 0)`，并以预处理后的 PNG 作为 Ark 与 ONNX 的统一输入。
2. ONNX 的兜底范围仅限 Ark 成功后返回图片不可用；Ark 调用失败一律直接报错给前端。
3. `meta.background_processing` 使用 `transparent_background`；若现有元数据不需要暴露处理方式，可不新增该字段值。

确认后按本文档实施。
