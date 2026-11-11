import { z } from "zod";
import { cloneChordDiagram } from "./chord-diagram";
import { LXMChordDiagramSchema } from "../document/schema";
import type { ILXMChordDiagram } from "../types";

export const CHORD_QUALITIES = [
  "major",
  "m",
  "7",
  "maj7",
  "m7",
  "dim",
  "dim7",
  "m7b5",
  "aug",
  "sus2",
  "sus4",
  "add9",
  "6",
  "m6",
  "9",
  "m9",
] as const;
export type ChordQuality = (typeof CHORD_QUALITIES)[number];
export const CHORD_FORMULAS: Record<ChordQuality, readonly number[]> = {
  major: [0, 4, 7],
  m: [0, 3, 7],
  "7": [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  dim: [0, 3, 6],
  dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  add9: [0, 4, 7, 14],
  "6": [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  "9": [0, 4, 7, 10, 14],
  m9: [0, 3, 7, 10, 14],
};
export interface ChordIdentity {
  rootPc: number;
  quality: ChordQuality;
}
export interface ChordCatalogVoicing {
  id: string;
  label: string;
  bassPc: number;
  diagram: ILXMChordDiagram;
}
export interface ChordCatalogItem extends ChordIdentity {
  id: string;
  name: string;
  aliases: string[];
  defaultVoicingId: string;
  voicings: ChordCatalogVoicing[];
}
export interface ChordCatalog {
  format: "lxm-chord-catalog";
  formatVersion: 1;
  dataVersion: string;
  tuningId: "guitar-standard";
  items: ChordCatalogItem[];
}
export interface ChordCatalogKey {
  tonicPc: number;
  tonicSpelling: string;
  mode: "major" | "minor";
}
export interface ChordCatalogQuery {
  text?: string;
  rootPc?: number;
  quality?: ChordQuality;
  key?: ChordCatalogKey;
}
export interface ChordCatalogMatch {
  item: ChordCatalogItem;
  name: string;
  degree?: string;
  group?: "natural" | "harmonic";
}
export interface ChordRecommendationGroup {
  id: "natural" | "harmonic";
  label: string;
  items: ChordCatalogMatch[];
}
export interface ChordCatalogResult {
  items: ChordCatalogMatch[];
  groups: ChordRecommendationGroup[];
}

const pc = (n: number) => ((n % 12) + 12) % 12;
const letters = "CDEFGAB";
const naturals = [0, 2, 4, 5, 7, 9, 11];
const suffix: Record<ChordQuality, string> = {
  major: "",
  m: "m",
  "7": "7",
  maj7: "maj7",
  m7: "m7",
  dim: "dim",
  dim7: "dim7",
  m7b5: "m7b5",
  aug: "aug",
  sus2: "sus2",
  sus4: "sus4",
  add9: "add9",
  "6": "6",
  m6: "m6",
  "9": "9",
  m9: "m9",
};
const qualityAliases: Record<string, ChordQuality> = {
  "": "major",
  major: "major",
  maj: "major",
  M: "major",
  m: "m",
  min: "m",
  "-": "m",
  "7": "7",
  maj7: "maj7",
  M7: "maj7",
  Δ7: "maj7",
  m7: "m7",
  min7: "m7",
  "-7": "m7",
  dim: "dim",
  "°": "dim",
  dim7: "dim7",
  "°7": "dim7",
  m7b5: "m7b5",
  ø: "m7b5",
  ø7: "m7b5",
  aug: "aug",
  "+": "aug",
  sus2: "sus2",
  sus4: "sus4",
  sus: "sus4",
  add9: "add9",
  "6": "6",
  m6: "m6",
  "9": "9",
  m9: "m9",
};
const normalize = (text: string) =>
  text
    .trim()
    .replaceAll("♯", "#")
    .replaceAll("♭", "b")
    .replaceAll("𝄪", "##")
    .replaceAll("𝄫", "bb");
const splitName = (text: string) =>
  /^([A-Ga-g])((?:#{1,4}|b{1,4}|x)?)(.*)$/.exec(normalize(text));
export const parseChordCatalogName = (
  text: string,
): (ChordIdentity & { spelling: string }) | null => {
  const match = splitName(text);
  if (!match || !Object.hasOwn(qualityAliases, match[3]!)) return null;
  const spelling = match[1]!.toUpperCase() + match[2]!.replace("x", "##");
  const accidental = spelling.slice(1);
  return {
    rootPc: pc(
      naturals[letters.indexOf(spelling[0]!)]! +
        (accidental.startsWith("#") ? accidental.length : -accidental.length),
    ),
    quality: qualityAliases[match[3]!]!,
    spelling,
  };
};

const idSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
const nameSchema = z
  .string()
  .min(1)
  .max(32)
  .refine((name) => normalize(name) === name && !/[\r\n]/.test(name));
const schema = z
  .object({
    format: z.literal("lxm-chord-catalog"),
    formatVersion: z.literal(1),
    dataVersion: z.string().regex(/^\d{4}\.\d{2}\.\d{2}\.\d+$/),
    tuningId: z.literal("guitar-standard"),
    items: z
      .array(
        z
          .object({
            id: z.string(),
            rootPc: z.number().int().min(0).max(11),
            quality: z.enum(CHORD_QUALITIES),
            name: nameSchema,
            aliases: z.array(nameSchema).max(256),
            defaultVoicingId: idSchema,
            voicings: z
              .array(
                z
                  .object({
                    id: idSchema,
                    label: z.string().trim().min(1).max(80),
                    bassPc: z.number().int().min(0).max(11),
                    diagram: LXMChordDiagramSchema,
                  })
                  .strict(),
              )
              .min(1)
              .max(16),
          })
          .strict(),
      )
      .length(192),
  })
  .strict();

/** Actual MIDI is retained to distinguish the lowest sound from string order. */
export const inspectCatalogVoicing = (
  identity: ChordIdentity,
  voicing: ChordCatalogVoicing,
) => {
  const midi = voicing.diagram.strings.flatMap((s) =>
    typeof s.fret === "number"
      ? [[64, 59, 55, 50, 45, 40][s.string - 1]! + s.fret]
      : [],
  );
  const intervals = [...new Set(midi.map((n) => pc(n - identity.rootPc)))].sort(
    (a, b) => a - b,
  );
  const expected = CHORD_FORMULAS[identity.quality].map(pc);
  const required = expected.filter(
    (n) =>
      !(n === 7 && (identity.quality === "9" || identity.quality === "m9")),
  );
  const bassPc = pc(Math.min(...midi));
  return {
    midi,
    intervals,
    bassPc,
    valid:
      midi.length > 0 &&
      bassPc === voicing.bassPc &&
      intervals.every((n) => expected.includes(n)) &&
      required.every((n) => intervals.includes(n)),
  };
};

const freeze = <T>(value: T): T => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
export const parseChordCatalog = (
  input: unknown,
  expectedVersion?: string,
): { ok: true; catalog: ChordCatalog } | { ok: false; error: string } => {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: `和弦库格式无效：${parsed.error.issues[0]?.message}`,
    };
  const catalog = parsed.data;
  if (expectedVersion !== undefined && catalog.dataVersion !== expectedVersion)
    return { ok: false, error: "和弦库版本与清单不一致" };
  const ids = new Set<string>();
  const aliases = new Map<string, string>();
  for (const item of catalog.items) {
    if (item.id !== `pc:${item.rootPc}/${item.quality}` || ids.has(item.id))
      return { ok: false, error: `和弦身份重复或不一致：${item.id}` };
    ids.add(item.id);
    for (const name of [item.name, ...item.aliases]) {
      const identity = parseChordCatalogName(name);
      const key = identity ? `${identity.spelling}/${identity.quality}` : name;
      if (
        !identity ||
        identity.rootPc !== item.rootPc ||
        identity.quality !== item.quality ||
        (aliases.has(key) && aliases.get(key) !== item.id)
      )
        return { ok: false, error: `和弦别名冲突或无效：${name}` };
      aliases.set(key, item.id);
    }
    if (
      new Set(item.aliases).size !== item.aliases.length ||
      item.aliases.includes(item.name)
    )
      return { ok: false, error: `和弦别名重复：${item.id}` };
    const voicingIds = new Set(item.voicings.map((v) => v.id));
    if (
      voicingIds.size !== item.voicings.length ||
      !voicingIds.has(item.defaultVoicingId)
    )
      return { ok: false, error: `指法引用无效：${item.id}` };
    if (!item.voicings.some((v) => v.bassPc === item.rootPc))
      return { ok: false, error: `缺少根音低音指法：${item.id}` };
    for (const v of item.voicings)
      if (!inspectCatalogVoicing(item, v).valid)
        return { ok: false, error: `指法音程或低音不符：${item.id}/${v.id}` };
  }
  return { ok: true, catalog: freeze(catalog) };
};

const spelledNote = (letterIndex: number, targetPc: number) => {
  const i = ((letterIndex % 7) + 7) % 7;
  let delta = pc(targetPc - naturals[i]!);
  if (delta > 6) delta -= 12;
  return letters[i]! + (delta > 0 ? "#".repeat(delta) : "b".repeat(-delta));
};
const recommendations = (
  catalog: ChordCatalog,
  key: ChordCatalogKey,
): ChordRecommendationGroup[] => {
  const tonic = parseChordCatalogName(key.tonicSpelling);
  if (
    !tonic ||
    tonic.quality !== "major" ||
    tonic.spelling !== normalize(key.tonicSpelling) ||
    tonic.rootPc !== key.tonicPc ||
    !["major", "minor"].includes(key.mode)
  )
    return [];
  const minor = key.mode === "minor";
  const scale = minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const triads: ChordQuality[] = minor
    ? ["m", "dim", "major", "m", "m", "major", "major"]
    : ["major", "m", "m", "major", "major", "m", "dim"];
  const sevenths: ChordQuality[] = minor
    ? ["m7", "m7b5", "maj7", "m7", "m7", "maj7", "7"]
    : ["maj7", "m7", "m7", "maj7", "7", "m7", "m7b5"];
  const degrees = minor
    ? [
        "i",
        "ii°",
        "III",
        "iv",
        "v",
        "VI",
        "VII",
        "i7",
        "iiø7",
        "IIImaj7",
        "iv7",
        "v7",
        "VImaj7",
        "VII7",
      ]
    : [
        "I",
        "ii",
        "iii",
        "IV",
        "V",
        "vi",
        "vii°",
        "Imaj7",
        "ii7",
        "iii7",
        "IVmaj7",
        "V7",
        "vi7",
        "viiø7",
      ];
  const make = (
    degree: number,
    interval: number,
    quality: ChordQuality,
    roman: string,
    group: "natural" | "harmonic",
  ): ChordCatalogMatch[] => {
    const rootPc = pc(key.tonicPc + interval);
    const item = catalog.items.find(
      (i) => i.rootPc === rootPc && i.quality === quality,
    );
    return item
      ? [
          {
            item,
            name:
              spelledNote(
                letters.indexOf(tonic.spelling[0]!) + degree,
                rootPc,
              ) + suffix[quality],
            degree: roman,
            group,
          },
        ]
      : [];
  };
  const natural = [...triads, ...sevenths].flatMap((q, i) =>
    make(i % 7, scale[i % 7]!, q, degrees[i]!, "natural"),
  );
  const groups: ChordRecommendationGroup[] = [
    { id: "natural", label: minor ? "自然小调" : "自然大调", items: natural },
  ];
  if (minor)
    groups.push({
      id: "harmonic",
      label: "和声小调补充",
      items: [
        make(4, 7, "major", "V", "harmonic"),
        make(4, 7, "7", "V7", "harmonic"),
        make(6, 11, "dim", "vii°", "harmonic"),
        make(6, 11, "dim7", "vii°7", "harmonic"),
      ].flat(),
    });
  return groups;
};

export const queryChordCatalog = (
  catalog: ChordCatalog,
  query: ChordCatalogQuery = {},
): ChordCatalogResult => {
  const text = normalize(query.text ?? "");
  const groups = !text && query.key ? recommendations(catalog, query.key) : [];
  let matches: ChordCatalogMatch[] =
    query.key && !text
      ? groups.flatMap((g) => g.items)
      : catalog.items.map((item) => ({ item, name: item.name }));
  if (text) {
    const parsed = parseChordCatalogName(text);
    const split = splitName(text);
    if (parsed)
      matches = matches
        .filter(
          ({ item }) =>
            item.rootPc === parsed.rootPc &&
            (split?.[3] === "" || item.quality === parsed.quality),
        )
        .map((m) => ({ ...m, name: parsed.spelling + suffix[m.item.quality] }));
    else matches = [];
  }
  const filter = (m: ChordCatalogMatch) =>
    (query.rootPc === undefined || m.item.rootPc === query.rootPc) &&
    (query.quality === undefined || m.item.quality === query.quality);
  return {
    items: matches.filter(filter),
    groups: groups.map((g) => ({ ...g, items: g.items.filter(filter) })),
  };
};

export const copyCatalogVoicing = (
  catalog: ChordCatalog,
  identityId: string,
  voicingId: string,
  spelling?: string,
):
  | { ok: true; chord: { name: string; diagram: ILXMChordDiagram } }
  | { ok: false; error: string } => {
  const item = catalog.items.find((i) => i.id === identityId);
  if (!item) return { ok: false, error: "和弦身份不存在" };
  const voicing = item.voicings.find((v) => v.id === voicingId);
  if (!voicing) return { ok: false, error: "和弦指法不存在" };
  const root = spelling === undefined ? null : parseChordCatalogName(spelling);
  if (
    spelling !== undefined &&
    (!root ||
      root.quality !== "major" ||
      root.rootPc !== item.rootPc ||
      root.spelling !== normalize(spelling))
  )
    return { ok: false, error: "和弦拼写与根音不一致" };
  return {
    ok: true,
    chord: {
      name: root ? root.spelling + suffix[item.quality] : item.name,
      diagram: cloneChordDiagram(voicing.diagram),
    },
  };
};
