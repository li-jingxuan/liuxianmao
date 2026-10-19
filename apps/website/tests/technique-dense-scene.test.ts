import { describe, expect, it } from "vitest";
import { A4_CONTENT_WIDTH, buildLayout } from "@liuxianmao/lxm-editor";
import {
  screenshot,
  chordPair,
} from "../../../packages/lxm-editor/tests/fixtures/technique-dense-chords";
import { buildScoreScene } from "../components/EditorShell/score-scene";

/** 页面 SVG 与图片 Canvas 必须消费同一套路径，特别是内嵌 H 的断开弧线。 */
describe("密集技巧的页面及导出图元", () => {
  it.each(["editing", "presentation"] as const)(
    "%s 不丢失弧线或标签",
    (purpose) => {
      for (const document of [
        screenshot(),
        chordPair([1, 2, 3, 4, 5, 6], "hammerOn", true),
      ]) {
        const layout = buildLayout(document, {
          purpose,
          density: "compact",
          systemWidth: A4_CONTENT_WIDTH,
        });
        const scene = buildScoreScene(layout);
        for (const segment of layout.systems.flatMap((s) => s.techniques)) {
          const items = scene.systems
            .flatMap((s) => s.items)
            .filter((p) => p.techniqueId === segment.techniqueId);
          if (segment.path)
            expect(
              items.some((p) => p.kind === "path" && p.d === segment.path!.d),
            ).toBe(true);
          for (const label of segment.texts)
            expect(
              items.some(
                (p) =>
                  p.kind === "text" &&
                  p.text === label.text &&
                  p.x === label.x &&
                  p.y === label.y &&
                  p.fontSize === label.fontSize,
              ),
            ).toBe(true);
        }
      }
    },
  );
});
