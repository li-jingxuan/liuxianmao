import type { PlaybackSound } from "@liuxianmao/lxm-editor";

interface Sample {
  file: string;
  midi: number;
  velocity: number;
}

export interface DecodedGuitarSample {
  buffer: AudioBuffer;
  midi: number;
}

const STRING_NAMES = ["HighE", "B", "G", "D", "A", "LowE"];
const PITCH_CLASSES = new Map([
  ["C", 0],
  ["D", 2],
  ["E", 4],
  ["F", 5],
  ["G", 7],
  ["A", 9],
  ["B", 11],
]);
const FILE_PATTERN =
  /^INSGuitarSteel_String(HighE|B|G|D|A|LowE)_Vel0([123])_([A-G])(s?)(\d)_01\.wav$/;
const MAX_CONCURRENT_DOWNLOADS = 6;
const CACHE_BYTES = 64 * 1024 * 1024;

function velocityLayer({
  attack,
  pickStroke,
  envelope,
}: PlaybackSound): number {
  if (
    attack !== "pluck" ||
    envelope.decaySeconds !== null ||
    envelope.highpassHz != null
  )
    return 1;
  return pickStroke === "down" ? 3 : 2;
}

export function guitarSampleKey(sound: PlaybackSound): string {
  return `${sound.string}:${sound.midi}:${velocityLayer(sound)}`;
}

function sampleIndex(value: unknown): ReadonlyMap<number, readonly Sample[]> {
  if (
    !value ||
    typeof value !== "object" ||
    !("samples" in value) ||
    !Array.isArray(value.samples)
  )
    throw new Error("木吉他音源清单格式无效");

  const strings = new Map<number, Sample[]>();
  for (const entry of value.samples as unknown[]) {
    if (
      !entry ||
      typeof entry !== "object" ||
      !("file" in entry) ||
      typeof entry.file !== "string"
    )
      throw new Error("木吉他音源清单条目无效");
    const match = FILE_PATTERN.exec(entry.file);
    if (!match) continue;
    const string = STRING_NAMES.indexOf(match[1]!) + 1;
    const midi =
      (Number(match[5]) + 1) * 12 +
      PITCH_CLASSES.get(match[3]!)! +
      Number(match[4] === "s");
    const sample = {
      file: entry.file.slice(0, -4),
      midi,
      velocity: Number(match[2]),
    };
    const samples = strings.get(string);
    if (samples) samples.push(sample);
    else strings.set(string, [sample]);
  }
  if (!strings.size) throw new Error("木吉他音源清单没有可用采样");
  for (const samples of strings.values())
    samples.sort((a, b) => a.midi - b.midi);
  return strings;
}

function nearestSample(
  samples: readonly Sample[],
  sound: PlaybackSound,
): Sample | undefined {
  const velocity = velocityLayer(sound);
  const expectedLayer = samples.filter(
    (sample) => sample.velocity === velocity,
  );
  let nearest: Sample | undefined;
  for (const sample of expectedLayer.length ? expectedLayer : samples) {
    if (
      !nearest ||
      Math.abs(sample.midi - sound.midi) < Math.abs(nearest.midi - sound.midi)
    )
      nearest = sample;
  }
  return nearest;
}

export class GuitarSampleBank {
  private index: ReadonlyMap<number, readonly Sample[]> | null = null;
  private readonly decoded = new Map<string, DecodedGuitarSample>();
  private decodedBytes = 0;
  private codec: "ogg" | "m4a" = "ogg";

  constructor(
    private readonly context: AudioContext,
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
    private readonly basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "",
  ) {}

  async load(
    sounds: readonly PlaybackSound[],
    signal: AbortSignal,
  ): Promise<ReadonlyMap<string, DecodedGuitarSample>> {
    signal.throwIfAborted();
    if (!sounds.length) return new Map();

    const base = `${this.basePath}/assets/audio/meta-steel-guitar-v1`;
    if (!this.index) {
      const manifest = await this.fetcher(`${base}/manifest.json`, {
        signal,
        redirect: "error",
      });
      if (!manifest.ok)
        throw new Error(`木吉他音源清单加载失败（HTTP ${manifest.status}）`);
      const index = sampleIndex(await manifest.json());
      signal.throwIfAborted();
      this.index = index;
    }

    const required = new Map<string, { sample: Sample; keys: string[] }>();
    const selected = new Set<string>();
    for (const sound of sounds) {
      const key = guitarSampleKey(sound);
      if (selected.has(key)) continue;
      selected.add(key);
      const sample = nearestSample(this.index.get(sound.string) ?? [], sound);
      if (!sample) throw new Error(`木吉他音源缺少第 ${sound.string} 弦采样`);
      const request = required.get(sample.file);
      if (request) request.keys.push(key);
      else required.set(sample.file, { sample, keys: [key] });
    }

    const result = new Map<string, DecodedGuitarSample>();
    const queue = required.values();
    const worker = async () => {
      for (const { sample, keys } of queue) {
        signal.throwIfAborted();
        let decoded = this.decoded.get(sample.file);
        if (decoded) {
          this.decoded.delete(sample.file);
          this.decoded.set(sample.file, decoded);
        } else {
          decoded = await this.loadSample(base, sample, signal);
          signal.throwIfAborted();
          this.cache(sample.file, decoded);
        }
        for (const key of keys) result.set(key, decoded);
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(MAX_CONCURRENT_DOWNLOADS, required.size) },
        worker,
      ),
    );
    signal.throwIfAborted();
    return result;
  }

  private async loadSample(
    base: string,
    sample: Sample,
    signal: AbortSignal,
  ): Promise<DecodedGuitarSample> {
    const decode = async (codec: "ogg" | "m4a") => {
      signal.throwIfAborted();
      const response = await this.fetcher(
        `${base}/${codec}/${sample.file}.${codec}`,
        { signal, redirect: "error" },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      signal.throwIfAborted();
      const buffer = await this.context.decodeAudioData(bytes);
      signal.throwIfAborted();
      return { buffer, midi: sample.midi };
    };

    const codec = this.codec;
    try {
      return await decode(codec);
    } catch {
      signal.throwIfAborted();
      try {
        const fallback = codec === "ogg" ? "m4a" : "ogg";
        const decoded = await decode(fallback);
        this.codec = fallback;
        return decoded;
      } catch (error) {
        signal.throwIfAborted();
        throw new Error("木吉他采样加载或解码失败，请重试", { cause: error });
      }
    }
  }

  private cache(file: string, decoded: DecodedGuitarSample): void {
    const bytes = (sample: DecodedGuitarSample) =>
      sample.buffer.length * sample.buffer.numberOfChannels * 4;
    this.decoded.set(file, decoded);
    this.decodedBytes += bytes(decoded);
    while (this.decodedBytes > CACHE_BYTES) {
      const oldest = this.decoded.entries().next().value;
      if (!oldest) break;
      this.decoded.delete(oldest[0]);
      this.decodedBytes -= bytes(oldest[1]);
    }
  }
}
