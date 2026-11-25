import { describe, expect, it } from "vitest";
import {
  applyScoreCommand,
  buildLayout,
  buildScoreScene,
  createJumpMarkIndex,
  createPlaybackPlan,
  createTuningPreset,
  getJumpMarkDependents,
  getPlaybackBeatAtTick,
  loadDocument,
  LXMScoreCommandEnum as Command,
  type ILXMDocument,
  type ILXMJumpMark,
  type ILXMScoreCommand,
} from "../../src";

function practiceScore(): ILXMDocument {
  return {
    schema: "lxm-tab-score", schemaVersion: 8, documentRevision: 1,
    score: {
      id: "practice", title: "曲首回跳练习", arranger: "", keySignature: "C", meta: {},
      tracks: [{
        id: "track", name: "吉他", instrument: "guitar", tuning: createTuningPreset("standard"),
        capo: 0, startBarline: "none", techniques: [], numberedMarks: [],
        measures: Array.from({ length: 8 }, (_, i) => ({
          id: `m${i + 1}`, timeSignature: { numerator: 4, denominator: 4 }, barline: "single",
          tuplets: [], chordSymbols: [], numberedVoice: { events: [], tuplets: [] }, lyrics: [],
          beats: [{ id: `b${i + 1}`, tick: 0, kind: "notes", rhythm: { base: "whole", dots: 0 },
            notes: [{ id: `n${i + 1}`, string: 1, fret: i }] }],
        })),
      }],
    },
  };
}

const track = (doc: ILXMDocument) => doc.score.tracks[0]!;
const measures = (doc: ILXMDocument) => track(doc).measures;
const getMark = (doc: ILXMDocument, number: number) => measures(doc)[number - 1]!.jumpMarks![0]!;
const visitNumbers = (plan: ReturnType<typeof createPlaybackPlan>) => plan.visits.map(({ measureIndex }) => measureIndex + 1);
const apply = (doc: ILXMDocument, command: ILXMScoreCommand) => {
  const result = applyScoreCommand(doc, command);
  if (!result.ok) throw new Error(result.message);
  return result.document;
};
const setMark = (doc: ILXMDocument, number: number, mark: Omit<ILXMJumpMark, "id"> & { id?: string }) =>
  apply(doc, { type: Command.SetJumpMark, trackId: "track", measureId: `m${number}`, mark: { id: "", ...mark } });
const removeMark = (doc: ILXMDocument, number: number) =>
  apply(doc, { type: Command.RemoveJumpMark, trackId: "track", markId: getMark(doc, number).id });
const reopen = (doc: ILXMDocument) => {
  const result = loadDocument(JSON.stringify(doc));
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.document;
};

describe("REQ-107 曲首回跳与结束", () => {
  it.each([
    { kind: "dc", route: [1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6, 7, 8], end: "scoreEnd", targetId: undefined },
    { kind: "dcAlFine", route: [1, 2, 3, 4, 5, 6, 1, 2, 3], end: "fine", targetId: undefined },
    { kind: "dsAlFine", route: [1, 2, 3, 4, 5, 6, 2, 3], end: "fine", targetId: "segno" },
  ] as const)("$kind 的配对、实际到访、拍点与 MIDI 在保存重开后使用同一条路线", ({ kind, route, end, targetId }) => {
    let doc = setMark(setMark(practiceScore(), 2, { kind: "segno" }), 3, { kind: "fine" });
    doc = reopen(setMark(doc, 6, { kind }));
    const command = getMark(doc, 6);
    expect(command.fineId).toBe(kind === "dc" ? undefined : getMark(doc, 3).id);
    expect(command.segnoId).toBe(targetId ? getMark(doc, 2).id : undefined);

    const plan = createPlaybackPlan(doc);
    expect(visitNumbers(plan)).toEqual(route);
    expect(plan.jumpIssue).toBeUndefined();
    expect(plan.jumpEnd).toMatchObject({ kind: end, measureId: `m${route.at(-1)}` });
    expect(plan.visits.at(-1)?.endTick).toBe(plan.durationTicks);
    expect(plan.visits.filter(({ jump }) => jump)).toHaveLength(1);
    expect(plan.visits[6]?.jump).toMatchObject({ kind, fromMarkId: command.id });
    expect(plan.visits[6]?.jump?.toMarkId).toBe(targetId ? getMark(doc, 2).id : undefined);
    expect(plan.sounds.map(({ midi }) => midi)).toEqual(route.map((number) => 63 + number));
    for (const { measureId, visitIndex, startTick } of plan.visits)
      expect(getPlaybackBeatAtTick(plan, startTick)).toMatchObject({ measureId, visitIndex });
  });

  it("D.C. al Coda 首遍经过 To Coda，重奏再进 Coda；断链暂停并定位到 To Coda", () => {
    let doc = setMark(practiceScore(), 8, { kind: "coda" });
    doc = setMark(doc, 3, { kind: "toCoda" });
    doc = reopen(setMark(doc, 6, { kind: "dcAlCoda" }));
    const plan = createPlaybackPlan(doc);
    expect(visitNumbers(plan)).toEqual([1, 2, 3, 4, 5, 6, 1, 2, 3, 8]);
    expect(plan.visits.at(-1)?.jump).toMatchObject({ kind: "toCoda", toMarkId: getMark(doc, 8).id });
    expect(getJumpMarkDependents(getMark(doc, 8).id, createJumpMarkIndex(measures(doc))).map(({ measureId }) => measureId))
      .toEqual(["m3", "m6"]);

    const damaged = reopen(removeMark(doc, 8));
    expect(getMark(damaged, 3).codaId).toBe(getMark(doc, 8).id);
    const prefix = createPlaybackPlan(damaged);
    expect(visitNumbers(prefix)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(prefix.jumpIssue).toMatchObject({ measureId: "m6", repairMarkId: getMark(doc, 3).id });
    expect(prefix.jumpEnd).toBeUndefined();
  });

  it("缺失、多候选和已删除 Fine 都可保存，新增同类不会替换显式配对", () => {
    const missing = reopen(setMark(practiceScore(), 6, { kind: "dcAlFine" }));
    expect(createPlaybackPlan(missing).jumpIssue).toMatchObject({ measureId: "m6", repairMarkId: getMark(missing, 6).id });
    let doc = setMark(setMark(missing, 3, { kind: "fine" }), 5, { kind: "fine" });
    doc = setMark(doc, 6, getMark(doc, 6));
    expect(getMark(doc, 6).fineId).toBeUndefined();
    expect(createPlaybackPlan(doc).jumpIssue?.message).toContain("2 个 Fine");

    const selected = getMark(doc, 5);
    doc = reopen(setMark(doc, 6, { ...getMark(doc, 6), fineId: selected.id }));
    expect(visitNumbers(createPlaybackPlan(doc))).toEqual([1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5]);
    const damaged = reopen(removeMark(doc, 5));
    expect(getMark(damaged, 6).fineId).toBe(selected.id);
    expect(createPlaybackPlan(damaged).jumpIssue?.message).toMatch(/已删除或改类/);
    const repaired = setMark(damaged, 6, { ...getMark(damaged, 6), fineId: getMark(damaged, 3).id });
    expect(createPlaybackPlan(repaired).jumpEnd).toMatchObject({ kind: "fine", markId: getMark(damaged, 3).id });
  });

  it("仅在重奏区间内自动填唯一 Fine，标记移动到区间外保留原引用并暂停", () => {
    let doc = setMark(practiceScore(), 2, { kind: "segno" });
    for (const number of [1, 3, 8]) doc = setMark(doc, number, { kind: "fine" });
    doc = setMark(doc, 6, { kind: "dsAlFine" });
    expect(getMark(doc, 6).fineId).toBe(getMark(doc, 3).id);
    doc = setMark(doc, 7, getMark(doc, 3));
    expect(getMark(doc, 6).fineId).toBe(getMark(doc, 7).id);
    expect(createPlaybackPlan(doc).jumpIssue?.message).toContain("回跳指令之前");
  });

  it("复制包含 Fine 的范围时重新配对副本，原指令仍指向原 Fine", () => {
    const doc = setMark(setMark(practiceScore(), 3, { kind: "fine" }), 6, { kind: "dcAlFine" });
    const copied = reopen(apply(doc, {
      type: Command.CopyMeasureRange, trackId: "track", sourceStartMeasureId: "m3", sourceEndMeasureId: "m6", afterMeasureId: "m8",
    }));
    expect(getMark(copied, 9).id).not.toBe(getMark(doc, 3).id);
    expect(getMark(copied, 12).fineId).toBe(getMark(copied, 9).id);
    expect(getMark(copied, 6).fineId).toBe(getMark(doc, 3).id);
  });

  it("从已到访小节起播继承曲首路线，略过的所选小节保留完整路线供界面提示", () => {
    const doc = setMark(setMark(practiceScore(), 3, { kind: "fine" }), 6, { kind: "dcAlFine" });
    const middle = createPlaybackPlan(doc, { startMeasureId: "m5" });
    expect(visitNumbers(middle)).toEqual([5, 6, 1, 2, 3]);
    expect(middle.visits[0]).toMatchObject({ visitIndex: 4, startTick: 0 });
    const skipped = createPlaybackPlan(doc, { startMeasureId: "m7" });
    expect(visitNumbers(skipped)).toEqual([1, 2, 3, 4, 5, 6, 1, 2, 3]);
    expect(skipped.jumpEnd).toMatchObject({ kind: "fine", measureId: "m3" });
  });

  it("回跳与同一反复边界冲突时定位跳转记号", () => {
    const doc = setMark(practiceScore(), 6, { kind: "dc" });
    measures(doc)[5]!.barline = "repeatEnd";
    const plan = createPlaybackPlan(doc);
    expect(visitNumbers(plan)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(plan.jumpIssue).toMatchObject({ measureId: "m6", repairMarkId: getMark(doc, 6).id });
    expect(plan.repeatEndingIssue).toBeUndefined();
  });

  it("五种记号共享小节末单行图元，编辑和输出均保留标签、点击身份与右对齐", () => {
    const marks = [["dc", "D.C."], ["fine", "Fine"], ["dcAlFine", "D.C. al Fine"],
      ["dsAlFine", "D.S. al Fine"], ["dcAlCoda", "D.C. al Coda"]] as const;
    const doc = marks.reduce((draft, [kind], i) => setMark(draft, i + 1, { kind }), practiceScore());
    for (const purpose of ["editing", "presentation"] as const) {
      const layout = buildLayout(doc, { purpose, systemWidth: 250 });
      const primitives = buildScoreScene(layout).systems.flatMap(({ items }) => items.filter(({ jumpMarkId }) => jumpMarkId));
      expect(primitives).toMatchObject(marks.map(([, text], i) => ({
        kind: "text", text, jumpMarkId: getMark(doc, i + 1).id, textAnchor: "end", fontStyle: "italic",
      })));
      layout.systems.forEach((system) => system.measures.forEach(({ jumpMarks }) => jumpMarks?.forEach(({ bounds }) => {
        expect(bounds.y).toBeGreaterThanOrEqual(system.y);
        expect(bounds.x).toBeGreaterThanOrEqual(system.x);
      })));
    }
  });
});
