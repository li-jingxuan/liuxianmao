# Chord catalog 2026.11.11.1: data and template audit

This record covers `apps/website/public/assets/chords/catalog-2026.11.11.1.json` and its manifest. Review performed by Codex consists of template/code inspection and executable structural, pitch, bass, coverage and reference checks. **No person has physically played or auditioned these 212 voicings as part of this implementation. Human playability signoff remains pending.** This record must not be represented as completing the design's human audition requirement.

The adjacent `20261111_chord-catalog-data-audit.json` links every identity/voicing to this dataVersion, its sounding MIDI pitches in string 1→6 order, actual intervals, lowest MIDI/bass pitch class, fret span and assigned fingers. Every human-audition field is explicitly pending. Runtime acceptance verifies computable musical facts and does not constitute human signoff.

## Coverage and reproducibility

There are 192 identities (12 pitch classes × 16 qualities), 212 distinct voicings, and zero name-only identities. Enharmonic aliases do not increase the identity count. Each identity has a closed movable five-string-root shape. All 212 shapes have root-position actual bass. Ninth and minor-ninth templates are checked against the explicit formula with only the fifth optional; thirds, sevenths, ninths and roots remain mandatory. Open strings only occur in explicitly authored, untransposed open shapes.

The popular list is C, G, Am, F, Dm, Em (three distinct shapes each) and D, A, E, Bm, Cmaj7, D7, E7, A7 (two each). All other identities have one shape. Per-quality voicing totals: major 21; m 19; 7 15; maj7 13; m7, dim, dim7, m7b5, aug, sus2, sus4, add9, 6, m6, 9 and m9 each 12. Tests reject identical fret sequences used to inflate counts.

Generate with `node packages/lxm-editor/scripts/generate-chord-catalog.mjs --write`; verify reproducibility without writing with the same command omitting `--write`. The generator refuses to overwrite differing content at the same immutable data filename. Corrections require a new dataVersion/file and manifest pointer; retain previous version files.

Run `pnpm exec vitest run packages/lxm-editor/tests/core/chord-catalog.test.ts apps/website/tests/chord-catalog-resource.test.ts`. These tests validate the published JSON through public parsing/query/copy APIs and resource loading APIs, including strict schema, complete coverage, stable pair references, explicit aliases, deep copies, diatonic spelling (including Gb minor), formulas, lowest-pitch bass, HTTP failure and stale requests.

## Closed-template inspection

The generator documents each shape in low-E→high-E order, with offsets from an A-string root fret. All sounding frets are strictly positive after transposition. Minimum root fret is raised by an octave when a negative offset would reach an open/missing fret. This is deliberate closed-shape placement, not transposition of an open chord. Geometry is identical across the twelve transpositions; the absolute position and practical stretch still need audition.

- Major/minor/seventh/major-seventh/minor-seventh: conventional A-family closed shapes with index barre and explicit independent fingers. The major shape uses an additional ring-finger barre. Popular alternatives use E-family closed shapes with a six-string index barre. The E-family major-seventh has a separate middle-finger mini-barre.
- Diminished: four adjacent middle strings, independent fingers, three-fret span. Diminished seventh: four middle strings, three-fret span, independent fingers. Half diminished: index mini-barre across strings 3–5, with middle/ring fingers above it.
- Augmented: four middle strings, three-fret span, index mini-barre on strings 2–3, middle/ring fingers on the two bass strings. Its third/fifth spelling is inferred only by the explicit formula, not by the shape's visual similarity to another chord.
- Suspended second/fourth: index barre plus ring mini-barre over the two middle strings; suspended fourth adds the little finger. Sixth: ring barre across strings 1–4, index root. Minor sixth: ring mini-barre on strings 3–4 plus separate middle/little fingers on the treble strings.
- Added ninth: four middle strings with independent index/middle/ring/little fingers, four-fret span. This is the most notable stretch candidate and requires targeted human audition, especially at lower positions and for smaller hands.
- Ninth/minor ninth: index third, middle root, ring mini-barre over strings 1–3; standard root/third/seventh/ninth voice structure with optional fifth on high E. Minor ninth spans three frets, dominant ninth two. Actual bass is computed from MIDI rather than assumed from lowest numbered sounding string.
- Additional open C/G/Am/Dm/Em and compact four-string F are explicit hand-authored shapes. No root transposition is applied to them. The compact F includes an explicit two-string index barre.

Structural verification covers the shared diagram schema, start/window/span, positive closed frets, 1–6 string ordering, at most four fingers, explicit barres for repeated fingers, mute/open correctness, barre conflicts and distinct fret sequences. The root-bass formula check uses E4/B3/G3/D3/A2/E2 MIDI + actual fret. This review establishes candidate consistency, not comfort or sound quality.

## Remaining release audit

A guitarist must physically audition every template and its practical positions, record reviewer/date/outcome per identity/voicing/dataVersion (the machine-readable evidence supplies the keys), and resolve failed or uncomfortable shapes in a new data version. Pay particular attention to add9 stretches, ring-finger mini-barres with a lower high-E note in the major shape, low-position minor ninth and transitions between adjacent fingerings. Until that happens, the 192 identities are algorithmically validated candidate coverage; the design's full human-reviewed delivery gate is not met.

No external storage, third-party chord data service, API route, account or deployment service is introduced. Website static assets supply the manifest and immutable JSON over same-origin HTTP. Cache header customization is left to existing hosting configuration; the resource requests manifest revalidation and normal HTTP caching of version files.
