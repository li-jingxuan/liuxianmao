import { describe, expect, it } from "vitest";

import EXAMPLE_MVP_2 from "../../example/example-mvp2.json";
import {
  applyScoreCommand,
  LXMScoreCommandEnum,
} from "../../src/core/commands/commands";
import { findNextNoteOnSameStringInTrack } from "../../src/core/techniques/technique-rules";
import { LXMDocumentSchema } from "../../src/core/document/schema";
import { validateDocumentSemantics } from "../../src/core/document/semantic-validation";
import type { ILXMTechniqueDraft } from "../../src/core/types";

const createDocument = () => structuredClone(EXAMPLE_MVP_2);
const trackId = "mvp2-track-guitar";

describe("MVP v5 技巧领域命令", () => {
  it("新增、等值 no-op、修改和删除技巧都保持原子历史语义", () => {
    const document = createDocument();
    const added = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.AddTechnique,
      trackId,
      technique: {
        type: "hammerOn",
        fromNoteId: "mvp2-note-1-5-6",
        toNoteId: "mvp2-note-1-6-6",
      },
    });
    expect(added).toMatchObject({ ok: true, changed: true });
    if (!added.ok) return;
    const technique = added.document.score.tracks[0]!.techniques[0]!;
    expect(technique).toMatchObject({ type: "hammerOn" });
    expect(added.document.documentRevision).toBe(document.documentRevision + 1);

    const noOp = applyScoreCommand(added.document, {
      type: LXMScoreCommandEnum.AddTechnique,
      trackId,
      technique: {
        type: "hammerOn",
        fromNoteId: "mvp2-note-1-5-6",
        toNoteId: "mvp2-note-1-6-6",
      },
    });
    expect(noOp).toEqual({
      ok: true,
      changed: false,
      document: added.document,
    });

    const updated = applyScoreCommand(added.document, {
      type: LXMScoreCommandEnum.UpdateTechnique,
      trackId,
      techniqueId: technique.id,
      technique: {
        type: "slideUp",
        fromNoteId: "mvp2-note-1-5-6",
        toNoteId: "mvp2-note-1-6-6",
      },
    });
    expect(updated).toMatchObject({ ok: true, changed: true });
    if (!updated.ok) return;
    expect(updated.document.score.tracks[0]!.techniques[0]).toMatchObject({
      id: technique.id,
      type: "slideUp",
    });

    const removed = applyScoreCommand(updated.document, {
      type: LXMScoreCommandEnum.RemoveTechnique,
      trackId,
      techniqueId: technique.id,
    });
    expect(removed).toMatchObject({ ok: true, changed: true });
    if (removed.ok)
      expect(removed.document.score.tracks[0]!.techniques).toEqual([]);
  });

  it("覆盖单音、整拍与区间技巧，并拒绝互斥或非法目标", () => {
    let document = createDocument();
    const drafts = [
      { type: "tapping", fromNoteId: "mvp2-note-1-1-6" } as const,
      {
        type: "trill",
        fromNoteId: "mvp2-note-1-3-5",
        auxiliaryFret: 7,
      } as const,
      {
        type: "strum",
        beatId: "mvp2-beat-1-2",
        minString: 2,
        maxString: 3,
        stroke: "down",
      } as const,
      {
        type: "pickStroke",
        beatId: "mvp2-beat-1-1",
        stroke: "up",
      } as const,
      {
        type: "palmMute",
        fromBeatId: "mvp2-beat-1-1",
        toBeatId: "mvp2-beat-1-4",
      } as const,
    ];
    drafts.forEach((technique) => {
      const result = applyScoreCommand(document, {
        type: LXMScoreCommandEnum.AddTechnique,
        trackId,
        technique,
      });
      expect(result).toMatchObject({ ok: true, changed: true });
      if (result.ok) document = result.document;
    });
    expect(document.score.tracks[0]!.techniques).toHaveLength(drafts.length);

    expect(
      applyScoreCommand(document, {
        type: LXMScoreCommandEnum.AddTechnique,
        trackId,
        technique: {
          type: "arpeggio",
          beatId: "mvp2-beat-1-2",
          minString: 2,
          maxString: 3,
          direction: "ascending",
        },
      }),
    ).toMatchObject({ ok: true, changed: true });

    expect(
      applyScoreCommand(document, {
        type: LXMScoreCommandEnum.AddTechnique,
        trackId,
        technique: {
          type: "pickStroke",
          beatId: "mvp2-beat-1-2",
          stroke: "down",
        },
      }),
    ).toMatchObject({ ok: false, code: "TECHNIQUE_TARGET_INVALID" });

    expect(
      applyScoreCommand(document, {
        type: LXMScoreCommandEnum.AddTechnique,
        trackId,
        technique: {
          type: "letRing",
          fromBeatId: "mvp2-beat-1-3",
          toBeatId: "mvp2-beat-1-5",
        },
      }),
    ).toMatchObject({ ok: false, code: "TECHNIQUE_CONFLICT" });
  });

  describe.each([
    LXMScoreCommandEnum.AddTechnique,
    LXMScoreCommandEnum.UpdateTechnique,
  ] as const)("%s 原子替换同拍扫弦/琶音", (commandType) => {
    it.each([
      {
        existing: { type: "strum", stroke: "down" } as const,
        replacement: { type: "strum", stroke: "up" } as const,
      },
      {
        existing: { type: "arpeggio", direction: "ascending" } as const,
        replacement: { type: "arpeggio", direction: "descending" } as const,
      },
      {
        existing: { type: "strum", stroke: "down" } as const,
        replacement: { type: "arpeggio", direction: "ascending" } as const,
      },
      {
        existing: { type: "arpeggio", direction: "descending" } as const,
        replacement: { type: "strum", stroke: "up" } as const,
      },
    ])(
      "$existing.type 替换为 $replacement.type 并保留 ID",
      ({ existing, replacement }) => {
        const document = createDocument();
        const added = applyScoreCommand(document, {
          type: LXMScoreCommandEnum.AddTechnique,
          trackId,
          technique: {
            ...existing,
            beatId: "mvp2-beat-1-2",
            minString: 2,
            maxString: 3,
          },
        });
        expect(added).toMatchObject({ ok: true, changed: true });
        if (!added.ok) return;

        const original = added.document.score.tracks[0]!.techniques[0]!;
        const draft = {
          ...replacement,
          beatId: "mvp2-beat-1-2",
          minString: 2,
          maxString: 3,
        };
        const replaced = applyScoreCommand(added.document, {
          type: commandType,
          trackId,
          techniqueId: original.id,
          technique: draft,
        });
        expect(replaced).toMatchObject({ ok: true, changed: true });
        if (!replaced.ok) return;
        expect(replaced.document.score.tracks[0]!.techniques).toEqual([
          { ...draft, id: original.id },
        ]);
        expect(replaced.document.documentRevision).toBe(
          added.document.documentRevision + 1,
        );
        expect(added.document.score.tracks[0]!.techniques).toEqual([original]);
        expect(LXMDocumentSchema.safeParse(replaced.document).success).toBe(
          true,
        );
        expect(validateDocumentSemantics(replaced.document)).toEqual({
          ok: true,
        });
      },
    );

    it.each([
      { type: "strum", stroke: "down" } as const,
      { type: "arpeggio", direction: "ascending" } as const,
    ])("重复 $type 保留文档引用、技巧对象和 revision", (params) => {
      const document = createDocument();
      const technique = {
        ...params,
        id: "tech-no-op",
        beatId: "mvp2-beat-1-2",
        minString: 2,
        maxString: 3,
      };
      document.score.tracks[0]!.techniques = [technique];
      const result = applyScoreCommand(document, {
        type: commandType,
        trackId,
        techniqueId: technique.id,
        technique: {
          maxString: 3,
          minString: 2,
          beatId: technique.beatId,
          ...params,
        },
      });
      expect(result).toMatchObject({ ok: true, changed: false });
      if (!result.ok) return;
      expect(result.document).toBe(document);
      expect(result.document.documentRevision).toBe(document.documentRevision);
      expect(result.document.score.tracks[0]!.techniques[0]).toBe(technique);
    });

    it.each([
      {
        draft: {
          type: "strum",
          beatId: "mvp2-beat-1-2",
          minString: 3,
          maxString: 3,
          stroke: "up",
        } as const,
        code: "TECHNIQUE_TARGET_INVALID",
      },
      {
        draft: {
          type: "strum",
          beatId: "mvp2-beat-1-2",
          minString: 2,
          maxString: 3,
          stroke: "sideways",
        } as unknown as ILXMTechniqueDraft,
        code: "DOCUMENT_INVALID",
      },
    ])("无效草稿 $code 不删除或修改原技巧", ({ draft, code }) => {
      const document = createDocument();
      const target = {
        id: "tech-target",
        type: "strum" as const,
        beatId: "mvp2-beat-1-2",
        minString: 2,
        maxString: 3,
        stroke: "down" as const,
      };
      const edited = {
        id: "tech-edited",
        type: "arpeggio" as const,
        beatId: "mvp2-beat-1-5",
        minString: 2,
        maxString: 6,
        direction: "ascending" as const,
      };
      const track = document.score.tracks[0]!;
      track.techniques = [target, edited];
      const originalTechniques = track.techniques;
      const snapshot = structuredClone(document);
      expect(
        applyScoreCommand(document, {
          type: commandType,
          trackId,
          techniqueId: edited.id,
          technique: draft,
        }),
      ).toMatchObject({ ok: false, code });
      expect(document).toEqual(snapshot);
      expect(track.techniques).toBe(originalTechniques);
      expect(track.techniques[0]).toBe(target);
      expect(track.techniques[1]).toBe(edited);
    });
  });

  it.each([
    { type: "strum", stroke: "up" } as const,
    { type: "arpeggio", direction: "descending" } as const,
  ])("更新为 $type 并移到已有技巧的 Beat 时保留被编辑 ID", (params) => {
    const document = createDocument();
    document.score.tracks[0]!.techniques = [
      {
        id: "tech-strum-a",
        type: "strum",
        beatId: "mvp2-beat-1-2",
        minString: 2,
        maxString: 3,
        stroke: "down",
      },
      {
        id: "tech-arpeggio-b",
        type: "arpeggio",
        beatId: "mvp2-beat-1-5",
        minString: 2,
        maxString: 6,
        direction: "ascending",
      },
    ];

    const untouched = {
      id: "tech-untouched",
      type: "tapping" as const,
      fromNoteId: "mvp2-note-1-1-6",
    };
    document.score.tracks[0]!.techniques.push(untouched);
    const snapshot = structuredClone(document);
    const draft = {
      ...params,
      beatId: "mvp2-beat-1-2",
      minString: 2,
      maxString: 3,
    };
    const result = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.UpdateTechnique,
      trackId,
      techniqueId: "tech-arpeggio-b",
      technique: draft,
    });
    expect(result).toMatchObject({ ok: true, changed: true });
    if (!result.ok) return;
    expect(result.document.score.tracks[0]!.techniques).toEqual([
      { ...draft, id: "tech-arpeggio-b" },
      untouched,
    ]);
    expect(result.document.score.tracks[0]!.techniques[1]).toBe(untouched);
    expect(result.document.documentRevision).toBe(
      document.documentRevision + 1,
    );
    expect(document).toEqual(snapshot);
    expect(LXMDocumentSchema.safeParse(result.document).success).toBe(true);
    expect(validateDocumentSemantics(result.document)).toEqual({ ok: true });
  });

  it("Tie 强制同音相邻，H/P 强制连接无休止间隔的同弦下一音", () => {
    const document = createDocument();
    expect(
      applyScoreCommand(document, {
        type: LXMScoreCommandEnum.AddTechnique,
        trackId,
        technique: {
          type: "tie",
          fromNoteId: "mvp2-note-1-6-6",
          toNoteId: "mvp2-note-1-7-6",
        },
      }),
    ).toMatchObject({ ok: true, changed: true });

    expect(
      applyScoreCommand(document, {
        type: LXMScoreCommandEnum.AddTechnique,
        trackId,
        technique: {
          type: "tie",
          fromNoteId: "mvp2-note-1-6-6",
          toNoteId: "mvp2-note-1-8-6",
        },
      }),
    ).toMatchObject({ ok: false, code: "TECHNIQUE_TARGET_INVALID" });

    expect(
      applyScoreCommand(document, {
        type: LXMScoreCommandEnum.AddTechnique,
        trackId,
        technique: {
          type: "hammerOn",
          fromNoteId: "mvp2-note-1-5-6",
          toNoteId: "mvp2-note-1-7-6",
        },
      }),
    ).toMatchObject({ ok: false, code: "TECHNIQUE_TARGET_INVALID" });
  });

  it("删除被引用内容时在同一命令内级联清理技巧", () => {
    const document = createDocument();
    const added = applyScoreCommand(document, {
      type: LXMScoreCommandEnum.AddTechnique,
      trackId,
      technique: {
        type: "hammerOn",
        fromNoteId: "mvp2-note-1-5-6",
        toNoteId: "mvp2-note-1-6-6",
      },
    });
    if (!added.ok) throw new Error(added.message);

    const removed = applyScoreCommand(added.document, {
      type: LXMScoreCommandEnum.RemoveNote,
      trackId,
      measureId: "mvp2-measure-1",
      beatId: "mvp2-beat-1-6",
      string: 6,
    });
    expect(removed).toMatchObject({ ok: true, changed: true });
    if (removed.ok)
      expect(removed.document.score.tracks[0]!.techniques).toEqual([]);
  });

  it("同弦下一音查询跨普通 Beat，但遇到 rest 截止", () => {
    const document = createDocument();
    const track = document.score.tracks[0]!;
    expect(
      findNextNoteOnSameStringInTrack(track, "mvp2-note-1-5-6")?.note.id,
    ).toBe("mvp2-note-1-6-6");

    track.measures[0]!.beats[5] = {
      ...track.measures[0]!.beats[5]!,
      kind: "rest",
      notes: [],
    };
    expect(
      findNextNoteOnSameStringInTrack(track, "mvp2-note-1-5-6"),
    ).toBeNull();
  });
});
