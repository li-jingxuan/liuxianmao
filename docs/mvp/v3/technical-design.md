# MVP v3 技术实现方案：小节与节奏编辑

## 1. 目标与现状

MVP v2 已完成多行 system 布局、布局驱动的命中、单音输入、覆盖和删除。当前核心包的 `ILXMBeat` 已有 `tick` 与 `rhythm` 字段，但 schema 只校验字段结构：它尚未保证 beat 时间轴连续、时值可计算、总时长等于拍号容量，也没有休止符模型和小节结构命令。

MVP v3 的目标是让用户可以编辑节奏与小节，同时保证所有成功写入的文档都满足可验证的音乐时间约束。

```text
工具栏 / 当前光标
  → applyScoreCommand(document, command)
  → schema 校验 + 节奏语义校验
  → 新 ILXMDocument
  → buildLayout(document)
  → systems / hit index / SVG
```

所有乐谱修改仍只能由 `packages/lxm-editor` 的纯领域命令完成；`apps/website` 不修改 `ILXMDocument`，也不自行计算 tick、容量或小节换行。

## 2. 关键产品与算法决策

### 2.1 小节是连续且完整的时间分区

一个合法小节的 beats 必须按 `tick` 升序形成从 `0` 到小节容量的连续分区：

```text
beat[0].tick === 0
beat[i].tick === beat[i - 1].tick + duration(beat[i - 1])
measureEnd === getMeasureCapacityTicks(timeSignature)
```

因此不允许：无效时值、重叠 beat、时间空洞和超出容量的 beat。这个约束比“仅总 tick 相加正确”更严格，确保 layout、命中和未来的播放功能都能依赖唯一的时间轴。

### 2.2 修改时值采用显式 ripple，而非页面层挤压

`beat.setRhythm` 修改当前 beat 的时值后，领域命令以时值差 `delta` 平移所有后续 beat 的 `tick`。该规则由命令层实现、测试和返回错误；页面不得静默修改后续数据。

- 若变长后超出小节容量，命令失败，原文档不变。
- 若变短产生末尾空余，命令优先扩展末尾休止 beat；没有末尾休止时，创建一个休止 beat 填充剩余容量。
- 若变长且末尾存在可缩短的休止 beat，先缩短或移除该休止 beat；仍无法容纳时失败。
- 不修改非休止 beat 的 rhythm，避免编辑一个 beat 时隐式改变真实音符的时值。

该策略使节奏编辑可用且可预测：真实音符向后移动是明确、确定的 ripple 结果；仅自动管理静音尾部的休止时间。

### 2.3 v3 仅支持可表示的休止时值

当前 rhythm 基础时值是 whole、half、quarter、eighth、sixteenth、thirtySecond，附点支持 0、1、2。新建或拆分休止时间必须由这些可表示的 rhythm beat 序列完整覆盖；若拍号容量或剩余 tick 无法用该集合精确表示，命令返回明确的 `RHYTHM_NOT_REPRESENTABLE` 错误。

MVP 默认支持常用的 `4/4`、`3/4`、`2/4`、`6/8` 等拍号。非标准拍号不是 v3 的产品入口；schema 可继续保留现有格式约束，但默认小节生成器必须拒绝无法覆盖的容量，不能产出非法文档。

## 3. 模块职责

```text
packages/lxm-editor/src/
  core/
    types.ts                 # 扩展 beat kind
    constants.ts             # 扩展 rest enum、可支持的附点边界
    schema.ts                # 结构校验
    rhythm.ts                # tick、拍号容量、休止分解工具
    semantic-validation.ts   # 新增：全局业务语义校验
    commands.ts              # 扩展：节奏、休止和小节命令
    id-factory.ts            # 新增：实体 ID 分配与复制映射
  layout/
    measure-layout.ts        # 增加休止符布局产物
    rest-layout.ts           # 新增：休止符 glyph 与坐标
    layout-types.ts          # 扩展 restMarks
    system-layout.ts         # 不修改断行规则，继续消费小节布局宽高

apps/website/
  components/EditorShell/    # 文档状态、光标恢复、SVG 渲染
  components/EditorToolbar/  # 新增：顶栏 SVG 图标与领域命令意图
```

边界如下：

- `semantic-validation.ts` 不依赖 React、DOM、layout 或页面状态。
- `commands.ts` 是唯一写入口；每次成功返回的新 document 都需通过结构和语义校验。
- `rest-layout.ts` 只把已验证的 rest beat 转为几何与字形，不判断容量。
- 工具栏只根据当前 cursor 组装 command，不能自行更新 `tick`、`beats` 或 `measures`。
- `buildLayout` 继续是 render 与 hit test 的唯一坐标来源。

## 4. 数据契约与校验

### 4.1 Beat kind

扩展现有类型和常量：

```ts
export const LXM_BEAT_KINDS = ["notes", "rest"] as const;

export type ILXMBeatKind = (typeof LXM_BEAT_KINDS)[number];
```

`ILXMBeat` 不新增额外字段，仍复用 `rhythm` 与 `tick`：

```ts
interface ILXMBeat {
  id: string;
  tick: number;
  rhythm: ILXMRhythm;
  kind: "notes" | "rest";
  notes: ILXMNote[];
}
```

约束：

- `kind === "rest"` 时，`notes.length === 0`。
- `kind === "notes"` 时允许 `notes` 为空，以便用户先创建节奏位置再输入音符；v3 不把空 notes beat 自动转为 rest。
- 一个 beat 内任意 `note.string` 至多出现一次。
- `note.set` 对 rest beat 自动完成 `rest → notes` 转换，并在同一次命令中写入音符；非法输入仍保持原 rest 不变。

### 4.2 语义校验 API

新增独立公开 API，供 loader、命令和测试共用：

```ts
type ILXMSemanticValidationIssueCode =
  | "INVALID_RHYTHM"
  | "BEAT_TICK_NOT_CONTIGUOUS"
  | "MEASURE_CAPACITY_MISMATCH"
  | "REST_HAS_NOTES"
  | "DUPLICATE_NOTE_STRING"
  | "DUPLICATE_ENTITY_ID"
  | "INVALID_CHORD_TICK";

type ILXMSemanticValidationResult =
  | { ok: true }
  | { ok: false; issues: ILXMSemanticValidationIssue[] };

function validateDocumentSemantics(
  document: ILXMDocument,
): ILXMSemanticValidationResult;
```

校验顺序：先调用 `LXMDocumentSchema.safeParse`，结构失败时不进入语义计算；结构成功后再逐轨道、逐小节检查：

1. `calculateRhythmTicks` 必须成功。
2. 每个 beat 的 `tick` 必须等于前一个 beat 的结束 tick；首个 beat 从 `0` 开始。
3. 最终结束 tick 必须等于 `getMeasureCapacityTicks`。
4. 休止与音符、同 beat 同弦冲突、全局实体 ID 重复必须失败。
5. 和弦标记的 tick 必须落在 `[0, capacity)`；v3 不改变和弦显示逻辑。

`loadDocument` 在结构校验成功后也应运行语义校验，避免从 JSON 加载一个无法正确 layout 的乐谱。

## 5. 领域命令

### 5.1 命令类型

在已有 `note.set`、`note.remove` 基础上增加：

```ts
type ILXMScoreCommand =
  | ILXMSetNoteCommand
  | ILXMRemoveNoteCommand
  | {
      type: "beat.setRhythm";
      trackId: string;
      measureId: string;
      beatId: string;
      rhythm: ILXMRhythm;
    }
  | {
      type: "beat.setKind";
      trackId: string;
      measureId: string;
      beatId: string;
      kind: ILXMBeatKind;
    }
  | {
      type: "measure.insert";
      trackId: string;
      afterMeasureId?: string;
    }
  | {
      type: "measure.copy";
      trackId: string;
      measureId: string;
    }
  | {
      type: "measure.remove";
      trackId: string;
      measureId: string;
    };
```

所有命令仍使用判别联合返回值。新增错误码至少包括：

```ts
type ILXMScoreCommandErrorCode =
  | "INVALID_RHYTHM"
  | "MEASURE_OVERFLOW"
  | "RHYTHM_NOT_REPRESENTABLE"
  | "CANNOT_REMOVE_LAST_MEASURE"
  | "SEMANTIC_VALIDATION_FAILED";
```

### 5.2 节奏与休止命令规则

`beat.setRhythm` 的实现步骤：

1. 精确定位 track、measure、beat，并用 `calculateRhythmTicks` 校验目标 rhythm。
2. 替换目标 beat rhythm，计算旧新时值差。
3. 对后续 beats 的 tick 应用 ripple。
4. 调整末尾连续 rest 区域以吸收正/负差；需要时使用 `createRestBeatsForTicks` 补齐。
5. 生成候选 document、递增 `documentRevision`，再运行 schema 与语义校验。

`beat.setKind`：

- 设为 `rest`：清空 notes 并保留当前 tick/rhythm。
- 改为 `notes`：保留空 notes，不自动创建音符。
- 不改变时值和后续 tick，因此不触发 ripple。

### 5.3 小节结构命令规则

`measure.insert`：

- 在 `afterMeasureId` 后插入；未传入时插入轨道首位。
- 拍号继承前一个小节；若前面没有小节，则继承后一个小节。
- 使用 `createRestBeatsForTicks(capacity)` 创建完整默认休止结构。
- 新小节默认 `barline: "single"`、空 `chordSymbols`，并分配新的 measure / beat ID。

`measure.copy`：

- 在源小节之后插入深拷贝。
- 保留拍号、节奏、音符与和弦内容；为 measure、beat、note、chord symbol 分配全新 ID。
- 新副本的 `barline` 固定为 `single`，避免复制终止线或反复线造成歧义；源小节的小节线保持不变。

`measure.remove`：

- 仅删除目标小节，不修改其他小节的内容或拍号。
- 若该轨道仅剩一个小节，返回 `CANNOT_REMOVE_LAST_MEASURE`。
- 成功后递增 revision，页面依据旧光标执行相邻目标回退。

### 5.4 ID 工厂

新增集中式 ID 工厂，禁止 UI 拼接 ID：

```ts
interface ILXMIdFactory {
  createMeasureId(): string;
  createBeatId(): string;
  createNoteId(): string;
  createChordSymbolId(): string;
}
```

默认实现以 document 中的已存在 ID 为输入，输出稳定且无碰撞的 ID；测试可注入递增实现以断言复制结果。现有 `createNoteId` 应迁移到该模块，避免不同命令各自扫描与命名。

## 6. 休止符布局与 SVG 渲染

### 6.1 Layout 产物

扩展 `ILXMMeasureLayout`：

```ts
interface ILXMRestLayout {
  id: string;
  beatId: string;
  measureId: string;
  rhythm: ILXMRhythm;
  x: number;
  y: number;
  glyph: string;
}

interface ILXMMeasureLayout {
  // 既有字段
  restMarks: ILXMRestLayout[];
}
```

`rest-layout.ts` 使用已有 beat slot 的 `x/width` 和小节弦线中线生成坐标。页面不根据 `rhythm.base` 决定图形，也不重新计算纵坐标。

休止符优先使用网站已加载的 Bravura 字体，并由核心包维护 rhythm 到 SMuFL glyph 的映射。若某个 glyph 无法在当前字体渲染，应在布局层返回明确的 fallback 标识，并在浏览器验收中修复映射；不得将文本字符或坐标散落在 React JSX 中。

### 6.2 既有布局的影响

- `layoutMeasureSpacing` 继续按全部 beat（含 rest）生成节奏列，保证休止与后续音符对齐。
- `layoutDurationBeams` 对 rest beat 不生成符干或连梁；v3 不实现跨休止连梁。
- `hit-test` 仍命中 existing beat slot 与弦。用户点击休止 beat 的任意弦后，既可通过工具栏取消休止，也可直接输入合法品位并由一次 `note.set` 自动转为 notes。
- system-layout 不需要特殊分支；小节宽度仍来自 measure layout，新增、复制、删除后自动重新断行。

## 7. 页面集成

### 7.1 工具栏

新增位于编辑器顶栏的 `EditorToolbar`，使用语义化 button 并以 `activeCursor` 决定可用状态。顶栏的操作图标优先复用 `docs/extracted-svg-icons/` 已提取的本地 SVG，而非新增图标库或在线资源。

实施时将经确认的源图标复制至 `apps/website/public/assets/svg/music-controls/`，并更新 `apps/website/assets/svg/svg-assets-manifest.ts`；页面通过现有 `MusicAssetIcon` 或 `<img>` 引用 public 资源。`docs/` 下的提取目录是素材来源，不作为运行时 URL。

第一版顶栏图标映射固定如下：

| 操作                               | 源图标                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 全、二、四、八、十六、三十二分音符 | `note-whole.svg`、`note-half.svg`、`note-quarter.svg`、`note-eighth.svg`、`note-sixteenth.svg`、`note-thirty-second.svg` |
| 单附点、双附点                     | `note-dot.svg`、`note-double-dotted.svg`                                                                                 |
| 新增、复制、删除小节               | `measure-add24.svg`、`actions-copy24.svg`、`measure-remove24.svg`                                                        |
| 设为/取消休止（临时图标）          | `measure-multi-measure-rest32.svg`                                                                                       |

现有素材目录目前没有单拍休止符的独立 SVG；因此 `measure-multi-measure-rest32.svg` 在 v3 仅作为顶栏“休止”操作的临时图标，不代表乐谱中的单拍休止记谱。谱面内的休止符仍由 `rest-layout.ts` 和 Bravura/SMuFL glyph 映射渲染，二者不得混用。

工具栏包含：

- 基础时值：whole、half、quarter、eighth、sixteenth、thirtySecond。
- 附点：切换无附点、单附点、双附点；按钮应显示当前目标节奏。
- 休止：设为休止 / 取消休止。
- 小节：在当前小节后新增、复制当前小节、删除当前小节。

工具栏只创建 command 并调用由 `EditorShell` 提供的 `onCommand`。命令失败时展示核心层 message，不修改 document 或光标。

### 7.2 光标恢复

每次成功命令、重新 layout 后按下列规则恢复临时 cursor：

1. 目标 `measureId + beatId + string` 仍存在时原样保留。
2. 删除当前小节时，选择同位置的下一小节首个 beat；没有下一小节则选择前一小节首个 beat。
3. 删除后只剩唯一小节的场景不会发生，因为命令应已失败。
4. 目标 rest beat 可保持光标；合法数值品位输入会在一次命令内转为 notes，非法输入不改变 rest。

### 7.3 v2 遗留清理

开始页面集成时一并完成以下无行为风险的清理：

- 初始数据切换为 `EXAMPLE.EXAMPLE_MVP_2.default`。
- 移除 `EditorShell` 的 `console.log`。
- 删除或完成未接入且类型不正确的 `SystemLayer.tsx` 占位组件；现有 SVG system 渲染可先保留在 `EditorShell`。

## 8. 测试策略

### 8.1 夹具

新增 `example-mvp3.json.ts`，基于 v2 fixture 保持八个 `4/4` 小节，并加入：

- 单小节完整休止；
- notes 与 rest 混合的连续时间轴；
- 可缩短、可扩展的末尾 rest；
- 可复制的多弦音符、附点与 chord symbol。

夹具是静态、强类型、不可原地修改的测试输入。

### 8.2 核心单元测试

- `semantic-validation.test.ts`：合法 `4/4`、`3/4`、`6/8`；无效 dots、tick 空洞、重叠、溢出、容量不足、休止含音符、重复弦、重复 ID 与非法 chord tick。
- `rhythm.test.ts`：`createRestBeatsForTicks` 对常用容量及不可表示剩余的结果。
- `commands.test.ts`：缩短/变长 ripple、末尾 rest 吸收、溢出拒绝、rest 创建和取消、rest 直接输入与非法输入原子性、insert/copy/remove、最后小节删除失败、ID 唯一性、不可变性和 revision。
- `rest-layout.test.ts`：每种基础时值与附点的 glyph 映射、休止坐标位于目标 beat slot、notes beat 不生成 rest layout。
- `system-layout.test.ts`：新增、复制、删除后 system 分组、Y 坐标和整谱高度可重新计算。

### 8.3 页面验收

- 在两行以上谱面中修改首行和末行的时值、附点与休止状态。
- 验证时值变更后的后续 beat 位置与命中目标同步更新。
- 新增、复制、删除小节后检查自动换行、光标回退、SVG `viewBox` 和控制台。
- 验证无当前光标、无效时值、容量溢出、对休止输入品位和删除最后小节时都有可读错误提示。

## 9. 实施顺序与完成定义

1. 扩展 `types`、`constants`、`schema`，实现语义校验并让 loader 接入。
2. 实现 rhythm 辅助函数、ID 工厂和节奏/休止命令。
3. 实现新增、复制、删除小节命令及测试。
4. 扩展 layout types，完成 rest layout 与 SVG 渲染。
5. 新增工具栏、命令接入与光标恢复。
6. 完成全量回归、浏览器验收和已知限制记录。

MVP v3 仅在以下条件全部满足后完成：

- 所有成功命令均通过结构校验和语义校验；失败操作不改变原文档。
- 时值计算、容量校验、节奏列布局、休止符渲染使用同一套 rhythm 定义。
- 新增、复制、删除小节后 ID 唯一性、system 分组和画布尺寸正确。
- `pnpm test`、`pnpm type-check`、`pnpm lint`、`pnpm build` 全部通过。
- 目标桌面视口完成真实浏览器验收，无控制台 error 或 warning。

## 10. 已知限制

- v3 不实现撤销/重做；每个工具栏动作都是独立命令，历史合并留给 v4。
- v3 不实现跨休止连梁、连音组、播放和复杂拍号编辑。
- 休止符字形依赖 Bravura/SMuFL 映射，需在实施阶段针对目标浏览器做视觉回归。
- 多轨布局仍沿用当前“第一条轨道”策略；多轨编辑不属于 v3。
