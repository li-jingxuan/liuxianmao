import { expect, it } from "vitest";
import {
  buildLayout,
  EXAMPLE_MVP7C_LONG_DOCUMENT,
} from "@liuxianmao/lxm-editor";
import { buildScoreScene } from "../components/EditorShell/score-scene";
/** 记录双层几何的真实规模，文件结构预算与派生布局预算分别验证。 */
it("100 小节独立简谱派生几何具有有限节点预算", () => {
  const layout = buildLayout(EXAMPLE_MVP7C_LONG_DOCUMENT);
  const scene = buildScoreScene(layout);
  const count = (value: unknown) => {
    const stack = [value];
    let nodes = 0;
    while (stack.length) {
      const v = stack.pop();
      nodes++;
      if (v && typeof v === "object") stack.push(...Object.values(v));
    }
    return nodes;
  };
  const sizes = {
    document: count(EXAMPLE_MVP7C_LONG_DOCUMENT),
    layout: count(layout),
    scene: count(scene),
  };
  expect(sizes.document).toBeLessThan(200_000);
  expect(sizes.layout).toBeLessThan(200_000);
  expect(sizes.scene).toBeLessThan(200_000);
});
