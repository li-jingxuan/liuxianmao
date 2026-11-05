import { describe, expect, it } from "vitest";
import { EXAMPLE_MVP_7_2_DOCUMENT } from "@liuxianmao/lxm-editor";
import { resolveEditorChordTarget } from "../components/EditorShell/editor-chord-target";

function fixture() {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  const measure = track.measures.find((item) => item.beats.length > 1)!;
  measure.chordSymbols = [];
  const anchor = {
    trackId: track.id,
    measureId: measure.id,
    beatId: measure.beats[0]!.id,
    string: 1,
  };
  return {
    document,
    measure,
    anchor,
    selection: { anchor, focus: { ...anchor, string: 6 } },
  };
}

describe("toolbar chord target", () => {
  it("normalizes a same-beat cross-string range without changing the document", () => {
    const { document, anchor, selection } = fixture();
    const before = structuredClone(document);
    const result = resolveEditorChordTarget(document, selection, null);
    expect(result.target).toEqual({ ...anchor, kind: "chord" });
    expect(result.label).toBe("添加和弦");
    expect(result.title).toContain("第 1 拍");
    expect(document).toEqual(before);
  });

  it("detects existing chord snapshots and supports an active chord without selection", () => {
    const { document, measure, anchor } = fixture();
    const chord = {
      id: "test-chord",
      beatId: anchor.beatId,
      display: "name" as const,
      chord: { name: "Am", diagram: null },
    };
    measure.chordSymbols.push(chord);
    const result = resolveEditorChordTarget(document, null, {
      ...anchor,
      kind: "chord",
      string: 5,
    });
    expect(result.chord).toBe(chord);
    expect(result.label).toBe("编辑和弦");
    expect(result.target?.string).toBe(1);
  });

  it.each(["trackId", "measureId", "beatId"] as const)(
    "rejects ranges across %s",
    (field) => {
      const { document, selection } = fixture();
      selection.focus = { ...selection.focus, [field]: "different" };
      expect(resolveEditorChordTarget(document, selection, null).enabled).toBe(
        false,
      );
    },
  );

  it("does not borrow a TAB selection from lyric or numbered contexts", () => {
    const { document, anchor, selection } = fixture();
    for (const kind of ["lyric", "numbered"] as const) {
      expect(
        resolveEditorChordTarget(document, selection, {
          kind,
          trackId: anchor.trackId,
          measureId: anchor.measureId,
        }).enabled,
      ).toBe(false);
    }
    expect(
      resolveEditorChordTarget(document, selection, null, true).target,
    ).toBeNull();
  });

  it.each(["trackId", "measureId", "beatId"] as const)(
    "validates document existence for %s instead of falling back",
    (field) => {
      const { document, anchor, selection } = fixture();
      const stale = { ...anchor, kind: "chord" as const, [field]: "deleted" };
      expect(
        resolveEditorChordTarget(document, selection, stale).target,
      ).toBeNull();
      expect(
        resolveEditorChordTarget(
          document,
          { anchor: stale, focus: stale },
          null,
        ).target,
      ).toBeNull();
    },
  );

  it("requires an explicit target", () => {
    const { document } = fixture();
    expect(resolveEditorChordTarget(document, null, null)).toMatchObject({
      enabled: false,
      target: null,
      reason: "先选择一个 TAB 拍点，再添加和弦",
    });
  });
});
