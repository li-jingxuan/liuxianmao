import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  LXMScoreCommandEnum,
  applyScoreCommand,
  buildLayout,
  buildScoreScene,
  createDocumentHistory,
  createPlaybackPlan,
  getFirstTabCellReference,
  getPlaybackBeatAtTick,
  hitTestLayout,
  layoutTabCellCaret,
  loadDocument,
  playbackTicksToSeconds,
  transitionDocumentHistory,
} from "@liuxianmao/lxm-editor";

// 按脚本位置读入合成谱，这样从其他目录执行也能定位样例文件。
const input = await readFile(new URL("./synthetic-score.lxm", import.meta.url), "utf8");
const loaded = loadDocument(input);
if (!loaded.ok) throw new Error(loaded.errors.join("\n"));

let score = loaded.document;
let history = createDocumentHistory();
const cell = getFirstTabCellReference(score);
assert.ok(cell, "合成谱应有可编辑的 TAB 单元格");
assert.equal(cell.string, 1);

const edit = applyScoreCommand(score, {
  type: LXMScoreCommandEnum.SetNote,
  ...cell,
  fret: 3,
  expectedRevision: score.documentRevision,
});
if (!edit.ok) throw new Error(`${edit.code} ${edit.message}`);
assert.equal(edit.changed, true);
assert.equal(edit.document.documentRevision, score.documentRevision + 1);

// 提交要记录编辑前的文档，否则撤销会恢复到已写入品位的快照。
history = transitionDocumentHistory(history, {
  type: "commit",
  document: score,
  entry: "第 1 弦写入第 3 品",
});
score = edit.document;

// 历史转换只返回新历史。先从旧历史取恢复对象，再切换当前文档。
const keepCount = history.past.length - 1;
const previous = history.past[keepCount];
history = transitionDocumentHistory(history, { type: "undo", document: score, keepCount });
score = previous;
assert.deepEqual(score, loaded.document);
assert.equal(createPlaybackPlan(score).sounds.length, 0);
assert.deepEqual(history.futureEntries, ["第 1 弦写入第 3 品"]);

const next = history.future[0];
history = transitionDocumentHistory(history, { type: "redo", document: score });
score = next;
assert.deepEqual(score, edit.document);
assert.equal(history.future.length, 0);

// .lxm 的内容就是文档 JSON。在内存中回读，避免覆盖任何输入文件。
const serialized = JSON.stringify(score, null, 2);
const reopened = loadDocument(serialized);
if (!reopened.ok) throw new Error(reopened.errors.join("\n"));
assert.deepEqual(reopened.document, score);

const layout = buildLayout(reopened.document, { systemWidth: 600 });
const caret = layoutTabCellCaret(layout, cell);
assert.ok(caret);
// 光标中心和命中函数使用同一套逻辑坐标，可按命中返回的稳定 ID 再次编辑。
const hit = hitTestLayout(layout, {
  x: caret.x + caret.width / 2,
  y: caret.y + caret.height / 2,
});
assert.deepEqual(hit, { ...cell, systemIndex: caret.systemIndex });
const scene = buildScoreScene(layout);
assert.ok(scene.systems.some(({ items }) => items.some(
  (item) => item.kind === "text" && item.text === "3",
)));

// 第 1 弦空弦是 E4（MIDI 64），第 3 品应产生 G4（MIDI 67）。
const plan = createPlaybackPlan(reopened.document);
assert.deepEqual(plan.sounds.map(({ midi }) => midi), [67]);
assert.equal(getPlaybackBeatAtTick(plan, 0)?.beatId, cell.beatId);
const seconds = playbackTicksToSeconds(plan.durationTicks, plan.bpm);
assert.equal(seconds, 2);

console.log(`修订 ${reopened.document.documentRevision}，${scene.systems.length} 行谱面，${plan.sounds.length} 个声音事件，共 ${seconds} 秒`);
