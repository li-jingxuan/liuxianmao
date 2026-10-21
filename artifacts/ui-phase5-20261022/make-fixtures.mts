import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const output = path.resolve("artifacts/ui-phase5-20261022");
const source = JSON.parse(
  await readFile(
    path.resolve("artifacts/ui-phase3-20261018/fixture.lxm.json"),
    "utf8",
  ),
);

const cloneIds = (template: unknown, prefix: string) => {
  const clone = structuredClone(template);
  const ids = new Map<string, string>();
  const rename = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(rename);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (typeof record.id === "string") {
      const next = `${prefix}-${record.id}`;
      ids.set(record.id, next);
      record.id = next;
    }
    Object.values(record).forEach(rename);
  };
  const remap = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(remap);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    for (const [key, item] of Object.entries(record)) {
      if (
        key !== "id" &&
        key.endsWith("Id") &&
        typeof item === "string" &&
        ids.has(item)
      )
        record[key] = ids.get(item);
      else remap(item);
    }
  };
  rename(clone);
  remap(clone);
  return clone;
};

const cloneMeasure = (template: unknown, repetition: number) => {
  // 首轮保留原 ID，使轨道级简谱记号仍指向真实事件。
  if (repetition === 0) return structuredClone(template);
  return cloneIds(template, `p5-${repetition}`);
};

const repeatMeasures = (count: number) => {
  const template = source.score.tracks[0].measures as unknown[];
  const measures = Array.from({ length: count }, (_, index) =>
    cloneMeasure(template[index % template.length], index),
  );
  return {
    ...structuredClone(source),
    documentRevision: count,
    score: {
      ...structuredClone(source.score),
      title: "阶段5固定验收谱",
      tracks: [
        { ...structuredClone(source.score.tracks[0]), measures },
        ...structuredClone(source.score.tracks.slice(1)),
      ],
    },
  };
};

type Beat = { tick: number };
type Cycle = {
  beats: Beat[];
  timeSignature: { numerator: number; denominator: number };
  numberedVoice: { events: Beat[] };
  lyrics: { id: string; beatId?: string }[];
};

/** 单小节远超 A4 正文宽度；首轮保留原 ID，供轨道级引用继续生效。 */
const widenMeasure = (measure: Cycle, cycles: number) => {
  const widened = structuredClone(measure);
  const beatStep = 960;
  const cycleTicks =
    Math.max(...measure.beats.map((beat) => beat.tick)) + beatStep;
  widened.timeSignature.numerator *= cycles;
  for (let cycle = 1; cycle < cycles; cycle += 1) {
    const copy = cloneIds(measure, `ov-${cycle}`) as Cycle;
    const shift = cycle * cycleTicks;
    copy.beats.forEach((beat) => (beat.tick += shift));
    copy.numberedVoice.events.forEach((event) => (event.tick += shift));
    widened.beats.push(...copy.beats);
    widened.numberedVoice.events.push(...copy.numberedVoice.events);
    widened.lyrics.push(...copy.lyrics);
  }
  return widened;
};

const overflow = repeatMeasures(4);
const overflowTrack = overflow.score.tracks[0];
overflowTrack.measures[0] = widenMeasure(
  overflowTrack.measures[0] as Cycle,
  12,
);
overflow.score.title = "阶段5超宽验收谱";

const write = (name: string, document: unknown) =>
  writeFile(path.join(output, name), JSON.stringify(document, null, 2) + "\n");

await Promise.all([
  write("fixture.lxm.json", repeatMeasures(54)),
  write("long-score.lxm.json", repeatMeasures(100)),
  write("overflow.lxm.json", overflow),
]);
console.log("wrote 54/100-measure and 48-beat overflow fixtures");
