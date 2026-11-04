import { describe, it, expect } from "vitest";
import { EXAMPLE_MVP_6_DOCUMENT } from "@liuxianmao/lxm-editor";
import { deriveSidebarContext } from "../components/EditorShell/sidebar-context";

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
});
