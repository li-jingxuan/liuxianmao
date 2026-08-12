import { describe, expect, it } from "vitest";

import EXAMPLE_MVP_4 from "../../example/example-mvp4.json";
import {
  applyScoreCommand,
  LXMScoreCommandEnum,
} from "../../src/core/commands";
import type { ILXMBeatRange } from "../../src/editing/tab-cell-selection";
import { validateDocumentSemantics } from "../../src/core/semantic-validation";

const endpoint = (measure: number, beat: number) => ({
  measureId: `mvp2-measure-${measure}`,
  beatId: `mvp2-beat-${measure}-${beat}`,
});

const range = (
  anchor: ReturnType<typeof endpoint>,
  focus: ReturnType<typeof endpoint>,
): ILXMBeatRange => ({
  trackId: "mvp2-track-guitar",
  anchor,
  focus,
});

describe("Beat kind range command", () => {
  it("跨小节反向设置休止，清空音符且只增加一次 revision", () => {
    const document = structuredClone(EXAMPLE_MVP_4);
    const before = document.score.tracks[0]!.measures.slice(0, 2)
      .flatMap((measure) => measure.beats)
      .filter((beat) =>
        new Set([
          "mvp2-beat-1-8",
          "mvp2-beat-1-9",
          "mvp2-beat-2-1",
          "mvp2-beat-2-2",
        ]).has(beat.id),
      )
      .map((beat) => ({ id: beat.id, tick: beat.tick, rhythm: beat.rhythm }));

    const result = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.SetBeatKindRange,
      range: range(endpoint(2, 2), endpoint(1, 8)),
      kind: "rest",
    });

    expect(result).toMatchObject({ ok: true, changed: true });
    if (!result.ok) return;
    expect(result.document.documentRevision).toBe(
      document.documentRevision + 1,
    );
    const after = result.document.score.tracks[0]!.measures.slice(0, 2)
      .flatMap((measure) => measure.beats)
      .filter((beat) => before.some(({ id }) => id === beat.id));
    expect(after.map(({ id, tick, rhythm }) => ({ id, tick, rhythm }))).toEqual(
      before,
    );
    expect(after.every((beat) => beat.kind === "rest")).toBe(true);
    expect(after.every((beat) => beat.notes.length === 0)).toBe(true);
    expect(validateDocumentSemantics(result.document)).toEqual({ ok: true });
    expect(document).toEqual(EXAMPLE_MVP_4);
  });

  it("取消休止只产生空 notes，不虚构已清除的音符", () => {
    const document = structuredClone(EXAMPLE_MVP_4);
    const result = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.SetBeatKindRange,
      range: range(endpoint(2, 2), endpoint(2, 2)),
      kind: "notes",
    });

    expect(result).toMatchObject({ ok: true, changed: true });
    if (!result.ok) return;
    expect(
      result.document.score.tracks[0]!.measures[1]!.beats[1],
    ).toMatchObject({ kind: "notes", notes: [] });
  });

  it("只复制受影响分支，并对已达目标状态返回 no-op", () => {
    const document = structuredClone(EXAMPLE_MVP_4);
    const untouchedMeasure = document.score.tracks[0]!.measures[2]!;
    const first = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.SetBeatKindRange,
      range: range(endpoint(1, 1), endpoint(1, 2)),
      kind: "rest",
    });
    expect(first).toMatchObject({ ok: true, changed: true });
    if (!first.ok) return;
    expect(first.document.score.tracks[0]!.measures[2]).toBe(untouchedMeasure);

    const same = applyScoreCommand(first.document, {
      type: LXMScoreCommandEnum.SetBeatKindRange,
      range: range(endpoint(1, 1), endpoint(1, 2)),
      kind: "rest",
    });
    expect(same).toEqual({
      ok: true,
      changed: false,
      document: first.document,
    });
  });

  it("非法轨道或端点原子失败", () => {
    const document = structuredClone(EXAMPLE_MVP_4);
    const snapshot = structuredClone(document);
    expect(
      applyScoreCommand(document, {
        type: LXMScoreCommandEnum.SetBeatKindRange,
        range: { ...range(endpoint(1, 1), endpoint(1, 2)), trackId: "missing" },
        kind: "rest",
      }),
    ).toMatchObject({ ok: false, code: "INVALID_BEAT_RANGE" });
    expect(
      applyScoreCommand(document, {
        type: LXMScoreCommandEnum.SetBeatKindRange,
        range: range(endpoint(1, 1), {
          measureId: "mvp2-measure-1",
          beatId: "missing",
        }),
        kind: "rest",
      }),
    ).toMatchObject({ ok: false, code: "INVALID_BEAT_RANGE" });
    expect(document).toEqual(snapshot);
  });
});
