import { asLegacyFixture } from "../helpers/legacy";
import { describe, it, expect } from "vitest";
import {
  applyScoreCommand,
  LXMScoreCommandEnum as C,
  type ILXMScoreCommand,
} from "../../src/core/commands";
import { parseNumberedSequence } from "../../src/core/numbered-notation";
import {
  createBeatClipboard,
  planBeatPaste,
  validateBeatClipboard,
} from "../../src/core/beat-clipboard";
import { loadDocument, upgradeDocumentToCurrent } from "../../src/core/loader";
import {
  buildLayout,
  layoutParagraphFocus,
  hitTestNumbered,
} from "../../src/layout";
import EXAMPLE from "../../example/example-mvp6.json";
import TECHNIQUES from "../../example/example-technique-rhythm";
import type { ILXMDocument } from "../../src/core/types";
/** 使用容量闭合且 ID 独立的两小节测试谱，验证失败的原子性与不可变性。 */
const fixture = (notes = false) => {
  const d = structuredClone(EXAMPLE),
    t = d.score.tracks[0]!;
  t.techniques = [];
  t.measures = Array.from({ length: 2 }, (_, mi) => ({
    id: `m${mi}`,
    timeSignature: { numerator: 4, denominator: 4 },
    barline: "single" as const,
    lyrics: [],
    chordSymbols: [],
    numberedVoice: { events: [], tuplets: [] },
    tuplets: [],
    beats: Array.from({ length: 4 }, (_, bi) => ({
      id: `b${mi}-${bi}`,
      tick: bi * 960,
      rhythm: { base: "quarter" as const, dots: 0 },
      kind:
        notes && mi === 0 && bi === 0 ? ("notes" as const) : ("rest" as const),
      notes:
        notes && mi === 0 && bi === 0
          ? [
              { id: "n1", string: 1, fret: 5 },
              { id: "n2", string: 2, fret: 7 },
            ]
          : [],
    })),
  }));
  return d;
};
const target = {
  trackId: EXAMPLE.score.tracks[0]!.id,
  measureId: "m0",
  beatId: "b0-0",
};
const execute = (d: ILXMDocument, c: ILXMScoreCommand) => {
  const r = applyScoreCommand(d, c);
  if (!r.ok) throw new Error(r.message);
  return r;
};
const clip = (d: ILXMDocument, end = "b0-0") => {
  const r = createBeatClipboard(d, {
    ...target,
    startBeatId: "b0-0",
    endBeatId: end,
  });
  if (!r.ok) throw new Error(r.message);
  return r.clipboard;
};
const paste = (
  d: ILXMDocument,
  beatId = "b0-1",
  mode: "insert" | "overwrite" = "insert",
  c = clip(d),
  allow = true,
) => {
  const p = planBeatPaste(d, { ...target, beatId, mode }, c);
  if (!p.ok) throw new Error(p.message);
  return applyScoreCommand(d, {
    type: C.PasteBeats,
    ...target,
    beatId,
    mode,
    clipboard: c,
    allowOverwrite: allow,
    expectedConfirmationKey: p.confirmationKey,
  });
};
describe("MVP7.1-C 原子结构与记谱", () => {
  it.each(["1 2 3 _ 5", "#4 5' 6..", "1+3+5 2+4+6", "0 -", " 1　　2 "])(
    "统一解析合法简谱 %s",
    (raw) => expect(parseNumberedSequence(raw).ok).toBe(true),
  );
  it.each([
    "",
    "_ _",
    "1++3",
    "1+0",
    "8",
    "1/2",
    "1'.",
    "1\n2",
    "1\t2",
    "1 + 3",
    "1....",
  ])("拒绝非法简谱 %s", (raw) =>
    expect(parseNumberedSequence(raw).ok).toBe(false),
  );
  it("独立范围批次 no-op、覆盖确认和超尾拒绝", () => {
    const d = fixture();
    const command = {
      type: "numbered.range.replace" as const,
      trackId: target.trackId,
      measureId: "m0",
      startTick: 0,
      endTick: 2880,
      items: [
        { kind: "set" as const, tokens: ["1"] },
        { kind: "skip" as const },
        { kind: "set" as const, tokens: ["5"] },
      ],
      rhythms: Array.from({ length: 3 }, () => ({
        base: "quarter" as const,
        dots: 0,
      })),
      allowOverwrite: false,
    };
    const r = execute(d, command);
    expect(d.score.tracks[0]!.measures[0]!.numberedVoice.events).toEqual([]);
    expect(
      r.document.score.tracks[0]!.measures[0]!.numberedVoice.events.map(
        (e) => e.tick,
      ),
    ).toEqual([0, 1920]);
    expect(execute(r.document, command).document).toBe(r.document);
    expect(
      applyScoreCommand(r.document, {
        ...command,
        items: [
          { kind: "set", tokens: ["2"] },
          { kind: "skip" },
          { kind: "set", tokens: ["5"] },
        ],
      }),
    ).toMatchObject({ ok: false });
    expect(
      applyScoreCommand(d, { ...command, startTick: 2880, endTick: 5760 }),
    ).toMatchObject({ ok: false });
    expect(
      applyScoreCommand(d, { type: C.SetNumbered, ...target, tokens: ["1"] }),
    ).toMatchObject({ ok: false, code: "NUMBERED_INVALID" });
  });
  it("独立简谱阻止公共容量越界，但不阻塞 TAB 时值重建", () => {
    const d = execute(fixture(), {
      type: "numbered.range.replace",
      trackId: target.trackId,
      measureId: "m0",
      startTick: 2880,
      endTick: 3840,
      items: [{ kind: "set", tokens: ["5"] }],
      rhythms: [{ base: "quarter", dots: 0 }],
      allowOverwrite: false,
    }).document;
    expect(
      applyScoreCommand(d, {
        type: C.SetTimeSignature,
        trackId: target.trackId,
        measureId: "m0",
        timeSignature: { numerator: 3, denominator: 4 },
        scope: "measure",
      }),
    ).toMatchObject({ ok: false });
    expect(
      applyScoreCommand(d, {
        type: C.SetBeatRhythm,
        ...target,
        rhythm: { base: "whole", dots: 0 },
      }),
    ).toMatchObject({ ok: true });
  });
  it("和弦逐弦拆分 Tie 后可无损合并，首拍文本/简谱保留，无压缩误报", () => {
    const d = fixture(true),
      m = d.score.tracks[0]!.measures[0]!;
    m.numberedVoice.events = [
      {
        id: "numbered-first",
        tick: 0,
        rhythm: { base: "quarter", dots: 0 },
        kind: "notes",
        items: [
          { id: "num-item-1", token: "1" },
          { id: "num-item-3", token: "3" },
        ],
      },
    ];
    m.lyrics = [{ id: "ly", eventId: "numbered-first", verse: 1, text: "词" }];
    const before = structuredClone(d),
      r = execute(d, { type: C.SplitBeat, ...target });
    expect(r.nextFocus?.beatId).toBe("b0-0");
    expect(r.effects?.some((e) => e.kind === "beat.compressed")).toBe(false);
    const t = r.document.score.tracks[0]!,
      beats = t.measures[0]!.beats;
    expect(t.techniques.filter((t) => t.type === "tie")).toHaveLength(2);
    expect(t.measures[0]!.numberedVoice).toEqual(m.numberedVoice);
    expect(beats[2]!.tick).toBe(960);
    const merged = execute(r.document, {
      type: C.MergeBeats,
      ...target,
      startBeatId: beats[0]!.id,
      endBeatId: beats[1]!.id,
    });
    expect(merged.document.score.tracks[0]!.measures[0]).toEqual(m);
    expect(
      merged.effects?.filter((e) => e.kind === "technique.removed"),
    ).toHaveLength(0);
    expect(d).toEqual(before);
  });
  it("拒绝未 Tie 起音、x、连音、后续和弦及部分时长技巧", () => {
    const d = fixture(true),
      m = d.score.tracks[0]!.measures[0]!;
    m.beats[1] = {
      ...m.beats[1]!,
      kind: "notes",
      notes: [
        { id: "n3", string: 1, fret: 5 },
        { id: "n4", string: 2, fret: 7 },
      ],
    };
    expect(
      applyScoreCommand(d, {
        type: C.MergeBeats,
        ...target,
        startBeatId: "b0-0",
        endBeatId: "b0-1",
      }),
    ).toMatchObject({ ok: false });
    m.beats[0]!.notes[0]!.fret = "x";
    expect(
      applyScoreCommand(d, { type: C.SplitBeat, ...target }),
    ).toMatchObject({ ok: false });
    const split = execute(fixture(true), {
        type: C.SplitBeat,
        ...target,
      }).document,
      sm = split.score.tracks[0]!.measures[0]!;
    sm.chordSymbols.push({
      id: "c2",
      beatId: sm.beats[1]!.id,
      display: "name",
      chord: { name: "C", diagram: null },
    });
    expect(
      applyScoreCommand(split, {
        type: C.MergeBeats,
        ...target,
        startBeatId: "b0-0",
        endBeatId: sm.beats[1]!.id,
      }),
    ).toMatchObject({ ok: false });
    sm.chordSymbols = [];
    split.score.tracks[0]!.techniques.push({
      id: "pm",
      type: "palmMute",
      fromBeatId: "b0-0",
      toBeatId: "b0-0",
    });
    expect(
      applyScoreCommand(split, {
        type: C.MergeBeats,
        ...target,
        startBeatId: "b0-0",
        endBeatId: sm.beats[1]!.id,
      }),
    ).toMatchObject({ ok: false });
  });
  it("插入只消费尾部休止，复制快照与源独立，重复粘贴 ID 唯一", () => {
    const d = fixture(true),
      c = clip(d);
    const before = structuredClone(c);
    d.score.tracks[0]!.measures[0]!.beats[0]!.notes[0]!.fret = 9;
    expect(c).toEqual(before);
    const r = paste(d, "b0-1", "insert", c);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.nextFocus?.beatId).not.toBe("b0-1");
    const r2 = paste(r.document, "b0-1", "insert", c);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(loadDocument(JSON.stringify(r2.document)).ok).toBe(true);
    expect(
      planBeatPaste(
        fixture(),
        { ...target, beatId: "b0-3", mode: "insert" },
        c,
      ),
    ).toMatchObject({ ok: false });
  });
  it("覆盖必须确认且绑定实际读取内容，即使 revision 相同也拒绝旧确认", () => {
    const d = fixture(true),
      c = clip(d),
      p = planBeatPaste(d, { ...target, mode: "overwrite" }, c);
    if (!p.ok) throw Error(p.message);
    expect(p.requiresConfirmation).toBe(true);
    const cmd = {
      type: C.PasteBeats as const,
      ...target,
      mode: "overwrite" as const,
      clipboard: c,
      expectedConfirmationKey: p.confirmationKey,
      allowOverwrite: false,
    };
    expect(applyScoreCommand(d, cmd)).toMatchObject({ ok: false });
    const changed = structuredClone(d);
    changed.score.tracks[0]!.measures[0]!.beats[0]!.notes[0]!.fret = 12;
    expect(
      applyScoreCommand(changed, { ...cmd, allowOverwrite: true }),
    ).toMatchObject({ ok: false });
    expect(
      applyScoreCommand(d, { ...cmd, allowOverwrite: true }),
    ).toMatchObject({ ok: true });
  });
  it("坏快照的引用、ID、token、时长拒绝；截断目标拍边界拒绝", () => {
    const d = fixture(true),
      c = clip(d),
      track = d.score.tracks[0]!;
    for (const change of [
      (x: typeof c) => x.totalTicks++,
      (x: typeof c) =>
        x.content.beats[0]!.notes.push(x.content.beats[0]!.notes[0]!),
      (x: typeof c) =>
        x.content.lyrics.push({
          id: "bad",
          eventId: "missing",
          verse: 1,
          text: "x",
        }),
      (x: typeof c) =>
        x.numberedVoice!.events.push({
          id: "bad-event",
          tick: 0,
          rhythm: { base: "quarter", dots: 0 },
          kind: "notes",
          items: [{ id: "bad-item", token: "8" }],
        }),
    ]) {
      const bad = structuredClone(c);
      change(bad);
      expect(validateBeatClipboard(bad, track)).toMatchObject({ ok: false });
    }
    const split = execute(d, { type: C.SplitBeat, ...target }).document;
    expect(
      planBeatPaste(d, { ...target, mode: "overwrite" }, clip(split)),
    ).toMatchObject({ ok: false });
  });
  it("schema 6 升级保留曲首信息，旧格式不接受半音/简谱，新半音可复制显示", () => {
    const d = fixture(true);
    d.score.arranger = "作者";
    d.score.keySignature = "D";
    const old = { ...structuredClone(d), schemaVersion: 6 };
    const upgraded = upgradeDocumentToCurrent(asLegacyFixture(old));
    expect(upgraded).toMatchObject({
      ok: true,
      document: {
        schemaVersion: 8,
        score: { arranger: "作者", keySignature: "D" },
      },
    });
    Object.assign(old.score.tracks[0]!.measures[0]!.beats[0]!, {
      numberedNotation: { tokens: ["1"] },
    });
    expect(upgradeDocumentToCurrent(asLegacyFixture(old))).toMatchObject({
      ok: false,
    });
    const bend = execute(d, {
      type: C.AddTechnique,
      trackId: target.trackId,
      technique: { type: "bend", fromNoteId: "n1", semitones: 1 },
    }).document;
    expect(
      buildLayout(bend)
        .systems.flatMap((s) => s.techniques)
        .flatMap((t) => t.texts)
        .some((t) => t.text === "1/2"),
    ).toBe(true);
    expect(clip(bend).techniques[0]).toMatchObject({
      type: "bend",
      semitones: 1,
    });
  });
  it("每个技巧谱小节快照可独立校验并覆盖，包含完整連音和边界遗漏", () => {
    for (const m of TECHNIQUES.score.tracks[0]!.measures) {
      const range = {
        trackId: TECHNIQUES.score.tracks[0]!.id,
        measureId: m.id,
        startBeatId: m.beats[0]!.id,
        endBeatId: m.beats.at(-1)!.id,
      };
      const c = createBeatClipboard(TECHNIQUES, range);
      if (!c.ok) throw Error(c.message);
      const target = {
        trackId: range.trackId,
        measureId: m.id,
        beatId: m.beats[0]!.id,
        mode: "overwrite" as const,
      };
      const p = planBeatPaste(TECHNIQUES, target, c.clipboard);
      if (!p.ok) throw Error(p.message);
      expect(
        applyScoreCommand(TECHNIQUES, {
          type: C.PasteBeats,
          ...target,
          clipboard: c.clipboard,
          allowOverwrite: true,
          expectedConfirmationKey: p.confirmationKey,
        }).ok,
      ).toBe(true);
    }
  });
  it("简谱实际点位、多音列宽、命中、空内容高亮与左侧线最终布局一致", () => {
    const d = fixture(true),
      before = buildLayout(d, { systemWidth: 420 });
    const empty = layoutParagraphFocus(before, { ...target, kind: "numbered" });
    expect(empty).not.toBeNull();
    expect(buildLayout(d, { systemWidth: 420 })).toEqual(before);
    const r = execute(d, {
      type: "numbered.range.replace",
      trackId: target.trackId,
      measureId: target.measureId,
      startTick: 0,
      endTick: 960,
      items: [{ kind: "set", tokens: ["#4'", "6..", "3"] }],
      rhythms: [{ base: "quarter", dots: 0 }],
      allowOverwrite: false,
    });
    const layout = buildLayout(r.document, { systemWidth: 420 }),
      m = layout.systems[0]!.measures[0]!,
      n = m.numberedNotation![0]!;
    expect(n.dots).toHaveLength(3);
    expect(
      hitTestNumbered(layout, {
        x: n.bounds.x + n.bounds.width / 2,
        y: n.bounds.y + n.bounds.height / 2,
      }),
    ).toMatchObject({ kind: "numberedEvent", eventId: n.eventId });
    for (const s of layout.systems) {
      const edge = s.leftEdge![0]!;
      expect(edge.x1).toBeCloseTo(s.x + 0.5);
      expect(edge.y1).toBeGreaterThanOrEqual(s.measures[0]!.strings[0]!.y1);
      // 此测试谱没有歌词与横梁，左侧线仍停在末弦，不因下方简谱延伸到行底。
      expect(edge.y2).toBeCloseTo(s.measures[0]!.strings.at(-1)!.y1);
      expect(edge.y2).toBeLessThan(s.y + s.height);
    }
    expect(layout.height).toBeGreaterThan(before.height);
  });
});
