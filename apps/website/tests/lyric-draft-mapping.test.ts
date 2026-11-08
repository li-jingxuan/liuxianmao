import { describe, expect, it } from "vitest";
import { EXAMPLE_MVP_7_2_DOCUMENT } from "@liuxianmao/lxm-editor";
import { lyricDraftMappingDependency, readMusicTextDraft } from "../components/EditorShell/music-text-draft";

const fixture = () => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  const measure = track.measures[0]!;
  const target = {
    kind: "lyric" as const, trackId: track.id, measureId: measure.id,
    eventId: measure.numberedVoice.events[0]!.id, verse: 1 as const,
  };
  const draft = { ...readMusicTextDraft(document, target, "sequence")!, target, text: "甲 乙" };
  return { document, track, measure, target, draft };
};

describe("歌词草稿的实际位置映射依赖", () => {
  it("首 ID 和原词保持时，中间插入空位仍使连续填词映射失效", () => {
    const { document, measure, draft } = fixture();
    const before = structuredClone(document);
    const first = measure.numberedVoice.events[0]!;
    first.rhythm = { base: "eighth", dots: 0 };
    measure.numberedVoice.events.splice(1, 0, {
      id: "new-gap", tick: 480, rhythm: { base: "eighth", dots: 0 }, kind: "gap", items: [],
    });
    expect(measure.lyrics).toEqual(before.score.tracks[0]!.measures[0]!.lyrics);
    expect(first.id).toBe(draft.target.eventId);
    expect(lyricDraftMappingDependency(document, draft)).not.toBe(lyricDraftMappingDependency(before, draft));
  });

  it("依赖跨小节的实际映射和后续原词，不只检查第一个位置", () => {
    const { document, track, measure, draft } = fixture();
    draft.target = { ...draft.target, eventId: measure.numberedVoice.events.at(-1)!.id };
    const before = lyricDraftMappingDependency(document, draft);
    const second = track.measures[1]!;
    const nextId = second.numberedVoice.events[0]!.id;
    second.lyrics = second.lyrics.filter((lyric) => lyric.eventId !== nextId || lyric.verse !== 1);
    second.lyrics.push({ id: "changed-next-lyric", eventId: nextId, verse: 1, text: "外部修改" });
    expect(lyricDraftMappingDependency(document, draft)).not.toBe(before);
  });

  it("未使用的后方位置、其他段词和 TAB 单独变化不使当前映射失效", () => {
    const { document, measure, draft } = fixture();
    const before = lyricDraftMappingDependency(document, draft);
    measure.numberedVoice.events.at(-1)!.rhythm = { base: "eighth", dots: 0 };
    measure.lyrics.push({ id: "other-verse", eventId: draft.target.eventId!, verse: 2, text: "另一段" });
    measure.beats[0]!.rhythm = { base: "eighth", dots: 0 };
    expect(lyricDraftMappingDependency(document, draft)).toBe(before);
  });

  it("同 ID、同时值的 gap 补音不改变映射；单点歌词可跟随保留的事件", () => {
    const { document, measure, draft } = fixture();
    const first = measure.numberedVoice.events[0]!;
    measure.numberedVoice.events[0] = { ...first, kind: "gap", items: [] };
    const before = lyricDraftMappingDependency(document, draft);
    measure.numberedVoice.events[0] = first;
    expect(lyricDraftMappingDependency(document, draft)).toBe(before);
    const single = { ...draft, lyricMode: "single" as const };
    const singleBefore = lyricDraftMappingDependency(document, single);
    first.rhythm = { base: "eighth", dots: 0 };
    expect(lyricDraftMappingDependency(document, single)).toBe(singleBefore);
    expect(lyricDraftMappingDependency(document, draft)).not.toBe(before);
  });

  it("目标删除或谱尾位置不足不会回退到相邻事件", () => {
    const { document, measure, draft } = fixture();
    const before = lyricDraftMappingDependency(document, draft);
    measure.numberedVoice.events.shift();
    expect(lyricDraftMappingDependency(document, draft)).not.toBe(before);
    expect(JSON.parse(lyricDraftMappingDependency(document, draft)).positions).toEqual([]);
  });
});
