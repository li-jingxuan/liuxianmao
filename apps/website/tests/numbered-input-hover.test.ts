import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  applyScoreCommand,
  buildLayout,
  type ILXMRhythm,
} from "@liuxianmao/lxm-editor";
import { EXAMPLE_MVP_7_2_DOCUMENT } from "../../../packages/lxm-editor/example/fixtures";
import {
  resolveMusicTextHoverTarget,
  sameMusicTextTarget,
} from "../../../packages/lxm-editor-react/src/EditorShell/music-text/music-text-hover";
import { resolveScorePointerAction } from "../../../packages/lxm-editor-react/src/EditorShell/session/editor-object-selection";
import { resolveParagraphFocus } from "../../../packages/lxm-editor-react/src/EditorShell/score/music-text-focus";
import {
  resolveNumberedEditorTarget,
  numberedTargetWindow,
} from "../../../packages/lxm-editor-react/src/EditorShell/numbered/numbered-editor-target";
import { MusicTextEditingHints } from "../../../packages/lxm-editor-react/src/EditorShell/score/MusicTextEditingHints";
import { createEditorSessionStore as createEditorSession } from "../../../packages/lxm-editor-react/src/stores/editor-store";
import { createMusicTextMetricReader } from "../../../packages/lxm-editor-react/src/EditorShell/score/music-text-metric-reader";

describe("简谱空位与 hover 接入", () => {
  it.each([
    { base: "eighth", dots: 0 },
    { base: "sixteenth", dots: 0 },
    { base: "quarter", dots: 1 },
    { base: "half", dots: 0 },
  ] satisfies ILXMRhythm[])("单音 $base/$dots 的数字与节奏区域使用同一个 hover 目标和框", (rhythm) => {
    const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
    const track = document.score.tracks[0]!;
    track.numberedMarks = [];
    const measure = track.measures[0]!;
    measure.numberedVoice = {
      events: [{
        ...measure.numberedVoice.events[0]!,
        kind: "notes",
        rhythm,
        items: [{ id: "hover-note", token: "5" }],
      }],
      tuplets: [],
    };
    const layout = buildLayout(document, { purpose: "editing" });
    const notation = layout.systems[0]!.measures[0]!.numberedNotation![0]!;
    const item = notation.itemBounds![0]!;
    const digit = {
      x: item.bounds.x + item.bounds.width / 2,
      y: item.bounds.y + item.bounds.height / 2,
    };
    // 位于事件矩形右下角，避开数字本体，覆盖减时线、附点及延时线的事件命中分支。
    const rhythmPoint = {
      x: notation.bounds.x + notation.bounds.width - 0.01,
      y: notation.bounds.y + notation.bounds.height - 0.01,
    };
    expect(
      rhythmPoint.x > item.bounds.x + item.bounds.width ||
      rhythmPoint.y > item.bounds.y + item.bounds.height,
    ).toBe(true);
    const hover = resolveMusicTextHoverTarget(layout, digit)!;
    const outerHover = resolveMusicTextHoverTarget(layout, rhythmPoint)!;
    expect(outerHover).toEqual(hover);
    expect(hover).toMatchObject({ eventId: notation.eventId, itemId: item.itemId });
    expect(sameMusicTextTarget(hover, outerHover)).toBe(true);
    const focus = resolveParagraphFocus(layout, hover)!;
    expect(focus).toEqual(resolveParagraphFocus(layout, outerHover));
    expect(focus).toEqual(resolveParagraphFocus(layout, { ...hover, itemId: undefined }));
    expect(focus.width).toBeGreaterThanOrEqual(18);
    expect(focus.x + focus.width / 2).toBeCloseTo(notation.labels[0]!.x);
    expect(focus.width).toBe(18);
    expect(focus.y).toBeLessThan(notation.bounds.y);
    expect(focus.height).toBe(20);
    expect(resolveScorePointerAction(document, layout, rhythmPoint, null, false)).toMatchObject({ type: "target", target: hover });
  });

  it("同时多音保留各成员 hover 和整体事件命中", () => {
    const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
    const track = document.score.tracks[0]!;
    track.numberedMarks = [];
    const measure = track.measures[0]!;
    measure.numberedVoice = {
      events: [{
        ...measure.numberedVoice.events[0]!,
        kind: "notes",
        rhythm: { base: "eighth", dots: 0 },
        items: [{ id: "low", token: "3" }, { id: "high", token: "5" }],
      }],
      tuplets: [],
    };
    const layout = buildLayout(document, { purpose: "editing" });
    const notation = layout.systems[0]!.measures[0]!.numberedNotation![0]!;
    const whole = {
      kind: "numbered" as const,
      trackId: track.id,
      measureId: measure.id,
      eventId: notation.eventId,
    };
    const wholeFocus = resolveParagraphFocus(layout, whole)!;
    for (const item of notation.itemBounds!) {
      const hover = resolveMusicTextHoverTarget(layout, {
        x: item.bounds.x + item.bounds.width / 2,
        y: item.bounds.y + item.bounds.height / 2,
      })!;
      expect(hover).toMatchObject({ itemId: item.itemId });
      expect(resolveParagraphFocus(layout, hover)!.width).toBeLessThan(wholeFocus.width);
      expect(sameMusicTextTarget(whole, hover)).toBe(false);
    }
    const eventHover = resolveMusicTextHoverTarget(layout, {
      x: notation.bounds.x + notation.bounds.width - 0.01,
      y: notation.bounds.y + notation.bounds.height - 0.01,
    })!;
    expect(eventHover).toMatchObject(whole);
    expect(eventHover).not.toHaveProperty("itemId");
  });

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
    const gap = document.score.tracks[0]!.measures[0]!.numberedVoice.events.find(event => event.kind === "gap" && event.tick === 480)!;
    expect(hover).toMatchObject({ kind: "numbered", eventId: gap.id });
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
    // 空位提示框与悬停/选中统一使用窄框，不再沿用时间槽24单位的命中宽度。
    const frame = resolveParagraphFocus(layout, hover)!;
    const placeholder = hint.match(/<rect[^>]*data-paragraph-placeholder="box"[^>]*>/g)!
      .find(tag => tag.includes(`data-paragraph-cell="numbered/${slot.key}"`))!;
    expect(frame.width).toBe(18);
    for (const name of ["x", "y", "width", "height"] as const)
      expect(placeholder).toContain(`${name}="${frame[name]}"`);
    const filled = applyScoreCommand(document, {
      type: "numbered.event.set",
      trackId: track.id,
      measureId: measure.id,
      eventId: gap.id,
      tokens: ["3"],
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
