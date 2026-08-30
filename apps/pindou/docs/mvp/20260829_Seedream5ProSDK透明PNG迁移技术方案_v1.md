# Seedream 5.0 Pro SDK 透明 PNG 迁移技术方案

> 状态：待实施  
> 目标版本：MVP2 量化增强版  
> 方案日期：2026-08-29  
> 适用范围：`apps/api` 的 Seedream 供应商适配、Solid 前景准备、配置与测试；兼容现有 `apps/web` 转换接口和响应 Schema  
> 评审结论：未确认前不修改业务代码，不进行付费真实调用

## 1. 结论摘要

本方案将项目中手写的 `httpx` `POST /images/generations` 客户端迁移为火山引擎官方 Python SDK：

```bash
pip install 'volcengine-python-sdk[ark]'
```

官方 Ark Runtime 的 Python 导入与图片调用入口为：

```python
from volcenginesdkarkruntime import Ark

client = Ark(
    api_key=ark_api_key,
    base_url="https://ark.cn-beijing.volces.com/api/v3",
    timeout=90.0,
    max_retries=0,
)
response = client.images.generate(
    model="doubao-seedream-5-0-260128",
    prompt=prompt,
    image=image_data_url,
    size="2K",
    stream=False,
    response_format="b64_json",
    background="transparent",
    output_format="png",
    watermark=False,
)
```

但在把上述片段当作生产契约前，必须区分三类证据：

1. **已有官方证据**：SDK 包名、`Ark` 导入、`client.images.generate(...)`、北京区 Base URL、API Key 鉴权、`image`、`response_format="b64_json"` 和非流式图片响应结构。
2. **官方发布记录可证明，但须以账号模型列表为准**：中国区已出现固定 ID `doubao-seedream-5-0-260128`。当前可复核资料未能证明中国区存在 `doubao-seedream-5-0-pro-260628` 这个 ID，禁止在代码中凭名称拼接。
3. **实施前的强制门禁**：当前可复核的中国区公开 `ImageGenerations` 参数正文未完整呈现 `background="transparent"` 和 `output_format="png"` 的 Seedream 5.0 Pro 逐字段约束。`output_format` 可由火山引擎官方 Seedream 5.0 发布记录交叉支持，`background="transparent"` 则必须在当前账号 API Explorer/SDK 示例页看到字段后再实施。本文不把其他地域或未核验名称推断为中国区契约。

方案建议直接使用 5.0 目标模型，不再保留 `SEEDREAM_PRO_TEST_ENABLED` 这种运行时 Lite/Pro 暗切换；同时保留旧键色/ONNX 策略作为发布期间可回滚实现，不在首个迁移版本删除。

## 2. 官方能力核验

### 2.1 证据矩阵

| 事项 | 结论 | 实施含义 | 第一方来源 |
| --- | --- | --- | --- |
| 官方 Python SDK | 安装 `volcengine-python-sdk[ark]`，导入 `volcenginesdkarkruntime.Ark` | 改用 `Ark` 长生命周期客户端 | [火山引擎官方 Python SDK 仓库](https://github.com/volcengine/volcengine-python-sdk) · [官方 PyPI 包](https://pypi.org/project/volcengine-python-sdk/) |
| 调用入口 | `client.images.generate(...)` | `SeedreamClient` 保留项目 DTO，内部换为 SDK | [官方 SDK 仓库 Ark Runtime](https://github.com/volcengine/volcengine-python-sdk/tree/main/volcenginesdkarkruntime) · [火山方舟产品简介/调用示例](https://www.volcengine.com/docs/82379/1795150) |
| 地域与鉴权 | 北京区 `https://ark.cn-beijing.volces.com/api/v3`，API Key 仅服务端持有 | 项目继续显式传 `api_key`/`base_url` | [火山方舟产品简介](https://www.volcengine.com/docs/82379/1795150) · [ImageGenerations API](https://api.volcengine.com/api-docs/view?action=ImageGenerations&serviceCode=ark&version=2024-01-01) |
| 图片编辑 | `image` 可传 URL/Base64，Seedream 支持参考图编辑 | 项目保持 PNG Data URL 输入 | [图片生成 API](https://www.volcengine.com/docs/82379/1541523?lang=zh) · [Seedream 4.0–5.0 提示词指南](https://www.volcengine.com/docs/82379/1829186) |
| 非流式单图 | `stream=False`，返回 `model`/`data[]`/`usage` | 单次转换严格要求唯一图片 | [ImageGenerations API](https://api.volcengine.com/api-docs/view?action=ImageGenerations&serviceCode=ark&version=2024-01-01) |
| Base64 响应 | `response_format="b64_json"`，图片在 `data[].b64_json` | 不新增临时 URL 下载/SSRF 链路 | [图片生成 API](https://www.volcengine.com/docs/82379/1541523?lang=zh) |
| 5.0 中国区 ID | 官方发布记录出现 `doubao-seedream-5-0-260128` | 作为本方案的中国区目标 ID；启用前必须在项目账号模型列表复核 | [火山引擎官方发布记录](https://www.volcengine.com/docs/6492/2165228?lang=en) · [火山方舟模型列表入口](https://www.volcengine.com/docs/82379/1330310?lang=zh&redirect=1) |
| `output_format="png"` | 官方 5.0 发布记录确认新增 `output_format`；中国区当前账号 Schema 仍要作为上线证据 | SDK 调用中显式传 `png`，不允许默默改回 JPEG | [火山引擎官方发布记录](https://www.volcengine.com/docs/6492/2165228?lang=en) · [ImageGenerations API Explorer](https://api.volcengine.com/api-explorer/?action=ImageGenerations&groupName=%E5%9B%BE%E7%89%87%E7%94%9F%E6%88%90API&serviceCode=ark&tab=2&version=2024-01-01) |
| `background="transparent"` | **本次可复核的中国区公开正文未能独立证实** | 必须在 API Explorer 选定目标模型，保存参数说明/SDK 生成示例作为实施附件；不可仅因 SDK 接受 `**kwargs` 就宣称服务端支持 | [图片生成 API](https://www.volcengine.com/docs/82379/1541523?lang=zh) · [ImageGenerations API Explorer](https://api.volcengine.com/api-explorer/?action=ImageGenerations&groupName=%E5%9B%BE%E7%89%87%E7%94%9F%E6%88%90API&serviceCode=ark&tab=2&version=2024-01-01) |
| 错误结构 | 内容安全、配额/429 和 `error` 对象有官方定义 | 保留现有稳定业务错误映射 | [ImageGenerations 错误码](https://api.volcengine.com/api-docs/view?action=ImageGenerations&serviceCode=ark&version=2024-01-01) |

### 2.2 模型 ID 的决策

目标地域是中国区 `cn-beijing`。本方案只接受两类配置：

- 当前账号模型列表显示的固定 Model ID；按现有官方发布证据，目标值是 `doubao-seedream-5-0-260128`。
- 当前账号已为该模型建立的 `ep-...` Endpoint ID。

本方案不接受以下做法：

- 把未在中国区官方模型列表确认的 `doubao-seedream-5-0-pro-260628` 写死在 `dependencies.py`；
- 将其他地域的 `dola-...` / `seedream-...` ID 与 `ark.cn-beijing.volces.com` 混用；
- 依靠返回中的 `model` 字段反向猜测计费模型。

如 API Explorer 不再显示 `doubao-seedream-5-0-260128`，实施状态保持“待实施”，不自动回退 Lite。

### 2.3 SDK 版本与类型定义门禁

当前 `apps/api` 没有 Python lockfile，也没有安装官方 SDK。因此本方案不凭空写一个已可能过期的 SDK 版本号。实施提交必须：

1. 从[官方 PyPI](https://pypi.org/project/volcengine-python-sdk/) 解析当日稳定版；
2. 将已验证的确切版本固定在 `pyproject.toml`/部署产物中，禁止生产每次无界升级；
3. 直接检查该版本 `images.generate` 的类型签名是否显式包含 `background` 和 `output_format`；
4. 直接检查该版本公开异常类与请求 ID 属性，再完成稳定错误映射。

安装 extra 使用引号是必要的，避免 zsh 将 `[...]` 解释为 glob：

```bash
pip install 'volcengine-python-sdk[ark]'
```

## 3. 现状与问题

### 3.1 当前实现

仓库当前工作树中：

- `apps/api/src/pindou/services/seedream_client.py` 用 `httpx.Client` 手写 Bearer Header、JSON 请求、流式读取与 Base64 解码；
- `apps/api/src/pindou/api/dependencies.py` 组装 `httpx.Timeout`、模型、背景和输出格式；
- `apps/api/src/pindou/core/config.py` 默认模型仍是 `doubao-seedream-5-0-lite-260128`，并有 `seedream_pro_test_enabled` 实验开关；
- `apps/api/src/pindou/services/seedream_enhancer.py` 把上游二进制图解码并统一 `convert("RGBA")`；因为 JPEG 也会被转成 RGBA，“有 A 通道”不等于“上游返回真透明 PNG”；
- Solid 转换中，`ForegroundPreparer.prepare()` 无条件把 `background_hint_kind` 改为 `chroma_key`，并强制要求 `BackgroundHint`；
- `compose_solid_alpha()` 以键色连通性和保护核心生成 Alpha，ONNX 只在通过一致性检验后做边缘补充；
- `build_bead_grid()` 只消费前景 RGBA，Solid 背景是响应渲染层，不进前景调色板和豆数。

工作树已有用户未提交修改，包括 Pro/PNG 实验字段。本方案只记录现状，不将这些实验改动当作已完成实现，也不覆盖根目录 `20260829_Seedream5Pro透明PNG测试方案_v1.md`。

### 3.2 当前实验改动不能直接上线的原因

1. `dependencies.py` 中模型 ID 是条件硬编码，且留有相互矛盾的注释 ID，配置无法成为唯一事实源。
2. `background='transparent'` 目前被放在客户端构造参数中，会同时影响 `solid`/`keep`/`simplify`。`keep` 和 `simplify` 不应无条件删除背景；该参数必须按每次调用传入。
3. `require_alpha` 检查代码被注释，就算打开开关也不能建立透明成功契约。
4. 只检查 Alpha 不全 255 过于宽松：单个噪点、图片整体几乎全透明，或背景仍大面积不透明都可能被误判。
5. 既有 Solid 编排仍强制要求键色 Hint，原生 Alpha 即使有效也会在进入量化前被拒绝或重做键色/ONNX。
6. 手写 HTTP 客户端与用户要求的官方 SDK 接入方式不一致。

## 4. 目标与非目标

### 4.1 目标

- 生产 Seedream 调用只通过官方 Ark Runtime SDK。
- 模型唯一事实源是经账号核验的 `ARK_DOUBAO_IMAGE_MODEL`，目标固定 Model ID 为 `doubao-seedream-5-0-260128`，不默默回退 Lite。
- Solid 模式的 Seedream 请求显式传 `background="transparent"` 和 `output_format="png"`。
- 上游结果必须经过文件容器、Base64、尺寸、像素、Alpha 覆盖率和前景/背景可用性验证，不信任扩展名、SDK 类型或 `RGBA` 模式本身。
- 原生 Alpha 验证成功时直接进入现有方形适配/量化，不再执行动态键色、`solid-alpha-v2` 或 ONNX。
- 现有 `apps/web` 请求字段、响应主体、Solid 渲染和豆数语义保持不变。
- 错误、超时、内容安全、限流和返回结构不合格均映射为稳定业务错误码，不暴露 Key、Base64 或上游敏感文本。

### 4.2 非目标

- 不让前端直连火山方舟。
- 不改造现有 `POST /api/v1/conversions` 公开表单契约。
- 不让 Seedream 直接生成最终 MARD 色号或网格；量化仍由本地确定性算法完成。
- 不在首版删除 `chroma_key.py`、`solid_alpha.py`、ONNX 模型和回归测试。
- 不默默发起第二次付费请求来补救无效 Alpha。
- 不在未获得官方参数 Schema 或当前账号模型授权时把该路径发布到生产。

## 5. 目标设计

### 5.1 调用边界

```text
Conversion route
  -> ForegroundPreparer
    -> SeedreamEnhancer（Prompt、输入 PNG Data URL、图片安全校验）
      -> SeedreamClient（项目 DTO / 稳定异常）
        -> Ark.images.generate（官方 SDK）
    -> NativeAlphaValidator（Solid 专用）
  -> build_bead_grid
  -> 现有 API response / apps/web 渲染
```

`SeedreamClient` 仍保留在项目中，但它不再实现 HTTP 协议，而是抹平官方 SDK 版本的返回模型和异常差异。业务层不应直接依赖 SDK 对象。

### 5.2 SDK 依赖

`apps/api/pyproject.toml` 新增：

```toml
dependencies = [
  # 其他依赖……
  "volcengine-python-sdk[ark]==<实施日验证版本>",
]
```

实施时的版本选择标准：

- PyPI 发布方和项目链接必须指向火山引擎官方仓库；
- `images.generate` 签名包含本方案所需参数；
- 异常类和超时参数有公开、可测试的 API；
- 锁定实际验证版本，不仅写无上界的 `>=`。

迁移后如生产代码和测试已无直接 `httpx` 导入，可从项目显式依赖移除 `httpx>=0.28,<1`；不得为了删依赖去使用 SDK 的私有 transport API。

### 5.3 SDK 调用样例

以下是目标形状，实施提交需按锁定 SDK 版本的公开类型签名微调：

```python
from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass

from volcenginesdkarkruntime import Ark


@dataclass(frozen=True, slots=True)
class SeedreamResult:
    image_bytes: bytes
    model: str
    size: str | None
    generated_images: int
    upstream_request_id: str | None


class SeedreamClient:
    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        model: str,
        image_size: str,
        watermark: bool,
        timeout_seconds: float,
        ark: Ark | None = None,
    ) -> None:
        self._model = model
        self._image_size = image_size
        self._watermark = watermark
        self._ark = ark or Ark(
            api_key=api_key,
            base_url=base_url,
            timeout=timeout_seconds,
            # 图像生成可能已成功但客户端未收到响应；
            # 在官方未确认幂等键前禁止 SDK 自动重试。
            max_retries=0,
        )

    def edit_image(
        self,
        *,
        image_data_url: str,
        prompt: str,
        transparent_background: bool,
    ) -> SeedreamResult:
        kwargs: dict[str, object] = {
            "model": self._model,
            "prompt": prompt,
            "image": image_data_url,
            "size": self._image_size,
            "stream": False,
            "response_format": "b64_json",
            "watermark": self._watermark,
        }
        if transparent_background:
            kwargs.update(background="transparent", output_format="png")

        response = self._ark.images.generate(**kwargs)
        if len(response.data) != 1 or not response.data[0].b64_json:
            raise SeedreamUpstreamError(
                502, "INVALID_RESPONSE", "Seedream 未返回唯一 Base64 图片"
            )
        try:
            image_bytes = base64.b64decode(response.data[0].b64_json, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise SeedreamUpstreamError(
                502, "INVALID_IMAGE", "Seedream 返回了无效图片"
            ) from exc

        return SeedreamResult(
            image_bytes=image_bytes,
            model=response.model or self._model,
            size=response.data[0].size,
            generated_images=response.usage.generated_images if response.usage else 1,
            upstream_request_id=extract_request_id(response),
        )
```

关键点：

- `background` 是每次调用参数，只在 Solid/原生 Alpha 路径传入；
- 5.0 Pro 单图编辑不依赖 Lite 的组图行为，不为了“看起来与旧请求一样”强行携带尚未经目标模型文档确认的 `sequential_image_generation`；
- `response_format="b64_json"` 与 `output_format="png"` 含义不同：前者控制 JSON 中返回 URL 还是 Base64，后者控制图片文件编码；
- SDK 会在内存中构造响应对象，旧 `httpx.stream()` 的“读取过程中超大立即中止”不再存在；必须在解 Base64 前检查字符串长度，同时保留应用/网关响应体上限。

### 5.4 客户端生命周期

- `get_image_enhancer()` 每进程构造一个 `Ark` 客户端，继续由 FastAPI lifespan 在进程退出时 `close()`；
- 不在每个请求内新建 SDK 客户端；
- 继续使用 `BoundedSemaphore` 控制进程内并发，SDK 自身不替代项目的排队上限；
- 测试注入 Fake Ark/Images 协议，不绕过 SDK 内部去 mock 私有 HTTP transport。

## 6. 透明背景数据流与旧逻辑取舍

### 6.1 按背景模式决定上游参数

| 对外背景模式 | Seedream 参数 | 前景处理 | 量化/渲染 |
| --- | --- | --- | --- |
| `solid` | `background="transparent"`, `output_format="png"` | 验证原生 Alpha，成功后不运行键色/ONNX | 透明格为 `-1`，用户颜色仍由 `background.mode="solid"` 渲染 |
| `keep` | 省略 `background`；`output_format` 可省略 | `processing="none"` | 背景作为普通画面量化 |
| `simplify` | 省略 `background`；`output_format` 可省略 | `processing="none"` | 简化后背景作为普通画面量化 |

这个分流是必要的。如果客户端构造时全局设置 `background="transparent"`，`keep` 将不再“保留原背景”，是对现有 API 语义的破坏。

### 6.2 原生 Alpha 验证

新增一个集中验证器，建议放在 `imaging/foreground.py` 或独立 `imaging/native_alpha.py`，避免 SDK Adapter 和编排层各自定义“透明成功”。必须同时满足：

1. 二进制以 PNG 签名 `89 50 4E 47 0D 0A 1A 0A` 开头；
2. Pillow 实际解码格式是 PNG，且源图具有 Alpha/透明信息；
3. 解码像素不超过 `SEEDREAM_OUTPUT_MAX_PIXELS`；
4. 存在明确前景（例如 `alpha >= 128` 的覆盖率不低于策略下限）；
5. 存在明确背景（例如 `alpha <= 32` 的覆盖率不低于策略下限）；
6. 前景覆盖率不超过上限，防止仅几个透明噪点通过；
7. 不得仅用 `image.mode == "RGBA"` 或 `alpha.getextrema() != (255, 255)` 判断成功。

初始阈值应复用 `ForegroundPolicy` 已有的前景/背景覆盖范围，并把策略版本记入诊断；真实效果集通过前不单独调宽阈值。

### 6.3 `EnhancementResult` 与 `PreparedForeground`

建议将增强结果的内部证明扩展为可辨别联合：

```python
@dataclass(frozen=True, slots=True)
class NativeAlphaHint:
    kind: Literal["native_alpha"] = "native_alpha"
    requested_background: Literal["transparent"] = "transparent"
    requested_output_format: Literal["png"] = "png"
    policy_version: str = "native-alpha-v1"
```

`ForegroundPreparer.prepare()` 的 Solid 分支改为：

```text
NativeAlphaHint + Alpha 合格
  -> 保留原生 Alpha
  -> processing="native_alpha"
  -> applied_background_mode=solid
  -> 不调 chroma_key / solid_alpha / ONNX

NativeAlphaHint + Alpha 不合格
  -> AI_TRANSPARENT_BACKGROUND_INVALID（422）
  -> 不默默第二次调用，不假装成功
```

`PreparedForeground.processing` 和响应 `background_processing` 需增加 `native_alpha`。这是响应枚举扩展，`apps/web` 类型和测试必须同步接受，但不需改表单字段或渲染规则。

### 6.4 键色、`solid-alpha-v2` 与 ONNX 的取舍

- **首个发布版本保留代码和模型资产**：用于回滚和对照效果集；
- **原生 Alpha 成功时不运行**：重新键色或 ONNX 可能破坏模型已生成的封闭孔洞、细肢体和边缘 Alpha；
- **原生 Alpha 失败时不请求内降级**：一个用户操作不应在未告知情况下发起两次付费生成；
- **发布回滚是进程级策略切换**：例如 `SEEDREAM_FOREGROUND_STRATEGY=native-alpha-v1|validated-chroma-v1`，值只能是已经完整测试的策略版本，不暴露单项阈值；
- **稳定期后再清理**：连续观察期通过且无回滚需求后，另立方案删除键色/ONNX 生产路径和资产，不与 SDK 迁移捆绑。

## 7. 模块级改造清单

| 文件/模块 | 改造内容 |
| --- | --- |
| `apps/api/pyproject.toml` | 增加已验证并锁定的 `volcengine-python-sdk[ark]`；SDK 迁移完成后评估移除显式 `httpx` |
| `apps/api/src/pindou/services/seedream_client.py` | 用 `Ark.images.generate` 替换手写 HTTP；保留项目 DTO、Base64/唯一图片/usage/请求 ID 校验和稳定异常 |
| `apps/api/src/pindou/api/dependencies.py` | 构造长生命周期 SDK 客户端；删除实验模型硬编码和 `httpx.Timeout` 组装；使用配置中唯一模型 |
| `apps/api/src/pindou/core/config.py` | 默认/验证 5.0 目标模型；删除 `SEEDREAM_PRO_TEST_ENABLED`；增加 SDK 总超时和前景策略配置 |
| `apps/api/src/pindou/services/seedream_enhancer.py` | 按 `background_mode` 传 `transparent_background`；校验 PNG 容器；返回 `NativeAlphaHint`；名称更正为 `seedream-5-pro` 或产品最终确认标识 |
| `apps/api/src/pindou/services/enhancer.py` | 扩展 Hint 辨别联合，不把原生 Alpha 伪装成键色协议 |
| `apps/api/src/pindou/services/seedream_prompt.py` | Solid 提示词从“输出键色”改为“真实 Alpha，禁止白底/棋盘格伪透明”；升级 Prompt 版本 |
| `apps/api/src/pindou/imaging/foreground.py` | 增加 `native_alpha` 验证和成功分支；成功时绕过键色/ONNX；扩展 processing 枚举 |
| `apps/api/src/pindou/imaging/native_alpha.py` | 可选新模块：封装纯函数验证、覆盖率与诊断；如新增则由 `ForegroundPreparer` 唯一调用 |
| `apps/api/src/pindou/schemas/conversion.py` | `background_processing` 扩展 `native_alpha`（如当前有显式 Literal/枚举） |
| `apps/api/tests/test_seedream.py` | 从 `httpx.MockTransport` 改为 Fake Ark SDK；覆盖参数、响应、异常和超时 |
| `apps/api/tests/test_foreground.py` | 增加原生 Alpha 成功/失败/孔洞/边缘测试；确认成功路径不调 ONNX |
| `apps/api/tests/test_api.py` | 覆盖 `background_processing="native_alpha"`、Solid 渲染和豆数不变 |
| `apps/api/.env.example`, `deploy/.env.example`, `apps/api/README.md`, `docs/devops/fnOS-docker-deployment.md` | 同步 5.0 模型、SDK 超时、前景策略和回滚说明 |
| `apps/web` 类型/测试 | 仅扩展 `background_processing` 可接受值；不改请求表单和渲染算法 |

## 8. 配置迁移

### 8.1 目标配置

```dotenv
IMAGE_ENHANCER=seedream
ARK_DOUBAO_API_KEY=<server-only-secret>
ARK_DOUBAO_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_DOUBAO_IMAGE_MODEL=doubao-seedream-5-0-260128
ARK_DOUBAO_IMAGE_SIZE=2K
ARK_DOUBAO_RESPONSE_FORMAT=b64_json
ARK_DOUBAO_WATERMARK=false
ARK_DOUBAO_TIMEOUT_SECONDS=90
ARK_DOUBAO_MAX_CONCURRENCY=2
ARK_DOUBAO_QUEUE_TIMEOUT_SECONDS=3
SEEDREAM_INPUT_MAX_EDGE=2048
SEEDREAM_OUTPUT_MAX_PIXELS=20000000
SEEDREAM_FOREGROUND_STRATEGY=native-alpha-v1
```

`background="transparent"` 和 `output_format="png"` 是 `native-alpha-v1` 的代码级不变量，不建议暴露为可任意填写的生产环境变量。否则可以启动一个名为原生 Alpha、实际请求 JPEG/不透明背景的无效组合。

### 8.2 删除/废弃

- 删除 `SEEDREAM_PRO_TEST_ENABLED`；目标版本不再双模型暗切换。
- 用 SDK 总超时替换 `ARK_DOUBAO_CONNECT/READ/WRITE/POOL_TIMEOUT_SECONDS`，前提是锁定 SDK 版本只公开总超时；如该版本公开支持分项超时，可保留当前四项语义。
- `ARK_DOUBAO_MAX_RESPONSE_BYTES` 不再能依靠流式 transport 硬中止；保留为 Base64 解码前的长度上限，并在网关设置响应体限额。

### 8.3 API Key

- 继续使用 `SecretStr` 保存 `ARK_DOUBAO_API_KEY`，显式传给 `Ark(api_key=...)`；
- 不依赖 SDK 隐式读取的环境变量名，避免开发/部署两套名称漂移；
- 不放入 `NEXT_PUBLIC_*`、前端 bundle、Prompt、请求日志、异常消息或图片备份元数据；
- 启动时在 `IMAGE_ENHANCER=seedream` 且 Key/模型缺失时失败，不默默切 `passthrough`。

## 9. 响应校验、错误映射与安全

### 9.1 SDK 响应校验

必须依次验证：

1. SDK 调用没有抛异常；
2. `response.data` 是长度为 1 的集合；
3. 唯一项存在非空 `b64_json`；
4. Base64 字符串长度不超过由二进制上限推导的编码上限；
5. `base64.b64decode(..., validate=True)` 成功；
6. Solid 路径符合 PNG 签名和原生 Alpha 策略；
7. `usage.generated_images` 为正整数；缺失时可使用 1 作为兼容值，但要记录结构偏差指标；
8. 记录实际 `response.model`，但计费/路由归属以请求配置和控制台为准。

SDK 响应模型中 request ID 的公开取值方式可能随版本不同；实施时只允许读取锁定版本公开属性/响应头访问器，不在业务中遍历或日志化整个响应对象。

### 9.2 异常和业务错误

官方 SDK 的具体公开异常类名必须以实施时锁定版本源码为准；本方案不猜测私有模块路径。适配层要将其公开的“超时、连接失败、HTTP/API 状态失败”类型规范化为：

| 上游情况 | 对外 HTTP | 业务码 | 处理 |
| --- | ---: | --- | --- |
| SDK 超时 | 504 | `AI_TIMEOUT` | 不自动重试，允许用户手动重试 |
| DNS/连接/TLS/连接中断 | 502 | `AI_UPSTREAM_ERROR` | 不暴露内部网络信息 |
| `InputTextSensitiveContentDetected` | 400 | `AI_INPUT_REJECTED` | 不重试，提示调整素材/指令 |
| `OutputImageSensitiveContentDetected` | 422 | `AI_OUTPUT_REJECTED` | 不返回图片，不盲目重试 |
| `QuotaExceeded` 或 HTTP 429 | 429 | `AI_BUSY` | 依赖本地并发门禁；首版不做 SDK 自动重试 |
| 401/403 | 502 | `AI_UPSTREAM_ERROR` | 告警运维，不向用户暴露鉴权细节 |
| 参数/模型不受支持 | 502 | `AI_UPSTREAM_ERROR` | 记录供应商 code/request ID，视为发布配置故障 |
| 5xx | 502 | `AI_UPSTREAM_ERROR` | 不自动重复付费生成 |
| data/Base64/PNG/Alpha 不合格 | 502 或 422 | `AI_UPSTREAM_ERROR` / `AI_TRANSPARENT_BACKGROUND_INVALID` | 协议损坏用 502；成功返回但无可用透明前景用 422 |

内容安全和配额错误依据来自[ImageGenerations 官方错误码](https://api.volcengine.com/api-docs/view?action=ImageGenerations&serviceCode=ark&version=2024-01-01)。

### 9.3 超时与重试

- SDK 总超时初值 90 秒，必须通过真实效果集采集 P95 后再调整；
- 排队等待和 SDK 网络超时是两个独立指标；
- SDK 构造显式 `max_retries=0`。图片生成是计费操作，超时可能发生在服务端已完成之后；官方未确认幂等请求键前不自动重试；
- 若后续需要重试，必须单独确认幂等语义、可重试异常、最大次数和计费观测。

### 9.4 日志与安全

允许记录：模型配置、响应模型、Prompt 版本、处理策略、请求 ID、耗时、usage、错误码、PNG 字节数、尺寸和 Alpha 覆盖指标。

禁止记录：API Key、Authorization Header、完整 Data URL/Base64、用户原图字节、SDK 完整响应 `repr`、上游可能回显用户内容的原始错误 message。

## 10. 测试与验收

### 10.1 单元测试

SDK Adapter：

- 启动构造显式传 Key、Base URL、超时、`max_retries=0`；
- Solid 调用精确携带 `background="transparent"`/`output_format="png"`/`response_format="b64_json"`；
- `keep`/`simplify` 不携带 `background="transparent"`；
- 响应无 `data`、多图、无 `b64_json`、非法 Base64、超大 Base64 稳定失败；
- `model`/`size`/`usage.generated_images`/request ID 正确转换到项目 DTO；
- 各类 SDK 公开异常和官方错误 code 映射到现有业务码；
- `close()` 被 lifespan 调用且多次关闭不泄漏连接。

原生 Alpha：

- 非 PNG，包括 JPEG 解码后 `convert("RGBA")`，不能通过；
- PNG 无 Alpha、Alpha 全 255、几乎全 255 只带噪点、几乎全 0、超像素和损坏 PNG 均失败；
- 有效透明外部背景与人物四肢/躯干间封闭孔洞通过；
- 原生 Alpha 成功时 Fake ONNX Adapter 调用次数必须为 0，也不调键色选择/校验；
- 验证器不修改 RGB，仅验证并保留上游 Alpha。

### 10.2 API 回归

- `POST /api/v1/conversions` 的 multipart 字段不变；
- `solid` 成功返回 `applied_background_mode="solid"`、`background_processing="native_alpha"`、`background.mode="solid"`；
- Alpha 透明格仍输出 `-1`，不进 palette、不占颜色预算、不计 bead count；
- `keep`/`simplify` 既有响应与量化语义不变；
- 前端在未更新和已更新 `native_alpha` 枚举时都不发生渲染异常。

### 10.3 真实沙箱验收

真实调用使用独立测试 Key、显式开关和非敏感冻结图集，不进默认 `pytest`。每张记录：

- 请求模型、响应模型、Prompt 版本、请求 ID；
- PNG 魔数、Pillow 格式/模式、Alpha=0/过渡/不透明覆盖率；
- 外部背景残留率、封闭孔洞召回率、主体核心误删率、边缘过渡质量；
- P50/P95 耗时、响应编码长度、解码字节、SDK 错误分布和成功生成张数。

最低验收条件：

1. 项目账号 API Explorer 明确显示目标 Model/Endpoint 支持 `background=transparent` 和 `output_format=png`；
2. 锁定 SDK 版本签名包含所需参数，真实调用不是依赖未校验的透传 `kwargs`；
3. 返回实际为 PNG，且非平凡 Alpha 通过集中验证；
4. 主体核心误删率为 0；封闭孔洞召回率不低于 95%；
5. 原生 Alpha 成功路径的键色和 ONNX 调用数为 0；
6. `apps/api` 全量测试、`apps/web` 类型/测试通过；
7. 未在日志、错误响应和测试快照中发现 Key 或 Base64。

## 11. 发布、观测与回滚

### 11.1 发布顺序

1. 在项目账号控制台/API Explorer 完成“模型 ID + SDK 参数 Schema + 单张非敏感图”验证，将证据附到实施 PR。
2. 锁定 SDK 版本，完成 Adapter 单元测试，不连真实服务。
3. 实现原生 Alpha 分支和回归测试，保留键色/ONNX 策略。
4. 测试环境运行冻结效果集与小规模并发测试。
5. 先内部小流量启用 `native-alpha-v1`，观察错误率、Alpha 不合格率、P95 和单次成功张数。
6. 达标后全量；观察期后再评审是否移除旧键色/ONNX 生产路径。

### 11.2 观测

至少增加/保留：

- `seedream_requests_total{status,error_code,model,strategy}`
- `seedream_request_duration_seconds{model}`
- `seedream_generated_images_total{model}`
- `seedream_invalid_response_total{reason}`
- `seedream_native_alpha_validation_total{result,reason}`
- `seedream_native_alpha_coverage`
- `seedream_inflight_requests` / `seedream_queue_wait_seconds`

不得把 request ID、Prompt 或用户参数放入低基数度指标 label。

### 11.3 回滚

回滚优先级：

1. 若原生 Alpha 质量不达标，把 `SEEDREAM_FOREGROUND_STRATEGY` 回滚到已验证的 `validated-chroma-v1`；
2. 若 SDK 自身发生兼容回归，回滚整个发布版本和已锁定依赖，不在线热换 SDK 版本；
3. 不回滚前端 API Schema、数据库或用户数据，因为本方案不增加这些持久契约；
4. 回滚时保留事件日志和诊断图，按现有保留策略清理，不记录 Key/Base64。

## 12. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 中国区当前账号未开通目标 5.0 模型 | 启动后调用失败 | 上线前在模型列表/API Explorer 强制验证；优先使用账号已创建的 `ep-...` |
| `background` 或 `output_format` 在当前 SDK/区域不受支持 | 400/无透明结果 | SDK 签名 + API Explorer + 真实单图三重门禁；不透传未知 `kwargs` 自我安慰 |
| PNG 容器但 Alpha 无效 | 背景未移除或几乎全图被移除 | 集中 Alpha 覆盖率与主体安全验证，失败不假装成功 |
| 原生 Alpha 与旧 Solid 键色编排冲突 | 有效图仍被拒绝或破坏 | 引入显式 `NativeAlphaHint` 和 `native_alpha` 分支，成功时不调键色/ONNX |
| SDK 默认自动重试 | 重复计费或随机输出不一致 | 显式 `max_retries=0`，未确认幂等键前不自动重试 |
| SDK 先物化 Base64 响应 | 无法复刻旧流式读取的完整内存保护 | 解码前长度检查、网关上限、并发门禁、像素上限与内存压测 |
| 客户端构造时全局透明背景 | `keep`/`simplify` 语义被破坏 | 参数改为每次调用，只在 Solid 分支传入 |
| 异常类随 SDK 版本变化 | 错误映射失效 | 锁定版本，只依赖公开类，用 Fake 异常和契约测试固定 Adapter 语义 |
| 旧键色/ONNX 立即删除导致无回滚 | 生产故障时只能整版回退 | 首版保留旧策略，稳定期后另立清理方案 |

## 13. 待确认项

以下任一项未确认，不得把本文状态改为“实施中”：

- [ ] 在项目 `cn-beijing` 账号的模型列表确认 `doubao-seedream-5-0-260128` 对应产品要求的 5.0 Pro，或提供该模型的 `ep-...` Endpoint ID。
- [ ] 在 API Explorer 选定该模型后，确认中国区 Schema 明确存在 `background="transparent"` 和 `output_format="png"`。
- [ ] 确认当日官方 SDK 版本、`images.generate` 签名、超时/`max_retries` 参数和公开异常类。
- [ ] 确认 5.0 Pro 单图编辑是否应省略 `sequential_image_generation`；在官方专属文档未证明前不沿用 Lite 参数。
- [ ] 确认 `watermark=false` 的产品/合规决策；技术支持不等于可以忽略 AIGC 标识义务。
- [ ] 确认原生 Alpha 不合格时的产品语义；本方案默认 422，不自动二次付费请求。
- [ ] 确认发布期间保留 `validated-chroma-v1` 回滚策略，稳定期后再评估删除 ONNX/键色资产。

## 14. 实施检查清单

- [ ] 技术方案评审通过并更新状态。
- [ ] 保存目标账号模型和 API Explorer 参数证据。
- [ ] 锁定官方 SDK 版本，完成导入/签名/异常小型验证。
- [ ] 先用 Fake SDK 完成客户端契约测试，再替换生产实现。
- [ ] 实现 Solid 原生 Alpha 分流和集中验证，成功路径绕过键色/ONNX。
- [ ] 同步 `background_processing="native_alpha"` 的 API/Web 类型和测试。
- [ ] 同步 `.env.example`、部署模板和运维文档，不带真实 Key。
- [ ] 跑 API/Web 全量自动化测试和真实冻结效果集。
- [ ] 小流量发布，确认观测和 `validated-chroma-v1` 回滚演练。

## 15. 官方资料索引

- [火山引擎官方 Python SDK 仓库](https://github.com/volcengine/volcengine-python-sdk)
- [官方 PyPI：volcengine-python-sdk](https://pypi.org/project/volcengine-python-sdk/)
- [官方 SDK Ark Runtime 目录](https://github.com/volcengine/volcengine-python-sdk/tree/main/volcenginesdkarkruntime)
- [火山方舟产品简介与 Python 调用示例](https://www.volcengine.com/docs/82379/1795150)
- [火山方舟图片生成 API](https://www.volcengine.com/docs/82379/1541523?lang=zh)
- [ImageGenerations API 参考与错误码](https://api.volcengine.com/api-docs/view?action=ImageGenerations&serviceCode=ark&version=2024-01-01)
- [ImageGenerations API Explorer](https://api.volcengine.com/api-explorer/?action=ImageGenerations&groupName=%E5%9B%BE%E7%89%87%E7%94%9F%E6%88%90API&serviceCode=ark&tab=2&version=2024-01-01)
- [Seedream 4.0–5.0 提示词指南](https://www.volcengine.com/docs/82379/1829186)
- [火山引擎 Seedream 5.0 官方发布记录](https://www.volcengine.com/docs/6492/2165228?lang=en)
- [火山方舟模型列表入口](https://www.volcengine.com/docs/82379/1330310?lang=zh&redirect=1)
