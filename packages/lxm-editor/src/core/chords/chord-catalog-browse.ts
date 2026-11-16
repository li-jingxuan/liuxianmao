import {
  CHORD_FORMULAS,
  CHORD_QUALITIES,
  parseChordCatalogName,
  queryChordCatalog,
  type ChordCatalog,
  type ChordCatalogKey,
  type ChordCatalogMatch,
  type ChordCatalogQuery,
  type ChordQuality,
} from "./chord-catalog";

export type ChordScaleRelationship =
  | "自然三和弦"
  | "自然七和弦"
  | "自然调内"
  | "和声小调内"
  | "含调外音";

export interface ChordCatalogBrowseMatch extends ChordCatalogMatch {
  rootSpelling: string;
  relationship?: ChordScaleRelationship;
}

export interface ChordCatalogRootGroup {
  id: string;
  rootPc: number;
  rootSpelling: string;
  /** Root position relative to the natural major/minor scale, without chord quality. */
  degree?: string;
  label: string;
  items: ChordCatalogBrowseMatch[];
}

export interface ChordCatalogBrowseResult {
  items: ChordCatalogBrowseMatch[];
  groups: ChordCatalogRootGroup[];
}

const mod = (n: number) => ((n % 12) + 12) % 12;
const letters = "CDEFGAB";
const naturalPcs = [0, 2, 4, 5, 7, 9, 11];
const absoluteRoots = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const scales = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};
const rootDegrees = {
  major: ["I", "♭II", "II", "♭III", "III", "IV", "♯IV", "V", "♭VI", "VI", "♭VII", "VII"],
  minor: ["I", "♭II", "II", "III", "♯III", "IV", "♯IV", "V", "VI", "♯VI", "VII", "♯VII"],
};
// Diatonic letter position for each relative pitch class, including altered roots.
const rootLetters = {
  major: [0, 1, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6],
  minor: [0, 1, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6],
};
const degreeSuffixes: Record<ChordQuality, string> = {
  major: "", m: "", "7": "7", maj7: "maj7", m7: "7",
  dim: "°", dim7: "°7", m7b5: "ø7", aug: "+",
  sus2: "sus2", sus4: "sus4", add9: "add9",
  "6": "6", m6: "6", "9": "9", m9: "9",
};
const minorQualities = new Set<ChordQuality>(["m", "m7", "m6", "m9", "dim", "dim7", "m7b5"]);
const triads = new Set<ChordQuality>(["major", "m", "dim"]);
const sevenths = new Set<ChordQuality>(["maj7", "m7", "7", "m7b5"]);

const validatedKey = (key: ChordCatalogKey | undefined): ChordCatalogKey | undefined => {
  if (!key || !Object.hasOwn(scales, key.mode)) return undefined;
  const tonic = parseChordCatalogName(key.tonicSpelling);
  const normalized = key.tonicSpelling.replaceAll("♯", "#").replaceAll("♭", "b")
    .replaceAll("𝄪", "##").replaceAll("𝄫", "bb");
  if (!tonic || tonic.quality !== "major" || tonic.rootPc !== key.tonicPc || tonic.spelling !== normalized)
    return undefined;
  return { ...key, tonicSpelling: tonic.spelling };
};

const spellRoot = (key: ChordCatalogKey, interval: number) => {
  const letterIndex = (letters.indexOf(key.tonicSpelling[0]!) + rootLetters[key.mode][interval]!) % 7;
  let accidental = mod(key.tonicPc + interval - naturalPcs[letterIndex]!);
  if (accidental > 6) accidental -= 12;
  return letters[letterIndex]! + (accidental > 0 ? "#".repeat(accidental) : "b".repeat(-accidental));
};

const relationship = (interval: number, quality: ChordQuality, key: ChordCatalogKey): ChordScaleRelationship => {
  // Use the complete formula, even when a playable ninth voicing omits its fifth.
  const tones = CHORD_FORMULAS[quality].map(tone => mod(interval + tone));
  if (tones.every(tone => scales[key.mode].includes(tone))) {
    if (triads.has(quality)) return "自然三和弦";
    if (sevenths.has(quality)) return "自然七和弦";
    return "自然调内";
  }
  if (key.mode === "minor" && tones.every(tone => [0, 2, 3, 5, 7, 8, 11].includes(tone)))
    return "和声小调内";
  return "含调外音";
};

/**
 * Full-catalog browsing, independent of the smaller recommendation query.
 * Filtering selects identities only: names, degrees and groups continue to follow
 * the browsing key. Without a valid key, roots are absolute and degrees are absent.
 */
export const browseChordCatalog = (
  catalog: ChordCatalog,
  query: ChordCatalogQuery = {},
): ChordCatalogBrowseResult => {
  const key = validatedKey(query.key);
  const identities = new Set(queryChordCatalog(catalog, {
    text: query.text, rootPc: query.rootPc, quality: query.quality,
  }).items.map(match => match.item.id));
  const order = key
    ? [...scales[key.mode], ...Array.from({ length: 12 }, (_, i) => i).filter(i => !scales[key.mode].includes(i))]
    : Array.from({ length: 12 }, (_, i) => i);
  const groups = order.map(interval => {
    const rootPc = mod((key?.tonicPc ?? 0) + interval);
    const rootSpelling = key ? spellRoot(key, interval) : absoluteRoots[rootPc]!;
    const degree = key ? rootDegrees[key.mode][interval]! : undefined;
    const items = catalog.items
      .filter(item => item.rootPc === rootPc && identities.has(item.id))
      .sort((a, b) => CHORD_QUALITIES.indexOf(a.quality) - CHORD_QUALITIES.indexOf(b.quality))
      .map((item): ChordCatalogBrowseMatch => ({
        item,
        rootSpelling,
        name: rootSpelling + (item.quality === "major" ? "" : item.quality),
        ...(key && degree ? {
          degree: (minorQualities.has(item.quality) ? degree.toLowerCase() : degree) + degreeSuffixes[item.quality],
          relationship: relationship(interval, item.quality, key),
        } : {}),
      }));
    return {
      id: `root:${rootPc}`, rootPc, rootSpelling, degree,
      label: key
        ? `${key.tonicSpelling} ${key.mode === "major" ? "大调" : "小调"} · ${degree} 级根音 ${rootSpelling}`
        : `根音 ${rootSpelling}`,
      items,
    };
  }).filter(group => group.items.length);
  return { items: groups.flatMap(group => group.items), groups };
};
