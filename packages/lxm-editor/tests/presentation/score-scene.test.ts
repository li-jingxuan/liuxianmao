import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildLayout,
  buildScoreScene,
  EXAMPLE_MVP_7_2_DOCUMENT,
  SCORE_TEXT_FONT,
  textPrimitive,
} from "../../src/index";
import { screenshot } from "../fixtures/technique-dense-chords";

/** Node 直接消费公共入口；摘要同时锁定图元顺序、身份、样式与坐标。 */
describe("纯音乐场景投影", () => {
  it.each(["editing", "presentation"] as const)(
    "%s 保留简谱与密集技巧的完整绘制输出",
    (purpose) => {
      const scenes = [EXAMPLE_MVP_7_2_DOCUMENT, screenshot()].map((document) => {
        const layout = buildLayout(document, { purpose });
        const before = JSON.stringify(layout);
        const scene = buildScoreScene(layout);
        expect(JSON.stringify(layout)).toBe(before);
        expect(scene.systems.map((system) => system.index)).toEqual(
          layout.systems.map((system) => system.index),
        );
        expect(scene.systems.some((system) => system.items.length > 0)).toBe(true);
        return scene;
      });
      expect(createHash("sha256").update(JSON.stringify(scenes)).digest("hex"))
        .toMatchSnapshot();
    },
  );

  it("文字声明包含显式字体及白色描边，无需宿主 CSS", () => {
    expect(textPrimitive("7", 12, 24, 16, "middle", SCORE_TEXT_FONT, 1))
      .toEqual({
        kind: "text", text: "7", x: 12, y: 24, fontSize: 16,
        textAnchor: "middle", fontFamily: SCORE_TEXT_FONT, fontWeight: 400,
        fill: "#1d2025", stroke: "#fff", strokeWidth: 2,
      });
  });
});
