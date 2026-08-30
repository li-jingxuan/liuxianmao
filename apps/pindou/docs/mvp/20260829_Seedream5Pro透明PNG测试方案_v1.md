# Seedream 5.0 Pro 透明 PNG 测试方案

> 状态：已确认，待实施验证  
> 目标版本：MVP2 量化增强版（实验开关）  
> 方案日期：2026-08-29  
> 适用范围：`apps/api`，兼容现有 `apps/web` 转换接口

## 1. 目标

使用 Doubao-Seedream-5.0-pro 生成测试用增强图，并要求上游直接返回 PNG、保留 Alpha 透明通道。该版本只用于实验验证，不改变现有默认模型、默认背景链路或生产回退语义。

测试重点是确认：

- 当前账号/地域实际可用的 5.0 Pro Model ID 或 Endpoint ID；
- `output_format: "png"` 是否被方舟端点接受；
- 上游响应 PNG 是否真的含 Alpha 通道，而不是仅改变文件容器格式；
- 人物四肢、躯干之间的封闭背景孔洞是否在模型输出阶段已经透明；
- 透明 PNG 进入现有 `ForegroundPreparer`、量化和前端渲染后，是否仍被错误铺成背景色。

## 2. 当前基线与风险

现有配置默认使用 `doubao-seedream-5-0-lite-260128`，`SeedreamEnhancer` 当前以 `b64_json` 接收图片，再统一解码为 RGBA。现有 Solid 方案仍有动态键色、`solid-alpha-v2` 和 ONNX 边缘辅助逻辑；不能因为上游声明 PNG 就直接信任 Alpha。

此前研究文档记录了 `dola-seedream-5-0-pro-260628` 等 Pro 标识，但中国区 `doubao-...` 与 BytePlus `dola-/seedream-...` Model ID 不能混用。实施前必须从当前账号 API Explorer 或模型列表确认真实 ID，禁止凭名称猜测。

主要风险：

1. 5.0 Pro 端点不支持 `output_format` 或透明背景参数，直接请求会失败。
2. 返回 PNG 但 Alpha 全 255，模型只是返回 PNG 容器，并未生成透明背景。
3. Alpha 只覆盖外部背景，封闭孔洞仍是不透明背景色。
4. 现有后处理再次按键色/ONNX 覆盖 Alpha，反而破坏上游透明结果。
5. 上游返回带 Alpha 的图，但 `build_bead_grid()` 的 Solid 背景层仍会让透明区域视觉上呈现为用户选择的颜色，造成“空洞未消失”的误判。

## 3. 测试开关

新增一个进程级实验配置，默认关闭（不新增 HTTP 接口）：

```dotenv
SEEDREAM_PRO_TEST_ENABLED=false
```

当 `SEEDREAM_PRO_TEST_ENABLED=true` 时：

- 使用代码内登记的 Pro Model ID；如账号实际 ID 不同，只需沿用现有 `ARK_DOUBAO_IMAGE_MODEL` 配置与实现中的测试常量同步调整；
- 请求 `output_format: "png"`（若端点契约不接受，应记录明确失败，不静默改回 JPEG）；
- 保持单图、非流式、`b64_json` 响应，避免引入 URL 下载链路；
- `SEEDREAM_REQUIRE_ALPHA=true` 时，解码后必须满足 `mode=RGBA/LA` 且存在至少一个 `alpha < 255` 像素，否则返回稳定的上游能力错误；
- 默认不把 Pro 实验结果用于正式转换，建议增加仅测试路由或内部 header/配置隔离。

现有 `ARK_DOUBAO_IMAGE_MODEL` 和 Lite 默认值保持不变。实验开关关闭时，现有路径和测试必须完全不变。

## 4. 请求与响应契约

测试请求的最小新增字段：

```json
{
  "model": "<confirmed-pro-model-id>",
  "prompt": "<versioned prompt requiring transparent background>",
  "image": "data:image/png;base64,<...>",
  "size": "2K",
  "sequential_image_generation": "disabled",
  "stream": false,
  "response_format": "b64_json",
  "output_format": "png",
  "watermark": true
}
```

透明约束必须同时存在于请求参数（若官方 Schema 支持）和版本化 Prompt 中，例如：

```text
输出必须是带 Alpha 透明通道的 PNG。主体外部背景和主体内部真实封闭空洞均为 Alpha=0；
不得用白色、黑色、粉色或棋盘格模拟透明；主体边缘保留自然抗锯齿，不把主体内部结构挖空。
```

客户端仍严格校验 Base64、PNG 魔数、Pillow 可解码性、像素上限和实际 Alpha 分布。不能只检查响应中的 MIME、`size` 或模型名。

## 5. 后处理策略

Pro 测试路径输出应先保存“上游原始 RGBA”诊断副本，再进入统一前景模块。不得在 `SeedreamEnhancer` 内自行宣称 Alpha 可信。

建议在 `ForegroundPreparer` 增加显式策略：

```text
pro-test + alpha 合格 → 保留上游 Alpha，执行最小边缘去色，不运行动态键色孔洞猜测
pro-test + alpha 缺失 → 测试失败；不得静默当作透明 PNG 成功
alpha 与 ONNX/键色冲突 → 记录冲突指标，优先保护可信主体核心
```

正式 Solid 默认链路仍使用现有 `solid-alpha-v2`。只有经过效果集确认后，才决定是否把 Pro Alpha 纳入正式前景策略；本测试版本不删除或绕过既有孔洞安全规则。

## 6. 验收指标

每张测试图记录：

- 请求模型、响应模型、Prompt 版本和上游 request ID；
- 输出格式、PNG 色彩模式、Alpha 非满覆盖率、Alpha=0 覆盖率；
- 外部背景残留率、封闭孔洞召回率、主体核心误删率；
- 与现有 Lite/动态键色/ONNX 路径的差异；
- P50/P95 耗时、响应大小和内存峰值。

最低通过条件：

1. `output_format=png` 被端点接受且响应可解码为 PNG。
2. `SEEDREAM_REQUIRE_ALPHA=true` 时，Alpha 全 255 的响应被拒绝。
3. 已标注的四肢间、手臂与躯干间封闭孔洞召回率达到 95% 以上。
4. 主体保护区域误删率为 0；边缘差异仅允许落在标注的抗锯齿容差带。
5. 透明区域在棋盘格预览、Solid 背景预览和最终 MARD 网格中的语义一致，不能仅因渲染层铺色而误判。

## 7. 实现与测试范围

预计修改：

```text
apps/api/src/pindou/core/config.py
apps/api/src/pindou/services/seedream_client.py
apps/api/src/pindou/services/seedream_enhancer.py
apps/api/src/pindou/services/seedream_prompt.py
apps/api/src/pindou/imaging/foreground.py
apps/api/tests/test_seedream.py
apps/api/tests/test_foreground.py
apps/api/.env.example
```

必须新增的测试：

- Pro 实验开关选择正确模型，关闭时 Lite 路径无变化；
- 请求体包含 PNG 输出约束；
- PNG 无 Alpha、Alpha 全 255、有效透明 Alpha 三种响应分别得到预期结果；
- 非 PNG、损坏 Base64、超像素响应稳定失败；
- 上游透明孔洞与现有 `solid-alpha-v2` 的组合不会恢复已确认透明区域；
- 前端/网格层对 Alpha=0 的格子仍遵守背景渲染契约。

## 8. 发布步骤

1. 先确认账号、地域和真实 Pro Model ID，并用 API Explorer 验证 `output_format` 与 Alpha 支持。
2. 仅在测试环境打开 `SEEDREAM_PRO_TEST_ENABLED`，跑冻结效果集。
3. 对比 Lite、当前键色和 ONNX 输出，人工复核封闭孔洞、细肢体、白色主体和透明物体。
4. 若上游不支持真正透明 PNG，保留实验失败记录，不增加“看似支持”的兼容分支；继续使用现有动态键色/ONNX 策略。
5. 评审通过后，再单独提交将 Pro 纳入正式模型选择的变更方案。
