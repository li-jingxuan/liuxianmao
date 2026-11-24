import { describe, expect, it } from "vitest";
import { createPlaybackPlan, loadDocument, TICKS_PER_QUARTER } from "@liuxianmao/lxm-editor";
import ideal from "../../../packages/lxm-editor/example/ideal-score.lxm.json";
import { createScoreMetronomeGrid, DEFAULT_METER } from "../../../packages/lxm-editor-react/src/EditorShell/playback/metronome-grid";
import { readPracticeSource } from "../../../packages/lxm-editor-react/src/EditorShell/playback/practice-metronome";

function documentFixture() {
  const result = loadDocument(JSON.stringify(ideal));
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.document;
}

describe("REQ-095 metronome clock", () => {
  it("falls back to 90 BPM and 4/4 while retaining the source reason", () => {
    const document = documentFixture();
    delete document.score.tempoBpm;
    document.score.tracks[0]!.measures[0]!.timeSignature = { numerator: 5, denominator: 8 };
    expect(readPracticeSource(document)).toMatchObject({ bpm: 90, meter: DEFAULT_METER });
    expect(readPracticeSource(document).detail).toContain("5/8");
    document.score.tempoBpm = 72;
    document.score.showTempoMark = false;
    document.score.tracks[0]!.measures[0]!.timeSignature = { numerator: 2, denominator: 4 };
    expect(readPracticeSource(document)).toMatchObject({ bpm: 72, meter: { numerator: 2, denominator: 4 } });
  });

  it("follows mixed meters, silent beats, shortened measures, repeats and middle starts", () => {
    const document = documentFixture();
    const track = document.score.tracks[0]!;
    track.measures = track.measures.slice(0, 2);
    const [first, second] = track.measures;
    track.startBarline = "repeatStart";
    track.techniques = [];
    first!.timeSignature = { numerator: 5, denominator: 8 };
    first!.actualDurationTicks = TICKS_PER_QUARTER;
    first!.beats = [];
    second!.timeSignature = { numerator: 3, denominator: 4 };
    second!.barline = "repeatEnd";
    const plan = createPlaybackPlan(document, { bpm: 120, startMeasureId: second!.id });
    expect(plan.visits.map((visit) => visit.measureId)).toEqual([second!.id, first!.id, second!.id]);
    const grid = createScoreMetronomeGrid(plan, track.measures);
    const repeatTick = plan.visits[1]!.startTick;
    expect(grid.beatAt(0)).toEqual({ tick: 0, number: 1 });
    expect(grid.meterAt(0)).toEqual(second!.timeSignature);
    expect(grid.meterAt(repeatTick)).toEqual(first!.timeSignature);
    expect(grid.nextBeat(repeatTick, false)).toEqual({ tick: repeatTick + TICKS_PER_QUARTER / 2, number: 2 });
    expect(grid.beatAt(repeatTick + TICKS_PER_QUARTER - 1)?.number).toBe(2);
    expect(grid.nextBeat(repeatTick + TICKS_PER_QUARTER / 2, false)).toEqual({ tick: plan.visits[2]!.startTick, number: 1 });
  });
});
