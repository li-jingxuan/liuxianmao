# MVP v4 技术实现方案：范围输入与安全历史

## 1. 目标与现状

MVP v3 已建立以下稳定基础：

- `ILXMDocument` 是唯一持久化乐谱状态；
- 所有写入均通过 `applyScoreCommand`；
- 每个成功候选文档都经过 schema 与音乐语义校验；
- layout 是 SVG 渲染和命中的唯一坐标来源；
- 命中目标使用稳定的 `trackId + measureId + beatId + string`；
- 单 Beat rhythm、附点、rest 和整个小节的新增、复制、删除已经可用。

当前页面仍使用单个 `activeCursor` 和 React `useState(document)`。用户只能逐格输入或删除品位，连续重复音、横向乐句和多弦块状输入需要大量重复操作，也无法撤销。

MVP v4 的目标是优先解决最高频的输入效率和误操作恢复问题：

```text
指针 / 键盘
  → 临时 TabCellSelection
  → 纯范围解析
  → note.setRect / note.removeRect
  → schema + semantic validation
  → 新 ILXMDocument
  → 单条历史记录
  → buildLayout(document)
  → selection geometry / SVG
```

本版本不实现 Beat 剪贴板。复制需求继续由已有的 `measure.copy` 覆盖完整小节；部分小节和乐句复制留到有明确使用证据后的 v4.1。

## 2. 领域 seam 与 Module 职责

v4 将三类编辑语义放在三个独立 Module 后面，避免一个“万能选区”interface 同时承载音符、时间结构和小节结构。

### 2.1 TAB 单元格编辑 Module

负责 `Beat × String` 上的 Note：

- 矩形选择；
- 批量设置相同品位；
- 批量删除选中音符；
- 弦和 Beat 方向导航。

它不修改 rhythm、tick、Beat 数量或小节结构。

### 2.2 Beat 时间编辑 Module

继续复用 v3 的单 Beat interface：

- `beat.setRhythm`；
- `beat.setKind`；
- 附点和容量处理。

v4 不增加多 Beat rhythm/rest 命令。选区包含多个 Beat 时，页面禁用这些工具，不能静默只改 focus Beat。

### 2.3 Measure 结构编辑 Module

继续复用 v3 的 interface：

- `measure.insert`；
- `measure.copy`；
- `measure.remove`。

复制整个小节直接在源小节后生成深拷贝并重建 ID，不经过系统剪贴板。选区跨越多个小节时禁用小节结构按钮，避免目标含糊。

这种 seam 划分使 TAB 单元格 Module 的 interface 保持小而深：页面只需表达一个矩形和一个操作，目标展开、rest 转换、ID 分配、不可变更新和最终校验全部隐藏在核心实现中。

## 3. 使用频率与范围决策

| 能力                     | 预计频率 | 产品价值                     | 实现风险                         | v4 决策     |
| ------------------------ | -------- | ---------------------------- | -------------------------------- | ----------- |
| 单音输入、覆盖、删除     | 很高     | 核心录入                     | 低                               | 保留        |
| 键盘导航与矩形选择       | 很高     | 减少重复定位                 | 中                               | 实现        |
| 批量设置品位、删除音符   | 中高     | 重复音、和弦块和横向乐句效率 | 中                               | 实现        |
| 撤销、重做               | 很高     | 批量编辑的安全基础           | 中                               | 实现        |
| 复制整个小节             | 中高     | 重复伴奏与完整节奏型         | 低，且 v3 已有                   | 保留        |
| 单 Beat rhythm/rest      | 中等     | 时间结构和记谱完整性         | 已由 v3 解决                     | 保留        |
| Beat/乐句复制粘贴        | 中等     | 半小节 riff 与短乐句复用     | 高：容量、tick、ID、未来技巧关系 | 延后到 v4.1 |
| 多 Beat 批量 rhythm/rest | 低到中   | 特定节奏重构                 | 高且破坏性强                     | 不实现      |
| Cut 与系统剪贴板互通     | 较低     | 通用桌面习惯                 | 高                               | 不实现      |

完整小节复制可以覆盖重复伴奏、扫弦型和段落骨架，但不能长期替代半小节 riff 或短乐句复制。因此 v4 将其视为足够的阶段性方案，而不是最终剪贴板方案。

## 4. TAB 单元格选区模型

### 4.1 数据结构

```ts
interface ILXMTabCellReference {
  trackId: string;
  measureId: string;
  beatId: string;
  string: number;
}

interface ILXMTabCellSelection {
  anchor: ILXMTabCellReference;
  focus: ILXMTabCellReference;
}
```

- `anchor` 是范围起点，Shift 扩展时保持不变；
- `focus` 是当前活动单元格和两位品位输入的恢复位置；
- `systemIndex` 不进入选区，因为自动换行后它可能变化；
- `anchor === focus` 表示单单元格选择；
- 选区只允许一个 track；
- Beat 维度是文档顺序中的连续区间，可以跨 measure 和 system；
- string 维度是 `1–6` 的连续区间；
- 两个维度的笛卡尔积构成矩形选区；
- v4 不支持跳过中间 Beat、跳弦或多个互不相邻矩形。

例如 anchor 为 `Beat 2 / String 2`，focus 为 `Beat 7 / String 4`，选区包含 Beat 2–7 与 String 2–4 的全部 18 个 TAB 单元格。

### 4.2 文档顺序与范围解析

新增纯函数 Module：

```ts
interface ILXMOrderedBeat {
  trackId: string;
  measureId: string;
  measureIndex: number;
  beatId: string;
  beatIndex: number;
}

interface ILXMResolvedTabCellRange {
  trackId: string;
  beats: ILXMOrderedBeat[];
  startString: number;
  endString: number;
  cellCount: number;
}

function resolveTabCellSelection(
  document: ILXMDocument,
  selection: ILXMTabCellSelection,
): ILXMResolveTabCellSelectionResult;
```

Beat 排序固定为 `track.measures` 数组顺序，再按 beat `tick` 升序。范围解析使用端点在该顺序中的最小/最大索引以及弦号最小/最大值，因此正向、反向和对角拖动得到同一个规范矩形。

导航和选区解析不得读取 layout 的 system 分组；视觉换行只影响坐标，不改变音乐顺序。任一端点不存在、跨轨道或弦号非法时，解析失败且不修改文档。

## 5. 指针与键盘交互

### 5.1 指针行为

- 普通点击：anchor、focus 同时设置为命中的 Beat/string；
- Shift+点击：保留 anchor，将命中单元格设为 focus；
- 指针拖动：pointerdown 命中作为 anchor，后续有效命中更新 focus；
- 横向、纵向或对角拖动均形成规范矩形；
- 拖到谱面空白时保持最后一个有效 focus；
- 普通点击谱面外清空选区；
- pointer drag 使用 pointer capture，pointerup/cancel 必须清理 drag 状态。

### 5.2 键盘行为

| 输入                         | 行为                                                                   |
| ---------------------------- | ---------------------------------------------------------------------- |
| `←` / `→`                    | 单格时移到前一/后一 Beat；范围时分别折叠到起始/结束 Beat 的 focus 弦。 |
| `↑` / `↓`                    | 单格时移动到相邻弦；范围时折叠到 focus 后移动一根弦。                  |
| `Shift+←/→`                  | 保留 anchor，按文档顺序移动 focus Beat。                               |
| `Shift+↑/↓`                  | 保留 anchor，移动 focus string。                                       |
| `Escape`                     | 清除品位草稿，并把范围折叠到 focus。                                   |
| 数字 `0–24`                  | 对矩形内所有单元格设置相同品位。                                       |
| `Backspace/Delete`           | 删除矩形内所有音符。                                                   |
| `Cmd/Ctrl+Z`                 | 撤销。                                                                 |
| `Cmd/Ctrl+Shift+Z`、`Ctrl+Y` | 重做。                                                                 |

v4 不定义 Cmd/Ctrl+A、C、X、V。快捷键仅在编辑器拥有焦点，且事件目标不是 input、textarea、select 或 contenteditable 时生效。处理成功后才调用 `preventDefault()`。

两位品位输入继续使用页面草稿：输入第一位时不修改文档，最终得到合法 `0–24` 后只提交一次批量命令。范围输入完成后保留原选区，方便继续覆盖或删除。

## 6. 批量 Note 命令

### 6.1 命令 interface

```ts
interface ILXMTabCellRange {
  trackId: string;
  anchor: {
    measureId: string;
    beatId: string;
    string: number;
  };
  focus: {
    measureId: string;
    beatId: string;
    string: number;
  };
}

interface ILXMSetNotesInRectCommand {
  type: "note.setRect";
  range: ILXMTabCellRange;
  fret: number;
}

interface ILXMRemoveNotesInRectCommand {
  type: "note.removeRect";
  range: ILXMTabCellRange;
}
```

页面只传入稳定端点，不展开所有单元格。核心命令通过与 selection 相同的纯范围解析 Module 得到目标集合，形成一个小 interface 和深实现。

### 6.2 `note.setRect`

执行顺序固定为：

1. 校验 track、两个 Beat 端点、连续 Beat 区间、弦区间和 fret；
2. 遍历规范矩形中的每个 Beat/string；
3. 同弦已有 Note 时覆盖 fret；
4. 空单元格通过 document ID factory 创建 Note；
5. 目标 Beat 为 rest 时，在同一次命令内转为 notes；
6. 其他弦、rhythm、tick、chord symbol 和非目标 measure 保持不变；
7. 构造一个候选 document，只增加一次 revision；
8. 只调用一次最终结构与语义校验。

若全部目标已经是相同 fret 且没有 rest 转换，返回 `changed: false`、原 document 引用且不增加 revision。

### 6.3 `note.removeRect`

- 只删除矩形中目标 string 的 Note；
- 不删除 Beat，不改变 rhythm、tick 或其他弦；
- Beat 删除到空 notes 后仍保持 `kind: "notes"`，不自动转为 rest；
- 所有目标原本都没有 Note 时返回 `changed: false`；
- 整批操作只产生一个候选 document、一次 revision 和一次最终校验。

### 6.4 错误和原子性

新增错误码至少包括：

```ts
type ILXMScoreCommandErrorCode =
  | ExistingErrorCode
  | "INVALID_TAB_CELL_RANGE"
  | "TAB_CELL_RANGE_TOO_LARGE";
```

为避免一次误选造成主线程长时间阻塞，首版限制矩形最多 512 个单元格。超限、目标失效或任一参数非法时整次失败，document、revision、选区和历史均保持不变。

## 7. 单 Beat 与 Measure 工具规则

### 7.1 rhythm、附点和 rest

- 选区只包含一个 Beat 时启用，即使覆盖该 Beat 的多根弦也只发送一次单 Beat 命令；
- 选区跨多个 Beat 时禁用 rhythm、附点、设为 rest 和取消 rest；
- 页面不得在范围状态下静默只修改 focus Beat；
- 单 Beat 设为 rest 仍会清空该 Beat 的全部 notes，这是已有领域语义。

### 7.2 小节结构

- 选区全部位于一个 measure 时，新增、复制、删除操作该 measure；
- 选区跨多个 measure 时禁用三个小节结构按钮；
- `measure.copy` 继续深拷贝完整小节并重建 Measure、Beat、Note 和 Chord symbol ID；
- 小节操作成功后按 v3 规则恢复到稳定的相邻或原 Beat ID；
- v4 不增加小节剪贴板或多小节批量复制。

## 8. 历史 Store

### 8.1 状态和 interface

网站新增单一 editor store：

```ts
interface EditorStore {
  document: ILXMDocument;
  selection: ILXMTabCellSelection | null;
  errorMessage: string | null;
  execute(command: ILXMScoreCommand): void;
  setSelection(selection: ILXMTabCellSelection | null): void;
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
}
```

命令成功结果扩展为：

```ts
type ILXMApplyScoreCommandSuccess = {
  ok: true;
  changed: boolean;
  document: ILXMDocument;
};
```

- `changed: false` 返回原 document 引用且不增加 revision；
- 相同品位覆盖、删除不存在的音符、相同 kind/rhythm 等 no-op 不进入历史；
- 两位品位、`note.setRect`、`note.removeRect` 和 `measure.copy` 各自只产生一条历史；
- 失败命令不进入历史；
- 新编辑发生后清空 redo 分支；
- 最多保留 `HISTORY_LIMIT = 100` 条 past 快照。

### 8.2 历史内容

历史只保存 `ILXMDocument`：

- selection、hover、pointer drag；
- scroll、focus 和弹窗；
- `fretDraft` 与计时器；
- error message；
- layout 派生结果

均不进入历史。

若使用 zundo：

- `partialize` 只返回 `{ document }`；
- `limit` 使用 `HISTORY_LIMIT`；
- command 失败或 `changed: false` 时不得调用 document setter；
- undo/redo 后重新验证 selection；端点仍存在则保留，否则折叠到首个合法单元格；
- layout 继续由 React 根据 document 派生，不存入 store。

Undo/redo 恢复历史快照本身，包括当时的 `documentRevision`。未来 v7 的未保存状态使用独立保存基线，不能只比较 revision。

## 9. Module 与文件布局

```text
packages/lxm-editor/src/
  editing/
    tab-cell-selection.ts    # Beat 顺序、矩形归一化与范围解析
    navigation.ts            # 上下左右与 Shift 扩展的纯函数
  core/
    commands.ts              # note.setRect / note.removeRect
    id-factory.ts            # 批量新增 Note ID
    semantic-validation.ts   # 最终语义守卫
  layout/
    selection-layout.ts      # 将单元格矩形映射为跨 system SVG 几何

apps/website/
  stores/editor-store.ts     # document、command dispatch、undo/redo
  components/EditorShell/    # 指针、键盘与 SVG 装配
  components/EditorToolbar/  # 单 Beat/Measure 工具状态、undo/redo
```

约束：

- `editing/*` 不依赖 React、DOM、Zustand 或 layout；
- `commands.ts` 不接收 SVG 坐标或浏览器事件；
- selection layout 只消费 layout 和规范化选区，不修改 document；
- store 不计算 tick、ID、范围展开、容量或布局；
- `EditorShell` 不循环调用多个 `note.set` 模拟批量编辑；
- Zustand/zundo 若采用，应放在 website 依赖中，不让核心包承担 UI 状态管理。

## 10. 选区布局与渲染

新增纯 layout helper：

```ts
interface ILXMTabCellSelectionRect {
  systemIndex: number;
  measureId: string;
  beatIds: string[];
  startString: number;
  endString: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

function layoutTabCellSelection(
  layout: ILXMLayout,
  selection: ILXMResolvedTabCellRange,
): ILXMTabCellSelectionRect[];

function layoutTabCellCaret(
  layout: ILXMLayout,
  focus: ILXMTabCellReference,
): ILXMTabCellCaretLayout | null;
```

- 每个 measure/system 生成独立矩形，不能跨换行连接；
- X 使用最终 beat slot 起止边界；
- Y 使用选中首尾弦的最终 layout 坐标与命中高度；
- focus 单元格额外渲染更强的 caret；规范范围为保证正反向等价不保存 focus 方向，因此 caret 必须单独接收原始 `focus` 稳定引用，不能从范围末端猜测；
- 高亮层位于音乐元素下方并设置 `pointer-events: none`；
- React 不根据 tick、弦距或数组下标重新推导几何；
- 高亮不改变谱面尺寸，并在打印样式中隐藏。

## 11. 测试策略

### 11.1 核心单元测试

- `tab-cell-selection.test.ts`：单格、横向、纵向、对角、反向、跨小节、跨 system 数据顺序、失效端点、跨轨道和 512 单元格上限；
- `navigation.test.ts`：弦边界、Beat 边界、跨小节、Shift 四方向扩展、范围折叠和无相邻项；
- `commands.test.ts`：矩形新增/覆盖、rest 自动转 notes、其他弦保持、矩形删除、空 notes 不转 rest、跨小节、原子失败、不可变性、revision 和 no-op；
- `selection-layout.test.ts`：单格、同 measure、跨 measure、跨 system、compact、comfortable、稀疏末行与 layout 重建。

### 11.2 Store 测试

- 成功命令新增一条历史；失败/no-op 不新增；
- 两位品位、矩形设置、矩形删除、小节复制各一条；
- undo/redo 恢复等价 document 和 layout；
- undo 后新编辑清空 redo；
- 超过 100 条只保留最近历史；
- selection/error/scroll 变化不增加历史；
- undo/redo 后 selection 恢复规则正确。

### 11.3 浏览器验收

- 点击、Shift+点击和水平/纵向/对角拖动形成正确矩形；
- 选区跨弦、Beat、小节和两条 system；
- Shift+四方向键扩展与收缩，普通方向键按规则折叠；
- 输入一位和两位品位后所有目标单元格一次更新；
- 删除只影响选中弦，其他弦、rhythm 和 tick 不变；
- 多 Beat 范围时 rhythm/rest 与小节结构工具正确禁用；
- 单 Beat 和单 measure 时原有工具仍可用；
- 连续执行输入、删除、小节复制后逐步 undo/redo；
- 控制台无 error/warning，无非预期页面滚动，打印预览不显示选区。

## 12. 完成定义

MVP v4 仅在以下条件全部满足后完成：

- 单格及二维矩形选区均使用稳定业务 ID，可跨弦、Beat、小节和 system；
- 所有导航和范围解析独立于视觉换行；
- 批量设置品位和删除音符均为单个原子领域命令；
- 批量 Note 编辑不修改未选中弦、rhythm、tick 或小节容量；
- 单 Beat rhythm/rest 与完整小节复制能力无回归；
- 所有持久化变更可稳定 undo/redo，临时 UI 状态不进入历史；
- `pnpm test`、`pnpm type-check`、`pnpm lint`、`pnpm build` 全部通过；
- 固定桌面视口完成真实浏览器指针、键盘和历史验收；
- 实际范围调整、已知限制和用户确认结果已回写文档。

## 13. 已知限制与 v4.1 候选

v4 已知限制：

- 只支持当前单轨，仍沿用 layout 的第一轨道策略；
- 只支持连续矩形，不支持非连续多选；
- 不支持多 Beat 批量 rhythm、附点或 rest；
- 不支持 Beat/乐句复制、剪切、粘贴和系统剪贴板；
- 小节复制只支持一个完整 measure；
- 历史只存在于当前页面会话，刷新后不恢复；
- 移动端手势留到 MVP 之后评估。

候选 v4.1 只在实际试用确认部分小节重复录入是主要瓶颈后启动。其范围应单独定义完整 Beat payload、覆盖式或插入式粘贴、容量规则、跨小节策略、ID 重建以及未来技巧关系，不在 v4 选区 Module 中预埋剪贴板分支。
