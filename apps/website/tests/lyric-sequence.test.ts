import { describe, expect, it } from "vitest";
import {
  EXAMPLE_MVP_6_DOCUMENT,
  LXMScoreCommandEnum as C,
  parseLyricSequence,
  buildLayout,
} from "@liuxianmao/lxm-editor";
import { createEditorStore } from "../stores/editor-store";
import {
  readMusicTextDraft,
  resolveSidebarRequest,
} from "../components/EditorShell/music-text-draft";
import { resolveLyricFocus } from "../components/EditorShell/music-text-focus";

const fixture = () => {
  const document = structuredClone(EXAMPLE_MVP_6_DOCUMENT);
  const track = document.score.tracks[0]!;
  const m = track.measures[0]!;
  const target = {
    trackId: track.id,
    measureId: m.id,
    beatId: m.beats.at(-1)!.id,
    verse: 1 as const,
    kind: "lyric" as const,
    string: 1,
  };
  return { document, track, target };
};
describe("连续填词历史、草稿与歌词焦点", () => {
  it("跨小节批量成功一次历史，失败与同值无历史，整批撤销重做", () => {
    const { document, target } = fixture();
    const store = createEditorStore(document);
    const parsed = parseLyricSequence("风 _ 过 山");
    if (!parsed.ok) throw new Error(parsed.message);
    const command = {
      type: C.SetLyricSequence as const,
      ...target,
      items: parsed.items,
      allowOverwrite: false,
    };
    expect(store.getState().execute(command)?.ok).toBe(false);
    expect(store.getState().document).toBe(document);
    expect(store.getState().historyDepth.past).toBe(0);
    const permitted = { ...command, allowOverwrite: true };
    expect(store.getState().execute(permitted)?.ok).toBe(true);
    const saved = store.getState().document;
    expect(store.getState().historyDepth.past).toBe(1);
    expect(store.getState().execute(permitted)).toMatchObject({
      ok: true,
      changed: false,
    });
    expect(
      store.getState().execute({ ...permitted, beatId: "missing" })?.ok,
    ).toBe(false);
    expect(store.getState().historyDepth.past).toBe(1);
    store.getState().undo();
    expect(store.getState().document).toBe(document);
    store.getState().redo();
    expect(store.getState().document).toBe(saved);
  });
  it("换模式保护草稿，覆盖许可参与 dirty，换目标重置许可且不会携带输入", () => {
    const { document, track, target } = fixture();
    const single = readMusicTextDraft(document, target)!;
    expect(
      resolveSidebarRequest(single, { type: "mode", mode: "sequence" }),
    ).toBe("execute");
    single.text = "未保存";
    expect(
      resolveSidebarRequest(single, { type: "mode", mode: "sequence" }),
    ).toBe("confirm");
    const batch = readMusicTextDraft(document, target, "sequence")!;
    expect(batch.text).toBe("");
    batch.allowOverwrite = true;
    expect(resolveSidebarRequest(batch, { type: "close" })).toBe("confirm");
    const next = readMusicTextDraft(
      document,
      {
        ...target,
        measureId: track.measures[1]!.id,
        beatId: track.measures[1]!.beats[0]!.id,
      },
      "sequence",
    )!;
    expect(next.allowOverwrite).toBe(false);
    expect(next.text).toBe("");
  });
  it("只定位当前段真实歌词，重排后重新解析；空拍与和弦不产生假歌词框", () => {
    const { document, track, target } = fixture();
    const m = track.measures[0]!;
    m.lyrics = [1, 2, 3, 4].map((verse) => ({
      id: `verse-${verse}`,
      beatId: target.beatId,
      verse: verse as 1,
      text: `第${verse}段`,
    }));
    for (const showChordDiagrams of [true, false])
      for (const systemWidth of [733, 240]) {
        const layout = buildLayout(document, {
          showChordDiagrams,
          systemWidth,
        });
        const ys = [1, 2, 3, 4].map((verse) => {
          const focus = resolveLyricFocus(layout, {
            ...target,
            verse: verse as 1,
          });
          expect(focus?.id).toBe(`verse-${verse}`);
          return focus!.y;
        });
        expect(new Set(ys).size).toBe(4);
        expect(
          resolveLyricFocus(layout, { ...target, beatId: m.beats[0]!.id }),
        ).toBeNull();
        expect(
          resolveLyricFocus(layout, { ...target, kind: "chord" }),
        ).toBeNull();
        expect(resolveLyricFocus(layout, null)).toBeNull();
      }
  });
  it("开关布局不会修改 store 文档、历史或脏草稿", () => {
    const { document, target } = fixture();
    const store = createEditorStore(document);
    const draft = readMusicTextDraft(document, target)!;
    draft.text = "未应用";
    const before = structuredClone(draft);
    buildLayout(document, { showChordDiagrams: false });
    buildLayout(document, { showChordDiagrams: true });
    expect(store.getState().document).toBe(document);
    expect(store.getState().historyDepth.past).toBe(0);
    expect(draft).toEqual(before);
    expect(resolveSidebarRequest(draft, { type: "close" })).toBe("confirm");
  });
});
