# Seedream 5.0 lite 官方资料研究笔记

> 调研日期：2026-08-13（Asia/Shanghai）  
> 范围：仅火山引擎官方文档、官方 API 文档中心、官方产品页与火山引擎官方 GitHub。  
> 结论强度：本文将“已确认”“需控制台确认”“未确认”分开标识，避免把 Seedream 4.0 的规则误套到 5.0 lite。  
> 实测补充：2026-08-14 已用授权的非敏感测试图完成一次计费调用，确认中文 prompt + `2K` + `b64_json` + 单图非流式请求可用。请求 lite ID，响应模型名为 `doubao-seedream-5-0-260128`，仍需控制台核对路由与计费归属。

## 1. 核心结论

1. Seedream 5.0 lite 的官方版本化 Model ID 为 `doubao-seedream-5-0-lite-260128`。该字符串可由火山引擎官方 LAS 2026 发布记录交叉确认；正式接入时仍应在方舟控制台“模型列表/在线推理”复制当前可用的 Model ID，或使用已创建的 `ep-...` 推理接入点 ID，而不是长期硬编码猜测值。[[官方发布记录](https://www.volcengine.com/docs/6492/2165228?lang=en)] [[图片生成 API](https://www.volcengine.com/docs/82379/1541523?lang=zh)]
2. 北京地域的 REST 调用地址是 `POST https://ark.cn-beijing.volces.com/api/v3/images/generations`，请求头使用 `Authorization: Bearer <ARK API Key>` 和 `Content-Type: application/json`。[[官方 API 文档中心](https://api.volcengine.com/api-docs/view?action=ImageGenerations&serviceCode=ark&version=2024-01-01)] [[方舟产品简介/鉴权示例](https://www.volcengine.com/docs/82379/1795150)]
3. 图片生成接口是一次请求内完成的在线生成接口：`stream=false` 时等待全部图片生成后一次返回；接口也定义了 `stream=true` 的逐图流式输出。但当前公开 API 参考明确写着 `stream` “仅 doubao-seedream-4.0 支持”，所以 **5.0 lite 是否支持流式不能据此确认，MVP 应按非流式同步 HTTP 接口设计**。[[官方 API 文档中心](https://api.volcengine.com/api-docs/view?action=ImageGenerations&serviceCode=ark&version=2024-01-01)]
4. 官方已确认 Seedream 5.0 lite 支持文生图、图片编辑、参考图生图、多图输入和多图输出；但公开提示词指南不等于 API 参数约束，具体图片数量、字节大小、像素范围应在控制台最新“支持范围”表再次确认。[[官方 Seedream 4.0–5.0 提示词指南](https://www.volcengine.com/docs/82379/1829186)]
5. 官方产品页当前展示按量价 **0.22 元/张**，并展示新客/试用免费额度 **200 张**。价格和活动会变化，生产预算必须以购买页/账单页实时值为准。[[方舟产品页](https://www.volcengine.com/product/ark)]

## 2. 模型标识与开通方式

### 2.1 `model` 字段可接受什么

官方图片生成 API 将 `model` 定义为必填字符串，接受：

- Model ID，例如本次模型的版本化 ID `doubao-seedream-5-0-lite-260128`；
- 已配置图片生成模型的推理接入点 Endpoint ID，格式类似 `ep-2025****-**`。

Model ID 应从方舟“模型列表”查询；API Key 从方舟控制台 API Key 管理页创建/复制。[[图片生成 API](https://www.volcengine.com/docs/82379/1541523?lang=zh)] [[API Key 管理入口（官方文档给出的链接）](https://console.volcengine.com/ark/region:ark+cn-beijing/apikey)]

### 2.2 推荐的配置策略

- 应用侧环境变量继续使用项目已有的 `ARK_DOUBAO_API_KEY`，但只在服务端读取。
- 另设非秘密配置 `ARK_DOUBAO_IMAGE_MODEL=doubao-seedream-5-0-lite-260128`，便于模型升级或控制台切换 Endpoint 时无需改代码。
- 若控制台为该账号展示的 Model ID 与本文不同，以控制台复制值为准；本文没有登录用户账号，无法确认该 Key 的服务开通状态、地域权限和账户配额。

## 3. HTTP 接入

### 3.1 最小请求

```bash
curl -X POST 'https://ark.cn-beijing.volces.com/api/v3/images/generations' \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $ARK_DOUBAO_API_KEY" \
  -d '{
    "model": "doubao-seedream-5-0-lite-260128",
    "prompt": "一张简洁的产品概念图",
    "size": "2K",
    "sequential_image_generation": "disabled",
    "response_format": "url",
    "watermark": true
  }'
```

端点、Bearer 鉴权和字段来自官方图片生成 API；`2K` 是官方 API 参考的示例值，不代表 5.0 lite 仅支持或必然支持所有自定义长宽。[[官方 API 文档中心](https://api.volcengine.com/api-docs/view?action=ImageGenerations&serviceCode=ark&version=2024-01-01)]

### 3.2 请求字段（公开 API 参考可确认部分）

| 字段 | 类型 | 必填 | 官方定义与接入建议 |
|---|---:|---:|---|
| `model` | string | 是 | Model ID 或 Endpoint ID。|
| `prompt` | string | 是 | 文本提示词。官方 5.0 指南建议自然语言写清主体、行为、环境及必要的风格/构图。|
| `image` | string 或 string[] | 否 | 输入图片，支持 URL 或 Base64；5.0 lite 的能力指南确认支持单图/多图参考、编辑。|
| `size` | string | 否 | 输出宽高；API 示例为 `2K`。精确枚举/像素边界需查最新支持范围。|
| `seed` | int32 | 否 | 随机种子；省略时服务自动生成。相同 seed 仅用于“相对稳定”，不应视为强确定性。|
| `sequential_image_generation` | `auto` / `disabled` | 否 | `auto` 让模型判断是否返回组图，`disabled` 固定单图。MVP 建议默认 `disabled` 控成本。|
| `sequential_image_generation_options.max_images` | int32 | 否 | 仅在组图 `auto` 时有效；5.0 lite 的精确上下限公开抓取内容未确认。|
| `stream` | boolean | 否 | `false` 一次返回全部，`true` 逐图流式；当前参考标注仅 4.0 支持，5.0 lite 不应贸然启用。|
| `guidance_scale` | float | 否 | API 通用参考给出 `[1,10]`；但是否适用于 5.0 lite 未在可读取的 5.0 专属表中确认，首版应省略。|
| `response_format` | `url` / `b64_json` | 否 | `url` 返回可下载 JPEG URL；`b64_json` 返回 Base64 JSON。|
| `watermark` | boolean | 否 | 控制生成内容水印。官方页面字段描述误写“生成视频”，但它出现在图片生成 API 中。合规策略应由产品确认。|
| `optimize_prompt_options` | object | 否 | 当前 API 参考标注仅 4.0 支持，5.0 lite 首版不要发送。|

字段来源：[[图片生成 API](https://www.volcengine.com/docs/82379/1541523?lang=zh)] [[官方 API 文档中心](https://api.volcengine.com/api-docs/view?action=ImageGenerations&serviceCode=ark&version=2024-01-01)]。5.0 lite 的任务能力来源：[[Seedream 4.0–5.0 提示词指南](https://www.volcengine.com/docs/82379/1829186)]。

### 3.3 Seedream 5.0 特有参数线索

火山引擎另一条官方产品发布记录说明，Seedream 5.0 系列新增 `tools`（当前支持 `web_search`）和 `output_format`（指定生成图像文件格式）。不过该记录属于 LAS“图片生成算子”，不是方舟 `/api/v3/images/generations` 的完整参数契约；用户给出的方舟 API 页面可读取内容也没有给出这两个字段。因此 **不能直接在方舟请求中上线它们**，应先在已登录 API Explorer 选择 5.0 lite 预设，确认生成的请求 Schema。[[官方 LAS 发布记录](https://www.volcengine.com/docs/6492/2165228?lang=en)]

## 4. 响应与输出图片

非流式成功响应公开定义为：

```json
{
  "model": "doubao-seedream-5-0-lite-260128",
  "created": 1718049470,
  "data": [
    { "url": "https://...", "size": "2048x2048" }
  ],
  "usage": {
    "generated_images": 1,
    "output_tokens": 0,
    "total_tokens": 0
  }
}
```

- `model`：实际模型名称和版本；
- `created`：Unix 秒级时间戳；
- `data[]`：每张输出图的信息，包含 `url` 或 Base64 字段及 `size`；
- `usage`：生成张数、输出 token 与总 token；图片产品当前按张计费，仍建议完整保存 usage 以审计成本；
- 失败时返回 `error` 对象。

上述结构来自[[官方 API 文档中心](https://api.volcengine.com/api-docs/view?action=ImageGenerations&serviceCode=ark&version=2024-01-01)]。示例中的具体 `size` 和 token 数值仅作结构演示。

### 4.1 URL 与 Base64 的工程选择

- `url`：响应轻、适合服务端下载后转存自有对象存储；不要把第三方临时链接当永久资产。公开 API 参考只说“可下载 JPEG 链接”，**未在当前可读取页面确认链接有效期**。
- `b64_json`：避免二次拉取 URL，但响应体大，增加应用内存、网关包体和日志泄漏风险；解码后同样应转存。
- 参考图 URL 应由服务端校验协议、域名/IP 和响应大小，防 SSRF；Base64 应校验 MIME、魔数、像素和解码后字节上限。

## 5. 同步、流式与异步的准确边界

- 图片生成 API 没有返回 task ID，也没有配套“查询图片任务”接口，因此不是视频生成那种提交任务后轮询的异步 API。
- `stream=false`：HTTP 连接保持到所有图片生成结束，再一次性响应；这是 MVP 最稳妥路径。
- `stream=true`：接口定义的流式逐图输出，不等于后台异步任务。但当前官方说明只确认 4.0，5.0 lite 未确认。
- 应用内部仍可把生成工作包装成队列 Job，以解决 Web 请求超时、重试、取消、并发与状态追踪；这是应用架构选择，不是方舟 API 原生异步能力。

来源：[[图片生成 API](https://www.volcengine.com/docs/82379/1541523?lang=zh)]。

## 6. 图片输入、输出、尺寸与数量限制

### 6.1 已确认能力

官方 4.0–5.0 提示词指南明确把 Seedream 5.0 lite 纳入以下能力：

- 文生图；
- 通过文本对图片增加、删除、替换、修改；
- 参考图生图（人物、风格、产品特征等）；
- 多图输入，用于替换、组合、迁移等；
- 多图输出/组图，可通过“一系列”“一套”“组图”或具体数量触发。

来源：[[Seedream 4.0–5.0 提示词指南](https://www.volcengine.com/docs/82379/1829186)]。

### 6.2 未能从 5.0 lite 专属公开契约确认的硬限制

以下项目在用户给出的 API 页抓取内容里主要以 4.0 举例，不能安全外推：

- 单次最多参考图数量；
- 参考图与生成图总数上限；
- `max_images` 对 5.0 lite 的范围；
- URL 图片最大字节、Base64 最大字节和允许 MIME；
- 输入图片最小/最大分辨率与宽高比；
- 5.0 lite 可选 `size` 的完整枚举、总像素及宽高比规则；
- 输出 URL 的有效期；
- 5.0 lite 是否支持 `stream`、`guidance_scale`、`optimize_prompt_options`；
- 联网搜索工具和 `output_format` 在方舟图片 API 的准确 JSON 结构。

上线前应登录[[API Explorer](https://api.volcengine.com/api-explorer/?action=ImageGenerations&groupName=%E5%9B%BE%E7%89%87%E7%94%9F%E6%88%90API&serviceCode=ark&tab=2&version=2024-01-01)]，选择 Seedream 5.0 lite 预设，并以页面当时生成的参数说明/SDK 示例为验收证据。

## 7. SDK 选择

### 7.1 官方 SDK

火山引擎官方 Python SDK 的 Ark Runtime 安装方式是：

```bash
pip install "volcengine-python-sdk[ark]"
```

官方仓库说明 Ark Runtime 需要 Python 3.6+；官方方舟示例以 `volcenginesdkarkruntime.Ark`、`base_url=https://ark.cn-beijing.volces.com/api/v3` 和环境变量 API Key 初始化。[[官方 Python SDK 仓库](https://github.com/volcengine/volcengine-python-sdk)] [[官方方舟示例](https://www.volcengine.com/docs/82379/1795150)]

### 7.2 TypeScript 项目的建议

本项目优先 TypeScript。当前官方图片 API 是清晰的 JSON/HTTP 契约，建议在服务端直接用 Node.js 原生 `fetch` 封装一个小型 typed client：

- 不依赖可能滞后的第三方图片 SDK 类型；
- 能明确设置连接/响应超时、AbortSignal、响应大小上限；
- 对 400 敏感内容错误与 429 配额错误做业务映射；
- 保留响应 header 中的 request ID（若提供）以及 body 中的错误信息；
- API Key 只进入服务端 Authorization header，绝不透传浏览器。

这里的 TypeScript 方案是工程建议；官方已确认的协议依据仍是[[图片生成 API](https://www.volcengine.com/docs/82379/1541523?lang=zh)]。

## 8. 错误码与重试

图片生成 API 当前公开列出的业务错误码：

| HTTP | Code | 含义 | 处理建议 |
|---:|---|---|---|
| 400 | `InputTextSensitiveContentDetected` | 输入文本可能含敏感信息 | 不自动原样重试；提示用户调整 prompt。|
| 400 | `OutputImageSensitiveContentDetected` | 输出图可能含敏感信息 | 不盲目重试；可提示改写 prompt，记录 request ID。|
| 429 | `QuotaExceeded` | 排队中任务数超过限制 | 指数退避 + 抖动；应用侧限制并发，设置最大重试次数。|

接口响应还定义了失败时的 `error` 对象。应统一解析 HTTP 状态、`error.code`、`error.message` 和 request ID，不要把上游原始错误或请求体（尤其 Base64 图片）完整写入日志。[[官方 API 文档中心](https://api.volcengine.com/api-docs/view?action=ImageGenerations&serviceCode=ark&version=2024-01-01)]

官方公开表未在当前抓取结果中完整列出 401、403、404、5xx 的图片 API 专属 code，因此客户端还需按 HTTP 类别兜底：401/403 不重试并报警密钥/权限；408/429/5xx 仅在请求语义和预算允许时有限重试；其余 4xx 不重试。

## 9. 鉴权与安全

### 9.1 官方确认

- 方舟推理 API Key 是调用安全凭证，在 API Key 管理创建；请求格式为 `Authorization: Bearer $ARK_API_KEY`。[[方舟 VPC 访问文档](https://www.volcengine.com/docs/82379/1339360?lang=zh)]
- 高安全/低延迟场景可配置 VPC + PrivateLink，且仍可通过 `ark.cn-beijing.volces.com` 域名访问。[[方舟 VPC 访问文档](https://www.volcengine.com/docs/82379/1339360?lang=zh)]

### 9.2 本项目必须执行

- `ARK_DOUBAO_API_KEY` 仅服务端读取；不得使用 `NEXT_PUBLIC_`/Vite 公共前缀，不得返回给客户端。
- 不读取、打印、测试回显 `.env` 的实际值；日志对 Authorization、图片 Base64、输入 URL 查询参数脱敏。
- 浏览器只调用项目自有后端。官方社区案例已展示直接浏览器请求可能遇到 CORS，且无论是否 CORS，前端直连都会泄漏 API Key。[[火山引擎开发者社区案例](https://developer.volcengine.com/articles/7560657849756909594)]（该链接为官方域内容，但属于社区案例，证据等级低于 API 文档。）
- 服务端加入登录鉴权、用户级限频、并发信号量、每日张数/金额预算、prompt 长度与图片校验。
- 上游返回 URL 由后端立即下载并存入自有对象存储；下载器禁内网 IP、限制重定向/包体/超时，验证 Content-Type 与文件魔数。
- 错误日志记录 request ID、模型、耗时、生成张数、业务用户与内部 job ID，不记录 secret 和原始图片。
- Key 泄漏时立即在方舟控制台轮换并清理历史日志/构建产物；生产和开发使用不同 Key。

## 10. 计费与限流

### 10.1 已确认价格

官方方舟产品页当前列出：

- Doubao-Seedream-5.0-lite：按量推理 **0.22 元/张**；
- 免费额度：**200 张**（页面展示的活动/试用值）。

来源：[[火山方舟产品页](https://www.volcengine.com/product/ark)]。价格和免费额度是时效信息，方案评审和上线当天必须再次核价。

### 10.2 限流现状

- 官方图片 API 明确存在 429 `QuotaExceeded`，描述为当前账号排队任务数超过限制。[[官方 API 文档中心](https://api.volcengine.com/api-docs/view?action=ImageGenerations&serviceCode=ark&version=2024-01-01)]
- 火山引擎开发者社区的 4.0 内容曾给出 500 IPM，但这既是社区文章、又是 4.0 数据，**不能作为 5.0 lite 的生产配额依据**。[[社区文章，仅供背景](https://developer.volcengine.com/articles/7553203404664176650)]
- 5.0 lite 的默认 QPS/IPM、并发和可购买保障规格，当前无需登录的官方页面未能确认。应从账号控制台“配额/限流”或工单获取账号级值，再配置应用信号量；不要按猜测数字压测生产 Key。

## 11. 上线前官方核对清单

1. 控制台确认账号已开通 Seedream 5.0 lite，复制实际 Model ID 或 Endpoint ID。
2. API Explorer 选择 5.0 lite 预设，保存最新请求字段、支持范围和 SDK 示例截图/链接。
3. 明确 `size` 枚举、输入图数量/大小/MIME、`max_images`、输出 URL TTL。
4. 确认 `stream`、`guidance_scale`、`optimize_prompt_options` 对 5.0 lite 是否有效。
5. 若要联网或指定 PNG/WebP/JPEG，确认方舟 API 中 `tools` 与 `output_format` 的精确结构及额外计费。
6. 在控制台核实当前价格、免费额度、QPS/IPM/并发/排队配额。
7. 用非敏感测试图分别验证文生单图、单参考图、多参考图、组图、内容审核、429 与超时场景。
8. 确认生成图片的水印、商用、内容安全和数据保留要求。

## 12. 资料可访问性说明

- 用户提供的控制台 URL 在未登录抓取环境中不可直接打开；其对应公开文档页 `https://www.volcengine.com/docs/82379/1541523?lang=zh` 和官方 API 文档中心可以被搜索索引读取，但页面内容存在更新不同步迹象（大量说明仍以 4.0 为例）。
- 调研阶段无法登录用户账号；实施阶段随后使用已注入 Key 完成了一次计费沙箱调用。测试未读取、回显或记录 Key 值，也没有验证余额、完整配额或账单归属。
- 所有未由 5.0 lite 专属公开参数表确认的硬限制均已标为“未确认”，不建议在实现中固化。
