import { it, expect } from "vitest";
import { cpus, platform, release, totalmem } from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import {
  createQualityScore,
  buildLayout,
  paginateLayout,
  A4_CONTENT_WIDTH,
  applyScoreCommand,
  LXMScoreCommandEnum,
  loadDocument,
} from "../packages/lxm-editor/src";
import { createEditorSession } from "../apps/website/stores/editor-store";
import { buildScoreScene } from "../apps/website/components/EditorShell/score-scene";

/** 固定数据、预热及采样；报告 Node 计算耗时，不伪装为浏览器可见更新。 */
it("记录 100 小节计算与历史基线", () => {
  const score = createQualityScore(100),
    track = score.score.tracks[0]!,
    measure = track.measures[0]!,
    beat = measure.beats[0]!;
  const layout = buildLayout(score, {
    systemWidth: A4_CONTENT_WIDTH,
    density: "compact",
  });
  const sample = (run: () => unknown) => {
    for (let i = 0; i < 5; i++) run();
    const values = Array.from({ length: 30 }, () => {
      const start = performance.now();
      run();
      return performance.now() - start;
    }).sort((a, b) => a - b);
    return { p50Ms: values[14], p95Ms: values[28], samples: 30 };
  };
  const results = {
    layout: sample(() =>
      buildLayout(score, { systemWidth: A4_CONTENT_WIDTH, density: "compact" }),
    ),
    pagination: sample(() => paginateLayout(layout)),
    scene: sample(() => buildScoreScene(layout)),
    singleEdit: sample(() =>
      applyScoreCommand(score, {
        type: LXMScoreCommandEnum.SetNote,
        trackId: track.id,
        measureId: measure.id,
        beatId: beat.id,
        string: 6,
        fret: 8,
      }),
    ),
    copy16: sample(() =>
      applyScoreCommand(score, {
        type: LXMScoreCommandEnum.CopyMeasureRange,
        trackId: track.id,
        sourceStartMeasureId: track.measures[0]!.id,
        sourceEndMeasureId: track.measures[15]!.id,
        afterMeasureId: track.measures.at(-1)!.id,
      }),
    ),
  };
  const session = createEditorSession(score);
  const before = process.memoryUsage();
  const start = performance.now();
  for (let i = 0; i < 100; i++)
    session
      .getState()
      .execute({
        type: LXMScoreCommandEnum.SetNote,
        trackId: track.id,
        measureId: measure.id,
        beatId: beat.id,
        string: 6,
        fret: i % 24,
      });
  expect(session.getState().historyDepth.past).toBe(100);
  for (let i = 0; i < 100; i++) session.getState().undo();
  expect(session.getState().document).toEqual(score);
  for (let i = 0; i < 100; i++) session.getState().redo();
  expect(loadDocument(JSON.stringify(session.getState().document)).ok).toBe(
    true,
  );
  const result = {
    date: "2026-10-12",
    runtime: process.version,
    machine: {
      cpu: cpus()[0]?.model,
      cores: cpus().length,
      platform: platform(),
      release: release(),
      totalMemory: totalmem(),
    },
    fixture: {
      measures: 100,
      systems: layout.systems.length,
      pages: paginateLayout(layout).pages.length,
      density: "compact",
      fontMetrics: "fallback (Node)",
    },
    results,
    history: {
      edits: 100,
      undos: 100,
      redos: 100,
      elapsedMs: performance.now() - start,
      before,
      after: process.memoryUsage(),
    },
    limitations:
      "Node 计算与进程内存，不含真实字体度量、React/DOM、浏览器峰值内存或图片编码；不替代桌面性能验收",
  };
  mkdirSync("docs/mvp/v7/验收数据", { recursive: true });
  writeFileSync(
    "docs/mvp/v7/验收数据/20261012_100小节性能基线.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
}, 30000);
