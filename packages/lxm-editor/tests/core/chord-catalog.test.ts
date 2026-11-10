import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CHORD_QUALITIES,
  copyCatalogVoicing,
  inspectCatalogVoicing,
  parseChordCatalog,
  parseChordCatalogName,
  queryChordCatalog,
} from "../../src/core/chord-catalog";
import { validateChordDiagram } from "../../src/core/chord-diagram";

const dataUrl = new URL(
  "../../../../apps/website/public/assets/chords/catalog-2026.11.11.1.json",
  import.meta.url,
);
const raw = () => JSON.parse(readFileSync(dataUrl, "utf8"));
const load = () => {
  const result = parseChordCatalog(raw(), "2026.11.11.1");
  if (!result.ok) throw new Error(result.error);
  return result.catalog;
};

describe("published chord catalog public APIs", () => {
  it("covers 12 × 16 identities with valid root-bass closed shapes and distinct popular alternatives", () => {
    const catalog = load();
    expect(catalog.items).toHaveLength(192);
    expect(new Set(catalog.items.map((i) => i.id)).size).toBe(192);
    for (let rootPc = 0; rootPc < 12; rootPc++)
      for (const quality of CHORD_QUALITIES) {
        const item = catalog.items.find(
          (i) => i.rootPc === rootPc && i.quality === quality,
        )!;
        expect(item).toBeDefined();
        const closed = item.voicings.find((v) => v.id === "a-closed-01")!;
        expect(
          closed.diagram.strings.every((s) => s.fret === "x" || s.fret > 0),
        ).toBe(true);
        expect(closed.bassPc).toBe(rootPc);
        const shapes = new Set(
          item.voicings.map((v) =>
            v.diagram.strings.map((s) => s.fret).join(","),
          ),
        );
        expect(shapes.size).toBe(item.voicings.length);
        for (const v of item.voicings) {
          expect(validateChordDiagram(v.diagram)).toBeNull();
          expect(inspectCatalogVoicing(item, v).valid).toBe(true);
        }
      }
    for (const name of ["C", "G", "Am", "F", "Dm", "Em"])
      expect(catalog.items.find((i) => i.name === name)?.voicings).toHaveLength(
        3,
      );
    expect(
      Object.isFrozen(catalog.items[0]!.voicings[0]!.diagram.strings),
    ).toBe(true);
  });
  it("rejects partial catalogs, unknown fields/versions, broken identities/references/aliases and wrong harmony/bass", () => {
    const changes: ((d: ReturnType<typeof raw>) => void)[] = [
      (d) => d.items.pop(),
      (d) => {
        d.formatVersion = 2;
      },
      (d) => {
        d.extra = true;
      },
      (d) => {
        d.items[0].id = "pc:99/major";
      },
      (d) => {
        d.items[0].rootPc = 1;
      },
      (d) => {
        d.items[0].defaultVoicingId = "missing";
      },
      (d) => {
        d.items[0].aliases.push("Dm");
      },
      (d) => {
        d.items[0].aliases.push(d.items[0].aliases[0]);
      },
      (d) => {
        d.items[0].voicings.push(d.items[0].voicings[0]);
      },
      (d) => {
        d.items[0].voicings[0].bassPc = 5;
      },
      (d) => {
        d.items[0].voicings[0].diagram.strings[0].fret = 24;
      },
      (d) => {
        d.items[0].voicings[0].diagram.strings[0].extra = true;
      },
    ];
    for (const change of changes) {
      const value = raw();
      change(value);
      expect(parseChordCatalog(value).ok).toBe(false);
    }
    expect(parseChordCatalog(raw(), "2026.11.11.2").ok).toBe(false);
  });
  it("preserves suffix case and resolves enharmonic/double-accidental searches", () => {
    const catalog = load();
    expect(parseChordCatalogName("cM7")?.quality).toBe("maj7");
    expect(parseChordCatalogName("Cm7")?.quality).toBe("m7");
    expect(
      queryChordCatalog(catalog, { text: "D♭m7" }).items.map((m) => [
        m.item.id,
        m.name,
      ]),
    ).toEqual([["pc:1/m7", "Dbm7"]]);
    expect(queryChordCatalog(catalog, { text: "Bbbm" }).items[0]?.item.id).toBe(
      "pc:9/m",
    );
    expect(queryChordCatalog(catalog, { text: "CM" }).items[0]?.name).toBe("C");
    expect(queryChordCatalog(catalog, { text: "Cm" }).items[0]?.name).toBe(
      "Cm",
    );
    expect(queryChordCatalog(catalog, { text: "C" }).items).toHaveLength(16);
    expect(queryChordCatalog(catalog, { text: "Ccustom" }).items).toEqual([]);
  });
  it("recommends only diatonic triads/sevenths and separately spells harmonic minor", () => {
    const catalog = load();
    expect(
      queryChordCatalog(catalog, {
        key: { tonicPc: 0, tonicSpelling: "C", mode: "major" },
      }).items.map((m) => m.name),
    ).toEqual([
      "C",
      "Dm",
      "Em",
      "F",
      "G",
      "Am",
      "Bdim",
      "Cmaj7",
      "Dm7",
      "Em7",
      "Fmaj7",
      "G7",
      "Am7",
      "Bm7b5",
    ]);
    const minor = queryChordCatalog(catalog, {
      key: { tonicPc: 6, tonicSpelling: "Gb", mode: "minor" },
    });
    expect(minor.groups[0]?.items.slice(0, 7).map((m) => m.name)).toEqual([
      "Gbm",
      "Abdim",
      "Bbb",
      "Cbm",
      "Dbm",
      "Ebb",
      "Fb",
    ]);
    expect(minor.groups[1]?.items.map((m) => [m.name, m.degree])).toEqual([
      ["Db", "V"],
      ["Db7", "V7"],
      ["Fdim", "vii°"],
      ["Fdim7", "vii°7"],
    ]);
    expect(
      queryChordCatalog(catalog, {
        key: { tonicPc: 6, tonicSpelling: "Gb", mode: "major" },
      }).items.some((m) => m.name === "Cb"),
    ).toBe(true);
    expect(
      queryChordCatalog(catalog, {
        key: { tonicPc: 0, tonicSpelling: "G", mode: "major" },
      }).items,
    ).toEqual([]);
    expect(
      queryChordCatalog(catalog, {
        text: "D7",
        key: { tonicPc: 0, tonicSpelling: "C", mode: "major" },
      }).items[0]?.name,
    ).toBe("D7");
  });
  it("copies independent complete snapshots and rejects missing or mismatched references", () => {
    const catalog = load();
    const a = copyCatalogVoicing(catalog, "pc:1/m", "a-closed-01", "Db");
    const b = copyCatalogVoicing(catalog, "pc:1/m", "a-closed-01", "C#");
    if (!a.ok || !b.ok) throw new Error("copy failed");
    expect(a.chord.name).toBe("Dbm");
    a.chord.diagram.strings[0]!.fret = "x";
    a.chord.diagram.barres[0]!.fret = 20;
    expect(b.chord.diagram.strings[0]!.fret).not.toBe("x");
    expect(b.chord.diagram.barres[0]!.fret).not.toBe(20);
    expect(copyCatalogVoicing(catalog, "pc:1/m", "a-closed-01", "C").ok).toBe(
      false,
    );
    expect(copyCatalogVoicing(catalog, "pc:1/m", "missing").ok).toBe(false);
    expect(copyCatalogVoicing(catalog, "pc:1/unknown", "a-closed-01").ok).toBe(
      false,
    );
  });
  it("allows only the fifth omission for ninths; never a missing third/seventh/ninth", () => {
    const catalog = load();
    const item = catalog.items.find((i) => i.id === "pc:0/9")!;
    const original = item.voicings[0]!;
    const withoutFifth = structuredClone(original);
    withoutFifth.diagram.strings[0]!.fret = "x";
    withoutFifth.diagram.strings[0]!.finger = null;
    expect(inspectCatalogVoicing(item, withoutFifth).valid).toBe(true);
    for (const string of [2, 3, 4]) {
      const missingRequired = structuredClone(withoutFifth);
      missingRequired.diagram.strings[string - 1]!.fret = "x";
      expect(inspectCatalogVoicing(item, missingRequired).valid).toBe(false);
    }
  });
});
