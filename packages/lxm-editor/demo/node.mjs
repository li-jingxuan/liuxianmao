import assert from "node:assert/strict";
import {
  LXMScoreCommandEnum, applyScoreCommand, buildLayout, buildScoreScene,
  createDocumentHistory, createPlaybackPlan, getFirstTabCellReference,
  getPlaybackBeatAtTick, loadDocument, transitionDocumentHistory, upgradeDocumentToCurrent,
} from "@liuxianmao/lxm-editor";
import { exampleScoreJson } from "./score.mjs";

const loaded = loadDocument(exampleScoreJson);
if (!loaded.ok) throw new Error(loaded.errors.join("\n"));
let score = loaded.document;
const cell = getFirstTabCellReference(score);
assert.ok(cell);
const result = applyScoreCommand(score, {
  type: LXMScoreCommandEnum.SetNote,
  ...cell,
  fret: 3,
  expectedRevision: score.documentRevision,
});
if (!result.ok) throw new Error(result.message);
assert.equal(result.changed, true);

// 每次转换传入当前快照，宿主从旧历史中取出即将恢复的快照。
let history = transitionDocumentHistory(createDocumentHistory(), {
  type: "commit", document: score, entry: "写入第 3 品",
});
score = result.document;
const previous = history.past[0];
history = transitionDocumentHistory(history, { type: "undo", document: score, keepCount: 0 });
score = previous;
assert.deepEqual(score, loaded.document);
const next = history.future[0];
history = transitionDocumentHistory(history, { type: "redo", document: score });
score = next;
assert.equal(history.future.length, 0);

const saved = loadDocument(JSON.stringify(score));
assert.deepEqual(saved, { ok: true, document: score });
const scene = buildScoreScene(buildLayout(score, { systemWidth: 600 }));
assert.ok(scene.systems.some(({ items }) => items.some((item) => item.kind === "text" && item.text === "3")));
const plan = createPlaybackPlan(score);
assert.equal(plan.sounds.length, 1);
assert.equal(getPlaybackBeatAtTick(plan, 0)?.beatId, cell.beatId);
assert.equal(loadDocument("{坏 JSON").ok, false);
assert.equal(applyScoreCommand(score, {
  type: LXMScoreCommandEnum.SetNote, ...cell, fret: 2, expectedRevision: loaded.document.documentRevision,
}).code, "STALE_NUMBERED_PLAN");

// 用同一小节构造旧格式，分别验证普通加载拒绝旧版本和显式升级成功。
const legacy = JSON.parse(exampleScoreJson);
legacy.schemaVersion = 7;
for (const track of legacy.score.tracks) {
  delete track.numberedMarks;
  for (const measure of track.measures) delete measure.numberedVoice;
}
assert.equal(loadDocument(JSON.stringify(legacy)).ok, false);
assert.deepEqual(upgradeDocumentToCurrent(legacy), loaded);
console.log(`Core v1 · rev ${score.documentRevision} · ${scene.systems.length} 行谱面 · ${plan.sounds.length} 个声音事件`);
