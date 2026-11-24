# 六线猫 JavaScript Core v1.0 API

安装 `@liuxianmao/lxm-editor` 后，可以读取曲谱、提交编辑命令，再用新文档生成谱面或播放计划。

- 第一次接入，从[安装与运行示例](#安装与运行示例)开始。
- 打开、校验、升级或保存谱文件，见[文档、校验与保存](#文档校验与保存)。
- 写音符、调整节奏或处理覆盖确认，见[编辑命令](#编辑命令)和[撤销与重做](#撤销与重做)。
- 绘制乐谱、定位点击、移动选区或分页，见[布局、命中和场景](#布局命中和场景)。
- 安排音频事件或同步游标，见[播放计划](#播放计划)。

## 安装与运行示例

1.0 正式版尚未发布到公共 npm 注册表。拿到候选包 `liuxianmao-lxm-editor-1.0.0.tgz` 后，将它放进仓库外的空目录，并在该目录执行以下命令。[Core README](../README.md)

```sh
npm init -y
npm install --omit=dev ./liuxianmao-lxm-editor-1.0.0.tgz
```

从源码准备候选包时，可在 Core 包目录运行 `pnpm pack`。正式发布后，可在项目目录运行 `npm install @liuxianmao/lxm-editor`。

把以下代码保存为项目根目录的 `quickstart.mjs`，运行 `node quickstart.mjs`。它载入安装包自带的合成谱，在第一个可用 TAB 单元格写入第 3 品，然后生成可绘制的场景。示例会输出 `版本 2，1 行谱面`。

```js
import {
  applyScoreCommand,
  buildLayout,
  buildScoreScene,
  getFirstTabCellReference,
  loadDocument,
  LXMScoreCommandEnum,
} from "@liuxianmao/lxm-editor";
import { exampleScoreJson } from "./node_modules/@liuxianmao/lxm-editor/demo/score.mjs";

const loaded = loadDocument(exampleScoreJson);
if (!loaded.ok) throw new Error(loaded.errors.join("\n"));
const score = loaded.document;
const cell = getFirstTabCellReference(score);
if (!cell) throw new Error("谱面没有可编辑的 TAB 单元格");
const edit = applyScoreCommand(score, {
  type: LXMScoreCommandEnum.SetNote,
  ...cell,
  fret: 3,
  expectedRevision: score.documentRevision,
});
if (!edit.ok) throw new Error(edit.message);
const updated = edit.document;
const scene = buildScoreScene(buildLayout(updated));
console.log(`版本 ${updated.documentRevision}，${scene.systems.length} 行谱面`);
```

直接运行 `node node_modules/@liuxianmao/lxm-editor/demo/node.mjs`，可以看到写入品位、撤销、重做、序列化回读、布局、场景和播放计划。该示例也验证坏 JSON、过期命令和 Schema 7 显式升级。[Node 示例](../demo/node.mjs) · [合成谱](../demo/score.mjs)

浏览器示例用 SVG 绘制 4/4 合成谱。选好品位后点击弦线即可编辑，也可以撤销和重做。在项目根目录运行 `python3 -m http.server 8080 --bind 127.0.0.1`，然后打开 `http://127.0.0.1:8080/node_modules/@liuxianmao/lxm-editor/demo/`。示例通过导入映射加载安装目录里的 ESM 文件和 Zod。[示例页面](../demo/index.html) · [浏览器示例](../demo/browser.mjs)

建议使用 Node 22 及以上，或支持 ES2022 和 `structuredClone` 的浏览器。运行时依赖 Zod。包提供 ESM 命名导出和 `.d.ts`，浏览器构建器可通过 `exports` 解析入口。

本文涉及的接口和已有领域辅助函数均从 `@liuxianmao/lxm-editor` 导入。TypeScript 可用 `import type` 从同一入口导入 `ILXMDocument`、`ILXMScoreCommand`、`ILXMApplyScoreCommandResult`、`DocumentHistory`、`DocumentHistoryAction`、`ILXMLayout`、`ILXMLayoutOptions`、`ScoreScene`、`ScorePrimitive`、`PlaybackPlan` 等。安装包内的类型声明入口是 `dist/public.d.ts`，可从那里查阅完整签名。

## 文档、校验与保存

读取文件时，把 JSON 字符串交给 `loadDocument`。应用里已有对象时，可以先校验结构，再检查跨字段规则。需要读取旧版本时，先解析 JSON 并由宿主决定是否调用升级入口。

```ts
declare function loadDocument(json: string): DocumentLoadResult;
declare function upgradeDocumentToCurrent(value: unknown): DocumentLoadResult;
declare function validateDocumentSemantics(
  document: ILXMDocument,
): ILXMSemanticValidationResult;
declare function createTuningPreset(preset: GuitarTuningPreset): ILXMTuning;
```

- `loadDocument` 要求当前 Schema 8，依次解析 JSON、校验结构和语义。成功返回 `{ ok: true, document }`，JSON 语法、版本、结构和语义问题都以 `{ ok: false, errors: string[] }` 返回。
- `upgradeDocumentToCurrent` 接受已解析的 Schema 4、5、6 或 7 对象。迁移后用当前加载器重新校验，沿用 `DocumentLoadResult`。版本超出范围、旧结构无效或迁移后校验失败时，读取 `errors`。
- `LXMDocumentSchema.safeParse(value)` 接受待检查的对象，验证当前结构和字段规则。用 `success` 判断结果，成功时取 `data`，失败时取 `error.issues` 查看字段路径和消息。对已通过结构校验的 `data` 调用 `validateDocumentSemantics`，检查 ID、时间线、调弦、歌词和技巧引用等。语义校验成功返回 `{ ok: true }`，失败返回 `{ ok: false, issues }`，每项包含 `code`、`path` 和 `message`。
- `createTuningPreset` 返回可独立使用的调弦快照。预设为 `standard`、`dropD`、`halfStepDown`、`openG` 和 `dadgad`。JavaScript 宿主应先检查来自外部的预设值。

`ILXMDocument` 包含 `schema`、`schemaVersion`、`documentRevision` 和 `score`。`SCORE_DOCUMENT_SCHEMA` 为 `"lxm-tab-score"`，`CURRENT_SCHEMA_VERSION` 为 `8`。npm 包版本和谱文件 Schema 版本独立演进。

`score.tracks` 保存吉他轨道，每条轨道含调弦、变调夹、小节和跨拍引用。小节内含 TAB 拍点、简谱声部、歌词、和弦和连音。传编辑目标时使用轨道、小节、拍点、音符或简谱事件的稳定 ID。小节内的 tick 从该小节起点算起，四分音符为 `TICKS_PER_QUARTER`（960 ticks）。调弦数组按第 1 弦至第 6 弦排列。

保存时用 `JSON.stringify`。以下片段可接着快速示例运行，`textToSave` 可交给宿主存储。[Node 示例中的回读和升级](../demo/node.mjs)

```js
const textToSave = JSON.stringify(updated, null, 2);
const reopened = loadDocument(textToSave);
if (!reopened.ok) throw new Error(reopened.errors.join("\n"));
```

接入文件选择器时，由宿主处理扩展名、字节大小、字符编码和 BOM、读取失败、升级提示以及写入交互。六线猫 React 编辑器的内置文件导入会检查 10 MiB 上限、曲谱规模和排版完整性。直接调用 Core 的宿主自行决定这些文件预检规则。

## 编辑命令

给 Core 当前文档和一条命令。命令有实际变更时，从结果接收新快照，再更新历史和谱面。失败时留在当前快照。快速示例从首个 TAB 单元格取 ID 后提交 `SetNote`。[Node 编辑示例](../demo/node.mjs)

```ts
declare function applyScoreCommand(
  document: ILXMDocument,
  command: ILXMScoreCommand,
): ILXMApplyScoreCommandResult;
```

`document` 应是已校验的当前快照。`command.type` 决定要传哪些 ID、范围、时值和内容。`LXMScoreCommandEnum` 提供 TAB、节奏、小节、歌词、和弦和技巧等命令值。独立简谱声部使用 `ILXMNumberedVoiceCommand` 定义的字符串命令。完整字段见 `ILXMScoreCommand` 判别联合。

- `ok: true, changed: true` 时，使用 `document` 更新当前快照，记录提交前的文档并重建布局。可选 `effects` 报告移除或迁移的记号、节奏变化等影响。`nextFocus` 指向 TAB 拍点，弦号由宿主决定。`nextNumberedFocus` 指向简谱事件和可选的音符 ID（`itemId`），或小节内的 `tick`／`endTick` 时间窗。
- `ok: true, changed: false` 时，保留当前状态并跳过历史写入。
- `ok: false` 时，按 `code` 选择恢复操作，用 `message` 给出反馈。某些错误还会返回 `removedMarkIds` 或 `changedMarkIds`。

### 按 ID 选择编辑目标

以下片段沿用快速示例中的命令导入。`ids` 由宿主从当前文档或命中结果取得，其中简谱和歌词需要已有事件，延音线需要同弦、同音高的有效音符端点。每条命令都单独作用于传入的 `score`。需要连续提交时，每次都使用上次成功返回的新文档和它的 `documentRevision`。TAB 品位接受 `0`–`24` 的整数，以及闷音 `"x"` 和延音 `"-"`。[从点击到编辑的浏览器示例](../demo/browser.mjs)

```js
import { copyChordPreset } from "@liuxianmao/lxm-editor";

function editExamples(score, ids) {
  const { trackId, measureId, beatId, eventId, fromNoteId, toNoteId } = ids;
  const C = LXMScoreCommandEnum;
  const expectedRevision = score.documentRevision;
  const beat = { trackId, measureId, beatId, expectedRevision };
  const event = { trackId, measureId, eventId, expectedRevision };
  const chord = copyChordPreset("C");
  return {
    rhythm: applyScoreCommand(score, {
      ...beat,
      type: C.SetBeatRhythm,
      rhythm: { base: "quarter", dots: 0 },
    }),
    numbered: applyScoreCommand(score, {
      ...event,
      type: "numbered.event.set",
      tokens: ["3"],
    }),
    lyric: applyScoreCommand(score, {
      ...event,
      type: C.SetLyric,
      verse: 1,
      text: "春",
    }),
    chord:
      chord &&
      applyScoreCommand(score, {
        ...beat,
        type: C.SetChordSymbol,
        display: "nameAndDiagram",
        chord,
      }),
    tie: applyScoreCommand(score, {
      type: C.AddTechnique,
      trackId,
      expectedRevision,
      technique: { type: "tie", fromNoteId, toNoteId },
    }),
    measure: applyScoreCommand(score, {
      type: C.InsertMeasure,
      trackId,
      afterMeasureId: measureId,
      expectedRevision,
    }),
  };
}
```

```ts
declare function copyChordPreset(
  name: string,
): { name: string; diagram: ILXMChordDiagram } | null;
declare function parseNumberedSequence(
  raw: string,
): { ok: true; items: NumberedSequenceItem[] } | { ok: false; message: string };
declare function validateTechnique(
  track: ILXMTrack,
  technique: ILXMTechnique | ILXMTechniqueDraft,
  excludeTechniqueId?: string,
): ILXMTechniqueRuleResult;
```

- `copyChordPreset("C")` 返回内置指法的独立快照，可以传给 `SetChordSymbol`。名称未命中时返回 `null`。
- `parseNumberedSequence("1 2+4 _ 5'")` 生成独立简谱序列命令可用的 `items`。半角或全角空格分隔事件，`+` 分隔同一事件内的多个音，`_` 跳过一个位置。输入无效时读取 `message`。
- `validateTechnique` 可在提交前检查技巧端点、顺序、弦号和音高等规则。编辑现有技巧时可传 `excludeTechniqueId` 排除其自身。用 `result.ok` 判断结果，失败时读取 `result.error.message`。

### 处理过期预览和内容确认

生成选区、预览或确认时，可以记下当时的 `documentRevision`，并在提交时作为 `expectedRevision` 传入。不匹配时，Core 返回 `STALE_NUMBERED_PLAN`。这个错误码也会由 TAB 命令返回，例如 `SetNote`。遇到它应重新获取目标或预览。撤销和重做会恢复快照中的版本号，跨历史切换或跨文档的异步操作还应绑定宿主的会话和操作版本。[过期命令示例](../demo/node.mjs)

遇到 `NUMBERED_IMPACT_REQUIRED` 时，用 `removedMarkIds` 或 `changedMarkIds` 展示相应影响。确认后，用原始 `expectedRevision` 和已确认的 `confirmedRemovedMarkIds`、`confirmedChangedMarkIds` 重提。其他覆盖命令的确认字段见 `ILXMScoreCommand` 对应成员。

```ts
declare function planRhythmPattern(
  document: ILXMDocument,
  target: RhythmPatternTarget,
  templateId: string,
): RhythmPatternPlan;
```

`target` 传 `layer`（`"tab"` 或 `"numbered"`）、`trackId`、`measureId`、`startTick`、`endTick` 和 `focusTick`，跨小节时还可传 `endMeasureId` 和 `focusMeasureId`。单点选择令 `startTick === endTick`。成功时用 `before`、`after` 预览变化；失败返回 `{ ok: false, code, message }`。

提交 `LXMScoreCommandEnum.ApplyRhythmPattern` 时，用之前预览的 `confirmationKey` 填写 `expectedConfirmationKey`，即使无需确认也要传。提交沿用预览时的原始 `target` 和 `templateId`，因为规划结果里的 `plan.target` 可能已扩大到实际作用范围。键不匹配时返回 `STALE_RHYTHM_PATTERN_PLAN`，需重新预览。

- `requiresConfirmation` 只对应覆盖确认。为 `true` 时，用户确认后传 `allowOverwrite: true`，否则会收到 `RHYTHM_PATTERN_OVERWRITE_CONFIRMATION_REQUIRED`。
- `removedMarks` 非空时，按移除标记的影响单独确认，再传 `allowRemoveMarks: true`，否则会收到 `RHYTHM_PATTERN_CONFIRMATION_REQUIRED`。
- `discardedTextCount` 大于零时，按丢弃歌词或和弦的影响单独确认，再传 `allowDiscardMusicText: true`，否则会收到 `RHYTHM_PATTERN_TEXT_CONFIRMATION_REQUIRED`。

后两项确认适用于普通节奏型和整小节扫弦模板，单拍扫弦模板没有这两道提交检查。以下示例接着快速示例运行，把首拍改为两个八分音符。该合成谱上的这次修改无需确认，也照常传键。[合成谱](../demo/score.mjs)

```js
import { planRhythmPattern } from "@liuxianmao/lxm-editor";

const patternTarget = {
  layer: "tab",
  trackId: cell.trackId,
  measureId: cell.measureId,
  startTick: 0,
  endTick: 0,
  focusTick: 0,
};
const templateId = "eighths";
const pattern = planRhythmPattern(updated, patternTarget, templateId);
if (!pattern.ok) throw new Error(pattern.message);
const patterned = applyScoreCommand(updated, {
  type: LXMScoreCommandEnum.ApplyRhythmPattern,
  target: patternTarget,
  templateId,
  expectedRevision: updated.documentRevision,
  expectedConfirmationKey: pattern.confirmationKey,
});
if (!patterned.ok) throw new Error(patterned.message);
```

## 撤销与重做

每个宿主会话创建一份历史，并与当前文档一起更新。提交时存编辑前的快照。撤销或重做时，先从旧历史取恢复目标，再把切换前的当前文档传给转换函数。[完整撤销与重做示例](../demo/node.mjs)

```ts
declare function createDocumentHistory<Entry>(): DocumentHistory<Entry>;
declare function transitionDocumentHistory<Entry>(
  history: DocumentHistory<Entry>,
  action: DocumentHistoryAction<Entry>,
): DocumentHistory<Entry>;
```

`past` 和 `future` 是 `ILXMDocument[]`，对应的 `pastEntries`、`futureEntries` 是冻结的 `readonly Entry[]`。`past` 按旧到新排列，`future[0]` 是下一步重做目标。`Entry` 可保存条目 ID、文案等会话数据。转换共享文档和条目对象的引用，应把它们当作快照使用。`baselineAdvanced` 表示曾因 `HISTORY_LIMIT`（100）丢弃最早的历史快照和条目。

- `{ type: "commit", document, entry }` 追加编辑前的快照和条目，清空重做队列，超过上限时同步裁切快照和条目。
- `{ type: "commit", document, entry, replaceEntry: true }` 用于把连续编辑并为一条。它只替换最后一条的元数据，保留第一次编辑前的快照作为撤销目标，也保留 `future` 和 `futureEntries`。没有已应用条目时返回原历史。
- `{ type: "undo", document, keepCount }` 中 `keepCount` 是撤销后要保留的已应用条目数，恢复 `past[keepCount]`。撤销一步用 `past.length - 1`，回到当前保留的基线用 `0`。索引无效时返回原历史。
- `{ type: "redo", document }` 恢复 `future[0]`，重做队列为空时返回原历史。
- `{ type: "reset" }` 清空快照和条目并重置 `baselineAdvanced`，适合切换文档。

以下片段接着快速示例运行，把写入音符记入历史，再撤销这次编辑。[按钮接线示例](../demo/browser.mjs)

```js
import {
  createDocumentHistory,
  transitionDocumentHistory,
} from "@liuxianmao/lxm-editor";

let history = createDocumentHistory();
let current = score;
if (edit.changed) {
  history = transitionDocumentHistory(history, {
    type: "commit",
    document: current,
    entry: "写入音符",
  });
  current = updated;
}

const keepCount = history.past.length - 1;
const previous = history.past[keepCount];
if (previous) {
  history = transitionDocumentHistory(history, {
    type: "undo",
    document: current,
    keepCount,
  });
  current = previous;
}
```

## 布局、命中和场景

`buildLayout` 计算谱首、自动断行、小节位置、总尺寸和命中索引。同一份布局可用于绘制、命中和定位选区。文档更新或断行变化后，用新布局重新定位。[SVG 绘制和命中示例](../demo/browser.mjs)

### 计算布局和绘制场景

```ts
declare function buildLayout(
  document: ILXMDocument,
  options?: ILXMLayoutOptions,
): ILXMLayout;
declare function collectMusicTextMeasureRequests(
  document: ILXMDocument,
  showChordDiagrams?: boolean,
): ILXMMusicTextMeasureRequest[];
declare function buildScoreScene(layout: ILXMLayout): ScoreScene;
```

传已校验文档及有限的坐标和尺寸。布局使用 `score.tracks[0]`，没有轨道时返回空布局。默认原点 `x: 0`、`y: 0`，行宽 `systemWidth: 600`、行距 `systemGapY: 8`、小节间距 `measureGap: 0`、密度 `density: "comfortable"`。超宽小节可能使布局宽度超过 `systemWidth`。

默认 `purpose: "presentation"` 用于成品。设为 `"editing"` 时，可用 `editingTailWidth` 留出谱尾空间，并通过 `paragraphEditing` 或 `paragraphPlaceholders` 提供空谱行编辑信息。省略 `showChordDiagrams` 时，沿用各和弦自身的显示方式。

需要用实际字体排版时，调用 `collectMusicTextMeasureRequests`。把测得的字形 `x`、`y`、`width`、`height` 按请求的 `key` 填进布局选项的 `musicTextMetrics`。未提供时 Core 使用估算度量。

`buildScoreScene` 返回 `header` 和按谱行分组的 `systems`。按给定顺序绘制 `line`、`circle`、`rect`、`path`、`polygon`、`text` 等带样式的图元，并按需叠加选区和光标。部分图元带音乐对象 ID。宿主负责输入框、滚动、缩放、字体加载和 DOM、SVG 或 Canvas 绘制。[场景绘制示例](../demo/browser.mjs)

### 从坐标找到编辑目标

命中函数都接收 `ILXMLayout` 和逻辑坐标 `ILXMLayoutPoint`（`{ x, y }`），未命中返回 `null`。SVG 需要先把指针的视口坐标转换到布局坐标。`getScreenCTM()` 可能返回 `null`，示例先检查矩阵，再用逆矩阵转换。[浏览器指针事件示例](../demo/browser.mjs)

```js
import { hitTestLayout } from "@liuxianmao/lxm-editor";

function hitTabFromPointer(layout, svg, event) {
  const matrix = svg.getScreenCTM();
  if (!matrix) return null;
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
    matrix.inverse(),
  );
  return hitTestLayout(layout, point);
}
```

```ts
declare function hitTestLayout(
  layout: ILXMLayout,
  point: ILXMLayoutPoint,
): ILXMHitTarget | null;
declare function hitTestMusicText(
  layout: ILXMLayout,
  point: ILXMLayoutPoint,
): NonNullable<ILXMHitIndex["musicTextBounds"]>[number] | null;
declare function hitTestNumbered(
  layout: ILXMLayout,
  point: ILXMLayoutPoint,
): ILXMNumberedTarget | null;
declare function hitTestNumberedMark(
  layout: ILXMLayout,
  point: ILXMLayoutPoint,
  tolerance?: number,
): {
  markId: string;
  target: {
    kind: "numberedEvent";
    trackId: string;
    measureId: string;
    eventId: string;
  };
} | null;
declare function hitTestTechnique(
  layout: ILXMLayout,
  point: ILXMLayoutPoint,
): string | null;
declare function hitTestTechniqueTarget(
  layout: ILXMLayout,
  point: ILXMLayoutPoint,
): ILXMTechniqueHitTarget | null;
declare function hitTestTuplet(
  layout: ILXMLayout,
  point: ILXMLayoutPoint,
  tolerance?: number,
): {
  trackId: string;
  measureId: string;
  tupletId: string;
  beatIds: string[];
} | null;
```

- `hitTestLayout` 返回 TAB 单元格的 `trackId`、`systemIndex`、`measureId`、`beatId` 和 `string`。同一小节两个拍点的公共边界归较早的拍点。
- `hitTestMusicText` 返回命中的文本区域以及目标元数据，比如歌词或和弦的 ID 和锚点。`hitTestNumbered` 返回简谱事件、音符或空输入区的目标。
- `hitTestNumberedMark` 返回简谱标记 ID 和对应的事件目标。`tolerance` 默认为 `5`，表示距曲线的逻辑距离。
- `hitTestTechnique` 返回技巧 ID，优先命中标签墨迹，其次比较实际图元距离。需要起止端时用 `hitTestTechniqueTarget`，其 `focusEndpoint` 为 `"start"` 或 `"end"`。
- `hitTestTuplet` 返回 TAB 连音组和成员拍点的 ID。命中区域在数字和括号线段附近，逻辑容差 `tolerance` 默认为 `4`。

宿主可以按当前工具选择命中层。例如先查文字和简谱，再查技巧、连音和 TAB。应对当前布局做命中测试，断行后按稳定 ID 恢复选区。

### 移动选区并定位光标

```ts
declare function getFirstTabCellReference(
  document: ILXMDocument,
): ILXMTabCellReference | null;
declare function createCollapsedTabCellSelection(
  reference: ILXMTabCellReference,
): ILXMTabCellSelection;
declare function navigateTabCellSelection(
  document: ILXMDocument,
  selection: ILXMTabCellSelection,
  direction: ILXMTabCellNavigationDirection,
  extend?: boolean,
): ILXMNavigateTabCellSelectionResult;
declare function resolveTabCellSelection(
  document: ILXMDocument,
  selection: ILXMTabCellSelection,
): ILXMResolveTabCellSelectionResult;
declare function layoutTabCellSelection(
  layout: ILXMLayout,
  range: ILXMResolvedTabCellRange,
): ILXMTabCellSelectionRect[];
declare function layoutTabCellCaret(
  layout: ILXMLayout,
  reference: ILXMTabCellReference,
): ILXMTabCellCaretLayout | null;
```

`getFirstTabCellReference` 会按轨道顺序查找第一条有拍点的轨道，返回该轨首个单元格，完全没有拍点时返回 `null`。`buildLayout(document)` 和 `createPlaybackPlan(document)` 始终取第一条轨道。多轨文档中，用首个单元格初始化选区前，可先核对它的 `trackId` 与当前布局是否一致。[首个单元格示例](../demo/node.mjs)

用 `createCollapsedTabCellSelection` 从单个单元格生成 `anchor` 和 `focus`。`navigateTabCellSelection` 支持 `"left"`、`"right"`、`"up"`、`"down"`，默认 `extend: false`，传 `true` 可保留 `anchor` 并移动 `focus`。成功时读 `selection` 和 `changed`；方向上已无相邻目标时返回原选区，`changed` 为 `false`。

`resolveTabCellSelection` 检查轨道、弦号、稳定端点和 512 个单元格的上限。它按文档顺序规范化范围，成功时取 `result.range`。导航和范围解析失败时都返回 `code` 和 `message`。把范围交给 `layoutTabCellSelection` 得到选区矩形；把单元格交给 `layoutTabCellCaret` 得到光标位置。布局中找不到对应位置时，前者返回空数组，后者返回 `null`。

### 给成品谱分页

```ts
declare function paginateLayout(
  layout: ILXMLayout,
  options?: ILXMPageOptions,
): ILXMPaginationResult;
```

用成品布局分页时，建议在 `buildLayout` 阶段传目标纸张的可用内容宽度（默认 A4 对应 `A4_CONTENT_WIDTH`）。`paginateLayout` 默认用 `A4_PAGE_OPTIONS`，按完整谱行分页。分页保留原几何，通过每页记录的位移摆放谱首和谱行。

- 成功返回 `{ ok: true, pages, diagnostics: [] }`。`pages` 提供页面尺寸、谱行位移、首页谱首位移和页脚。
- 无法排入时返回 `{ ok: false, pages: [], diagnostics }`。诊断包含 `code`、`measureIds` 和可选的 `systemIndex`，例如无谱行、几何无效、谱首溢出或谱行过宽。
- 纸张配置数值非法时抛出 `RangeError`。尺寸、边距、页脚高度和行距须为有限数，边距、页脚高度和行距须非负，扣除边距和页脚后的可用宽高须为正。

以下片段接着快速示例运行。宿主使用 `pages` 中的 `systemIndex` 和位移摆放场景，再完成图片编码、打印或生成文件。[场景图元的 SVG 绘制示例](../demo/browser.mjs)

```js
import { A4_CONTENT_WIDTH, paginateLayout } from "@liuxianmao/lxm-editor";

const printLayout = buildLayout(updated, { systemWidth: A4_CONTENT_WIDTH });
const pagination = paginateLayout(printLayout);
if (!pagination.ok)
  throw new Error(pagination.diagnostics.map(({ code }) => code).join(", "));
const printScene = buildScoreScene(printLayout);
const pages = pagination.pages;
```

## 播放计划

用 `createPlaybackPlan` 展开反复并得到演奏时间线，再用当前播放时间定位谱面游标。传文档时使用首轨，也可以直接传入一条 `ILXMTrack`。[Node 播放计划示例](../demo/node.mjs)

```ts
declare function createPlaybackPlan(
  source: ILXMDocument | ILXMTrack,
  options?: PlaybackPlanOptions,
): PlaybackPlan;
declare function playbackTicksToSeconds(ticks: number, bpm: number): number;
declare function playbackSecondsToTicks(seconds: number, bpm: number): number;
declare function getPlaybackBeatAtTick(
  plan: PlaybackPlan,
  tick: number,
): PlaybackBeat | undefined;
```

- `bpm` 表示四分音符速度。显式传入有限数值时会限制在 20–300。省略或传非有限值时使用文档的 `tempoBpm`，无曲谱速度时用 90。
- `startMeasureId` 会在完整反复时间线中找到该小节的首次访问，并把该访问的起点移到 `0`。找不到时从谱首开始。
- `chordCatalog` 可提供标准调弦和弦目录快照。`midiRange` 用于限定采样可覆盖的音高，默认 `[0, 127]`，包含两端。

结果有 `bpm`、`durationTicks`、`visits`、`beats`、`sounds` 和 `warnings`。反复展开后，同一小节可对应多个 `visitIndex`。声音事件含音高、起止时间、演奏方式、音高变化和包络。没有轨道时，总时长为零且各序列为空。告警含 `code` 与 `measureIds`，例如缺少和弦指法、音高超限或反复无效。

时间换算应传有效的正 BPM。`getPlaybackBeatAtTick` 按 `[startTick, endTick)` 查找当前拍点，包含无声拍。对应时刻没有拍点时返回 `undefined`。以下片段接着快速示例运行，从所编辑的小节开始，得到总秒数和起始拍点。[计划和拍点断言](../demo/node.mjs)

```js
import {
  createPlaybackPlan,
  getPlaybackBeatAtTick,
  playbackSecondsToTicks,
  playbackTicksToSeconds,
} from "@liuxianmao/lxm-editor";

const plan = createPlaybackPlan(updated, { startMeasureId: cell.measureId });
const seconds = playbackTicksToSeconds(plan.durationTicks, plan.bpm);
const active = getPlaybackBeatAtTick(plan, playbackSecondsToTicks(0, plan.bpm));
```

播放计划面向吉他 TAB，简谱声部目前没有独立声音事件。宿主负责读取采样、建立音频时钟和音量、在浏览器用户手势中解锁音频、调度、暂停、停止、回收资源和同步游标。

## 支持范围

Core 可在 Node 或浏览器运行。当前谱面和播放计划面向单条吉他轨道。布局以逻辑单位表达，宿主负责映射到设备像素、DOM 或物理纸张，也负责字体安装、UI 控件、交互状态、文件工作流、音频设备和持久化。npm 包发布 ESM、类型声明、文档和合成示例资源。工作区里的内部谱例由原有站点维护。
