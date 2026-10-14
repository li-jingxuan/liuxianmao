import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  applyScoreCommand,
  buildLayout,
  EXAMPLE_MVP_7_2_DOCUMENT,
} from "@liuxianmao/lxm-editor";
import {
  resolveMusicTextHoverTarget,
  sameMusicTextTarget,
} from "../components/EditorShell/music-text-hover";
import { resolveScorePointerAction } from "../components/EditorShell/editor-object-selection";
import { resolveParagraphFocus } from "../components/EditorShell/music-text-focus";
import {
  resolveNumberedEditorTarget,
  numberedTargetWindow,
} from "../components/EditorShell/numbered-editor-target";
import { MusicTextEditingHints } from "../components/EditorShell/MusicTextEditingHints";
import { createEditorSession } from "../stores/editor-store";
import { createMusicTextMetricReader } from "../components/EditorShell/music-text-metric-reader";

describe("简谱空位与 hover 接入", () => {
  it("缩短、填入占位与撤销共用真实时间窗口，提示仅在编辑层绘制", () => {
    const initial = EXAMPLE_MVP_7_2_DOCUMENT,
      track = initial.score.tracks[0]!,
      measure = track.measures[0]!,
      event = measure.numberedVoice.events[0]!;
    const store = createEditorSession(initial);
    store.getState().execute({
      type: "numbered.event.setRhythm",
      trackId: track.id,
      measureId: measure.id,
      eventId: event.id,
      rhythm: { base: "eighth", dots: 0 },
    });
    const document = store.getState().document!,
      layout = buildLayout(document, { purpose: "editing" });
    const m = layout.systems
      .flatMap((s) => s.measures)
      .find((m) => m.id === measure.id)!;
    const slot = m.numberedInputSlots!.find((s) => s.startTick === 480)!;
    const point = { x: slot.anchorX, y: slot.y + slot.height / 2 };
    const hover = resolveMusicTextHoverTarget(layout, point)!;
    expect(hover).toMatchObject({ kind: "numbered", tick: 480, endTick: 960 });
    expect(
      resolveScorePointerAction(document, layout, point, null, false),
    ).toMatchObject({ type: "target", target: hover });
    const target = resolveNumberedEditorTarget(document, hover)!;
    expect(numberedTargetWindow(document, target)).toEqual({
      start: 480,
      end: 960,
    });
    const hint = renderToStaticMarkup(
      createElement(MusicTextEditingHints, {
        layout,
        activeFocus: null,
        hoverFocus: resolveParagraphFocus(layout, hover),
      }),
    );
    expect(hint).toContain(`data-paragraph-cell="numbered/${slot.key}"`);
    expect(hint).toContain('data-paragraph-hover="numbered"');
    const filled = applyScoreCommand(document, {
      type: "numbered.range.replace",
      trackId: track.id,
      measureId: measure.id,
      startTick: 480,
      endTick: 960,
      items: [{ kind: "set", tokens: ["3"] }],
      rhythms: [{ base: "eighth", dots: 0 }],
      allowOverwrite: false,
    });
    if (!filled.ok) throw Error(filled.message);
    expect(
      buildLayout(filled.document, { purpose: "editing" })
        .systems.flatMap((s) => s.measures)
        .find((m) => m.id === measure.id)!.numberedInputSlots,
    ).toEqual([]);
    store.getState().undo();
    expect(store.getState().document).toEqual(initial);
    store.getState().redo();
    expect(
      buildLayout(store.getState().document!, { purpose: "editing" })
        .systems.flatMap((s) => s.measures)
        .find((m) => m.id === measure.id)!.numberedInputSlots,
    ).toContainEqual(slot);
    expect(store.getState().selection).toBeNull();
  });
  it("同小节不同空白窗口不会被 undefined beatId 当成同一目标", () => {
    const first = {
      kind: "numbered" as const,
      trackId: "t",
      measureId: "m",
      tick: 480,
      endTick: 960,
    };
    expect(sameMusicTextTarget(first, { ...first })).toBe(true);
    expect(
      sameMusicTextTarget(first, { ...first, tick: 960, endTick: 1920 }),
    ).toBe(false);
  });
  it("音乐字形使用实际墨迹边界，而不是整套字库的 SVG 字体框", () => {
    const context = {
      measureText: () => ({
        actualBoundingBoxLeft: 2,
        actualBoundingBoxRight: 2,
        actualBoundingBoxAscent: 9,
        actualBoundingBoxDescent: 5,
      }),
    };
    const oldDocument = globalThis.document;
    try {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: { createElement: () => ({ getContext: () => context }) },
      });
      const read = createMusicTextMetricReader({} as SVGSVGElement);
      expect(
        read({
          key: "glyph",
          text: "\uE262",
          fontFamily: "Bravura",
          fontSize: 16,
          fontWeight: 400,
          textAnchor: "middle",
        }),
      ).toEqual({ x: -2, y: -9, width: 4, height: 14 });
    } finally {
      if (oldDocument)
        Object.defineProperty(globalThis, "document", {
          configurable: true,
          value: oldDocument,
        });
      else Reflect.deleteProperty(globalThis, "document");
    }
  });
});
