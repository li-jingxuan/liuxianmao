# Seedream 5.0 Pro 官方能力研究记录

> 状态：研究记录  
> 目标版本：MVP2 量化增强版  
> 研究日期：2026-08-29  
> 适用范围：`apps/api` 的火山方舟图片生成供应商契约；不包含业务实施方案

## 1. 研究边界

本文只采用以下一手资料：

1. 火山引擎官方 Ark CLI 仓库；
2. 火山方舟中国区 API Explorer；
3. BytePlus ModelArk 官方图片生成 API；
4. 火山引擎官方 Ark Runtime Go SDK 的公开类型定义。

没有用第三方博客、第三方 SDK 或社区封装补齐事实。官方资料没有确认的内容均明确标为“未确认”。

## 2. 结论摘要

1. **Seedream 5.0 Pro 确实支持透明背景输出，但目前能完整确认的是 BytePlus 国际区契约。**请求字段为 `background: "transparent"`，仅支持图生图、恰好一张输入图，且输入图片本身必须带 Alpha 通道；透明模式输出默认为 PNG，显式指定 JPEG 会报错。官方字段原文关键值为 `background: "transparent"`。[BytePlus 图片生成 API](https://docs.byteplus.com/en/docs/ModelArk/1541523)
2. **Seedream 5.0 Pro 确实支持图层分离。**请求字段为 `layer_decomposition: true`；单张输入图会被拆成一张 base image 和最多 16 个可独立编辑图层，每个分离图层都是带 Alpha 的 PNG。官方原文关键描述为 “up to 16 independently editable layers” 和 “Each layer is a PNG image with an alpha channel.”。[BytePlus 图片生成 API](https://docs.byteplus.com/en/docs/ModelArk/1541523)
3. **透明背景与图层分离不是同一个功能。**`background` 是单图编辑的 Alpha 输出控制；`layer_decomposition` 是把输入图拆成 base image + 多个图层，并返回 `z_index`、`bounding_box`、`name`、`description` 等图层元数据。官方资料没有说明两者可以在同一次请求中组合，故“同时传 `background=transparent` 与 `layer_decomposition=true`”为**未确认**。
4. **国际区准确 Model ID 已确认：**`dola-seedream-5-0-pro-260628`，调用 `POST /api/v3/images/generations`。AP Base URL 为 `https://ark.ap-southeast.bytepluses.com/api/v3`，EU Base URL 为 `https://ark.eu-west.bytepluses.com/api/v3`。[BytePlus 图片生成 API](https://docs.byteplus.com/en/docs/ModelArk/1541523)
5. **中国区 Seedream 5.0 Pro 的准确 Model ID 未由当前公开一手资料确认。**截至核对日，火山方舟中国区 API Explorer 与官方 Ark CLI 仓库公开示例仍主要展示 `doubao-seedream-5-0-260128`；不能据此把它当作 5.0 Pro，也不能把国际区 `dola-...` ID 用到 `cn-beijing`。中国区 Pro 的完整 ID 必须通过目标账号当前的 Ark CLI 实时模型目录或控制台确认。
6. **中国区 `background` / `layer_decomposition` 可用性未确认。**中国区公开 API Explorer 当前 Schema 未出现这两个字段；官方 Go SDK v0.4.0 已出现 `layer_decomposition` 及图层响应字段，但没有 `background` 命名字段。SDK 类型的存在证明运行时契约已开始支持图层数据结构，但不能单独证明目标中国区账号、模型和端点已经开放该能力。
7. **图片调用是同步响应，不是创建任务后轮询。**官方 Ark CLI 写明“图片任务同步返回”；Seedream 5.0 Pro 又明确不支持 streaming、sequential image generation 和 web search。返回 URL 24 小时失效；也可请求 `b64_json` 直接拿 Base64。[Ark CLI `+gen` 说明](https://github.com/volcengine/ark-cli/blob/main/skills/arkcli-gen/references/arkcli-gen.md) · [BytePlus 图片生成 API](https://docs.byteplus.com/en/docs/ModelArk/1541523)

## 3. 模型 ID 与地域

### 3.1 BytePlus 国际区：已确认

| 项目 | 官方契约 |
|---|---|
| Model ID | `dola-seedream-5-0-pro-260628` |
| AP Base URL | `https://ark.ap-southeast.bytepluses.com/api/v3` |
| EU Base URL | `https://ark.eu-west.bytepluses.com/api/v3` |
| Endpoint | `POST /images/generations` |
| 鉴权 | `Authorization: Bearer $ARK_API_KEY` |

官方图层分离请求示例直接使用：

```json
{
  "model": "dola-seedream-5-0-pro-260628",
  "prompt": "Perform precise layer separation on the image...",
  "image": "https://.../seedream_50_pro_layer_input.png",
  "layer_decomposition": true,
  "size": "2K",
  "output_format": "jpeg",
  "response_format": "url",
  "watermark": true
}
```

来源：[BytePlus 图片生成 API：Layer decomposition 示例](https://docs.byteplus.com/en/docs/ModelArk/1541523)

### 3.2 中国区：未确认项

中国区数据面地址本身已确认是：

```text
https://ark.cn-beijing.volces.com/api/v3
```

但以下事项在当前公开中国区官方资料中未确认：

- Seedream 5.0 Pro 的中国区完整 Model ID；
- 该 Model ID 在目标账号是否已激活；
- `background` 是否已对中国区 Pro 开放；
- `layer_decomposition` 是否已对中国区 Pro 开放；
- 中国区的输入尺寸、图层数和 Alpha 限制是否与 BytePlus 完全一致。

火山方舟官方 Ark CLI 要求数据面调用使用完整 `<name>-<primary_version>`，不能只传模型族名；官方建议实时执行 `models search/get` 获取 `primary_version`，不要自己猜版本。[Ark CLI 模型查询说明](https://github.com/volcengine/ark-cli/blob/main/skills/arkcli-models/SKILL.md) · [Ark CLI `+gen` 说明](https://github.com/volcengine/ark-cli/blob/main/skills/arkcli-gen/references/arkcli-gen.md)

应使用目标账号核验：

```bash
arkcli models search doubao-seedream-5-0-pro
arkcli models get <search 返回的模型族名> --transform 'primary_version'
arkcli resources list --modality image
```

本次研究环境没有 Ark 登录态或目标项目凭证，未执行账号级查询，因此不把推测的 `doubao-seedream-5-0-pro-260628` 记录为已确认事实。

## 4. `background=transparent` 官方契约

BytePlus 官方字段定义：

```json
{
  "background": "transparent",
  "output_format": "png"
}
```

已确认限制：

| 项目 | 官方说明 |
|---|---|
| 支持模型 | Seedream 5.0 Pro |
| 场景 | 仅 image-to-image |
| 输入张数 | 恰好 1 张 |
| 输入 Alpha | 输入图必须带 Alpha 通道 |
| 输入 JPEG | 不支持；JPEG 无 Alpha，传入会报错 |
| 默认背景模式 | `opaque` |
| 透明模式输出 | 默认 PNG |
| 透明模式 + JPEG 输出 | 报错 |

来源：[BytePlus 图片生成 API：`background` 参数](https://docs.byteplus.com/en/docs/ModelArk/1541523)

需要特别区分：官方要求的是“输入图片有 Alpha 通道”，没有写明 Alpha 必须包含实际透明像素。因此“RGBA PNG 但 Alpha 全为 255 是否满足并稳定得到透明输出”在文档层面仍是**未确认**，只能由目标端点实测确认。

官方资料也没有承诺：

- 透明结果一定只有一个语义主体；
- 主体内部封闭孔洞一定被正确设为透明；
- 阴影、半透明材质、毛发边缘的 Alpha 质量；
- 透明背景输出与图层分离可组合。

## 5. `layer_decomposition=true` 官方契约

### 5.1 行为

开启 `layer_decomposition: true` 后：

- 必须输入一张图片；多张会报错；
- 模型会拆出一张 base image 和多个独立图层；
- 最多 16 个分离图层；
- 每个分离图层为带 Alpha 的 PNG；
- Prompt 可选：省略时自动识别主要元素；传入时可指定希望分离的元素；
- 任一图层生成失败，则整次请求失败，不支持部分成功；
- Prompt 要求的图层数超过上限时，可能丢失部分图层信息。

来源：[BytePlus 图片生成 API：`layer_decomposition` 参数与能力矩阵](https://docs.byteplus.com/en/docs/ModelArk/1541523)

### 5.2 图层分离输入限制

| 项目 | 限制 |
|---|---|
| 输入张数 | 1 |
| 输入格式 | PNG 或 JPEG |
| 文件大小 | 最大 30 MB |
| 宽高比 | `[1/16, 16]` |
| 总像素 | `[512×512, 6000×6000]`，按宽×高计算 |

来源：[BytePlus 图片生成 API：layer decomposition image 要求](https://docs.byteplus.com/en/docs/ModelArk/1541523)

### 5.3 图层分离输出尺寸

图层模式的 `size` 只支持分辨率档位，不支持任意 `宽x高`：

- 默认：`auto`；
- 可选：`1K`、`1.5K`、`2K`、`auto`；
- base image 保持原图宽高比；
- 每个图层保持其原始局部区域宽高比；
- `auto` 时，小于 1K 的结果上采样到 1K，大于 2K 的结果下采样到 2K，中间范围按原尺寸输出。

来源：[BytePlus 图片生成 API：Seedream 5.0 pro layer decomposition size](https://docs.byteplus.com/en/docs/ModelArk/1541523)

### 5.4 响应结构

官方响应形态：

```json
{
  "model": "dola-seedream-5-0-pro-260628",
  "created": 1784696685,
  "data": [
    {
      "url": "https://...",
      "size": "2048x2048",
      "output_format": "jpeg",
      "z_index": 0
    },
    {
      "url": "https://...",
      "size": "1273x265",
      "output_format": "png",
      "z_index": 1,
      "bounding_box": {
        "absolute": [383, 120, 1655, 384],
        "normalized": [187, 59, 808, 188]
      },
      "name": "Seedream title text",
      "description": "Large yellow Seedream title text in a serif font"
    }
  ],
  "usage": {
    "input_images": 1,
    "generated_images": 8,
    "output_tokens": 23107,
    "total_tokens": 23107
  }
}
```

字段含义：

| 字段 | 含义 |
|---|---|
| `z_index` | base 固定为 0；图层从 1 递增；值越大越靠上 |
| `bounding_box.absolute` | base 坐标系内的 `[left, top, right, bottom]` 像素坐标 |
| `bounding_box.normalized` | 映射到 `[0,1000]` 的归一化坐标 |
| `name` | 模型生成的图层名称 |
| `description` | 模型生成的颜色、状态、材质等语义描述 |
| `output_format` | 每个产物实际格式；base 可以是 JPEG，分离层为 PNG |
| `usage.input_images` | Pro 新增的输入图片计数 |
| `usage.generated_images` | 实际生成的图片数量，包含多个图层产物 |

恢复图层时，官方建议按 `bounding_box.absolute` 缩放并放回 base 坐标系，再按 `z_index` 升序叠加。来源：[BytePlus 图片生成 API：图层响应字段](https://docs.byteplus.com/en/docs/ModelArk/1541523) · [Ark Runtime Go SDK `images` 类型](https://pkg.go.dev/github.com/volcengine/ark-runtime-go/arkruntime/model/images)

## 6. 普通图片生成 / 编辑限制

Seedream 5.0 Pro 普通图片场景已确认：

- 文生单图；
- 单参考图 + Prompt 生成单图；
- 2–10 张参考图 + Prompt 生成单图；
- 不支持 `sequential_image_generation`；
- 不支持流式输出；
- 不支持 web search；
- 生成尺寸档位支持 `1K`、`1.5K`、`2K`，默认 `2K`；
- 自定义像素尺寸总像素范围为 921,600–4,624,220，宽高比 `[1/16,16]`。

普通图片输入限制：JPEG、PNG、WebP、BMP、TIFF、GIF、HEIC、HEIF；单图宽高均大于 14 px；最大 30 MB；总像素不超过 36,000,000；宽高比 `[1/16,16]`。

来源：[BytePlus 图片生成 API：Image generation capabilities by model](https://docs.byteplus.com/en/docs/ModelArk/1541523)

## 7. 同步、返回方式与产物下载

### 7.1 同步边界

- 官方 Ark CLI 明确：图片任务同步返回；视频任务才默认提交异步任务并返回 `task_id`。
- Seedream 5.0 Pro 不支持图片 streaming。
- 因此 Pro 图片调用应视为一次长耗时同步 HTTP 请求，而不是“提交任务 → 轮询”。

来源：[Ark CLI `+gen` 说明](https://github.com/volcengine/ark-cli/blob/main/skills/arkcli-gen/references/arkcli-gen.md) · [BytePlus 图片生成 API](https://docs.byteplus.com/en/docs/ModelArk/1541523)

### 7.2 返回方式

`response_format` 支持：

- `url`：`data[].url`；
- `b64_json`：`data[].b64_json`。

URL 在生成后 24 小时内有效，必须及时下载。Ark CLI 的同步路径默认自动下载到 `--save-to` 指定目录，并返回 `local_path/local_paths`；传 `--save-to=""` 可关闭下载。下载失败不会让生成任务本身失败。

来源：[BytePlus 图片生成 API](https://docs.byteplus.com/en/docs/ModelArk/1541523) · [Ark CLI `+gen` 返回值与下载说明](https://github.com/volcengine/ark-cli/blob/main/skills/arkcli-gen/references/arkcli-gen.md)

## 8. Ark CLI 与 SDK 当前覆盖范围

### 8.1 Ark CLI

官方 `arkcli +gen` 当前公开参数中包含：

- `--input`；
- `--size`；
- `--output-format`；
- `--response-format`；
- `--stream`；
- `--save-to`。

但公开 `+gen` 文档尚未列出 `--background` 或 `--layer-decomposition`。因此不能假设 `+gen` 高层命令已经暴露这两个参数。官方 CLI 同时提供底层 API 调用能力，但具体 Action 名与参数应以当前安装版本 `arkcli api ...` 的在线 Schema 为准。

来源：[Ark CLI `+gen` 全参数](https://github.com/volcengine/ark-cli/blob/main/skills/arkcli-gen/references/arkcli-gen.md)

### 8.2 官方 Go SDK

官方 `ark-runtime-go` v0.4.0 的 `CreateImageGenerationRequest` 已包含：

```text
layer_decomposition
output_format
response_format
image
size
```

`ImageDataItem` 已包含：

```text
url / b64_json / size / output_format
z_index / bounding_box / name / description
```

该版本没有 `background` 命名字段。这个缺失只能说明该 SDK 的强类型表面尚未覆盖它，不能推导服务端一定不支持；BytePlus 官方 REST 文档已经明确支持该字段。

来源：[Ark Runtime Go SDK `images` 包](https://pkg.go.dev/github.com/volcengine/ark-runtime-go/arkruntime/model/images)

## 9. 当前可确认与不可确认清单

| 事项 | 结论 |
|---|---|
| BytePlus Pro Model ID | 已确认：`dola-seedream-5-0-pro-260628` |
| 中国区 Pro Model ID | **未确认**；必须由目标账号 Ark CLI/控制台实时返回 |
| Pro 支持 `background=transparent` | BytePlus 已确认；中国区未确认 |
| transparent 输出 PNG Alpha | BytePlus 已确认 |
| transparent 输入必须带 Alpha | BytePlus 已确认 |
| 全不透明 RGBA 输入能否稳定获得透明主体 | **未确认** |
| Pro 支持图层分离 | BytePlus 已确认；官方 Go SDK已出现结构；中国区账号开放情况未确认 |
| 图层最大数量 | BytePlus 已确认：最多 16 个分离层，另有 1 张 base |
| 每个分离层带 Alpha | BytePlus 已确认 |
| 图层请求部分成功 | 不支持；任一层失败则整次失败 |
| background 与 layer decomposition 同传 | **未确认** |
| Pro 支持流式 | 不支持 |
| Pro 支持组图 | 不支持 |
| 图片是否异步轮询 | 否；官方链路是同步响应 |
| URL 有效期 | 已确认：24 小时 |

## 10. 官方来源索引

1. [BytePlus ModelArk：Image generation API](https://docs.byteplus.com/en/docs/ModelArk/1541523)（页面标注最后更新：2026-08-12）
2. [火山方舟 API Explorer：ImageGenerations](https://api.volcengine.com/api-explorer/?action=ImageGenerations&groupName=%E5%9B%BE%E7%89%87%E7%94%9F%E6%88%90API&serviceCode=ark&version=2024-01-01)
3. [火山引擎官方 Ark CLI：`+gen`](https://github.com/volcengine/ark-cli/blob/main/skills/arkcli-gen/references/arkcli-gen.md)
4. [火山引擎官方 Ark CLI：模型查询](https://github.com/volcengine/ark-cli/blob/main/skills/arkcli-models/SKILL.md)
5. [火山引擎官方 Ark CLI：模型推荐表及实时校验边界](https://github.com/volcengine/ark-cli/blob/main/skills/arkcli-models/references/arkcli-models-scenario-table.md)
6. [火山引擎官方 Ark Runtime Go SDK：`images` 包](https://pkg.go.dev/github.com/volcengine/ark-runtime-go/arkruntime/model/images)
