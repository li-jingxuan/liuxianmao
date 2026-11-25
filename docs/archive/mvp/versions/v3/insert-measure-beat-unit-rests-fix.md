# MVP v3 Fix：新增小节按拍号生成单位拍休止符

## 1. 问题说明

当前 `measure.insert` 会继承相邻小节的拍号，再把整小节容量交给
`createRestBeats(startTick, ticks, createBeatId)`：

```ts
const rests = createRestBeats(
  0,
  getMeasureCapacityTicks(source.timeSignature),
  factory.createBeatId,
);
```

`createRestBeats` 内部复用 `createRestRhythmsForTicks`。后者的职责是把任意一段静音
时长以尽可能少的 beat 表达，因此采用从长到短的贪心分解。一个 `4/4` 小节容量为
`3840 tick`，会优先得到一个 `whole` 休止 beat；`3/4` 则会得到一个 `half` 和一个
`quarter` 休止 beat。

这个结果满足时间轴容量校验，但不符合新增空白小节的编辑预期：用户希望新小节先按
拍号建立清晰的单位拍网格，例如 `4/4` 默认有 4 个四分休止符，`3/4` 默认有 3 个
四分休止符。

不能直接修改通用贪心算法。节奏修改会使用同一个入口补齐小节尾部的任意静音时长，
这类场景仍需要紧凑、精确的时值分解。新增小节的初始化策略应成为独立领域能力。

## 2. 修复目标

新增空白小节时，若拍号分母能由当前基础时值直接表达，则按“分子决定数量、分母决定
每个休止符时值”的规则初始化：

| 拍号   | 默认休止 beat                                          |
| ------ | ------------------------------------------------------ |
| `4/4`  | 4 个 `quarter`，起始 tick 为 `0/960/1920/2880`         |
| `3/4`  | 3 个 `quarter`，起始 tick 为 `0/960/1920`              |
| `2/2`  | 2 个 `half`，起始 tick 为 `0/1920`                     |
| `6/8`  | 6 个 `eighth`，起始 tick 为 `0/480/960/1440/1920/2400` |
| `5/16` | 5 个 `sixteenth`，每个相隔 `240 tick`                  |

生成结果必须继续满足以下不变量：

- 新增小节继承现有命令确定的相邻小节拍号。
- 每个 beat 的 `kind` 为 `rest`，`dots` 为 `0`，`notes` 为空数组。
- beat tick 从 `0` 开始、连续、不重叠，并完整覆盖小节容量。
- 每个 beat 使用文档 ID factory 生成唯一 ID。
- 新小节仍使用 `barline: "single"` 和空 `chordSymbols`。
- 页面层不推导默认 beat，初始化逻辑只存在于核心领域层。
- 复制小节、删除小节和既有节奏修改行为不变。

## 3. 方案边界

### 3.1 新增专用的小节初始化函数

在 `packages/lxm-editor/src/core/rest-beats.ts` 中新增：

```ts
export const createMeasureRestBeats = (
  timeSignature: ILXMTimeSignature,
  createBeatId: () => string,
): ILXMBeat[] | null => {
  // 具体实现见第 4 节
};
```

函数接收完整拍号而不是已经合并后的总 tick。只有保留 `numerator` 和 `denominator`，
才能区分 `3/4` 与其他同容量拍号，并表达“每一拍一个休止符”的初始化语义。

函数保持纯数据构造：除调用注入的 `createBeatId` 外不读取或修改外部状态。

### 3.2 保留通用静音分解函数

以下现有接口及语义保持不变：

```ts
createRestRhythmsForTicks(ticks);
createRestBeats(startTick, ticks, createBeatId);
```

它们继续使用从长到短的贪心策略，服务于：

- beat 时值缩短后补齐尾部容量；
- beat 时值增长后重建剩余尾部休止；
- 其他只知道静音 tick、并不知道拍号分组语义的调用方。

这样可以避免一次新增小节的交互调整，意外改变既有节奏编辑结果。

### 3.3 不修改持久化模型与页面接口

本 fix 不新增文档字段，不修改 `ILXMMeasure`、`ILXMBeat`、Zod schema 或命令 payload。
`EditorShell` 仍只发送：

```ts
{
  type: LXMScoreCommandEnum.InsertMeasure,
  trackId,
  afterMeasureId,
}
```

拍号继承、休止 beat 构造和最终语义校验继续由 `applyScoreCommand` 完成。

## 4. 核心算法

### 4.1 从拍号分母解析单位拍时值

不要在多个文件维护一份手写的 `denominator -> rhythm.base` 映射。使用现有
`BASE_RHYTHM_TICKS` 作为唯一时值来源：

```ts
const unitTicks = (TICKS_PER_QUARTER * 4) / timeSignature.denominator;
const unitBase = Object.entries(BASE_RHYTHM_TICKS).find(
  ([, ticks]) => ticks === unitTicks,
)?.[0] as ILXMRhythm["base"] | undefined;
```

当前可以直接表达的分母为：

| 分母 | `rhythm.base`  | 单位拍 tick |
| ---- | -------------- | ----------- |
| `1`  | `whole`        | `3840`      |
| `2`  | `half`         | `1920`      |
| `4`  | `quarter`      | `960`       |
| `8`  | `eighth`       | `480`       |
| `16` | `sixteenth`    | `240`       |
| `32` | `thirtySecond` | `120`       |

通过 tick 反查可以复用现有时值定义；未来新增 `sixtyFourth` 时，不需要再修改一份拍号
映射表。

### 4.2 生成单位拍休止 beat

解析到 `unitBase` 后，先完成所有输入规划，再消费 ID：

```ts
const rhythms = Array.from(
  { length: timeSignature.numerator },
  () => ({ base: unitBase, dots: 0 }) as const,
);

return rhythms.map((rhythm, index) => ({
  id: createBeatId(),
  tick: index * unitTicks,
  rhythm,
  kind: "rest",
  notes: [],
}));
```

实现必须先验证：

- `numerator`、`denominator` 为正整数；
- `unitTicks` 为正整数；
- `unitTicks` 能匹配当前支持的基础时值；
- `numerator * unitTicks === getMeasureCapacityTicks(timeSignature)`。

校验失败时不能调用 `createBeatId`，避免失败规划无意义地推进 ID factory。

### 4.3 非标准分母的兼容策略

当前 schema 允许 `1...64` 的任意整数分母，但节奏模型只支持到三十二分音符，且没有
三分、五分等基础时值。这个 schema 范围超出了本 fix 的目标。

为了避免让原本可通过“整段静音贪心分解”插入成功的非标准拍号发生回归，采用以下
兼容策略：

1. 单位拍能由现有基础时值直接表达时，严格生成 `numerator` 个单位拍休止符。
2. 单位拍不能直接表达时，回退到现有
   `createRestBeats(0, getMeasureCapacityTicks(timeSignature), createBeatId)`。
3. 如果整小节容量也无法精确表达，继续返回 `null`，由命令层返回现有
   `RHYTHM_NOT_REPRESENTABLE`。

例如 `3/3` 的单位拍不能由当前基础时值表达，但总容量为 `3840 tick`；本 fix 保留其
现有的一个 `whole` 休止 beat 结果，而不是突然禁止新增小节。是否收紧拍号 schema 或
增加连音时值属于后续独立设计，不在本次修复中处理。

回退行为只用于兼容非标准分母，常规 `n/1`、`n/2`、`n/4`、`n/8`、`n/16`、
`n/32` 必须始终走单位拍初始化路径。

## 5. 命令层调整

在 `packages/lxm-editor/src/core/commands.ts` 的 `measure.insert` 分支，将：

```ts
const rests = createRestBeats(
  0,
  getMeasureCapacityTicks(source.timeSignature),
  factory.createBeatId,
);
```

替换为：

```ts
const rests = createMeasureRestBeats(
  source.timeSignature,
  factory.createBeatId,
);
```

其余流程不变：

```text
定位目标 track 与插入位置
  -> 选择用于继承拍号的 source measure
  -> 创建文档级 ID factory
  -> 按 source.timeSignature 创建默认休止 beats
  -> 创建 measure
  -> 插入 measures 数组
  -> schema + semantic validation
```

首位插入仍使用后一小节的拍号；在指定小节后插入仍使用该小节的拍号。这个 fix 不改变
现有 `sourceIndex` 规则。

## 6. 测试方案

### 6.1 `rest-beats` 单元测试

新增 `packages/lxm-editor/tests/core/rest-beats.test.ts`，直接测试小节初始化能力：

1. `4/4` 返回 4 个 `quarter` rest，tick 为 `0/960/1920/2880`。
2. `3/4` 返回 3 个 `quarter` rest，tick 为 `0/960/1920`。
3. `6/8` 返回 6 个 `eighth` rest，tick 间隔为 `480`。
4. `2/2` 返回 2 个 `half` rest，tick 间隔为 `1920`。
5. 所有 beat 均为 `kind: "rest"`、`dots: 0`、`notes: []`，ID 按 factory 顺序生成。
6. 非标准但总容量可表达的拍号走既有贪心回退。
7. 无法表达的容量返回 `null`，且 factory 调用次数为 `0`。

同时保留或补充 `createRestBeats` 的测试，证明通用静音分解仍保持最长时值优先，避免
新增小节策略污染节奏修改路径。

### 6.2 命令集成测试

扩展 `packages/lxm-editor/tests/core/commands.test.ts`：

- 在 `4/4` 小节后执行 `measure.insert`，断言新小节有 4 个四分休止 beat。
- 构造 `3/4` source measure 后插入，断言拍号继承且产生 3 个四分休止 beat。
- 不传 `afterMeasureId` 时，在首位插入并继承原首小节拍号。
- 新小节的 measure/beat ID 与原文档所有实体 ID 不重复。
- 插入后的文档通过 schema 与 semantic validation，revision 只增加 `1`。
- 原 document 未被修改，非目标 track 和既有 measure 引用保持不变。

现有复制、删除、时值伸缩测试继续通过，作为影响范围守卫。

### 6.3 布局回归

无需修改 layout 实现。命令测试可保留一次 `buildLayout` 烟雾验证，确认多 beat 的空白
小节可以正常生成 beat slots、休止符标记和命中区域。

浏览器验收重点：

- 新增 `4/4` 小节后可见 4 个四分休止符。
- 新增 `3/4` 小节后可见 3 个四分休止符。
- 每个休止符都能成为后续输入、切换休止状态和修改时值的独立拍点。
- 新增后光标恢复、自动换行和工具栏状态保持现有行为。

## 7. 不采用的方案

### 7.1 修改全局贪心分解顺序

如果让 `createRestRhythmsForTicks` 优先选择四分音符，所有尾部补齐都会被拆成更多 beat，
并改变节奏修改后的文档结构。该函数只有静音长度，没有拍号上下文，也无法判断调用方
是否正在初始化小节，因此不能承担本需求。

### 7.2 在 `commands.ts` 内直接循环生成 beat

命令层应负责编排文档变更，不应再次实现 tick、rhythm 和休止 beat 构造。把算法放在
`rest-beats.ts` 可以独立测试，也为未来的“清空整小节”等能力提供统一入口。

### 7.3 在 React 页面新增后重写 beats

页面补默认 beat 会绕过领域命令的 ID factory、容量校验和不可变更新约束，也会让其他
命令调用方产生不同结果。页面只负责发送 `measure.insert`。

### 7.4 一律拒绝非标准分母

当前 schema 已接受更宽的分母范围。本 fix 若直接收紧，会把局部交互修复扩大为文档
兼容性变更。先保留既有贪心回退；拍号模型收紧或扩展应另立方案。

## 8. 验收标准

- `4/4` 新增小节默认包含 4 个独立的 `quarter` 休止 beat。
- `3/4` 新增小节默认包含 3 个独立的 `quarter` 休止 beat。
- `6/8`、`2/2` 等可表达拍号按分子数量和分母时值生成休止 beat。
- 新增 beat 时间轴连续并完整覆盖小节容量，文档语义校验通过。
- 新增小节仍正确继承拍号，复制和删除语义不变。
- 通用尾部休止补齐仍保持现有贪心结果。
- 非标准分母保留现有可表达性，不因本 fix 产生额外文档兼容回归。
- UI、持久化 schema 和 layout 公共接口无需调整。

## 9. 实施顺序

1. 为 `createMeasureRestBeats` 写 `4/4`、`3/4`、`6/8` 失败测试。
2. 在 `rest-beats.ts` 实现单位拍解析、beat 构造和非标准分母回退。
3. 将 `measure.insert` 切换到新入口。
4. 扩充命令层拍号继承、ID 和不可变性测试。
5. 运行 `lxm-editor` 的测试、类型检查与 lint。
6. 在网站中分别对 `4/4` 和 `3/4` 小节执行新增并完成视觉验收。
