# MVP v5.1 技术实现方案：连音组节奏

## 1. 目标与现状

MVP v5.1 在 v5 吉他技巧之后补齐 Tuplet（下文统一称“连音组”）的时间模型、编辑和记谱闭环。这里的连音组指二连音、三连音等节奏分组，不是 Tie、Slur 或击弦/勾弦弧线；它属于节奏 Module，不进入 `track.techniques[]`。

当前仓库已经具备以下基础：

- `TICKS_PER_QUARTER = 960`，可精确表示首批二至六连音；
- `ILXMBeat.rhythm` 保存书写时值，`ILXMBeat.tick` 保存小节内实际起点；
- `calculateRhythmTicks`、小节容量、尾部休止生成和 `beat.setRhythm` 已形成纯领域计算；
- `applyScoreCommand` 统一处理 schema、语义校验、revision 和撤销历史；
- layout 已有 rhythm lane、连梁、旗帜、休止符、自动断行和最终 SVG 几何；
- website 已有二至六连音工具图标，但图标存在不代表时间模型已经支持连音组。

当前缺口是：所有 Beat 的实际时长仍直接等于书写时值，连梁分组也不知道连音组范围。若只在页面画数字，会立即造成 `beat.tick`、小节容量、命令重排和持久化语义不一致。

v5.1 建立以下数据流：

```text
ILXMMeasure(tuplets + beats)
  → 小节上下文中的实际 Beat 时长
  → 连续 tick / 精确小节容量
  → rhythmic columns + beam groups + tuplet annotation
  → website 只消费 layout

用户选择同一小节的连续 Beat
  → tuplet.set / tuplet.remove
  → 连音组规划 + 尾部休止协调
  → schema + semantic validation
  → 新 ILXMDocument / no-op
  → 既有 history
```

## 2. 范围与核心决策

### 2.1 首批范围

- 支持 `2:3`、`3:2`、`4:3`、`5:4`、`5:3`、`6:4`；
- 连音组只能包含同一小节内按时间连续的 Beat；
- 成员数量必须等于 `actual`；
- 成员必须具有完全相同的 `rhythm.base` 与 `dots`，且换算后得到整数 tick；
- 成员可以是 notes、空 notes 或 rest；
- 一个 Beat 最多属于一个连音组，连音组不能重叠或嵌套；
- 支持新增、修改比例、删除、保存、加载、撤销、重做和小节复制；
- layout 输出数字以及按需显示的 bracket，并与连梁、旗帜、附点和页面裁切保持净空。

### 2.2 明确不做

- 跨 measure、跨 system 连音组；
- 嵌套连音组、重叠连音组和多层数字；
- 同一 group 内混合基础时值或不同附点数，以及用户自定义比例；
- 自动猜测任意五连音、六连音的 `normal`；
- 连音组播放、MIDI 导出和速度伸缩；
- 通过拖拽 bracket 改变范围；
- 把连音组保存到每个 Beat，或混入 v5 的技巧实体。

### 2.3 领域真相

1. `beat.rhythm` 始终是用户看到的书写时值，不因加入连音组而改写。
2. `measure.tuplets[]` 是比例与成员关系的唯一持久化来源。
3. `beat.tick` 是根据书写时值和所属连音组重算得到的实际起点。
4. 实际时长只能通过核心节奏 Module 计算；命令、校验和 layout 不得各自实现比例公式。
5. 连音组禁止跨 measure，因此自动换行只改变视觉位置，不需要拆分领域实体。

## 3. 文档模型

### 3.1 比例使用封闭 union

```ts
export const LXM_TUPLET_RATIOS = [
  { actual: 2, normal: 3 },
  { actual: 3, normal: 2 },
  { actual: 4, normal: 3 },
  { actual: 5, normal: 4 },
  { actual: 5, normal: 3 },
  { actual: 6, normal: 4 },
] as const;

export type ILXMTupletRatio = (typeof LXM_TUPLET_RATIOS)[number];

export interface ILXMTuplet {
  id: string;
  /** 按 measure.beats 的时间顺序保存。 */
  beatIds: string[];
  ratio: ILXMTupletRatio;
}

export interface ILXMMeasure {
  // 既有字段保持
  tuplets: ILXMTuplet[];
  beats: ILXMBeat[];
}
```

比例必须显式保存。例如五连音既可能是 `5:4`，也可能是 `5:3`，不能只根据工具图标或成员数量推导。使用封闭 union 可以在类型和 schema 层共同阻止 `2:2`、`6:3` 等未定义组合。

`tuplets[]` 按首个成员在 `measure.beats` 中的顺序保存；`beatIds[]` 也严格按时间顺序保存。顺序是持久化 interface 的一部分，不依赖对象键枚举或 layout 临时排序。

### 3.2 Schema 与 ID

- `schema.ts` 为六种 ratio 建立严格 union，`ILXMTuplet` 禁止多余字段；
- `ILXMMeasureSchema` 增加必填 `tuplets`；
- `id-factory.ts` 增加 `createTupletId()`；
- tuplet ID 进入全局实体 ID 唯一性检查；
- 新增空白小节时使用 `tuplets: []`；
- 项目不维护旧 schema 迁移链，因此实现时将 `CURRENT_SCHEMA_VERSION` 在当时基线之上递增一次，并同步所有 example、fixture 和内置文档，不在 loader 或 layout 中补默认值。

## 4. 时间模型

### 4.1 书写时长与实际时长分离

保留 `calculateRhythmTicks(rhythm)` 的现有语义：它只计算书写时长。新增小节上下文接口作为命令、语义校验和 layout 的统一时间来源：

```ts
export type BeatDurationResult =
  | { ok: true; ticks: number }
  | {
      ok: false;
      code: "INVALID_RHYTHM" | "NON_INTEGER_TUPLET_TICKS";
    };

export const getBeatDurationTicks = (
  measure: ILXMMeasure,
  beat: ILXMBeat,
): BeatDurationResult;

export const getBeatEndTick = (
  measure: ILXMMeasure,
  beat: ILXMBeat,
): BeatDurationResult;
```

无连音组时，实际时长等于 `calculateRhythmTicks(beat.rhythm)`。属于连音组时：

```text
actualTicks = writtenTicks × ratio.normal / ratio.actual
```

必须先做整数整除检查，禁止 `Math.round`、浮点容差或把分数 tick 写入文档。

### 4.2 首批比例的精确性

| 场景                  | 单个书写时长 | 单个实际时长 | 整组实际时长 |
| --------------------- | -----------: | -----------: | -----------: |
| 2 个八分音符，`2:3`   |          480 |          720 |         1440 |
| 3 个八分音符，`3:2`   |          480 |          320 |          960 |
| 4 个十六分音符，`4:3` |          240 |          180 |          720 |
| 5 个十六分音符，`5:4` |          240 |          192 |          960 |
| 5 个十六分音符，`5:3` |          240 |          144 |          720 |
| 6 个十六分音符，`6:4` |          240 |          160 |          960 |

`TICKS_PER_QUARTER = 960` 时，首批比例对当前最短的三十二分音符也能得到整数 tick。尽管如此，整数检查仍保留为领域守卫，避免未来扩展 rhythm 或 ratio 时静默制造误差。

### 4.3 小节时间索引

新增 `core/tuplet.ts`，一次遍历 `measure.tuplets` 建立只读索引：

```ts
type ILXMTupletIndex = {
  tupletById: ReadonlyMap<string, ILXMTuplet>;
  tupletByBeatId: ReadonlyMap<string, ILXMTuplet>;
};
```

索引是 Module 的内部 seam，不写回文档。单个小节的时间计算保持 `O(beats + tuplets)`，不得为每个 Beat 重新扫描全部连音组。

`rhythm.ts` 中任何“Beat 实际结束位置”的调用都改为接收 measure 上下文；单纯比较书写时值或生成普通休止符的逻辑仍使用 `calculateRhythmTicks`。

## 5. 语义校验

Zod 只校验字段形状，`semantic-validation.ts` 负责以下跨字段规则：

1. tuplet ID 全局唯一；
2. `ratio` 位于首批白名单；
3. `beatIds.length === ratio.actual`；
4. 每个 beatId 在当前 measure 中存在且不重复；
5. `beatIds` 与 `measure.beats` 中的连续切片完全一致；
6. 所有成员的 `rhythm.base` 与 `dots` 完全相同；
7. 任一 Beat 不同时出现在两个 group 中；
8. 单个成员实际时长为整数；
9. 使用实际时长从 `0` 重算后，每个 `beat.tick` 连续且小节结尾精确等于拍号容量；
10. `tuplets[]` 按首成员顺序排列。

建议新增 issue code：

```ts
type ILXMSemanticValidationIssueCode =
  | ExistingIssueCode
  | "TUPLET_BEAT_NOT_FOUND"
  | "TUPLET_MEMBER_COUNT_MISMATCH"
  | "TUPLET_BEATS_NOT_CONTIGUOUS"
  | "TUPLET_RHYTHM_MISMATCH"
  | "TUPLET_OVERLAP"
  | "TUPLET_ORDER_INVALID"
  | "NON_INTEGER_TUPLET_TICKS";
```

issue path 必须指向具体 `tuplets.{index}`、`beatIds.{index}` 或成员 `rhythm`，loader 不把领域错误折叠成无定位的通用报错。

## 6. 连音组领域 Module 与命令

### 6.1 命令 interface

页面传稳定首尾 Beat 引用，不传展开后的 Beat 数组，也不直接构造 tuplet ID：

```ts
export interface ILXMSetTupletCommand extends ILXMScoreCommandBase {
  type: LXMScoreCommandEnum.SetTuplet; // "tuplet.set"
  measureId: string;
  startBeatId: string;
  endBeatId: string;
  ratio: ILXMTupletRatio;
}

export interface ILXMRemoveTupletCommand extends ILXMScoreCommandBase {
  type: LXMScoreCommandEnum.RemoveTuplet; // "tuplet.remove"
  measureId: string;
  tupletId: string;
}
```

`tuplet.set` 同时承担新增和修改：

- 目标范围没有 group 时，新建 group；
- 目标范围与一个既有 group 完全相同时，保留 tuplet ID 并修改 ratio；
- 完全相同的范围与 ratio 返回 `changed: false`、原 document 引用且不增加历史；
- 只要与既有 group 部分相交，就返回 `TUPLET_OVERLAP`，不自动拆组或合组。

比例修改首版只有相同 `actual` 才可能成立，例如 `5:4 ↔ 5:3`。其他比例若成员数量不匹配，返回 `TUPLET_MEMBER_COUNT_MISMATCH`。

建议命令错误码：

```ts
type ILXMScoreCommandErrorCode =
  | ExistingErrorCode
  | "TUPLET_NOT_FOUND"
  | "TUPLET_RANGE_INVALID"
  | "UNSUPPORTED_TUPLET_RATIO"
  | "TUPLET_MEMBER_COUNT_MISMATCH"
  | "TUPLET_RHYTHM_MISMATCH"
  | "TUPLET_OVERLAP"
  | "NON_INTEGER_TUPLET_TICKS"
  | "BEAT_IN_TUPLET";
```

### 6.2 容量协调 Module

新增 `core/measure-timeline.ts`，提供一个较深的纯领域接口：

```ts
type ReconcileMeasureTimelineResult =
  | { ok: true; measure: ILXMMeasure }
  | {
      ok: false;
      code: "MEASURE_OVERFLOW" | "RHYTHM_NOT_REPRESENTABLE";
    };

export const reconcileMeasureTimeline = (
  measure: ILXMMeasure,
  options: {
    createBeatId: () => string;
    /** 即使是尾部 rest，也必须保留这些稳定 Beat。 */
    protectedBeatIds?: ReadonlySet<string>;
  },
): ReconcileMeasureTimelineResult;
```

implementation 隐藏“实际时长累计、尾部容量休止识别、tick 重排和剩余容量分解”：

1. 把 notes Beat、任一 tuplet 成员和 `protectedBeatIds` 视为明确内容；
2. 只有最后一个明确内容之后连续、未分组、未保护的 rest 才是容量缓冲；
3. 按候选 tuplets 计算固定前缀实际时长；
4. 固定前缀超过小节容量时原子失败，不压缩、删除或改写其他真实 Beat；
5. 从 `0` 重算固定前缀的 tick；
6. 将剩余容量交给 `createRestBeats` 精确重建；
7. 只为重建的容量 rest 分配新 ID，其他 Beat、Note、tuplet ID 保持不变。

设置或删除 group 时，把目标 group 的全部成员加入 `protectedBeatIds`。因此删除一个位于小节末尾、成员均为 rest 的连音组时，也只删除分组关系，不会顺手删除原成员 Beat。

当连音组缩短时间时，后续 Beat 整体前移，尾部休止增加；当连音组拉长时间时，后续 Beat 整体后移并消耗尾部休止。若尾部容量不足则失败。命令不借用下一小节容量，也不为了成功而隐式修改其他 Beat 的书写 rhythm。

### 6.3 `tuplet.set` 原子步骤

1. 定位 track、measure、startBeat 和 endBeat；
2. 按 `measure.beats` 顺序展开闭区间，禁止逆序和跨小节；
3. 校验 ratio、成员数量、完全相同的 rhythm 与整数实际 tick；
4. 校验与现有 group 的相交关系；
5. 生成候选 `tuplets`，新增时由局部 ID factory 分配 ID；
6. 调用 `reconcileMeasureTimeline`，目标成员全部受保护；
7. 对候选文档执行 schema 与 semantic validation；
8. 全部成功后只复制目标 track/measure 分支，revision 增加一次。

任何一步失败都返回原文档，不形成历史；局部 ID factory 即使已经取号也不会泄漏到文档。

### 6.4 `tuplet.remove` 原子步骤

1. 在指定 measure 中按稳定 tuplet ID 定位；
2. 删除候选 group，但保留全部成员 Beat；
3. 把原成员加入 `protectedBeatIds`；
4. 按普通书写时长重算成员和后续 Beat；
5. 协调尾部容量并执行最终两层校验；
6. 成功只形成一条历史；容量不足时返回 `MEASURE_OVERFLOW`，group 保持不变。

## 7. 与既有编辑命令的协调

### 7.1 Beat 与 Note 命令

| 命令                                 | v5.1 规则                                                               |
| ------------------------------------ | ----------------------------------------------------------------------- |
| `note.set/remove/setRect/removeRect` | 不改变节奏关系，保持 tuplet；若 v5 技巧存在，继续执行其既有引用规则。   |
| `beat.setKind/setKindRange`          | notes/rest 转换不改变书写时值，保持 tuplet；rest 成员合法。             |
| `beat.setRhythm`                     | 目标 Beat 属于 tuplet 时返回 `BEAT_IN_TUPLET`；首版不允许单独破坏整组。 |

`beat.setRhythm` 的既有“压缩后续 Beat”规划必须感知连音组：

- 连音组成员不得作为单 Beat 压缩候选；
- 尾部已分组 rest 不能当作可随意重建的容量缓冲；
- 其他 Beat tick 重排统一使用实际时长；
- 修改 tuplet 外的 Beat 后，既有 group 及成员 ID 保持不变。

首版不增加“整组修改基础时值”命令。用户需要先删除 group、修改成员 rhythm，再重新设置 group；若删除后容量暂时无法闭合，则未来再单独设计原子 `tuplet.setRhythm`，不在页面拼接多条命令绕过原子性。

### 7.2 小节命令

- `measure.insert`：新小节使用 `tuplets: []`；
- `measure.remove`：tuplet 嵌套在 measure 内，随小节一起删除；v5 技巧仍按其引用生命周期清理；
- `measure.copy`：先复制全部 Beat 并建立 `oldBeatId → newBeatId`，再复制 tuplets、重建 tuplet ID 和每个 `beatIds` 引用；复制结果的 `barline` 仍为 `single`，v5 技巧仍不复制；
- 复制必须保留 ratio、group 顺序和成员顺序，源 group 与副本之间不能共享任何实体 ID。

### 7.3 拍号命令

`measure.setTimeSignature` 使用实际时长计算固定内容：

- 同容量拍号切换（如 `3/4 ↔ 6/8`）保留 tuplets，只改变拍组与视觉连梁；
- 扩容时保留 tuplets 并增加尾部休止；
- 缩容只能消费未分组的尾部容量休止，不能截断或删除 group；
- 全休止且 `tuplets.length === 0` 时可继续按新拍号单位拍完整重建；
- 全休止但包含 tuplet 时必须按明确内容处理，不能为了生成空白小节而丢失 group；
- `untilNextChange` 仍先规划全部目标小节，任一小节失败则全部不提交。

### 7.4 和弦标记与技巧

沿用现有节奏修改策略：连音组命令不联动修改 `chordSymbols.tick`。当前和弦标记只有绝对 tick，没有 Beat 引用，核心不能可靠判断它应跟随哪个 Beat；只保证 tick 仍位于小节容量内。该问题由 v6 和弦编辑模型另行处理。

v5 技巧引用稳定 Note/Beat ID。连音组命令不删除或替换这些实体，因此技巧引用保持；其视觉位置随 Beat 新 tick 和 layout 自动更新。

## 8. Layout Module

### 8.1 外部 interface

`buildLayout(document, options)` 继续是渲染与测试的唯一主要 interface。扩展小节布局产物：

```ts
export interface ILXMTupletBracketLayout {
  x1: number;
  x2: number;
  y: number;
  hookLength: number;
  gapX1: number;
  gapX2: number;
  strokeWidth: number;
}

export interface ILXMTupletLayout {
  id: string;
  measureId: string;
  beatIds: string[];
  ratio: ILXMTupletRatio;
  label: ILXMTextLayout;
  /** 完整连梁已明确覆盖 group 时为 null。 */
  bracket: ILXMTupletBracketLayout | null;
}

export interface ILXMMeasureLayout {
  // 既有字段保持
  tuplets: ILXMTupletLayout[];
}
```

layout 输出最终文字、线段、短钩和 bracket 中央避让区；website 不根据 Beat 坐标重新算中心点，也不根据是否存在连梁决定 bracket。

### 8.2 横向间距

`measure-spacing.ts` 的 `rhythmTicks` 改为实际时长，确保 beat slot 和时间轴一致；`durationWeight`、最小列宽仍由书写 `rhythm.base` 决定，避免三连音把可读的八分音符列压缩成任意像素。

连音数字对首版最小列宽的影响按 group 处理：若数字或 `5:4` 标签所需宽度大于成员 slot 覆盖宽度，则由核心 spacing contributor 增加该 group 范围内的最小宽度。不得在 React 中通过 CSS transform 补偿。

### 8.3 连梁分组

连音组是连梁分组的显式约束：

- 在 group 首成员之前和末成员之后强制断开自动 beam group；
- group 内仍按书写 base 决定 beam level；
- rest 或空 notes 不生成 duration mark，并会使该 group 无法满足“完整连梁覆盖”；
- 拍号拍组边界仍生效，但不能把一个合法 tuplet 从中间拆成两个 beam group；校验和命令应确保 group 的实际范围可作为整体布局；
- 多层连梁沿用现有 shared/partial 规则。

“只显示数字”的判定必须确定且可测试：所有成员都有 duration mark，且存在一个 level 1 shared beam，其有序 `beatIds` 与 group 的 `beatIds` 完全相等。其他情况一律显示数字和 bracket。这样不会因相邻普通短音符碰巧共用一条更长连梁而丢失 group 范围。

### 8.4 数字与 bracket

- label 默认显示 `actual`；对首批歧义比例，工具栏必须显示完整比例，但谱面仍按常规只显示 `2`、`3`、`4`、`5`、`6`；
- label 的 X 是首末成员 slot 时间锚点的中点；
- bracket 从首成员节奏锚点延伸到末成员节奏锚点，两端使用朝向 rhythm lane 的短钩；
- bracket 中央为 label 留出确定性 gap，不让横线穿过数字；
- tuplet annotation 位于现有 rhythm 图形下方的独立区域，Y 由该范围内最低的 beam、flag、rest mark 和附点 bounds 再加集中净空得到；
- 同一 measure 不允许 group 重叠，因此首版只需一个 tuplet annotation lane；
- annotation 最低点进入 `measure.height`、`system.height`、后续 system Y 和整谱 `height`，SVG viewBox 不得裁切；
- 无 tuplet 的文档保持 v5 既有几何基线。

建议新增 `layout/tuplet-layout.ts`，由 `measure-layout.ts` 在 duration beam 和 rest layout 完成后调用。相关字号、hook、stroke、gap 和 lane padding 全部集中到 `layout-constants.ts`。

## 9. Website 交互与渲染

### 9.1 工具状态

- 将现有 TAB 矩形选择归一为 Beat 范围，弦号维度不参与 tuplet；
- 仅同一 measure、连续且数量匹配的选择可启用相应 ratio；
- 页面可做即时禁用提示，但核心命令拥有最终合法性；
- 二、三、四、五、六连音工具必须用 tooltip 或菜单明确展示 `actual:normal`，特别是 `5:4` 与 `5:3`；
- 选择范围与既有 group 完全一致时允许切换比例或删除；部分相交时禁用并展示核心错误；
- set/remove 均通过 store `execute`，成功一条历史，no-op 和失败不入历史。

实现继续使用 TypeScript、函数式 React、Hooks 和纯派生函数。页面不缓存第二份 tuplet 领域状态；选区、hover 和当前工具属于临时 UI 状态。

### 9.2 SVG 渲染

新增纯消费 tuplet layer：

- `<text>` 直接消费 `label`；
- bracket 使用 layout 给出的线段、gap 和 hook，不在 JSX 中重新计算；
- key 使用 `tuplet.id`；
- pointer hit 首版仍由 Beat 选区驱动，不为 bracket 增加独立拖拽命中；
- print 样式保留数字与 bracket，交互 hover/selection 高亮在打印时隐藏。

## 10. 文件改造清单

### 10.1 Core

- `core/constants.ts`：ratio 白名单；
- `core/types.ts`：`ILXMTupletRatio`、`ILXMTuplet`、`measure.tuplets`；
- `core/schema.ts`：严格 ratio/tuplet schema；
- `core/id-factory.ts`：tuplet ID；
- `core/tuplet.ts`：索引、比例判断、实际时长纯函数；
- `core/measure-timeline.ts`：实际 tick 重排与尾部休止协调；
- `core/rhythm.ts`：保留书写时长接口，迁移需要 measure 上下文的结束 tick 接口；
- `core/rhythm-change.ts`、`core/time-signature-change.ts`：接入实际时长和 group 保护；
- `core/commands.ts`：set/remove 命令、既有命令协调和错误码；
- `core/semantic-validation.ts`：group 与实际时间轴规则；
- example、fixture、loader/command/semantic tests：补齐 `tuplets`。

### 10.2 Layout 与 website

- `layout/layout-types.ts`：tuplet 最终几何；
- `layout/layout-constants.ts`：annotation 常量；
- `layout/measure-spacing.ts`：实际时长列；
- `layout/duration-beam-layout.ts`：tuplet seam 与完整连梁判定；
- `layout/tuplet-layout.ts`：数字、bracket 和 bounds；
- `layout/measure-layout.ts`、`layout/layout-helpers.ts`：接入产物与动态高度；
- `apps/website/app/page.tsx`：函数式工具入口和纯 layout 渲染；
- `apps/website/stores/editor-store.ts`：复用 execute/history，不新增持久化副本。

## 11. 测试策略

### 11.1 时间与校验

- 六种比例在 quarter、eighth、sixteenth、thirtySecond 下均得到精确整数 tick；
- 无 group 时保持现有节奏结果；
- 成员缺失、重复、逆序、不连续、数量不符、不同 base、不同 dots、重叠、嵌套均拒绝；
- 同附点成员可精确换算时成功；无法得到整数实际 tick 的组合返回 `NON_INTEGER_TUPLET_TICKS`；
- tuplets 顺序、全局 ID 唯一性和精确 issue path；
- 实际 tick 从 0 连续到 measure capacity，不依赖旧 tick 偶然值。

### 11.2 命令与容量

- 六种 set 成功；同范围同比例 no-op；`5:4 ↔ 5:3` 保留 tuplet ID；
- 部分重叠、范围跨 measure、逆序和 unsupported ratio 原子失败；
- 缩短 group 时后续 Beat 前移、尾部 rest 增加；
- 拉长 group 时后续 Beat 后移、尾部 rest 减少；容量不足时原文档和 revision 不变；
- remove 保留成员 Beat/Note/technique 引用；成员为尾部 rest 时也保留稳定 Beat ID；
- `beat.setRhythm` 目标在 group 内失败，group 外编辑不破坏 group；
- setKind、note 编辑保持 group；
- measure copy 重建 tuplet/Beat ID 且引用只指向副本；insert 为空数组；remove 无悬挂引用；
- time signature 扩容、缩容、同容量切换和多小节原子失败；
- success、failure、no-op、不可变引用、revision 和 history 各自符合既有契约。

### 11.3 Layout

- 完整 shared beam 只显示数字；rest、空 notes、长时值或不完整 beam 显示 bracket；
- 相邻普通短音符不会让 group 错误隐藏 bracket；
- `5:4`、`5:3` 都显示 `5`，但领域 ratio 与工具提示不同；
- annotation 与多层 beam、flag、rest、附点和小节底部保持净空；
- comfortable/compact、稀疏末行、单小节行和超宽小节；
- 修改 `systemWidth` 不修改领域 tuplet，且 group 永不跨 measure/system；
- 无 tuplet fixture 的既有坐标和高度回归；
- 相同输入重复 build 得到深相等布局。

### 11.4 必跑检查

```bash
pnpm test
pnpm type-check
pnpm lint
pnpm build
```

浏览器至少验收：六种比例、notes/rest 混合 group、数字-only、bracket、撤销重做、小节复制、拍号变化和固定桌面打印视图。

## 12. 实施顺序

1. 冻结 v5 测试和视觉基线，建立 v5.1 fixture；
2. 增加模型、schema、ID factory 并同步全部文档数据；
3. 实现 tuplet 索引、实际时长和语义校验；
4. 提取 measure timeline 容量协调 Module；
5. 实现 `tuplet.set/remove` 和命令级测试；
6. 协调 rhythm、time signature、measure copy/remove/insert；
7. 让 spacing 和 beam layout 消费实际时长与 group seam；
8. 增加 tuplet annotation、动态高度和 SVG 纯渲染；
9. 接入工具栏、选区、错误提示和历史；
10. 执行全量自动化与固定浏览器视觉验收。

模型与时间计算完成前不先接页面假数据；命令闭环完成前不通过连续执行多条现有命令模拟原子操作。

## 13. 风险与控制

| 风险                                  | 控制方式                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| 书写时长与实际时长被混用              | 保留 `calculateRhythmTicks` 的单一语义，实际时间统一走带 measure 上下文的接口 |
| 多处扫描 tuplets 导致复杂度和规则漂移 | 每小节一次建立 `beatId → tuplet` 索引，命令、校验、layout 复用同一 Module     |
| set/remove 产生半个合法小节           | 候选 measure 先完整规划，再一次 finalize 和提交                               |
| 尾部 rest 重建误删 group 成员         | group 成员和命令目标使用 protectedBeatIds，只有未分组尾部 rest 是容量缓冲     |
| `beat.setRhythm` 压缩破坏 group       | group 成员不可作为单 Beat 压缩候选，目标在 group 内明确失败                   |
| 小节复制留下旧 Beat 引用              | 先建立完整 Beat ID map，再复制 tuplets 并重建 tuplet ID                       |
| 相邻连梁让数字范围含糊                | group 首尾强制 beam seam；仅精确 shared beam 覆盖时隐藏 bracket               |
| annotation 被 viewBox 裁切            | 最低视觉 bounds 进入 measure/system/document 高度计算                         |
| website 重复实现音乐规则              | 页面只做即时可用性提示，核心命令和语义校验最终裁决                            |
| v6 和弦标记跟随语义不明确             | v5.1 沿用绝对 tick 行为，不在本版本猜测或移动 chord symbol                    |

## 14. 验收标准

- 六种 ratio 可新增、修改、删除、保存、加载、撤销和重做；
- 每个 Beat 的实际时长按 `written × normal / actual` 精确得到整数 tick；
- 任一成功结果都保持 Beat 连续且小节容量精确闭合；失败和 no-op 不产生部分修改或历史；
- group 成员同 measure、连续、rhythm 完全一致，数量等于 actual，且不重叠、不嵌套；
- 既有 rhythm、拍号、小节复制和删除命令不会破坏 group 或留下悬挂引用；
- 完整连梁 group 只显示数字，其他 group 显示数字与 bracket；
- 数字和 bracket 不与 rhythm lane 内容碰撞，也不被 system 或 SVG viewBox 裁切；
- website 不计算比例时长、group 合法性、beam 覆盖或 bracket 几何；
- 连音组不跨 measure，因此自动换行不会产生跨 system 实体或续接括号；
- 全量测试、TypeScript 检查、lint、build 和固定桌面浏览器验收通过。

版本范围来源见 [MVP 版本路线图](../mvp-version-roadmap.md)，与吉他技巧的边界见 [MVP v5 技术实现方案](../v5/technical-design.md#26-连音组tuplet版本归属)。
