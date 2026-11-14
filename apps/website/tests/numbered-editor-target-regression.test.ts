import { describe, expect, it } from "vitest";
import {
  EXAMPLE_MVP_7_2_DOCUMENT,
  planNumberedInputRanges,
  type ILXMNumberedEvent,
} from "@liuxianmao/lxm-editor";
import {
  numberedTargetWindow,
  resolveNumberedEditorTarget,
} from "../components/EditorShell/numbered/numbered-editor-target";

const fixture = () => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  const measure = track.measures[0]!;
  measure.timeSignature = { numerator: 4, denominator: 4 };
  measure.tuplets = [];
  measure.numberedVoice = { events: [], tuplets: [] };
  measure.beats = [
    { id: "tab-0", tick: 0, rhythm: { base: "eighth", dots: 0 }, kind: "notes", notes: [] },
    { id: "tab-480", tick: 480, rhythm: { base: "sixteenth", dots: 0 }, kind: "notes", notes: [] },
    { id: "tab-720", tick: 720, rhythm: { base: "sixteenth", dots: 0 }, kind: "notes", notes: [] },
    { id: "tab-960", tick: 960, rhythm: { base: "quarter", dots: 0 }, kind: "notes", notes: [] },
  ];
  const tab = (beatId: string) => ({ trackId: track.id, measureId: measure.id, beatId, string: 4 });
  const event: ILXMNumberedEvent = {
    id: "numbered-quarter", tick: 0, kind: "notes",
    rhythm: { base: "quarter", dots: 0 }, items: [{ id: "pitch", token: "1" }],
  };
  return { document, track, measure, tab, event };
};

describe("BUG-019 简谱入口使用真实覆盖事件和合法空位", () => {
  it("TAB 后半拍落在简谱长音内部时定位到原事件，不创建重叠窗口", () => {
    const f = fixture();
    f.measure.numberedVoice.events = [f.event];
    const before = structuredClone(f.document);
    for (const beatId of ["tab-0", "tab-480", "tab-720"]) {
      const target = resolveNumberedEditorTarget(f.document, f.tab(beatId));
      expect(target).toEqual({ kind: "numberedEvent", trackId: f.track.id, measureId: f.measure.id, eventId: f.event.id, itemId: "pitch" });
      expect(numberedTargetWindow(f.document, target!)).toEqual({ start: 0, end: 960 });
    }
    expect(f.document).toEqual(before);
  });

  it("事件结束边界属于后续空位，不能回到前一个长音", () => {
    const f = fixture();
    f.measure.numberedVoice.events = [f.event];
    expect(resolveNumberedEditorTarget(f.document, f.tab("tab-960"))).toEqual({
      kind: "numberedTime", trackId: f.track.id, measureId: f.measure.id, tick: 960, endTick: 1920,
    });
  });

  it("TAB 时值比真实空白更长时使用谱面合法空位，不吞掉相邻简谱", () => {
    const f = fixture();
    f.measure.beats[0]!.rhythm = { base: "quarter", dots: 0 };
    f.measure.numberedVoice.events = [{ ...f.event, tick: 480, rhythm: { base: "eighth", dots: 0 } }];
    const range = planNumberedInputRanges(f.measure).find((item) => item.startTick === 0)!;
    expect(range.endTick).toBe(480);
    expect(resolveNumberedEditorTarget(f.document, f.tab("tab-0"))).toMatchObject({ kind: "numberedTime", tick: range.startTick, endTick: range.endTick });
  });

  it("显式时间范围保留身份，不能因覆盖真实事件就变成事件编辑", () => {
    const f = fixture();
    f.measure.numberedVoice.events = [f.event];
    expect(resolveNumberedEditorTarget(f.document, {
      kind: "numberedTime", trackId: f.track.id, measureId: f.measure.id, tick: 480, endTick: 720,
    })).toEqual({ kind: "numberedTime", trackId: f.track.id, measureId: f.measure.id, tick: 480, endTick: 720 });
    expect(resolveNumberedEditorTarget(f.document, {
      kind: "numbered", trackId: f.track.id, measureId: f.measure.id, tick: 0, endTick: 960,
    })).toEqual({ kind: "numberedTime", trackId: f.track.id, measureId: f.measure.id, tick: 0, endTick: 960 });
  });

  it("真实 gap 内部保留原 gap 身份，不产生普通重叠事件", () => {
    const f = fixture();
    f.measure.numberedVoice.events = [{ ...f.event, id: "gap", kind: "gap", items: [] }];
    expect(resolveNumberedEditorTarget(f.document, f.tab("tab-480"))).toEqual({
      kind: "numberedEvent", trackId: f.track.id, measureId: f.measure.id, eventId: "gap", itemId: undefined,
    });
  });

  it("三连音覆盖范围使用实际比例，事件末尾精确归属下一个成员", () => {
    const f = fixture();
    f.measure.beats = [160, 320].map((tick, index) => ({ ...f.measure.beats[0]!, id: `tab-${index}`, tick }));
    f.measure.numberedVoice.events = [0, 320, 640].map((tick, index) => ({
      ...f.event, id: `triplet-${index}`, tick, rhythm: { base: "eighth", dots: 0 }, items: [{ id: `pitch-${index}`, token: "1" }],
    }));
    f.measure.numberedVoice.tuplets = [{ id: "triplet", ratio: { actual: 3, normal: 2 }, eventIds: f.measure.numberedVoice.events.map((event) => event.id) }];
    const first = resolveNumberedEditorTarget(f.document, f.tab("tab-0"))!;
    const next = resolveNumberedEditorTarget(f.document, f.tab("tab-1"))!;
    expect(first).toMatchObject({ kind: "numberedEvent", eventId: "triplet-0" });
    expect(numberedTargetWindow(f.document, first)).toEqual({ start: 0, end: 320 });
    expect(next).toMatchObject({ kind: "numberedEvent", eventId: "triplet-1" });
  });

  it("无可靠空位映射的 TAB 位置不能伪造窗口", () => {
    const f = fixture();
    f.measure.beats = [{ ...f.measure.beats[0]!, id: "unmapped", tick: 320 }];
    expect(planNumberedInputRanges(f.measure).some((range) => range.startTick === 320)).toBe(false);
    expect(resolveNumberedEditorTarget(f.document, f.tab("unmapped"))).toBeNull();
  });

  it("已失效事件与非法时间窗口继续拒绝，不能静默选中其他事件", () => {
    const f = fixture();
    f.measure.numberedVoice.events = [f.event];
    expect(resolveNumberedEditorTarget(f.document, {
      kind: "numberedEvent", trackId: f.track.id, measureId: f.measure.id, eventId: "deleted",
    })).toBeNull();
    for (const [tick, endTick] of [[-1, 240], [480, 480], [3600, 4000]]) {
      expect(resolveNumberedEditorTarget(f.document, {
        kind: "numberedTime", trackId: f.track.id, measureId: f.measure.id, tick, endTick,
      })).toBeNull();
    }
  });
});
