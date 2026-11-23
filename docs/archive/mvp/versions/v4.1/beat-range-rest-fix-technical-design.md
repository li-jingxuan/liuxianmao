# MVP v4.1 Fix：框选 Beat 快捷设置与取消休止技术方案

## 1. 问题说明

MVP v4 已经支持按文档顺序框选连续 Beat，并允许选区跨小节、跨 system；但休止工具仍沿用
v3 的单 Beat 命令：

- 核心只有 `beat.setKind`，一次只能修改一个 Beat；
- 页面在选区包含多个 Beat 时禁用“休止”和“恢复”；
- 键盘入口只覆盖导航、品位输入、删除音符与撤销/重做，没有休止快捷键。

因此，用户虽然能框选一段节奏，却必须逐 Beat 设置或取消休止。本 Fix 在不改变持久化 schema、
Beat 数量、tick 和 rhythm 的前提下，增加一个原子的 Beat 范围命令，并把工具栏与谱面快捷键接入
同一命令。

目标数据流：

```text
TabCellSelection
  → 提取稳定的首尾 Beat 引用
  → beat.setKindRange
  → 核心按文档顺序解析连续 Beat
  → 一次性设置 kind / 清理 notes
  → schema + semantic validation
  → 单条历史记录
  → selection 保持 + 自动重新 layout
```

## 2. 产品语义

### 2.1 操作对象是 Beat，不是选中的弦单元格

当前矩形选区同时包含 Beat 维度和 string 维度。休止符属于 Beat，因此操作只取选区的连续 Beat
区间，忽略框选了哪几根弦。

例如用户只框选 Beat 2–4 的第 3 弦，执行“设为休止”仍会把 Beat 2–4 整体设为休止，并清空
这些 Beat 上所有弦的音符。工具提示和 `aria-label` 必须明确写出这一点，不能让用户误以为休止符
可以只作用于某根弦。

### 2.2 “设为休止”与“取消休止”

两项操作使用显式的目标状态，不采用“根据混合选区猜测后切换”的 toggle：

| 操作     | 目标结果                                       | 混合选区行为                       |
| -------- | ---------------------------------------------- | ---------------------------------- |
| 设为休止 | 每个目标 Beat 变为 `kind: "rest"`、`notes: []` | notes 与 rest Beat 全部归一为 rest |
| 取消休止 | rest Beat 变为 `kind: "notes"`、`notes: []`    | 已是 notes 的 Beat 原样保留        |

设为休止会清除 Beat 上所有音符，这是既有 `beat.setKind` 的领域语义。取消休止只取消 rest 状态，
不会恢复之前被清除的 Note。模型不增加隐藏音符备份；用户需要恢复原音符时使用撤销。这样可以避免
文档中同时存在“可见音符”和“休止前快照”两套互相失真的数据源。

### 2.3 快捷键

谱面 SVG 拥有焦点且存在合法选区时：

| 快捷键    | 行为     |
| --------- | -------- |
| `R`       | 设为休止 |
| `Shift+R` | 取消休止 |

约束：

- `Cmd/Ctrl/Alt + R` 不由编辑器接管，避免覆盖浏览器刷新和系统快捷键；
- input、textarea、select、contenteditable 中不处理；
- Toolbar 持有焦点时不触发，避免用户按字母选择原生控件时误改谱面；
- 合法选区下命令已被识别时才 `preventDefault()`；
- 执行前取消等待中的两位品位草稿，防止旧草稿随后覆盖休止状态；
- 命令成功后保留原选区，方便连续设置、取消或撤销。

不使用单键 toggle，因为混合选区没有唯一、可见且稳定的“相反状态”；显式的 `R` / `Shift+R`
也更容易测试和形成肌肉记忆。

## 3. 范围模型与 Module 边界

### 3.1 新增 Beat 范围引用

核心命令不接收 string，也不直接复用 `ILXMTabCellRange`：

```ts
export interface ILXMBeatReference {
  measureId: string;
  beatId: string;
}

export interface ILXMBeatRange {
  trackId: string;
  anchor: ILXMBeatReference;
  focus: ILXMBeatReference;
}
```

这样 command interface 准确表达“连续 Beat”，不会把无效的弦范围泄漏进领域语义，也不会使
Beat 命令的合法性意外依赖矩形宽度。

### 3.2 抽取共享的 Beat 顺序解析

现有 `tab-cell-selection.ts` 已通过 `buildOrderedBeatIndex(track)` 定义稳定顺序。建议抽取或在同一
editing Module 中补充一个纯函数：

```ts
export type ILXMResolveBeatRangeResult =
  | { ok: true; range: { trackId: string; beats: ILXMOrderedBeat[] } }
  | {
      ok: false;
      code: "INVALID_BEAT_RANGE" | "BEAT_RANGE_TOO_LARGE";
      message: string;
    };

export const resolveBeatRange = (
  document: ILXMDocument,
  range: ILXMBeatRange,
): ILXMResolveBeatRangeResult;
```

解析规则：

1. 使用 `trackId` 找到唯一轨道；
2. 按 measure 数组顺序，再按 Beat tick 升序建立索引；
3. 通过 `measureId + beatId` 定位两个端点；
4. 取两端 index 的最小值和最大值，得到与拖动方向无关的连续 Beat；
5. 不读取 layout、systemIndex 或当前坐标；
6. 首版限制最多 512 个 Beat，超过时返回 `BEAT_RANGE_TOO_LARGE`。

`resolveTabCellSelection` 可继续负责弦号与 512 单元格上限，但其 Beat 维度应复用同一内部索引/切片
实现，防止 Note 矩形命令与休止范围命令产生不同的跨小节顺序。

## 4. 领域命令

### 4.1 Command interface

```ts
export interface ILXMSetBeatKindRangeCommand {
  type: LXMScoreCommandEnum.SetBeatKindRange;
  range: ILXMBeatRange;
  kind: ILXMBeat["kind"];
}

export enum LXMScoreCommandEnum {
  // existing commands
  SetBeatKindRange = "beat.setKindRange",
}
```

`ILXMScoreCommand` 加入该命令。新增错误码：

```ts
type ILXMScoreCommandErrorCode =
  | ExistingErrorCode
  | "INVALID_BEAT_RANGE"
  | "BEAT_RANGE_TOO_LARGE";
```

保留既有 `beat.setKind`，避免无关调用方迁移；单 Beat 工具未来可以统一改发范围命令，但不是本 Fix
的强制前置项。

### 4.2 原子更新算法

建议新增深函数 `setBeatKindInRange(document, command)`：

1. 先调用 `resolveBeatRange` 完整验证 track、端点和范围大小；
2. 将解析出的 Beat ID 按 measure 分组；
3. 只复制命中目标的 track、measure 和发生变化的 Beat 分支；
4. 目标为 `rest` 时，仅当 Beat 不是空 rest 才替换为
   `{ ...beat, kind: "rest", notes: [] }`；
5. 目标为 `notes` 时，仅把 rest 替换为 `{ ...beat, kind: "notes" }`；既有 notes Beat 和 Note 引用
   保持不变；
6. 所有目标已经达到目标状态时返回 `changed: false`、原 document 引用和原 revision；
7. 有变化时只增加一次 `documentRevision`，并只调用一次 schema 与 semantic validation；
8. 任一解析或最终校验失败时不暴露部分修改。

命令不得修改：

- Beat ID、tick、rhythm 或 Beat 数量；
- measure 的拍号、和弦标记和小节线；
- 非目标 Beat、其他 track；
- selection、layout 或历史状态。

由于范围只改变 Beat 内容而不改变时间结构，跨小节和跨 system 不需要容量协调，也不会触发
`rhythm-change.ts` 的后续 Beat 压缩逻辑。

## 5. Store、选区与历史

- website 只发送一条 `beat.setKindRange`，不得对选中 Beat 循环调用 `beat.setKind`；
- 一次范围修改形成一条 history，单次 undo/redo 恢复整个范围；
- no-op 或失败不增加 history，并清理/展示错误时遵循现有 `execute` 规则；
- 命令不删除 Beat，因此 `selection.anchor`、`selection.focus` 始终保持有效，无需新增 Store 回退分支；
- layout 在 document 更新后正常重算 rest glyph、符干和连梁；页面不手工增删 SVG 休止符；
- 撤销可恢复“设为休止”前被清除的 Note，这是恢复原音符的唯一可靠途径。

## 6. 页面接入

### 6.1 工具栏

将现有 `canEditSingleBeat` 的休止限制拆开：

- rhythm 和附点按钮继续只允许单 Beat；
- “休止”和“恢复”按钮改为 `resolvedSelection.beats.length > 0` 时可用；
- 两个按钮都从 `selection.anchor/focus` 提取 Beat 端点并提交一条范围命令；
- “休止”的可访问名称为“将选中 Beat 设为休止并清空全部弦音符”；
- “恢复”的可访问名称为“取消选中 Beat 的休止状态”；
- 可选用 `aria-pressed` 表示全选区是否均为对应状态；混合状态不改变命令语义。

页面 helper 建议保持纯组装：

```ts
const toSelectedBeatRange = (
  selection: ILXMTabCellSelection,
): ILXMBeatRange => ({
  trackId: selection.anchor.trackId,
  anchor: {
    measureId: selection.anchor.measureId,
    beatId: selection.anchor.beatId,
  },
  focus: {
    measureId: selection.focus.measureId,
    beatId: selection.focus.beatId,
  },
});
```

### 6.2 键盘解析

在 `editor-interaction.ts` 增加可独立测试的纯函数：

```ts
type BeatKindShortcutAction = "setRest" | "unsetRest";

resolveBeatKindShortcut({ key, metaKey, ctrlKey, altKey, shiftKey });
// R       => setRest
// Shift+R => unsetRest
// modifiers / other keys => null
```

`handleScoreKeyDown` 在方向键、Escape 之后、Backspace/Delete 和数字输入之前解析休止快捷键。识别后
调用现有 `runImmediateEditorAction`，保证品位草稿被取消。`R` 不是品位数字，不影响两位品位输入
的既有提交规则。

## 7. 测试方案

### 7.1 核心命令测试

新增 `packages/lxm-editor/tests/core/beat-kind-range-commands.test.ts`，至少覆盖：

- 单 Beat、同小节多 Beat、跨小节和反向端点；
- 设为休止会清空每个目标 Beat 的全部 Note，但保留 ID/tick/rhythm；
- 取消休止产生空 notes Beat，不虚构或恢复旧 Note；
- 混合 notes/rest 选区按显式目标状态归一；
- 非目标 Beat/measure/track 引用保持不变；
- 成功只增加一次 revision；
- 全部目标已是目标状态时为 no-op 且保留根引用；
- track 或端点不存在、跨轨道构造、超限范围时原子失败；
- 结果通过结构和语义校验，输入 document 未被修改。

### 7.2 Store 测试

- 多 Beat 命令只增加一条 past history；
- undo 一次恢复所有被清除 Note，redo 一次重新设置休止；
- selection 在执行、undo、redo 后保持原端点和弦号；
- no-op/失败不改变历史深度。

### 7.3 页面交互测试

- `R`、`Shift+R` 的纯快捷键解析；
- 大小写 `event.key` 归一化；
- Cmd/Ctrl/Alt 修饰时返回 null；
- 已框选多 Beat 时休止/恢复按钮可用，rhythm/附点仍禁用；
- 快捷操作会取消待提交品位草稿；
- 无选区、文本输入目标或 Toolbar 焦点下不会改谱。

### 7.4 回归检查

```bash
pnpm test
pnpm type-check
pnpm lint
pnpm build
```

浏览器手工验收至少包含：横向框选、对角框选、跨小节、跨 system、混合 rest/notes、撤销/重做，
以及操作后休止字形、符干、连梁和选框仍与同一 Beat 时间锚点对齐。

## 8. 实施顺序与验收标准

建议按以下顺序落地：

1. 抽取 `ILXMBeatRange` 与纯范围解析，并补齐正反向/跨小节测试；
2. 实现 `beat.setKindRange`、no-op、不可变更新与错误码；
3. 增加核心命令和 Store 历史测试；
4. 将两个现有休止按钮从单 Beat 限制改为任意合法 Beat 范围；
5. 实现 `R` / `Shift+R` 纯快捷键解析并接入 score SVG；
6. 完成全量自动化与浏览器验收。

完成标准：用户框选一个或多个连续 Beat 后，可以通过工具栏或 `R` / `Shift+R` 一次性设置或取消
休止；该动作跨小节、跨 system 仍原子生效，只产生一条历史，撤销可完整恢复被清除的原音符，且
不改变 Beat 的时间结构和当前选区。

## 9. 非范围

- 恢复休止前音符的隐藏快照；
- 自动在取消休止后生成默认品位或 Note；
- 只对某根弦设置休止、多声部休止或跨轨道范围；
- 批量修改 rhythm、附点、tick 或 Beat 数量；
- 不连续 Beat、多矩形选区、Beat 复制粘贴；
- 移动端触控快捷入口和全局快捷键自定义。
