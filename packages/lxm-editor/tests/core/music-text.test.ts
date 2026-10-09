import { describe, expect, it } from "vitest";
import {
  applyScoreCommand,
  LXMScoreCommandEnum as C,
  type ILXMScoreCommand,
  type ILXMDocument,
  CHORD_PRESETS,
  copyChordPreset,
  normalizeMusicText,
  validateChordDiagram,
  loadDocument,
  EXAMPLE_MVP_6_DOCUMENT,
} from "../../src";
import source from "../../example/example-mvp2.json";
const fresh = () => structuredClone(source);
const target = {
  trackId: source.score.tracks[0]!.id,
  measureId: source.score.tracks[0]!.measures[0]!.id,
  beatId: source.score.tracks[0]!.measures[0]!.beats[0]!.id,
};
/** 使用真实命令和正式 loader 校验，失败时立即暴露领域错误。 */
const run = (document: ILXMDocument, command: ILXMScoreCommand) => {
  const result = applyScoreCommand(document, command);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result.document;
};
describe("MVP6 音乐文本领域", () => {
  it("真实混合谱例和全部人工预设均合法", () => {
    const loaded = loadDocument(JSON.stringify(EXAMPLE_MVP_6_DOCUMENT));
    expect(loaded.ok, JSON.stringify(loaded)).toBe(true);
    expect(CHORD_PRESETS.length).toBeGreaterThanOrEqual(14);
    CHORD_PRESETS.forEach((p) =>
      expect(validateChordDiagram(p.diagram), p.name).toBeNull(),
    );
  });
  it.each([
    "",
    " \t",
    "a\nb",
    "a\rb",
    "a\u2028b",
    "a\u2029b",
    "a\u0000b",
    "x".repeat(65),
  ])("拒绝无效歌词 %j", (text) => {
    const d = fresh();
    const before = JSON.stringify(d);
    expect(
      applyScoreCommand(d, { type: C.SetLyric, ...target, verse: 1, text }).ok,
    ).toBe(false);
    expect(JSON.stringify(d)).toBe(before);
  });
  it("NFC 和首尾空格标准化，内部空格保留，按码点计数", () => {
    expect(normalizeMusicText("  e\u0301  a  ", 64)).toBe("é  a");
    expect(normalizeMusicText("😀".repeat(64), 64)).toHaveLength(128);
  });
  it("同拍四段排序、更新保持 ID、标准化 no-op 不产生 revision", () => {
    let d = fresh();
    for (const verse of [4, 2, 3, 1] as const)
      d = run(d, { type: C.SetLyric, ...target, verse, text: `段${verse}` });
    const measure = d.score.tracks[0]!.measures[0]!;
    expect(measure.lyrics.map((l) => l.verse)).toEqual([1, 2, 3, 4]);
    const id = measure.lyrics[0]!.id;
    d = run(d, { type: C.SetLyric, ...target, verse: 1, text: "新词" });
    expect(d.score.tracks[0]!.measures[0]!.lyrics[0]!.id).toBe(id);
    const noOp = applyScoreCommand(d, {
      type: C.SetLyric,
      ...target,
      verse: 1,
      text: " 新词 ",
    });
    expect(noOp).toEqual({ ok: true, changed: false, document: d });
  });
  it("歌词删除、越界段号与跨小节 Beat 不允许静默成功", () => {
    const d = run(fresh(), {
      type: C.SetLyric,
      ...target,
      verse: 1,
      text: "词",
    });
    const id = d.score.tracks[0]!.measures[0]!.lyrics[0]!.id;
    expect(
      run(d, { type: C.RemoveLyric, ...target, lyricId: id }).score.tracks[0]!
        .measures[0]!.lyrics,
    ).toEqual([]);
    expect(
      applyScoreCommand(d, {
        type: C.RemoveLyric,
        ...target,
        lyricId: "absent",
      }).ok,
    ).toBe(false);
    expect(
      applyScoreCommand(d, {
        type: C.SetLyric,
        ...target,
        verse: 5 as 1,
        text: "词",
      }).ok,
    ).toBe(false);
    expect(
      applyScoreCommand(d, {
        type: C.SetLyric,
        ...target,
        beatId: d.score.tracks[0]!.measures[1]!.beats[0]!.id,
        verse: 1,
        text: "词",
      }).ok,
    ).toBe(false);
  });
  it("和弦全字段原子保存、纯名称可保留指法、深复制草稿", () => {
    const chord = copyChordPreset("F")!;
    let d = run(fresh(), {
      type: C.SetChordSymbol,
      ...target,
      display: "nameAndDiagram",
      chord,
    });
    const saved = d.score.tracks[0]!.measures[0]!.chordSymbols[0]!;
    chord.diagram.strings[0]!.fret = 24;
    expect(saved.chord.diagram!.strings[0]!.fret).toBe(1);
    d = run(d, {
      type: C.SetChordSymbol,
      ...target,
      display: "name",
      chord: saved.chord,
    });
    expect(
      d.score.tracks[0]!.measures[0]!.chordSymbols[0]!.chord.diagram,
    ).toEqual(saved.chord.diagram);
    expect(
      applyScoreCommand(d, {
        type: C.SetChordSymbol,
        ...target,
        display: "nameAndDiagram",
        chord: { name: "C", diagram: null },
      }).ok,
    ).toBe(false);
  });
  it("复制小节重建文本 ID 与 Beat 引用，并深复制横按", () => {
    let d = run(fresh(), { type: C.SetLyric, ...target, verse: 1, text: "词" });
    d = run(d, {
      type: C.SetChordSymbol,
      ...target,
      display: "nameAndDiagram",
      chord: copyChordPreset("F")!,
    });
    const copied = run(d, {
      type: C.CopyMeasure,
      trackId: target.trackId,
      measureId: target.measureId,
    });
    const [a, b] = copied.score.tracks[0]!.measures;
    expect(b!.lyrics[0]!.id).not.toBe(a!.lyrics[0]!.id);
    expect(b!.lyrics[0]!.beatId).toBe(b!.beats[0]!.id);
    expect(b!.chordSymbols[0]!.beatId).toBe(b!.beats[0]!.id);
    expect(b!.chordSymbols[0]!.chord.diagram!.barres).not.toBe(
      a!.chordSymbols[0]!.chord.diagram!.barres,
    );
    expect(loadDocument(JSON.stringify(copied)).ok).toBe(true);
  });
  it("schema3 roundtrip；schema2 无隐式升级", () => {
    const d = run(fresh(), {
      type: C.SetLyric,
      ...target,
      verse: 1,
      text: "😀 歌词",
    });
    expect(loadDocument(JSON.stringify(d)).ok).toBe(true);
    expect(loadDocument(JSON.stringify({ ...d, schemaVersion: 2 })).ok).toBe(
      false,
    );
    const invalid = structuredClone(d);
    invalid.score.tracks[0]!.measures[0]!.lyrics[0]!.beatId = "absent";
    expect(loadDocument(JSON.stringify(invalid)).ok).toBe(false);
  });
  it("文本随节奏重排保留稳定 Beat，不使用旧 tick", () => {
    const d = run(fresh(), {
      type: C.SetLyric,
      ...target,
      verse: 1,
      text: "词",
    });
    const changed = run(d, {
      type: C.SetBeatRhythm,
      ...target,
      rhythm: { base: "eighth", dots: 0 },
    });
    expect(changed.score.tracks[0]!.measures[0]!.lyrics[0]!.beatId).toBe(
      target.beatId,
    );
  });
  it("文本覆盖的尾部休止不能被扩容节奏吞掉", () => {
    const d = fresh();
    const m = d.score.tracks[0]!.measures[0]!;
    m.chordSymbols = [];
    m.beats.forEach((b) => {
      b.kind = "rest";
      b.notes = [];
    });
    m.lyrics = [
      { id: "protected", beatId: m.beats.at(-1)!.id, verse: 1, text: "保留" },
    ];
    expect(
      applyScoreCommand(d, {
        type: C.SetBeatRhythm,
        ...target,
        rhythm: { base: "whole", dots: 0 },
      }).ok,
    ).toBe(false);
    expect(m.lyrics[0]!.text).toBe("保留");
  });
  it.each([
    "allMuted",
    "wrongOrder",
    "outOfWindow",
    "openFinger",
    "duplicateFinger",
    "barreConflict",
  ])("拒绝无效指法 %s", (kind) => {
    const diagram = structuredClone(copyChordPreset("C")!.diagram);
    if (kind === "allMuted")
      diagram.strings.forEach((s) => {
        s.fret = "x";
        s.finger = null;
      });
    if (kind === "wrongOrder") diagram.strings.reverse();
    if (kind === "outOfWindow") diagram.startFret = 5;
    if (kind === "openFinger") diagram.strings[0]!.finger = 1;
    if (kind === "duplicateFinger") diagram.strings[1]!.finger = 3;
    if (kind === "barreConflict")
      diagram.barres = [{ fret: 1, minString: 1, maxString: 6, finger: 1 }];
    expect(validateChordDiagram(diagram)).not.toBeNull();
  });
});
