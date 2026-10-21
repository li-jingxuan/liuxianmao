import { expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import {
  screenshot,
  chordPair,
} from "../../packages/lxm-editor/tests/fixtures/technique-dense-chords";
import {
  A4_CONTENT_WIDTH,
  buildLayout,
} from "../../packages/lxm-editor/src/layout";
import { getFretTextBounds } from "../../packages/lxm-editor/src/layout/technique-geometry";

/** 保存可直接导入实际网页的完整复现，正式断言另见 dense-chords 回归集合。 */
it("输出修复后的完整截图复现与密集和弦复现", () => {
  for (const [name, document] of [
    ["multi-hammer", screenshot()],
    ["six-string", chordPair([1, 2, 3, 4, 5, 6], "hammerOn", true)],
  ] as const) {
    writeFileSync(
      `artifacts/technique-screenshot-diagnosis/${name}.json`,
      JSON.stringify(document, null, 2),
    );
    const layout = buildLayout(document, {
      purpose: "editing",
      density: "compact",
      systemWidth: A4_CONTENT_WIDTH,
    });
    const measureId = document.score.tracks[0]!.measures[6]!.id;
    const system = layout.systems.find((s) =>
      s.measures.some((m) => m.id === measureId),
    )!;
    const notes = system.measures.find((m) => m.id === measureId)!.notes;
    const rows = document.score.tracks[0]!.techniques.flatMap((t) => {
      if (!("fromNoteId" in t)) return [];
      const note = notes.find((n) => n.id === t.fromNoteId);
      if (!note) return [];
      const seg = system.techniques.find((s) => s.techniqueId === t.id)!;
      const y = Number(seg.path!.d.split(" ")[2]);
      expect(y + seg.path!.strokeWidth / 2).toBeCloseTo(
        getFretTextBounds(note).y,
        8,
      );
      return [
        {
          type: t.type,
          string: note.string,
          fromNoteId: t.fromNoteId,
          path: seg.path,
          label: seg.texts,
          lane: seg.lane,
        },
      ];
    });
    writeFileSync(
      `artifacts/technique-screenshot-diagnosis/${name}-result.json`,
      JSON.stringify(rows, null, 2),
    );
  }
});
