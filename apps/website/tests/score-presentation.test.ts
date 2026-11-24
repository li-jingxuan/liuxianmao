import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  A4_CONTENT_WIDTH,
  buildLayout,
  collectMusicTextMeasureRequests,
} from "@liuxianmao/lxm-editor";
import { EXAMPLE_MVP_7_2_DOCUMENT } from "../../../packages/lxm-editor/example/fixtures";
import { prepareScorePresentation } from "../../../packages/lxm-editor-react/src/EditorShell/output/image-export-controller";
import { buildScoreScene } from "@liuxianmao/lxm-editor";
import { ScorePresentationPage } from "../../../packages/lxm-editor-react/src/EditorShell/output/ScorePresentationPage";

afterEach(() => vi.unstubAllGlobals());
describe("成品快照供预览、图片与打印消费", () => {
  it.each([true, false])("字体就绪后使用全局和弦显示 %s 重新生成成品坐标", async (showChordDiagrams) => {
    const bbox = { x: -4, y: -12, width: 8, height: 15.5 };
    vi.stubGlobal("document", {
      fonts: {
        load: () => Promise.resolve([{}]),
        ready: Promise.resolve(),
        check: () => true,
      },
      createElement: () => ({
        getContext: () => ({
          measureText: () => ({
            actualBoundingBoxLeft: 2,
            actualBoundingBoxRight: 2,
            actualBoundingBoxAscent: 9,
            actualBoundingBoxDescent: 5,
          }),
        }),
      }),
      createElementNS: () => ({
        style: {},
        setAttribute: () => {},
        appendChild: () => {},
        remove: () => {},
        getBBox: () => bbox,
      }),
      body: { appendChild: () => {} },
    });
    const score = EXAMPLE_MVP_7_2_DOCUMENT;
    const metrics = Object.fromEntries(
      collectMusicTextMeasureRequests(score, showChordDiagrams).map((r) => [
        r.key,
        r.fontFamily === "Bravura"
          ? { x: -2, y: -9, width: 4, height: 14 }
          : bbox,
      ]),
    );
    const prepared = await prepareScorePresentation(
      score,
      "compact",
      showChordDiagrams,
      new AbortController().signal,
    );
    const options = {
      systemWidth: A4_CONTENT_WIDTH,
      density: "compact" as const,
      showChordDiagrams,
      musicTextMetrics: metrics,
    };
    expect(prepared.scene).toEqual(
      buildScoreScene(
        buildLayout(score, { ...options, purpose: "presentation" }),
      ),
    );
    expect(prepared.scene).not.toEqual(
      buildScoreScene(buildLayout(score, { ...options, purpose: "editing" })),
    );
    const markup = renderToStaticMarkup(
      createElement(ScorePresentationPage, {
        prepared,
        page: prepared.pages[0]!,
      }),
    );
    expect(markup).toContain("A4 乐谱第 1 页");
    expect(markup).not.toContain("data-paragraph-cell");
    expect(markup).not.toContain("data-paragraph-hover");
    expect(markup).not.toContain("data-paragraph-focus");
  });
});
