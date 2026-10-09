import { describe, expect, it } from "vitest";
import {
  EXAMPLE_MVP_6_DOCUMENT,
  LXMScoreCommandEnum as C,
  copyChordPreset,
} from "@liuxianmao/lxm-editor";
import { createEditorStore } from "../stores/editor-store";
import { shouldIgnoreMusicTextKey } from "../components/EditorShell/music-text-interaction";

describe("音乐文本网站边界", () => {
  it("歌词与和弦各自一次入历史，失败、同值和导航不入历史，完整撤销重做", () => {
    const initial = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
    const store = createEditorStore(initial);
    const track = initial.score.tracks[0]!;
    const measure = track.measures[0]!;
    const target = {
      trackId: track.id,
      measureId: measure.id,
      beatId: measure.beats[0]!.id,
    };
    store
      .getState()
      .execute({ type: C.SetLyric, ...target, verse: 1, text: "新歌词" });
    store
      .getState()
      .execute({
        type: C.SetChordSymbol,
        ...target,
        display: "nameAndDiagram",
        chord: copyChordPreset("F")!,
      });
    const saved = store.getState().document;
    store
      .getState()
      .execute({ type: C.SetLyric, ...target, verse: 1, text: " 新歌词 " });
    store
      .getState()
      .execute({ type: C.SetLyric, ...target, verse: 1, text: "a\nb" });
    store
      .getState()
      .setSelection({
        anchor: { ...target, string: 1 },
        focus: { ...target, string: 1 },
      });
    expect(store.getState().historyDepth).toEqual({ past: 2, future: 0 });
    store.getState().undo();
    store.getState().undo();
    expect(store.getState().document).toBe(initial);
    store.getState().redo();
    store.getState().redo();
    expect(store.getState().document).toBe(saved);
  });
  it.each([
    [true, false, 13, 100, 0, true],
    [false, true, 13, 100, 0, true],
    [false, false, 229, 100, 0, true],
    [false, false, 13, 100, 99, true],
    [false, false, 13, 151, 100, false],
    [false, false, 13, 100, -Infinity, false],
  ])(
    "IME 组合与确认 Enter: %j",
    (composing, isComposing, keyCode, timeStamp, end, expected) => {
      expect(
        shouldIgnoreMusicTextKey(
          {
            isComposing: isComposing as boolean,
            keyCode: keyCode as number,
            timeStamp: timeStamp as number,
          },
          composing as boolean,
          end as number,
        ),
      ).toBe(expected);
    },
  );
});
