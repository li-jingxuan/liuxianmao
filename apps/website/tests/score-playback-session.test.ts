import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadDocument } from "@liuxianmao/lxm-editor";
import ideal from "../../../packages/lxm-editor/example/ideal-score.lxm.json";
import { PlaybackSession } from "../../../packages/lxm-editor-react/src/EditorShell/playback/controller";

const audio = vi.hoisted(() => ({
  unlock: vi.fn(async () => {}),
  prepare: vi.fn(async () => {}),
  start: vi.fn(),
  currentTick: vi.fn(() => 0),
  hasStarted: vi.fn(() => true),
  setClickEnabled: vi.fn((enabled: boolean) => enabled ? 960 : Infinity),
  setClickAccent: vi.fn(),
  changeTempo: vi.fn(),
  stop: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("../../../packages/lxm-editor-react/src/EditorShell/playback/engine", () => ({
  ScoreAudioEngine: class {
    constructor() {
      return audio;
    }
  },
}));
vi.mock("../../../packages/lxm-editor-react/src/EditorShell/chords/chord-catalog-resource", () => ({
  chordCatalogResource: {
    ensureLoaded: vi.fn(async () => {}),
    getSnapshot: () => ({ catalog: null }),
  },
}));

function documentFixture() {
  const result = loadDocument(JSON.stringify(ideal));
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.document;
}
function enabled() {
  const session = new PlaybackSession();
  session.setEnabled(true);
  return session;
}
beforeEach(() => {
  vi.clearAllMocks();
  audio.currentTick.mockReturnValue(0);
  audio.hasStarted.mockReturnValue(true);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe("score playback session", () => {
  it("从曲谱速度开始，临时调速只在当前试听会话有效", async () => {
    const session = enabled();
    const doc = documentFixture();
    doc.score.tempoBpm = 20;
    doc.score.showTempoMark = false;
    await session.togglePlay(doc);
    expect(audio.start.mock.lastCall?.[1]).toBe(20);
    session.stop();
    session.setBpm(140);
    await session.togglePlay(doc);
    expect(audio.start.mock.lastCall?.[1]).toBe(140);
    expect(doc.score.tempoBpm).toBe(20);
    session.stop();
    session.resetBpm();
    expect(session.snapshot().bpm).toBe(20);
    session.setBpm(110);
    session.setEnabled(false);
    session.setEnabled(true);
    expect(session.snapshot().bpm).toBe(20);
    delete doc.score.tempoBpm;
    session.documentChanged(doc);
    expect(session.snapshot()).toMatchObject({ savedBpm: null, bpm: 90 });
  });
  it("ignores a late preparation after stopping and starting another performance", async () => {
    const session = enabled();
    const doc = documentFixture();
    let finishOld!: () => void;
    audio.prepare.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    );
    const old = session.togglePlay(doc);
    await vi.waitFor(() => expect(audio.prepare).toHaveBeenCalledTimes(1));
    await session.togglePlay(doc);
    expect(audio.unlock).toHaveBeenCalledTimes(1);
    session.stop();
    session.setBpm(144);
    await session.togglePlay(doc);
    finishOld();
    await old;
    expect(audio.start).toHaveBeenCalledTimes(1);
    expect(audio.start.mock.calls[0]?.[1]).toBe(144);
    expect(session.snapshot().phase).toBe("playing");
  });

  it("preserves playback across display edits and invalidates paused audio on capo edits", async () => {
    const session = enabled();
    const doc = documentFixture();
    await session.togglePlay(doc);
    doc.score.title += " 改名";
    const symbol = doc.score.tracks[0]!.measures.flatMap(
      (m) => m.chordSymbols,
    )[0]!;
    symbol.display = symbol.display === "name" ? "nameAndDiagram" : "name";
    session.documentChanged(doc);
    expect(session.snapshot().phase).toBe("playing");
    audio.currentTick.mockReturnValue(1500);
    session.pause();
    await session.togglePlay(doc);
    expect(audio.start.mock.lastCall?.[2]).toBe(1500);
    session.pause();
    doc.score.tracks[0]!.capo++;
    session.documentChanged(doc);
    expect(session.snapshot()).toMatchObject({
      phase: "idle",
      enabled: true,
      position: null,
      message: "谱面已更新，请重新播放",
    });
  });

  it("restores temporary follow and retries failed audio initialization", async () => {
    const session = enabled();
    const doc = documentFixture();
    audio.unlock.mockRejectedValueOnce(new Error("解码失败"));
    await session.togglePlay(doc);
    expect(session.snapshot().phase).toBe("error");
    await session.togglePlay(doc);
    session.suspendFollow();
    expect(session.snapshot().follow).toBe(false);
    session.stop();
    expect(session.snapshot().follow).toBe(true);
    await session.togglePlay(doc);
    expect(session.snapshot().follow).toBe(true);
  });

  it("从选定小节起播，播放期间锁定起点，停播可切回谱首", async () => {
    const session = enabled();
    const doc = documentFixture();
    const [first, second] = doc.score.tracks[0]!.measures;
    session.setStartMeasure(second!.id);
    await session.togglePlay(doc);
    expect(audio.start.mock.lastCall?.[0].visits[0].measureId).toBe(second!.id);
    session.setStartMeasure(first!.id);
    session.pause();
    session.setStartMeasure(null);
    expect(session.snapshot().startMeasureId).toBe(second!.id);
    session.stop();
    expect(session.snapshot().startMeasureId).toBe(second!.id);
    session.setStartMeasure(null);
    await session.togglePlay(doc);
    expect(audio.start.mock.lastCall?.[0].visits[0].measureId).toBe(first!.id);
  });

  it("joins mid-performance on the next beat and freezes or clears it with transport", async () => {
    const session = enabled();
    const doc = documentFixture();
    doc.score.tracks[0]!.measures[0]!.timeSignature = { numerator: 4, denominator: 4 };
    await session.togglePlay(doc);
    expect(audio.start.mock.lastCall?.[3]).toMatchObject({ enabled: true });
    expect(session.snapshot()).toMatchObject({ clickEnabled: true, clickBeat: 1 });
    const raf = vi.mocked(requestAnimationFrame);
    const paint = () => raf.mock.lastCall![0](0);
    audio.currentTick.mockReturnValue(450);
    session.setClickEnabled(false);
    expect(session.snapshot()).toMatchObject({ phase: "playing", clickBeat: null });
    session.setClickEnabled(true);
    paint();
    expect(session.snapshot().clickBeat).toBeNull();
    audio.currentTick.mockReturnValue(1020);
    paint();
    expect(session.snapshot().clickBeat).toBe(2);
    session.setBpm(120);
    expect(audio.changeTempo.mock.lastCall?.[1]).toBe(120);
    session.pause();
    expect(session.snapshot()).toMatchObject({ phase: "paused", clickBeat: 2 });
    audio.hasStarted.mockReturnValue(false);
    await session.togglePlay(doc);
    expect(audio.start.mock.lastCall?.[2]).toBe(1020);
    expect(audio.start.mock.lastCall?.[3]).toMatchObject({ enabled: true, skipOnset: true });
    expect(session.snapshot().clickBeat).toBe(2);
    session.setClickEnabled(false);
    expect(session.snapshot()).toMatchObject({ phase: "playing", clickBeat: null });
    session.setClickEnabled(true);
    session.stop();
    expect(session.snapshot()).toMatchObject({ phase: "idle", clickBeat: null, clickEnabled: true });
    session.setClickEnabled(false);
    session.setEnabled(false);
    session.setEnabled(true);
    expect(session.snapshot().clickEnabled).toBe(true);
  });

  it("uses current BPM after loading and resets click settings on actual file replacement", async () => {
    const session = enabled();
    const doc = documentFixture();
    session.documentChanged(doc, "original");
    session.setClickAccent(false);
    session.setStartMeasure(doc.score.tracks[0]!.measures[1]!.id);
    let resolve!: () => void;
    audio.prepare.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const play = session.togglePlay(doc);
    await vi.waitFor(() => expect(audio.prepare).toHaveBeenCalled());
    expect(session.snapshot()).toMatchObject({ phase: "loading", clickBeat: null });
    session.setBpm(120);
    resolve();
    await play;
    expect(audio.start.mock.lastCall?.[1]).toBe(120);
    expect(audio.start.mock.lastCall?.[3]).toMatchObject({ enabled: true, accent: false });
    session.setClickEnabled(false);
    session.documentChanged(doc, "reopened-same-file");
    expect(session.snapshot()).toMatchObject({ phase: "idle", startMeasureId: null, clickEnabled: true, clickBeat: null, clickAccent: true });
  });
});
