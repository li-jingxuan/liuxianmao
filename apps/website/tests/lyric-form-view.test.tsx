import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EXAMPLE_MVP_6_DOCUMENT,
  parseLyricSequence,
  planLyricSequence,
  planLyricPositions,
} from "@liuxianmao/lxm-editor";
import { buildLyricMappingPreview, LyricFormView } from "../components/EditorShell/LyricFormView";
import { readMusicTextDraft } from "../components/EditorShell/music-text-draft";

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
  const plan = planLyricSequence(document, target, parsed.items, false);
  const draft = readMusicTextDraft(document, target, "sequence")!;
  draft.text = "新词 _ 续词";
  draft.allowOverwrite = false;
  return { document, track, measure, event, target, plan, draft };
}

const noop = () => {};
function renderView(value: ReturnType<typeof fixture>, text = value.draft.text) {
  return renderToStaticMarkup(<LyricFormView
    document={value.document}
    draft={{ ...value.draft, text }}
    plan={value.plan}
    issue={value.plan.issue}
    inspection={0}
    inputRef={noop}
    sequenceInputRef={noop}
    onModeChange={noop}
    onVerseChange={noop}
    onTextChange={noop}
    onOverwriteChange={noop}
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
    expect(mapping.rows[blankRow.index]!.after).toBe("保留原词");
  });

  it("覆盖许可不足保留完整 rows、领域摘要和音符映射；解析失败撤图", () => {
    const value = fixture();
    expect(value.plan.issue).toContain("允许覆盖");
    const markup = renderView(value);
    expect(markup).toContain("音符与歌词映射");
    expect(markup).toContain("待允许覆盖");
    expect(markup).toContain(`覆盖与逐项预览 <span>${value.plan.rows.length} 个字词 · 第 1 段 · 待允许覆盖</span>`);
    const disclosure = markup.slice(markup.indexOf("<summary>覆盖与逐项预览"), markup.indexOf("</details>", markup.indexOf("<summary>覆盖与逐项预览")));
    expect(disclosure).toContain('type="checkbox"');
    expect(disclosure).toContain("原词 → 新词");
    expect(disclosure).toContain("1 小节 / 第1拍 + 1/2");
    value.draft.allowOverwrite = true;
    expect(renderView(value)).toContain("· 已允许覆盖</span>");
    expect(markup).toContain("覆盖已有歌词");
    expect(renderView(value, "新词\n续词")).not.toContain("音符与歌词映射");
    expect(renderView(value, "新词\n续词")).not.toContain("覆盖与逐项预览");
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
