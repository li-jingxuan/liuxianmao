import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EXAMPLE_MVP_6_DOCUMENT,
  parseLyricSequence,
  planLyricSequence,
  planLyricPositions,
} from "@liuxianmao/lxm-editor";
import { buildLyricMappingPreview, LyricFormView } from "../components/EditorShell/lyrics/LyricFormView";
import { readMusicTextDraft } from "../components/EditorShell/music-text/music-text-draft";

function fixture() {
  const document = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
  const track = document.score.tracks[0]!;
  const measure = track.measures[0]!;
  const event = structuredClone(measure.numberedVoice.events[0]!);
  event.tick = 480;
  event.rhythm = { base: "eighth", dots: 0 };
  measure.timeSignature = { numerator: 4, denominator: 4 };
  measure.numberedVoice = { events: [event], tuplets: [] };
  measure.lyrics = [{ id: "old-word", eventId: event.id, verse: 1, text: "旧词" }];
  const target = { kind: "lyric" as const, trackId: track.id, measureId: measure.id, eventId: event.id, verse: 1 as const, string: 1 };
  const parsed = parseLyricSequence("新词 _ 续词");
  if (!parsed.ok) throw new Error(parsed.message);
  const plan = planLyricSequence(document, target, parsed.items, true);
  const draft = readMusicTextDraft(document, target, "sequence")!;
  draft.text = "新词 _ 续词";
  return { document, track, measure, event, target, plan, draft };
}

const noop = () => {};
function renderView(value: ReturnType<typeof fixture>, text = value.draft.text) {
  return renderToStaticMarkup(<LyricFormView
    document={value.document}
    draft={{ ...value.draft, text }}
    plan={value.plan}
    issue={value.plan.issue}
    inputRef={noop}
    onAddVerse={noop}
    onVerseChange={noop}
    onTextChange={noop}
    onInspect={noop}
  />);
}

describe("歌词视图的真实规划适配", () => {
  it("事件按真实 tick 显示分数拍位，空白位置显示真实范围，不读顺序号", () => {
    const value = fixture();
    const mapping = buildLyricMappingPreview(value.document, value.plan)!;
    expect(value.plan.rows[0]!.beatNumber).toBe(1);
    expect(mapping.rows[0]!.positionLabel).toBe("1 小节 / 第1拍 + 1/2");
    expect(mapping.rows[0]!.sourcePosition).toMatchObject({ startTick: 480, endTick: 960 });
    const blankRow = value.plan.rows.find((row) => row.target && !row.target.eventId)!;
    expect(mapping.rows[blankRow.index]!.positionLabel).toContain("～");
    expect(mapping.rows[blankRow.index]!.sourcePosition).toMatchObject({ startTick: blankRow.target!.tick, endTick: blankRow.target!.endTick });
    expect(mapping.rows[blankRow.index]!.after).toBe("");
  });

  it("单行连续输入展示紧凑映射和空位，移除模式、覆盖勾选和逐项长表格", () => {
    const value = fixture();
    expect(value.plan.issue).toBeNull();
    const markup = renderView(value);
    expect(markup).toContain("音符与歌词映射");
    expect(markup).toContain('aria-label="连续歌词"');
    expect(markup).toContain('aria-label="歌词输入规则"');
    expect(markup).toContain('aria-label="清空为占位"');
    expect(markup).toContain('type="text"');
    for (const removed of ["textarea", "type=\"checkbox\"", "歌词录入方式", "覆盖与逐项预览", "下一歌词位置", "保留原词", "原词 → 新词"]) expect(markup).not.toContain(removed);
    expect(renderView(value, "新词\n续词")).not.toContain("音符与歌词映射");
    expect(renderView(value, "新词\n续词")).not.toContain("覆盖与逐项预览");
  });

  it("仅显示已有段落，第四段禁用新增并提供原因；气泡也使用同一单行表单", () => {
    const value = fixture();
    value.document.score.tracks.forEach((track) => track.measures.forEach((measure) => { measure.lyrics = []; }));
    value.document.score.meta.lyricVerseCount = 1;
    expect(renderView(value)).toContain("第一段");
    expect(renderView(value)).not.toContain("第二段");
    value.document.score.meta.lyricVerseCount = 4;
    const markup = renderView(value);
    expect(markup).toContain("最多支持四段歌词");
    expect(markup).toMatch(/<button[^>]*disabled[^>]*><span>添加段落<\/span>/);
    const popover = renderToStaticMarkup(<LyricFormView presentation="popover" document={value.document} draft={value.draft} plan={value.plan} issue={null} inputRef={noop} onAddVerse={noop} onVerseChange={noop} onTextChange={noop} onInspect={noop} />);
    expect(popover).toContain('id="lyric-popover-body"');
    expect(popover).not.toContain("textarea");
    expect(popover).not.toContain("添加段落");
    expect(popover).not.toContain("音符与歌词映射");
  });

  it("目标失效撤图；超谱尾行只显示错误且不虚构拍位", () => {
    const value = fixture();
    const positions = planLyricPositions(value.track.measures.at(-1)!);
    const last = positions.at(-1)!;
    const plan = planLyricSequence(value.document, {
      ...value.target, measureId: value.track.measures.at(-1)!.id, ...last,
    }, [{ kind: "set", text: "尾" }, { kind: "set", text: "超" }]);
    const mapping = buildLyricMappingPreview(value.document, plan)!;
    expect(mapping.rows[1]).toMatchObject({ positionLabel: "超出谱尾", status: "error", sourcePosition: null, plannedPosition: null, canInspect: false });
    value.measure.numberedVoice.events = [];
    expect(buildLyricMappingPreview(value.document, value.plan)).toBeNull();
    expect(renderView(value)).not.toContain("音符与歌词映射");
  });

  it("跨小节按各小节真实拍号格式化拍位，适配不写文档或规划", () => {
    const value = fixture();
    const second = value.track.measures[1]!;
    second.timeSignature = { numerator: 6, denominator: 8 };
    const secondEvent = structuredClone(value.event);
    secondEvent.id = "second-event";
    secondEvent.tick = 480;
    second.numberedVoice = { events: [secondEvent], tuplets: [] };
    second.lyrics = [];
    const positions = planLyricPositions(value.measure);
    const last = positions.at(-1)!;
    const plan = planLyricSequence(value.document, { ...value.target, eventId: undefined, ...last }, Array.from({ length: 4 }, () => ({ kind: "set" as const, text: "词" })), true);
    const before = structuredClone({ document: value.document, plan });
    const mapping = buildLyricMappingPreview(value.document, plan)!;
    const row = mapping.rows.find((row) => row.sourcePosition?.measureId === second.id && row.sourcePosition.startTick === 480)!;
    expect(row.positionLabel).toBe("2 小节 / 第2拍");
    expect(mapping.measures.slice(0, 2).map((measure) => measure.beatTicks)).toEqual([960, 480]);
    expect({ document: value.document, plan }).toEqual(before);
  });
});
