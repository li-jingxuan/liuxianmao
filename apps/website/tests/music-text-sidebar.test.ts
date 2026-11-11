import { describe, expect, it } from "vitest";
import {
  EXAMPLE_MVP_6_DOCUMENT,
  copyChordPreset,
  planLyricPositions,
} from "@liuxianmao/lxm-editor";
import {
  readMusicTextDraft,
  normalizeMusicTextTarget,
  musicTextDraftValue,
  resolveSidebarRequest,
  type SidebarAction,
} from "../components/EditorShell/music-text/music-text-draft";
import {
  resolveParagraphInsertionTarget,
} from "../components/EditorShell/music-text/music-text-target";

const fixture = () => {
  const document = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
  const track = document.score.tracks[0]!;
  const measure = track.measures[0]!;
  const target = {
    trackId: track.id,
    measureId: measure.id,
    eventId: measure.numberedVoice.events[0]!.id,
    string: 1,
    kind: "lyric" as const,
    verse: 1 as const,
  };
  const chordTarget = {
    kind: "chord" as const,
    trackId: track.id,
    measureId: measure.id,
    beatId: measure.beats[0]!.id,
    string: 1,
  };
  return { document, track, measure, target, chordTarget };
};

describe("音乐文本侧栏未应用内容的离开策略", () => {
  it("新歌词会话保护覆盖，和弦仅改显示配置可直接离开", () => {
    const { document, target, chordTarget } = fixture();
    expect(readMusicTextDraft(document, target)!.allowOverwrite).toBe(false);
    const chord = readMusicTextDraft(document, chordTarget)!;
    chord.chord.display = chord.chord.display === "name" ? "nameAndDiagram" : "name";
    expect(musicTextDraftValue(chord)).not.toBe(chord.initial);
    expect(resolveSidebarRequest(chord, { type: "close" })).toBe("execute");
  });
  it("歌词时间窗与事件入口归一，段号及简谱成员保持独立", () => {
    const { document, target, measure } = fixture();
    const event = measure.numberedVoice.events[0]!;
    const position = planLyricPositions(measure).find((item) => item.eventId === event.id)!;
    const normalized = normalizeMusicTextTarget(document, target);
    expect(normalizeMusicTextTarget(document, { kind: "lyric", trackId: target.trackId, measureId: target.measureId,
      tick: position.tick, endTick: position.endTick, string: 6 })).toEqual(normalized);
    expect(normalizeMusicTextTarget(document, { ...target, verse: 2 })).not.toEqual(normalized);
    expect(normalizeMusicTextTarget(document, { ...target, eventId: "deleted" })).toBeNull();
  });
  it("更换可见任务不能借相同业务kind绕过设置保护", () => {
    const { document, chordTarget } = fixture();
    const draft = readMusicTextDraft(document, chordTarget)!;
    expect(resolveSidebarRequest(draft, { type: "tab", kind: "chord" }, {
      settingsDirty: true, visibleTaskChanged: true,
    })).toBe("confirm");
  });
  it("切换简谱目标直接丢弃未应用修改，干净目标也可直接切换", () => {
    const { target, measure } = fixture();
    const numberedTarget = { ...target, kind: "numbered" as const, verse: undefined };
    const action = { type: "target" as const, target: {
      ...numberedTarget, eventId: measure.numberedVoice.events[1]!.id,
    } };
    expect(resolveSidebarRequest(null, action, { numberedTarget, numberedDirty: true })).toBe("execute");
    expect(resolveSidebarRequest(null, action, { numberedTarget, numberedDirty: false })).toBe("execute");
  });
  it("未创建草稿的默认侧栏不要求确认，有效目标才可进入编辑", () => {
    const { document, target } = fixture();
    expect(resolveSidebarRequest(null, { type: "tab", kind: "chord" })).toBe(
      "execute",
    );
    expect(readMusicTextDraft(null, target)).toBeNull();
    expect(
      readMusicTextDraft(document, { ...target, eventId: "deleted" }),
    ).toBeNull();
    expect(readMusicTextDraft(document, target)?.target).toEqual(target);
  });
  it.each(["待应用歌词", "\n"])("未应用歌词 %j 在关闭、切标签、切拍或切段时直接丢弃", (text) => {
    const { document, target, measure } = fixture();
    const draft = readMusicTextDraft(document, target)!;
    draft.text = text;
    expect(resolveSidebarRequest(draft, { type: "close" })).toBe("execute");
    expect(resolveSidebarRequest(draft, { type: "tab", kind: "chord" })).toBe(
      "execute",
    );
    expect(
      resolveSidebarRequest(draft, {
        type: "target",
        target: { ...target, verse: 2 },
      }),
    ).toBe("execute");
    expect(
      resolveSidebarRequest(draft, {
        type: "target",
        target: { ...target, eventId: measure.numberedVoice.events[1]!.id },
      }),
    ).toBe("execute");
    expect(resolveSidebarRequest(draft, { type: "mode", mode: "single" })).toBe("execute");
    expect(resolveSidebarRequest(draft, { type: "selection", selection: null })).toBe("execute");
    expect(resolveSidebarRequest(draft, { type: "mode", mode: "sequence" })).toBe("ignore");
    expect(draft.text).toBe(text);
  });
  it("简谱脏草稿在关闭、切标签、模式或选区时直接丢弃，重复目标保持输入", () => {
    const { target } = fixture();
    const numberedTarget = { ...target, kind: "numbered" as const, verse: undefined };
    const guards = { numberedTarget, numberedDirty: true };
    const actions: SidebarAction[] = [
      { type: "close" },
      { type: "tab", kind: "lyric" },
      { type: "tab", kind: "chord" },
      { type: "tab", kind: "score" },
      { type: "numberedMode", mode: "single" },
      { type: "numberedMode", mode: "sequence" },
      { type: "selection", selection: null },
    ];
    for (const action of actions) {
      expect(resolveSidebarRequest(null, action, guards)).toBe("execute");
      expect(resolveSidebarRequest(null, action, { ...guards, settingsDirty: true })).toBe("confirm");
    }
    expect(resolveSidebarRequest(null, { type: "target", target: numberedTarget }, guards)).toBe("ignore");
  });
  it.each(["待应用歌词", "\n"])("歌词 %j 与简谱同时脏时直接离开，设置脏时仍确认", (text) => {
    const { document, target } = fixture();
    const draft = readMusicTextDraft(document, target)!;
    draft.text = text;
    const guards = { numberedTarget: { ...target, kind: "numbered" as const, verse: undefined }, numberedDirty: true };
    const actions: SidebarAction[] = [
      { type: "close" },
      { type: "tab", kind: "numbered" },
      { type: "mode", mode: "single" },
      { type: "target", target: { ...target, verse: 2 } },
      { type: "selection", selection: null },
    ];
    for (const action of actions) {
      expect(resolveSidebarRequest(draft, action, guards)).toBe("execute");
      expect(resolveSidebarRequest(draft, action, { ...guards, settingsDirty: true })).toBe("confirm");
    }
    expect(resolveSidebarRequest(draft, { type: "target", target }, guards)).toBe("ignore");
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
  it("和弦名称、显示与指法修改在换拍、切页签或关闭时直接丢弃", () => {
    const { document, chordTarget, measure } = fixture();
    const draft = readMusicTextDraft(document, chordTarget)!;
    expect(resolveSidebarRequest(draft, { type: "close" })).toBe("execute");
    const actions: SidebarAction[] = [
      { type: "close" },
      { type: "target", target: { ...chordTarget, beatId: measure.beats[1]!.id } },
      { type: "selection", selection: { anchor: { ...chordTarget, beatId: measure.beats[1]!.id }, focus: { ...chordTarget, beatId: measure.beats[1]!.id } } },
      { type: "tab", kind: "numbered" },
      { type: "tab", kind: "lyric" },
      { type: "tab", kind: "score", propertyTab: "song" },
    ];
    for (const chord of [
      { ...draft.chord, chord: { ...draft.chord.chord, name: "新名称" } },
      { ...draft.chord, chord: { ...draft.chord.chord, name: "" } },
      { ...draft.chord, display: "nameAndDiagram" as const },
      { display: "nameAndDiagram" as const, chord: copyChordPreset("F")! },
    ]) {
      const edited = { ...draft, chord };
      for (const action of actions) {
        expect(resolveSidebarRequest(edited, action)).toBe("execute");
        expect(resolveSidebarRequest(edited, action, { settingsDirty: true })).toBe("confirm");
      }
      expect(resolveSidebarRequest(edited, { type: "target", target: { ...chordTarget, string: 6 } })).toBe("ignore");
    }
  });
  it("每次换拍独立预填歌词与和弦，不能携带上一拍快照", () => {
    const { document, chordTarget, measure } = fixture();
    const second = { ...chordTarget, beatId: measure.beats[1]!.id };
    const chord = copyChordPreset("F")!;
    measure.chordSymbols = [
      {
        id: "sidebar-chord",
        beatId: second.beatId,
        display: "nameAndDiagram",
        chord,
      },
    ];
    const first = readMusicTextDraft(document, chordTarget)!;
    first.chord.chord.name = "未应用和弦 A";
    expect(resolveSidebarRequest(first, { type: "target", target: second })).toBe("execute");
    const next = readMusicTextDraft(document, second)!;
    expect(next.chord.chord.name).toBe("F");
    next.chord.chord.name = "未应用和弦 B";
    next.chord.chord.diagram!.strings[0]!.fret = 20;
    expect(measure.chordSymbols[0]!.chord.diagram!.strings[0]!.fret).not.toBe(
      20,
    );
    expect(
      readMusicTextDraft(document, chordTarget)!.chord.chord.diagram,
    ).toBeNull();
    expect(resolveSidebarRequest(next, { type: "target", target: chordTarget })).toBe("execute");
    expect(readMusicTextDraft(document, chordTarget)!.chord.chord.name).toBe("");
    expect(readMusicTextDraft(document, second)!.chord.chord.name).toBe("F");
    expect(
      resolveSidebarRequest(readMusicTextDraft(document, second), {
        type: "close",
      }),
    ).toBe("execute");
  });
  it("歌词只回填所选简谱事件，TAB 范围不会改变起点或拼接歌词", () => {
    const { document, target, chordTarget, measure } = fixture();
    measure.lyrics = [
      {
        id: "first-word",
        eventId: measure.numberedVoice.events[0]!.id,
        verse: 1,
        text: "春",
      },
      {
        id: "third-word",
        eventId: measure.numberedVoice.events[2]!.id,
        verse: 1,
        text: "风",
      },
    ];
    const focus = { ...target, eventId: measure.numberedVoice.events[2]!.id };
    const selection = {
      anchor: chordTarget,
      focus: { ...chordTarget, beatId: measure.beats[2]!.id },
    };
    const draft = readMusicTextDraft(document, focus, "sequence", selection)!;
    expect(draft.target.eventId).toBe(focus.eventId);
    expect(draft.target.beatId).toBeUndefined();
    expect(draft.text).toBe("风");
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
    secondTrack.measures[0]!.numberedVoice.events[0]!.id = "event-2";
    document.score.tracks.push(secondTrack);
    const target = resolveParagraphInsertionTarget(document, {
      trackId: "track-2",
      measureId: "measure-2",
      eventId: "event-2",
      string: 4,
      kind: "lyric",
      verse: 1,
    });
    expect(target).toEqual({
      trackId: "track-2",
      measureId: "measure-2",
      eventId: "event-2",
    });
  });

  it("无显式歌词来源不猜测首位置，拒绝TAB拍点、失效事件和休止", () => {
    const { document, target, chordTarget, measure } = fixture();
    expect(resolveParagraphInsertionTarget(document, null)).toBeNull();
    expect(
      resolveParagraphInsertionTarget(document, chordTarget),
    ).toBeNull();
    expect(resolveParagraphInsertionTarget(document, {
      kind: "numbered", trackId: target.trackId, measureId: target.measureId,
    })).toBeNull();
    expect(
      resolveParagraphInsertionTarget(document, {
        ...target,
        eventId: "missing",
      }),
    ).toBeNull();
    expect(
      resolveParagraphInsertionTarget(document, {
        kind: "numbered",
        trackId: target.trackId,
        measureId: target.measureId,
        tick: 0,
        endTick: 960,
      }),
    ).toBeNull();
    measure.numberedVoice.events[0]!.kind = "rest";
    measure.numberedVoice.events[0]!.items = [];
    expect(resolveParagraphInsertionTarget(document, target)).toBeNull();
    expect(readMusicTextDraft(document, target)).toBeNull();
  });

  it("歌词草稿与入口不依赖 TAB，重复目标按 eventId 与段号判断", () => {
    const { document, target, measure } = fixture();
    measure.beats = [];
    const draft = readMusicTextDraft(document, target)!;
    expect(draft.text).toBe("风");
    expect(resolveParagraphInsertionTarget(document, target)).toEqual({
      trackId: target.trackId,
      measureId: target.measureId,
      eventId: target.eventId,
    });
    draft.text = "未保存";
    expect(resolveSidebarRequest(draft, { type: "target", target })).toBe(
      "ignore",
    );
    expect(
      resolveSidebarRequest(draft, {
        type: "target",
        target: { ...target, eventId: measure.numberedVoice.events[1]!.id },
      }),
    ).toBe("execute");
  });

});
