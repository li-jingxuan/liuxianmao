import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildLayout, EXAMPLE_MVP_6_DOCUMENT } from "@liuxianmao/lxm-editor";
import { resolveNextLyricTarget } from "../components/EditorShell/music-text-target";
import {
  resolveLyricFocus,
  resolveParagraphFocus,
} from "../components/EditorShell/music-text-focus";
import {
  resolveMusicTextHoverTarget,
  sameMusicTextTarget,
} from "../components/EditorShell/music-text-hover";
import { resolveScorePointerAction } from "../components/EditorShell/editor-object-selection";
import { MusicTextEditingHints } from "../components/EditorShell/MusicTextEditingHints";
import { buildScoreScene } from "../components/EditorShell/score-scene";

const fixture = () => {
  const document = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
  const track = document.score.tracks[0]!;
  track.techniques = [];
  for (const measure of track.measures) {
    measure.beats = [];
    measure.tuplets = [];
    measure.chordSymbols = [];
  }
  const measure = track.measures[0]!;
  const target = {
    kind: "lyric" as const,
    trackId: track.id,
    measureId: measure.id,
    eventId: measure.numberedVoice.events[0]!.id,
    verse: 1 as const,
  };
  return { document, track, measure, target };
};

describe("歌词的独立简谱事件目标", () => {
  it("无 TAB 时命中、悬停、焦点与共享场景均使用同一 eventId", () => {
    const { document, target } = fixture();
    const layout = buildLayout(document, {
      purpose: "editing",
      paragraphEditing: target,
    });
    const focus = resolveLyricFocus(layout, target)!;
    expect(focus.eventId).toBe(target.eventId);
    const point = {
      x: focus.x + focus.width / 2,
      y: focus.y + focus.height / 2,
    };
    const hover = resolveMusicTextHoverTarget(layout, point)!;
    expect(hover).toEqual(target);
    const action = resolveScorePointerAction(
      document,
      layout,
      point,
      null,
      false,
    )!;
    expect(action).toMatchObject({ type: "target", target });
    expect(action.type === "target" && action.target.beatId).toBeUndefined();
    expect(sameMusicTextTarget(hover, target)).toBe(true);
    expect(sameMusicTextTarget(hover, { ...target, verse: 2 })).toBe(false);
    expect(sameMusicTextTarget(hover, { ...target, eventId: "other" })).toBe(
      false,
    );
    expect(resolveParagraphFocus(layout, target)).toMatchObject({
      id: target.eventId,
      kind: "lyric",
    });
    expect(
      buildScoreScene(layout).systems.flatMap((system) => system.items),
    ).toContainEqual(expect.objectContaining({ kind: "text", text: "风" }));
  });

  it("空歌词格的编辑提示按 eventId 标识并与简谱事件锚点对齐", () => {
    const { document, measure, target } = fixture();
    measure.lyrics = [];
    const layout = buildLayout(document, {
      purpose: "editing",
      paragraphEditing: target,
    });
    const system = layout.systems[0]!;
    const cell = system.musicTextCells!.find(
      (item) => item.kind === "lyric" && item.eventId === target.eventId,
    )!;
    // 压窄单元格以验证 marker 分支必须使用简谱真实锚点。
    cell.width = 10;
    const anchor = system.measures[0]!.numberedSlots.find(
      (item) => item.id === target.eventId,
    )!.x;
    const markup = renderToStaticMarkup(
      createElement(MusicTextEditingHints, {
        layout,
        activeFocus: null,
        hoverFocus: null,
      }),
    );
    expect(markup).toContain(
      `data-paragraph-cell="lyric/${target.measureId}/${target.eventId}/1"`,
    );
    expect(markup).toContain(`x1="${anchor}" x2="${anchor}"`);
  });

  it("单音符前进跳过休止、按 tick 排序并跨小节，失效目标不回退", () => {
    const { document, track, measure, target } = fixture();
    const [first, second, third] = measure.numberedVoice.events;
    second!.kind = "rest";
    second!.items = [];
    measure.numberedVoice.events = [third!, second!, first!];
    expect(resolveNextLyricTarget(document, target)).toEqual({
      ...target,
      eventId: third!.id,
    });
    expect(
      resolveNextLyricTarget(document, { ...target, eventId: third!.id }),
    ).toEqual({
      ...target,
      measureId: track.measures[1]!.id,
      eventId: track.measures[1]!.numberedVoice.events[0]!.id,
    });
    expect(
      resolveNextLyricTarget(document, { ...target, eventId: "missing" }),
    ).toBeNull();
  });
});
