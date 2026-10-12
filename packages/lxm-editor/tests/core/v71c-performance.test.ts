import { it, expect } from "vitest";
import { performance } from "node:perf_hooks";
import { EXAMPLE_MVP7C_LONG_DOCUMENT } from "../../example/example-mvp7c";
import { buildLayout } from "../../src/layout";
import { loadDocument } from "../../src/core/loader";
import {
  applyScoreCommand,
  LXMScoreCommandEnum as C,
} from "../../src/core/commands";
import {
  createBeatClipboard,
  planBeatPaste,
} from "../../src/core/beat-clipboard";
/** 100 小节实际混合内容的可重复基线，不将机器耗时硬编码为产品验收阈值。 */
it("100 小节加载、布局、记谱编辑与复用均保持合法", () => {
  const d = EXAMPLE_MVP7C_LONG_DOCUMENT,
    t = d.score.tracks[0]!,
    m = t.measures[0]!,
    target = { trackId: t.id, measureId: m.id, beatId: m.beats[0]!.id };
  expect(t.measures).toHaveLength(100);
  expect(loadDocument(JSON.stringify(d)).ok).toBe(true);
  const samples: { layout: number; edit: number; paste: number }[] = [];
  for (let i = 0; i < 6; i++) {
    let start = performance.now();
    const layout = buildLayout(d, {
      systemWidth: 734,
      density: i % 2 ? "compact" : "comfortable",
    });
    const layoutMs = performance.now() - start;
    expect(layout.systems.length).toBeGreaterThan(20);
    expect(layout.systems.flatMap((s) => s.measures)).toHaveLength(100);
    start = performance.now();
    const r = applyScoreCommand(d, {
      type: C.SetNumbered,
      ...target,
      tokens: ["1"],
    });
    const edit = performance.now() - start;
    expect(r.ok).toBe(true);
    const clip = createBeatClipboard(d, {
      ...target,
      startBeatId: target.beatId,
      endBeatId: target.beatId,
    });
    if (!clip.ok) throw Error(clip.message);
    start = performance.now();
    const p = planBeatPaste(
      d,
      { ...target, mode: "overwrite" },
      clip.clipboard,
    );
    if (!p.ok) throw Error(p.message);
    const pasted = applyScoreCommand(d, {
      type: C.PasteBeats,
      ...target,
      mode: "overwrite",
      clipboard: clip.clipboard,
      allowOverwrite: true,
      expectedConfirmationKey: p.confirmationKey,
    });
    const paste = performance.now() - start;
    expect(pasted.ok).toBe(true);
    samples.push({ layout: layoutMs, edit, paste });
  }
  const measured = samples.slice(1);
  const summary = Object.fromEntries(
    (["layout", "edit", "paste"] as const).map((k) => {
      const values = measured.map((s) => s[k]).sort((a, b) => a - b);
      return [
        k,
        { medianMs: +values[2]!.toFixed(2), maxMs: +values.at(-1)!.toFixed(2) },
      ];
    }),
  );
  console.log("MVP7.1-C 100-measure baseline", JSON.stringify(summary));
}, 30000);
