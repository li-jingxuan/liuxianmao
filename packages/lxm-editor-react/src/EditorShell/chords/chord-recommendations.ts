import { queryChordCatalog, type ChordCatalog, type ChordCatalogKey, type ChordCatalogMatch } from "@liuxianmao/lxm-editor";

/** Prefer an available open shape, then the lowest real voicing in the catalog. */
export const recommendedVoicing = (match: ChordCatalogMatch) => match.item.voicings.find(v => v.id === "open-01") ??
  [...match.item.voicings].sort((a, b) => {
    const highest = (v: typeof a) => Math.max(...v.diagram.strings.map(s => typeof s.fret === "number" ? s.fret : 0));
    return highest(a) - highest(b);
  })[0]!;

/** Rank actual catalog recommendations; spelling and minor harmony come from the catalog. */
export const quickChordMatches = (catalog: ChordCatalog, key: ChordCatalogKey): ChordCatalogMatch[] => {
  const result = queryChordCatalog(catalog, { key });
  const order: [number, string][] = key.mode === "major"
    ? [[0, "major"], [7, "major"], [9, "m"], [5, "major"], [2, "m"], [4, "m"], [7, "7"], [0, "maj7"]]
    : [[0, "m"], [5, "m"], [7, "major"], [3, "major"], [10, "major"], [8, "major"], [7, "m"], [7, "7"]];
  return order.flatMap(([offset, quality]) => {
    const match = result.items.find(({ item }) => item.rootPc === (key.tonicPc + offset) % 12 && item.quality === quality);
    return match ? [match] : [];
  });
};
