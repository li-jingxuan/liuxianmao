import { describe, expect, it } from "vitest";
import {
  createDocumentIdFactory,
  editNumberedTrack,
  EXAMPLE_MVP_7_2_DOCUMENT,
} from "@liuxianmao/lxm-editor";
import { checkNumberedDraftDependencies } from "../components/EditorShell/NumberedEditor";

const setup = () => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  const measure = track.measures[0]!;
  const event = measure.numberedVoice.events[0]!;
  const candidate = editNumberedTrack(
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
  if (!candidate.ok) throw new Error(candidate.message);
  const state = {
    contentDirty: true,
    rhythmDirty: false,
    itemPitchDirty: false,
    track,
    measureId: measure.id,
    event,
    raw: "6",
    itemId: event.items[0]!.id,
  };
  return { candidate, state };
};

describe("简谱分组提前禁用与提交共用依赖检查", () => {
  it("正文重建成员时保护未应用的时值和成员音高", () => {
    const { state, candidate } = setup();
    expect(
      checkNumberedDraftDependencies(
        { ...state, rhythmDirty: true },
        candidate,
        "content",
      ),
    ).toContain("先应用或恢复事件时值组");
    expect(
      checkNumberedDraftDependencies(
        { ...state, itemPitchDirty: true },
        candidate,
        "content",
      ),
    ).toContain("先应用或恢复单音符音高组");
    expect(
      checkNumberedDraftDependencies(state, candidate, "content"),
    ).toBeNull();
  });

  it("分组应用豁免自身，独立即时命令仍保护内容草稿", () => {
    const { state, candidate } = setup();
    expect(
      checkNumberedDraftDependencies(state, candidate, "content", true),
    ).toBeNull();
    expect(
      checkNumberedDraftDependencies(state, candidate, "content", false),
    ).toContain("先应用或恢复内容组");
  });

  it("相同候选在草稿依赖变化后重新检查，不缓存预览时的通过结果", () => {
    const { state, candidate } = setup();
    expect(
      checkNumberedDraftDependencies(state, candidate, "content"),
    ).toBeNull();
    expect(
      checkNumberedDraftDependencies(
        { ...state, rhythmDirty: true },
        candidate,
        "content",
      ),
    ).toContain("时值草稿");
    expect(
      checkNumberedDraftDependencies(state, candidate, "content"),
    ).toBeNull();
  });
});
