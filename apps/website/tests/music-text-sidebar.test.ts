import { describe, expect, it } from "vitest";
import {
  EXAMPLE_MVP_6_DOCUMENT,
  copyChordPreset,
} from "@liuxianmao/lxm-editor";
import {
  readMusicTextDraft,
  resolveSidebarRequest,
  type MusicTextTarget,
} from "../components/EditorShell/music-text-draft";

const fixture = () => {
  const document = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
  const track = document.score.tracks[0]!;
  const measure = track.measures[0]!;
  const target: MusicTextTarget = {
    trackId: track.id,
    measureId: measure.id,
    beatId: measure.beats[0]!.id,
    string: 1,
    kind: "lyric",
    verse: 1,
  };
  return { document, track, measure, target };
};

describe("音乐文本侧栏草稿保护", () => {
  it("未创建草稿的默认侧栏不要求确认，有效目标才可进入编辑", () => {
    const { document, target } = fixture();
    expect(resolveSidebarRequest(null, { type: "tab", kind: "chord" })).toBe(
      "execute",
    );
    expect(readMusicTextDraft(null, target)).toBeNull();
    expect(
      readMusicTextDraft(document, { ...target, beatId: "deleted" }),
    ).toBeNull();
    expect(readMusicTextDraft(document, target)?.target).toEqual(target);
  });
  it("非法未应用歌词在关闭、切标签、切拍或切段前仍需确认", () => {
    const { document, target, measure } = fixture();
    const draft = readMusicTextDraft(document, target)!;
    draft.text = "\n";
    expect(resolveSidebarRequest(draft, { type: "close" })).toBe("confirm");
    expect(resolveSidebarRequest(draft, { type: "tab", kind: "chord" })).toBe(
      "confirm",
    );
    expect(
      resolveSidebarRequest(draft, {
        type: "target",
        target: { ...target, verse: 2 },
      }),
    ).toBe("confirm");
    expect(
      resolveSidebarRequest(draft, {
        type: "target",
        target: { ...target, beatId: measure.beats[1]!.id },
      }),
    ).toBe("confirm");
  });
  it("重复点击同一拍不同弦或当前标签不覆盖脏草稿", () => {
    const { document, target } = fixture();
    const draft = readMusicTextDraft(document, target)!;
    draft.text = "未提交的词";
    expect(
      resolveSidebarRequest(draft, {
        type: "target",
        target: { ...target, string: 6 },
      }),
    ).toBe("ignore");
    expect(resolveSidebarRequest(draft, { type: "tab", kind: "lyric" })).toBe(
      "ignore",
    );
    expect(draft.text).toBe("未提交的词");
  });
  it("干净草稿可切换；和弦的图和名称修改均触发保护", () => {
    const { document, target } = fixture();
    const draft = readMusicTextDraft(document, { ...target, kind: "chord" })!;
    expect(resolveSidebarRequest(draft, { type: "close" })).toBe("execute");
    for (const chord of [
      { ...draft.chord, chord: { ...draft.chord.chord, name: "新名称" } },
      { display: "nameAndDiagram" as const, chord: copyChordPreset("F")! },
    ])
      expect(
        resolveSidebarRequest({ ...draft, chord }, { type: "close" }),
      ).toBe("confirm");
  });
  it("每次换拍独立预填歌词与和弦，不能携带上一拍快照", () => {
    const { document, target, measure } = fixture();
    const second = { ...target, beatId: measure.beats[1]!.id };
    const chord = copyChordPreset("F")!;
    measure.chordSymbols = [
      {
        id: "sidebar-chord",
        beatId: second.beatId,
        display: "nameAndDiagram",
        chord,
      },
    ];
    const next = readMusicTextDraft(document, { ...second, kind: "chord" })!;
    next.chord.chord.diagram!.strings[0]!.fret = 20;
    expect(measure.chordSymbols[0]!.chord.diagram!.strings[0]!.fret).not.toBe(
      20,
    );
    expect(
      readMusicTextDraft(document, { ...target, kind: "chord" })!.chord.chord
        .diagram,
    ).toBeNull();
    expect(
      resolveSidebarRequest(readMusicTextDraft(document, second), {
        type: "close",
      }),
    ).toBe("execute");
  });
});
