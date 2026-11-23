import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadDocument } from "@liuxianmao/lxm-editor";
import ideal from "../../../packages/lxm-editor/example/ideal-score.lxm.json";
import { PlaybackSession } from "../components/EditorShell/playback/controller";

const audio = vi.hoisted(() => ({
  unlock: vi.fn(async () => {}),
  prepare: vi.fn(async () => {}),
  start: vi.fn(),
  currentTick: vi.fn(() => 0),
  stop: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("../components/EditorShell/playback/engine", () => ({
  ScoreAudioEngine: class {
    constructor() {
      return audio;
    }
  },
}));
vi.mock("../components/EditorShell/chords/chord-catalog-resource", () => ({
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
    await session.togglePlay(doc, null);
    expect(audio.start.mock.lastCall?.[1]).toBe(20);
    session.stop();
    session.setBpm(140);
    await session.togglePlay(doc, null);
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
    const old = session.togglePlay(doc, null);
    await vi.waitFor(() => expect(audio.prepare).toHaveBeenCalledTimes(1));
    await session.togglePlay(doc, null);
    expect(audio.unlock).toHaveBeenCalledTimes(1);
    session.stop();
    session.setBpm(144);
    await session.togglePlay(doc, null);
    finishOld();
    await old;
    expect(audio.start).toHaveBeenCalledTimes(1);
    expect(audio.start.mock.calls[0]?.[1]).toBe(144);
    expect(session.snapshot().phase).toBe("playing");
  });

  it("preserves playback across display edits and invalidates paused audio on capo edits", async () => {
    const session = enabled();
    const doc = documentFixture();
    await session.togglePlay(doc, null);
    doc.score.title += " 改名";
    const symbol = doc.score.tracks[0]!.measures.flatMap(
      (m) => m.chordSymbols,
    )[0]!;
    symbol.display = symbol.display === "name" ? "nameAndDiagram" : "name";
    session.documentChanged(doc);
    expect(session.snapshot().phase).toBe("playing");
    audio.currentTick.mockReturnValue(1500);
    session.pause();
    await session.togglePlay(doc, null);
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
    await session.togglePlay(doc, null);
    expect(session.snapshot().phase).toBe("error");
    await session.togglePlay(doc, null);
    session.suspendFollow();
    expect(session.snapshot().follow).toBe(false);
    session.stop();
    expect(session.snapshot().follow).toBe(true);
    session.setFollow(false);
    session.stop();
    expect(session.snapshot().follow).toBe(false);
  });
});
