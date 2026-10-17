import { describe, expect, it } from "vitest";
import {
  EXAMPLE_MVP_7_2_DOCUMENT,
  createDocumentIdFactory,
  editNumberedTrack,
} from "@liuxianmao/lxm-editor";
import { buildNumberedPreviewRows } from "../components/EditorShell/numbered-preview";

describe("简谱修改预览 adapter", () => {
  it("按事件身份显示单音组修改前后值", () => {
    const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
    const track = document.score.tracks[0]!;
    const measure = track.measures[0]!;
    const event = measure.numberedVoice.events.find((item) => item.kind === "notes")!;
    const command = {
      type: "numbered.event.set" as const,
      trackId: track.id,
      measureId: measure.id,
      eventId: event.id,
      tokens: ["7"],
    };
    const candidate = editNumberedTrack(
      track,
      command,
      createDocumentIdFactory(document),
      true,
    );
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) return;
    expect(buildNumberedPreviewRows(track, candidate, command)).toMatchObject([
      {
        measureId: measure.id,
        before: event.items.map((item) => item.token).join("+"),
        after: "7",
        status: "change",
      },
    ]);
  });

  it("范围替换按 tick 对齐新旧事件，不把稳定位置误报为全量删除新增", () => {
    const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
    const track = document.score.tracks[0]!;
    const measure = track.measures[0]!;
    const startTick = measure.numberedVoice.events[0]!.tick;
    const command = {
      type: "numbered.range.replace" as const,
      trackId: track.id,
      measureId: measure.id,
      startTick,
      endTick: startTick + 960,
      items: [{ kind: "set" as const, tokens: ["6"] }],
      rhythms: [{ base: "quarter" as const, dots: 0 }],
      allowOverwrite: true,
    };
    const candidate = editNumberedTrack(
      track,
      command,
      createDocumentIdFactory(document),
      true,
    );
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) return;
    const rows = buildNumberedPreviewRows(track, candidate, command);
    expect(rows.some((row) => row.startTick === startTick)).toBe(true);
  });
});
