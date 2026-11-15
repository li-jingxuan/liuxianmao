import { describe, expect, it } from "vitest";
import {
  applyScoreCommand,
  collectMusicTextRangeSlots,
  EXAMPLE_MVP_7_2_DOCUMENT,
  loadDocument,
  LXMScoreCommandEnum as C,
  readMusicTextRange,
  resolveMusicTextRange,
  type ILXMDocument,
  type ILXMNumberedEvent,
  type MusicTextRange,
  type MusicTextRangePosition,
} from "../../src";

const event = (id: string, tick: number, tokens: string[], base: "quarter" | "half" | "eighth" = "quarter"): ILXMNumberedEvent => ({
  id, tick, rhythm: { base, dots: 0 },
  kind: !tokens.length ? "gap" : tokens[0] === "0" ? "rest" : tokens[0] === "-" ? "continuation" : "notes",
  items: tokens.map((token, index) => ({ id: `${id}-item-${index}`, token })),
} as ILXMNumberedEvent);

const fixture = () => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  document.score.tracks = [track];
  track.measures = track.measures.slice(0, 2);
  track.techniques = [];
  track.numberedMarks = [];
  track.measures.forEach((measure, index) => {
    measure.id = index === 0 ? "z-first" : "a-second";
    measure.lyrics = [];
    measure.chordSymbols = [];
    measure.tuplets = [];
    measure.beats = Array.from({ length: 4 }, (_, beat) => ({
      id: `tab-${index}-${beat}`, tick: beat * 960, rhythm: { base: "quarter", dots: 0 }, kind: "rest", notes: [],
    }));
    measure.numberedVoice = { events: [], tuplets: [] };
  });
  const [first, second] = track.measures;
  first!.numberedVoice.events = [event("chord", 0, ["1", "3"], "half"), event("gap", 1920, []), event("rest", 2880, ["0"])];
  second!.numberedVoice.events = [event("note", 0, ["5"]), event("continuation", 960, ["-"]), event("last-gap", 1920, [])];
  first!.lyrics = [
    { id: "lyric-1", eventId: "chord", verse: 1, text: "风" },
    { id: "lyric-2", eventId: "chord", verse: 2, text: "云" },
    { id: "lyric-gap", eventId: "gap", verse: 1, text: "过" },
  ];
  second!.lyrics = [{ id: "lyric-note", eventId: "note", verse: 1, text: "山" }];
  const range = (kind: MusicTextRange["kind"], anchor: MusicTextRangePosition, focus: MusicTextRangePosition): MusicTextRange => ({
    trackId: track.id, kind, ...(kind === "lyric" ? { verse: 1 as const } : {}), anchor, focus,
  });
  return { document, track, first: first!, second: second!, range };
};

const replace = (document: ILXMDocument, range: MusicTextRange, text: string) => {
  const result = applyScoreCommand(document, { type: C.ReplaceMusicTextRange, range, text });
  if (!result.ok) throw new Error(result.message);
  expect(loadDocument(JSON.stringify(result.document)).ok).toBe(true);
  return result;
};

describe("音乐文本范围", () => {
  it("按小节数组/tick枚举完整事件和虚拟窗，反选包含首尾且整组多音只占一个slot", () => {
    const { document, track, range } = fixture();
    const slots = collectMusicTextRangeSlots(document, { trackId: track.id, kind: "numbered" });
    expect(slots.map(slot => [slot.measureId, slot.tick, slot.endTick])).toEqual([
      ["z-first", 0, 1920], ["z-first", 1920, 2880], ["z-first", 2880, 3840],
      ["a-second", 0, 960], ["a-second", 960, 1920], ["a-second", 1920, 2880], ["a-second", 2880, 3840],
    ]);
    const selected = range("numbered", slots[3]!, slots[0]!);
    expect(readMusicTextRange(document, selected)).toMatchObject({ ok: true, text: "1+3 _ 0 5", slots: slots.slice(0, 4) });
    expect(resolveMusicTextRange(document, { ...selected, anchor: { ...slots[3]!, eventId: "deleted" } }).ok).toBe(false);
    expect(resolveMusicTextRange(document, { ...selected, trackId: "other-track" }).ok).toBe(false);
    expect(resolveMusicTextRange(document, { ...selected, anchor: { measureId: "z-first", tick: 0, endTick: 960 } }).ok).toBe(false);
  });

  it("短简谱输入清剩余内容，保留事件/音符ID、每slot时值及全部歌词锚点，只增加一次revision", () => {
    const { document, track, range } = fixture();
    const before = structuredClone(document);
    const slots = collectMusicTextRangeSlots(document, { trackId: track.id, kind: "numbered" });
    const result = replace(document, range("numbered", slots[0]!, slots[3]!), "2+4 _");
    const saved = result.document.score.tracks[0]!;
    expect(result.document.documentRevision).toBe(document.documentRevision + 1);
    expect(saved.measures.flatMap(measure => measure.numberedVoice.events).map(item => [item.id, item.tick, item.rhythm])).toEqual(
      track.measures.flatMap(measure => measure.numberedVoice.events).map(item => [item.id, item.tick, item.rhythm]),
    );
    expect(saved.measures[0]!.numberedVoice.events[0]!.items).toEqual([
      { id: "chord-item-0", token: "2" }, { id: "chord-item-1", token: "4" },
    ]);
    expect(saved.measures[0]!.numberedVoice.events[2]!.kind).toBe("gap");
    expect(saved.measures[1]!.numberedVoice.events[0]!.kind).toBe("gap");
    expect(saved.measures.map(measure => measure.lyrics)).toEqual(track.measures.map(measure => measure.lyrics));
    expect(document).toEqual(before);
  });

  it("空简谱输入清全选区，只有下划线则跳过；相同回显不生成revision", () => {
    const { document, track, range } = fixture();
    const slots = collectMusicTextRangeSlots(document, { trackId: track.id, kind: "numbered" });
    const selected = range("numbered", slots[0]!, slots[1]!);
    const skipped = replace(document, selected, "_ _");
    expect(skipped).toMatchObject({ changed: false, document });
    expect(skipped.document).toBe(document);
    const same = replace(document, selected, "1+3 _");
    expect(same.document).toBe(document);
    const cleared = replace(document, selected, "　 ");
    expect(cleared.document.score.tracks[0]!.measures[0]!.numberedVoice.events.slice(0, 2).map(item => item.kind)).toEqual(["gap", "gap"]);
    expect(cleared.document.score.tracks[0]!.measures[0]!.lyrics).toEqual(track.measures[0]!.lyrics);
  });

  it("歌词跳过休止延音，跨小节同段替换及下划线清空，短输入清尾但保留其他段", () => {
    const { document, track, range } = fixture();
    const slots = collectMusicTextRangeSlots(document, { trackId: track.id, kind: "lyric", verse: 1 });
    expect(slots.map(slot => slot.eventId ?? slot.tick)).toEqual(["chord", "gap", "note", "last-gap", 2880]);
    const selected = range("lyric", slots[3]!, slots[0]!);
    expect(readMusicTextRange(document, selected)).toMatchObject({ ok: true, text: "风 过 山 _" });
    const result = replace(document, selected, "新 _");
    expect(result.document.score.tracks[0]!.measures.flatMap(measure => measure.lyrics)).toEqual([
      { id: "lyric-1", eventId: "chord", verse: 1, text: "新" },
      { id: "lyric-2", eventId: "chord", verse: 2, text: "云" },
    ]);
    const cleared = replace(document, selected, "");
    expect(cleared.document.score.tracks[0]!.measures.flatMap(measure => measure.lyrics)).toEqual([
      { id: "lyric-2", eventId: "chord", verse: 2, text: "云" },
    ]);
    expect(resolveMusicTextRange(document, { ...selected, verse: undefined }).ok).toBe(false);
    expect(resolveMusicTextRange(document, { ...selected, focus: { measureId: "z-first", eventId: "rest" } }).ok).toBe(false);
  });

  it.each(["numbered", "lyric"] as const)("%s可在现有虚拟窗落盘，端点时间引用仍可解析", kind => {
    const { document, track, range } = fixture();
    const slots = collectMusicTextRangeSlots(document, { trackId: track.id, kind, verse: 1 });
    const slot = slots.at(-1)!;
    const selected = range(kind, slot, slot);
    const result = replace(document, selected, kind === "numbered" ? "6+1'" : "唱");
    const measure = result.document.score.tracks[0]!.measures[1]!;
    expect(measure.numberedVoice.events.at(-1)).toMatchObject({ tick: slot.tick, rhythm: { base: "quarter", dots: 0 }, kind: kind === "lyric" ? "gap" : "notes" });
    expect(resolveMusicTextRange(result.document, selected).ok).toBe(true);
    expect(result.document.documentRevision).toBe(document.documentRevision + 1);
  });

  it.each(["numbered", "lyric"] as const)("%s超长、非法末项和过期revision整批失败", kind => {
    const { document, track, range } = fixture();
    const slots = collectMusicTextRangeSlots(document, { trackId: track.id, kind, verse: 1 });
    const selected = range(kind, slots[0]!, slots[1]!);
    const before = structuredClone(document);
    for (const text of [kind === "numbered" ? "2 3 4" : "风 过 山", kind === "numbered" ? "2 invalid" : "新 bad\n", " ".repeat(16385)]) {
      expect(applyScoreCommand(document, { type: C.ReplaceMusicTextRange, range: selected, text }).ok).toBe(false);
      expect(document).toEqual(before);
    }
    expect(applyScoreCommand(document, { type: C.ReplaceMusicTextRange, range: selected, text: "", expectedRevision: document.documentRevision + 1 }).ok).toBe(false);
    expect(document).toEqual(before);
  });

  it("不丢弃已有歌词锚点，替换成休止/延音时原子拒绝", () => {
    const { document, track, range } = fixture();
    const slots = collectMusicTextRangeSlots(document, { trackId: track.id, kind: "numbered" });
    const selected = range("numbered", slots[0]!, slots[1]!);
    const before = structuredClone(document);
    for (const text of ["2 0", "2 -"]) {
      expect(applyScoreCommand(document, { type: C.ReplaceMusicTextRange, range: selected, text })).toMatchObject({ ok: false, code: "INVALID_MUSIC_TEXT_RANGE" });
      expect(document).toEqual(before);
    }
  });

  it("连音组中仍以完整事件为slot，替换内容不改变实际时长或连音成员", () => {
    const { document, first, track, range } = fixture();
    first.lyrics = [];
    first.numberedVoice = {
      events: [event("t1", 0, ["1"], "eighth"), event("t2", 320, ["2"], "eighth"), event("t3", 640, ["3"], "eighth"), event("tail", 960, ["4"]), event("tail2", 1920, ["5"]), event("tail3", 2880, ["6"])],
      tuplets: [{ id: "triplet", eventIds: ["t1", "t2", "t3"], ratio: { actual: 3, normal: 2 } }],
    };
    const slots = collectMusicTextRangeSlots(document, { trackId: track.id, kind: "numbered" });
    expect(slots.slice(0, 3).map(slot => [slot.tick, slot.endTick])).toEqual([[0, 320], [320, 640], [640, 960]]);
    const result = replace(document, range("numbered", slots[0]!, slots[2]!), "5+7");
    const saved = result.document.score.tracks[0]!.measures[0]!.numberedVoice;
    expect(saved.tuplets).toEqual(first.numberedVoice.tuplets);
    expect(saved.events.slice(0, 3).map(item => [item.id, item.tick, item.rhythm])).toEqual(first.numberedVoice.events.slice(0, 3).map(item => [item.id, item.tick, item.rhythm]));
    expect(saved.events.slice(0, 3).map(item => item.kind)).toEqual(["notes", "gap", "gap"]);
  });

  it.each(["0", "-", ""])("有tie/slur的事件改成%j先要求确认，确认后一次提交并报告移除影响", text => {
    const { document, first, track, range } = fixture();
    first.lyrics = [];
    first.numberedVoice.events = [event("from", 0, ["1"]), event("to", 960, ["1"]), event("end", 1920, ["3"], "half")];
    track.numberedMarks = [
      { id: "tie", type: "tie", fromItemId: "from-item-0", toItemId: "to-item-0" },
      { id: "slur", type: "slur", fromEventId: "from", toEventId: "to" },
    ];
    const slots = collectMusicTextRangeSlots(document, { trackId: track.id, kind: "numbered" });
    const selected = range("numbered", slots[0]!, slots[0]!);
    const command = { type: C.ReplaceMusicTextRange as const, range: selected, text };
    const before = structuredClone(document);
    expect(applyScoreCommand(document, command)).toMatchObject({
      ok: false, code: "NUMBERED_IMPACT_REQUIRED", removedMarkIds: ["slur", "tie"],
    });
    expect(document).toEqual(before);
    const result = applyScoreCommand(document, { ...command, confirmedRemovedMarkIds: ["slur", "tie"] });
    if (!result.ok) throw new Error(result.message);
    expect(result.document.score.tracks[0]!.numberedMarks).toEqual([]);
    expect(result.document.score.tracks[0]!.measures[0]!.numberedVoice.events[0]).toMatchObject({
      id: "from", tick: 0, rhythm: { base: "quarter", dots: 0 },
      kind: text === "0" ? "rest" : text === "-" ? "continuation" : "gap",
    });
    expect(result.effects?.flatMap(effect => effect.kind === "numbered.mark.removed" ? [effect.markId] : []).sort()).toEqual(["slur", "tie"]);
    expect(result.document.documentRevision).toBe(document.documentRevision + 1);
    expect(loadDocument(JSON.stringify(result.document)).ok).toBe(true);
  });

  it("同时改变tie两端同音内容保留item ID与tie/slur，只改变一端则需要确认tie移除", () => {
    const { document, first, track, range } = fixture();
    first.lyrics = [];
    first.numberedVoice.events = [event("from", 0, ["1"]), event("to", 960, ["1"]), event("end", 1920, ["3"], "half")];
    track.numberedMarks = [
      { id: "tie", type: "tie", fromItemId: "from-item-0", toItemId: "to-item-0" },
      { id: "slur", type: "slur", fromEventId: "from", toEventId: "to" },
    ];
    const slots = collectMusicTextRangeSlots(document, { trackId: track.id, kind: "numbered" });
    const selected = range("numbered", slots[0]!, slots[1]!);
    expect(applyScoreCommand(document, { type: C.ReplaceMusicTextRange, range: selected, text: "2 _" })).toMatchObject({
      ok: false, code: "NUMBERED_IMPACT_REQUIRED", removedMarkIds: ["tie"],
    });
    const result = replace(document, selected, "2 2");
    expect(result.document.score.tracks[0]!.numberedMarks).toEqual(track.numberedMarks);
    expect(result.document.score.tracks[0]!.measures[0]!.numberedVoice.events.slice(0, 2).map(item => item.items[0]!.id)).toEqual(["from-item-0", "to-item-0"]);
  });
});
