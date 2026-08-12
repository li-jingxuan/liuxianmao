# MVP v5 Fix：扫弦/琶音优先记谱并保留源 Note

## 1. 背景与问题

MVP v5 已把扫弦和琶音建模为 Beat 技巧：

```ts
type StrumTechnique = {
  id: string;
  type: "strum";
  beatId: string;
  stroke: "down" | "up";
};

type ArpeggioTechnique = {
  id: string;
  type: "arpeggio";
  beatId: string;
  direction: "ascending" | "descending";
};
```

扫弦/琶音由用户在同一 Beat 内选择至少两根弦线创建，技巧跨度由持久化的 `minString/maxString` 和弦线最终 Y 坐标推导。领域模型分别表达具体音符、技巧弦范围和演奏方向，但当前页面把基础品位与技巧记号同时画出：

```text
领域事实：6 弦、5 弦、4 弦、3 弦上的具体品位 + 扫弦/琶音技巧
当前投影：全部品位数字 + 左侧扫弦/琶音记号
期望投影：只显示扫弦/琶音记号，不显示该 Beat 的品位数字
```

最初方案曾考虑在添加扫弦/琶音时删除 Note，并只用弦范围代替具体音符。复审后“删除 Note”被否决，但显式弦范围在交互验收后确认为必要领域事实：和弦可能包含 6～1 弦，而用户只选择 6～3 弦执行技巧。Note 不只是当前屏幕上的品位文本，它还是：

- 和弦构成与实际音高的源数据；
- 扫弦/琶音纵向范围的来源；
- 后续播放、导出、分析和编辑的基础；
- 删除技巧后恢复普通记谱的唯一可靠依据；
- 其他 Note 级技巧引用的稳定实体。

本 fix 改为“数据保留、记谱投影互斥”：Note 继续作为可追溯的领域事实存在；扫弦/琶音拥有更高的品位文本展示优先级，由核心 layout 决定最终可见内容。

## 2. 目标

完成后应满足：

- 添加扫弦/琶音不删除、不改写目标 Beat 的 Note；
- `strum.stroke`、`arpeggio.direction` 和现有 schema 保持不变；
- 扫弦/琶音的跨度从用户选择的 `minString/maxString` 弦线位置推导；
- 目标 Beat 的 Note 继续参与时值、技巧几何、语义校验和后续编辑；
- 最终 SVG 不展示该 Beat 由 `ILXMNoteLayout.fretText` 产生的基础品位文本；
- 删除扫弦/琶音后，原 Note 在下一次布局中自然重新显示；
- 在技巧范围内输入单个 Note 时，输入优先并在同一命令中删除扫弦/琶音；
- 在技巧范围外输入 Note 时保留技巧；
- 同一 Beat 的扫弦与琶音继续互斥；
- 页面、打印和其他 layout 消费者共享同一套投影结果；
- website 不查询技巧类型来决定是否隐藏 Note。

## 3. 非目标

本 fix 不包含：

- 删除或迁移现有 Note 数据；
- 非连续弦集合，例如只选择 6、4、2 弦而不包含中间弦；
- 改变扫弦 `down/up` 或琶音 `ascending/descending` 的领域语义；
- 修改 `pickStroke`、P.M.、Let Ring 或其他技巧的模型；
- 修改音频播放、MIDI、力度、逐弦延迟或扫弦速度；
- 跨 Beat、跨小节或跨 System 的扫弦/琶音；
- 自动删除或恢复 Note 级技巧；
- 在 CSS 中使用透明度、遮罩或 z-index 覆盖品位文字。

`minString/maxString` 是正式持久化语义，不是临时 UI 选区：它表示技巧覆盖的连续弦线范围，与 Beat 中当前有哪些 Note 解耦。字段使用规范化的最小/最大弦号，演奏或音高方向仍由 `stroke/direction` 独立表达。

## 4. 核心决策

### 4.1 Note 是源数据，技巧是演奏语义

文档继续允许并要求以下组合：

```text
Beat.kind = notes
Beat.notes.length >= 2
track.techniques[] 中存在一个引用该 Beat 的 strum 或 arpeggio
```

这不是领域冲突。它分别表达：

- `Beat.notes[]`：这一拍包含哪些具体音；
- `strum/arpeggio`：这些音如何被扫过或依次奏出；
- layout 投影：当前记谱风格选择显示哪一层视觉信息。

因此“互斥”只发生在最终品位文本投影，不发生在持久化数据层。

### 4.2 保留现有技巧模型

`ILXMTechnique` 不变：

```ts
type ILXMTechnique =
  | {
      id: string;
      type: "strum";
      beatId: string;
      minString: number;
      maxString: number;
      stroke: "down" | "up";
    }
  | {
      id: string;
      type: "arpeggio";
      beatId: string;
      minString: number;
      maxString: number;
      direction: "ascending" | "descending";
    }
  | OtherTechnique;
```

视觉跨度由 `minString/maxString` 对应弦线决定。以用户选择 3～6 弦为例：

```text
strum down           → 6 弦 → 3 弦
strum up             → 3 弦 → 6 弦
arpeggio ascending   → 6 弦 → 3 弦
arpeggio descending  → 3 弦 → 6 弦
```

这里沿用当前 v5 已定义的音乐语义和 TAB 坐标映射。website 不把枚举直接映射为 SVG 起止坐标，最终方向仍只由核心 `technique-layout.ts` 处理。

### 4.3 记谱优先级

首版只定义一种覆盖规则：

```text
同一 Beat 存在 strum 或 arpeggio
  → 显示扫弦/琶音记号
  → 隐藏该 Beat 中 minString～maxString 范围内的基础 fret Note 文本
  → 范围外的基础 fret Note 保持显示
  → 保留 rhythm stem、beam、flag、dot 和 sustain marks
```

不使用“半透明品位”“先画文字再用白色背景盖住”或“技巧图层放在文字上方”等视觉伪互斥。最终 SVG 中不应创建由该 Beat 的 `ILXMNoteLayout.fretText` 产生的 `<text>` 元素。

本 fix 暂不改变其他 Note 技巧的展示。自然/人工泛音的 `<5>`、`[5]`，以及 trill 的 `tr 7` 等数字属于技巧自身的记谱文本，不属于本 fix 隐藏的基础 fret Note 文本。若实际验收出现无基础品位背景下的 bend、泛音、H/P 等标记语义不清，应单独定义完整的 technique precedence matrix；不能在没有产品规则时静默删除领域技巧或扩大隐藏范围。

## 5. Deep Module 与 seam

### 5.1 外部 seam 保持 `buildLayout`

投影规则必须收敛在核心 layout Module。外部 interface 继续是：

```ts
buildLayout(document, options): ILXMLayout
```

调用方只消费最终布局，不需要知道：

- 哪类技巧会覆盖品位文本；
- 如何从 technique 找到 Beat；
- 应该在布局的哪个阶段隐藏；
- 时值和技巧几何是否仍需要隐藏 Note；
- 打印是否应复用同一规则。

如果删除核心投影实现，这些复杂度会重新散落到 website、打印和未来导出调用方，因此该行为属于 layout Module 应承担的深度。

### 5.2 不扩大公共 layout interface

不建议给 `ILXMNoteLayout` 增加：

```ts
display: "fret" | "suppressedByTechnique";
```

虽然该字段便于调试，但会迫使每个 adapter 都理解并正确处理隐藏状态，扩大外部 interface，也允许调用方忘记过滤。

推荐核心 layout 在内部完成全部计算后，从最终 `ILXMMeasureLayout.notes` 中移除被覆盖的 Note layout。于是现有页面：

```tsx
measure.notes.map(renderFretText);
```

无需任何新分支，打印和其他消费者也不会误画被覆盖的品位。源 Note 仍完整保存在 `ILXMDocument` 中，可追溯性不依赖 layout 输出。

这同时明确了两个接口不变量：

- `ILXMDocument` 是完整领域事实，播放、导出、音高分析和编辑必须读取它；
- `ILXMMeasureLayout.notes` 是最终可渲染的基础品位投影，不保证与 `Beat.notes` 一一对应，调用方不得从它反推和弦构成或 Note 数量。

应同步更新 `ILXMMeasureLayout.notes` 的类型注释，使未来 layout 消费者不会把“可见 Note”误当成完整领域 Note 集合。

## 6. Layout 管线

### 6.1 必须先布局、后投影

隐藏不能发生在 `layoutMeasure.layoutNodes`，否则会破坏：

- 扫弦/琶音从 Note Y 推导纵向跨度；
- 时值符干从最下方 Note Y 连接到 rhythm lane；
- Note 级技巧解析稳定 Note ID 与最终坐标；
- system 平移后所有几何共享同一坐标系。

正确顺序：

```text
ILXMDocument（完整 Note）
  → measure/system 基础布局（完整 ILXMNoteLayout）
  → duration layout（消费完整 Note）
  → technique anchor/segment layout（消费完整 Note）
  → system 最终平移与技巧 bounds
  → fret visibility projection（只裁剪最终 measure.notes）
  → ILXMLayout
```

投影是 layout implementation 的最后一步之一，而不是领域命令或页面渲染的条件分支。

### 6.2 建立被覆盖 Beat 索引

在 `technique-layout.ts` 内增加私有纯 helper：

```ts
const getFretSuppressedBeatIds = (
  techniques: ILXMTechnique[],
): ReadonlySet<string> =>
  new Set(
    techniques.flatMap((technique) =>
      technique.type === "strum" || technique.type === "arpeggio"
        ? [technique.beatId]
        : [],
    ),
  );
```

该 helper 只处理布局投影，不替代 `validateTechnique` 的领域冲突规则。正式文档已通过 loader/semantic validation；即便防御性地遇到非法重复技巧，Set 仍能确定性地产生一次覆盖结果。

### 6.3 应用最终投影

建议增加私有纯函数：

```ts
const applyFretVisibilityProjection = (
  systems: ILXMSystemLayout[],
  suppressedBeatIds: ReadonlySet<string>,
): ILXMSystemLayout[] => {
  if (suppressedBeatIds.size === 0) return systems;

  return systems.map((system) => {
    let systemChanged = false;
    const measures = system.measures.map((measure) => {
      const notes = measure.notes.filter(
        (note) => !suppressedBeatIds.has(note.beatId),
      );
      if (notes.length === measure.notes.length) return measure;
      systemChanged = true;
      return { ...measure, notes };
    });
    return systemChanged ? { ...system, measures } : system;
  });
};
```

不变量：

- 没有被覆盖 Beat 时返回原 `systems` 引用；
- 没有目标 Note 的 measure 保持原引用；
- 只修改 `measure.notes`，不修改 document、beat、duration、techniques、selection 或 hit index；
- 只隐藏同一 Beat 中落入 `minString/maxString` 连续范围的 Note；
- 输出顺序保持不变；
- 不原地修改数组。

### 6.4 接入位置

`layoutTrackTechniques` 当前已经：

1. 从完整 base systems 建立 Note/Beat anchors；
2. 创建技巧 candidates；
3. 分配 lane；
4. 平移 system 和 measure 的全部几何；
5. 使用平移后的 anchors 创建最终 technique segments。

投影应在所有 segment 已创建并写回 system 后应用：

```ts
const systemsWithTechniques = systems.map(/* 写入 technique segments */);
return applyFretVisibilityProjection(
  systemsWithTechniques,
  getFretSuppressedBeatIds(track.techniques),
);
```

不能在 `buildAnchorMaps` 前过滤，也不能在 `translateMeasure` 中跳过 Note，否则技巧和时值几何会失去源坐标。

### 6.5 非法输入的防御边界

`buildLayout` 的常规输入来自已通过 schema 和 semantic validation 的文档，但其 TypeScript 签名仍接受普通 `ILXMDocument`，测试或未来 adapter 也可能直接构造对象。因此 layout 不能让缺失 Note anchor 或不足两颗 Note 的非法技巧产生 `Infinity`、`-Infinity` 或 `NaN` 几何。

创建 strum/arpeggio segment 前必须再次检查 Beat anchor 至少包含两颗 Note；不满足时跳过该 candidate，不输出空 path 或非法 bounds。该保护不替代领域校验，也不尝试修复或修改 document，只保证 layout 对异常输入安全降级。

### 6.6 时值布局保持不变

由于源 Note 保留，`duration-beam-layout.ts` 无需引入“无品位 attack”或新的 context：

- source Beat 仍满足 `beat.kind === "notes" && beat.notes.length > 0`；
- 符干继续连接到最下方实际 Note；
- whole/half sustain marks、dot、flag 和 beam 算法保持；
- 投影只裁剪最终 fret Note layout，不裁剪 `durationMarks` 或 `beamSegments`。

这是保留源 Note 相比删除 Note 的重要简化。

### 6.7 Selection 与 hit-test

TAB cell selection 和 hit-test 依赖 Beat slots 与 string lines，不依赖品位 `<text>` 是否存在，因此保持不变：

- 用户仍可点击和拖选被技巧覆盖的 Beat；
- 输入品位仍作用于真实 Note；
- website 事件处理继续先执行 technique hit-test，再执行 TAB cell hit-test；
- focus caret 和 selection range 继续显示在最终位置；
- 隐藏品位不会产生不可点击区域。

## 7. 领域规则与命令

### 7.1 Schema 增加弦范围，并补强 semantic uniqueness

`ILXMTechnique`、`ILXMTechniqueDraft` 与 strict schema 为 strum/arpeggio 增加必填的 `minString/maxString`。二者必须是 1～6 内规范化的整数且 `minString < maxString`，因此单弦选择不会创建技巧。`strum.stroke`、`arpeggio.direction` 及同 Beat 互斥规则保持。

持久化文档中的 Note 与扫弦/琶音共存是合法且必要的状态，不能新增语义错误。

但既有规则需要补强一个已发现的缺口：同一 Beat 上 `strum` 与 `arpeggio` 合计最多存在一个，与方向参数无关。方向变化必须通过 update 表达，不能同时保存 `strum/down + strum/up` 或 `arpeggio/ascending + arpeggio/descending`。`validateTechnique` 是命令与 semantic validation 的共享规则，因此补强后新增、更新和加载文档会得到一致结论。

### 7.2 Add/update/remove 不清理 Note

既有 `technique.add/update/remove` 继续只修改 `track.techniques[]`：

- add 技巧后 Note 原引用保持；
- update 方向后 Note 原引用保持；
- update 移动到另一合法 Beat 时，两边 Note 均保持；
- remove 后 Note 无需恢复，下一次 `buildLayout` 自动显示；
- 成功、失败、no-op 和 revision 规则不变。

不新增“技巧覆盖 Note”领域命令，也不让 store 组合多条命令。

### 7.3 单格 Note 输入优先于技巧

当扫弦/琶音存在时：

- 在 `minString/maxString` 范围内输入或修改单个 Note：同一命令删除技巧并显示最新品位；
- 即使输入品位与已有 Note 相同，只要当前技巧覆盖该单元格，也视为取消技巧的有效操作；
- 在范围外输入或修改 Note：技巧保留，范围和跨度不变；
- 批量矩形输入不隐式取消技巧，避免一次和弦录入误删多个整拍技巧；
- 删除 Note 不改变显式弦范围；
- 转为 rest 或删除 Measure：继续按既有规则清理技巧。

每个 Note 编辑仍只有一次 revision 和一个历史项。undo/redo 恢复文档后，布局投影由当前技巧状态重新计算，不保存额外 UI 状态。

## 8. Website 与其他 adapter

### 8.1 Website 不增加技巧判断

`EditorShell/index.tsx` 保持：

```tsx
{
  measure.notes.map((note) => <text key={note.id}>{note.fretText}</text>);
}
```

禁止增加：

```tsx
const hiddenBeatIds = new Set(track.techniques /* ... */);
measure.notes.filter(/* ... */);
```

website 只消费 layout interface；技巧优先级属于核心 layout implementation。

### 8.2 工具栏保持现有方向交互

`TechniqueToolbar` 继续：

- 要求选区只包含同一个 Beat，且至少跨两根弦线；
- 使用 `startString/endString` 的最小/最大值生成规范化 `minString/maxString`；
- 扫弦提供 `down/up`；
- 琶音提供 `ascending/descending`；
- pickStroke 继续使用自己的 `down/up`；
- add/update/remove 继续调用统一 store `execute`。

单格或跨 Beat 选区不生效，并给出明确错误。技巧横向中心与该 Beat 的 Note 时间中心重合，纵向范围严格使用用户选择的弦线端点。

### 8.3 打印、导出与可追溯性

- 打印消费同一 `ILXMLayout`，因此不显示被覆盖品位；
- JSON/document 导出保存完整 Note 与技巧，可用于溯源；
- 若未来新增“原始数据检查器”，应直接读取 `ILXMDocument`，不从可见 layout 反推；
- 若未来新增其他 SVG adapter，应只消费 `ILXMLayout`，不自行重复投影规则。

## 9. 预计修改范围

```text
packages/lxm-editor/src/layout/
  technique-layout.ts          # 最终应用 fret visibility projection，并防御非法空 anchor
  layout-types.ts              # 明确 notes 是最终可见的基础品位投影

packages/lxm-editor/src/core/
  technique-rules.ts           # 同 Beat 的 strum/arpeggio 合计最多一个

packages/lxm-editor/tests/layout/
  technique-layout.test.ts     # 投影、源数据、恢复与几何回归

packages/lxm-editor/tests/core/
  technique-commands.test.ts   # 同类反方向与跨类型的 Beat 技巧冲突

apps/website/
  原则上无需生产代码修改       # 现有渲染自然消费过滤后的 notes

docs/mvp/v5/
  README.md
  strum-arpeggio-note-exclusivity-fix.md
```

如果聚焦测试证明 `buildLayout` 在 `layoutTrackTechniques` 之后还有消费者必须读取完整 Note layout，才把投影上移到 `layout/index.ts` 的最终返回前。首选仍是放在 `technique-layout.ts`，因为覆盖策略与技巧类型具有最高 locality。

原则上不修改：

- core types/schema；
- commands、ID factory、store 和 history；
- measure/system/duration layout；
- TechniqueToolbar；
- hit-test 和 selection layout；
- example fixture。

## 10. 测试方案

### 10.1 精确红灯回归

在正式 `technique-layout.test.ts` 增加 table-driven 测试：

```ts
it.each(["strum", "arpeggio"])(
  "%s 优先投影时不输出目标 Beat 的 fret notes",
  (type) => {
    // fixture 在选定弦范围内保留真实 Note，并另放一个范围外 Note
    // 添加对应 technique
    // buildLayout
    // 断言最终 measure.notes 不含该 beatId
  },
);
```

该用例必须在旧实现上因“仍输出品位 Note layout”失败，并在 fix 后通过。

### 10.2 源数据保持

- `buildLayout` 前后 document 深相等；
- 目标 Beat 的 Note 数量、ID、string 和 fret 全部保持；
- track.techniques 深相等；
- 重复构建 layout 结果深相等；
- layout 不原地修改 fixture 或 base systems。

### 10.3 最终投影

- strum 选定范围内的 Note 从最终 `measure.notes` 移除，范围外 Note 保留；
- arpeggio 选定范围内的 Note 从最终 `measure.notes` 移除，范围外 Note 保留；
- 同 Measure 的其他 Beat Note 保持原顺序和几何；
- 同 System/其他 System 的 Note 不受影响；
- 无扫弦/琶音时保持现有 Note layout 基线和引用优化；
- pickStroke、P.M.、Let Ring 等不触发品位隐藏；
- strum/arpeggio 与 harmonic、trill 共存时只隐藏基础 fret Note，技巧自身文本保留；
- 多个不同 Beat 的扫弦/琶音可以同时投影；
- 被覆盖 Beat 的 fret 文本不会出现在最终 website SVG DOM。

### 10.4 技巧和时值几何

- 隐藏后 strum/arpeggio path、texts、bounds 保持有效；
- 路径跨度严格覆盖 `minString/maxString` 弦线，并横向居中于 Beat/Note；
- down/up 与 ascending/descending 方向保持；
- 不出现 `Infinity`、`-Infinity` 或 `NaN`；
- 防御性输入中目标 Beat 少于两颗 Note 时不输出非法 segment；
- duration mark、stem、sustain、dot、flag 和 beam 与 fix 前深相等；
- technique hit-test 继续返回稳定 technique ID；
- selection/focus caret 几何不变。

### 10.5 编辑生命周期

- 添加 strum/arpeggio 后 document Note 保持、layout Note 隐藏；
- remove 后 document Note 仍在、layout Note 重新显示；
- update 方向只改变 path，不改变 Note；
- 同 Beat 的 `strum/down + strum/up`、`arpeggio/ascending + arpeggio/descending` 和跨类型组合均返回冲突；
- update 从 Beat A 移动到 Beat B 后，A 的基础品位恢复，B 的基础品位隐藏；
- 在范围内输入单个 Note 时技巧级联删除并显示最新品位；
- 在范围外输入单个 Note 时技巧保留且新 Note 可见；
- undo/redo 在隐藏与显示状态之间正确切换；
- 每个命令 revision 和历史数量保持既有规则。

### 10.6 打印与浏览器

- 固定 A4 页面不显示目标 Beat 品位；
- 技巧、时值、连梁和附点仍完整；
- 点击技巧和 TAB cell 均正常；
- 删除技巧后品位立即恢复；
- 打印预览与屏幕使用相同投影；
- 页面和控制台无 warning/error。

### 10.7 必跑命令

```bash
pnpm --filter @liuxianmao/lxm-editor test
pnpm --filter @liuxianmao/lxm-editor type-check
pnpm --filter @liuxianmao/lxm-editor lint
pnpm --filter website test
pnpm test
pnpm type-check
pnpm lint
pnpm build
```

## 11. 实施顺序

### Step 0：建立用户症状回归测试

- 用真实含两颗以上 Note 的 Beat 分别添加 strum/arpeggio；
- 断言最终 layout 不输出目标 Beat Note；
- 断言源 document Note 仍完整；
- 运行测试确认在当前实现上稳定红灯。

### Step 1：实现私有投影 helper

- 建立 `getFretSuppressedBeatIds`；
- 建立 `applyFretVisibilityProjection`；
- 保持纯函数、结构共享和确定性输出；
- 为 helper 行为通过 `layoutTrackTechniques` 外部 interface 测试，不导出内部 helper。

### Step 2：补强整拍技巧唯一性

- 调整 `validateTechnique`，同一 Beat 的 strum/arpeggio 合计最多一个；
- add、update 与 semantic validation 继续共享同一规则；
- 增加同类反方向、跨类型和移动目标的冲突测试。

### Step 3：接入最终技巧布局

- 在 technique segments 与最终 system 平移完成后应用投影；
- 确认技巧/时值在过滤前已经消费完整 Note anchors；
- 让精确回归、几何和源数据测试通过。

### Step 4：编辑生命周期回归

- 覆盖 add/update/remove、Note 增删、级联和 undo/redo；
- 确认不需要修改 commands/store；
- 若发现既有命令缺陷，单独增加红灯测试后再做最小修复，不把命令重构混入投影实现。

### Step 5：全量与浏览器验收

- 运行 test/type-check/lint/build；
- 验证屏幕、打印、技巧命中和 Note 恢复；
- 确认 website 没有新增 technique-aware 隐藏逻辑；
- 同步 v5 README 的最终状态。

## 12. 浏览器验收场景

1. 在同一 Beat 拖选 3～6 弦并添加 down strum；确认箭头横向居中、纵向覆盖选区，范围内品位隐藏。
2. 删除 strum；确认原品位立即、完整恢复。
3. undo/redo；确认显示投影切换，但 Note 内容从未丢失。
4. 对同一 Beat 添加 ascending arpeggio；确认波浪方向正确且品位隐藏。
5. 修改其中一个 fret；确认 arpeggio 保留且品位仍隐藏。删除技巧后显示修改后的最新 fret。
6. 在选定范围内输入单个 Note；确认技巧删除，最新品位立即显示。
7. 在选定范围外输入 Note；确认技巧与范围保持，新 Note 正常显示。
8. 检查相邻普通 Beat：其品位、时值和选择不受影响。
9. 检查固定 A4、compact/comfortable、重新断行和打印预览。

## 13. 风险与防护

| 风险                                          | 防护                                                      |
| --------------------------------------------- | --------------------------------------------------------- |
| 在 React 中隐藏导致打印/导出规则分裂          | 核心 layout 统一输出最终可见 notes                        |
| 过早过滤导致技巧跨度或符干失去锚点            | 所有几何完成后再应用最终投影                              |
| 给 Note layout 增加 visibility 后调用方漏处理 | 不扩大 interface，直接过滤最终 notes                      |
| layout 意外修改 document                      | 纯函数、结构共享和输入深相等测试                          |
| 删除技巧后无法恢复品位                        | Note 始终保存在 document，重新布局自然恢复                |
| 修改 Note 后技巧范围不更新                    | 每次 buildLayout 从最新 Note anchors 重新推导             |
| 少于两颗 Note 仍残留技巧                      | 保留现有 validate/prune 规则及命令测试                    |
| 其他 Note 技巧悬浮而语义不清                  | 本 fix 不静默扩范围；视觉验收后单独制定 precedence matrix |
| 同 Beat 保存两个相反方向记号                   | 领域规则限制 strum/arpeggio 合计最多一个，方向使用 update  |
| 非法输入产生 Infinity/NaN SVG                  | segment 创建前检查范围端点可解析为真实弦线坐标              |
| 隐藏 Note 后 TAB cell 不可编辑                | hit-test/selection 继续依赖 beat slots 和 string lines    |
| 无技巧文档发生几何或引用回归                  | 空 suppression set 返回原 systems，并保留基线测试         |

## 14. 完成定义

- 源 `ILXMDocument` 中的 Note 与技巧同时完整保留；
- `strum/arpeggio` 模型、schema、命令和 fixture 无需迁移；
- 最终 `ILXMLayout` 不包含被扫弦/琶音覆盖 Beat 的基础 fret Note layout；
- 同一 Beat 的 strum/arpeggio 合计最多一个，方向更新不会形成重叠记号；
- 技巧路径与时值几何仍使用完整 Note anchors；
- 删除技巧后 Note 无数据恢复步骤即可重新显示；
- Note 编辑会自动更新技巧跨度，并沿用既有失效级联规则；
- website 和打印不包含重复的技巧优先级算法；
- 聚焦测试、全量 test、type-check、lint、build 通过；
- 固定 A4 浏览器与打印验收通过；
- 文档中不再保留“添加技巧清空 Note”或“输入 Note 删除技巧”的旧方案。

## 15. 第二轮交互与几何 Fix

本节处理初版弦范围投影完成后发现的四个关联问题：技巧范围已经成为正式领域事实，
但时值几何、箭头终端、点击选择和工具栏应用流程还没有完整消费这层语义。

### 15.1 问题与根因

#### A. 符干仍从最低 Note 起算

`duration-beam-layout.ts` 当前在技巧布局之前执行，`stemY1` 只使用目标 Beat 的
`lowestNoteY`。当扫弦/琶音的 `maxString` 比最低 Note 更靠下时，符干会从技巧纵向
范围内部开始；技巧和符干现在又共用 Beat 的中心 X，因此两条竖向图形发生重叠。

#### B. 琶音顶端箭头依赖波浪曲线末端切线

页面使用一个 `orient="auto-start-reverse"` 的通用 SVG marker。琶音路径最后一个
二次贝塞尔控制点不保证与弦线方向严格垂直，浏览器会按末端切线旋转三角 marker，
导致上端箭头出现歪斜。仅调整 `refX/refY` 只能移动箭头，不能消除旋转误差。

#### C. 技巧命中与 TAB selection 状态分裂

点击技巧时页面只更新 `selectedTechniqueId` 并提前返回，没有更新 `selection`。
所以技巧路径正确高亮，但 selection range 和 focus caret 仍停留在上一个单元格；
工具栏后续构造草稿时也可能使用与选中技巧无关的旧 selection。

#### D. “添加”和“更新”造成不必要的删除操作

核心 `UpdateTechnique` 已允许技巧在保持同一 ID 的情况下改变判别类型，只要新草稿
通过目标与冲突规则；但页面把添加、更新拆成两个并列操作，且点击技巧后没有同步
目标 selection。用户自然会再次点击“添加技巧”，收到同 Beat 独占槽位冲突，然后
只能先删再加。

### 15.2 符干的技巧感知锚点

符干仍属于 duration layout，页面不得根据技巧再移动 SVG。推荐在核心 layout 内增加
一个最终几何协调步骤：技巧 segment 创建完成后、fret visibility projection 之前，
按照 Beat 技巧范围修正 `durationMarks[].stemY1`。

```text
noteBottomY      = 目标 Beat 全部源 Note 的最大 Y
techniqueBottomY = 同 Beat strum/arpeggio 的 maxString 弦线 Y
effectiveBottomY = max(noteBottomY, techniqueBottomY)
stemY1           = effectiveBottomY + LXM_DURATION_STEM_NOTE_GAP
```

规则说明：

- 没有扫弦/琶音时，符干几何与现有基线完全一致；
- 有技巧时至少从选定范围的最下方弦线以下开始，不能穿过技巧路径；
- 若范围外仍有更靠下的可见 Note，则继续使用该 Note 的 Y，不能让符干反向缩短；
- `stemX`、`stemY2`、beam、flag、dot 和 sustain mark 保持原算法；
- 同 Beat 最多一个 strum/arpeggio，因此不需要合并多个技巧范围；非法重复输入仍可
  防御性地取所有合法范围的最大 bottom Y；
- system 平移后再协调，计算必须使用最终弦线和 duration mark 坐标；
- 只复制真正改变的 measure/duration mark，不原地修改 layout。

建议把该逻辑作为 `technique-layout.ts` 的私有纯 helper，例如：

```ts
applyChordTraversalDurationProjection(systems, track.techniques)
```

最终管线调整为：

```text
完整基础 Note/时值布局
  → 技巧 anchor 和 segment
  → system 最终平移
  → 技巧感知的 stemY1 协调
  → 范围内基础品位可见性投影
  → ILXMLayout
```

### 15.3 琶音箭头使用确定性终端几何

不再让琶音箭头方向依赖波浪 path 的贝塞尔末端切线。核心 layout 应输出明确的箭头
方向与几何，页面只渲染结果。

推荐给 `ILXMTechniquePathLayout` 增加可选字段：

```ts
arrowHead?: {
  direction: "up" | "down";
  points: readonly [number, number][];
};
```

其中：

- 琶音波浪 path 本身不再设置 `markerEnd`；
- ascending 的箭头尖端固定在 `minString` 顶端，方向严格向上；
- descending 的箭头尖端固定在 `maxString` 底端，方向严格向下；
- 三角形中心轴始终与 SVG Y 轴平行，不受最后一段波浪相位影响；
- 箭头宽高使用 layout 常量，箭头完整纳入 technique visual bounds/hit bounds；
- strum 可以继续使用直线路径 marker，也可以一并切换到同一显式 arrowHead 模型；
  若只修琶音，必须用类型测试保证 strum 现有方向不回归；
- website 只把 `points` 映射为 `<polygon>`，不读取 `direction` 重新计算坐标；
- 打印与屏幕消费同一个 arrowHead layout，不允许通过 CSS 旋转修正。

相比在波浪末尾追加一小段直线，这个方案能稳定控制尖端位置、方向、包围框和命中
区域，也不会为了校正箭头而改变琶音波浪的可见长度。

### 15.4 点击技巧同步 selection 与 focus caret

技巧命中后仍先设置 `selectedTechniqueId`，同时必须把领域技巧目标映射回稳定的
`ILXMTabCellSelection`。点击坐标属于 layout 语义，不能直接传给不理解像素的编辑
模块，因此拆成两个明确步骤：layout 命中返回稳定 focus hint，编辑层再解析 selection。

```ts
hitTestTechniqueTarget(layout, point): {
  techniqueId: string;
  focusEndpoint: "start" | "end";
} | null;

resolveTechniqueSelection(
  document,
  techniqueId,
  focusEndpoint,
): ILXMTabCellSelection | null
```

首版映射规则：

- strum/arpeggio：anchor 与 focus 位于同一 Beat，分别使用 `minString/maxString`；
- layout 根据点击 Y 与技巧纵向中点返回 `start/end`，不把 SVG 坐标泄漏到编辑层；
- strum/arpeggio 的 start/end 分别对应 path 的音乐起止端，而不是固定对应较小弦号；
- 编辑层按 direction/stroke 把 start/end 转换成 `minString/maxString` 的 focus/anchor；
- 因此 selection range 始终覆盖完整技巧弦范围，focus caret 落在离点击点最近的范围
  端点，不会继续停留在旧 Beat；
- pickStroke：返回其 Beat 的单音弦折叠 selection；
- Note 级技巧：返回 `fromNoteId` 所在单元格；连接技巧默认 focus 为被点击 segment
  对应的近端，无法区分时使用 `fromNoteId`；
- Beat 区间技巧：selection 覆盖 from/to Beat，弦范围沿用当前产品定义；本次至少保证
  strum/arpeggio，其他类型可在同一 helper 中逐步补齐，但不能返回错误旧 selection；
- 解析失败时清空旧 selection 并保留技巧高亮，同时给出可诊断错误，不能静默显示
  一个无关 focus caret。

页面事件顺序变为：

```text
hitTestTechnique
  → setSelectedTechniqueId
  → 使用 focusEndpoint 调用 resolveTechniqueSelection
  → setSelection
  → 清理拖动状态与错误
```

selection range 和 focus caret 仍使用现有 `layoutTabCellSelection`、
`layoutTabCellCaret`，不新增第二套技巧专用蓝框。技巧路径高亮表达“选中了哪个实体”，
selection/caret 表达“该实体当前作用在哪个可编辑 TAB 位置”。

### 15.5 原子替换技巧，不要求先删后加

不把“删除旧技巧 + 添加新技巧”组合在页面或 store 中，否则会产生两个 revision、
两个历史项，并可能在第二步失败后只留下删除结果。

采用现有 `UpdateTechnique` 作为唯一原子替换 seam：

- 未选中技巧时，“应用技巧”执行 `AddTechnique`；
- 已选中技巧时，同一个“应用技巧”按钮执行 `UpdateTechnique`，保留 technique ID；
- 新类型、新方向、新 Beat 和新弦范围全部来自当前控件与同步后的 selection；
- update 校验时继续排除自身，然后执行完整目标、参数与其他技巧冲突校验；
- 新草稿合法则一次提交替换，documentRevision 只增加 1，history 只增加 1；
- 新草稿非法则原技巧、ID、selection 和 history 全部不变，只显示领域错误；
- 等值应用继续是 no-op，不增加 revision/history；
- 同 Beat 的 strum ↔ arpeggio、方向变化、弦范围变化均可直接替换；
- 替换为需要不同目标形态的技巧，例如 strum → bend，只有当前 focus 单元格存在
  合法 Note 时才成功；规则不因“替换”而放宽。

工具栏交互建议合并“添加技巧”和“更新选中”为一个主按钮：

```text
未选技巧：添加技巧
已选技巧：应用更改
```

“删除技巧”继续保留为独立的显式破坏操作。选中技巧时，控件应同步显示其当前类型、
方向和其他参数；同步只在 `selectedTechniqueId` 改变时发生，不能覆盖用户随后正在
编辑但尚未应用的表单值。

### 15.6 预计修改范围

```text
packages/lxm-editor/src/layout/
  technique-layout.ts          # stem 最低锚点协调、显式琶音箭头几何与 bounds
  layout-types.ts              # arrowHead 最终几何类型
  hit-test.ts                  # 返回 techniqueId 与稳定 focusEndpoint

packages/lxm-editor/src/editing/
  technique-selection.ts       # techniqueId → 稳定 TAB selection 的纯解析器

packages/lxm-editor/src/core/
  commands.ts                  # 复用 UpdateTechnique 原子替换，不新增 delete+add 组合

apps/website/components/EditorShell/
  index.tsx                    # 技巧点击同步 selection；渲染核心 arrowHead
  TechniqueToolbar.tsx         # 单一“添加/应用更改”流程与选中值同步

tests/
  layout/technique-layout.test.ts
  editing/technique-selection.test.ts
  core/technique-commands.test.ts
  website interaction/store tests
```

### 15.7 测试方案

#### 符干

- Note 最低弦高于 `maxString` 时，`stemY1 = maxStringY + gap`；
- 范围外存在更低 Note 时，`stemY1` 仍从该 Note 下方开始；
- strum/arpeggio 两种类型结果一致；
- 无技巧 Beat 的完整 duration layout 与基线深相等；
- stem 不与 technique path/arrowHead 的纵向可见 bounds 相交；
- compact/comfortable、system 平移及 beam group 下均保持正确。

#### 琶音箭头

- ascending 尖端 X 与 Beat X 相等，尖端 Y 位于 `minString` 顶端，中心轴垂直；
- descending 尖端位于 `maxString` 底端；
- 2～3、1～6 等短/长范围使用相同箭头尺寸，不随波浪相位倾斜；
- arrowHead 包含在 bounds 内，点击尖端仍命中同一 technique ID；
- 最终 SVG 不再给 arpeggio path 设置通用 `markerEnd`。

#### 技巧点击与 caret

- 从其他 Beat 的旧 selection 点击 strum 后，selection 切换到技巧 Beat；
- 点击上/下半部时 focus 分别落在 `minString/maxString`，range 始终覆盖全范围；
- focus caret、selection range 与技巧高亮同时存在；
- 点击技巧后立即输入单个品位，作用于新 focus，而不是旧 selection；
- 删除/undo 后失效 techniqueId 与 selection 安全回退。

#### 原子替换

- strum → arpeggio 直接成功，ID 不变、revision/history 各增加 1；
- down → up、ascending → descending、弦范围变化均直接更新；
- 非法替换返回错误且原技巧深相等；
- 等值应用为 no-op；
- 目标 Beat 已有另一个独占技巧时仍返回冲突，不能误删对方；
- undo/redo 在旧技巧与新技巧之间一次切换，不出现中间“无技巧”状态。

### 15.8 实施顺序

1. 为四个症状分别建立可独立失败的快速回归测试。
2. 实现最终 stem 协调 helper，确认不改变无技巧基线。
3. 增加显式 arpeggio arrowHead 几何、bounds 与页面纯渲染。
4. 增加 technique selection resolver，并接入技巧点击事件。
5. 合并工具栏添加/更新入口，复用原子 `UpdateTechnique` 完成替换。
6. 运行 editor/website 聚焦测试，再执行仓库级 test、type-check、lint、build。

### 15.9 第二轮完成定义

- 技巧范围比最低 Note 更靠下时，符干从技巧最下方弦线之外开始；
- 琶音上下箭头严格垂直、尖端居中且不依赖贝塞尔末端切线；
- 点击扫弦/琶音后，技巧高亮、selection range 和 focus caret 指向同一目标；
- 合法技巧替换一次完成，保留 ID，只有一个 revision 和历史项；
- 非法替换不删除原技巧；
- 屏幕、打印、命中、undo/redo 与严格 schema 均无回归。
