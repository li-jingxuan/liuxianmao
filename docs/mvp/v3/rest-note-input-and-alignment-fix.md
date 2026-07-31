# MVP v3 Fix：休止拍直接输入音符与时间锚点对齐

## 1. 问题说明

当前休止拍存在两个彼此独立、但都会影响直接编辑体验的问题。

### 1.1 休止拍不能直接输入音符

页面输入品位时只发送一次 `note.set`：

```ts
applyScoreCommand(document, {
  type: LXMScoreCommandEnum.SetNote,
  ...activeCursor,
  fret,
});
```

核心命令发现目标 beat 为 `kind: "rest"` 后，会直接返回：

```ts
return fail("REST_BEAT_NOT_EDITABLE", "请先取消休止，再输入音符");
```

因此用户必须先执行一次 `beat.setKind({ kind: "notes" })`，再输入品位。这个约束把
领域状态转换暴露给了用户，也让“在当前拍输入一个音符”无法成为单次编辑操作。

期望行为是：向休止拍输入合法音符时，`note.set` 自动把该 beat 从休止状态转换为音符
状态，并在同一次命令中写入音符。

### 1.2 休止符相对同拍音符偏右

音符布局使用 beat slot 的起始位置作为统一时间锚点：

```ts
x: slot.x;
```

休止符布局却使用 slot 中心：

```ts
x: slot.x + slot.width / 2;
```

两种图形在页面中都以文字中心对齐。实际偏移不是 CSS、SVG `textAnchor` 或 Bravura
字形引起的，而是核心 layout 在渲染前已经为休止符增加了半个 slot 宽度。slot 会随
时值、排版密度和 System 拉伸变化，所以偏移量也不是一个固定像素值。

## 2. 修复目标

- 在休止拍上执行一次 `note.set` 即可输入音符，不要求用户先手动取消休止。
- 自动转换和音符写入属于同一个领域命令，只产生一个新文档版本。
- 转换后的 beat 为 `kind: "notes"`，并包含本次输入的音符。
- 普通音符拍上的新增音符和同弦覆盖行为保持不变。
- 非法弦号、非法品位和目标不存在时仍然失败，且不改变休止状态。
- `beat.setKind({ kind: "rest" })` 仍然清空当前 beat 的所有音符。
- 休止符与同一 beat 的音符、光标和节奏标记共享 `slot.x` 时间锚点。
- 休止符的纵向位置、字形选择和附点表达保持不变。
- 页面只发送命令并渲染 layout 结果，不增加状态转换或坐标补偿。

## 3. 非目标

本 fix 不包含：

- 输入音符后自动修改 beat 时值；
- 删除最后一个音符后自动把 beat 转为休止符；
- 改变 `note.remove` 的重复删除语义；
- 改变 `beat.setKind` 工具栏按钮的行为；
- 修改休止符的垂直位置、字号、SMuFL glyph 或附点样式；
- 为不同休止符增加独立的视觉光学校正；
- 修改 `ILXMDocument` schema、beat ID 或 note ID 生成规则；
- 在 React 页面维护一份独立的 beat 状态机。

删除最后一个音符后的 beat 是否应自动变为休止符，是另一项产品语义。本次只处理“输入
音符覆盖休止状态”的单向转换。

## 4. 领域命令方案

### 4.1 `note.set` 负责原子取消休止

在 `packages/lxm-editor/src/core/commands.ts` 中删除休止拍的提前失败分支：

```ts
if (command.type === LXMScoreCommandEnum.SetNote && target.beat.kind === "rest")
  return fail("REST_BEAT_NOT_EDITABLE", "请先取消休止，再输入音符");
```

`SetNote` 分支继续复用现有的同弦覆盖和新音符 ID 分配逻辑，但构造最终 beat 时显式写入
`kind: "notes"`：

```ts
const existing = target.beat.notes.find(
  (note) => note.string === command.string,
);

const notes: ILXMNote[] = existing
  ? target.beat.notes.map((note) =>
      note.string === command.string ? { ...note, fret: command.fret } : note,
    )
  : [
      ...target.beat.notes,
      {
        id: factory.createNoteId(),
        string: command.string,
        fret: command.fret,
      },
    ];

nextBeat = {
  ...target.beat,
  kind: "notes",
  notes,
};
```

合法文档中的休止 beat 必须满足 `notes: []`，所以从休止状态进入该分支时必然创建一个
新音符；普通音符 beat 则继续按原规则新增或覆盖。

### 4.2 校验顺序保持不变

弦号和品位校验必须发生在状态转换之前：

```text
定位 track / measure / beat
  -> 校验 string
  -> 校验 fret
  -> 创建或覆盖 note
  -> 将 beat.kind 设为 notes
  -> 替换目标 measure
  -> schema + semantic validation
```

这样对休止拍输入非法弦号或品位时，命令仍返回原有错误，既不会消费 note ID，也不会
产生一个空的 `kind: "notes"` beat。

### 4.3 不在页面层连续发送两个命令

不采用以下页面编排：

```text
beat.setKind(notes)
  -> note.set
```

两次命令会带来以下问题：

- `documentRevision` 增加两次；
- 未来接入撤销后需要两次撤销才能恢复原休止符；
- 第一次命令会产生短暂的空音符 beat；
- 其他命令调用方仍然无法获得相同行为；
- 第二次命令失败时需要额外回滚第一次转换。

自动取消休止是 `note.set` 的领域语义，应由核心命令一次完成。`EditorShell` 的
`setActiveNote` 无需修改。

### 4.4 错误码清理

仓库内 `REST_BEAT_NOT_EDITABLE` 只服务于当前提前失败分支和对应测试。删除该行为后，
应同时从 `ILXMScoreCommandErrorCode` 中删除该成员，避免公开一个永远不会返回的错误码。

如果后续存在仓库外消费者依赖这个字符串，可在一个兼容周期内保留联合类型成员并标记
deprecated，但命令实现不得再返回它。当前私有 workspace 包优先直接清理。

## 5. 休止符布局方案

### 5.1 统一 beat 时间锚点

在 `packages/lxm-editor/src/layout/rest-layout.ts` 中，将：

```ts
x: slot.x + slot.width / 2,
```

改为：

```ts
x: slot.x,
```

并更新函数注释，明确休止符使用 beat slot 的时间锚点，而不是 slot 的视觉中心。

修复后的水平坐标契约为：

```text
beat slot time anchor = slot.x
  ├─ TAB note.x
  ├─ restMark.x
  ├─ active cursor.x
  └─ duration mark / beam beat anchor
```

`slot.width` 继续表示当前节奏列占据的横向空间，可用于命中范围和后续布局，但不再参与
休止符锚点计算。

### 5.2 页面渲染保持不变

休止符继续使用：

```tsx
<text x={rest.x} y={rest.y} textAnchor="middle">
  {rest.glyph}
</text>
```

品位数字已经通过 `.fretNoteText { text-anchor: middle; }` 使用相同的中心锚定语义。
页面不应增加固定 `translateX`、负 margin 或按 rhythm 分支计算偏移，否则会重复修正核心
layout，并在 compact density 或 System 拉伸后再次失配。

### 5.3 字形光学校正的边界

本次已确认的主要偏移量严格等于 `slot.width / 2`，因此首要修复是统一几何锚点。修复后
若个别 Bravura glyph 仍存在少量字形 side bearing 造成的视觉偏差，应另行基于真实字体
度量设计 glyph-specific optical offset，不能恢复使用 slot 中心，也不能用一个全局固定值
覆盖所有休止时值。

## 6. 数据与不变量

本 fix 不修改持久化类型，转换前后的数据示例如下。

输入：

```ts
{
  id: "beat-1",
  tick: 960,
  rhythm: { base: "quarter", dots: 0 },
  kind: "rest",
  notes: [],
}
```

执行：

```ts
{
  type: LXMScoreCommandEnum.SetNote,
  trackId: "track-1",
  measureId: "measure-1",
  beatId: "beat-1",
  string: 3,
  fret: 5,
}
```

结果：

```ts
{
  id: "beat-1",
  tick: 960,
  rhythm: { base: "quarter", dots: 0 },
  kind: "notes",
  notes: [
    {
      id: "<document id factory 生成的新 ID>",
      string: 3,
      fret: 5,
    },
  ],
}
```

必须保持：

- beat ID、tick 和 rhythm 不变；
- 新 note ID 由文档级 ID factory 生成且全局唯一；
- 原 document 不被修改；
- 只替换目标 track / measure / beat 分支；
- `documentRevision` 只增加 `1`；
- 命令结果继续通过 schema 和 semantic validation；
- 新布局不再生成该 beat 的 `restMark`，而是生成对应 note layout。

## 7. 测试方案

### 7.1 命令回归测试

修改 `packages/lxm-editor/tests/core/commands.test.ts` 中当前“阻止直接向休止输入品位”的
断言，覆盖完整转换链路：

1. 先通过 `beat.setKind({ kind: "rest" })` 构造休止拍。
2. 对同一 beat 执行一次合法 `note.set`。
3. 断言命令成功。
4. 断言目标 beat 为 `kind: "notes"`。
5. 断言目标弦和品位已经写入，note ID 非空且不与原文档实体冲突。
6. 断言 beat ID、tick 和 rhythm 保持不变。
7. 断言相对输入 document 的 revision 只增加 `1`。
8. 断言输入 document 仍保持 `kind: "rest"` 和 `notes: []`。

同时保留既有测试，证明：

- 普通 beat 的空弦新增音符行为不变；
- 普通 beat 的同弦输入仍只覆盖 fret，不创建重复 note；
- 非法 string 和 fret 仍失败；
- `beat.setKind({ kind: "rest" })` 仍清空已有音符。

补充一个休止拍非法输入用例，验证校验失败不会顺带取消休止。

### 7.2 布局单元测试

新增 `packages/lxm-editor/tests/layout/rest-layout.test.ts`，在核心 layout seam 断言：

```ts
expect(restMark.x).toBe(beatSlot.x);
```

至少覆盖：

- 一个 quarter rest 的基础对齐；
- 同一小节包含多个 rest 时，每个 rest 都对齐自己的 slot；
- `compact` density 下仍然对齐；
- 传入更大的 `assignedWidth` 拉伸节奏列后仍然对齐；
- rest 的 `y`、rhythm 和 glyph 不因横坐标修复发生变化。

测试应调用 `layoutMeasure` 或 `layoutRests` 的真实调用 seam，不通过复制公式验证公式。

### 7.3 命令与布局集成验证

构造包含休止拍的文档并执行 `note.set`，随后调用 `buildLayout`：

- 转换前目标 beat 生成一个 `restMark`，其 `x === beatSlot.x`；
- 转换后目标 beat 不再生成 `restMark`；
- 转换后生成的 note 满足 `note.x === beatSlot.x`；
- System 数量、小节宽度和其他 beat 坐标不发生非预期变化。

浏览器验收：

- 点击休止拍所在弦并直接输入一位或两位品位，休止符立即被音符替换；
- 操作过程中不出现“请先取消休止”的错误；
- 休止符、音符和蓝色活动光标位于同一个拍点；
- 在 whole、half、quarter、eighth、sixteenth、thirtySecond 休止符上检查横向对齐；
- 在 compact 排版、普通行和受控拉伸末行中检查横向对齐。

## 8. 不采用的方案

### 8.1 页面检测休止状态后自动点击“取消休止”

页面会承担领域状态转换，产生两次 revision 和未来的两个撤销步骤，也无法覆盖其他命令
调用方，因此不采用。

### 8.2 新增组合命令 `rest.replaceWithNote`

现有 `note.set` 已完整表达“在指定 beat 和 string 设置 fret”。为休止状态单独增加命令
会让调用方必须先读取 beat kind 再选择命令，扩大状态分支，没有必要。

### 8.3 允许 rest beat 同时保存 notes

这会破坏现有语义不变量，并让渲染、保存和后续编辑都需要解释隐藏音符。本方案始终在
同一次命令中把 `kind` 转为 `notes`。

### 8.4 用 CSS 把休止符向左移动固定像素

当前偏移是 `slot.width / 2`，会随时值和布局拉伸变化，不是固定像素。CSS 补偿无法稳定
修复，并会让页面重复理解核心布局规则。

## 9. 验收标准

- 对任意合法休止 beat 执行一次合法 `note.set` 返回成功。
- 命令结果的目标 beat 为 `kind: "notes"`，且包含输入音符。
- 自动转换只增加一次 revision，并可作为未来单个撤销单元。
- 非法弦号或品位不会取消休止，也不会消费 note ID。
- 普通音符 beat 的新增和同弦覆盖行为无回归。
- `beat.setKind({ kind: "rest" })` 仍清空音符。
- 所有休止符的 `restMark.x` 与对应 `beatSlot.x` 完全相等。
- 音符、休止符、光标和节奏图形共享同一 beat 时间锚点。
- compact、comfortable 和 System 拉伸场景下均无半个 slot 的横向偏移。
- 网站层不新增休止状态分支或坐标补偿。
- `lxm-editor` 测试、类型检查和 lint 全部通过。

## 10. 实施顺序

1. 将现有休止拍输入测试改为期望一次 `note.set` 成功，并确认测试先失败。
2. 修改 `SetNote` 分支，使其原子写入 `kind: "notes"` 和 notes。
3. 清理不再使用的 `REST_BEAT_NOT_EDITABLE` 错误码及旧断言。
4. 新增休止符与 beat slot 对齐测试，并确认测试先失败。
5. 将 `rest-layout.ts` 的横坐标改为 `slot.x`，同步更新注释。
6. 增加命令后重新布局的集成验证。
7. 运行 `lxm-editor` 的定向测试、完整测试、类型检查和 lint。
8. 在网站中完成直接输入和多种时值、密度、System 宽度下的视觉验收。
