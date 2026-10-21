import { describe, expect, it } from "vitest";
import {
  EXAMPLE_MVP_7_2_DOCUMENT,
  createDocumentIdFactory,
  editNumberedTrack,
} from "@liuxianmao/lxm-editor";
import { numberedDraftDependency } from "../components/EditorShell/numbered-draft-dependencies";
import type { NumberedEditorDraft } from "../components/EditorShell/NumberedEditor";

const fixture = () => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!,
    measure = track.measures[0]!,
    event = measure.numberedVoice.events[0]!;
  const target = {
    kind: "numbered" as const,
    trackId: track.id,
    measureId: measure.id,
    eventId: event.id,
    itemId: event.items[0]!.id,
  };
  const draft: NumberedEditorDraft = {
    mode: "single",
    selectedId: event.id,
    start: 0,
    end: 960,
    raw: "#7",
    initial: event.items[0]!.token,
    overwrite: false,
    base: "quarter",
    dots: 0,
    template: "uniform",
    itemId: event.items[0]!.id,
    destination: "",
    customRhythms: [],
    ratioIndex: 1,
    itemDraft: "#7",
  };
  return { document, track, measure, event, target, draft };
};
describe("暂存简谱依赖", () => {
  it("无关小节的命令允许保留A的输入和原基线", () => {
    const { document, track, target, draft } = fixture();
    const measure = track.measures[1]!,
      event = measure.numberedVoice.events[0]!;
    const next = editNumberedTrack(
      track,
      {
        type: "numbered.event.set",
        trackId: track.id,
        measureId: measure.id,
        eventId: event.id,
        tokens: ["7"],
      },
      createDocumentIdFactory(document),
      true,
    );
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(numberedDraftDependency(next.track, target, draft)).toBe(
      numberedDraftDependency(track, target, draft),
    );
    expect(draft.raw).toBe("#7");
  });
  it("同目标item重建、范围写入和记号变化都能识别冲突", () => {
    const { document, track, measure, event, target, draft } = fixture();
    const before = numberedDraftDependency(track, target, draft);
    const next = editNumberedTrack(
      track,
      {
        type: "numbered.event.set",
        trackId: track.id,
        measureId: measure.id,
        eventId: event.id,
        tokens: ["6"],
      },
      createDocumentIdFactory(document),
      true,
    );
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(numberedDraftDependency(next.track, target, draft)).not.toBe(before);
    track.numberedMarks.push({
      id: "new-fermata",
      type: "fermata",
      eventId: event.id,
    });
    expect(numberedDraftDependency(track, target, draft)).not.toBe(before);
  });
  it("跨小节连续草稿绑定其实际读取到的后续小节", () => {
    const { track, target, draft } = fixture();
    draft.mode = "sequence";
    draft.selectedId = track.measures[0]!.numberedVoice.events.at(-1)!.id;
    draft.raw = "1 2";
    const before = numberedDraftDependency(track, target, draft);
    track.measures[1]!.numberedVoice.events[0]!.items[0]!.token = "7";
    expect(numberedDraftDependency(track, target, draft)).not.toBe(before);
  });
});
