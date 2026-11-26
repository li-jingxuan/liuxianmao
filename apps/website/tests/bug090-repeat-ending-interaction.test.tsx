import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { A4_CONTENT_WIDTH, buildLayout, loadDocument } from "@liuxianmao/lxm-editor";
import { RepeatEndingInteractionLayer } from "../../../packages/lxm-editor-react/src/EditorShell/score/RepeatEndingInteractionLayer";

describe("BUG-090 反复房子编辑图层", () => {
  it("跨行段共用选中态，虚线草稿独立于框线与放大的命中区", () => {
    const fixture = new URL("../../../packages/lxm-editor/tests/fixtures/req106-three-endings.lxm", import.meta.url);
    const loaded = loadDocument(readFileSync(fixture, "utf8"));
    if (!loaded.ok) throw new Error(loaded.errors.join("\n"));
    const { document } = loaded;
    const group = document.score.tracks[0]!.repeatEndingGroups![0]!;
    const layout = buildLayout(document, {
      systemWidth: A4_CONTENT_WIDTH, purpose: "editing", density: "compact", editingTailWidth: 36,
      repeatEndingGroupPreview: group,
    });
    // 真实跨行谱件中，一房分两段。选中和焦点为独立图元，打开草稿未改变正式选中。
    const html = renderToStaticMarkup(<svg><RepeatEndingInteractionLayer layout={layout}
      selectedEndingId="ending-1" onEditEnding={() => {}} /></svg>);
    const selectedSegments = html.match(/data-repeat-ending-target="ending-1"[^>]*aria-pressed="true"/g) ?? [];
    expect(selectedSegments).toHaveLength(2);
    const outlines = html.match(/<rect data-repeat-ending-selected[^>]*>/g) ?? [];
    expect(outlines).toHaveLength(2);
    for (const outline of outlines) {
      expect(outline).toContain('stroke="#2457d7" stroke-width="1"');
      expect(outline).not.toContain("stroke-dasharray");
    }
    expect(html).toMatch(/<rect data-repeat-ending-hit[^>]*height="23"[^>]*pointer-events="all"/);
    expect(html).toMatch(/<rect data-repeat-ending-focus[^>]*stroke-dasharray="1 2.5"/);
    expect(html).toMatch(/data-repeat-ending-preview="true"[^>]*><line[^>]*stroke-dasharray="5 3"/);
    // 草稿跟随正式房子的字号，继续用蓝色区别草稿状态。
    expect(html).toMatch(/<text[^>]*font-size="7"[^>]*fill="#2457d7">1\.<\/text>/);
    expect(html).toContain('data-repeat-ending-group-preview="shared"');
    expect(html).toContain('data-repeat-ending-group-preview="ending"');
  });
});
