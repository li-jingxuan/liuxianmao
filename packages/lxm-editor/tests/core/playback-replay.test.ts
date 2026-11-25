import { describe, expect, it } from "vitest";
import {
  applyScoreCommand,
  createPlaybackPlan,
  DEFAULT_MOCK_DOCUMENT,
  getPlaybackBeatAtTick,
  loadDocument,
  LXMScoreCommandEnum,
  type ILXMPlaybackReplay,
} from "../../src";

const idealTrack = DEFAULT_MOCK_DOCUMENT.score.tracks[0]!;
const measureId = (number: number) => idealTrack.measures[number - 1]!.id;
const range = (first: number, last: number) =>
  Array.from({ length: last - first + 1 }, (_, offset) => first + offset);
const order = [...range(1, 33), ...range(17, 31), 34, ...range(25, 31), ...range(35, 42)];

describe("谱面重奏指令", () => {
  it("《理想》保留 33→17，播完 34 后重奏 25–31，从 35 接回，试听音符与游标均跟随到访", () => {
    const plan = createPlaybackPlan(DEFAULT_MOCK_DOCUMENT);
    expect(plan.visits.map(({ measureIndex }) => measureIndex + 1)).toEqual(order);
    const jumpTargets = plan.visits.filter(({ jumped }) => jumped);
    expect(jumpTargets.map(({ measureIndex }) => measureIndex + 1)).toEqual([17, 34, 25, 35]);
    for (const { measureId, startTick, visitIndex } of jumpTargets) {
      expect(getPlaybackBeatAtTick(plan, startTick)).toMatchObject({ measureId, visitIndex });
    }
    const replayVisits = plan.visits.slice(order.lastIndexOf(25), order.lastIndexOf(31) + 1);
    const audibleVisits = new Set(plan.sounds.map(({ visitIndex }) => visitIndex));
    expect(replayVisits.every(({ visitIndex }) => audibleVisits.has(visitIndex))).toBe(true);
    expect(plan.visits.at(-1)?.endTick).toBe(plan.durationTicks);
  });

  it.each([25, 34, 35, 42])("从第 %i 小节起播时沿用首次到访后的完整展开顺序", (start) => {
    const plan = createPlaybackPlan(idealTrack, { startMeasureId: measureId(start) });
    const firstVisit = order.indexOf(start);
    expect(plan.visits[0]).toMatchObject({ visitIndex: firstVisit, startTick: 0 });
    expect(plan.visits.map(({ measureIndex }) => measureIndex + 1)).toEqual(order.slice(firstVisit));
  });

  it("重奏与常规反复重叠时只在锚点的最后一次到访后插入一次", () => {
    const measures = idealTrack.measures.slice(0, 5).map((measure) => ({ ...measure }));
    const [a, b, c, d, e] = measures.map(({ id }) => id);
    measures[0]!.barline = "repeatEnd";
    measures[1]!.barline = "repeatStart";
    measures[3]!.barline = "repeatEnd";
    const source = {
      ...idealTrack,
      repeatEndingGroups: undefined,
      measures,
      techniques: [],
      playbackReplay: { afterMeasureId: d!, fromMeasureId: a!, throughMeasureId: c! },
    };
    const ids = (track: typeof source) => createPlaybackPlan(track).visits.map(({ measureId }) => measureId);
    expect(ids(source)).toEqual([a, a, b, c, d, c, d, a, b, c, e]);
    // 反复线彼此冲突时只回退常规反复，明确写入谱件的重奏区间依然有效。
    measures[1]!.barline = "single";
    expect(ids(source)).toEqual([a, b, c, d, a, b, c, e]);
    expect(createPlaybackPlan(source).warnings).toContainEqual({ code: "invalidRepeat", measureIds: [d] });
  });

  it("未记录重奏指令的旧谱仍使用原本的反复线顺序", () => {
    const { playbackReplay: _replay, repeatEndingGroups: _groups, ...legacyTrack } = idealTrack;
    const document = { ...DEFAULT_MOCK_DOCUMENT, score: { ...DEFAULT_MOCK_DOCUMENT.score, tracks: [legacyTrack] } };
    const loaded = loadDocument(JSON.stringify(document));
    if (!loaded.ok) throw new Error(loaded.errors.join("\n"));
    expect(createPlaybackPlan(loaded.document).visits.map(({ measureIndex }) => measureIndex + 1))
      .toEqual([...range(1, 33), ...range(17, 42)]);
  });

  it.each([
    ["afterMeasureId", "missing"],
    ["fromMeasureId", ""],
    ["fromMeasureId", "missing"],
    ["fromMeasureId", measureId(35)],
    ["throughMeasureId", "missing"],
    ["throughMeasureId", measureId(24)],
    ["throughMeasureId", measureId(34)],
  ] as const)("载入时校验重奏字段 %s=%s", (field, id) => {
    const document = structuredClone(DEFAULT_MOCK_DOCUMENT);
    document.score.tracks[0]!.playbackReplay![field] = id;
    const result = loadDocument(JSON.stringify(document));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain(`score.tracks.0.playbackReplay.${field}`);
  });

  it.each(["afterMeasureId", "fromMeasureId", "throughMeasureId"] satisfies (keyof ILXMPlaybackReplay)[])(
    "删除重奏端点 %s 时从同一事务清除已失效指令",
    (field) => {
      const command = {
        type: LXMScoreCommandEnum.RemoveMeasure as const,
        trackId: idealTrack.id,
        measureId: idealTrack.playbackReplay![field],
      };
      let result = applyScoreCommand(DEFAULT_MOCK_DOCUMENT, command);
      if (!result.ok && result.code === "NUMBERED_IMPACT_REQUIRED")
        result = applyScoreCommand(DEFAULT_MOCK_DOCUMENT, { ...command, confirmedRemovedMarkIds: result.removedMarkIds });
      if (!result.ok) throw new Error(result.message);
      expect(result.document.score.tracks[0]).not.toHaveProperty("playbackReplay");
      expect(loadDocument(JSON.stringify(result.document)).ok).toBe(true);
    },
  );

  it("在重奏区间内插入小节时随书写顺序演奏，仍使用原有端点", () => {
    const result = applyScoreCommand(DEFAULT_MOCK_DOCUMENT, {
      type: LXMScoreCommandEnum.InsertMeasure,
      trackId: idealTrack.id,
      afterMeasureId: measureId(25),
    });
    if (!result.ok) throw new Error(result.message);
    const edited = result.document.score.tracks[0]!;
    expect(edited.playbackReplay).toEqual(idealTrack.playbackReplay);
    const ids = createPlaybackPlan(edited, { startMeasureId: measureId(34) }).visits.map((visit) => visit.measureId);
    expect(ids.slice(0, 5)).toEqual([measureId(34), measureId(25), edited.measures[25]!.id, measureId(26), measureId(27)]);
  });
});
