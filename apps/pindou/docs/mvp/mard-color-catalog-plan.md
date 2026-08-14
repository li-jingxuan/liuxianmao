# MARD 全量色卡分组展示 MVP 方案

> 状态：已实施（含套装分组）
> 方案日期：2026-08-14  
> 影响范围：`apps/api` / `apps/web`  
> 目标页面：`/colors`（PC 测试页）

## 1. 结论

新增一个公开只读接口和一个独立 PC 测试页：

- `GET /api/v1/colors`：一次返回完整 MARD 色卡，同时提供 A、B、C……ZG 系列分组和 24、48……221、264 色套装分组；
- `MardColorCatalog`：React 函数组件，可在“按色号系列”和“按颜色套装”之间切换，并筛选具体系列或套装；
- `/colors`：承载组件的独立页面，不改动现有图片转换主流程，也不在主页面增加入口。

当前源色卡共有 291 色、15 个系列，并声明 11 个可用于转换的套装档位：24、48、72、96、120、144、168、192、216、221、264。页面支持两套独立分组语义：

- 色号系列：每个颜色只属于一个 A、B……ZG 系列；
- 颜色套装：每组直接对应源色卡 `sets[]`，累计商家套装之间允许重复包含同一颜色；221 色标准套装是独立体系，不能假设它是 264 色套装的严格子集。

系列数量如下：

| 系列 | 数量 | 系列 | 数量 | 系列 | 数量 |
| --- | ---: | --- | ---: | --- | ---: |
| A | 26 | B | 32 | C | 29 |
| D | 26 | E | 24 | F | 25 |
| G | 21 | H | 23 | M | 15 |
| P | 23 | Q | 5 | R | 28 |
| T | 1 | Y | 5 | ZG | 8 |

MVP 只请求一次目录数据，系列/套装切换和具体分组筛选都在浏览器内完成。这个体量不需要分页，也不需要切换时重复请求 API。

## 2. 背景与现状

项目当前有两份相关能力：

- `docs/MARD_色卡.json` 是运行时唯一色卡源，包含每个颜色的 `code`、`series`、`hex`、`rgb`、`lab`、所属套装等信息；
- `GET /api/v1/color-sets` 只返回可用于图片转换的套装档位，不返回套装成员或全量颜色。

后端 `MardColor` 内存模型目前保留了 `code`、`hex`、`rgb`、`lab`，但解析时丢弃了源数据中的 `series`。如果前端直接用 `code` 的字母前缀推断系列，会把色卡领域规则复制到客户端，也容易在 ZG 这类双字母系列上出现错误。因此系列信息应由后端色卡模型显式承载，再通过 API 输出。

## 3. 目标与非目标

### 3.1 目标

- 展示源色卡中的全部 291 个颜色，不受当前转换套装大小影响。
- 默认按系列分区展示，并允许切换为套装分区展示。
- 系列视图可筛选单个系列；套装视图可筛选 24、48……221、264 中的单个套装。
- 每个颜色至少展示真实色块、MARD 色号和 HEX 值。
- 系列顺序、颜色顺序和数量均来自后端色卡，不在前端硬编码。
- 页面刷新、接口失败和空数据都有明确状态。
- 支持 PC 端鼠标和键盘操作，满足基础可访问性。
- 保持现有 `/color-sets` 和 `/conversions` 契约不变。

### 3.2 非目标

- 不做移动端专项布局和验收。
- 不做色号搜索、模糊搜索、排序切换或多选筛选。
- 不做点击复制、收藏、库存、价格或跳转购买。
- 不做“同时属于多个套装”等交叉条件或集合差异筛选。
- 不把色卡改成数据库表，也不增加后台编辑能力。
- 不提供分页、服务端 `series` 查询参数或虚拟列表。
- 不将测试页嵌入现有转换器，也不改变转换器的颜色套装下拉框。

## 4. 数据与领域模型

### 4.1 扩展色卡内存模型

在 `apps/api/src/pindou/color/chart.py` 中扩展 `MardColor`：

```python
@dataclass(frozen=True, slots=True)
class MardColor:
    code: str
    series: str
    hex: str
    rgb: tuple[int, int, int]
    lab: LabColor
```

同时为 `MardColorChart` 增加保留源文件顺序的颜色序列：

```python
@dataclass(frozen=True, slots=True)
class MardColorChart:
    schema_version: str
    colors: tuple[MardColor, ...]
    colors_by_code: dict[str, MardColor]
    sets_by_size: dict[int, MardColorSet]
```

`colors_by_code` 继续服务套装解析与量化；新增 `colors` 服务需要稳定顺序的目录接口。不要依赖字典插入顺序作为公开契约。

加载时增加以下校验：

- `series` 去除首尾空白后不能为空；
- `code` 必须以 `series` 开头，剩余部分为正整数，例如 `A1`、`ZG8`；
- 同一色号仍只能出现一次；
- `colors` 中的顺序原样保留，不做字符串字典序排序，避免出现 `A1、A10、A11、A2`。

系列列表按它们第一次出现在源色卡中的顺序生成。颜色仍按源文件顺序展示，由色卡维护者控制标准系列和扩展系列的排列。

### 4.2 分组逻辑

分组是一个无副作用的纯函数，可以放在新路由模块内，或作为 `MardColorChart` 的只读方法：

```python
def group_colors_by_series(
    colors: tuple[MardColor, ...],
) -> tuple[tuple[str, tuple[MardColor, ...]], ...]: ...
```

实现按一次线性遍历完成，时间复杂度 `O(n)`。不读取原始 JSON、不自行切割色号，也不复制颜色对象。

## 5. API 设计

### 5.1 路由

新增：

```http
GET /api/v1/colors
```

路由使用独立文件 `apps/api/src/pindou/api/routes/colors.py`：

```python
router = APIRouter(prefix="/colors", tags=["colors"])

@router.get("")
def list_colors(chart: ColorChartDep) -> ColorCatalogResponse: ...
```

这是只访问进程内不可变色卡的同步操作，使用普通 `def` 即可。通过返回类型声明公开响应模型，由 FastAPI/Pydantic 完成校验、OpenAPI 描述和字段过滤。

接口与 `/color-sets` 一样公开，不要求 `X-API-Key`。API Key 次数仅用于高成本的图片转换，读取静态色卡不应扣次。

### 5.2 响应契约

新建 `apps/api/src/pindou/schemas/color_catalog.py`，避免继续把无关目录契约放入 `conversion.py`。

```python
class CatalogColor(BaseModel):
    code: str = Field(min_length=1)
    hex: str = Field(pattern=r"^#[0-9A-F]{6}$")
    rgb: tuple[int, int, int]


class ColorSeriesGroup(BaseModel):
    series: str = Field(min_length=1)
    label: str = Field(min_length=1)
    color_count: int = Field(ge=1)
    colors: list[CatalogColor]


class ColorSetGroup(BaseModel):
    size: int = Field(ge=1)
    label: str = Field(min_length=1)
    color_count: int = Field(ge=1)
    colors: list[CatalogColor]


class ColorCatalogResponse(BaseModel):
    brand: Literal["MARD"] = "MARD"
    schema_version: str
    total_count: int = Field(ge=1)
    groups: list[ColorSeriesGroup]
    sets: list[ColorSetGroup]
```

示例响应：

```json
{
  "brand": "MARD",
  "schema_version": "1.0",
  "total_count": 291,
  "groups": [
    {
      "series": "A",
      "label": "A 系列",
      "color_count": 26,
      "colors": [
        { "code": "A1", "hex": "#F9F0CD", "rgb": [249, 240, 205] },
        { "code": "A2", "hex": "#FBFBD4", "rgb": [251, 251, 212] }
      ]
    }
  ],
  "sets": [
    {
      "size": 24,
      "label": "MARD 24色套装",
      "color_count": 24,
      "colors": [
        { "code": "A4", "hex": "#FFE953", "rgb": [255, 233, 83] }
      ]
    }
  ]
}
```

响应只包含展示需要的字段。`lab`、套装成员关系和商家盒号不输出，既减小体积，也避免前端依赖量化内部数据。

必须满足以下不变量：

```text
total_count == sum(group.color_count for group in groups)
group.color_count == len(group.colors)
group.series 唯一
系列分组内所有 color.code 全局唯一
set.color_count == set.size == len(set.colors)
sets[].size 与色卡 set_sizes 一致并升序返回
```

套装分组不满足跨组全局唯一：例如 24 色套装的成员也会出现在 48、72 等累计套装中，这是源色卡的正确业务语义。接口不从全量颜色重新推导套装，而是只消费 `MardColorChart.sets_by_size` 中已经通过引用、数量与唯一性校验的成员。

### 5.3 为什么 MVP 不做服务端筛选

291 条颜色属于小型静态数据，一次响应即可完成：

- 切换系列没有额外网络等待或 Loading 闪烁；
- “全部”与单系列使用同一份数据，不会发生两个接口结果不一致；
- 接口更容易缓存，前端状态和错误处理也更简单；
- 服务端不需要新增非法系列的 `400/404` 语义。

如果未来色卡扩展到数千条，或其他调用方只需要单个系列，再单独增加 `?series=` 与分页，不预先增加当前用不到的契约。

## 6. 前端组件与页面

### 6.1 文件结构

```text
apps/web/src/
├── app/colors/page.tsx
├── components/mard-color-catalog.tsx
├── components/mard-color-catalog.module.scss
├── lib/api.ts
└── lib/types.ts
```

- `page.tsx` 是轻量服务端页面，只渲染 `<MardColorCatalog />`；
- `MardColorCatalog` 是带 `"use client"` 的函数组件；
- 新类型 `ColorCatalogResponse` 与 API 契约保持一致；
- `getColorCatalog(signal?)` 复用现有 `parseResponse` 错误解析。

不引入 antd 或其他 UI 库，继续使用项目现有 React Hooks、TypeScript 和 CSS Modules。

### 6.2 状态与数据流

组件只维护必要状态：

```ts
type SeriesFilter = "all" | string;

const [catalog, setCatalog] = useState<ColorCatalogResponse | null>(null);
const [selectedSeries, setSelectedSeries] = useState<SeriesFilter>("all");
const [error, setError] = useState<string | null>(null);
```

首次挂载调用 `getColorCatalog()`，卸载时通过 `AbortController` 取消请求。可见分组用纯函数或 `useMemo` 派生，不复制一份可见颜色到 state：

```ts
const visibleGroups = useMemo(
  () =>
    selectedSeries === "all"
      ? catalog?.groups ?? []
      : (catalog?.groups.filter(({ series }) => series === selectedSeries) ?? []),
  [catalog, selectedSeries],
);
```

筛选项完全从 `catalog.groups` 生成；前端不得硬编码 A、B、ZG 等列表和数量。

### 6.3 PC 布局

页面建议使用 `max-width: 1440px` 的居中容器，主要结构如下：

```text
MARD 全量色卡                                      共 291 色

[全部 291] [A 26] [B 32] [C 29] ... [ZG 8]

A 系列 · 26 色
┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ...
│  色块  │ │  色块  │ │  色块  │ │  色块  │
│ A1     │ │ A2     │ │ A3     │ │ A4     │
│#F9F0CD │ │#FBFBD4 │ │#FAFC9F │ │#FFE953 │
└────────┘ └────────┘ └────────┘ └────────┘
```

布局约定：

- 筛选器放在页面标题下方，允许在较窄 PC 窗口内自然换行；
- 筛选按钮显示系列名和数量，选中态同时使用背景、边框和文字变化；
- “全部”模式逐组输出 `<section>`，每组都有标题和数量；
- 卡片区域使用 `grid-template-columns: repeat(auto-fill, minmax(132px, 1fr))`；
- 色块保持足够面积，浅色卡片增加中性边框，不能仅靠阴影区分白色与页面背景；
- 色号是主信息，HEX 是次信息；文字放在独立白色信息区，不直接压在色块上，避免计算对比色；
- 页面最小按 `1024px` 视口验收，重点检查 `1280px` 和 `1440px`。

筛选按钮使用原生 `<button type="button" aria-pressed={active}>`；颜色列表使用 `<ul>/<li>` 或语义等价结构。颜色卡目前没有点击行为，不要伪装成按钮。

### 6.4 页面状态

- Loading：显示“正在加载 MARD 色卡…”和固定高度骨架，避免页面突然跳动；
- Error：使用 `role="alert"` 展示“色卡加载失败，请确认后端服务已启动”，并提供“重新加载”按钮；
- Empty：若接口意外返回空分组，显示“暂无颜色数据”，不渲染空白页面；
- Success：标题处显示接口返回的 `total_count`，不能硬编码 291。

## 7. 测试方案

### 7.1 后端

扩展 `apps/api/tests/test_color_chart.py`：

- 解析后共有 291 个颜色，`colors` 与 `colors_by_code` 数量一致；
- `A1.series == "A"`、`ZG8.series == "ZG"`；
- 缺失系列、系列与色号不匹配、重复色号都拒绝启动；
- 源文件颜色顺序被保留。

在 `apps/api/tests/test_api.py` 增加：

- `/api/v1/colors` 返回 `200`、`brand=MARD`、`schema_version=1.0`；
- `total_count == 291`，系列顺序为 `A/B/C/D/E/F/G/H/M/P/Q/R/T/Y/ZG`；
- 各系列数量与本方案第 1 节表格一致；
- 汇总数量等于所有颜色数量之和，色号全局唯一；
- `A1` 的 HEX/RGB 与源色卡一致；
- 响应不包含 `lab`、`sets`、`merchant_box` 等非展示字段；
- 不带 API Key 也可读取，且不会产生 API Key 用量记录。

### 7.2 前端

扩展 `apps/web/tests/api.test.ts`：

- `getColorCatalog` 请求 `/api/v1/colors`；
- 正确透传 `AbortSignal`；
- 非 2xx 响应沿用 `PindouApiError`。

新增 `apps/web/tests/mard-color-catalog.test.tsx`：

- Loading 后渲染“全部”和接口返回的所有系列按钮；
- 默认按分组显示全部颜色；
- 点击 `ZG` 后只显示 ZG 组的颜色，按钮具有 `aria-pressed="true"`；
- 再点击“全部”恢复全部分组；
- 颜色卡显示色号和 HEX，色块的背景色来自对应 HEX；
- 请求失败时显示错误与重试按钮，重试会再次请求；
- 组件卸载会取消尚未完成的请求。

样式不做脆弱的像素快照；用一次人工验收确认 1024/1280/1440 三种 PC 宽度下没有遮挡、截断和横向滚动。

## 8. 实施顺序

1. 扩展 `MardColor` / `MardColorChart`，补齐系列解析、顺序和损坏数据测试。
2. 新增色卡目录 Pydantic schemas、`colors` 路由并在 `main.py` 注册。
3. 完成 API 契约测试，先锁定 291 色和 15 组不变量。
4. 在 Web 端增加类型和 `getColorCatalog`。
5. 实现 `MardColorCatalog`、CSS Module 和 `/colors` 页面。
6. 补齐组件交互、错误重试与请求取消测试。
7. 运行后端测试、Web 测试、lint 和 build，再进行三档 PC 视口人工验收。

## 9. 验收标准

- 访问 `/colors` 能看到 291 个 MARD 颜色，并默认按 15 个系列分区。
- 筛选栏包含“全部”及所有后端返回的系列，数量准确。
- 选择任一系列后只显示该系列，再选择“全部”能恢复完整内容。
- 色号、HEX 和色块颜色与 `docs/MARD_色卡.json` 一致。
- 前端没有硬编码系列列表、系列数量或总色数。
- 新接口不要求 API Key，不影响现有转换次数。
- `/api/v1/color-sets`、`/api/v1/conversions` 和现有转换页面行为不变。
- 后端测试、前端测试、lint 与 production build 全部通过。

## 10. 风险与处理

| 风险 | 处理方式 |
| --- | --- |
| 把“系列”和“套装档位”混为一谈 | 使用独立 `/colors` 契约，字段明确命名为 `series`，不复用 `/color-sets` |
| 前端从色号猜系列，ZG 等双字母系列出错 | 后端解析并输出源数据的 `series` |
| 字符串排序导致 A10 排在 A2 前 | 保留并使用色卡源文件顺序 |
| 浅色颜色块与卡片背景无法区分 | 所有色块使用固定中性边框 |
| 测试页影响主转换流程 | 使用独立 `/colors` 路由，不修改 `PindouConverter` 状态与交互 |
| 未来色卡数据变化导致前端失配 | 总数、系列、数量和顺序均由 API 返回，测试校验契约不变量 |
