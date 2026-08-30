# Seedream 5.0 Pro 方舟 Python SDK 与透明 PNG 迁移技术方案

> 状态：已实施，待真实沙箱验证  
> 目标版本：MVP2 量化增强版  
> 方案日期：2026-08-29  
> 适用范围：`apps/api`，兼容现有 `apps/web` 转换接口  
> 实施结果：SDK、原生 Alpha 主链路、配置与测试已完成；付费沙箱门禁尚未执行

## 1. 结论

将现有自行组装 `POST /images/generations` 的 `httpx` 客户端迁移为火山引擎官方 Python SDK：

```bash
pip install 'volcengine-python-sdk[ark]'
```

正式路径直接使用中国区 Doubao-Seedream 5.0（本方案中等同于产品所说的 5.0 Pro）：

```text
doubao-seedream-5-0-260128
```

不保留 `SEEDREAM_PRO_TEST_ENABLED` 试验开关，不再默认调用 Lite，也不在代码中使用 BytePlus 国际区的 `dola-seedream-5-0-pro-260628`。中国区和 BytePlus 的 Base URL、API Key 与 Model ID 不能混用。

Solid 转换请求固定使用：

```python
background="transparent"
output_format="png"
response_format="b64_json"
```

Seedream 直接返回带 Alpha 的 PNG，后端验证原生 Alpha 后再进入 MARD 网格量化，不再把动态键色作为 Solid 主路径。`keep` / `simplify` 不能强制透明，否则会破坏“保留背景”和“简化背景”的现有产品语义；这两种模式仅固定 `output_format="png"`，省略 `background`。

## 2. 官方契约与模型命名

### 2.1 SDK 调用形态

方舟 SDK 的目标调用形态如下：

```python
from volcenginesdkarkruntime import Ark

client = Ark(
    api_key=api_key,
    base_url="https://ark.cn-beijing.volces.com/api/v3",
    timeout=timeout,
    max_retries=0,
)

response = client.images.generate(
    model="doubao-seedream-5-0-260128",
    image=image_data_url,
    prompt=prompt,
    size="2K",
    background="transparent",
    output_format="png",
    response_format="b64_json",
    watermark=False,
)
```

成功响应通过对象属性读取 `response.data[0].b64_json`、`response.model` 和 `response.usage.generated_images`，不再手写 JSON 字典解析。

SDK 安装方式和 `Ark` 调用形态以火山引擎官方 SDK 仓库为准：[火山引擎 Python SDK](https://github.com/volcengine/volcengine-python-sdk)。图片生成字段、响应结构和错误码以[火山方舟图片生成 API](https://www.volcengine.com/docs/82379/1541523?lang=zh)为准。

### 2.2 中国区的“5.0 Pro”命名

中国区已有官方资料可交叉核对的 5.0 固定 ID 是 `doubao-seedream-5-0-260128`；Lite 才带 `-lite-` 后缀。BytePlus 国际区使用的 `dola-seedream-5-0-pro-260628` 不能透传到 `cn-beijing` 端点。参见[火山引擎 Seedream 5.0 发布记录](https://www.volcengine.com/docs/6492/2165228?lang=en)。

因此实施时将“Pro”解释为中国区非 Lite 的 `doubao-seedream-5-0-260128`，不凭名称猜测一个 `doubao-...-pro-...` ID。如当前账号控制台要求使用 `ep-...` 接入点，必须先确认其后绑定的是同一 5.0 非 Lite 模型。

### 2.3 待实际账号确认的边界

中国区官方发布记录已说明 Seedream 5.0 系列增加 `output_format`；当前公开可抓取的中国区 API Schema 未完整展示 `background=transparent` 的逐项说明。本方案按官方文档的当前能力设计，但实施后必须用项目实际 `cn-beijing` 账号完成一次不含用户素材的沙箱验证：

1. 请求同时接受 `background="transparent"` 和 `output_format="png"`；
2. 响应实际是 PNG，不是仅扩展名为 PNG；
3. PNG 存在有效 Alpha，不是全 255；
4. 当前 Model ID / Endpoint ID 已开通、可计费且地域正确。

任一项失败都不能静默回退 Lite 或假装已获得透明图。

## 3. 现状与迁移目标

当前代码的 `SeedreamClient` 直接使用 `httpx.Client`，手工处理 Bearer Header、URL、JSON、Base64、请求 ID 和 HTTP 异常。工作区还存在一组未提交的 Pro 实验改动：

- `SEEDREAM_PRO_TEST_ENABLED` 在 Lite 和 5.0 之间分支；
- `dependencies.py` 内存在模型字符串硬编码和注释切换；
- 手写 HTTP payload 已开始加入 `background` / `output_format`；
- `SeedreamEnhancer` 仍对外声明 `seedream-5-lite`；
- Solid 路径仍强制生成 `chroma_key` hint，`ForegroundPreparer` 也仍要求动态键色协议。

迁移不是只把 `httpx.post()` 换成 `client.images.generate()`；必须同时收敛模型配置、背景模式、Alpha 校验、错误映射、资源释放与公开元数据。

## 4. 目标调用链

```text
POST /api/v1/conversions
  -> ForegroundPreparer.prepare()
  -> SeedreamEnhancer.enhance()
  -> SeedreamClient（项目适配层）
  -> volcenginesdkarkruntime.Ark.images.generate()
  -> b64_json -> Base64/PNG/像素上限校验
  -> Solid: 原生 Alpha 验证
  -> MARD 网格量化
  -> 现有 JSON 响应
```

保留项目内部 `SeedreamClient` 这个深模块，但将它改为官方 SDK 的窄适配器。业务层不直接依赖 SDK 的响应类型和异常类型，仍只使用现有 `SeedreamResult` / `SeedreamUpstreamError`。这样可以保持 `SeedreamEnhancer` 和路由稳定，也避免 SDK 升级扩散到整个代码库。

## 5. 详细设计

### 5.1 依赖与容器构建

`apps/api/pyproject.toml` 增加 `volcengine-python-sdk[ark]`。实施时先记录沙箱验证通过的确切 SDK 版本，再写入受控版本范围，不使用无上界的浮动依赖。

`deploy/api.Dockerfile` 已通过 `pip install /app/apps/api` 安装项目依赖，无需另写一条独立 SDK 安装命令。如迁移后业务源码和测试不再直接 import `httpx`，可移除项目对 `httpx` 的直接声明；否则必须保留，不依赖 SDK 的传递依赖。

### 5.2 SDK 客户端生命周期

`get_image_enhancer()` 仍然只构造一个进程级 `Ark` 客户端，由 FastAPI lifespan 在退出时调用 `close()`。不允许每次转换新建连接池。

建议显式配置：

- `base_url=ARK_DOUBAO_BASE_URL`；
- 保留现有连接/读/写/连接池超时语义；如 SDK 只接受统一 timeout，则在适配层明确记录语义变化；
- `max_retries=0`，保持当前单次图片生成的计费边界，避免 SDK 默认重试造成重复生成与重复计费；
- 继续用 `BoundedSemaphore` 限制项目内并发和排队时间。

### 5.3 请求参数策略

| 产品背景模式 | `background` | `output_format` | 后端处理 |
|---|---|---|---|
| `solid` | `"transparent"` | `"png"` | 验证原生 Alpha，主体层量化后再由现有渲染层铺 `background_color` |
| `simplify` | 省略 | `"png"` | 保留简化后场景，不把背景强制扣透明 |
| `keep` | 省略 | `"png"` | 保留原背景语义 |

5.0 非 Lite 单图路径不发送 `sequential_image_generation`，也不发送 `stream`；这两个字段不再从旧 Lite 请求体照搬。继续只允许一张输入图与一张输出图。

`background` 必须从 `edit_image()` 的当次请求传入，不能像当前试验改动一样固化在 `SeedreamClient.__init__()`，否则三种产品背景模式无法保持正确语义。

### 5.4 响应与内存上限

适配层必须继续检查：

- `data` 中恰好一张图；
- `b64_json` 非空且是严格 Base64；
- Base64 解码后字节数不超限；
- Pillow 识别的实际格式为 PNG；
- 实际宽高与总像素不超限；
- 不信任响应中声明的 `size` 或 MIME。

需要明确一个迁移差异：现有手写 HTTP 客户端在 JSON 还未完全读入内存前就可以按响应体字节数中止；SDK 的普通对象调用会先物化响应。因此 `ARK_DOUBAO_MAX_RESPONSE_BYTES` 只能精确限制解码后图片，不再是网络 JSON 流的硬上限。实施前需用所选 SDK 版本确认是否提供可用的 raw/streaming response API；若没有，以单图、并发上限、输出像素上限和 Base64 解码后字节上限共同控制内存风险，并在发布说明中记录这一差异。

### 5.5 原生 Alpha 验证

Pillow 的 `convert("RGBA")` 会给不透明图人工添加全 255 Alpha，因此必须在转换之前检查原图：

1. 容器是 PNG；
2. 原图包含 Alpha band 或可验证的 PNG 透明信息；
3. Alpha 同时存在前景与透明区域，不是全 0 或全 255；
4. 透明/前景覆盖率、边界连通性和主体核心保护通过统一前景策略；
5. 只有验证通过后才转为独立 RGBA 图片。

`EnhancementResult` 应返回“上游声明为原生 Alpha”的类型化 hint，但不由 `SeedreamEnhancer` 宣称蒙版已可信。`ForegroundPreparer` 仍是唯一的背景能力 seam，由它完成统一验证并返回：

```text
background_processing = "native_alpha"
```

验证失败时返回稳定的 `AI_BACKGROUND_SEPARATION_FAILED`，不静默当作成功透明 PNG。已有 ONNX 能力可作为显式配置的降级路径，但不应在本次迁移中把动态键色继续伪装成 Pro 原生透明主路径。

### 5.6 SDK 错误映射

`SeedreamClient` 捕获 SDK 的连接、超时、HTTP/API 错误，统一转成现有 `SeedreamUpstreamError`。业务层继续映射为：

| 上游情况 | 对外业务错误 |
|---|---|
| 连接失败 | `502 AI_UPSTREAM_ERROR` |
| 超时 | `504 AI_TIMEOUT` |
| `InputTextSensitiveContentDetected` | `400 AI_INPUT_REJECTED` |
| `OutputImageSensitiveContentDetected` | `422 AI_OUTPUT_REJECTED` |
| `QuotaExceeded` / 429 | `429 AI_BUSY` |
| 鉴权、模型未开通、参数不支持、响应结构错误 | `502 AI_UPSTREAM_ERROR` |

日志只记录 HTTP 状态、上游 code、request ID、模型、耗时与生成张数，不记录 API Key、Base64 图片或完整用户素材。

### 5.7 对外元数据与 Web 兼容

将 API 元数据中的 enhancer 标识从 `seedream-5-lite` 迁移为 `seedream-5-pro`，并新增 `background_processing="native_alpha"`。这两个字段都是元数据，不改变网格 JSON 的尺寸、palette、rows、背景层和统计字段。

`apps/web/src/lib/types.ts` 必须同步扩展字面量类型，使已部署的现有 UI 不需增加交互或请求字段即可消费新元数据。不提升 `schema_version`：当前变化是已有元数据枚举的能力扩展，不改变主体网格契约。

## 6. 配置调整

删除：

```dotenv
SEEDREAM_PRO_TEST_ENABLED
```

保留并更新默认值：

```dotenv
IMAGE_ENHANCER=seedream
ARK_DOUBAO_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_DOUBAO_IMAGE_MODEL=doubao-seedream-5-0-260128
ARK_DOUBAO_IMAGE_SIZE=2K
ARK_DOUBAO_RESPONSE_FORMAT=b64_json
ARK_DOUBAO_WATERMARK=false
```

`background="transparent"` 和 `output_format="png"` 是本次 Solid 转换契约，不提供可误配为 JPEG/不透明的生产开关。如为运维可观测需要保留环境变量，启动校验也必须只允许 `png` / `transparent`，不接受任意值。

## 7. 文件变更范围

| 文件 | 变更 |
|---|---|
| `apps/api/pyproject.toml` | 增加 Ark SDK extra，视最终 import 情况决定是否保留直接 `httpx` 依赖 |
| `apps/api/src/pindou/services/seedream_client.py` | 改为 `Ark.images.generate()` 适配器，保留项目 DTO 和稳定异常 |
| `apps/api/src/pindou/services/seedream_enhancer.py` | 传递按模式计算的 background，验证 PNG 原始透明信息，更新 enhancer 标识 |
| `apps/api/src/pindou/services/seedream_prompt.py` | 更新原生透明输出约束与 prompt 版本 |
| `apps/api/src/pindou/api/dependencies.py` | 删除 Pro 试验分支与模型硬编码，构造 SDK 客户端 |
| `apps/api/src/pindou/core/config.py` | 删除试验开关，默认模型切换到 5.0 非 Lite |
| `apps/api/src/pindou/imaging/foreground.py` | 新增原生 Alpha 验证主路径，收敛动态键色依赖 |
| `apps/api/src/pindou/services/enhancer.py` | 表达 native-alpha hint/状态，不把上游声明直接当作可信蒙版 |
| `apps/api/src/pindou/schemas/conversion.py` | 扩展 `seedream-5-pro` 和 `native_alpha` 枚举 |
| `apps/web/src/lib/types.ts` | 同步元数据字面量，不改页面交互 |
| `apps/api/.env.example`, `deploy/.env.example` | 移除试验开关，更新模型说明 |
| `apps/api/README.md` | 将 Lite/动态键色说明更新为 Pro/原生 Alpha |
| `apps/api/tests/test_seedream.py` | 改为 SDK fake 测试，不依赖 SDK 内部 HTTP 实现 |
| `apps/api/tests/test_foreground.py`, `apps/api/tests/test_api.py` | 新增 native Alpha 成功/拒绝/降级与公开元数据测试 |

实施时必须以当前未提交改动为基础做小范围补丁，不覆盖现有 ONNX、动态键色、备份和环境变量文档改动。

## 8. 测试方案

### 8.1 单元测试

- SDK adapter 收到的 `model` 固定为配置的 5.0 非 Lite ID；
- Solid 发送 `background="transparent"` 和 `output_format="png"`；
- Keep/Simplify 省略 `background`，但仍发送 `output_format="png"`；
- 不发送 `sequential_image_generation` 和 `stream`；
- 正确读取 SDK 对象响应并生成 `SeedreamResult`；
- 空 `data`、多图、空 Base64、非法 Base64、超字节图均稳定失败；
- SDK 连接、超时、限流、审核和服务端异常正确映射；
- `close()` 只调用一次且可由 lifespan 管理。

SDK 边界使用项目自定义 Protocol/fake，不通过 `httpx.MockTransport` 锁定官方 SDK 的内部传输层。

### 8.2 图片与前景测试

- PNG + 有效透明 Alpha：返回 `native_alpha`；
- PNG 无 Alpha：拒绝；
- PNG Alpha 全 255：拒绝；
- PNG Alpha 全 0：拒绝；
- JPEG 伪装成 PNG 响应：拒绝；
- 损坏图片、解压炸弹、超像素上限：拒绝；
- 主体外背景与四肢/躯干间真实封闭空洞为 Alpha=0；
- 主体内部特征不得被误删；
- Solid 背景色仍由独立渲染层铺设，不参与前景 MARD 颜色计数。

### 8.3 API 回归

- 现有 multipart 请求字段不变；
- `schema_version` 和网格结构不变；
- `keep` / `simplify` 不会因透明参数而丢失背景；
- `solid` 响应的空格、豆数、颜色数与背景层语义不变；
- 现有 Web 预览、Canvas 和导出测试通过。

### 8.4 真实沙箱

真实测试使用专用标记或脚本手动执行，CI 默认不发起付费请求。固定测试集至少覆盖：单人、多人、细肢体、白色主体、透明/半透明物体、主体贴边与复杂背景。每张记录模型、request ID、耗时、图片字节数、Alpha 覆盖率和主体误删率。

## 9. 验收标准

1. 业务代码不再手写 Ark HTTP 请求，只通过 `volcenginesdkarkruntime.Ark` 调用。
2. 默认且正式路径使用 `doubao-seedream-5-0-260128`，不存在 Lite/Pro 试验切换。
3. Solid 请求发送 `background="transparent"` + `output_format="png"`，并能获得实际透明 PNG。
4. 非 PNG、无 Alpha、全不透明或全透明输出都不会被当作成功。
5. `keep` / `simplify` 的现有背景语义无回归。
6. FastAPI 公开请求契约不变，Web 只需同步元数据字面量。
7. 内容安全、限流、超时与上游错误仍映射为稳定业务错误。
8. API 和 Web 全量单元测试、静态检查通过，真实沙箱门禁通过后才发布。

## 10. 发布与回滚

1. 先合入 SDK adapter 与 fake 测试，不用真实 Key 跑 CI。
2. 在测试环境用非敏感固定图跑真实沙箱，验证模型、参数、Alpha 和计费。
3. 小流量发布，观测 P50/P95 耗时、`AI_UPSTREAM_ERROR`、`AI_BACKGROUND_SEPARATION_FAILED`、Alpha 覆盖率和单张费用。
4. 通过后扩大流量，保留当前版本容器镜像作为回滚点。
5. 回滚使用上一版本镜像，不在新版本中静默切回 Lite；这样才能保证“直接使用 5.0 Pro”的配置可审计。

## 11. 已确认产品决策

本次实施请求已确认以下两个产品决策：

1. Solid 模式使用原生透明 PNG，`keep` / `simplify` 省略 `background="transparent"` 以保留现有语义。
2. 中国区“5.0 Pro”直接落到官方非 Lite ID `doubao-seedream-5-0-260128`；如账号只提供 `ep-...`，则使用绑定同模型的 Endpoint ID。

## 12. 实施记录

实施日期：2026-08-29。

- 使用本机已安装并验证接口的 `volcengine-python-sdk 5.0.47`，依赖范围固定为
  `volcengine-python-sdk[ark]>=5.0.47,<6`。
- 该版本的 `images.generate()` 已公开 `output_format`，但尚未公开独立的
  `background` 命名参数；Solid 通过 SDK 官方 `extra_body={"background": "transparent"}`
  扩展口发送同名请求字段，业务代码不再手写 HTTP。
- API 测试 173 通过、3 个按本地模型资产条件跳过；API Ruff 检查通过。
- Web 测试 46 通过，公开请求字段和网格 Schema 保持不变。
- 尚未使用真实项目 Key 发起付费请求；第 2.3 节的模型开通、参数接受、实际 PNG 和
  有效 Alpha 四项仍是发布前门禁，不得仅凭 fake 测试判定线上能力已开通。
