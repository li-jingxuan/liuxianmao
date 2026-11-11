import { describe, it, expect } from "vitest";
import { EXAMPLE_MVP_6_DOCUMENT } from "@liuxianmao/lxm-editor";
import { deriveSidebarContext } from "../components/EditorShell/music-text/sidebar-context";

describe("编辑台对象位置", () => {
  it("独立简谱事件按真实tick显示，失效成员不回退", () => {
    const document = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
    const track = document.score.tracks[0]!;
    const measure = track.measures[0]!;
    const event = measure.numberedVoice.events[0]!;
    event.tick = 480;
    const target = { kind:"numbered" as const, trackId:track.id, measureId:measure.id, eventId:event.id, itemId:event.items[0]!.id };
    const context = deriveSidebarContext({ document, target });
    expect(context.position).toContain("第1拍 + 1/2");
    expect(context.scope).toContain("第 1 音");
    expect(context.location?.startTick).toBe(480);
    expect(deriveSidebarContext({ document, target:{...target,itemId:"deleted"} })).toMatchObject({ valid:false,location:null });
  });
  it("失效小节保持失效，歌曲不猜谱面目标", () => {
    const document = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
    expect(deriveSidebarContext({document,measureTarget:{trackId:document.score.tracks[0]!.id,measureId:"missing"}})).toMatchObject({valid:false,location:null});
    expect(deriveSidebarContext({document,song:true})).toMatchObject({title:"整首歌曲",location:null});
  });
  it("只有简谱选区时显示独立事件及成员，不读取旧TAB选区", () => {
    const document = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
    const track = document.score.tracks[0]!;
    const measure = track.measures[0]!;
    const event = measure.numberedVoice.events[0]!;
    if (event.kind !== "notes") throw new Error("Expected notes fixture");
    event.items.push({ ...event.items[0]!, id: "second-member" });
    const numberedSelection = { kind: "numberedEvent" as const, trackId: track.id, measureId: measure.id, eventId: event.id, itemId: "second-member" };
    const context = deriveSidebarContext({ document, numberedSelection });
    expect(context).toMatchObject({ title: "简谱音符", valid: true, differentSelection: false, scope: "第 2 音" });
    expect(context.location).toMatchObject({ eventId: event.id, itemId: "second-member", startTick: event.tick });
    expect(deriveSidebarContext({ document, numberedSelection: { ...numberedSelection, eventId: "missing" } }).valid).toBe(false);
  });
  it("和弦同小节换拍与换谱种均标明正在编辑原位置，换弦保持身份", () => {
    const document = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
    const track = document.score.tracks[0]!;
    const measure = track.measures[0]!;
    const target = { kind: "chord" as const, trackId: track.id, measureId: measure.id, beatId: measure.beats[0]!.id, string: 1 };
    const focus = { ...target, string: 6 };
    expect(deriveSidebarContext({ document, target, selection: { anchor: focus, focus } }).differentSelection).toBe(false);
    const next = { ...focus, beatId: measure.beats[1]!.id };
    expect(deriveSidebarContext({ document, target, selection: { anchor: next, focus: next } }).differentSelection).toBe(true);
    expect(deriveSidebarContext({ document, target, numberedSelection: { kind: "numberedEvent", trackId: track.id, measureId: measure.id, eventId: measure.numberedVoice.events[0]!.id } }).differentSelection).toBe(true);
  });
  it("简谱比较完整窗口端点与同时音成员，省略成员时归一到首音", () => {
    const document = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
    const track = document.score.tracks[0]!;
    const measure = track.measures[0]!;
    const event = measure.numberedVoice.events[0]!;
    if (event.kind !== "notes") throw new Error("Expected notes fixture");
    event.items.push({ ...event.items[0]!, id: "second-member" });
    const target = { kind: "numbered" as const, trackId: track.id, measureId: measure.id, eventId: event.id, itemId: event.items[0]!.id };
    const numberedSelection = { ...target, kind: "numberedEvent" as const, itemId: undefined };
    expect(deriveSidebarContext({ document, target, numberedSelection }).differentSelection).toBe(false);
    expect(deriveSidebarContext({ document, target, numberedSelection: { ...numberedSelection, itemId: "second-member" } }).differentSelection).toBe(true);
    const window = { kind: "numbered" as const, trackId: track.id, measureId: measure.id, tick: 0, endTick: 960 };
    expect(deriveSidebarContext({ document, target: window, numberedSelection: { ...window, kind: "numberedTime" } }).differentSelection).toBe(false);
    expect(deriveSidebarContext({ document, target: window, numberedSelection: { ...window, kind: "numberedTime", endTick: 480 } }).differentSelection).toBe(true);
  });
  it("歌词以承载事件比较位置，不把同时音成员当成不同歌词目标", () => {
    const document = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
    const track = document.score.tracks[0]!;
    const measure = track.measures[0]!;
    const event = measure.numberedVoice.events[0]!;
    if (event.kind !== "notes") throw new Error("Expected notes fixture");
    event.items.push({ ...event.items[0]!, id: "second-member" });
    const target = { kind: "lyric" as const, trackId: track.id, measureId: measure.id, eventId: event.id, verse: 2 as const };
    expect(deriveSidebarContext({ document, target, numberedSelection: { ...target, kind: "numberedEvent", itemId: "second-member" } })).toMatchObject({ title: "歌词", scope: "第 2 段", differentSelection: false });
  });
});
