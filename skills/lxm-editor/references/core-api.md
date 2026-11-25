# 六线猫 Core 1.0.0 公开 API

以下函数均同步执行，从 `@liuxianmao/lxm-editor` 根入口通过 ESM 命名导入。TypeScript 从同一入口 `import type`，完整导出见已安装包的 `dist/public.d.ts`。包还随附 `docs/api-v1.md` 和 `demo/`。

## 文档与校验

```ts
function loadDocument(json: string): DocumentLoadResult;
function upgradeDocumentToCurrent(value: unknown): DocumentLoadResult;
function validateDocumentSemantics(document: ILXMDocument): ILXMSemanticValidationResult;
function createTuningPreset(preset: GuitarTuningPreset): ILXMTuning;

type DocumentLoadResult =
  | { ok: true; document: ILXMDocument }
  | { ok: false; errors: string[] };
```

`SCORE_DOCUMENT_SCHEMA` 为 `"lxm-tab-score"`，`CURRENT_SCHEMA_VERSION` 为 `8`。这里的 Schema 版本是谱文件版本，npm 包版本是 `1.0.0`。`ILXMDocument` 根字段为 `schema`、`schemaVersion`、`documentRevision`（正整数）和 `score`。

- `loadDocument` 接收 JSON 文本，顺序执行解析、版本检查、结构校验和语义校验。各类失败都从 `errors: string[]` 读取。语法错误为 `JSON 格式错误`，识别到旧版或未知版本时会报告当前支持版本，字段和语义错误通常附带路径。需要程序化语义错误码时使用 `validateDocumentSemantics`。
- `upgradeDocumentToCurrent` 接收 `JSON.parse` 后的对象，支持同一 `schema` 的 Schema 4、5、6、7。由宿主决定何时升级，并处理 `JSON.parse` 的异常。升级校验对应的旧结构，补齐相应字段，把旧拍点中的简谱转换至独立简谱声部，再通过当前加载器验收。当前、未知版本或旧结构无效时返回 `ok: false`。例如 Schema 7 的拍点可带 `numberedNotation`，Schema 8 在小节中使用 `numberedVoice`，轨道还要求 `numberedMarks`。只改版本数字无法完成迁移。
- 对已有的当前版对象，先用 `LXMDocumentSchema.safeParse(value)`。`success: true` 时读取 `data`，`success: false` 时读取 `error.issues` 的 `path` 和 `message`。对 `data` 调用 `validateDocumentSemantics`，成功为 `{ ok: true }`，失败为 `{ ok: false, issues }`，每项含 `code`、`path` 和 `message`。典型校验包括 ID 唯一性、拍点时间连续性、小节容量、调弦以及歌词、技巧和简谱标记的引用关系。
- `createTuningPreset` 返回独立调弦快照，预设包括 `standard`、`dropD`、`halfStepDown`、`openG` 和 `dadgad`。JavaScript 宿主先校验来自外部的预设字符串。调弦数组按第 1 弦到第 6 弦排列，`pitch` 与 `midi` 必须一致。

`score.tracks` 保存吉他轨道。轨道包含调弦、变调夹、小节、技巧和简谱标记。小节包含 TAB 拍点、独立简谱声部、歌词、和弦和连音。小节内的 tick 从该小节起点算起，四分音符等于 `TICKS_PER_QUARTER`（960）。[合成谱](../examples/core/synthetic-score.lxm)

保存时用 `JSON.stringify(document, null, 2)`，可先用 `loadDocument` 回读检查。`.lxm` 的文件选择、字节限制、UTF-8 和 BOM 处理、升级提示、文件读写和持久化由宿主负责。[读谱和序列化回读示例](../examples/core/edit-score.mjs)

## 编辑命令

```ts
function applyScoreCommand(
  document: ILXMDocument,
  command: ILXMScoreCommand,
): ILXMApplyScoreCommandResult;
```

传已校验的当前文档。`ILXMScoreCommand` 是按 `type` 区分的联合类型，输入字段依命令而异。`LXMScoreCommandEnum` 提供 TAB、节奏、小节、段落文字、歌词、和弦和技巧等命令值。独立简谱声部操作使用 `ILXMNumberedVoiceCommand` 的字符串命令，例如 `"numbered.event.set"`。

| 任务 | 命令和主要参数 |
| --- | --- |
| 写入 TAB 品位 | `LXMScoreCommandEnum.SetNote`，传 `trackId`、`measureId`、`beatId`、`string`、`fret`。弦号是 1–6，品位是 0–24 的整数或 `"x"`（闷音）、`"-"`（延音）。 |
| 改拍点时值 | `LXMScoreCommandEnum.SetBeatRhythm`，传 `trackId`、`measureId`、`beatId`、`rhythm`，例如 `{ base: "quarter", dots: 0 }`。 |
| 改已有简谱事件 | `"numbered.event.set"`，传 `trackId`、`measureId`、`eventId`、`tokens`，例如 `["3"]`。 |
| 写歌词 | `LXMScoreCommandEnum.SetLyric`，可用 `trackId`、`measureId`、已有简谱 `eventId`、`verse`（1–4）和 `text`。 |
| 写和弦 | `LXMScoreCommandEnum.SetChordSymbol`，可用 `trackId`、`measureId`、`beatId`、`display` 和 `chord`，如 `"nameAndDiagram"` 和 `copyChordPreset("C")` 的成功结果。 |
| 添加延音线 | `LXMScoreCommandEnum.AddTechnique`，传 `trackId` 和 `technique: { type: "tie", fromNoteId, toNoteId }`。端点须按先后顺序、同弦同音高。 |
| 插入小节 | `LXMScoreCommandEnum.InsertMeasure`，传 `trackId` 和 `afterMeasureId`。 |

- `{ ok: true, changed: true, document, ... }` 表示已生成新快照。后续命令使用这份文档及其修订号。可选 `effects` 报告节奏变化、移除或迁移的标记等影响。`nextFocus` 可给出 `{ trackId, measureId, beatId }`，弦号由宿主选择。`nextNumberedFocus` 含 `trackId`、`measureId` 和 `eventId`（可带 `itemId`），或 `tick`、`endTick` 时间窗。
- `{ ok: true, changed: false, document }` 表示无实际变化，跳过历史提交。
- `{ ok: false, code, message, ... }` 表示命令失败。保留当前快照，按 `code` 选择后续操作，`message` 可展示给用户。例如 `BEAT_NOT_FOUND` 时重新定位，`INVALID_FRET` 时修正输入。`DOCUMENT_INVALID` 和 `SEMANTIC_VALIDATION_FAILED` 表示候选文档未通过相应校验。错误码的完整集合见 `ILXMScoreCommandErrorCode`。

预览时记录 `documentRevision`，提交时传 `expectedRevision`。快照不匹配时返回 `STALE_NUMBERED_PLAN`，TAB 命令也使用该错误码，宿主应重新定位或预览。历史还原会带回原修订号，异步流程还要核对宿主的文档会话或操作序号。

`NUMBERED_IMPACT_REQUIRED` 可能携带 `removedMarkIds`、`changedMarkIds`。向用户展示影响并确认后，用原 `expectedRevision` 及相应的 `confirmedRemovedMarkIds`、`confirmedChangedMarkIds` 重提。其他覆盖确认字段以具体命令成员为准。

### 节奏型预览和提交

```ts
function planRhythmPattern(
  document: ILXMDocument,
  target: RhythmPatternTarget,
  templateId: string,
): RhythmPatternPlan;
```

`target` 包含 `layer: "tab" | "numbered"`、`trackId`、`measureId`、`startTick`、`endTick`、`focusTick`，跨小节可提供 `endMeasureId`、`focusMeasureId`。单点用相同的 `startTick` 与 `endTick`。成功时从 `before`、`after` 取得预览，失败时读取 `{ ok: false, code, message }`。

`LXMScoreCommandEnum.ApplyRhythmPattern` 提交时传原预览 `target`、`templateId`、`expectedRevision` 和 `expectedConfirmationKey: plan.confirmationKey`。规划结果的 `plan.target` 可能已扩展到实际作用范围。确认键始终必传，过期时返回 `STALE_RHYTHM_PATTERN_PLAN`。

- `requiresConfirmation` 为 `true` 时，用户同意覆盖后传 `allowOverwrite: true`。对应错误是 `RHYTHM_PATTERN_OVERWRITE_CONFIRMATION_REQUIRED`。
- `removedMarks` 非空时，用户同意移除标记后传 `allowRemoveMarks: true`。对应错误是 `RHYTHM_PATTERN_CONFIRMATION_REQUIRED`。
- `discardedTextCount > 0` 时，用户同意丢弃歌词或和弦后传 `allowDiscardMusicText: true`。对应错误是 `RHYTHM_PATTERN_TEXT_CONFIRMATION_REQUIRED`。标记和文本这两项提交检查适用于普通节奏型和整小节扫弦模板。

### 领域辅助函数

```ts
function copyChordPreset(name: string): { name: string; diagram: ILXMChordDiagram } | null;
function parseNumberedSequence(raw: string):
  | { ok: true; items: NumberedSequenceItem[] }
  | { ok: false; message: string };
function validateTechnique(
  track: ILXMTrack,
  technique: ILXMTechnique | ILXMTechniqueDraft,
  excludeTechniqueId?: string,
): ILXMTechniqueRuleResult;
```

`copyChordPreset` 按名称返回独立指法快照，未找到时返回 `null`。`parseNumberedSequence("1 2+4 _ 5'")` 用空格分隔事件、`+` 合并同一事件的音，`_` 跳过一个位置。`validateTechnique` 检查技巧端点和演奏规则，失败时读 `result.error`。更新已有技巧时传其 ID 作为 `excludeTechniqueId`，以免与自身比较。[编辑与历史示例](../examples/core/edit-score.mjs)

## 历史

```ts
function createDocumentHistory<Entry>(): DocumentHistory<Entry>;
function transitionDocumentHistory<Entry>(
  history: DocumentHistory<Entry>,
  action: DocumentHistoryAction<Entry>,
): DocumentHistory<Entry>;
```

宿主按会话持有历史和当前文档。`past` 和 `future` 保存快照，`pastEntries` 和 `futureEntries` 是对应的冻结元数据数组。`past` 从旧到新排列，`future[0]` 是下一步重做目标。历史共享文档和条目对象的引用，使用时视为只读快照。

| `action` | 转换与恢复目标 |
| --- | --- |
| `{ type: "commit", document, entry }` | `document` 传编辑前快照。记录该快照与元数据，清空重做队列。超过 `HISTORY_LIMIT`（100）时裁切最早条目，并将 `baselineAdvanced` 置为 `true`。 |
| `{ type: "commit", document, entry, replaceEntry: true }` | 只替换最后一条元数据，保留合并前的原撤销快照及重做队列。没有已应用条目时返回原历史。 |
| `{ type: "undo", document, keepCount }` | 先取 `past[keepCount]` 作为恢复文档，`document` 传切换前的当前文档。撤销一步时用 `past.length - 1`。`keepCount: 0` 恢复至当前保留的基线。索引无效时返回原历史。 |
| `{ type: "redo", document }` | 先取 `future[0]` 作为恢复文档，`document` 传切换前的当前文档。队列空时返回原历史。 |
| `{ type: "reset" }` | 清空历史并重置 `baselineAdvanced`。 |

转换函数只返回 `DocumentHistory`。调用方把恢复目标和新历史一起更新。[撤销和重做示例](../examples/core/edit-score.mjs)

## 布局与命中

```ts
function buildLayout(document: ILXMDocument, options?: ILXMLayoutOptions): ILXMLayout;
function collectMusicTextMeasureRequests(
  document: ILXMDocument,
  showChordDiagrams?: boolean,
): ILXMMusicTextMeasureRequest[];
```

布局使用首轨，返回 `trackId`、`x`、`y`、`width`、`height`、谱首几何、按行分组的 `systems` 和 `hitIndex`。没有轨道时返回空布局。传入已校验文档与有限的坐标和尺寸。默认原点 `(0, 0)`、`systemWidth: 600`、`systemGapY: 8`、`measureGap: 0`、`density: "comfortable"`。超宽小节可以扩大画布。

默认 `purpose: "presentation"` 用于成品。设为 `"editing"` 时，可用 `editingTailWidth` 预留谱尾空间，用 `paragraphEditing` 或 `paragraphPlaceholders` 提供空谱行的编辑位置。省略 `showChordDiagrams` 时沿用各和弦的显示设置。需要实际字体度量时调用 `collectMusicTextMeasureRequests`，以返回的 `key` 为键把测得的 `x`、`y`、`width`、`height` 放入 `options.musicTextMetrics`。省略度量时使用估算值。

命中函数均以 `layout: ILXMLayout` 和 `point: ILXMLayoutPoint`（`{ x, y }`）为前两个参数，无命中时返回 `null`。SVG 宿主可把视口坐标用 `svg.getScreenCTM()` 的逆矩阵转换为逻辑坐标，先处理无矩阵或不可逆的情况。断行、尺寸或文档变化后以新布局重新命中，并按稳定 ID 恢复选区。

| 签名 | 成功结果 |
| --- | --- |
| `hitTestLayout(layout, point): ILXMHitTarget \| null` | TAB 目标 `{ trackId, systemIndex, measureId, beatId, string }`。同一小节两个拍点的公共边界归较早的拍点。 |
| `hitTestMusicText(layout, point): NonNullable<ILXMHitIndex["musicTextBounds"]>[number] \| null` | 歌词、和弦等文字区域及目标元数据。 |
| `hitTestNumbered(layout, point): ILXMNumberedTarget \| null` | 简谱事件、音符或空输入区目标。 |
| `hitTestNumberedMark(layout, point, tolerance?: number)` | `{ markId, target }`，`target` 含 `kind: "numberedEvent"`、`trackId`、`measureId`、`eventId`。默认曲线距离容差为 5 个逻辑单位。 |
| `hitTestTechnique(layout, point): string \| null` | 技巧 ID，优先检查标签，再根据图元距离命中。 |
| `hitTestTechniqueTarget(layout, point): ILXMTechniqueHitTarget \| null` | 技巧目标，含 `focusEndpoint: "start" \| "end"`。 |
| `hitTestTuplet(layout, point, tolerance?: number)` | `{ trackId, measureId, tupletId, beatIds }`。默认数字和括号线段容差为 4 个逻辑单位。 |

```ts
function getFirstTabCellReference(document: ILXMDocument): ILXMTabCellReference | null;
function createCollapsedTabCellSelection(reference: ILXMTabCellReference): ILXMTabCellSelection;
function navigateTabCellSelection(
  document: ILXMDocument, selection: ILXMTabCellSelection,
  direction: ILXMTabCellNavigationDirection, extend?: boolean,
): ILXMNavigateTabCellSelectionResult;
function resolveTabCellSelection(
  document: ILXMDocument, selection: ILXMTabCellSelection,
): ILXMResolveTabCellSelectionResult;
function layoutTabCellSelection(
  layout: ILXMLayout, range: ILXMResolvedTabCellRange,
): ILXMTabCellSelectionRect[];
function layoutTabCellCaret(
  layout: ILXMLayout, reference: ILXMTabCellReference,
): ILXMTabCellCaretLayout | null;
```

`getFirstTabCellReference` 返回第一条含拍点轨道的首个单元格，完全没有拍点时返回 `null`。多轨文档使用首个单元格初始化选区前，核对其 `trackId` 是否与布局一致。`createCollapsedTabCellSelection` 设定同一单元格为 `anchor` 和 `focus`。导航接受 `left`、`right`、`up`、`down`，`extend: true` 保留 `anchor`。成功时读 `selection` 和 `changed`，无相邻目标时 `changed: false`。`resolveTabCellSelection` 按当前文档顺序规范化范围，最多 512 个单元格，成功取 `range`。导航和解析失败时读取 `code`、`message`。范围无法映射到布局时返回 `[]`，光标无法定位时返回 `null`。[布局命中示例](../examples/core/edit-score.mjs)

## 场景与分页

```ts
function buildScoreScene(layout: ILXMLayout): ScoreScene;
function textPrimitive(
  text: string, x: number, y: number, fontSize: number,
  textAnchor?: "start" | "middle" | "end", fontFamily?: string, halo?: number,
): Extract<ScorePrimitive, { kind: "text" }>;
function paginateLayout(layout: ILXMLayout, options?: ILXMPageOptions): ILXMPaginationResult;
```

`ScoreScene` 提供 `header: ScorePrimitive[]` 和 `systems: { index, items: ScorePrimitive[] }[]`。按数组顺序绘制，`kind` 区分 `line`、`circle`、`rect`、`path`、`polygon` 和 `text`。图元携带几何及可选的 `SceneStyle` 字段，个别图元还携带技巧或简谱对象 ID。`textPrimitive` 返回单个文字图元，默认锚点为 `"start"`、字体为 `SCORE_TEXT_FONT`、光晕为 `0`。宿主负责字体加载、SVG 或 Canvas 绘制、坐标变换以及选区和光标叠加。

成品分页时，先用目标纸张的可用内容宽度构建布局，默认 A4 对应 `A4_CONTENT_WIDTH`。`paginateLayout` 的默认纸张配置是 `A4_PAGE_OPTIONS`，按完整谱行分页，并保留原布局坐标。

- 成功返回 `{ ok: true, pages, diagnostics: [] }`。`pages` 含尺寸、按 `systemIndex` 指定的谱行位移、首页谱首位移和页脚。宿主用这些位置摆放场景并输出到目标介质。
- 无法分页时返回 `{ ok: false, pages: [], diagnostics }`。诊断含 `code`、`measureIds` 和可选 `systemIndex`，例如 `empty-score`、`header-overflow`、`system-too-wide`。
- 数值非法的纸张配置抛出 `RangeError`。尺寸、边距、页脚高度和行距须为有限数，边距、页脚高度和行距须非负，扣除边距和页脚后的内容宽高须为正。

## 播放计划

```ts
function createPlaybackPlan(source: ILXMDocument | ILXMTrack, options?: PlaybackPlanOptions): PlaybackPlan;
function playbackTicksToSeconds(ticks: number, bpm: number): number;
function playbackSecondsToTicks(seconds: number, bpm: number): number;
function getPlaybackBeatAtTick(plan: PlaybackPlan, tick: number): PlaybackBeat | undefined;
```

- `source` 为文档时只用首轨，也可直接传轨道。有限的显式 `bpm` 会限制在 20–300。省略或传非有限值时使用文档的 `tempoBpm`，缺少曲谱速度或单独传轨道时默认 90。
- `startMeasureId` 选中完整反复时间线中该小节的首次访问，并把该访问起点平移至 `0`。未找到时从谱首开始。`visitIndex` 仍是完整展开时间线中的序号。从中段开始时延续到起点的声音可有负的 `sourceStartTick`，实际 `startTick` 截到 `0`。
- `chordCatalog` 可接受标准调弦和弦目录快照，`midiRange` 限定基础和目标音高的有效范围，默认 `[0, 127]`，含两端。

`PlaybackPlan` 含 `bpm`、`durationTicks`、`visits`、`beats`、`sounds` 和 `warnings`。反复展开后，小节可对应多个访问序号。声音事件含谱面 ID、MIDI 音高、起止 tick、发音方式、音高曲线和包络等数据。告警含 `code` 和 `measureIds`，例如 `missingChordVoicing`、`outOfRangePitch`、`invalidRepeat`。没有轨道时总时长为零且各序列为空。

时间换算传有效正 BPM。`getPlaybackBeatAtTick` 查找满足 `startTick <= tick < endTick` 的拍点，包含无声拍。该时刻无拍点时返回 `undefined`。当前声音事件来自吉他 TAB。宿主负责采样、音频时钟、调度、播放控制与游标同步。[播放计划示例](../examples/core/edit-score.mjs)
