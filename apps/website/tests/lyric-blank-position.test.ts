import { describe, expect, it } from "vitest";
import {
  buildLayout,
  EXAMPLE_MVP_7_2_DOCUMENT,
  applyScoreCommand,
  LXMScoreCommandEnum,
} from "@liuxianmao/lxm-editor";
import { readMusicTextDraft } from "../components/EditorShell/music-text-draft";
import {
  resolveNextLyricTarget,
  resolveParagraphInsertionTarget,
} from "../components/EditorShell/music-text-target";
import { resolveScorePointerAction } from "../components/EditorShell/editor-object-selection";
import {
  resolveMusicTextHoverTarget,
  sameMusicTextTarget,
} from "../components/EditorShell/music-text-hover";
import { resolveParagraphFocus } from "../components/EditorShell/music-text-focus";

describe("空简谱歌词入口", () => {
  it("空小节可添加歌词，点击、悬停、草稿和前进均使用同一时间位置", () => {
    const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
    const track = document.score.tracks[0]!;
    const measure = track.measures[0]!;
    track.measures = [measure];
    track.techniques = [];
    track.numberedMarks = [];
    measure.numberedVoice = { events: [], tuplets: [] };
    measure.lyrics = [];
    const start = resolveParagraphInsertionTarget(document, null)!;
    const target = { ...start, kind: "lyric" as const, verse: 1 as const };
    expect(start).toMatchObject({ tick: 0 });
    expect(readMusicTextDraft(document, target)?.text).toBe("");
    const layout = buildLayout(document, {
      purpose: "editing",
      paragraphEditing: target,
    });
    const focus = resolveParagraphFocus(layout, target)!;
    const point = {
      x: focus.x + focus.width / 2,
      y: focus.y + focus.height / 2,
    };
    expect(resolveMusicTextHoverTarget(layout, point)).toEqual(target);
    expect(
      resolveScorePointerAction(document, layout, point, null, false),
    ).toMatchObject({ type: "target", target });
    const next = resolveNextLyricTarget(document, target)!;
    expect(next.tick).toBe(target.endTick);
    expect(sameMusicTextTarget(target, next)).toBe(false);
    const result = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.SetLyric,
      ...target,
      verse: 1,
      text: "风",
    });
    if (!result.ok) throw new Error(result.message);
    const draft = readMusicTextDraft(result.document, target)!;
    expect(draft.text).toBe("风");
    expect(draft.target.eventId).toBeTruthy();
    expect(resolveNextLyricTarget(result.document, target)).toEqual(next);
    const savedLayout = buildLayout(result.document, {
      purpose: "editing",
      paragraphEditing: target,
    });
    expect(resolveParagraphFocus(savedLayout, target)).not.toBeNull();
    const timeFocus = resolveParagraphFocus(savedLayout, target)!;
    expect(resolveParagraphFocus(savedLayout, draft.target)).toMatchObject({
      x: timeFocus.x,
      y: timeFocus.y,
      width: timeFocus.width,
      height: timeFocus.height,
    });
  });
});
