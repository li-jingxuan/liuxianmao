import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { type MusicTextRange } from "@liuxianmao/lxm-editor";
import { EXAMPLE_MVP_7_2_DOCUMENT } from "../../../packages/lxm-editor/example/fixtures";
import { MusicTextRangeEditor, previewMusicTextRange } from "../../../packages/lxm-editor-react/src/EditorShell/music-text/MusicTextRangeEditor";
import { EditorSessionRuntime } from "../../../packages/lxm-editor-react/src/EditorShell/session/EditorSessionRuntime";
import { EditorStoreContext } from "../../../packages/lxm-editor-react/src/stores/editor-context";
import { createEditorStore } from "../../../packages/lxm-editor-react/src/stores/editor-store";

function fixture(kind: MusicTextRange["kind"] = "numbered") {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  document.score.tracks = [track];
  track.techniques = [];
  track.numberedMarks = [];
  track.measures = track.measures.slice(0, 2);
  for (const [index, measure] of track.measures.entries()) {
    measure.id = `private-measure-${index}`;
    measure.chordSymbols = [];
    measure.tuplets = [];
    measure.timeSignature = { numerator: 4, denominator: 4 };
    measure.beats = Array.from({ length: 4 }, (_, beat) => ({
      id: `tab-${index}-${beat}`, tick: beat * 960, rhythm: { base: "quarter", dots: 0 }, kind: "rest", notes: [],
    }));
    measure.numberedVoice = { tuplets: [], events: Array.from({ length: 4 }, (_, beat) => ({
      id: `event-${index}-${beat}`, tick: beat * 960, rhythm: { base: "quarter", dots: 0 }, kind: "notes",
      items: [{ id: `item-${index}-${beat}`, token: "1" }, { id: `item-extra-${index}-${beat}`, token: "3" }],
    })) };
    measure.lyrics = [{ id: `lyric-${index}`, eventId: `event-${index}-0`, verse: 1, text: index ? "山" : "风" }];
  }
  const range: MusicTextRange = { trackId: track.id, kind, ...(kind === "lyric" ? { verse: 1 } : {}),
    anchor: { measureId: track.measures[0]!.id, eventId: "event-0-0" },
    focus: { measureId: track.measures[1]!.id, eventId: "event-1-0" } };
  return { document, range };
}

describe("范围编辑候选与紧凑表单", () => {
  it("多音为完整一个位置，短输入余位清空，候选不修改原文档", () => {
    const { document, range } = fixture();
    const before = structuredClone(document);
    const preview = previewMusicTextRange(document, range, "2+4 _");
    expect(preview.error).toBeNull();
    expect(preview.rows.map((row) => [row.before, row.after, row.status])).toEqual([
      ["1+3", "2+4", "change"], ["1+3", "1+3", "keep"],
      ["1+3", "", "empty"], ["1+3", "", "empty"], ["1+3", "", "empty"],
    ]);
    expect(document).toEqual(before);
  });

  it("空输入全清，简谱下划线保留，歌词下划线清空", () => {
    const numbered = fixture();
    expect(previewMusicTextRange(numbered.document, numbered.range, "").rows.every((row) => row.status === "empty")).toBe(true);
    expect(previewMusicTextRange(numbered.document, numbered.range, "_ _ _ _ _").rows.every((row) => row.status === "keep")).toBe(true);
    const lyric = fixture("lyric");
    const result = previewMusicTextRange(lyric.document, lyric.range, "_ 云");
    expect(result.error).toBeNull();
    expect(result.rows[0]).toMatchObject({ before: "风", after: "", status: "empty" });
    expect(result.rows[1]).toMatchObject({ before: "", after: "云", status: "change" });
  });

  it("超长与失效范围无候选写入，也不呈现部分替换", () => {
    const { document, range } = fixture();
    const overflow = previewMusicTextRange(document, range, "1 2 3 4 5 6");
    expect(overflow.error).toContain("超过所选范围");
    expect(overflow.rows.every((row) => row.after === row.before && row.status === "error")).toBe(true);
    const stale = previewMusicTextRange(document, { ...range, focus: { ...range.focus, eventId: "deleted" } }, "2");
    expect(stale.error).toContain("失效");
    expect(stale.rows).toEqual([]);
  });

  it.each(["0", "-", ""])("连接影响不把 %j 判为输入错误，用确认候选预览完整范围", (text) => {
    const { document, range } = fixture();
    const track = document.score.tracks[0]!;
    track.measures.forEach((measure) => { measure.lyrics = []; });
    track.numberedMarks = [
      { id: "tie", type: "tie", fromItemId: "item-0-0", toItemId: "item-0-1" },
      { id: "slur", type: "slur", fromEventId: "event-0-0", toEventId: "event-0-1" },
    ];
    const before = structuredClone(document);
    const preview = previewMusicTextRange(document, range, text);
    expect(preview.error).toBeNull();
    expect(preview.removedMarkIds.sort()).toEqual(["slur", "tie"]);
    expect(preview.rows[0]).toMatchObject({ before: "1+3", after: text, status: text ? "change" : "empty" });
    expect(preview.rows.slice(1).every((row) => row.status === "empty" && row.after === "")).toBe(true);
    expect(document).toEqual(before);
  });

  it("真实表单暴露稳定操作标签，以实际小节/拍位置分组，不泄漏工程ID", () => {
    const { document, range } = fixture();
    const session = createEditorStore(document);
    const html = renderToStaticMarkup(<EditorStoreContext.Provider value={session}>
      <EditorSessionRuntime session={session}>
        <MusicTextRangeEditor range={range} onChange={vi.fn()} onClose={vi.fn()} onScoreFocus={vi.fn()} />
      </EditorSessionRuntime>
    </EditorStoreContext.Provider>);
    for (const label of ["范围内容", "应用范围", "清空范围内容", "恢复范围内容"])
      expect(html).toContain(`aria-label="${label}"`);
    expect(html).toContain("data-music-text-range-editor");
    expect(html).toContain("data-range-preview");
    expect(html).toContain("5 个位置");
    expect(html).toContain("第 1 小节");
    expect(html).toContain("第 2 小节");
    expect(html).not.toContain("private-measure");
    expect(html).not.toContain("event-0");
    expect(session.getState().historyDepth.past).toBe(0);
  });
});
