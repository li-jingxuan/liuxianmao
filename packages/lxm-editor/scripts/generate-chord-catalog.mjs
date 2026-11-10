/** Deterministic, reviewed CLOSED movable templates. Never transpose open shapes. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

const version = "2026.11.11.1";
const target = fileURLToPath(
  new URL("../../../apps/website/public/assets/chords/", import.meta.url),
);
const roots = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const suffixes = {
  major: "",
  m: "m",
  7: "7",
  maj7: "maj7",
  m7: "m7",
  dim: "dim",
  dim7: "dim7",
  m7b5: "m7b5",
  aug: "aug",
  sus2: "sus2",
  sus4: "sus4",
  add9: "add9",
  6: "6",
  m6: "m6",
  9: "9",
  m9: "m9",
};
const aliases = {
  major: ["", "maj", "M", "major"],
  m: ["m", "min", "-"],
  7: ["7"],
  maj7: ["maj7", "M7", "Δ7"],
  m7: ["m7", "min7", "-7"],
  dim: ["dim", "°"],
  dim7: ["dim7", "°7"],
  m7b5: ["m7b5", "ø", "ø7"],
  aug: ["aug", "+"],
  sus2: ["sus2"],
  sus4: ["sus4", "sus"],
  add9: ["add9"],
  6: ["6"],
  m6: ["m6"],
  9: ["9"],
  m9: ["m9"],
};
// Low E -> high E. x = muted; numeric entries are offsets from A-string root.
// Barre tuple: [offset, minString, maxString, finger]. All frets are positive.
const aTemplates = {
  major: [
    ["x", 0, 2, 2, 2, 0],
    [0, 1, 3, 3, 3, 1],
    [
      [0, 1, 5, 1],
      [2, 2, 4, 3],
    ],
  ],
  m: [["x", 0, 2, 2, 1, 0], [0, 1, 3, 4, 2, 1], [[0, 1, 5, 1]]],
  7: [["x", 0, 2, 0, 2, 0], [0, 1, 3, 1, 4, 1], [[0, 1, 5, 1]]],
  maj7: [["x", 0, 2, 1, 2, 0], [0, 1, 3, 2, 4, 1], [[0, 1, 5, 1]]],
  m7: [["x", 0, 2, 0, 1, 0], [0, 1, 3, 1, 2, 1], [[0, 1, 5, 1]]],
  dim: [["x", 0, 1, 2, 1, "x"], [0, 1, 2, 4, 3, 0], []],
  dim7: [["x", 0, 1, -1, 1, "x"], [0, 2, 3, 1, 4, 0], []],
  m7b5: [["x", 0, 1, 0, 1, "x"], [0, 1, 2, 1, 3, 0], [[0, 3, 5, 1]]],
  aug: [["x", 0, -1, -2, -2, "x"], [0, 3, 2, 1, 1, 0], [[-2, 2, 3, 1]]],
  sus2: [
    ["x", 0, 2, 2, 0, 0],
    [0, 1, 3, 3, 1, 1],
    [
      [0, 1, 5, 1],
      [2, 3, 4, 3],
    ],
  ],
  sus4: [
    ["x", 0, 2, 2, 3, 0],
    [0, 1, 3, 3, 4, 1],
    [
      [0, 1, 5, 1],
      [2, 3, 4, 3],
    ],
  ],
  add9: [["x", 0, -1, -3, 0, "x"], [0, 3, 2, 1, 4, 0], []],
  6: [["x", 0, 2, 2, 2, 2], [0, 1, 3, 3, 3, 3], [[2, 1, 4, 3]]],
  m6: [["x", 0, 2, 2, 1, 2], [0, 1, 3, 3, 2, 4], [[2, 3, 4, 3]]],
  9: [["x", 0, -1, 0, 0, 0], [0, 2, 1, 3, 3, 3], [[0, 1, 3, 3]]],
  m9: [["x", 0, -2, 0, 0, 0], [0, 2, 1, 3, 3, 3], [[0, 1, 3, 3]]],
};
const eTemplates = {
  major: [[0, 2, 2, 1, 0, 0], [1, 3, 4, 2, 1, 1], [[0, 1, 6, 1]]],
  m: [[0, 2, 2, 0, 0, 0], [1, 3, 4, 1, 1, 1], [[0, 1, 6, 1]]],
  7: [[0, 2, 0, 1, 0, 0], [1, 3, 1, 2, 1, 1], [[0, 1, 6, 1]]],
  maj7: [
    [0, 2, 1, 1, 0, 0],
    [1, 3, 2, 2, 1, 1],
    [
      [0, 1, 6, 1],
      [1, 3, 4, 2],
    ],
  ],
  m7: [[0, 2, 0, 0, 0, 0], [1, 3, 1, 1, 1, 1], [[0, 1, 6, 1]]],
};
const popular = new Set([
  "C",
  "G",
  "Am",
  "F",
  "Dm",
  "Em",
  "D",
  "A",
  "E",
  "Bm",
  "Cmaj7",
  "D7",
  "E7",
  "A7",
]);
// Explicit open-shape designs, untransposed. F is a separate four-string shape.
const open = {
  C: [["x", 3, 2, 0, 1, 0], [0, 3, 2, 0, 1, 0], []],
  G: [[3, 2, 0, 0, 0, 3], [2, 1, 0, 0, 0, 3], []],
  Am: [["x", 0, 2, 2, 1, 0], [0, 0, 2, 3, 1, 0], []],
  Dm: [["x", "x", 0, 2, 3, 1], [0, 0, 0, 2, 3, 1], []],
  Em: [[0, 2, 2, 0, 0, 0], [0, 2, 3, 0, 0, 0], []],
  F: [["x", "x", 3, 2, 1, 1], [0, 0, 3, 2, 1, 1], [[1, 1, 2, 1]]],
};
const pc = (n) => ((n % 12) + 12) % 12;
const diagram = (template, rootFret) => {
  const [offsets, fingers, barres] = template;
  const frets = offsets.map((n) => (n === "x" ? n : n + rootFret));
  return {
    startFret: Math.max(
      1,
      Math.min(...frets.filter((f) => typeof f === "number" && f > 0)),
    ),
    fretCount: 5,
    strings: frets
      .map((fret, i) => ({ string: 6 - i, fret, finger: fingers[i] || null }))
      .reverse(),
    barres: barres.map(([fret, minString, maxString, finger]) => ({
      fret: fret + rootFret,
      minString,
      maxString,
      finger,
    })),
  };
};
const movable = (template, rootPc, openPc) => {
  let fret = pc(rootPc - openPc);
  const minimum = Math.min(...template[0].filter((f) => typeof f === "number"));
  while (fret + minimum < 1) fret += 12;
  return diagram(template, fret);
};
const spellings = (rootPc) =>
  [..."CDEFGAB"].flatMap((letter, i) =>
    [-2, -1, 0, 1, 2]
      .filter((n) => pc([0, 2, 4, 5, 7, 9, 11][i] + n) === rootPc)
      .map((n) => letter + (n < 0 ? "b".repeat(-n) : "#".repeat(n))),
  );
const items = roots.flatMap((root, rootPc) =>
  Object.entries(suffixes).map(([quality, suffix]) => {
    const name = root + suffix;
    const voicings = [
      {
        id: "a-closed-01",
        label:
          quality === "add9" ? "五弦根音 · 四音伸展" : "五弦根音 · 封闭指型",
        bassPc: rootPc,
        diagram: movable(aTemplates[quality], rootPc, 9),
      },
    ];
    if (popular.has(name))
      voicings.push({
        id: "e-closed-01",
        label: "六弦根音 · 封闭指型",
        bassPc: rootPc,
        diagram: movable(eTemplates[quality], rootPc, 4),
      });
    if (open[name])
      voicings.push({
        id: name === "F" ? "d-compact-01" : "open-01",
        label: name === "F" ? "四弦根音 · 小横按" : "开放指型",
        bassPc: rootPc,
        diagram: diagram(open[name], 0),
      });
    return {
      id: `pc:${rootPc}/${quality}`,
      rootPc,
      quality,
      name,
      aliases: [
        ...new Set(
          spellings(rootPc).flatMap((s) => aliases[quality].map((a) => s + a)),
        ),
      ].filter((n) => n !== name),
      defaultVoicingId: "a-closed-01",
      voicings,
    };
  }),
);
const catalog = {
  format: "lxm-chord-catalog",
  formatVersion: 1,
  dataVersion: version,
  tuningId: "guitar-standard",
  items,
};
const manifest = {
  format: "lxm-chord-catalog-manifest",
  formatVersion: 1,
  dataVersion: version,
  catalogUrl: `./catalog-${version}.json`,
};
const serialized = JSON.stringify(catalog, null, 2) + "\n";
const destination = `${target}catalog-${version}.json`;
const auditDestination = fileURLToPath(
  new URL(
    "../../../docs/design-v2/records/20261111_chord-catalog-data-audit.json",
    import.meta.url,
  ),
);
const audit =
  JSON.stringify(
    {
      dataVersion: version,
      reviewer: "Codex algorithmic/template review",
      humanAudition: "pending — no physical guitar audition performed",
      releasePlayabilitySignoff: "pending human audition",
      identityCount: items.length,
      voicingCount: items.reduce((n, i) => n + i.voicings.length, 0),
      aliasesCountedAsIdentities: false,
      evidence: items.flatMap((item) =>
        item.voicings.map((voicing) => {
          const midiByString = voicing.diagram.strings.map((s) =>
            s.fret === "x"
              ? null
              : [64, 59, 55, 50, 45, 40][s.string - 1] + s.fret,
          );
          const midi = midiByString.filter((n) => n !== null);
          const frets = voicing.diagram.strings.flatMap((s) =>
            typeof s.fret === "number" && s.fret > 0 ? [s.fret] : [],
          );
          return {
            identityId: item.id,
            voicingId: voicing.id,
            template: voicing.id,
            midiByString,
            intervals: [...new Set(midi.map((n) => pc(n - item.rootPc)))].sort(
              (a, b) => a - b,
            ),
            bassMidi: Math.min(...midi),
            bassPc: pc(Math.min(...midi)),
            rootBass: pc(Math.min(...midi)) === item.rootPc,
            pressedFretSpan: Math.max(...frets) - Math.min(...frets) + 1,
            fingers: [
              ...new Set(
                voicing.diagram.strings.flatMap((s) =>
                  s.finger === null ? [] : [s.finger],
                ),
              ),
            ].sort(),
            humanAudition: "pending",
          };
        }),
      ),
    },
    null,
    2,
  ) + "\n";
if (process.argv.includes("--write")) {
  mkdirSync(target, { recursive: true });
  if (
    existsSync(destination) &&
    readFileSync(destination, "utf8") !== serialized
  )
    throw new Error(
      "Immutable catalog differs: publish a NEW dataVersion instead",
    );
  writeFileSync(destination, serialized);
  writeFileSync(
    `${target}manifest.json`,
    JSON.stringify(manifest, null, 2) + "\n",
  );
  writeFileSync(auditDestination, audit);
} else {
  if (
    readFileSync(destination, "utf8") !== serialized ||
    readFileSync(`${target}manifest.json`, "utf8") !==
      JSON.stringify(manifest, null, 2) + "\n"
  )
    throw new Error("Generated catalog/manifest do not match repository data");
  if (readFileSync(auditDestination, "utf8") !== audit)
    throw new Error("Generated audit does not match repository data");
}
console.log(
  `${items.length} identities, ${items.reduce((n, i) => n + i.voicings.length, 0)} voicings; deterministic data ${process.argv.includes("--write") ? "generated" : "verified"}. Run chord-catalog.test.ts for full schema/harmony validation.`,
);
