import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  A4_CONTENT_WIDTH,
  applyScoreCommand,
  buildLayout,
  buildScoreScene,
  createDocumentHistory,
  createPlaybackPlan,
  getPlaybackBeatAtTick,
  loadDocument,
  LXMScoreCommandEnum as Command,
  transitionDocumentHistory,
  validateRepeatEndingGroup,
  type ILXMDocument,
  type ILXMScoreCommand,
} from "../../src";

const fixture = readFileSync(new URL("../fixtures/req106-three-endings.lxm", import.meta.url), "utf8");
const expected = [1, 2, 3, 4, 5, 1, 2, 3, 6, 1, 2, 3, 7, 8, 9, 10];
const track = (document: ILXMDocument) => document.score.tracks[0]!;
const numbers = (plan: ReturnType<typeof createPlaybackPlan>) => plan.visits.map(({ measureIndex }) => measureIndex + 1);

function reopen(source: string | ILXMDocument = fixture) {
  const result = loadDocument(typeof source === "string" ? source : JSON.stringify(source));
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.document;
}

function apply(document: ILXMDocument, command: ILXMScoreCommand) {
  const result = applyScoreCommand(document, command);
  if (!result.ok) throw new Error(result.message);
  return result.document;
}

describe("REQ-106 反复房子", () => {
  it("真实谱件同时保留跨行括线、稳定身份与三遍 16 次到访", () => {
    const document = reopen();
    const layout = buildLayout(document, { systemWidth: A4_CONTENT_WIDTH, purpose: "editing", density: "compact", editingTailWidth: 36 });
    const segments = layout.systems.flatMap(({ repeatEndings }) => repeatEndings ?? []).filter(({ id }) => id === "ending-1");
    expect(segments.map(({ label, starts, ends }) => ({ label, starts, ends }))).toEqual([
      { label: "1.", starts: true, ends: false }, { label: "(1.)", starts: false, ends: true },
    ]);
    const scene = buildScoreScene(layout);
    expect(scene.systems.flatMap(({ items }) => items).filter((item) => item.repeatEndingId === "ending-1")).toHaveLength(6);
    const plan = createPlaybackPlan(reopen(document));
    expect(numbers(plan)).toEqual(expected);
    expect(plan.visits.map(({ repeatEnding }) => repeatEnding?.pass)).toEqual([
      1, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3, undefined, undefined,
    ]);
    expect(plan.sounds.map(({ midi }) => midi)).toEqual(expected.map((number) => number + 64));
    for (const { visitIndex, repeatEnding, startTick } of plan.visits) {
      const beat = getPlaybackBeatAtTick(plan, startTick);
      expect(beat?.visitIndex).toBe(visitIndex);
      expect(beat?.repeatEnding).toEqual(repeatEnding);
    }
    expect(numbers(createPlaybackPlan(document, { startMeasureId: "m6" }))).toEqual(expected.slice(8));
  });

  it("重叠、重复遍次和越界拒绝保存，删除后缺房可保存、定位并补回", () => {
    const document = reopen();
    const group = track(document).repeatEndingGroups![0]!;
    const ending = group.endings[1]!;
    for (const invalid of [{ ...ending, startMeasureId: "m5" }, { ...ending, passes: [1] }, { ...ending, endMeasureId: "m9" }]) {
      expect(applyScoreCommand(document, { type: Command.UpsertRepeatEnding, trackId: "track", group, ending: invalid }))
        .toMatchObject({ ok: false, code: "INVALID_REPEAT_ENDING" });
    }
    const missing = reopen(apply(document, { type: Command.DeleteRepeatEnding, trackId: "track", endingId: ending.id }));
    const prefix = createPlaybackPlan(missing, { startMeasureId: "m6" });
    expect(numbers(prefix)).toEqual(expected.slice(0, 8));
    expect(prefix.repeatEndingIssue).toMatchObject({ groupId: group.id, pass: 2, measureId: "m3", measureIndex: 2 });
    expect(prefix.durationTicks).toBe(prefix.visits.at(-1)!.endTick);
    const repaired = apply(missing, { type: Command.UpsertRepeatEnding, trackId: "track", group, ending: { ...ending, id: "" } });
    expect(track(repaired).repeatEndingGroups![0]!.endings.find(({ passes }) => passes.includes(2))!.id).not.toBe(ending.id);
    expect(numbers(createPlaybackPlan(reopen(repaired)))).toEqual(expected);
  });

  it("整组草稿一次提交并保持组与房子 ID，缺房由可复用校验结果报告", () => {
    const document = reopen();
    const current = track(document).repeatEndingGroups![0]!;
    const draft = { ...current, endings: current.endings.slice(0, 2) };
    const validation = validateRepeatEndingGroup(track(document), draft);
    expect(validation.ok).toBe(true);
    expect(validation.missingPasses).toEqual([3]);
    const result = applyScoreCommand(document, {
      type: Command.UpsertRepeatEndingGroup,
      trackId: "track",
      group: draft,
    });
    expect(result).toMatchObject({ ok: true, changed: true });
    if (!result.ok) return;
    expect(result.document.score.tracks[0]!.repeatEndingGroups![0]).toEqual(draft);
    expect(applyScoreCommand(result.document, {
      type: Command.UpsertRepeatEndingGroup,
      trackId: "track",
      group: { ...draft, endings: [draft.endings[0]!, { ...draft.endings[1]!, startMeasureId: "m5" }] },
    })).toMatchObject({ ok: false, code: "INVALID_REPEAT_ENDING" });
  });

  it("互换两房遍次并缩短组末可一起提交，一步撤销恢复整组", () => {
    const document = reopen();
    const original = track(document).repeatEndingGroups![0]!;
    const [first, second] = original.endings;
    const group = { ...original, endMeasureId: "m7", endings: [
      { ...first!, passes: [2] },
      { ...second!, passes: [1] },
    ] };
    const command = { type: Command.UpsertRepeatEndingGroup, trackId: "track", group } as const;
    const edited = apply(document, command);
    expect(edited.documentRevision).toBe(document.documentRevision + 1);
    expect(track(edited).repeatEndingGroups).toEqual([group]);
    expect(applyScoreCommand(edited, command)).toMatchObject({ ok: true, changed: false });
    const history = transitionDocumentHistory(createDocumentHistory<typeof command>(), { type: "commit", document, entry: command });
    expect(track(history.past[0]!).repeatEndingGroups).toEqual([original]);
    const restored = transitionDocumentHistory(history, { type: "undo", document: edited, keepCount: 0 });
    expect(restored.past).toEqual([]);
    expect(restored.future).toEqual([edited]);
  });

  it("整组新建时为组和每个房子生成可重开的稳定 ID", () => {
    const document = reopen();
    const original = track(document).repeatEndingGroups![0]!;
    const withoutGroup = apply(document, {
      type: Command.DeleteRepeatEndingGroup,
      trackId: "track",
      groupId: original.id,
    });
    const draft = {
      ...original,
      id: "",
      endings: original.endings.map((ending) => ({ ...ending, id: "" })),
    };
    expect(validateRepeatEndingGroup(track(withoutGroup), { ...draft, endings: [] }).issues[0]?.field).toBe("endings");
    expect(validateRepeatEndingGroup(track(document), { ...draft }).issues[0]?.field).toBe("startMeasureId");
    expect(validateRepeatEndingGroup(track(withoutGroup), { ...draft, endings: original.endings }).issues[0]?.field).toBe("id");
    const result = applyScoreCommand(withoutGroup, {
      type: Command.UpsertRepeatEndingGroup,
      trackId: "track",
      group: draft,
    });
    expect(result).toMatchObject({ ok: true, changed: true });
    if (!result.ok) return;
    const saved = track(result.document).repeatEndingGroups![0]!;
    expect(saved.id).toBeTruthy();
    expect(saved.endings.every(({ id }) => id)).toBe(true);
    expect(new Set([saved.id, ...saved.endings.map(({ id }) => id)])).toHaveProperty("size", 4);
    expect(track(reopen(result.document)).repeatEndingGroups![0]).toEqual(saved);
  });

  it("回跳进入共享段保留最终遍次，错落到其它房在发音前定位来源指令", () => {
    const document = reopen();
    const measures = track(document).measures;
    measures[1]!.jumpMarks = [{ id: "start", kind: "segno" }];
    measures[8]!.jumpMarks = [{ id: "back", kind: "ds", segnoId: "start" }];
    const samePass = createPlaybackPlan(document);
    expect(numbers(samePass)).toEqual([...expected.slice(0, -1), 2, 3, 7, 8, 9, 10]);
    expect(samePass.visits[15]?.repeatEnding?.pass).toBe(3);

    delete measures[1]!.jumpMarks;
    measures[4]!.jumpMarks = [{ id: "start", kind: "segno" }];
    const stop = createPlaybackPlan(document);
    expect(numbers(stop)).toEqual(expected.slice(0, -1));
    expect(stop.repeatEndingIssue).toMatchObject({ reason: "invalidDestination", repairMarkId: "back", measureId: "m9", pass: 3 });
    expect(stop.sounds).toHaveLength(15);
  });

  it("删房子端点保留缺房组，删组端点解除组，谱件始终可重开", () => {
    const document = reopen();
    const missing = reopen(apply(document, { type: Command.RemoveMeasure, trackId: "track", measureId: "m6" }));
    expect(createPlaybackPlan(missing).repeatEndingIssue?.pass).toBe(2);
    const standalone = reopen(apply(document, { type: Command.RemoveMeasure, trackId: "track", measureId: "m3" }));
    expect(track(standalone).repeatEndingGroups).toBeUndefined();
    expect(createPlaybackPlan(standalone).visits.map(({ measureId }) => measureId)).toEqual([
      "m1", "m2", "m4", "m5", "m1", "m2", "m4", "m5", "m6", "m7", "m8", "m9", "m10",
    ]);
  });
});
