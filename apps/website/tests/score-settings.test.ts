import { describe, it, expect, vi } from "vitest";
import {
  EXAMPLE_MVP_6_DOCUMENT,
  LXMScoreCommandEnum,
} from "@liuxianmao/lxm-editor";
import {
  readScoreSettings,
  planSettingsCommands,
} from "../components/EditorShell/score-settings-draft";
import {
  readMusicTextDraft,
  resolveSidebarRequest,
} from "../components/EditorShell/music-text-draft";
import { createEditorSession } from "../stores/editor-store";

describe("谱面设置与连续填词默认", () => {
  it("信息表单一条历史/一次通知，撤销重做保留音乐", () => {
    const onChange = vi.fn();
    const session = createEditorSession(EXAMPLE_MVP_6_DOCUMENT, { onChange });
    const before = session.getState().document!;
    const initial = readScoreSettings(before);
    const commands = planSettingsCommands(
      before,
      { ...initial, title: "歌", arranger: "作者", keySignature: "C" },
      initial,
    );
    expect(commands).toHaveLength(1);
    session.getState().execute(commands[0]!);
    const next = session.getState().document;
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(session.getState().historyDepth.past).toBe(1);
    session.getState().undo();
    expect(session.getState().document).toEqual(before);
    session.getState().redo();
    expect(session.getState().document).toEqual(next);
  });
  it("基础拍号不跟焦点移动；各表单独立提交，歌曲信息不混入拍号", () => {
    const doc = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
    const track = doc.score.tracks[0]!;
    const initial = readScoreSettings(doc, track.measures[1]!.id);
    const value = { ...initial, title: "新歌", signature: "3/4", capo: "2" };
    const info = planSettingsCommands(
      doc,
      value,
      initial,
      track.measures[1]!.id,
      "info",
    );
    expect(info).toHaveLength(1);
    expect(info[0]!.type).toBe(LXMScoreCommandEnum.SetNotationInfo);
    const meter = planSettingsCommands(
      doc,
      value,
      initial,
      track.measures[1]!.id,
      "signature",
    );
    expect(meter[0]).toMatchObject({
      measureId: track.measures[0]!.id,
      scope: "untilNextChange",
    });
  });
  it("默认连续填词与已有覆盖保护，单拍模式显式保留", () => {
    const doc = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
    const track = doc.score.tracks[0]!;
    const m = track.measures[0]!;
    const target = {
      trackId: track.id,
      measureId: m.id,
      beatId: m.beats[0]!.id,
      string: 1,
      kind: "lyric" as const,
      verse: 1 as const,
    };
    const draft = readMusicTextDraft(doc, target)!;
    expect(draft.lyricMode).toBe("sequence");
    expect(draft.text).toBe("风");
    expect(draft.allowOverwrite).toBe(true);
    draft.text = "未应用";
    expect(resolveSidebarRequest(draft, { type: "tab", kind: "score" })).toBe(
      "confirm",
    );
    expect(readMusicTextDraft(doc, target, "single")!.lyricMode).toBe("single");
  });
});

it("基础拍号合法协调与已有变化点保留，首小节删除后从新曲首读取", () => {
  const doc = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
  const track = doc.score.tracks[0]!;
  // 空白容量休止允许调整拍号，避免测试借助非法节奏数据。
  track.techniques = [];
  track.measures.forEach((m) => {
    m.lyrics = [];
    m.chordSymbols = [];
    m.tuplets = [];
    m.timeSignature = { numerator: 4, denominator: 4 };
    m.beats = Array.from({ length: 4 }, (_, i) => ({
      id: `empty-${m.id}-${i}`,
      tick: i * 960,
      rhythm: { base: "quarter", dots: 0 },
      kind: "rest",
      notes: [],
    }));
  });
  const session = createEditorSession(doc);
  const split = track.measures[2]!;
  expect(
    session.getState().execute({
      type: LXMScoreCommandEnum.SetTimeSignature,
      trackId: track.id,
      measureId: split.id,
      timeSignature: { numerator: 3, denominator: 4 },
      scope: "untilNextChange",
    })?.ok,
  ).toBe(true);
  const current = session.getState().document!;
  const initial = readScoreSettings(current);
  const command = planSettingsCommands(
    current,
    { ...initial, signature: "2/4" },
    initial,
    undefined,
    "signature",
  )[0]!;
  expect(session.getState().execute(command)?.ok).toBe(true);
  const measures = session.getState().document!.score.tracks[0]!.measures;
  expect(measures[0]!.timeSignature).toEqual({ numerator: 2, denominator: 4 });
  expect(measures[1]!.timeSignature).toEqual({ numerator: 2, denominator: 4 });
  expect(measures[2]!.timeSignature).toEqual({ numerator: 3, denominator: 4 });
  session.getState().execute({
    type: LXMScoreCommandEnum.RemoveMeasure,
    trackId: track.id,
    measureId: measures[0]!.id,
  });
  session.getState().execute({
    type: LXMScoreCommandEnum.RemoveMeasure,
    trackId: track.id,
    measureId: measures[1]!.id,
  });
  expect(readScoreSettings(session.getState().document!).signature).toBe("3/4");
});
