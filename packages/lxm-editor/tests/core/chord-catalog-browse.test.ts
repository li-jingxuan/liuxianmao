import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CHORD_QUALITIES,
  parseChordCatalog,
  parseChordCatalogName,
  queryChordCatalog,
  type ChordCatalogKey,
} from "../../src/core/chords/chord-catalog";
import { browseChordCatalog } from "../../src/core/chords/chord-catalog-browse";

const parsed = parseChordCatalog(JSON.parse(readFileSync(new URL(
  "../../../../apps/website/public/assets/chords/catalog-2026.11.11.1.json",
  import.meta.url,
), "utf8")));
if (!parsed.ok) throw new Error(parsed.error);
const catalog = parsed.catalog;
const key = (tonicSpelling: string, mode: ChordCatalogKey["mode"] = "major"): ChordCatalogKey => ({
  tonicSpelling, tonicPc: parseChordCatalogName(tonicSpelling)!.rootPc, mode,
});

describe("full chord catalog browsing", () => {
  for (const spelling of ["C", "C#", "Db", "D", "D#", "Eb", "E", "E#", "Fb", "F", "F#", "Gb", "G", "G#", "Ab", "A", "A#", "Bb", "B", "B#", "Cb"]) {
    for (const mode of ["major", "minor"] as const) {
      it(`classifies all 192 identities once in ${spelling} ${mode}, with valid key spellings`, () => {
        const browsingKey = key(spelling, mode);
        const result = browseChordCatalog(catalog, { key: browsingKey });
        expect(result.items).toHaveLength(192);
        expect(new Set(result.items.map(match => match.item.id)).size).toBe(192);
        expect(result.groups).toHaveLength(12);
        expect(result.groups.map(group => (group.rootPc - browsingKey.tonicPc + 12) % 12)).toEqual(
          mode === "major" ? [0, 2, 4, 5, 7, 9, 11, 1, 3, 6, 8, 10] : [0, 2, 3, 5, 7, 8, 10, 1, 4, 6, 9, 11],
        );
        for (const group of result.groups) {
          expect(group.items).toHaveLength(16);
          expect(group.items.map(match => match.item.quality)).toEqual(CHORD_QUALITIES);
          expect(parseChordCatalogName(group.rootSpelling)?.rootPc).toBe(group.rootPc);
          for (const match of group.items) {
            const identity = parseChordCatalogName(match.name);
            expect(identity?.rootPc).toBe(match.item.rootPc);
            expect(identity?.quality).toBe(match.item.quality);
            expect(identity?.spelling).toBe(group.rootSpelling);
            expect(match.degree).toBeTruthy();
            expect(match.relationship).toBeTruthy();
          }
        }
        // Existing recommendation identities must retain their established spelling and degree.
        for (const recommendation of queryChordCatalog(catalog, { key: browsingKey }).items) {
          const full = result.items.find(match => match.item.id === recommendation.item.id)!;
          expect(full.name).toBe(recommendation.name);
          // Harmonic minor leading tone is raised relative to the natural minor baseline.
          expect(full.degree).toBe(recommendation.group === "harmonic" && recommendation.item.rootPc === (browsingKey.tonicPc + 11) % 12
            ? `♯${recommendation.degree}` : recommendation.degree);
        }
      });
    }
  }

  it("distinguishes nature, quality and complete-tone relationships in C major", () => {
    const result = browseChordCatalog(catalog, { key: key("C") });
    const examples = [
      ["C", "I", "自然三和弦"], ["Cm", "i", "含调外音"],
      ["C7", "I7", "含调外音"], ["Cmaj7", "Imaj7", "自然七和弦"],
      ["C6", "I6", "自然调内"], ["Cadd9", "Iadd9", "自然调内"],
      ["Csus2", "Isus2", "自然调内"], ["Csus4", "Isus4", "自然调内"],
      ["Cm6", "i6", "含调外音"], ["C9", "I9", "含调外音"],
      ["D7", "II7", "含调外音"], ["Dm9", "ii9", "自然调内"],
      ["G9", "V9", "自然调内"], ["Bm7b5", "viiø7", "自然七和弦"],
      ["Bdim", "vii°", "自然三和弦"], ["Bdim7", "vii°7", "含调外音"],
      ["Caug", "I+", "含调外音"], ["Dbm7", "♭ii7", "含调外音"],
    ];
    for (const [name, degree, relationship] of examples) {
      const match = result.items.find(item => item.name === name);
      expect(match, name).toMatchObject({ degree, relationship });
    }
    expect(result.groups[0]?.label).toBe("C 大调 · I 级根音 C");
    expect(result.groups[7]?.label).toBe("C 大调 · ♭II 级根音 Db");
  });

  it("uses natural minor degrees and identifies the harmonic minor chords by their complete tones", () => {
    const result = browseChordCatalog(catalog, { key: key("A", "minor") });
    for (const [name, degree, relationship] of [
      ["Am", "i", "自然三和弦"], ["Am7", "i7", "自然七和弦"],
      ["C", "III", "自然三和弦"], ["F", "VI", "自然三和弦"], ["G", "VII", "自然三和弦"],
      ["E", "V", "和声小调内"], ["E7", "V7", "和声小调内"],
      ["G#dim", "♯vii°", "和声小调内"], ["G#dim7", "♯vii°7", "和声小调内"],
      ["Caug", "III+", "和声小调内"], ["Am6", "i6", "含调外音"],
      ["A", "I", "含调外音"], ["A7", "I7", "含调外音"], ["Asus2", "Isus2", "自然调内"],
    ]) expect(result.items.find(match => match.name === name), name).toMatchObject({ degree, relationship });
  });

  it("spells natural and altered roots from the tonic letter, including double accidentals", () => {
    expect(browseChordCatalog(catalog, { key: key("Gb", "minor") }).groups.slice(0, 7).map(group => group.rootSpelling))
      .toEqual(["Gb", "Ab", "Bbb", "Cb", "Db", "Ebb", "Fb"]);
    expect(browseChordCatalog(catalog, { key: key("F#") }).groups.slice(0, 7).map(group => group.rootSpelling))
      .toEqual(["F#", "G#", "A#", "B", "C#", "D#", "E#"]);
    expect(browseChordCatalog(catalog, { key: key("F#", "minor"), text: "Fdim7" }).items[0])
      .toMatchObject({ name: "E#dim7", degree: "♯vii°7", relationship: "和声小调内" });
  });

  it("keeps the key's groups, spelling, degrees and relationships during enharmonic search and filters", () => {
    const browsingKey = key("Db");
    const full = browseChordCatalog(catalog, { key: browsingKey });
    const result = browseChordCatalog(catalog, { key: browsingKey, text: "C♯m7", rootPc: 1, quality: "m7" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(full.items.find(match => match.item.id === "pc:1/m7"));
    expect(result.items[0]).toMatchObject({ name: "Dbm7", degree: "i7", relationship: "含调外音" });
    expect(result.groups[0]?.label).toBe("Db 大调 · I 级根音 Db");
    expect(browseChordCatalog(catalog, { key: browsingKey, text: "C#" }).groups[0]?.items).toHaveLength(16);
    const filtered = browseChordCatalog(catalog, { key: browsingKey, quality: "maj7" });
    expect(filtered.groups.map(group => group.label)).toEqual(full.groups.map(group => group.label));
    expect(filtered.items).toHaveLength(12);
    expect(browseChordCatalog(catalog, { key: browsingKey, text: "CM7" }).items[0]?.item.id).toBe("pc:0/maj7");
    expect(browseChordCatalog(catalog, { key: browsingKey, text: "C7" }).items[0]?.item.id).toBe("pc:0/7");
    expect(browseChordCatalog(catalog, { key: browsingKey, text: "Ccustom" }).groups).toEqual([]);
    expect(browseChordCatalog(catalog, { key: browsingKey, text: "C7", quality: "maj7" }).items).toEqual([]);
  });

  it("uses absolute roots without fabricating degrees or relationships when no valid key is known", () => {
    for (const browsingKey of [undefined, { tonicPc: 0, tonicSpelling: "G", mode: "major" } as const]) {
      const result = browseChordCatalog(catalog, { key: browsingKey });
      expect(result.items).toHaveLength(192);
      expect(result.groups.map(group => group.label)).toEqual(["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"].map(root => `根音 ${root}`));
      expect(result.groups.every(group => group.degree === undefined)).toBe(true);
      expect(result.items.every(match => match.degree === undefined && match.relationship === undefined)).toBe(true);
    }
  });
});
