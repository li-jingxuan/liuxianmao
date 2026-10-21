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
import {
  resolveParagraphInsertionTarget,
  resolveParagraphNumberedTarget,
  resolveSystemMeasureIds,
} from "../components/EditorShell/music-text-target";

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
  it("连续歌词回填所选拍点，空拍保留跳拍位置", () => {
    const { document, target, measure } = fixture();
    measure.lyrics = [
      { id: "first-word", beatId: measure.beats[0]!.id, verse: 1, text: "春" },
      { id: "third-word", beatId: measure.beats[2]!.id, verse: 1, text: "风" },
    ];
    const focus = { ...target, beatId: measure.beats[2]!.id };
    const selection = { anchor: target, focus };
    const draft = readMusicTextDraft(document, focus, "sequence", selection)!;
    expect(draft.target.beatId).toBe(target.beatId);
    expect(draft.text).toBe("春 _ 风");
    expect(draft.initial).toBeDefined();
    expect(resolveSidebarRequest(draft, { type: "close" })).toBe("execute");
    expect(readMusicTextDraft(document, target, "sequence")?.text).toBe("春");
    expect(readMusicTextDraft(document, target, "single")?.text).toBe("春");
  });
});

describe("内容行入口目标解析", () => {
  it("优先使用其他轨道上的有效目标，不错误回退到首轨", () => {
    const { document } = fixture();
    const secondTrack = structuredClone(document.score.tracks[0]!);
    secondTrack.id = "track-2";
    secondTrack.measures[0]!.id = "measure-2";
    secondTrack.measures[0]!.beats[0]!.id = "beat-2";
    document.score.tracks.push(secondTrack);
    const target = resolveParagraphInsertionTarget(document, {
      trackId: "track-2",
      measureId: "measure-2",
      beatId: "beat-2",
      string: 4,
      kind: "lyric",
      verse: 1,
    });
    expect(target).toEqual({
      trackId: "track-2",
      measureId: "measure-2",
      beatId: "beat-2",
      string: 4,
    });
  });

  it("谱行布局未就绪不能猜测目标谱行", () => {
    expect(resolveSystemMeasureIds("measure-2", () => [])).toBeNull();
    expect(
      resolveSystemMeasureIds("measure-2", () => ["measure-1"]),
    ).toBeNull();
    expect(
      resolveSystemMeasureIds("measure-2", () => ["measure-1", "measure-2"]),
    ).toEqual(["measure-1", "measure-2"]);
  });

  it("合法独立简谱事件与空白时间窗不依赖TAB拍点", () => {
    const { document } = fixture();
    const track = document.score.tracks[0]!;
    const measure = track.measures[0]!;
    measure.beats = [];
    measure.numberedVoice.events = [
      {
        id: "independent",
        tick: 0,
        rhythm: { base: "quarter", dots: 0 },
        kind: "notes",
        items: [{ id: "independent-item", token: "1" }],
      },
    ];
    const event = measure.numberedVoice.events[0]!;
    const target = {
      kind: "numbered" as const,
      trackId: track.id,
      measureId: measure.id,
      eventId: event.id,
    };
    expect(resolveParagraphNumberedTarget(document, target)).toMatchObject({
      eventId: event.id,
    });
    measure.numberedVoice.events = [];
    measure.numberedVoice.tuplets = [];
    expect(resolveParagraphNumberedTarget(document, null)).toMatchObject({
      tick: 0,
      endTick: 960,
    });
  });
});
