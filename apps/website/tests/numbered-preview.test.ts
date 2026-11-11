import { describe, expect, it } from "vitest";
import {
  EXAMPLE_MVP_7_2_DOCUMENT,
  createDocumentIdFactory,
  editNumberedTrack,
} from "@liuxianmao/lxm-editor";
import { buildNumberedPreviewRows, numberedPreviewMapping } from "../components/EditorShell/numbered/numbered-preview";

describe("简谱修改预览 adapter", () => {
  it("按事件身份显示单音组修改前后值", () => {
    const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
    const track = document.score.tracks[0]!;
    const measure = track.measures[0]!;
    const event = measure.numberedVoice.events.find(
      (item) => item.kind === "notes",
    )!;
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

it("均匀连续录入完整预览跨小节、跳拍与不等时值，并保留原节奏", () => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  const first = track.measures[0]!;
  const last = first.numberedVoice.events.at(-1)!;
  const command = {
    type: "numbered.sequence.set" as const,
    trackId: track.id,
    measureId: first.id,
    eventId: last.id,
    items: [
      { kind: "set" as const, tokens: ["7"] },
      { kind: "skip" as const },
      { kind: "set" as const, tokens: ["6"] },
    ],
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
  expect(rows).toHaveLength(3);
  expect(rows.map((row) => row.measureNumber)).toEqual([1, 2, 2]);
  expect(rows[1]?.status).toBe("skip");
  for (const measure of track.measures)
    expect(
      candidate.track.measures
        .find((m) => m.id === measure.id)!
        .numberedVoice.events.map((e) => e.rhythm),
    ).toEqual(measure.numberedVoice.events.map((e) => e.rhythm));
});

it("时值缩短显示释放空位而不伪造休止", () => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  const measure = track.measures[0]!;
  const event = measure.numberedVoice.events[0]!;
  const command = {
    type: "numbered.event.setRhythm" as const,
    trackId: track.id,
    measureId: measure.id,
    eventId: event.id,
    rhythm: { base: "eighth" as const, dots: 0 },
  };
  const candidate = editNumberedTrack(
    track,
    command,
    createDocumentIdFactory(document),
    true,
  );
  expect(candidate.ok).toBe(true);
  if (!candidate.ok) return;
  expect(buildNumberedPreviewRows(track, candidate, command)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        status: "release",
        impact: "release",
        rhythm: "不补休止",
      }),
    ]),
  );
  expect(candidate.track.measures[0]!.numberedVoice.events.length).toBe(
    measure.numberedVoice.events.length,
  );
});

it("时间线保留未改音高事件的原位置和规划位置，不把位移当作无影响", () => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  track.numberedMarks = [];
  const measure = track.measures[0]!;
  measure.numberedVoice.tuplets = [];
  const event = measure.numberedVoice.events[0]!;
  const command = {
    type: "numbered.event.setRhythm" as const,
    trackId: track.id, measureId: measure.id, eventId: event.id,
    rhythm: { base: "half" as const, dots: 0 }, timeline: "editTimeline" as const,
  };
  const candidate = editNumberedTrack(track, command, createDocumentIdFactory(document), true);
  expect(candidate.ok).toBe(true);
  if (!candidate.ok) return;
  const rows = buildNumberedPreviewRows(track, candidate, command);
  for (const id of candidate.movedEventIds) {
    const row = rows.find((item) => item.eventId === id)!;
    expect(row).toBeDefined();
    expect(row.sourcePosition?.startTick).not.toBe(row.plannedPosition?.startTick);
    expect(row.before).toBe(row.after);
    expect(numberedPreviewMapping([row])[0]!.canInspect).toBe(true);
  }
  expect(candidate.movedEventIds.length).toBeGreaterThan(0);
});

it("尚未应用的新事件没有伪造的原谱定位", () => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  const measure = track.measures[0]!;
  measure.numberedVoice.events = [];
  measure.numberedVoice.tuplets = [];
  measure.lyrics = [];
  track.numberedMarks = [];
  const command = {
    type: "numbered.sequence.insert" as const,
    trackId: track.id, measureId: measure.id, startTick: 0, endTick: 960,
    items: [{ kind: "set" as const, tokens: ["6"] }],
    rhythms: [{ base: "eighth" as const, dots: 0 }],
  };
  const candidate = editNumberedTrack(track, command, createDocumentIdFactory(document), true);
  expect(candidate.ok).toBe(true);
  if (!candidate.ok) return;
  const row = numberedPreviewMapping(buildNumberedPreviewRows(track, candidate, command))[0]!;
  expect(row.sourcePosition).toBeNull();
  expect(row.plannedPosition).toEqual({ trackId: track.id, measureId: measure.id, startTick: 0, endTick: 480 });
  expect(row.canInspect).toBe(false);
});
