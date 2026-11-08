import { describe, expect, it } from "vitest";
import {
  applyScoreCommand,
  createDocumentIdFactory,
  loadDocument,
  LXMScoreCommandEnum,
  planLyricPositions,
  planNumberedInputRanges,
  planNumberedTabAlignment,
  type ILXMNumberedEvent,
  type ILXMScoreCommand,
} from "../../src";
import { applyRhythmSync, rhythmSyncFixture } from "../helpers/rhythm-sync";

describe("按 TAB 边界细分简谱", () => {
  it.each(["notes", "gap"] as const)(
    "A：%s 首段保留身份、全部音和四段词，尾段为空，预览确定且不写入",
    (kind) => {
      const { document, track, measure, align } = rhythmSyncFixture();
      const original = measure.numberedVoice.events[0]!;
      if (kind === "gap")
        measure.numberedVoice.events[0] = { ...original, kind, items: [] };
      else if (original.kind === "notes")
        original.items.push({ id: "second-pitch", token: "5" });
      const before = structuredClone(document);
      const first = applyRhythmSync(document, align);
      const second = applyRhythmSync(document, align);
      expect(second).toEqual(first);
      expect(document).toEqual(before);
      const saved = first.document.score.tracks[0]!.measures[0]!;
      const [head, gap, ...tail] = saved.numberedVoice.events;
      expect(head).toEqual({
        ...measure.numberedVoice.events[0],
        rhythm: { base: "eighth", dots: 0 },
      });
      expect(head!.items).toBe(measure.numberedVoice.events[0]!.items);
      expect(gap).toEqual({
        id: expect.any(String),
        tick: 480,
        kind: "gap",
        rhythm: { base: "eighth", dots: 0 },
        items: [],
      });
      expect(tail).toEqual(measure.numberedVoice.events.slice(1));
      expect(saved.lyrics).toBe(measure.lyrics);
      expect(saved.beats).toBe(measure.beats);
      expect(first.document.documentRevision).toBe(
        document.documentRevision + 1,
      );
      expect(first.nextNumberedFocus).toEqual({
        trackId: track.id,
        measureId: measure.id,
        eventId: gap!.id,
      });
      expect(first.effects).toContainEqual(
        expect.objectContaining({
          kind: "numbered.event.resized",
          eventId: "event-0",
          beforeValue: 960,
          afterValue: 480,
        }),
      );
      expect(
        planLyricPositions(saved).find((p) => p.tick === 480),
      ).toMatchObject({ eventId: gap!.id, endTick: 960 });
      const loaded = loadDocument(JSON.stringify(first.document));
      expect(loaded.ok).toBe(true);
      if (loaded.ok) expect(loaded.document).toEqual(first.document);
      const noop = applyRhythmSync(first.document, align);
      expect(noop.changed).toBe(false);
      expect(noop.document).toBe(first.document);
      expect(noop.nextNumberedFocus).toBeUndefined();
    },
  );

  it("B：仅细分首个八分，第二个八分和原边界保留；按 gap 身份先词后音及先音后词均继承十六分", () => {
    for (const lyricFirst of [true, false]) {
      const { document, measure, target, align } = rhythmSyncFixture("B");
      const result = applyRhythmSync(document, align);
      const saved = result.document.score.tracks[0]!.measures[0]!;
      expect(
        saved.numberedVoice.events
          .slice(0, 3)
          .map((e) => [e.tick, e.rhythm.base, e.kind]),
      ).toEqual([
        [0, "sixteenth", "notes"],
        [240, "sixteenth", "gap"],
        [480, "eighth", "notes"],
      ]);
      expect(saved.numberedVoice.events[2]).toBe(
        measure.numberedVoice.events[1],
      );
      const eventId = saved.numberedVoice.events[1]!.id;
      const lyric: ILXMScoreCommand = {
        ...target,
        type: LXMScoreCommandEnum.SetLyric,
        eventId,
        verse: 4,
        text: "新",
      };
      const note = {
        ...target,
        type: "numbered.event.set" as const,
        eventId,
        tokens: ["6"],
      };
      const middle = applyRhythmSync(
        result.document,
        lyricFirst ? lyric : note,
      );
      const final = applyRhythmSync(middle.document, lyricFirst ? note : lyric);
      const filled = final.document.score.tracks[0]!.measures[0]!;
      expect(filled.numberedVoice.events[1]).toMatchObject({
        id: eventId,
        tick: 240,
        rhythm: { base: "sixteenth", dots: 0 },
        items: [{ token: "6" }],
      });
      expect(filled.lyrics).toContainEqual(
        expect.objectContaining({ eventId, verse: 4, text: "新" }),
      );
      expect(filled.lyrics.filter((l) => l.eventId === "event-0")).toEqual(
        measure.lyrics,
      );
      expect(loadDocument(JSON.stringify(final.document)).ok).toBe(true);
    }
  });

  it("附点按真实时长分段并保留不在 TAB 上的原边界；最早 gap 为焦点", () => {
    const { document, measure, align } = rhythmSyncFixture("B");
    measure.numberedVoice.events[0]!.rhythm = { base: "eighth", dots: 1 };
    measure.numberedVoice.events[1]!.tick = 720;
    measure.numberedVoice.events[1]!.rhythm = { base: "sixteenth", dots: 0 };
    const result = applyRhythmSync(document, align);
    const events =
      result.document.score.tracks[0]!.measures[0]!.numberedVoice.events;
    expect(
      events.slice(0, 4).map((e) => [e.tick, e.rhythm.base, e.rhythm.dots]),
    ).toEqual([
      [0, "sixteenth", 0],
      [240, "sixteenth", 0],
      [480, "sixteenth", 0],
      [720, "sixteenth", 0],
    ]);
    expect(events[3]).toBe(measure.numberedVoice.events[1]);
    expect(result.nextNumberedFocus?.eventId).toBe(events[1]!.id);
  });

  it("多个完整事件逐一细分，真空窗不实化；连续补音保留混合时值和身份", () => {
    const { document, measure, target, align } = rhythmSyncFixture("B");
    const split = applyRhythmSync(document, align);
    const events =
      split.document.score.tracks[0]!.measures[0]!.numberedVoice.events;
    const filled = applyRhythmSync(split.document, {
      type: "numbered.sequence.set",
      ...target,
      eventId: events[0]!.id,
      items: ["1", "2", "3"].map((token) => ({ kind: "set", tokens: [token] })),
      allowOverwrite: true,
    });
    const saved = filled.document.score.tracks[0]!.measures[0]!;
    expect(
      saved.numberedVoice.events
        .slice(0, 3)
        .map((e) => [e.id, e.tick, e.rhythm.base, e.items[0]!.token]),
    ).toEqual([
      [events[0]!.id, 0, "sixteenth", "1"],
      [events[1]!.id, 240, "sixteenth", "2"],
      [events[2]!.id, 480, "eighth", "3"],
    ]);
    expect(saved.lyrics).toEqual(measure.lyrics);
    const multi = rhythmSyncFixture("A");
    multi.measure.beats.splice(
      2,
      1,
      { ...multi.measure.beats[2]!, rhythm: { base: "eighth", dots: 0 } },
      {
        ...multi.measure.beats[2]!,
        id: "tab-mid",
        tick: 1440,
        rhythm: { base: "eighth", dots: 0 },
        notes: [{ id: "tab-mid-note", string: 1, fret: 3 }],
      },
    );
    const aligned = applyRhythmSync(multi.document, {
      ...multi.align,
      endTick: 1920,
    });
    const alignedEvents =
      aligned.document.score.tracks[0]!.measures[0]!.numberedVoice.events;
    expect(
      alignedEvents.slice(0, 4).map((e) => [e.tick, e.kind, e.rhythm.base]),
    ).toEqual([
      [0, "notes", "eighth"],
      [480, "gap", "eighth"],
      [960, "notes", "eighth"],
      [1440, "gap", "eighth"],
    ]);
    expect(alignedEvents[2]!.id).toBe(
      multi.measure.numberedVoice.events[1]!.id,
    );
    expect(aligned.nextNumberedFocus?.eventId).toBe(alignedEvents[1]!.id);
  });

  it("真空窗只派生输入与歌词位置，不实化；纯 planner 返回原 track", () => {
    const { document, track, measure, align } = rhythmSyncFixture("B");
    measure.numberedVoice.events = [];
    measure.lyrics = [];
    const before = structuredClone(document);
    const plan = planNumberedTabAlignment(
      track,
      { measureId: measure.id, startTick: 0, endTick: 960 },
      createDocumentIdFactory(document),
    );
    expect(plan).toMatchObject({ ok: true, changed: false, track });
    if (plan.ok) expect(plan.track).toBe(track);
    const result = applyRhythmSync(document, align);
    expect(result.document).toBe(document);
    expect(
      planLyricPositions(measure)
        .slice(0, 3)
        .map((p) => [p.tick, p.endTick]),
    ).toEqual([
      [0, 240],
      [240, 480],
      [480, 960],
    ]);
    expect(
      planNumberedInputRanges(measure)
        .slice(0, 3)
        .map((p) => [p.startTick, p.endTick]),
    ).toEqual([
      [0, 240],
      [240, 480],
      [480, 960],
    ]);
    expect(document).toEqual(before);
  });

  it("范围含真空窗仅细分已有成员，全谱 ID 冲突时分配新身份", () => {
    const { document, measure, align } = rhythmSyncFixture("B");
    measure.numberedVoice.events.splice(1, 1);
    const collision = `numbered-event-${document.documentRevision + 1}-1`;
    measure.lyrics[0]!.id = collision;
    const saved = applyRhythmSync(document, align).document.score.tracks[0]!
      .measures[0]!;
    expect(
      saved.numberedVoice.events.filter((e) => e.tick < 960).map((e) => e.tick),
    ).toEqual([0, 240]);
    expect(saved.numberedVoice.events[1]!.id).not.toBe(collision);
  });

  it("没有内部新边界时保留已有 rest/continuation/附点写法", () => {
    for (const kind of ["rest", "continuation", "notes"] as const) {
      const { document, measure, align } = rhythmSyncFixture("combined");
      const event = measure.numberedVoice.events[0]!;
      event.kind = kind;
      event.items[0]!.token =
        kind === "rest" ? "0" : kind === "continuation" ? "-" : "3";
      expect(applyRhythmSync(document, align).document).toBe(document);
    }
  });

  it.each(["rest", "continuation"] as const)(
    "需要切分的 %s 拒绝且源对象不变",
    (kind) => {
      const { document, measure, align } = rhythmSyncFixture();
      measure.numberedVoice.events[0]!.kind = kind;
      measure.numberedVoice.events[0]!.items[0]!.token =
        kind === "rest" ? "0" : "-";
      const before = structuredClone(document);
      expect(applyScoreCommand(document, align)).toMatchObject({
        ok: false,
        code: "NUMBERED_INVALID",
      });
      expect(document).toEqual(before);
    },
  );

  it("部分交叠、非 TAB 边界、越界、非精确时值和过期均零写入", () => {
    const { document, measure, align } = rhythmSyncFixture("B");
    const before = structuredClone(document);
    for (const range of [
      { startTick: 0, endTick: 240 },
      { startTick: 240, endTick: 960 },
    ])
      expect(applyScoreCommand(document, { ...align, ...range })).toMatchObject(
        { ok: false, code: "NUMBERED_PARTIAL_RANGE" },
      );
    for (const range of [
      { startTick: 1, endTick: 960 },
      { startTick: 0, endTick: 4000 },
      { startTick: 0, endTick: 0 },
    ])
      expect(applyScoreCommand(document, { ...align, ...range }).ok).toBe(
        false,
      );
    expect(
      applyScoreCommand(document, {
        ...align,
        expectedRevision: document.documentRevision + 1,
      }),
    ).toMatchObject({ ok: false, code: "STALE_NUMBERED_PLAN" });
    expect(document).toEqual(before);
    measure.numberedVoice.events = [
      {
        ...measure.numberedVoice.events[0]!,
        tick: 30,
        rhythm: { base: "quarter", dots: 0 },
      },
    ];
    measure.lyrics = [];
    expect(
      applyScoreCommand(document, { ...align, endTick: 1920 }),
    ).toMatchObject({ ok: false, code: "NUMBERED_INVALID" });
  });

  it("受影响简谱连音与 TAB 连音阻止，不能把有效时长当作普通时值", () => {
    const { document, measure, align } = rhythmSyncFixture("B");
    measure.numberedVoice.events = [0, 320, 640].map(
      (tick, i): ILXMNumberedEvent => ({
        id: `triplet-event-${i}`,
        tick,
        rhythm: { base: "eighth", dots: 0 },
        kind: "notes",
        items: [{ id: `triplet-item-${i}`, token: "3" }],
      }),
    );
    measure.numberedVoice.tuplets = [
      {
        id: "numbered-tuplet",
        eventIds: measure.numberedVoice.events.map((e) => e.id),
        ratio: { actual: 3, normal: 2 },
      },
    ];
    measure.lyrics = [];
    expect(applyScoreCommand(document, align)).toMatchObject({
      ok: false,
      code: "NUMBERED_INVALID",
    });
    const tab = rhythmSyncFixture("combined");
    tab.measure.beats = [0, 320, 640, 960, 1920, 2880].map((tick, i) => ({
      id: `t${i}`,
      tick,
      kind: "rest",
      notes: [],
      rhythm: { base: i < 3 ? "eighth" : "quarter", dots: 0 },
    }));
    tab.measure.tuplets = [
      {
        id: "tab-tuplet",
        beatIds: ["t0", "t1", "t2"],
        ratio: { actual: 3, normal: 2 },
      },
    ];
    expect(applyScoreCommand(tab.document, tab.align)).toMatchObject({
      ok: false,
      code: "NUMBERED_INVALID",
    });
  });

  it.each(["tie", "slur"] as const)(
    "受影响 %s 即使提供确认也拒绝；安全 fermata 与无关关系保留",
    (type) => {
      const { document, track, align } = rhythmSyncFixture();
      track.numberedMarks = [
        type === "tie"
          ? { id: "relation", type, fromItemId: "item-0", toItemId: "item-1" }
          : {
              id: "relation",
              type,
              fromEventId: "event-0",
              toEventId: "event-2",
            },
      ];
      const before = structuredClone(document);
      expect(
        applyScoreCommand(document, {
          ...align,
          confirmedChangedMarkIds: ["relation"],
        }),
      ).toMatchObject({ ok: false, code: "NUMBERED_INVALID" });
      expect(document).toEqual(before);
      track.numberedMarks = [
        { id: "hold", type: "fermata", eventId: "event-0" },
        {
          id: "safe-slur",
          type: "slur",
          fromEventId: "event-1",
          toEventId: "event-2",
        },
      ];
      expect(
        applyRhythmSync(document, align).document.score.tracks[0]!
          .numberedMarks,
      ).toEqual(track.numberedMarks);
    },
  );

  it("slur 中间音被细分也阻止，避免只检查关系两端", () => {
    const { document, track, measure, target } = rhythmSyncFixture();
    measure.beats.splice(
      2,
      1,
      { ...measure.beats[2]!, rhythm: { base: "eighth", dots: 0 } },
      {
        ...measure.beats[2]!,
        id: "inner-tab",
        tick: 1440,
        rhythm: { base: "eighth", dots: 0 },
        notes: [{ id: "inner-note", string: 1, fret: 3 }],
      },
    );
    track.numberedMarks = [
      {
        id: "spanning",
        type: "slur",
        fromEventId: "event-0",
        toEventId: "event-2",
      },
    ];
    expect(
      applyScoreCommand(document, {
        type: "numbered.range.alignToTab",
        ...target,
        startTick: 960,
        endTick: 1920,
      }),
    ).toMatchObject({ ok: false, code: "NUMBERED_INVALID" });
  });

  it("候选文档最终语义失败时不提交已规划的细分", () => {
    const { document, measure, align } = rhythmSyncFixture();
    measure.lyrics.push({
      id: "invalid-lyric",
      eventId: "missing-event",
      verse: 1,
      text: "词",
    });
    const before = structuredClone(document);
    expect(applyScoreCommand(document, align)).toMatchObject({
      ok: false,
      code: "SEMANTIC_VALIDATION_FAILED",
    });
    expect(document).toEqual(before);
  });
});

describe("TAB 拆分并同步原子命令", () => {
  it("复用 TAB 持续音语义，只创建简谱空尾段；连续两次各增一个 revision", () => {
    const { document, track, measure, target, split } =
      rhythmSyncFixture("combined");
    track.techniques = [
      {
        id: "tab-external-tie",
        type: "tie",
        fromNoteId: "tab-note-0",
        toNoteId: "tab-note-1",
      },
    ];
    const original = structuredClone(document);
    const first = applyRhythmSync(document, {
      ...split,
      expectedRevision: document.documentRevision,
    });
    const next = first.document.score.tracks[0]!;
    const saved = next.measures[0]!;
    expect(first.document.documentRevision).toBe(document.documentRevision + 1);
    expect(
      saved.beats
        .slice(0, 2)
        .map((b) => [b.tick, b.rhythm.base, b.notes[0]!.fret]),
    ).toEqual([
      [0, "eighth", 3],
      [480, "eighth", 3],
    ]);
    expect(next.techniques).toContainEqual(
      expect.objectContaining({
        type: "tie",
        fromNoteId: measure.beats[0]!.notes[0]!.id,
        toNoteId: saved.beats[1]!.notes[0]!.id,
      }),
    );
    expect(next.numberedMarks).toEqual([]);
    expect(
      next.techniques.find((t) => t.id === "tab-external-tie"),
    ).toMatchObject({
      fromNoteId: saved.beats[1]!.notes[0]!.id,
      toNoteId: "tab-note-1",
    });
    expect(
      saved.numberedVoice.events
        .slice(0, 2)
        .map((e) => [e.tick, e.kind, e.rhythm.base]),
    ).toEqual([
      [0, "notes", "eighth"],
      [480, "gap", "eighth"],
    ]);
    expect(saved.lyrics).toBe(measure.lyrics);
    expect(first.effects).toContainEqual(
      expect.objectContaining({ kind: "beats.structured", operation: "split" }),
    );
    expect(first.effects!.some((e) => e.kind === "beat.compressed")).toBe(
      false,
    );
    const second = applyRhythmSync(first.document, {
      ...split,
      expectedRevision: first.document.documentRevision,
    });
    expect(second.document.documentRevision).toBe(
      document.documentRevision + 2,
    );
    const events =
      second.document.score.tracks[0]!.measures[0]!.numberedVoice.events;
    expect(
      events.slice(0, 3).map((e) => [e.tick, e.kind, e.rhythm.base]),
    ).toEqual([
      [0, "notes", "sixteenth"],
      [240, "gap", "sixteenth"],
      [480, "gap", "eighth"],
    ]);
    expect(second.nextNumberedFocus).toEqual({
      ...target,
      eventId: events[1]!.id,
    });
    expect(document).toEqual(original);
    expect(loadDocument(JSON.stringify(second.document)).ok).toBe(true);
    expect(next.id).toBe(track.id);
  });

  it.each(["empty", "finer"] as const)(
    "简谱 %s 没变化时 TAB 变更仍提交",
    (mode) => {
      const { document, measure, split } = rhythmSyncFixture("combined");
      measure.lyrics = [];
      measure.numberedVoice.events =
        mode === "empty"
          ? []
          : [0, 240, 480, 720].map((tick, i) => ({
              id: `fine-${i}`,
              tick,
              kind: "gap",
              items: [],
              rhythm: { base: "sixteenth", dots: 0 },
            }));
      const result = applyRhythmSync(document, split);
      expect(result.changed).toBe(true);
      expect(result.document.documentRevision).toBe(
        document.documentRevision + 1,
      );
      expect(result.document.score.tracks[0]!.measures[0]!.numberedVoice).toBe(
        measure.numberedVoice,
      );
      expect(result.nextNumberedFocus).toBeUndefined();
    },
  );

  it("TAB 已规划成功但简谱失败时零写入；端点切穿、关系、最短值与过期全部阻止", () => {
    const partial = rhythmSyncFixture("A");
    expect(applyScoreCommand(partial.document, partial.split)).toMatchObject({
      ok: false,
      code: "NUMBERED_PARTIAL_RANGE",
    });
    for (const failure of ["rest", "tie", "minimum", "stale"] as const) {
      const { document, track, measure, split } = rhythmSyncFixture("combined");
      if (failure === "rest") {
        measure.numberedVoice.events[0]!.kind = "rest";
        measure.numberedVoice.events[0]!.items[0]!.token = "0";
        measure.lyrics = [];
      }
      if (failure === "tie")
        track.numberedMarks = [
          { id: "tie", type: "tie", fromItemId: "item-0", toItemId: "item-1" },
        ];
      if (failure === "minimum") measure.beats[0]!.rhythm.base = "thirtySecond";
      const before = structuredClone(document);
      expect(
        applyScoreCommand(document, {
          ...split,
          ...(failure === "stale"
            ? { expectedRevision: document.documentRevision + 1 }
            : {}),
        }).ok,
      ).toBe(false);
      expect(document).toEqual(before);
    }
  });

  it("普通 TAB 拆分和时值修改继续独立，不修改持久化 gap、音符或歌词", () => {
    const { document, measure, target } = rhythmSyncFixture("combined");
    measure.numberedVoice.events[1] = {
      ...measure.numberedVoice.events[1]!,
      kind: "gap",
      items: [],
    };
    const commands: ILXMScoreCommand[] = [
      { type: LXMScoreCommandEnum.SplitBeat, ...target, beatId: "tab-0" },
      {
        type: LXMScoreCommandEnum.SetBeatRhythm,
        ...target,
        beatId: "tab-0",
        rhythm: { base: "eighth" as const, dots: 0 },
      },
    ];
    for (const command of commands) {
      const saved = applyRhythmSync(document, command).document.score.tracks[0]!
        .measures[0]!;
      expect(saved.numberedVoice).toBe(measure.numberedVoice);
      expect(saved.lyrics).toBe(measure.lyrics);
    }
  });
});
