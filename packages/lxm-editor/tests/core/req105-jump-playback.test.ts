import { describe, expect, it } from "vitest";
import idealFile from "../../example/ideal-score.lxm.json";
import {
  applyScoreCommand,
  createPlaybackPlan,
  createTuningPreset,
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
      id: "practice", title: "跳转练习", arranger: "", keySignature: "C", meta: {},
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
const visitNumbers = (plan: ReturnType<typeof createPlaybackPlan>) => plan.visits.map(({ measureIndex }) => measureIndex + 1);
const apply = (doc: ILXMDocument, command: ILXMScoreCommand) => {
  const result = applyScoreCommand(doc, command);
  if (!result.ok) throw new Error(result.message);
  return result.document;
};
const setMark = (doc: ILXMDocument, number: number, mark: Omit<ILXMJumpMark, "id"> & { id?: string }) =>
  apply(doc, { type: Command.SetJumpMark, trackId: "track", measureId: `m${number}`, mark: { id: "", ...mark } });
const getMark = (doc: ILXMDocument, number: number) => measures(doc)[number - 1]!.jumpMarks![0]!;
const remove = (doc: ILXMDocument, markId: string) => apply(doc, { type: Command.RemoveJumpMark, trackId: "track", markId });
const reopen = (doc: unknown) => {
  const result = loadDocument(JSON.stringify(doc));
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.document;
};

function codaScore() {
  let doc = practiceScore();
  for (const [number, kind] of [[2, "segno"], [8, "coda"], [4, "toCoda"], [6, "dsAlCoda"]] as const)
    doc = setMark(doc, number, { kind });
  return doc;
}

describe("REQ-105 谱面跳转试听", () => {
  it("保存唯一配对，首遍顺行，两个跳转的到访、拍点和 MIDI 使用相同路线", () => {
    const doc = reopen(codaScore());
    expect(getMark(doc, 6)).toMatchObject({ segnoId: getMark(doc, 2).id, toCodaId: getMark(doc, 4).id });
    expect(getMark(doc, 4).codaId).toBe(getMark(doc, 8).id);
    const plan = createPlaybackPlan(doc);
    const order = [1, 2, 3, 4, 5, 6, 2, 3, 4, 8];
    expect(visitNumbers(plan)).toEqual(order);
    expect(plan.visits.flatMap(({ jump }) => jump ? [jump.kind] : [])).toEqual(["dsAlCoda", "toCoda"]);
    expect(plan.sounds.map(({ midi }) => midi)).toEqual(order.map((n) => 63 + n));
    for (const { measureId, visitIndex, startTick } of plan.visits) {
      expect(getPlaybackBeatAtTick(plan, startTick)).toMatchObject({ measureId, visitIndex });
      expect(plan.sounds[visitIndex]).toMatchObject({ visitIndex, startTick });
    }
    expect(visitNumbers(createPlaybackPlan(doc, { startMeasureId: "m5" }))).toEqual([5, 6, 2, 3, 4, 8]);
    expect(visitNumbers(createPlaybackPlan(doc, { startMeasureId: "m7" }))).toEqual([7, 8]);
  });

  it("纯 D.S. 只执行一次，多个 Segno 需要手选，移动保留原配对身份", () => {
    let doc = setMark(setMark(practiceScore(), 2, { kind: "segno" }), 1, { kind: "segno" });
    doc = setMark(doc, 6, { kind: "ds" });
    expect(getMark(doc, 6).segnoId).toBeUndefined();
    expect(createPlaybackPlan(doc).jumpIssue).toMatchObject({ repairMarkId: getMark(doc, 6).id });
    const segno = getMark(doc, 2);
    doc = setMark(doc, 6, { ...getMark(doc, 6), segnoId: segno.id });
    expect(visitNumbers(createPlaybackPlan(doc))).toEqual([1, 2, 3, 4, 5, 6, 2, 3, 4, 5, 6, 7, 8]);
    const moved = setMark(doc, 3, segno);
    expect(measures(moved)[1]!.jumpMarks).toBeUndefined();
    expect(getMark(moved, 3)).toEqual(segno);
    expect(getMark(moved, 6).segnoId).toBe(segno.id);
    expect(visitNumbers(createPlaybackPlan(moved))).toEqual([1, 2, 3, 4, 5, 6, 3, 4, 5, 6, 7, 8]);
  });

  it("删除后保留显式失效配对，暂停在回跳指令，修复直接定位 To Coda", () => {
    const doc = setMark(codaScore(), 7, { kind: "coda" });
    const removed = getMark(doc, 8).id;
    const damaged = reopen(remove(doc, removed));
    expect(getMark(damaged, 4).codaId).toBe(removed);
    const prefix = createPlaybackPlan(damaged);
    expect(visitNumbers(prefix)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(prefix.sounds).toHaveLength(6);
    expect(prefix.jumpIssue).toMatchObject({ measureId: "m6", repairMarkId: getMark(doc, 4).id });
    const repaired = setMark(damaged, 4, { ...getMark(damaged, 4), codaId: getMark(damaged, 7).id });
    expect(visitNumbers(createPlaybackPlan(repaired))).toEqual([1, 2, 3, 4, 5, 6, 2, 3, 4, 7, 8]);
  });

  it("改类后仅用仍存在的候选，旧类型的自身 ID 不参与自动配对", () => {
    const doc = setMark(practiceScore(), 2, { kind: "segno" });
    const { id } = getMark(doc, 2);
    const withoutTarget = setMark(doc, 2, { id, kind: "ds" });
    expect(getMark(withoutTarget, 2)).toEqual({ id, kind: "ds" });
    const withTarget = setMark(doc, 1, { kind: "segno" });
    expect(getMark(setMark(withTarget, 2, { id, kind: "ds" }), 2)).toEqual({ id, kind: "ds", segnoId: getMark(withTarget, 1).id });
  });

  it("复制仅重新指向复制区间内的记号，复制身份唯一", () => {
    const doc = codaScore();
    const copied = apply(doc, {
      type: Command.CopyMeasureRange, trackId: "track", sourceStartMeasureId: "m2", sourceEndMeasureId: "m6", afterMeasureId: "m8",
    });
    const [segno, toCoda, ds] = [9, 11, 13].map((number) => getMark(copied, number));
    expect(segno!.id).not.toBe(getMark(doc, 2).id);
    expect(ds).toMatchObject({ segnoId: segno!.id, toCodaId: toCoda!.id });
    expect(toCoda!.codaId).toBe(getMark(doc, 8).id);
    expect(reopen(copied)).toEqual(copied);
  });

  it("反复、重奏和跳转在不同边界依次执行，在同一边界保留可播放前缀", () => {
    const doc = setMark(setMark(practiceScore(), 1, { kind: "segno" }), 7, { kind: "ds" });
    measures(doc)[1]!.barline = "repeatEnd";
    track(doc).playbackReplay = { afterMeasureId: "m6", fromMeasureId: "m3", throughMeasureId: "m4" };
    expect(visitNumbers(createPlaybackPlan(doc))).toEqual([1, 2, 1, 2, 3, 4, 5, 6, 3, 4, 7, 1, 2, 3, 4, 5, 6, 7, 8]);
    const conflict = setMark(doc, 2, getMark(doc, 7));
    const prefix = createPlaybackPlan(conflict);
    expect(visitNumbers(prefix)).toEqual([1, 2]);
    expect(prefix.jumpIssue).toMatchObject({ repairMarkId: getMark(conflict, 2).id });
  });

  it("旧《理想》谱件重开后仍保留 66 次到访及三处衔接", () => {
    const doc = reopen(idealFile);
    // 旧谱仅用普通反复线和重奏区间；在独立副本中还原这种文件格式，继续验证兼容路线。
    delete track(doc).repeatEndingGroups;
    for (const measure of measures(doc)) delete measure.jumpMarks;
    const plan = createPlaybackPlan(reopen(doc));
    expect(measures(doc).every(({ jumpMarks }) => jumpMarks === undefined)).toBe(true);
    expect(plan.visits).toHaveLength(66);
    expect(plan.visits.filter(({ jumped }) => jumped).map(({ measureIndex }) => measureIndex + 1)).toEqual([17, 25, 35]);
  });
});
