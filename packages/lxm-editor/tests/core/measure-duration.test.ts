import { describe, expect, it } from "vitest";
import { changeMeasureDuration } from "../../src/core/rhythm/measure-duration-change";
import { changeMeasureTimeSignature } from "../../src/core/rhythm/time-signature-change";
import type { ILXMBeat, ILXMMeasure } from "../../src";

function emptyMeasure(): ILXMMeasure {
  return {
    id: "m", timeSignature: { numerator: 4, denominator: 4 }, barline: "single",
    tuplets: [], lyrics: [], chordSymbols: [], numberedVoice: { events: [], tuplets: [] },
    beats: Array.from({ length: 4 }, (_, i) => ({ id: `b${i}`, tick: 960 * i,
      kind: "notes", rhythm: { base: "quarter", dots: 0 }, notes: [] })),
  };
}
const ids = () => { let id = 0; return () => `padding-${id++}`; };

describe("小节实际时长", () => {
  it.each([240, 480, 720, 960, 1200, 1920, 3120, 3600])("裁到 %i tick 时保留前段空槽的身份，恢复满拍后移除覆盖", ticks => {
    const initial = emptyMeasure();
    const newId = ids();
    const result = changeMeasureDuration(initial, ticks, newId);
    if (!result.ok) throw Error(result.code);
    expect(result.measure.beats.map(beat => beat.id)).toEqual(initial.beats.filter(beat => beat.tick < ticks).map(beat => beat.id));
    expect(result.measure.actualDurationTicks).toBe(ticks);
    const full = changeMeasureDuration(result.measure, 3840, newId);
    if (!full.ok) throw Error(full.code);
    expect(Object.hasOwn(full.measure, "actualDurationTicks")).toBe(false);
    expect(initial).toEqual(emptyMeasure());
  });

  it.each([
    { kind: "rest" },
    { notes: [{ id: "n", string: 1, fret: 5 }] },
    { preserveInputRhythm: true },
  ] satisfies Partial<ILXMBeat>[])('自动休止后的 $kind 内容仍受保护', content => {
    const measure = emptyMeasure();
    measure.beats[1] = { ...measure.beats[1]!, kind: "rest", capacityRest: true };
    measure.beats[3] = { ...measure.beats[3]!, ...content };
    expect(changeMeasureDuration(measure, 1200, ids())).toMatchObject({ ok: false, code: "MEASURE_CONTENT_EXCEEDS_TIME_SIGNATURE" });
  });

  it("自动休止带技巧时保留完整时值", () => {
    const measure = emptyMeasure();
    measure.beats[2] = { ...measure.beats[2]!, kind: "rest", capacityRest: true };
    expect(changeMeasureDuration(measure, 2160, ids(), new Set(["b2"])).ok).toBe(false);
  });

  it("短小节改拍号时保留实际时长，到等长拍号时恢复默认", () => {
    const pickup = changeMeasureDuration(emptyMeasure(), 1920, ids());
    if (!pickup.ok) throw Error(pickup.code);
    const three = changeMeasureTimeSignature(pickup.measure, { numerator: 3, denominator: 4 }, ids());
    if (!three.ok) throw Error(three.code);
    expect(three.measure.actualDurationTicks).toBe(1920);
    const two = changeMeasureTimeSignature(three.measure, { numerator: 2, denominator: 4 }, ids());
    if (!two.ok) throw Error(two.code);
    expect(Object.hasOwn(two.measure, "actualDurationTicks")).toBe(false);
    expect(two.measure.beats).toBe(pickup.measure.beats);
  });
});
