# 可切换 ONNX 抠图与 Seedream 动态键色技术方案

> 后续决策：两条路径不再完全互斥。ONNX 开启时 Solid 仍先生成动态键色图，
> 然后直接使用 ONNX 蒙版。见 [ONNX 启用时动态键色预处理与直接抠图](./20260828_ONNX启用时动态键色预处理与直接抠图_v1.md)。

> 日期：2026-08-28  
> 版本：v1  
> 状态：已审查并实施  
> 范围：`apps/api` 的 Solid 前景处理配置、依赖构造、就绪探针、可观测性与测试  
> 关联方案：[Solid 动态键色与 ONNX 保守融合技术方案](./20260828_Solid动态键色与ONNX保守融合技术方案_v1.md)

> 审查补充：本次实施同时修复 ONNX 输出归一化。当前固定 U-2-NetP 工件已验证
> 直接输出 `[0,1]` 概率，不再执行逐图 min-max；模型元数据显式声明输出激活。

## 1. 结论

建议增加服务端进程级配置：

```dotenv
ENABLE_ONNX_MATTING=false
```

- `true`：使用 ONNX 生成最终抠图蒙版；Seedream 不请求内部键色。
- `false`：不加载、不调用 ONNX；Seedream 使用动态键色生成背景，服务端验证后生成软蒙版。
- 默认值为 `false`。当前 ONNX 已出现主体内部半透明、边缘毛刺和局部误删，默认路径应优先保证最终拼豆主体完整性。

两条路径互斥，不再默认做 ONNX 与键色融合。开关仅影响 `background_mode=solid`，`keep` 和 `simplify` 保持现状。

ONNX 开启时也不再把每张图的最小值和最大值强制拉到 `0/1`。对于元数据声明为
`probability` 的模型只裁剪浮点误差；若未来模型声明为 `logits`，统一执行数值稳定
Sigmoid。输出范围与声明不符时拒绝该次推理，避免静默产生错误 Alpha。

## 2. 为什么这样设计

当前仓库已有 `SOLID_FOREGROUND_STRATEGY=onnx-only|validated-chroma-v1`，但
`validated-chroma-v1` 仍会无条件运行 ONNX，并将其用于边界融合、异常连通域诊断或键色失败兜底。因此它不能表达“关闭 ONNX”。

现有 ONNX 结果是软概率蒙版，直接作为 Alpha 时会把模型的不确定性暴露为半透明主体；模型分辨率和恢复尺寸过程还会放大细边缘毛刺。动态键色路径则拥有更直接的背景证据：只删除与画布边缘连通且接近已验证键色的区域，主体内部与背景断开的同色区域仍可保留。

动态键色也不是无条件可信。Seedream 可能偏色、保留阴影或忽略指令，所以必须继续经过图像级验证，不能只依赖 Prompt。

需要接受一个明确取舍：完全关闭 ONNX 后，系统可以可靠识别“哪些像素属于已验证键色背景”，但无法仅凭颜色判断一个被主体包围的非键色物体究竟是主体配件还是背景残留。动态键色模式依赖 Seedream 先完成语义层面的背景移除，服务端验证负责阻止明显违反键色协议的输出；它不能伪装成第二个语义分割模型。

## 3. 配置契约

### 3.1 新配置

在 `Settings` 中增加类型化布尔配置：

```python
enable_onnx_matting: bool = False
```

环境变量名为 `ENABLE_ONNX_MATTING`，只在应用启动时读取；它不是前端开关，也不是单请求参数，避免用户请求在同一进程中反复切换大模型资源。

### 3.2 旧配置迁移

`SOLID_FOREGROUND_STRATEGY` 与新布尔开关语义重叠，不能长期并存为两个事实来源：

| 旧值 | 新配置 |
| --- | --- |
| `onnx-only` | `ENABLE_ONNX_MATTING=true` |
| `validated-chroma-v1` | `ENABLE_ONNX_MATTING=false` |

实施时删除代码和部署模板中的 `SOLID_FOREGROUND_STRATEGY`。如需兼容已有生产环境，可保留一个发布周期的启动期迁移校验，但当新旧配置同时出现时必须启动失败并提示只保留新配置，不能按优先级静默覆盖。

### 3.3 配置组合校验

| 配置组合 | 启动结果 |
| --- | --- |
| `ENABLE_ONNX_MATTING=false` + `IMAGE_ENHANCER=seedream` | 合法，使用动态键色 |
| `ENABLE_ONNX_MATTING=false` + `IMAGE_ENHANCER=passthrough` | 启动失败；passthrough 无法生成约定键色背景 |
| `ENABLE_ONNX_MATTING=true` + 任一增强器 | 合法；Solid 最终蒙版由 ONNX 生成 |
| `ENABLE_ONNX_MATTING=true` + ONNX 模型缺失/无效 | 启动失败 |

`FOREGROUND_MASK_ADAPTER`、模型路径、并发和线程配置只在 ONNX 开启时生效。关闭 ONNX 时不应因为模型文件缺失而影响服务启动。

## 4. 两条处理链路

### 4.1 ONNX 开启

```text
上传图片
  → Seedream 常规增强（Solid 不请求内部键色）
  → ONNX 推理
  → 统一蒙版质量验证
  → ONNX 软蒙版写入 Alpha
  → MARD 量化
```

结果沿用：

```text
background_processing=local_matte
foreground_model_version=<ONNX model version>
```

ONNX 蒙版低置信时，继续按 `fallback_mode` 返回 `fallback_simplify` 或 422；运行时故障返回 503。

### 4.2 ONNX 关闭

```text
上传图片
  → 从输入主要颜色中动态选择安全键色
  → Seedream 将主体外画布改为该键色
  → 验证实际键色、边缘覆盖率、背景覆盖率和过渡区
  → 只标记与画布边缘连通的键色区域
  → 生成原尺寸软 Alpha 并执行窄边缘去色溢
  → MARD 量化
```

结果使用：

```text
background_processing=chroma_matte
foreground_model_version=null
```

该路径不得调用以下 ONNX 相关逻辑：

- `ForegroundMaskAdapter.generate()`；
- `_validate_mask()`；
- `fuse_chroma_with_onnx()`；
- 基于 ONNX 支持率的非键色连通域判断。

关闭 ONNX 后，键色无可用候选、Seedream 未遵循键色、键色验证失败或存在无法安全判断的背景残留时：

- `fallback_mode=simplify`：返回 `fallback_simplify`；
- `fallback_mode=none`：返回 422 `AI_BACKGROUND_SEPARATION_FAILED`；
- 不得静默回退到 ONNX，也不得把未验证图片当作 Solid 成功。

## 5. Module 与 seam

对路由保持现有 `ForegroundPreparer.prepare()` interface 不变。`ForegroundPreparer` 继续作为隐藏增强、抠图、验证、降级和 Pillow 生命周期的深 module，路由不读取开关，也不判断具体算法。

策略选择只发生在 `ForegroundPreparer` 的内部 seam：

```python
if self._enable_onnx_matting:
    return self._prepare_with_onnx(...)
return self._prepare_with_chroma(...)
```

两个私有方法分别封装完整路径，公共的成功结果和降级结果仍统一为 `PreparedForeground`。不要在路由、`SeedreamEnhancer`、备份模块和量化模块分别复制开关判断。

为避免把同一个配置同时注入 `ForegroundPreparer` 和 `SeedreamEnhancer`，由前者在调用增强器前派生内部增强选项：

```python
@dataclass(frozen=True, slots=True)
class EnhancementOptions:
    # 其余既有字段省略；该字段只在后端内部流转，不来自 HTTP 表单。
    background_hint_kind: Literal["none", "chroma_key"] = "none"
```

ONNX 开启时传入 `none`，关闭时对 Solid 传入 `chroma_key`。`SeedreamEnhancer` 只解释该选项以组装 Prompt 和返回 `BackgroundHint`，不读取全局配置，也不负责宣称键色已经可用于抠图。这样开关判断只有一个事实来源。

## 6. 依赖构造与资源生命周期

当前应用生命周期会无条件执行 `get_foreground_mask_adapter()`，这会在关闭 ONNX 时仍加载模型。实施时应改为条件构造：

- ONNX 开启：构造并缓存 `OnnxForegroundMaskAdapter`；
- ONNX 关闭：仅返回不持有资源的禁用占位 Adapter，不初始化 ONNX Runtime Session；
- `ForegroundPreparer` 构造时校验 ONNX 开启却缺少 Adapter 属于编程/配置错误；
- 进程退出时仅关闭实际存在的 Adapter。

这能确保开关关闭后同时消除推理耗时、模型内存、线程池和就绪探针依赖，而不只是跳过 `generate()`。

## 7. Readiness 语义

`/readyz` 应按启用能力判断：

- ONNX 开启：数据库可用且 ONNX Adapter `ready=true`；
- ONNX 关闭：只检查数据库和 Seedream 必需配置，不因 ONNX 模型缺失返回 503。

Seedream 的真实网络请求不应放入就绪探针，避免探活产生费用和受外部网络波动影响；其 Key、模型 ID 等静态配置仍在启动期校验。

## 8. 可观测性与备份

每次 Solid 请求记录以下稳定字段：

- `foreground_strategy=onnx|chroma`；
- `background_processing=local_matte|chroma_matte|fallback_simplify`；
- `foreground_model_version`，键色路径为 `null`；
- `chroma_policy_version`，ONNX 路径为 `null`；
- 各阶段耗时和失败原因。

备份仍使用阶段语义命名：

```text
*-original.png
*-seedream-enhanced.png
*-foreground-final.png
*-foreground-metrics.json
```

不要再把最终图统一称为 `onnx-matted`。内部请求键色只进入诊断指标，不进入公开 HTTP 响应，也不能替代用户选择的最终 `background_color`。

## 9. 测试方案

### 9.1 配置测试

- 默认 `ENABLE_ONNX_MATTING=false`；
- 正确解析大小写布尔环境变量；
- 动态键色与 passthrough 的非法组合在启动期失败；
- 新旧配置同时存在时按迁移策略失败；
- ONNX 关闭时模型文件不存在也可启动；
- ONNX 开启时模型文件或元数据异常会启动失败。

### 9.2 ForegroundPreparer 契约测试

- 开启 ONNX：只调用 Mask Adapter，不产生 `BackgroundHint`，返回 `local_matte`；
- 关闭 ONNX：Mask Adapter 使用“调用即失败”的 spy，确认调用次数为 0；
- 关闭 ONNX + 合格键色：返回 `chroma_matte`，主体内部不出现 ONNX 导致的半透明；
- 关闭 ONNX + 键色无候选/验证失败：按 `fallback_mode` 返回 422 或 `fallback_simplify`；
- `keep` / `simplify`：两种开关下都不执行抠图；
- 成功、降级和异常路径都正确关闭中间 Pillow 图片。

### 9.3 API 与生命周期测试

- `meta.background_processing` 和 `foreground_model_version` 与实际路径一致；
- ONNX 关闭时 lifespan 不构造、不关闭 ONNX Session；
- `/readyz` 在 ONNX 关闭且模型缺失时仍成功；
- `/readyz` 在 ONNX 开启但 Adapter 未就绪时返回 503；
- 两条路径都不改变前景 palette、背景渲染层和豆数的既有契约。

### 9.4 效果验收

使用同一组冻结 Seedream 输出对比两条路径，至少覆盖人物、宠物、商品、动漫、多主体、浅色主体、细肢体、毛发和主体贴边。重点统计：

- 主体内部半透明像素占比；
- 主体核心误删格数；
- 边缘毛刺/孤立格数量；
- 背景残留格数；
- 键色色溢进入 MARD 调色板的数量；
- P50/P95 处理时间和进程峰值内存。

动态键色成为默认值前，要求已知 ONNX 失败样本的主体核心误删为 0，并且键色失败样本全部显式失败或降级，不能静默作为 Solid 成功。

验收时还需人工标注“被主体包围的非键色背景残留”。这类内容无法由纯键色校验可靠识别；如果其发生率不可接受，应优先收紧 Seedream Prompt/转换风格，或回滚 ONNX，而不是增加无依据的颜色启发式自动删除。

## 10. 预计改动范围

```text
apps/api/src/pindou/core/config.py
apps/api/src/pindou/api/dependencies.py
apps/api/src/pindou/imaging/foreground.py
apps/api/src/pindou/main.py
apps/api/src/pindou/services/enhancer.py
apps/api/src/pindou/services/seedream_enhancer.py
apps/api/src/pindou/schemas/conversion.py       # 如增加公开策略字段才修改

apps/api/tests/test_foreground.py
apps/api/tests/test_seedream.py
apps/api/tests/test_api.py
apps/api/tests/test_main.py                     # 或现有生命周期测试文件

apps/api/.env.example
deploy/.env.example
apps/api/README.md
docs/devops/fnOS-docker-deployment.md
```

新增/拆分的函数、策略分支、资源所有权和关键验证逻辑均添加中文注释。

## 11. 发布与回滚

1. 先发布代码，但生产继续设置 `ENABLE_ONNX_MATTING=true`，确认行为与当前 ONNX-only 一致；
2. 在测试环境设置为 `false`，对冻结效果集和真实 Seedream 样本验收；
3. 生产切换为 `false`，重启进程后观察 Solid 成功率、422 降级率、边缘质量和内存；
4. 出现键色遵循率或背景残留问题时，将配置改回 `true` 并重启即可回滚。

配置变更不修改数据库、HTTP 请求结构、MARD 色卡和网格 Schema。

## 12. 审查项

- [x] 确认配置名使用 `ENABLE_ONNX_MATTING`，默认 `false`；
- [x] 确认两条路径严格互斥，不保留 ONNX 边缘融合；
- [x] 确认关闭 ONNX 时，键色失败只能显式失败或按请求降级；
- [x] 确认 `IMAGE_ENHANCER=passthrough` 与关闭 ONNX 的组合启动失败；
- [x] 确认删除旧 `SOLID_FOREGROUND_STRATEGY`，不保留双重配置来源；
- [x] 确认 ONNX 关闭时不加载模型，`/readyz` 也不依赖模型；
- [x] 确认动态键色的内部颜色不暴露给前端，不替代用户最终背景色。
- [x] 接受纯键色无法语义识别封闭非键色背景残留的限制，并用固定效果集衡量其发生率。
