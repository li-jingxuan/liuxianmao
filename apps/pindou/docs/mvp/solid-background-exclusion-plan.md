# Solid 纯色背景分层渲染与统计排除：可实施技术方案

> 状态：已调整并实施（不依赖 AI 返回透明 Alpha）  
> 适用范围：`apps/api` 图片增强、预处理、量化和 API 响应，以及 `apps/web` 预览、统计和施工图导出  
> 设计原则：背景是渲染层，主体是量化层；两者不混入同一个调色板

## 1. 目标与结论

目标：在 `background_mode=solid` 时，让 AI 尽量去除背景；即使上游只返回白底/不透明图片，服务端也要抠除与边缘连通的近似纯色背景。背景不参与 MARD 量化、不显示色号、不计入颜色数和豆数，但仍在预览和导出图纸中显示用户选择的纯色。

最终采用两层模型：

```text
背景层 background
  └── 只负责铺设纯色背景，不包含拼豆和 MARD 色号

前景层 foreground
  ├── palette：只包含主体使用的 MARD 颜色
  └── rows：只包含主体拼豆，null 表示不放主体豆
```

不再使用顶层 `background_mask`。原因是 Solid 背景是全局统一渲染层，不需要为每个网格单元重复记录背景状态。

## 2. 当前实现的问题

当前代码曾存在以下耦合：

- [apps/api/src/pindou/imaging/preprocess.py](../../apps/api/src/pindou/imaging/preprocess.py) 在量化前把纯色背景合成到 RGBA 画布。
- [apps/api/src/pindou/imaging/quantize.py](../../apps/api/src/pindou/imaging/quantize.py) 会把主体和背景一起参与 MARD 颜色选择。
- [apps/api/src/pindou/services/seedream_prompt.py](../../apps/api/src/pindou/services/seedream_prompt.py) 要求 AI 输出透明背景，但实测上游仍可能返回白底。
- [apps/api/src/pindou/services/seedream_enhancer.py](../../apps/api/src/pindou/services/seedream_enhancer.py) 能识别 Alpha 状态，但 Prompt 不能替代实际背景抠除。
- [apps/web/src/lib/canvas.ts](../../apps/web/src/lib/canvas.ts) 当前按照 `rows + palette` 绘制所有可见格，并在导出时给所有非透明格添加色号。
- [apps/web/src/lib/bead-grid.ts](../../apps/web/src/lib/bead-grid.ts) 当前只根据 `-1` 统计非透明格，无法区分背景和主体。

## 3. 新的数据契约

### 3.1 响应示例

```json
{
  "schema_version": "3",
  "algorithm_version": "bead-grid-constrained-v2",
  "width": 3,
  "height": 2,
  "foreground": {
    "palette": [
      {
        "id": 0,
        "brand": "MARD",
        "code": "A4",
        "hex": "#FFE953",
        "rgb": [255, 233, 83]
      }
    ],
    "rows": [
      [0, 0, null],
      [null, 0, null]
    ]
  },
  "background": {
    "mode": "solid",
    "color": "#FFFFFF"
  },
  "meta": {
    "background_mode": "solid",
    "background_processing": "edge_flood_fill",
    "color_set_size": 221,
    "effective_max_colors": 8,
    "color_budget_mode": "auto",
    "color_budget_policy_version": "grid-color-budget-v2",
    "color_chart_version": "1.0"
  },
  "stats": {
    "bead_count": 3,
    "color_count": 1
  }
}
```

### 3.2 字段语义

| 字段 | 语义 |
| --- | --- |
| `foreground.palette` | 只包含主体实际使用的 MARD 颜色，不包含 Solid 背景色。 |
| `foreground.rows[y][x]` | `number` 表示 `palette` 索引；`null` 表示该格不放主体豆。 |
| `background.mode` | `solid` 表示渲染时铺设纯色；`none` 表示不铺设额外背景。 |
| `background.color` | `mode=solid` 时的 CSS/Canvas HEX 颜色，仅用于渲染，不参与量化。 |
| `meta.background_mode` | 用户选择的处理模式，保留 `solid`、`keep`、`simplify` 语义。 |
| `meta.background_processing` | 实际背景分离路径：`native_alpha`、`edge_flood_fill` 或 `none`。 |
| `stats.bead_count` | `foreground.rows` 中所有非 `null` 格子的数量。 |
| `stats.color_count` | `foreground.palette.length`，只统计主体颜色。 |

### 3.3 为什么使用 `null` 而不是 `-1`

旧结构使用 `-1` 表示透明格。新结构不考虑兼容性，因此改成 `null`：

- TypeScript 类型直接表达为 `Array<number | null>`；
- 不需要记忆负数是特殊索引；
- 后端 Pydantic 校验更直观；
- 统计逻辑可以直接判断 `cell !== null`。

### 3.4 Pydantic 与 TypeScript 类型

后端建议新增：

```python
class ForegroundGrid(BaseModel):
    palette: list[PaletteColor]
    rows: list[list[int | None]]


class RenderBackground(BaseModel):
    mode: Literal["solid", "none"]
    color: str | None = Field(default=None, pattern=r"^#[0-9A-F]{6}$")


class ConversionStats(BaseModel):
    bead_count: int = Field(ge=0)
    color_count: int = Field(ge=0)
```

前端建议使用：

```ts
export type BeadGrid = {
  schema_version: "3";
  algorithm_version: "bead-grid-constrained-v2";
  width: number;
  height: number;
  foreground: {
    palette: PaletteColor[];
    rows: Array<Array<number | null>>;
  };
  background:
    | { mode: "solid"; color: `#${string}` }
    | { mode: "none" };
  meta: ConversionMeta;
  stats: {
    bead_count: number;
    color_count: number;
  };
};
```

响应校验必须验证：

- `foreground.rows.length === height`；
- 每一行长度等于 `width`；
- 非 `null` 索引必须落在 `foreground.palette` 范围内；
- `background.mode=solid` 时必须存在合法 `background.color`；
- `stats` 与网格重新计算结果一致。

## 4. AI Solid 模式：Prompt 仅作提示，服务端负责兜底抠除

### 4.1 Prompt 调整

保留 [apps/api/src/pindou/services/seedream_prompt.py](../../apps/api/src/pindou/services/seedream_prompt.py) 的透明背景提示，但不再把透明 Alpha 视为上游保证：

```text
完整移除原背景及其中所有无关物体，仅保留前景主体及其自然边缘。
输出透明背景，背景区域 Alpha 必须为 0。
不要生成白色或其他纯色背景，不要生成地面、地平线、投影、边框或渐变。
不改变主体内部原有颜色。
```

`background_color` 不再拼入 AI Prompt。它只在前端预览和 PNG 导出阶段铺设。

### 4.2 Alpha 状态检测

调整 [apps/api/src/pindou/services/seedream_enhancer.py](../../apps/api/src/pindou/services/seedream_enhancer.py)：

1. 在 `convert("RGBA")` 之前检查原图片是否包含 Alpha 通道。
2. 检查 Alpha 是否至少存在一部分低于 `alpha_occupied_threshold` 的像素。
3. RGB/JPG 或 Alpha 全部为 255 的结果不能视为透明背景。
4. 内部记录 `background_alpha_status`：`transparent`、`opaque` 或 `absent`。

Alpha 检测只用于决定是否执行后处理；`absent` / `opaque` 不再直接进入量化。

Prompt 是意图，不是协议。无论上游是否返回 Alpha，Solid 模式都必须先经过服务端背景后处理。

### 4.3 服务端边缘连通抠除

新增 `remove_connected_solid_background()` 后处理：

1. 读取图片四边所有不透明像素，以 16 档 RGB 直方图选择最常见的边缘颜色作为背景参考。
2. 从四条边开始四邻域 flood-fill，只访问与参考色距离不超过阈值的像素。
3. 将访问到的背景像素 Alpha 置为 0；主体内部被其他颜色包围的同色区域不会被误删。
4. 默认 RGB 欧氏距离阈值为 `42`，通过 `SOLID_BACKGROUND_REMOVAL_THRESHOLD` 可调。
5. 处理后再执行方形适配和 MARD 量化；因此背景不会进入 `foreground.palette`、`stats.color_count` 或 `stats.bead_count`。

该算法针对“AI 生成纯白/近白背景”提供确定性兜底，不承诺替代专业抠图。主体与背景在边缘大面积同色时可能发生误删，应通过阈值和样例集评估。

## 5. 后端实施方案

### 5.1 增强器结果

建议将增强器返回值从单独的 `Image.Image` 扩展为：

```python
@dataclass(frozen=True, slots=True)
class EnhancementResult:
    image: Image.Image
    background_alpha_status: Literal["transparent", "opaque", "absent"]
```

`PassThroughEnhancer` 返回 `opaque` 或根据输入 Alpha 返回实际状态；Seedream 返回解码后的真实 Alpha 状态。

### 5.2 Solid 背景后处理与方形预处理

调整 [apps/api/src/pindou/imaging/preprocess.py](../../apps/api/src/pindou/imaging/preprocess.py) 的 `fit_to_square_grid()`：

1. Seedream 输出 `absent` / `opaque` Alpha 且请求为 `solid` 时，先执行边缘连通近似纯色抠除。
2. 使用 `ImageOps.contain()` 计算 fitted 图片位置。
3. 创建透明的 N×N RGBA 画布，将处理后的图片合成到透明画布。
4. `solid` 模式的外部补边保持 Alpha=0；背景颜色只由前端渲染层铺设。
5. `keep`/`simplify` 模式不执行 Solid 抠除，继续保持原有透明补边语义。

`background_color` 只作为领域参数传递到响应和渲染层，不得写入量化输入图片。

### 5.3 前景量化

调整 [apps/api/src/pindou/imaging/quantize.py](../../apps/api/src/pindou/imaging/quantize.py)：

```text
读取透明 RGBA 工作图
  ↓
按 Alpha 阈值筛选前景像素
  ↓
只使用前景 RGB 构建 observations
  ↓
使用现有 CIEDE2000 算法选择前景 MARD 调色板
  ↓
前景格写入 palette 索引
透明格写入 null
  ↓
计算 bead_count 和 color_count
```

具体规则：

- `effective_max_colors` 只限制前景颜色；
- 背景不进入 observations，不消耗颜色预算；
- Alpha 小于阈值的格输出为 `null`；
- 全部透明时 `palette=[]`、所有格为 `null`、统计均为 0；
- 调色板只按前景首次出现顺序生成，保持确定性。

建议内部领域对象：

```python
@dataclass(frozen=True, slots=True)
class QuantizedForegroundGrid:
    width: int
    height: int
    palette: tuple[MardColor, ...]
    rows: tuple[tuple[int | None, ...], ...]
    bead_count: int
    color_count: int
    algorithm_version: str
```

### 5.4 HTTP 响应

调整 [apps/api/src/pindou/api/routes/conversions.py](../../apps/api/src/pindou/api/routes/conversions.py)：

- 将量化结果序列化到 `foreground.palette` 和 `foreground.rows`；
- 将 `background_mode=solid` 转换为 `background={"mode":"solid","color":...}`；
- 将 `keep`/`simplify` 转换为 `background={"mode":"none"}`；
- 统计使用领域层的 `bead_count` 和 `color_count`；
- 不再返回 `background_mask`。

## 6. 前端实施方案

### 6.1 统计辅助函数

调整 [apps/web/src/lib/bead-grid.ts](../../apps/web/src/lib/bead-grid.ts)：

```ts
/** 统计主体实际需要制作的拼豆数量；null 表示背景或空格，不计入统计。 */
export const countForegroundBeads = (grid: BeadGrid): number =>
  grid.foreground.rows.reduce(
    (total, row) => total + row.filter((cell) => cell !== null).length,
    0,
  );
```

颜色数直接使用 `grid.stats.color_count` 或 `grid.foreground.palette.length`，不再遍历背景状态。

### 6.2 Canvas 绘制

调整 [apps/web/src/lib/canvas.ts](../../apps/web/src/lib/canvas.ts)：

```text
清空画布
  ↓
如果 background.mode=solid，填充 background.color
  ↓
遍历 foreground.rows
  ↓
cell=null：跳过
cell=number：从 foreground.palette 取颜色并绘制
  ↓
导出模式下只给 number 格绘制色号
  ↓
最后绘制网格线
```

`drawBeadGrid()` 不再接收旧的顶层 `grid.palette` 和 `grid.rows`，统一读取 `grid.foreground`。

### 6.3 页面统计和主要颜色

调整 [apps/web/src/components/pindou-converter.tsx](../../apps/web/src/components/pindou-converter.tsx)：

- “使用颜色”显示 `grid.stats.color_count`；
- “总豆数”显示 `grid.stats.bead_count`；
- 主要颜色遍历 `grid.foreground.palette`；
- Solid 模式增加文案“纯色背景不计入颜色和豆数”；
- 不再进行背景色过滤。

### 6.4 PNG 导出

调整 [apps/web/src/lib/pattern-sheet-export.ts](../../apps/web/src/lib/pattern-sheet-export.ts)：

- 布局根据 `grid.foreground.palette.length` 计算图例高度；
- 图像信息使用 `grid.stats.color_count` 和 `grid.stats.bead_count`；
- 先铺设 Solid 背景，再绘制前景网格；
- 图例只遍历 `grid.foreground.palette`；
- 色号只绘制在 `foreground.rows` 中非 `null` 的格子。

## 7. 详细中文注释要求

实现代码必须在关键位置添加中文注释。注释不是逐行翻译代码，而是解释业务语义、数据不变量和容易出错的边界。

### 7.1 Python 后端注释要求

必须注释以下位置：

- AI Alpha 状态：说明 RGB 转 RGBA 不代表图片具备透明背景，并会触发边缘抠除；
- 透明画布预处理：说明 `background_color` 为什么不能在量化前合成；
- Alpha 阈值判断：说明低 Alpha 格会输出为 `None`；
- 调色板选择：说明颜色预算只作用于前景；
- API 序列化：说明背景层和前景层为什么分开返回；
- 边缘 flood-fill：说明近似纯色阈值和连通性只能处理纯色背景，不能识别复杂语义背景。

推荐注释风格：

```python
# Solid 背景只在渲染层存在，量化输入必须保持透明；否则大面积背景会
# 参与 observations，挤占主体颜色预算并被错误统计为 MARD 拼豆颜色。
```

### 7.2 TypeScript 前端注释要求

必须注释以下位置：

- `null` 单元的业务含义；
- Canvas 先铺背景、后画主体的顺序；
- 导出时为什么只给非 `null` 格绘制色号；
- 统计函数为什么不再遍历背景 Mask；
- API 响应校验中的索引和尺寸不变量。

推荐注释风格：

```ts
// 背景是独立渲染层，不属于需要购买和标注的主体拼豆。
// 因此 null 不能绘制色块、色号，也不能进入豆数统计。
```

### 7.3 注释验收标准

- 新增或修改的公共函数必须有中文 JSDoc/docstring；
- 复杂分支至少有一条中文说明“为什么这样做”；
- 不使用与实际逻辑不符的旧术语，如 `background_palette_index`；
- 注释必须随着字段语义同步更新，禁止保留“背景参与量化”等过期说明。

## 8. 版本与测试

### 8.1 版本策略

不考虑兼容性，直接升级：

- `schema_version: "3"`；
- `algorithm_version: "bead-grid-constrained-v2"`；
- 删除 `background_mask`、顶层 `palette` 和顶层 `rows`；
- 新增 `foreground`、`background`、`stats`。

### 8.2 后端测试

在 `apps/api/tests` 增加：

1. Solid + 透明 AI 输出：背景 Alpha 转为 `null`，不进入调色板。
2. Solid + RGB/不透明 AI 输出：从边缘连通近似纯色区域抠除后再量化。
3. Alpha 小于阈值的格不计入 observations、豆数和颜色数。
4. 背景大面积存在时，前景仍可使用完整 `effective_max_colors`。
5. 全透明图片返回空调色板和全 `null` rows。
6. 非正方形图片的外部补边保持透明，不进入量化。
7. Solid Prompt 要求透明 Alpha，不再要求 AI 生成指定 HEX 背景。
8. 主体内部被背景色包围的同色像素保持不透明。

### 8.3 前端测试

在 `apps/web/tests` 增加：

1. `null` 格不调用 `fillText`。
2. Solid 模式先绘制背景色，再绘制前景色块。
3. `countForegroundBeads()` 只统计非 `null` 格。
4. 颜色图例只包含 `foreground.palette`。
5. 导出布局按前景调色板数量计算。
6. 非法 palette 索引、错误行数和错误列数被响应校验拒绝。

## 9. 实施顺序

1. 修改 `BeadGrid`、Pydantic 模型和 API 响应结构。
2. 修改 `Seedream` Solid Prompt 和 Alpha 状态检测。
3. 增加服务端边缘连通背景抠除，再执行透明画布预处理。
4. 修改量化器输出 `foreground.rows` 和 `null` 空格。
5. 修改前端类型、统计辅助函数和 Canvas 渲染。
6. 修改页面结果区和 PNG 导出。
7. 为关键 Python/TypeScript 代码补充详细中文注释。
8. 更新测试、技术设计文档和人工验收样例。

## 10. 验收标准

- AI Solid 模式成功返回透明 Alpha 时，背景不进入 MARD 调色板。
- 纯色背景不显示色号、不计入颜色数、不计入豆数。
- 预览和导出的背景颜色仍然正确显示。
- `foreground.rows` 中只有主体拼豆索引或 `null`。
- `foreground.palette.length === stats.color_count`。
- 非空主体格数量等于 `stats.bead_count`。
- AI 返回不透明图片时先执行确定性的边缘背景抠除，不把整张白底静默当作主体。
- `keep`、`simplify` 和透明图片行为不回归。
- 关键实现位置存在准确、及时的中文注释。

## 11. 后续扩展

如果以后需要排除非纯色或局部语义背景，再新增独立的 `foreground_mask`/分割结果，不要重新把背景颜色塞回 `foreground.palette`。届时仍保持：

```text
背景/排除区域 → 渲染层或空格
主体区域 → foreground.palette + foreground.rows
```
