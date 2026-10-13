import { describe, expect, it } from "vitest";
import {
  applyScoreCommand,
  EXAMPLE_MVP_6_DOCUMENT,
  LXMScoreCommandEnum,
  loadDocument,
} from "../../src";

describe("MVP7.1-B 单轨设置与多小节复制", () => {
  it("设置 capo 和段落标记保持音符与时值不变", () => {
    const document = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
    const track = document.score.tracks[0]!;
    const measure = track.measures[0]!;
    const capo = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.SetCapo,
      trackId: track.id,
      capo: 3,
    });
    expect(capo.ok && capo.document.score.tracks[0]!.capo).toBe(3);
    const marked = applyScoreCommand(capo.ok ? capo.document : document, {
      type: LXMScoreCommandEnum.SetSectionLabel,
      trackId: track.id,
      measureId: measure.id,
      label: "副歌",
    });
    expect(
      marked.ok && marked.document.score.tracks[0]!.measures[0]!.sectionLabel,
    ).toBe("副歌");
    expect(
      marked.ok && marked.document.score.tracks[0]!.measures[0]!.beats,
    ).toEqual(measure.beats);
  });

  it("多小节复制生成新实体并通过 loader 语义校验", () => {
    const document = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
    const track = document.score.tracks[0]!;
    const sourceStart = track.measures[0]!;
    const sourceEnd = track.measures[1]!;
    const result = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.CopyMeasureRange,
      trackId: track.id,
      sourceStartMeasureId: sourceStart.id,
      sourceEndMeasureId: sourceEnd.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.score.tracks[0]!.measures).toHaveLength(
      track.measures.length + 2,
    );
    const ids = result.document.score.tracks[0]!.measures.map(
      (measure) => measure.id,
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(loadDocument(JSON.stringify(result.document)).ok).toBe(true);
  });
});

import {
  createTuningPreset,
  validateTuning,
  upgradeDocumentToCurrent,
  EXAMPLE_TECHNIQUE_RHYTHM_DOCUMENT,
  buildLayout,
  normalizeMusicText,
} from "../../src";

describe("v7.1-B 边界与保真", () => {
  it("调弦预设独立、音名与 MIDI 一致且不可改变弦数", () => {
    const standard = createTuningPreset("standard");
    const drop = createTuningPreset("dropD");
    expect(drop.strings[5]).toEqual({ index: 6, pitch: "D2", midi: 38 });
    expect(validateTuning(drop)).toBe(true);
    drop.strings[0]!.midi = 1;
    expect(validateTuning(drop)).toBe(false);
    expect(standard.strings[0]!.midi).toBe(64);
    expect(validateTuning({ strings: standard.strings.slice(1) })).toBe(false);
    const doc = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
    const track = doc.score.tracks[0]!;
    const result = applyScoreCommand(doc, {
      type: LXMScoreCommandEnum.SetTuning,
      trackId: track.id,
      tuning: createTuningPreset("dropD"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.score.tracks[0]!.measures).toEqual(track.measures);
    expect(result.document.score.tracks[0]!.techniques).toEqual(
      track.techniques,
    );
    expect(loadDocument(JSON.stringify(result.document)).ok).toBe(true);
    result.document.score.tracks[0]!.tuning.strings[0]!.midi = 1;
    expect(loadDocument(JSON.stringify(result.document)).ok).toBe(false);
  });
  it.each([-1, 13, 1.5, NaN])("非法 capo %s 原子失败", (capo) => {
    const doc = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
    const before = structuredClone(doc);
    expect(
      applyScoreCommand(doc, {
        type: LXMScoreCommandEnum.SetCapo,
        trackId: doc.score.tracks[0]!.id,
        capo,
      }).ok,
    ).toBe(false);
    expect(doc).toEqual(before);
  });
  it("no-op 保留引用，段落拒绝控制字符并可清除", () => {
    const doc = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
    const track = doc.score.tracks[0]!;
    const noop = applyScoreCommand(doc, {
      type: LXMScoreCommandEnum.SetTuning,
      trackId: track.id,
      tuning: track.tuning,
    });
    expect(noop.ok && noop.document).toBe(doc);
    for (const label of ["A\nB", "A\u2028B", "\n", "中".repeat(33)]) {
      expect(normalizeMusicText(label, 32)).toBeNull();
      expect(
        applyScoreCommand(doc, {
          type: LXMScoreCommandEnum.SetSectionLabel,
          trackId: track.id,
          measureId: track.measures[0]!.id,
          label,
        }).ok,
      ).toBe(false);
    }
    const marked = applyScoreCommand(doc, {
      type: LXMScoreCommandEnum.SetSectionLabel,
      trackId: track.id,
      measureId: track.measures[0]!.id,
      label: "  副歌  ",
    });
    if (!marked.ok) throw new Error("标记失败");
    const layout = buildLayout(marked.document);
    expect(marked.document.score.tracks[0]!.measures[0]!.sectionLabel).toBe(
      "副歌",
    );
    // 段落标记仍可保存，但不再生成顶部说明或影响谱面几何。
    expect(layout).toEqual(buildLayout(doc));
    const cleared = applyScoreCommand(marked.document, {
      type: LXMScoreCommandEnum.SetSectionLabel,
      trackId: track.id,
      measureId: track.measures[0]!.id,
      label: null,
    });
    expect(
      cleared.ok && cleared.document.score.tracks[0]!.measures[0]!.sectionLabel,
    ).toBeUndefined();
  });
  it("显式升级经过校验，loader 拒绝 schema 4，输入不变", () => {
    const old = structuredClone(EXAMPLE_MVP_6_DOCUMENT) as unknown as Record<
      string,
      unknown
    >;
    old.schemaVersion = 4;
    const legacyScore = old.score as Record<string, unknown>;
    delete legacyScore.arranger;
    delete legacyScore.keySignature;
    const oldScore = old.score as { tracks: { capo?: number }[] };
    oldScore.tracks.forEach((t) => {
      delete t.capo;
    });
    const before = structuredClone(old);
    expect(loadDocument(JSON.stringify(old)).ok).toBe(false);
    const upgraded = upgradeDocumentToCurrent(old);
    expect(upgraded.ok).toBe(true);
    expect(old).toEqual(before);
    expect(upgradeDocumentToCurrent({ ...old, score: {} }).ok).toBe(false);
    expect(upgradeDocumentToCurrent(EXAMPLE_MVP_6_DOCUMENT).ok).toBe(false);
  });
  it.each([2, 4, 8, 14])(
    "复制 %s 小节携带技巧、文本、连音与边界且 ID 唯一",
    (count) => {
      const doc = structuredClone(EXAMPLE_TECHNIQUE_RHYTHM_DOCUMENT);
      const track = doc.score.tracks[0]!;
      const before = structuredClone(doc);
      const result = applyScoreCommand(doc, {
        type: LXMScoreCommandEnum.CopyMeasureRange,
        trackId: track.id,
        sourceStartMeasureId: track.measures[0]!.id,
        sourceEndMeasureId: track.measures[count - 1]!.id,
        afterMeasureId: track.measures.at(-1)!.id,
      });
      if (!result.ok) throw new Error(result.message);
      expect(doc).toEqual(before);
      expect(loadDocument(JSON.stringify(result.document)).ok).toBe(true);
      const copies = result.document.score.tracks[0]!.measures.slice(-count);
      copies.forEach((copy, i) => {
        expect(copy.id).not.toBe(track.measures[i]!.id);
        expect(copy.barline).toBe(track.measures[i]!.barline);
        expect(
          copy.beats.map((b) => [b.tick, b.rhythm, b.notes.map((n) => n.fret)]),
        ).toEqual(
          track.measures[i]!.beats.map((b) => [
            b.tick,
            b.rhythm,
            b.notes.map((n) => n.fret),
          ]),
        );
        expect(copy.lyrics.map((l) => l.text)).toEqual(
          track.measures[i]!.lyrics.map((l) => l.text),
        );
        expect(copy.chordSymbols.map((c) => c.chord)).toEqual(
          track.measures[i]!.chordSymbols.map((c) => c.chord),
        );
      });
      if (count === 14)
        expect(result.document.score.tracks[0]!.techniques).toHaveLength(
          track.techniques.length * 2,
        );
      expect(
        result.effects?.filter((e) => e.kind === "measures.copied"),
      ).toHaveLength(1);
    },
  );
  it("范围内跨小节区间复制一次，贯穿边界区间报告一次", () => {
    const doc = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
    const track = doc.score.tracks[0]!;
    track.measures.forEach((m) =>
      m.beats.forEach((b) => {
        b.kind = "notes";
      }),
    );
    track.techniques = [
      {
        id: "range-internal",
        type: "palmMute",
        fromBeatId: track.measures[1]!.beats[0]!.id,
        toBeatId: track.measures[2]!.beats[0]!.id,
      },
    ];
    const result = applyScoreCommand(doc, {
      type: LXMScoreCommandEnum.CopyMeasureRange,
      trackId: track.id,
      sourceStartMeasureId: track.measures[1]!.id,
      sourceEndMeasureId: track.measures[2]!.id,
    });
    if (!result.ok) throw new Error(result.message);
    expect(
      result.document.score.tracks[0]!.techniques.filter(
        (t) => t.type === "palmMute",
      ),
    ).toHaveLength(2);
    expect(
      result.effects?.filter((e) => e.kind === "technique.omitted"),
    ).toHaveLength(0);
    track.techniques = [
      {
        id: "range-external",
        type: "letRing",
        fromBeatId: track.measures[0]!.beats[0]!.id,
        toBeatId: track.measures[3]!.beats[0]!.id,
      },
    ];
    const external = applyScoreCommand(doc, {
      type: LXMScoreCommandEnum.CopyMeasureRange,
      trackId: track.id,
      sourceStartMeasureId: track.measures[1]!.id,
      sourceEndMeasureId: track.measures[2]!.id,
    });
    expect(
      external.ok &&
        external.effects?.filter((e) => e.kind === "technique.omitted"),
    ).toHaveLength(1);
    expect(loadDocument(JSON.stringify(result.document)).ok).toBe(true);
  });
  it("倒序、缺失和源内部插入拒绝，源末尾允许", () => {
    const doc = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
    const track = doc.score.tracks[0]!;
    const command = {
      type: LXMScoreCommandEnum.CopyMeasureRange as const,
      trackId: track.id,
      sourceStartMeasureId: track.measures[0]!.id,
      sourceEndMeasureId: track.measures[2]!.id,
    };
    expect(
      applyScoreCommand(doc, {
        ...command,
        sourceStartMeasureId: track.measures[3]!.id,
      }).ok,
    ).toBe(false);
    expect(
      applyScoreCommand(doc, { ...command, sourceEndMeasureId: "missing" }).ok,
    ).toBe(false);
    expect(
      applyScoreCommand(doc, {
        ...command,
        afterMeasureId: track.measures[0]!.id,
      }).ok,
    ).toBe(false);
    expect(
      applyScoreCommand(doc, {
        ...command,
        afterMeasureId: track.measures[1]!.id,
      }).ok,
    ).toBe(false);
    expect(
      applyScoreCommand(doc, {
        ...command,
        afterMeasureId: track.measures[2]!.id,
      }).ok,
    ).toBe(true);
  });
});

it("插入打断旧 Tie 时报告清理，闷音复制与长标记外框保持完整", () => {
  const doc = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
  const track = doc.score.tracks[0]!;
  track.techniques = [];
  const from = track.measures[0]!.beats.at(-1)!;
  const to = track.measures[1]!.beats[0]!;
  from.kind = "notes";
  from.notes = [{ id: "tie-from", string: 1, fret: 5 }];
  to.kind = "notes";
  to.notes = [{ id: "tie-to", string: 1, fret: 5 }];
  track.techniques = [
    { id: "old-tie", type: "tie", fromNoteId: "tie-from", toNoteId: "tie-to" },
  ];
  track.measures[2]!.beats[0]!.kind = "notes";
  track.measures[2]!.beats[0]!.notes = [
    { id: "mute-source", string: 2, fret: "x" },
  ];
  track.measures[2]!.sectionLabel = "中".repeat(32);
  expect(loadDocument(JSON.stringify(doc)).ok).toBe(true);
  const result = applyScoreCommand(doc, {
    type: LXMScoreCommandEnum.CopyMeasureRange,
    trackId: track.id,
    sourceStartMeasureId: track.measures[2]!.id,
    sourceEndMeasureId: track.measures[2]!.id,
    afterMeasureId: track.measures[0]!.id,
  });
  if (!result.ok) throw new Error(result.message);
  expect(
    result.effects?.some(
      (e) => e.kind === "technique.removed" && e.techniqueId === "old-tie",
    ),
  ).toBe(true);
  expect(
    result.document.score.tracks[0]!.measures[1]!.beats[0]!.notes[0]!.fret,
  ).toBe("x");
  const layout = buildLayout(result.document, { systemWidth: 180 });
  const unmarked = structuredClone(result.document);
  unmarked.score.tracks[0]!.measures.forEach((m) => {
    delete m.sectionLabel;
  });
  expect(layout).toEqual(buildLayout(unmarked, { systemWidth: 180 }));
});

it("插入到已有区间造成副本技巧冲突时拒绝整次复制", () => {
  const doc = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
  const track = doc.score.tracks[0]!;
  track.measures.forEach((m) =>
    m.beats.forEach((b) => {
      b.kind = "notes";
    }),
  );
  track.techniques = [
    {
      id: "target-range",
      type: "palmMute",
      fromBeatId: track.measures[0]!.beats[0]!.id,
      toBeatId: track.measures[1]!.beats.at(-1)!.id,
    },
    {
      id: "source-range",
      type: "letRing",
      fromBeatId: track.measures[2]!.beats[0]!.id,
      toBeatId: track.measures[2]!.beats.at(-1)!.id,
    },
  ];
  const before = structuredClone(doc);
  const result = applyScoreCommand(doc, {
    type: LXMScoreCommandEnum.CopyMeasureRange,
    trackId: track.id,
    sourceStartMeasureId: track.measures[2]!.id,
    sourceEndMeasureId: track.measures[2]!.id,
    afterMeasureId: track.measures[0]!.id,
  });
  expect(result.ok).toBe(false);
  expect(doc).toEqual(before);
});
