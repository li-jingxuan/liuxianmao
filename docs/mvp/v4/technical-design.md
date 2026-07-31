# MVP v4 技术实现方案：高频编辑效率

## 1. 目标与现状

MVP v3 已建立以下稳定边界：

- `ILXMDocument` 是唯一持久化乐谱状态；
- 所有写入均通过 `applyScoreCommand`；
- 每个成功候选文档都经过 schema 与音乐语义校验；
- layout 是 SVG 渲染和命中的唯一坐标来源；
- 命中目标使用稳定的 `trackId + measureId + beatId + string`。

当前页面仍使用单个 `activeCursor` 和 React `useState(document)`。它只能操作一个 Beat 的一根弦，不具备连续选区、批量命令、剪贴板或历史。

MVP v4 的目标是把这条单点链路扩展为日常可用的高频编辑闭环，同时保持核心包与页面层的既有职责：

```text
指针 / 键盘
  → 临时 EditorSelection
  → 纯导航与选区解析
  → 单个领域命令
  → schema + semantic validation
  → 新 ILXMDocument
  → 单条历史记录
  → buildLayout(document)
  → selection geometry / SVG
```

## 2. 核心产品决策

### 2.1 选择单位是连续 Beat，弦是活动输入位置

v4 不引入任意二维单元格框选。选区由两个 Beat 端点和一个活动弦组成：

```ts
interface ILXMBeatReference {
  trackId: string;
  measureId: string;
  beatId: string;
}

interface ILXMEditorSelection {
  anchor: ILXMBeatReference;
  focus: ILXMBeatReference;
  activeString: number;
}
```

- `anchor` 是范围起点，Shift 扩展时保持不变；
- `focus` 是当前活动 Beat；
- `activeString` 是品位输入和上下导航所在弦；
- `systemIndex` 不进入选区，因为自动换行后它可能变化；
- `anchor === focus` 表示折叠选区，但当前 Beat 仍有可见列高亮；
- 范围始终是当前轨道文档顺序中的连续 Beat 集合，可以跨 measure 和 system；
- v4 的“全选”指当前轨道全部 Beat，不跨轨道。

Beat 同时拥有 rhythm、kind、notes 和 tick。以 Beat 为选择单位可以让复制、休止和容量校验使用同一领域边界，避免页面拼接部分 Beat 状态。

### 2.2 文档顺序独立于视觉换行

新增纯函数索引：

```ts
interface ILXMOrderedBeat {
  trackId: string;
  measureId: string;
  measureIndex: number;
  beatId: string;
  beatIndex: number;
}

function buildOrderedBeatIndex(
  document: ILXMDocument,
  trackId: string,
): ILXMOrderedBeat[];

function resolveSelection(
  document: ILXMDocument,
  selection: ILXMEditorSelection,
): ILXMResolvedSelectionResult;
```

排序规则固定为 `track.measures` 数组顺序，再按 beat `tick` 升序。导航与范围解析不得读取 layout 的 system 分组；视觉换行只影响坐标，不改变音乐顺序。

若任一端点不存在、端点不属于同一轨道或活动弦不在 `1–6`，解析失败且不修改选区或文档。

### 2.3 删除和剪切不删除时间位置

- 折叠选区上的 `Backspace/Delete` 保持 v2/v3 习惯：只删除 `activeString` 上的音符；
- 展开范围上的 `Backspace/Delete` 将所有选中 Beat 转为等时值 rest，保留 Beat ID、tick 和 rhythm；
- Cut 始终以完整 Beat 范围为单位：先写入剪贴板，再以一次批量命令把范围转为 rest；
- 范围清除不删除 Beat，也不改变小节容量和后续 tick。

这一规则区分了“当前弦删除”和“选区清空”，同时避免 Delete 被误解为删除小节或压缩时间轴。

### 2.4 粘贴是等数量 Beat 的原子替换

粘贴目标按以下规则解析：

1. 折叠选区：从 focus 开始取得与剪贴板相同数量的连续目标 Beat；
2. 展开选区：目标 Beat 数必须与剪贴板 Beat 数相等；
3. 目标越过轨道末尾、数量不匹配或引用失效时拒绝；
4. 将源 Beat 按顺序一对一映射到目标 Beat；
5. 对每个受影响 measure，源 rhythm 总 ticks 必须等于被替换目标 rhythm 总 ticks；
6. 满足等时长后，在选区内部重新计算 tick；选区之后的 Beat tick 保持不变；
7. 所有粘贴 Beat 和 Note 使用 ID factory 生成新 ID；
8. 构造完整候选文档并执行 schema 与 semantic validation；任一步失败都返回原文档。

等数量与逐小节等时长约束是 v4 的保守容量策略。它允许在相同总时长内粘贴不同节奏组合，但不会隐式压缩选区之外的真实音符。未来若需要插入式粘贴，应单独设计时间插入和跨小节重分配规则。

Chord symbol 不属于 v4 剪贴板；它仍保留在原 tick，不随 Beat 范围复制或清除。

### 2.5 历史只记录成功且实际改变文档的命令

历史状态只包含 `ILXMDocument` 快照：

```ts
interface ILXMEditorDocumentState {
  document: ILXMDocument;
}
```

以下状态不进入历史：

- selection、hover 和 pointer drag；
- scroll、focus 和弹窗；
- `fretDraft` 与计时器；
- error message 与 clipboard cache；
- layout 派生结果。

命令成功结果扩展为：

```ts
type ILXMApplyScoreCommandSuccess = {
  ok: true;
  changed: boolean;
  document: ILXMDocument;
  selectionHint?: {
    trackId: string;
    anchor: { measureId: string; beatId: string };
    focus: { measureId: string; beatId: string };
  };
};
```

- `changed: false` 必须返回原 document 引用且不增加 revision；
- 相同品位覆盖、删除不存在的音符、相同 kind/rhythm 等 no-op 不进入历史；
- 两位品位草稿只在最终提交一次 `note.set` 时记录；
- paste、cut 和范围清除各自是一个命令和一条历史；
- 失败命令不进入历史；
- 新编辑发生后清空 redo 分支；
- 最多保留 `HISTORY_LIMIT = 100` 条 past 快照。

Undo/redo 恢复历史快照本身，包括当时的 `documentRevision`。未保存状态不能仅比较 revision；v7 保存功能应使用独立的保存基线标识。

## 3. 模块边界

```text
packages/lxm-editor/src/
  editing/
    selection.ts             # Beat 顺序索引、范围归一化与端点恢复
    navigation.ts            # 上下左右与 Shift 扩展的纯函数
    clipboard-schema.ts      # LXM clipboard 运行时 schema 与 codec
  core/
    commands.ts              # range.clear / range.paste 原子领域命令
    id-factory.ts            # 粘贴实体 ID 重建
    semantic-validation.ts   # 继续作为最终语义守卫
  layout/
    selection-layout.ts      # 将 Beat ID 集合映射为跨 system 高亮矩形

apps/website/
  stores/editor-store.ts     # document、command dispatch、undo/redo
  components/EditorShell/    # 指针、键盘、剪贴板事件与 SVG 装配
  components/EditorToolbar/  # 撤销/重做及 disabled 状态
```

约束：

- `editing/*` 不依赖 React、DOM、Zustand 或浏览器剪贴板；
- `commands.ts` 不接收 layout 坐标或 UI 事件；
- `selection-layout.ts` 只消费 layout 和已解析 Beat ID，不读取 document；
- store 不计算 tick、ID、容量或布局；
- `EditorShell` 不循环调用单点命令模拟批量编辑；
- Zustand/zundo 若采用，应放在 website 依赖中，不让核心包承担 UI 状态管理。

## 4. 选区与导航契约

### 4.1 指针行为

- 普通点击：anchor、focus 同时设置为命中 Beat，并更新 activeString；
- Shift+点击：保留 anchor，只更新 focus 和 activeString；
- 按下并拖动：首个命中作为 anchor，后续有效命中更新 focus；
- 拖到谱面空白：保持最后一个有效 focus，不清空已有选区；
- 普通点击谱面外：清空选区；
- pointer drag 使用 pointer capture，pointerup/cancel 必须清理 drag 状态。

### 4.2 键盘行为

| 输入                         | 行为                                                         |
| ---------------------------- | ------------------------------------------------------------ |
| `←` / `→`                    | 移到前一/后一 Beat，跨小节连续导航；无相邻 Beat 时保持不变。 |
| `↑` / `↓`                    | 在 1–6 弦之间移动；到边界后保持不变。                        |
| `Shift+←/→`                  | 保留 anchor 并移动 focus，从而扩展或收缩范围。               |
| `Escape`                     | 清除品位草稿；展开选区折叠到 focus，已折叠时清除错误提示。   |
| `Cmd/Ctrl+A`                 | 选择当前轨道全部 Beat。                                      |
| `Backspace/Delete`           | 折叠时删除当前弦音符；展开时执行 `range.clear`。             |
| `Cmd/Ctrl+C/X/V`             | 复制、剪切、粘贴。                                           |
| `Cmd/Ctrl+Z`                 | 撤销。                                                       |
| `Cmd/Ctrl+Shift+Z`、`Ctrl+Y` | 重做。                                                       |

快捷键仅在编辑器拥有焦点，且事件目标不是 input、textarea、select 或 contenteditable 时生效。处理成功后才调用 `preventDefault()`；无可执行目标时提供可读提示。

纯导航函数返回新 selection 或明确失败，不直接滚动页面。页面在 selection 改变后根据 selection layout 让 focus 高亮进入可视区域；滚动不进入历史。

## 5. 剪贴板数据协议

### 5.1 数据结构

```ts
interface ILXMClipboardPayloadV1 {
  schema: "lxm-tab-clipboard";
  version: 1;
  beats: Array<{
    rhythm: ILXMRhythm;
    kind: ILXMBeatKind;
    notes: Array<{
      string: number;
      fret: number;
    }>;
  }>;
}
```

载荷不包含：实体 ID、tick、measureId、trackId、systemIndex、chord symbols 或 UI 状态。

新增 `LXMClipboardPayloadSchema`：

- beats 至少一个；
- rhythm 必须可计算；
- rest 不允许 notes；
- 同 Beat 不允许重复 string；
- string 为 `1–6`，fret 为 `0–24`；
- payload 设置合理大小上限，例如 512 Beat，避免异常剪贴板阻塞主线程。

### 5.2 浏览器适配

页面使用 ClipboardEvent 的 `clipboardData`：

- 自定义 MIME：`application/x-lxm-tab+json`；
- 同时写入 `text/plain`，用于调试和可读降级；
- 当前会话保存最后一份已验证 payload，作为不支持自定义 MIME 时的内部降级；
- 外部普通文本不在 v4 解析为 TAB，粘贴时返回“剪贴板中没有可用的六线谱片段”；
- Copy 不修改文档和历史；Cut 仅在 clipboard 写入成功后执行范围清除。

## 6. 批量命令

新增命令：

```ts
interface ILXMClearRangeCommand {
  type: "range.clear";
  trackId: string;
  beatIds: string[];
}

interface ILXMPasteRangeCommand {
  type: "range.paste";
  trackId: string;
  targetBeatIds: string[];
  payload: ILXMClipboardPayloadV1;
}
```

命令不直接接收 `ILXMEditorSelection`，而接收页面通过公开纯函数解析后的、顺序稳定的 Beat ID。核心命令仍需重新验证：

- ID 非空、唯一且严格按文档顺序连续；
- 所有 Beat 位于目标 track；
- paste 的目标数量等于 payload 数量；
- 每个受影响 measure 的源/目标总 ticks 相等；
- 生成的新 ID 与整个 document 不冲突；
- 最终文档结构与语义合法。

`range.clear` 保留 Beat ID；`range.paste` 重建被替换 Beat 与所有 Note ID，并返回指向新 Beat ID 的 `selectionHint`。

新增错误码至少包括：

```ts
type ILXMScoreCommandErrorCode =
  | ExistingErrorCode
  | "INVALID_BEAT_RANGE"
  | "CLIPBOARD_INVALID"
  | "PASTE_TARGET_COUNT_MISMATCH"
  | "PASTE_DURATION_MISMATCH"
  | "PASTE_TARGET_OUT_OF_RANGE";
```

## 7. 历史 Store

网站新增单一 editor store：

```ts
interface EditorStore {
  document: ILXMDocument;
  selection: ILXMEditorSelection | null;
  errorMessage: string | null;
  execute(command: ILXMScoreCommand): void;
  setSelection(selection: ILXMEditorSelection | null): void;
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
}
```

若使用 zundo：

- `partialize` 只返回 `{ document }`；
- `limit` 使用 `HISTORY_LIMIT`；
- command 失败或 `changed: false` 时不得调用 document setter；
- 命令成功后，页面将 `selectionHint` 与当前 `activeString` 组合为新 selection；
- undo/redo 后重新校验 selection，端点仍存在则保留，否则折叠到首个合法 Beat；
- layout 继续由 React 根据 document `useMemo` 派生，不存入 store。

Toolbar 与键盘只调用相同的 store action。页面不维护第二份 document state。

## 8. 选区布局与渲染

新增 layout helper：

```ts
interface ILXMSelectionRect {
  systemIndex: number;
  beatIds: string[];
  x: number;
  y: number;
  width: number;
  height: number;
}

function layoutSelection(
  layout: ILXMLayout,
  selectedBeatIds: readonly string[],
): ILXMSelectionRect[];
```

- 同一 system 内相邻 Beat 合并为一个矩形；
- 跨 system 生成多个矩形；
- Y/height 覆盖六根弦的可交互区域，不覆盖下方 rhythm lane；
- focus Beat 与 activeString 继续渲染更强的 caret；
- 高亮层位于谱面音乐元素下方并设置 `pointer-events: none`；
- React 不从 tick 或数组下标重算矩形。

颜色必须在打印样式中隐藏，并保持足够对比度；选区不得改变谱面实际布局尺寸。

## 9. 测试策略

### 9.1 核心单元测试

- `selection.test.ts`：顺序索引、正反范围、跨小节、失效端点、跨轨道拒绝和全选；
- `navigation.test.ts`：弦边界、Beat 边界、跨小节、Shift anchor 保持和无相邻项；
- `clipboard-schema.test.ts`：合法载荷、版本错误、非法 rhythm/rest/string/fret、重复弦和大小上限；
- `commands.test.ts`：范围清除、跨小节粘贴、新 ID、等时长不同节奏、数量/时长失败、原子性、不可变性和 no-op；
- `selection-layout.test.ts`：单 system 合并、跨 system 拆分、稀疏 system 与 layout 重建。

### 9.2 Store 测试

- 成功命令新增一条历史；失败/no-op 不新增；
- 两位品位只新增一条；paste/cut/range.clear 各一条；
- undo/redo 恢复等价文档和布局；
- undo 后新编辑清空 redo；
- 超过 100 条只保留最近历史；
- selection/error/scroll 变化不增加历史；
- undo/redo 后 selection 恢复规则正确。

### 9.3 浏览器验收

- 点击、Shift+点击和拖动选择跨越两条 system；
- 方向键跨弦、Beat 和 measure；Shift+方向键扩展与收缩；
- Copy/Cut/Paste 与系统快捷键可用，工具栏 disabled 状态正确；
- 相同总时长的不同节奏粘贴成功，不等时长粘贴失败且文档不变；
- 粘贴后新 ID 对应的选区和 hit test 正确；
- 连续执行输入、范围清除、粘贴、小节操作后逐步 undo/redo；
- 控制台无 error/warning，无非预期页面滚动，打印预览不显示选区。

## 10. 完成定义

MVP v4 仅在以下条件全部满足后完成：

- 单选、范围选择、跨小节选择与当前轨道全选均使用稳定 ID；
- 所有导航行为独立于 system 换行；
- 复制、剪切、粘贴和范围删除均为原子领域命令；
- 所有持久化变更可稳定 undo/redo，临时 UI 状态不进入历史；
- 粘贴不破坏 ID 唯一性、同弦冲突、tick 连续性或小节容量；
- `pnpm test`、`pnpm type-check`、`pnpm lint`、`pnpm build` 全部通过；
- 固定桌面视口完成真实浏览器快捷键、指针和剪贴板验收；
- 实际范围调整、已知限制和用户确认结果已回写文档。

## 11. 已知限制

- v4 只支持当前单轨，仍沿用 layout 的第一轨道策略；
- 粘贴采用等数量、逐小节等时长替换，不支持插入时间或自动跨小节重排；
- v4 不复制 chord symbol、歌词、技巧或未来的跨 Beat 关系；
- 系统剪贴板只保证本编辑器结构化数据，不承诺与其他制谱软件互通；
- 历史只存在于当前页面会话，刷新后不恢复；
- 非连续多选、二维弦格框选和移动端手势留给 MVP 之后评估。
