# MVP v2 技术实现方案：多行谱面与最小输入闭环

## 1. 目标与现状

当前 `packages/lxm-editor` 能把首条轨道的所有小节横向排列为 `ILXMLayout.measures`。单小节已经产出弦线、节奏列、beat slot、品位数字、小节线、符干、连梁和附点。

MVP v2 将此能力扩展为以下闭环：

```text
ILXMDocument
  → buildLayout(options)
  → systems / measures / hit index
  → SVG 渲染与点击
  → ActiveCursor
  → ScoreCommand
  → 新 ILXMDocument
  → 重新 layout
```

范围严格限定为多行排版、单点命中、单音输入/覆盖/删除。所有新逻辑保持纯函数，不依赖 React、DOM 或 Zustand。

## 2. 模块职责

```text
packages/lxm-editor/src/
  core/
    commands.ts             # 新增：纯领域命令与结果类型
  layout/
    measure-layout.ts       # 保持：只计算单小节内部几何
    system-layout.ts        # 新增：把小节装入一条谱面行
    score-layout.ts         # 新增：遍历轨道、自动断行、汇总整谱
    hit-test.ts             # 新增：从布局坐标解析编辑目标
    layout-types.ts         # 扩展：system、hit index 与 options
    layout-constants.ts     # 扩展：system 宽度、行距与命中尺寸
    index.ts                # 保留为 buildLayout 的公开门面

apps/website/components/EditorShell/
  index.tsx                 # 消费 systems；维护临时光标与输入草稿
```

边界：

- `measure-layout.ts` 不知道换行、总画布宽高或 React 事件。
- `system-layout.ts` 不修改小节内部几何，只决定小节属于哪一行和其局部 X/Y。
- `score-layout.ts` 是唯一系统断行编排器。
- `hit-test.ts` 只消费 layout；页面不得自行从 SVG 元素、数组下标或像素常量反查业务对象。
- `commands.ts` 只消费并返回文档数据；不产生布局坐标、React state 或副作用。
- `EditorShell` 只将指针坐标转换为 SVG 局部坐标、调用公开 API，并渲染结果。

## 3. 布局数据契约

### 3.1 布局选项

扩展 `ILXMLayoutOptions`：

```ts
interface ILXMLayoutOptions {
  x?: number;
  y?: number;
  measureGap?: number;
  systemWidth?: number;
  systemGapY?: number;
}
```

- `systemWidth` 是单条谱面行的逻辑最大宽度；未传入时使用明确常量 `LXM_SYSTEM_DEFAULT_WIDTH`。
- `x`、`y` 为整谱起点；`systemWidth` 不包含 `x`。
- `measureGap` 只在同一 system 的相邻小节之间生效。
- `systemGapY` 是前一行边界到后一行边界之间的垂直间隙。

首版不从浏览器容器测量宽度。页面可以在以后把容器宽度作为显式 `systemWidth` 传入，但不能让 layout 隐式读取 `window`。

### 3.2 System 类型

```ts
interface ILXMSystemLayout {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  measures: ILXMMeasureLayout[];
}

interface ILXMLayout {
  trackId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  systems: ILXMSystemLayout[];
  hitIndex: ILXMHitIndex;
}
```

`ILXMLayout.measures` 在 v2 移除，避免同时维护扁平和分组两个权威来源。需要遍历所有小节的调用方使用 `layout.systems.flatMap(system => system.measures)`。

小节类型新增 `systemIndex`，便于渲染 key、命中返回与调试：

```ts
interface ILXMMeasureLayout {
  id: string;
  index: number;
  systemIndex: number;
  // 其余字段保持现有定义
}
```

### 3.3 断行算法

断行采用顺序贪心算法；它稳定、易测且适合 MVP。

1. 先以 `x = 0, y = 0` 调用 `layoutMeasure`，获得每个小节不依赖 system 的内在 `width` 与 `height`。
2. 顺序遍历小节。在当前行已有小节时，候选宽度为 `currentWidth + measureGap + measure.width`；空行候选宽度为 `measure.width`。
3. 如果当前行非空且候选宽度大于 `systemWidth`，先提交当前行，再将该小节放入新行。
4. 单小节宽度大于 `systemWidth` 时不压缩，作为一条独占行保留其真实宽度。
5. 提交一行时，按该行顺序重新调用 `layoutMeasure`，传入最终 `x` 与 `y`。行宽为最后一个小节右边界减行起点；行高为最大小节高度。
6. 下一行 `y = previous.y + previous.height + systemGapY`。整谱宽度为所有行宽的最大值；高度为最后一行底部减起点。

重要约束：不得复用第一次预计算时带有错误坐标的内部布局结果。最终小节必须以它所在 system 的真实 X/Y 调用 `layoutMeasure`，确保音符、弦线、符干与小节线全部同步移动。

## 4. 命中与编辑光标

### 4.1 命中索引与结果

命中索引由 layout 生成；首版无需 R-tree 等复杂结构，按小节和 beat slot 顺序查询即可。

```ts
interface ILXMHitTarget {
  trackId: string;
  systemIndex: number;
  measureId: string;
  beatId: string;
  string: number;
}

interface ILXMHitIndex {
  measureBounds: ILXMMeasureHitBounds[];
}

type HitTestResult = ILXMHitTarget | null;

function hitTestLayout(
  layout: ILXMLayout,
  point: { x: number; y: number },
): HitTestResult;
```

小节命中边界为其 `x/y/width/height`。beat 的水平命中范围使用 `ILXMBeatLayout.x` 和 `width`；弦命中范围使用相邻弦中点分割，首末弦向外扩展固定命中半径。

### 4.2 光标状态

网站侧使用 React state 保存：

```ts
interface ActiveCursor extends ILXMHitTarget {}
```

它不是 `ILXMDocument` 的字段。重排后用 `measureId + beatId + string` 重新确认仍可命中；目标不存在时清空光标。

`EditorShell` 需要绘制：

- 当前 beat 的半透明列高亮。
- 当前弦与 beat 交点的明确光标。
- 错误文本的无障碍可读区域。

这些视觉元素由 `ActiveCursor` 与新 layout 生成，不能写入谱面数据。

## 5. 领域命令

### 5.1 API

新增 `applyScoreCommand(document, command)`，以判别联合返回结果：

```ts
type ILXMScoreCommand =
  | {
      type: "note.set";
      trackId: string;
      measureId: string;
      beatId: string;
      string: number;
      fret: number;
    }
  | {
      type: "note.remove";
      trackId: string;
      measureId: string;
      beatId: string;
      string: number;
    };

type ApplyScoreCommandResult =
  | { ok: true; document: ILXMDocument }
  | { ok: false; code: ScoreCommandErrorCode; message: string };
```

v2 只接受数值品位 `0–24`。闷音 `x` 需要扩展当前 `ILXMNote.fret: number` 的 schema，因此不应在 v2 偷渡实现；将其留到模型版本明确变更时处理。

### 5.2 不可变更新与校验

命令按 `trackId → measureId → beatId` 精确查找目标。任一目标不存在均失败。成功时：

- 创建新的 `document`、`score`、目标 `track`、目标 `measure`、目标 `beat` 和 `notes` 数组；未修改分支保持引用不变。
- `note.set` 用同弦音符替换或追加一个新音符。新 ID 由集中式 `createNoteId` 工厂产生，不能由 UI 拼接。
- `note.remove` 仅移除同弦音符；目标弦没有音符时作为无变化成功或明确失败，需在测试中固定一种语义。推荐“无变化成功”，使 Delete 可重复触发。
- 每次成功命令将 `documentRevision` 加一。
- 命令结果在返回前通过 `LXMDocumentSchema` 校验。业务规则扩展后，命令还需调用统一语义校验器。

## 6. 页面集成

`EditorShell` 在本版本接收或维护一份 `ILXMDocument` 状态；初始值仍可从现有 `EXAMPLE` 加载。

流程如下：

1. `useMemo` 对当前 document 和固定布局 options 调用 `buildLayout`。
2. SVG `onPointerDown` 读取 SVG 的 `getScreenCTM().inverse()`，将 client point 转为逻辑 SVG 坐标；禁止直接使用 `offsetX/offsetY`，因为它会受缩放影响。
3. 调用 `hitTestLayout` 并更新 `ActiveCursor`。
4. 监听键盘；数字输入进入短暂品位草稿。草稿在确认单数字、确认两位数字、失焦或超时后才调用 `note.set`。
5. Backspace/Delete 对当前光标调用 `note.remove`。
6. 命令成功时替换 document，失败时更新错误状态，保留原 document 与 cursor。

键盘事件只在编辑器容器获得焦点时处理，且输入框/文本域获得焦点时必须跳过，避免干扰未来工具栏控件。

## 7. 测试策略

### 7.1 MVP v2 规范测试数据

新增 `packages/lxm-editor/example/example-mvp2.json.ts`，作为 MVP v2 的唯一规范谱例。它是强类型的 `ILXMDocument` 默认导出，同时由 `packages/lxm-editor/example/index.ts` 以 `EXAMPLE_MVP_2` 命名空间导出。

该文件只保存静态、可读且可复现的 LXM 数据；不在 fixture 内生成随机 ID、调用 layout 或包含 React 逻辑。测试如需独立修改副本，应在测试中深拷贝该 fixture，不能直接修改模块导入值。

谱例固定为一条标准调弦吉他轨道和 8 个连续的 `4/4` 小节。每小节使用四个四分音符 beat，tick 分别为 `0`、`960`、`1920`、`2880`，确保数据可以直接用于命中和单音命令测试。8 小节至少覆盖：

| 小节 | 数据重点           | v2 覆盖目的                                 |
| ---- | ------------------ | ------------------------------------------- |
| 1    | 单音与开放弦       | 首行首小节、品位 `0` 与普通输入。           |
| 2    | 同拍双弦和弦       | 同 beat 多弦保留与单弦覆盖。                |
| 3    | 高品位 `12`、`24`  | 两位品位草稿与最大品位边界。                |
| 4    | 稀疏音符           | 删除后无音 beat 与命中不受 notes 数量影响。 |
| 5    | 低音弦（5、6 弦）  | 第一条 system 之外的弦命中。                |
| 6    | 高音弦（1、2 弦）  | 弦命中边界。                                |
| 7    | 普通单音序列       | 第二条 system 的中间小节。                  |
| 8    | 终止小节线 `final` | 最后一行、最后小节和小节线回归。            |

该 fixture 不包含休止、附点、连音、技巧、歌词或和弦图；它们不属于 v2。小节数量和固定节奏足以在测试中通过较小的 `systemWidth` 断为多行，也可以通过较大的 `systemWidth` 验证单行行为。

### 核心单元测试

- `system-layout.test.ts`：断行边界、精确填满、超宽小节、空小节列表、不同高度与总尺寸。
- `score-layout.test.ts`：多行 Y 坐标、system index、扁平小节顺序与默认 options。
- `hit-test.test.ts`：每根弦、每个 beat slot、边界点、行间空白、行外点击与多 system。
- `commands.test.ts`：新增、覆盖、删除、无音删除、非法 target、非法弦/品位、不可变性和 revision 增量。

上述测试默认优先使用 `EXAMPLE_MVP_2.default`；仅针对极端断行边界的用例才在测试内构造最小 measure。

### 页面验收

- 固定逻辑 `systemWidth` 下，至少 8 个小节断为两行或以上。
- 点击每条谱面行的首尾小节可输入和删除音符。
- 输入后自动重排时，光标仍指向相同的业务目标。
- 浏览器控制台无 error；根页面无非预期页面滚动。

## 8. 非目标与后续接口

v2 不引入 Zustand、zundo、剪贴板、节奏格物化、休止符或复杂技巧关系。接口设计只为它们留出可扩展空间：layout 的 system 分组、稳定 `beatId` 命中与纯命令返回值均可被后续版本复用。
