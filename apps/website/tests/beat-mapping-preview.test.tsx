import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BeatMappingPreview, beatMappingLayout, type BeatMappingRow } from "../components/EditorShell/music-text/BeatMappingPreview";

const measure = { key: "measure", label: "第 1 小节", durationTicks: 3840, beatTicks: 960 };
const row = (key: string, startTick: number, endTick: number): BeatMappingRow => ({
  key, before: "1", after: "1", positionLabel: "第 1 小节", status: "same", canInspect: true,
  sourcePosition: { trackId: "track", measureId: measure.key, startTick, endTick }, plannedPosition: null,
});

describe("节拍预览的真实时间范围", () => {
  it("单个八分事件仅占自身范围，不为小节未使用的时间扩宽", () => {
    const layout = beatMappingLayout([row("one", 1920, 2400)], measure);
    expect(layout.duration).toBe(480);
    expect(layout.minWidth).toBe(88);
    expect(layout.columns).toBe("480fr");
    expect(layout.items[0]).toMatchObject({ startColumn: 1, endColumn: 2 });
  });

  it("保留不同时值的比例和事件之间的真实空白", () => {
    const layout = beatMappingLayout([row("short", 480, 960), row("long", 1440, 2400)], measure);
    expect(layout.duration).toBe(1920);
    expect(layout.columns).toBe("480fr 480fr 960fr");
    expect(layout.items.map(({ startColumn, endColumn }) => [startColumn, endColumn])).toEqual([[1, 2], [3, 4]]);
    expect(layout.minWidth).toBe(352);
  });

  it("重叠的旧值与候选分行，不改变它们的时间坐标", () => {
    const layout = beatMappingLayout([row("old", 0, 960), row("new", 0, 480)], measure);
    expect(layout.items.map(({ lane }) => lane)).toEqual([0, 1]);
    expect(layout.items.map(({ startColumn, endColumn }) => [startColumn, endColumn])).toEqual([[1, 2], [1, 3]]);
  });

  it("紧凑预览保留全部事件及文字状态，没有原型的六项截断", () => {
    const rows = Array.from({ length: 8 }, (_, i) => row(String(i), i * 240, (i + 1) * 240));
    const html = renderToStaticMarkup(<BeatMappingPreview rows={rows} measures={[measure]} />);
    expect(html.match(/data-start-tick=/g)).toHaveLength(8);
    expect(html).toContain("未变化 · 0.25 拍");
    expect(html).not.toContain("1 → 1");
  });
});
