# Solid 动态键色与 ONNX 保守融合技术方案

> 日期：2026-08-28  
> 版本：v1  
> 状态：已审查并实施  
> 范围：`apps/api` 的 Solid Seedream 提示词、内部键色、前景蒙版、质量验证、诊断备份与测试  
> 关联方案：[AI 主体背景分离失败根本修复](./20260827_根本修复AI主体背景分离失败.md) · [备份 Seedream 与最终前景阶段图片 v2](./20260828_备份Seedream与最终前景阶段图片_v2.md)

> 后续决策：ONNX 与动态键色已改为互斥策略，本方案中的保守融合和旧配置名由
> [可切换 ONNX 抠图与 Seedream 动态键色技术方案](./20260828_可切换ONNX抠图与Seedream动态键色_v1.md) 取代。

> 最新决策：ONNX 开启时仍先生成键色图，但成功路径直接使用 ONNX 蒙版，
> 不恢复本方案的蒙版融合。见 [ONNX 启用时动态键色预处理与直接抠图](./20260828_ONNX启用时动态键色预处理与直接抠图_v1.md)。

> 2026-08-28 审查补充：明确最终键色蒙版使用原尺寸分块计算，
> 不裁剪、不拉伸、不缩小最终处理图；同时补充边缘色聚类、
> 非键色残留物体、键色/ONNX 分歧、内存预算、分阶段故障语义、
> 备份命名、配置兼容和诊断数据保留规则。

## 1. 结论

Solid 不再只依赖 U-2-NetP 判断前景。Seedream 需要把主体外区域生成为经过动态选择的高对比平坦键色；服务端对实际图片验证 Seedream 是否遵循了键色协议。只有验证通过后，才使用“已知键色 + 画布边缘连通”生成主蒙版。

ONNX 的职责收窄为：

- 键色边界过渡区的保守前景证据；
- Seedream 未通过键色验证时的独立备选蒙版；
- 效果集中的差异诊断信号。

ONNX 不得在已验证的键色主体区内单方面把像素改成背景。预期产出的完整链路为：

```text
上传图片
  → 选择与输入主要颜色距离最大的内部键色
  → Seedream 生成平坦键色背景中间图
  → 键色遵循度验证
  → 生成边缘连通键色软蒙版
  → ONNX 蒙版推理与统一验证
  → 按证据分区保守融合
  → 边缘去键色污染
  → MARD 量化
  → 前端独立铺设用户选择的 Solid 背景
```

## 2. 问题与根因

### 2.1 当前失败模式

当前 Solid 请求先获得 Seedream 普通不透明增强图，再使用 U-2-NetP 输出的软概率蒙版直接替换图片 Alpha。U-2-NetP 是轻量显著前景检测模型，不是物理精确的 Alpha Matting 模型，对以下情况存在系统性风险：

- 主体内部低对比区域被判定为背景；
- 白色、浅色或与背景近色的主体区域透明；
- 多主体中次要主体被删除；
- 配件、细肢体、耳朵、尾巴、毛发边界或主体内部图案被挖空。

现有 `ForegroundPolicy` 主要验证整体前景覆盖率、背景覆盖率和不确定像素占比。当主体只是局部被挖空时，全局统计仍可能合法，因而误删结果会被当作成功。

### 2.2 为什么不只改 Prompt

高对比平坦背景能提高图像可分性，但 Prompt 仍是概率性指令：

- Seedream 可能偏离请求 HEX；
- 可能在键色背景中保留阴影、物体、渐变或纹理；
- 可能在主体边缘生成键色反光、抗锯齿混色或色溢；
- 可能把主体本身的近键色区域与背景连在一起。

因此键色必须被当作“待验证的背景证据”，不是 Seedream 适配器可直接宣称成功的协议。

## 3. 目标与非目标

### 3.1 目标

- Seedream 遵循键色要求时，主体是否保留不再由 ONNX 单方面决定；
- 主体核心、主体内部近背景色区域和多主体不被 ONNX 低置信区域误删；
- Seedream 完全忽略键色时，继续保留 ONNX 独立备选和显式 `simplify` 降级；
- 键色和 ONNX 每个阶段都可备份、重放、测量和观测；
- 用户最终 Solid 颜色仍只存在于前端渲染层，不进入 Seedream 键色协议、MARD 调色板和豆数统计；
- 不增加第二次 Seedream 请求。

### 3.2 非目标

- 不要求 Seedream 输出 MARD 色号或最终网格；
- 不使用用户选择的 `background_color` 作为内部键色；
- 不根据画布边缘的未知主色盲猜背景；
- 不因为引入键色就删除 ONNX Adapter seam；
- 不通过降低蒙版质量门槛掩盖失败；
- 不在缺少固定效果集时直接把初始阈值当作最终生产标准。

## 4. 架构与数据契约

### 4.1 增强结果携带可验证的背景提示

`SeedreamEnhancer` 在发起请求前选择内部键色，在返回图片时通过 `EnhancementResult` 将“请求过的键色”传给 `ForegroundPreparer`：

```python
@dataclass(frozen=True, slots=True)
class BackgroundHint:
    kind: Literal["chroma_key"]
    requested_color: tuple[int, int, int]
    policy_version: str


@dataclass(frozen=True, slots=True)
class EnhancementResult:
    image: Image.Image
    background_hint: BackgroundHint | None = None
```

`BackgroundHint` 只表示上游收到了什么指令，不表示上游已经遵循。验证、蒙版生成、融合和降级仍全部属于 `ForegroundPreparer` 深模块。

`PassThroughEnhancer` 和非 Solid Seedream 请求返回 `background_hint=None`。

### 4.2 新增内部结果

```python
@dataclass(frozen=True, slots=True)
class ChromaMaskResult:
    mask: Image.Image
    confidence: float
    actual_key_rgb: tuple[int, int, int]
    border_coverage: float
    background_coverage: float
    transition_coverage: float
    key_delta_e_p90: float
    policy_version: str
```

该对象只在图像模块内部流转，不进入 HTTP 响应。路由仍只消费 `PreparedForeground`。

### 4.3 处理方式可观测

`PreparedForeground.processing` 和响应 `meta.background_processing` 扩展为：

```python
Literal[
    "none",
    "chroma_matte",
    "hybrid_matte",
    "local_matte",
    "fallback_simplify",
]
```

语义：

| 值 | 含义 |
| --- | --- |
| `chroma_matte` | 键色完整验证通过，键色蒙版为主路径，ONNX 未改变最终边界 |
| `hybrid_matte` | 键色验证通过，ONNX 只在过渡区保守补充了前景 Alpha |
| `local_matte` | 键色验证失败或无 Hint，使用通过验证的 ONNX 蒙版 |
| `fallback_simplify` | 键色和 ONNX 均不可安全使用，且请求允许显式降级 |

这是向后兼容的枚举扩展，前端类型与响应校验必须同步接受新值。

## 5. 动态键色选择

### 5.1 候选集

策略版本 `solid-chroma-v1` 首期使用固定、可回放的高饱和候选集：

```python
CHROMA_KEY_CANDIDATES = (
    "#00FF00",  # 绿
    "#FF00FF",  # 洋红
    "#00FFFF",  # 青
    "#004CFF",  # 蓝
    "#FF3B00",  # 橙红
    "#7A00FF",  # 紫
)
```

候选集是代码中的版本化常量，不作为可任意修改的环境变量。

### 5.2 输入颜色观察

为避免遍历超大原图的所有像素：

1. 将上传 RGBA 图等比缩小到最长边不超过 256 px；
2. 忽略 Alpha 小于 128 的像素；
3. 将剩余 RGB 聚合为最多 64 个面积加权代表色；
4. 代表色和权重按固定顺序输出，确保同一图片结果可重放。

此阶段不尝试猜测哪些像素属于主体，而是对整张图的主要颜色做保守避让。

### 5.3 打分

计算每个候选键色到代表色的 CIEDE2000 色差，并使用低分位加权距离而不是绝对最小值：

```text
score(candidate) = weighted_percentile(delta_e(candidate, colors), 5%)
```

使用 5% 分位可防止单个噪点像素否决一个原本安全的键色，同时仍对主体中有实际面积的近键色区域保持敏感。选择分数最高的候选；同分时按候选定义顺序决定。

初始安全门槛建议为 `score >= 18`，但正式值必须根据效果集冻结。如果所有候选均不安全，本次不生成 `BackgroundHint`，沿用 ONNX 路径，不强行使用近色键色。

## 6. Seedream Solid Prompt

Prompt 版本由 `seedream-pindou-v10-conversion-style` 升级为新的唯一版本，预计命名：

```text
seedream-pindou-v11-validated-chroma
```

Solid 背景片段改为动态模板：

```text
背景处理：完整移除原背景及其中的物体、地面、投影、倒影、纹理和装饰，
保留所有主要前景主体及其完整自然轮廓、内部结构、配件和主体之间的关系。
将主体之外的全部画布严格填充为单一颜色 {chroma_key}。
该背景必须完全不透明、均匀、平坦、无渐变、无纹理、无阴影、无边框、无物体。
{chroma_key} 只允许出现在主体外背景，不得覆盖、替换、重新着色或删除主体内部的任何区域。
主体边缘不得出现 {chroma_key} 的反光、辉光、色溢、描边或抗锯齿色带。
不得删除浅色、白色、细小、低对比的主体部分，不得合并多个主体。
```

`background_color` 是用户最终渲染色，不插入此 Prompt，也不参与键色选择。

## 7. 键色遵循度验证

### 7.1 低成本边缘检测

对 Seedream 输出生成最长边不超过 512 px 的诊断缩略图，使用图像宽高的 2% 作为四边采样带，且每边至少 2 px。

不先用请求 HEX 的严格阈值过滤全部边缘像素，否则 Seedream 输出
“整体均匀但相对请求值系统性偏色”时会无法估计实际键色。改用：

1. 对四边采样带的 RGB/Lab 执行有界、确定性颜色聚类；
2. 按覆盖率、簇内色差和与请求键色的距离对颜色簇排序；
3. 选择“覆盖率足够、簇内平坦，且与请求键色最近”的簇；
4. 使用该簇 RGB 中位数估计 `actual_key_rgb`；
5. 再检查实际键色与请求键色的偏差是否超出策略窗口。

聚类数量、初始化、最大迭代次数和同分决策顺序全部固定在
`ChromaPolicy`，不使用无随机种子的聚类。后续蒙版和去色溢均基于
`actual_key_rgb`，不盲目使用请求 HEX。

### 7.2 验证指标

首期记录并标定：

- `border_coverage`：四边采样带中近键色像素占比；
- `edge_count`：四条边中至少有合格键色的边数；
- `key_delta_e_p90`：键色候选与实际键色的 P90 色差；
- `background_coverage`：从画布边缘可连通到的键色区域占比；
- `transition_coverage`：软边界像素占比；
- `largest_non_key_border_component`：接触画布边缘的非键色异常区域占比；
- `unexpected_non_key_components`：不与已知主体相连、且缺少 ONNX 高置信
  前景支持的非键色孤立区域数量与面积；
- `foreground_disagreement`：键色判定为前景、ONNX 判定为高置信背景的占比；
- `background_disagreement`：键色判定为严格背景、ONNX 判定为高置信前景的占比；
- `transition_expansion`：ONNX 在键色过渡带中增加的 Alpha 面积与最大宽度。

初始验证窗口只用于建立效果集基线，建议起点：

```text
border_coverage >= 0.70
edge_count >= 3
0.01 <= background_coverage <= 0.95
transition_coverage <= 0.20
```

所有阈值收口到不可变 `ChromaPolicy(version="solid-chroma-v1")` 中。未完成效果集标定前，不把上述建议值直接视为生产真理。

## 8. 键色软蒙版

### 8.1 只从画布边缘生长背景

在 Seedream **完整原尺寸输出**上，以 `actual_key_rgb` 为参考生成色差与蒙版。
这一步不裁剪图片、不改变构图、不拉伸长宽比，也不把缩略图蒙版
直接放大作为最终结果。第 7 节的 512 px 缩略图只用于低成本遵循度判断。

为限制峰值内存，原尺寸色差使用固定行数的水平条带分块计算，例如每批
128–256 行：

```text
完整 Seedream RGBA
  → 读取第 0..255 行
  → 向量化 sRGB → Lab → DeltaE76
  → 将该条带结果写入同尺寸蒙版/二值候选存储
  → 释放条带临时数组
  → 继续下一条带，直到覆盖全部行
```

分块只改变内存中同时存在的临时数组大小，所有像素仍会被计算且写回
与 Seedream 输出完全同尺寸的结果。实现不同时保留整图 RGB、Lab、
DeltaE 和多份中间蒙版。

使用 NumPy 向量化 sRGB → Lab 和 DeltaE76，不在逐像素 Python 循环中调用
CIEDE2000。CIEDE2000 只用于候选键色小集合打分。

从四边所有满足 `DeltaE76 <= T_grow` 的像素出发，只访问与键色相近的连通区域。不删除与画布边缘不连通的主体内部近键色区域。

### 8.2 内存预算与连通区存储

不对最大 2000 万像素输出创建多份整图 `float32[H,W,3]`。实现前在目标
NAS 上测量并冻结：

- 单条带 RGB/Lab/DeltaE 临时数组的总字节数；
- 全尺寸二值候选、访问状态和最终 `uint8` Alpha 的字节数；
- Seedream 图、ONNX Session、蒙版融合与量化同时存在时的单请求峰值 RSS；
- `ARK_DOUBAO_MAX_CONCURRENCY` 与 `FOREGROUND_MASK_MAX_CONCURRENCY` 叠加后的进程总内存。

连通区访问优先使用压缩位图、`uint8` 或逐行扫描/并查集实现，不对每个像素
建立 Python 对象或坐标 tuple。条带高度和内存上限由策略版本固定，不允许请求端修改。

### 8.3 软 Alpha

以两个版本化阈值生成过渡：

```text
distance <= T_background  → alpha = 0
distance >= T_foreground  → alpha = 255
中间区间                    → 按色差平滑插值
```

软 Alpha 只应用于与已确认背景连通的边界带。对非连通近键色区域保持 255，避免主体服饰、眼睛、Logo 或配件恰好使用键色时被整块删除。

## 9. ONNX 保守融合

### 9.1 蒙版证据分区

键色蒙版验证通过时，将像素分成：

| 区域 | 判定 | 融合规则 |
| --- | --- | --- |
| 已知键色背景 | 与键色严格近似且与画布边缘连通 | 保持背景；ONNX 不得把大面积纯键色恢复为主体 |
| 键色过渡带 | 与已知背景连通，色差处于软 Alpha 区间 | `max(chroma_alpha, onnx_alpha)`，只允许 ONNX 保护更多前景 |
| 非键色区域 | 不属于已验证边缘连通背景 | 键色蒙版按前景保留；ONNX 不得将其删除 |

不使用全局 `min(chroma_alpha, onnx_alpha)` 或蒙版相乘，因为这会继续放大 ONNX 的主体漏检。

### 9.2 非键色残留物体

“非键色”不天然等于“主体”。Seedream 可能已把大部分背景换成键色，
但仍残留椅子、地面、阴影、文字或小物体。如果直接保留所有非键色像素，
这些残留会被当作主体进入 MARD 量化。

对非键色连通域记录：

- 面积、边界框、是否接触画布边缘；
- 与最大主体候选的连通关系；
- ONNX 高置信前景支持率；
- 与键色背景的边界长度；
- 是否属于独立的小面积孤岛。

模块不依靠这些启发式指标直接删除区域。当出现面积超过策略门槛、
与主体不相连且缺少 ONNX 支持的可疑非键色物体时，将整张键色蒙版标记为
语义低置信，而不是静默删除它：

- 请求允许 `simplify`：返回明确降级；
- 不允许降级：返回 422；
- 效果集证明某类可疑连通域可稳定由 ONNX 判别后，再在新策略版本中增加自动清理。

这样优先保护主体，也不把明显背景残留伪装成 Solid 成功。

### 9.3 分歧和过渡带上限

对第 7.2 节的三个分歧指标定义策略门槛：

- `foreground_disagreement` 过高：保留键色证据确认的前景，不让 ONNX 删除；
- `background_disagreement` 过高：键色和 ONNX 至少一路异常，标记为低置信，不静默成功；
- `transition_expansion` 超过最大像素宽度或最大画面占比：拒绝 ONNX 本次边界补充，使用未扩张的键色蒙版或进入低置信决策。

分歧阈值必须按人物、宠物、商品、动漫、多主体等效果集分片标定，
不只使用整体平均数。

### 9.4 键色失效时

键色验证失败不等于整个请求必然失败：

1. ONNX 蒙版通过现有统一验证：使用 `local_matte`；
2. ONNX 低置信且 `fallback_mode=simplify`：返回 `fallback_simplify`；
3. ONNX 低置信且不允许降级：返回 422 `AI_BACKGROUND_SEPARATION_FAILED`；
4. ONNX 运行时、模型或排队故障：继续返回 503，不用内容降级掩盖系统故障。

## 10. 边缘去键色污染

仅修改 Alpha 不足以消除 Seedream 在主体边缘生成的绿边、青边或洋红边。这些混色像素 Alpha 可能仍高于量化占用阈值，从而污染 MARD 调色板。

对键色软蒙版的过渡像素执行去溢色：

1. 基于实际键色 `K`、观察色 `C` 和最终 Alpha `a` 估计未污染前景色；
2. 只处理 `0 < a < 255` 且与键色连通背景相邻的窄边界带；
3. Alpha 过低时不反演 RGB，直接保持透明，避免除法放大噪声；
4. 反演结果限制在 sRGB 合法范围，并与最近高置信前景色执行有界混合；
5. 如果效果集不能证明反演稳定，首期降级为“最近高置信前景色传播到 1–2 px 边界”，不带着未标定的反演算法上线。

去溢色只是 RGB 边界清理，不改变已确认的前景/背景语义。

## 11. ONNX 预处理修正

当前 ONNX Adapter 把任意长宽比图片直接拉伸到 `320×320`。本方案同步修正为：

```text
等比缩放到 320×320 内
  → 使用中性颜色补边
  → ONNX 推理
  → 从输出蒙版移除补边
  → 恢复到 Seedream 原尺寸
```

避免主体比例畸变导致细长结构、多主体间距和边界被误判。

现有逐图 min-max 归一化不在未建立对照证据前直接删除。效果集需同时输出模型原始范围、min-max 后蒙版和最终蒙版，再决定是否切换到模型原生概率解释。

## 12. 决策矩阵

| Seedream 键色 | 键色蒙版 | ONNX | 请求降级 | 结果 |
| --- | --- | --- | --- | --- |
| 验证通过 | 可用，无重大语义异常 | 可用 | 任意 | `chroma_matte` 或 `hybrid_matte` |
| 验证通过 | 可用 | 低置信 | 任意 | `chroma_matte`，不让 ONNX 低置信否定键色证据 |
| 验证通过 | 存在重大非键色残留或背景分歧 | 任意 | `simplify` | `fallback_simplify` |
| 验证通过 | 存在重大非键色残留或背景分歧 | 任意 | `none` | 422 `AI_BACKGROUND_SEPARATION_FAILED` |
| 验证失败 | 不可用 | 可用 | 任意 | `local_matte` |
| 验证失败 | 不可用 | 低置信 | `simplify` | `fallback_simplify` |
| 验证失败 | 不可用 | 低置信 | `none` | 422 `AI_BACKGROUND_SEPARATION_FAILED` |
| 任意 | 任意 | 运行故障 | 任意 | 503，不转换为内容降级 |

ONNX 运行故障按阶段处理：

- 影子与首轮灰度：即使键色蒙版可用，仍返回 503，以暴露部署和容量问题；
- 键色独立验收通过后：只有满足键色独立成功门槛的请求可以返回 `chroma_matte`；
- 键色未通过独立门槛：ONNX 故障仍返回 503，不用降级掩盖系统故障。

“键色独立成功”必须作为新策略版本和独立灰度开关发布，不在阈值尚未冻结时自动启用。

## 13. 诊断备份与可观测性

以阶段备份 v2 方案为前置，Solid 成功请求至少保存：

```text
{timestamp}-original.png
{timestamp}-seedream-enhanced.png
{timestamp}-foreground-final.png
{timestamp}-foreground-metrics.json
```

最终图可能来自 `chroma_matte`、`hybrid_matte` 或 `local_matte`，因此不再使用
`onnx-matted` 命名。v2 方案明确取代原阶段备份 v1 的新请求命名，历史文件不重命名。

建议指标：

- 请求键色与实际键色；
- 键色选择分数和策略版本；
- 键色验证全部指标；
- ONNX 蒙版的前景、背景和不确定覆盖率；
- 键色与 ONNX 的像素级分歧占比；
- 实际 `background_processing`；
- Seedream、键色、ONNX、融合、去色溢和量化分阶段耗时。

指标 JSON 不记录 API Key、Data URL、完整 Prompt 或用户原文。

备份中包含用户图片，生产启用前必须同时落地：

- 服务用户专属读写权限；
- 图片与指标的 TTL；
- 单文件、单图组和目录总容量上限；
- 定时清理与容量超限清理；
- 访问审计和故障排查授权范围；
- 关闭诊断备份的稳定配置开关。

生产不允许只落地写盘而不落地 TTL/容量清理。

## 14. 测试方案

### 14.1 纯函数单元测试

- 候选键色对固定颜色集的选择确定性；
- 透明像素不参与键色选择；
- 所有候选不安全时返回无 Hint；
- 完美平坦键色、偏离 HEX 键色、渐变键色和带纹理键色的验证结果；
- 只删除与画布边缘连通的近键色区域；
- 主体内部的非连通键色 Logo、眼睛和配件保留；
- 软 Alpha 单调且限制在 0..255；
- ONNX 只能在键色过渡带增加 Alpha，不能把非键色主体删除；
- 去色溢不修改高置信主体内部色；
- 大图不使用逐像素 Python CIEDE2000 循环。
- 构造超宽、超高和最大像素样本，确认分块计算覆盖每个像素、不裁剪且与非分块小图结果一致；
- 验证条带边界不产生蒙版断层或重复行；
- 边缘均匀但相对请求 HEX 整体偏色时，能通过聚类估计实际键色；
- 存在孤立椅子、地面或阴影时，不把明显残留静默当作主体成功；
- 前景分歧、背景分歧和过渡带膨胀超限时按决策矩阵处理。

### 14.2 ForegroundPreparer 契约测试

- Solid + 合格键色 + ONNX 漏判主体：最终主体仍保留；
- Solid + 合格键色 + ONNX 边界补充：返回 `hybrid_matte`；
- Solid + 键色失效 + ONNX 可用：返回 `local_matte`；
- Solid + 两路低置信：按 `fallback_mode` 返回 422 或 `fallback_simplify`；
- Keep / Simplify：不选择键色，不执行键色蒙版，不执行 ONNX；
- 所有成功、验证失败和运行时异常路径正确关闭 Pillow 对象。

### 14.3 ONNX Adapter 回归

- 非方图经等比 resize/pad/unpad 后蒙版与原图对齐；
- 人物、宠物和商品的固定输出不因预处理修正发生坐标偏移；
- 相同图片、模型、Provider 和硬件上重复输出一致。

### 14.4 API 与前端契约

- 响应允许 `chroma_matte` 和 `hybrid_matte`；
- `background.mode=solid` 时用户背景色仍不进入前景 palette 和 bead count；
- 响应不暴露内部键色，避免把诊断细节变成公开契约；
- 备份图组可通过相同时间戳配对，最终图命名反映融合后语义。

### 14.5 固定效果集

至少包含：

- 白色/浅色主体 + 白色/浅色背景；
- 黑色主体 + 深色背景；
- 主体本身包含绿、洋红、青、蓝、紫等候选键色；
- 人物、宠物、商品、动漫、多主体；
- 毛发、细肢体、耳朵、尾巴、透明/半透明物体；
- 主体贴边、主体很小、主体占满画布；
- Seedream 完美键色、偏色、渐变、带阴影、含背景物体和完全忽略 Prompt 的冻结输出；
- 已观测到“ONNX 将主体内部算为背景”的真实失败图。

Seedream 存在随机性，每个关键组合至少生成 3 次；蒙版和量化算法对比使用冻结的 Seedream 输出，不把生成随机性混入算法 A/B。

## 15. 验收标准

以当前 ONNX-only 为基线，至少满足：

- 已知主体核心误删样本在新策略中严重误删数为 0；
- 键色验证通过样本的主体关键区域召回率不低于 0.99；
- 键色验证失败时不会作为键色成功进入量化；
- 主体内部非连通近键色区域保留率 100%；
- 最终网格不出现明显绿边、青边或洋红边；
- 背景残留格、主体误删格和豆数偏差都有人工标注与对比数据；
- 键色选择、验证、蒙版与融合的新增 CPU P95 在目标 NAS 上不超过 300 ms；
- 最大允许像素样本全程不裁剪、不拉伸、不改变最终蒙版尺寸；
- 分块与非分块小图蒙版逐像素一致，条带边界零裂缝；
- 单请求峰值 RSS 和最大并发进程 RSS 不超过目标 NAS 冻结的资源预算；
- 重大非键色残留和重大背景分歧样本不会被静默标记为 Solid 成功；
- 不增加 Seedream 请求数，不改变单次请求扣次语义；
- 没有未关闭的 Pillow 图片对象或无界临时缓冲。

## 16. 分阶段实施

### P0：诊断基线

- 先落地原图、Seedream 图和最终前景图的分阶段备份；
- 收集并标注已发生的 ONNX 主体误删图；
- 记录当前 ONNX 覆盖率、不确定区域、误删格和背景残留格。

完成标准：至少有一组真实失败 Seedream 中间图，可在本地无网络重放 ONNX-only 失败。

### P1：动态键色与 Prompt

- 实现键色候选纯函数与版本化策略；
- 升级 Solid Prompt；
- 使 `EnhancementResult` 携带可验证 `BackgroundHint`；
- 保持 Keep / Simplify Prompt 不变。

完成标准：真实 Seedream 效果集中可统计每个候选色的遵循率、偏色和色溢。

### P2：键色验证与蒙版

- 实现边缘键色校验、实际键色估计、连通区域和软 Alpha；
- 失败时只返回内部不可用结果，不改变用户背景语义；
- 对冻结 Seedream 图执行确定性回放。

完成标准：键色失效图 100% 被拒绝为键色成功，主体内部非连通近键色区域全部保留。

### P3：ONNX 保守融合与预处理

- 实现证据分区融合；
- 实现去键色污染；
- 修正 ONNX 等比 resize/pad/unpad；
- 扩展 `background_processing` 可观测契约。

完成标准：相同失败图中 ONNX 不再拥有删除已验证非键色主体的能力，最终 MARD 网格无明显键色污染。

### P4：效果集标定与灰度

- 冻结 `solid-chroma-v1` 阈值和策略版本；
- 先影子计算键色蒙版，不影响对外结果；
- 对比 ONNX-only 与新链路的主体误删、背景残留、网格色污染和 P95；
- 通过稳定开关按 10% / 50% / 100% 灰度。

完成标准：达到第 15 节验收门槛，并运行一个完整观察周期。

## 17. 预计代码改动

```text
apps/api/src/pindou/
  core/
    config.py
  services/
    enhancer.py
    seedream_enhancer.py
    seedream_prompt.py
  imaging/
    chroma_key.py                  # 纯函数：选色、验证、蒙版、去溢色
    foreground.py
    foreground_mask_onnx.py
    image_backup.py
  schemas/
    conversion.py
  api/routes/
    conversions.py

apps/api/tests/
  test_chroma_key.py
  test_seedream.py
  test_foreground.py
  test_foreground_mask_onnx.py
  test_image_backup.py
  test_api.py

apps/web/src/
  lib/types.ts
  lib/api.ts

apps/api/.env.example
apps/api/README.md
deploy/.env.example
docs/devops/fnOS-docker-deployment.md
```

所有新增函数、色差算法、连通区域、软 Alpha、蒙版融合、去溢色和图片所有权边界都需添加中文注释。

## 18. 风险与回滚

| 风险 | 保护措施 |
| --- | --- |
| Seedream 忽略键色 Prompt | 图像级遵循度验证，失败转 ONNX |
| 键色与主体近色 | 动态选色、安全门槛、只删除边缘连通区域 |
| 主体边缘键色污染 | Prompt 禁止色溢 + 实际键色估计 + 窄边界去溢色 |
| ONNX 继续误删主体 | 键色成功时 ONNX 只能在过渡区增加 Alpha |
| 键色留下非键色背景物体 | 平坦度/边缘异常验证；不合格不走键色成功 |
| CPU 成本增长 | 小图校验、NumPy 向量化色差、固定并发限制 |
| 大图全尺寸数组导致内存峰值 | 原尺寸条带分块、有界连通区存储、目标机 RSS 验收 |
| 非键色背景物体被当作主体 | 连通域 + ONNX 支持率诊断；有重大歧义时降级或 422，不静默删除 |
| 备份空间增长 | 分阶段命名、TTL/容量清理另行实施 |

回滚以策略开关为单一边界：

```text
SOLID_FOREGROUND_STRATEGY=onnx-only | validated-chroma-v1
```

该开关只选择经过完整测试的策略版本，不允许线上任意调整单项阈值。回滚到 `onnx-only` 时不修改 HTTP 请求、数据库和 MARD 网格 Schema。

`Settings` 对策略值执行枚举校验，非法值在启动期失败。测试环境和首次发布默认
`onnx-only`；只有显式配置才启用 `validated-chroma-v1`。环境示例、部署模板和运维文档必须同步更新。

`background_processing` 是公开响应枚举，新值发布前必须先更新 Web 类型与校验。
如果还存在不可协调的旧客户端，则继续对外返回 `local_matte`，将精细策略
只记录在内部日志/指标，待客户端完成升级后再扩展公开枚举。

## 19. 实施前审查项

- [ ] 确认动态键色候选集和不安全时 ONNX-only 回退语义；
- [ ] 确认键色成功时 ONNX 不得删除非键色区域；
- [ ] 确认内部键色不进入公开 HTTP 响应；
- [ ] 确认 `background_processing` 扩展对前端的兼容策略；
- [ ] 确认阶段备份的最终图改名为 `foreground-final`；
- [ ] 确认先影子计算、后灰度切换，不一次性替换全部 Solid 结果；
- [ ] 确认效果集授权、失败样本保留时间和访问范围。
- [ ] 确认原尺寸条带分块高度、中间存储类型和目标 NAS 单请求/总进程内存预算；
- [ ] 确认可疑非键色残留不自动删除，而是降级或 422；
- [ ] 确认键色独立成功只能在独立验收和新策略版本发布后启用；
- [ ] 确认生产诊断备份与 TTL、容量上限、清理和访问审计同步上线。
