# Seedream 图像生成 / 编辑 API 官方资料核对

> 核对日期：2026-08-13  
> 范围：仅引用火山引擎、火山方舟、BytePlus ModelArk 官方文档和官方 API 文档。本文只记录 API 接入事实，不展开系统架构设计。

## 1. 结论摘要

1. **本项目若部署在中国大陆，优先接火山方舟中国区**：数据面地址为 `https://ark.cn-beijing.volces.com/api/v3`，图片接口为 `POST /images/generations`，使用 `Authorization: Bearer $ARK_API_KEY`。火山方舟官方入门示例确认了中国区 Base URL 和 Bearer API Key 的使用方式；图片 API 官方页面确认了请求路径和参数结构。[火山方舟产品简介](https://www.volcengine.com/docs/82379/1795150) · [图片生成 API](https://api.volcengine.com/api-docs/view?action=ImageGenerations&serviceCode=ark&version=2024-01-01)
2. **上传图片后按提示词重绘/编辑是 Seedream 的原生能力**。中国区官方提示词指南明确写明 Seedream 5.0 lite、4.5、4.0 支持文生图、图片编辑、参考图生图、多图输入和组图生成，并支持用文本对画面做增加、删除、替换、修改。[Seedream 4.0–5.0 提示词指南](https://www.volcengine.com/docs/82379/1829186)
3. **当前中国区首选模型系列是 Seedream 5.0 lite**。火山方舟官网当前列出的图片模型包括 Doubao-Seedream-5.0-lite、4.5、4.0；官方发布记录给出的 5.0 lite 固定版本 ID 为 `doubao-seedream-5-0-lite-260128`，并同时出现 `doubao-seedream-5-0-260128`。[火山方舟产品页](https://www.volcengine.com/product/ark) · [火山引擎官方发布记录](https://www.volcengine.com/docs/6492/2165228?lang=en)
4. **对“上传一张图 → 生成一张拼豆风结果”应关闭组图**：传 `image`、`prompt`，并设 `sequential_image_generation: "disabled"`。图片 API 是一次 HTTP 请求直接返回结果的调用；`stream: false` 会等待生成结束后一并返回，`stream: true` 则逐张返回，并不是“创建任务后轮询”的异步任务接口。[火山方舟图片生成 API](https://api.volcengine.com/api-docs/view?action=ImageGenerations&serviceCode=ark&version=2024-01-01)
5. **不要把返回 URL 当永久存储**。BytePlus 官方同源 API 文档明确规定 URL 在生成后 24 小时内失效，需及时下载或存入自有对象存储；也可直接要求 `b64_json`。中国区公开图片 API 页面未在可访问正文中明确 URL 有效期，因此中国区生产接入前仍应在控制台文档/API Explorer 复核，但工程上必须按短期 URL 处理。[BytePlus Image generation API](https://docs.byteplus.com/en/docs/ModelArk/1541523)

## 2. 中国区火山方舟：已确认的接入事实

### 2.1 产品、模型名称与 Model ID

| 模型 | 官方已确认 ID / 状态 | 与本项目有关的能力 | 备注 |
|---|---|---|---|
| Doubao-Seedream 5.0 lite | `doubao-seedream-5-0-lite-260128` | 文生图、图片编辑、参考图生图、多图输入、组图 | 中国区当前优先评估；官方提示词指南覆盖 5.0 lite。|
| Doubao-Seedream 5.0 | `doubao-seedream-5-0-260128` | 官方发布记录确认已在相关图片生成能力中上线 | 中国区公开方舟 API 参数正文对该版本的逐项限制抓取不完整，实际开通状态与参数支持需以当前账号「模型列表/API Explorer」为准。|
| Doubao-Seedream 4.5 | `doubao-seedream-4-5-251128` | 文生图、图片编辑、参考图、多图输入、组图；官方资料称支持 4K | 可作为 5.0 lite 的兼容/效果对照模型。固定 ID 可由火山引擎官方开发者文章与官方仓库示例交叉确认。[官方实践文章](https://developer.volcengine.com/articles/7636975452683517990) · [Volcengine OpenViking 官方仓库](https://github.com/volcengine/OpenViking/blob/main/bot/README.md) |
| Doubao-Seedream 4.0 | `doubao-seedream-4-0-250828` | 单图/多图输入、图片编辑、组图；支持流式逐图返回 | 中国区图片 API 页面直接使用该 ID 作为示例。|

来源：[火山方舟模型列表入口](https://www.volcengine.com/docs/82379/1330310?lang=zh&redirect=1) · [火山方舟产品页](https://www.volcengine.com/product/ark) · [Seedream 提示词指南](https://www.volcengine.com/docs/82379/1829186) · [图片生成 API](https://api.volcengine.com/api-docs/view?action=ImageGenerations&serviceCode=ark&version=2024-01-01)

注意：`Model ID` 也可以替换为已经配置的推理接入点 `Endpoint ID`（形如 `ep-...`）。模型是否对某账号/地域已开通，应以火山方舟控制台的模型列表和 API Explorer 下拉选项为准；不要在代码里猜测未出现在账号控制台中的版本。[图片生成 API](https://api.volcengine.com/api-docs/view?action=ImageGenerations&serviceCode=ark&version=2024-01-01)

### 2.2 请求方式与鉴权

- 方法与地址：`POST https://ark.cn-beijing.volces.com/api/v3/images/generations`。
- 请求头：`Content-Type: application/json`、`Authorization: Bearer $ARK_API_KEY`。
- 图片生成 API 官方概览说明该接口支持 API Key 鉴权；如必须用 Access Key，可先通过 `GetApiKey` 获取临时 API Key。服务端应从环境变量/密钥服务读取 Key，不得把 Key 下发给浏览器。[API 概览与鉴权说明](https://api.volcengine.com/api-docs/view/overview?serviceCode=ark&version=2024-01-01) · [火山方舟产品简介示例](https://www.volcengine.com/docs/82379/1795150)

与本项目最相关的最小请求形态：

```json
{
  "model": "doubao-seedream-5-0-lite-260128",
  "prompt": "保留原图主体轮廓和构图，将画面转换成规则网格的拼豆作品……",
  "image": "data:image/png;base64,<BASE64>",
  "size": "2K",
  "sequential_image_generation": "disabled",
  "response_format": "url",
  "watermark": false
}
```

这里的字段形态由中国区图片 API 与官方提示词指南确认；但 **`output_format: "png"` 是否对中国区所选模型开放，应在当前账号 API Explorer 验证**。中国区官方发布记录说明 Seedream 5.0 系列新增了 `output_format` 参数，但当前可抓取的中国区 `ImageGenerations` 参数正文仍是较早版本，未展示该字段。[图片生成 API](https://api.volcengine.com/api-docs/view?action=ImageGenerations&serviceCode=ark&version=2024-01-01) · [Seedream 提示词指南](https://www.volcengine.com/docs/82379/1829186) · [官方发布记录](https://www.volcengine.com/docs/6492/2165228?lang=en)

### 2.3 image-to-image / 参考图能力

- `image` 可传可访问的 URL 或 Base64；中国区 API 页面明确支持这两种形式。
- Seedream 5.0 lite、4.5、4.0 均支持结合文字与图片做图片编辑、参考生成；也可输入多张图完成替换、组合、风格迁移。
- 拼豆场景属于“单参考图 + 文本风格/约束指令 → 单图”路径，不需要单独调用旧的 SeedEdit 模型。
- 如果原图主体结构必须稳定，提示词需明确“哪些内容改变、哪些保持不变”；这是官方提示词指南对图片编辑的直接建议。

来源：[火山方舟图片生成 API](https://api.volcengine.com/api-docs/view?action=ImageGenerations&serviceCode=ark&version=2024-01-01) · [Seedream 4.0–5.0 提示词指南](https://www.volcengine.com/docs/82379/1829186)

### 2.4 同步、流式与返回结构

- 非流式：`stream: false`，服务端等待图片全部生成后，在同一个 HTTP 响应中返回 `model`、`created`、`data[]`、`usage` 或 `error`。
- 流式：支持的模型可设 `stream: true`，每张图片生成后立即返回；中国区 API 页面当前明确写的是仅 Seedream 4.0 支持该字段。对于只生成一张图的 MVP，没有使用流式的必要。
- 单图模式：`sequential_image_generation: "disabled"`。
- 组图模式：`auto`；实际张数由模型和 `sequential_image_generation_options` 决定。
- `data[]` 中包含 `url` 或 Base64，以及实际图片尺寸；`usage` 包含成功生成图片数和 token 用量。

来源：[火山方舟图片生成 API](https://api.volcengine.com/api-docs/view?action=ImageGenerations&serviceCode=ark&version=2024-01-01)

### 2.5 输入、输出格式和大小限制

中国区当前可访问的公开 API 页面把详细限制链接到“使用说明”，但该页面正文抓取不完整。以下精确限制来自 **BytePlus 官方的同源 ModelArk 图片 API**，可用于实现保守的前置校验；上线中国区前须再用中国区控制台/API Explorer 复核：

- 输入方式：可访问 URL，或 `data:image/<format>;base64,<data>`；`<format>` 必须小写。
- Seedream 5.0 pro/lite、4.5、4.0 输入格式：JPEG、PNG、WebP、BMP、TIFF、GIF、HEIC、HEIF。
- 单张输入图：宽、高均须大于 14 px；宽高比在 `[1/16, 16]`；最大 30 MB；单图总像素不超过 36,000,000。
- 参考图数量：BytePlus Seedream 5.0 lite、4.5、4.0 最多 14 张；本项目只需 1 张。
- `response_format`：`url`（默认）或 `b64_json`。
- BytePlus 的 Seedream 5.0 pro/lite 可用 `output_format` 指定 `png` 或 `jpeg`；4.5/4.0 默认 JPEG 且不支持自定义输出格式。
- BytePlus Seedream 5.0 lite 的 `size` 支持 `2K`、`3K`、`4K`，或传自定义 `宽x高`；自定义输出总像素范围为 3,686,400–16,777,216，宽高比 `[1/16,16]`。
- BytePlus Seedream 4.5 支持 `2K`、`4K`；4.0 支持 `1K`、`2K`、`4K`。

来源：[BytePlus Image generation API](https://docs.byteplus.com/en/docs/ModelArk/1541523) · [BytePlus Image generation tutorial](https://docs.byteplus.com/ja/docs/ModelArk/1824121)

**不确定项标记**：上面的精确格式/尺寸表是 BytePlus 国际区文档，不应被当作中国区的永久契约。FastAPI 接入时应把前置限制做成配置项，并保留供应商 400 错误的原始 `code` 与请求 ID，方便中国区规则变化后调整。

另外，火山引擎国内的 **veImageX Seedream 4.0 附加组件**仍公开着另一组限制（JPEG/PNG、单图不超过 10 MB、宽高比 `[1/3,3]` 等）。它是另一产品入口，不是火山方舟 `POST /api/v3/images/generations` 的通用契约，不能混为一谈；但这也说明 MVP 自身把上传收紧为单图、10 MB 会更稳妥。[veImageX Seedream 4.0 附加组件](https://www.volcengine.com/docs/508/1962138?lang=zh)

## 3. BytePlus 国际区：不要与中国区混用

若系统部署在国际区，官方 ModelArk 的 API 契约更完整：

- AP Base URL：`https://ark.ap-southeast.bytepluses.com/api/v3`。
- EU Base URL：`https://ark.eu-west.bytepluses.com/api/v3`。
- 图片接口：`POST /images/generations`。
- 鉴权：长期 API Key，`Authorization: Bearer $ARK_API_KEY`；API Key、模型激活和推理端点按地域隔离。
- 当前官方示例 ID：
  - `seedream-5-0-lite-260128`
  - `dola-seedream-5-0-pro-260628`
  - `seedream-4-0-250828`
- 5.0 pro 可接 1 张或 2–10 张参考图并输出单图，但不支持 `sequential_image_generation` 或流式输出；5.0 lite、4.5、4.0 支持单图/多图输入、单图或组图输出，并支持流式逐图返回。

来源：[BytePlus Image generation API](https://docs.byteplus.com/en/docs/ModelArk/1541523) · [BytePlus 图片生成教程](https://docs.byteplus.com/ja/docs/ModelArk/1824121) · [BytePlus 地域说明](https://docs.byteplus.com/api/docs/modelark/2191806) · [BytePlus API Key 管理](https://docs.byteplus.com/en/docs/ModelArk/1361424)

**关键提醒**：中国区 `doubao-...`、BytePlus `seedream-...` / `dola-...` 的 Model ID、API Key、Base URL 不可交叉使用。

## 4. 输出 URL、持久化与 PNG

- `response_format: "url"` 返回临时下载链接；BytePlus 官方明确其有效期为生成后 24 小时，过期自动清理。服务端拿到结果后应立即下载并存入自有对象存储，再把自有 URL 返回前端。[BytePlus 图片生成教程](https://docs.byteplus.com/ja/docs/ModelArk/1824121)
- `response_format: "b64_json"` 可直接返回 Base64，但会显著增大 JSON 响应体；更适合后端立即解码，不适合透传到前端。
- 如果模型/区域支持 `output_format: "png"`，可直接请求 PNG；BytePlus 5.0 pro/lite 官方明确支持 PNG/JPEG。
- 如果中国区所选模型实际只返回 JPEG，仍可由后端无损解码后重新编码成 PNG，再交给后续拼豆网格渲染/导出。重新编码只改变容器格式，不会恢复 JPEG 已损失的细节，因此应优先在 API Explorer 验证 Seedream 5.0 lite 的 PNG 原生输出。

来源：[BytePlus Image generation API](https://docs.byteplus.com/en/docs/ModelArk/1541523) · [BytePlus Image generation tutorial](https://docs.byteplus.com/ja/docs/ModelArk/1824121) · [火山引擎 Seedream 5.0 系列发布记录](https://www.volcengine.com/docs/6492/2165228?lang=en)

## 5. 错误、限流与重试边界

中国区图片 API 当前明确列出的错误包括：

| HTTP | code | 含义 | 建议处理 |
|---:|---|---|---|
| 400 | `InputTextSensitiveContentDetected` | 输入提示词可能含敏感信息 | 不自动原样重试；返回可理解提示，引导修改输入。|
| 400 | `OutputImageSensitiveContentDetected` | 生成结果可能含敏感信息 | 不向用户暴露结果；可允许用户调整素材/提示词后重试。|
| 429 | `QuotaExceeded` | 排队中任务数/账号配额超过限制 | 指数退避并加随机抖动；限制重试次数，同时做服务端并发控制。|

来源：[火山方舟 ImageGenerations 错误码](https://api.volcengine.com/api-docs/view?action=ImageGenerations&serviceCode=ark&version=2024-01-01)

补充事实：BytePlus 官方说明，在组图请求中，单张因内容过滤失败不会阻断后续图片；若发生内部服务 500，则不会继续请求下一张。该事实再次说明调用方必须逐项检查 `data[].error`，不能只看 HTTP 是否成功。[BytePlus Image generation API](https://docs.byteplus.com/en/docs/ModelArk/1541523)

限流方面：官方公开资料显示限额按模型/账号管理，控制台会展示并允许申请提升；BytePlus Seedream 4.0 的模型页曾明确标注 500 IPM（images per minute）。**这不是对中国区 5.0 lite 的可迁移承诺**，因此 5.0 lite 的具体 IPM/RPM 必须以当前账号控制台显示为准。[BytePlus Seedream 4.0 模型页](https://docs.byteplus.com/en/docs/ModelArk/1824718) · [BytePlus 模型激活与限额](https://docs.byteplus.com/api/docs/ModelArk/1159200)

建议只对以下情况自动重试：网络超时、连接失败、429、明确的 5xx；400 参数错误、鉴权错误、内容安全拒绝不应盲目重试。每次记录供应商 `code`、`message`、HTTP 状态、请求 ID、模型 ID 和耗时，但日志中不得写入完整 Base64 图片或 API Key。

## 6. 内容合规与水印

- 火山方舟图片 API 会对输入提示词和生成图片进行内容安全检查，命中时分别返回 `InputTextSensitiveContentDetected`、`OutputImageSensitiveContentDetected`。[火山方舟图片生成 API](https://api.volcengine.com/api-docs/view?action=ImageGenerations&serviceCode=ark&version=2024-01-01)
- BytePlus API 对组图的内容过滤失败以单图错误返回，成功图片数才计入 `usage.generated_images`，官方注明按成功生成图片数计费。[BytePlus Image generation API](https://docs.byteplus.com/en/docs/ModelArk/1541523)
- `watermark` 默认值在 BytePlus 文档中为 `true`；设 `false` 可去掉右下角 “AI generated” 水印。中国区 API 页面也提供 `watermark` 参数，但页面字段说明误写为“生成视频是否包含水印”，应视为文档笔误并在 API Explorer 实测。[BytePlus Image generation API](https://docs.byteplus.com/en/docs/ModelArk/1541523) · [火山方舟图片生成 API](https://api.volcengine.com/api-docs/view?action=ImageGenerations&serviceCode=ark&version=2024-01-01)
- `watermark: false` 只控制可见水印，不代表免除平台内容政策、版权/肖像权义务，也不代表输出一定可商用。关于 Seedream 输出的商业授权范围、隐式 AIGC 标识或中国大陆生成式 AI 标识要求，当前核对到的上述 API 文档没有给出足以支撑结论的条款；**上线前必须另行由产品/法务核对账号对应的服务协议、内容政策和适用法规**。
- 火山《豆包模型服务协议》要求使用者遵守生成式 AI 相关法规，并在使用生成结果前审核、校对；结果的准确性、合法性和不侵权需由使用方判断。火山针对平台版权/人像素材的规则还明确要求依法显著标识深度合成产出，不得删除、篡改或隐匿平台 AI 标识。后者针对特定素材功能，不能扩大解释成所有 Seedream 场景的唯一规则，但足以说明 `watermark: false` 不是完整的合规结论。[豆包模型服务协议](https://www.volcengine.com/docs/82379/1142195?TimeBefore=1715691620&lang=zh) · [版权和人像素材规则](https://www.volcengine.com/docs/82379/2525200?lang=en)

## 7. 本项目接入前必须做的账号级验证

以下信息无法仅凭公开页面完全确认，需用项目实际火山方舟账号做一次 API Explorer/沙箱调用：

1. `doubao-seedream-5-0-lite-260128` 在目标账号、`cn-beijing` 地域是否已激活，是否可直接使用 Model ID，还是必须使用 Endpoint ID。
2. 中国区 5.0 lite 是否接受 `output_format: "png"`，以及返回 JSON 中是否包含 `data[].output_format`。
3. 中国区 5.0 lite 的输入格式、30 MB/36 MP 限制、输出 `size` 范围是否与 BytePlus 当前文档完全一致。
4. 中国区结果 URL 的确切有效期；在未确认前按不超过 24 小时处理并立即落自有存储。
5. 当前账号的 IPM/RPM/并发额度、免费额度与计费规则。
6. `watermark: false` 在实际账号和模型上是否生效，以及输出是否带其他 AIGC 标识。

## 8. 可直接交给后端实现的供应商契约建议

这不是系统架构，只是对上述官方事实的最小封装建议：

- 固定由后端持有 `ARK_API_KEY`，前端不可直连 Seedream。
- 将 `ARK_BASE_URL`、`SEEDREAM_MODEL_ID`、超时、最大输入 MB、最大像素、是否请求 PNG 都做成环境配置。
- MVP 固定 `sequential_image_generation="disabled"`、单张 `image`、单张输出。
- 后端接受用户文件后先做 MIME 嗅探、解码验证、尺寸/像素/体积限制，再编码为 Base64 或上传到受控的临时对象 URL。
- Seedream 结果立即下载到后端/对象存储；不要把供应商 24 小时 URL 作为数据库中的最终资产地址。
- 对内容安全错误使用稳定业务错误码映射；保存供应商请求 ID 便于工单排查。
