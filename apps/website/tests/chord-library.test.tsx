import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CURRENT_SCHEMA_VERSION,
  SCORE_DOCUMENT_SCHEMA,
  STANDARD_GUITAR_TUNING,
  parseChordCatalog,
  queryChordCatalog,
  type ILXMDocument,
} from "@liuxianmao/lxm-editor";
import { ChordLibraryModal } from "../components/EditorShell/chords/ChordLibraryModal";
import {
  ChordPresetControls,
  resolveChordReference,
  selectedCatalogChord,
  standardChordTuning,
} from "../components/EditorShell/chords/ChordPresetControls";
import { createDefaultChordPreferences } from "../components/EditorShell/chords/chord-preferences";
import type { ChordDraft } from "../components/EditorShell/chords/ChordEditor";

const state = vi.hoisted(() => ({
  snapshot: {
    status: "ready",
    catalog: null as unknown,
    error: null as string | null,
  },
}));
vi.mock("../components/EditorShell/chords/chord-catalog-resource", () => ({
  chordCatalogResource: {
    getSnapshot: () => state.snapshot,
    subscribe: () => () => {},
    ensureLoaded: async () => {},
    retry: async () => {},
  },
}));
const parsed = parseChordCatalog(
  JSON.parse(
    readFileSync(
      new URL(
        "../public/assets/chords/catalog-2026.11.11.1.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ),
);
if (!parsed.ok) throw new Error(parsed.error);
const catalog = parsed.catalog;
state.snapshot.catalog = catalog;
const committed = (
  tonic: string | null = "C",
  mode: "major" | "minor" = "major",
  signature: ILXMDocument["score"]["keySignature"] = "C",
): ILXMDocument => ({
  schema: SCORE_DOCUMENT_SCHEMA,
  schemaVersion: CURRENT_SCHEMA_VERSION,
  documentRevision: 0,
  score: {
    id: "score",
    title: "song",
    arranger: "",
    keySignature: signature,
    tracks: [],
    meta: tonic
      ? {
          "lxm:tonality":
            mode === "major"
              ? { version: 1, tonic, mode }
              : { version: 1, tonic, mode, minorTonicDegree: 6 },
        }
      : {},
  },
});
const draft: ChordDraft = {
  display: "name",
  chord: { name: "Bm", diagram: null },
};
describe("和弦库与两处入口", () => {
  it("刷新失败保留已有目录和可浏览候选，重试时仍可继续选用", () => {
    try {
      state.snapshot = {
        status: "error",
        catalog,
        error: "更新失败，继续使用已加载的和弦库",
      };
      const props = {
        draft,
        document: committed(),
        presetsEnabled: true,
        initialTab: "all" as const,
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      };
      const failed = renderToStaticMarkup(<ChordLibraryModal {...props} />);
      expect(failed).toContain("更新失败，继续使用已加载的和弦库");
      expect(failed).toContain("和弦候选");
      expect(failed).toContain("Cmaj7");
      expect(failed).toMatch(/重\s*试/);
      expect(
        resolveChordReference(
          createDefaultChordPreferences().quickItems[0]!,
          catalog,
          [],
          undefined,
          true,
        ).chord,
      ).not.toBeNull();
      state.snapshot = { status: "loading", catalog, error: null };
      const retrying = renderToStaticMarkup(<ChordLibraryModal {...props} />);
      expect(retrying).toContain("Cmaj7");
      expect(retrying).not.toContain("和弦库暂不可用");
    } finally {
      state.snapshot = { status: "ready", catalog, error: null };
    }
  });
  it("默认六个引用全部解析 JSON 目录，复制图形不共享目录数组", () => {
    for (const ref of createDefaultChordPreferences().quickItems) {
      const result = resolveChordReference(
        ref,
        catalog,
        [],
        STANDARD_GUITAR_TUNING,
        true,
      );
      expect(result.reason).toBeNull();
      expect(result.chord?.diagram).toBeDefined();
      const original = catalog.items
        .find((item) => item.id === ref.identityId)!
        .voicings.find((v) => v.id === ref.defaultVoicingId)!.diagram;
      expect(result.chord?.diagram?.strings).not.toBe(original.strings);
    }
  });
  it("非标准 pitch、MIDI 和错位弦号暂停系统选用，但能读取独立收藏", () => {
    const tuning: { index: number; pitch: string; midi: number }[] =
      STANDARD_GUITAR_TUNING.map((s) => ({ ...s }));
    tuning[5]!.midi = 38;
    tuning[5]!.pitch = "D2";
    expect(standardChordTuning(tuning)).toBe(false);
    expect(
      standardChordTuning(
        STANDARD_GUITAR_TUNING.map((s) => ({ ...s, index: 6 })),
      ),
    ).toBe(false);
    expect(
      resolveChordReference(
        createDefaultChordPreferences().quickItems[0]!,
        catalog,
        [],
        tuning,
        true,
      ).chord,
    ).toBeNull();
    const diagram = structuredClone(catalog.items[0]!.voicings[0]!.diagram);
    const custom = {
      id: "user:00000000-0000-4000-8000-000000000001",
      voicingId: "my-shape",
      name: "我的自由名",
      diagram,
      tuning,
    };
    const ref = { identityId: custom.id, defaultVoicingId: custom.voicingId };
    expect(
      resolveChordReference(ref, null, [custom], tuning, false).chord?.name,
    ).toBe(custom.name);
    expect(
      resolveChordReference(
        ref,
        catalog,
        [custom],
        STANDARD_GUITAR_TUNING,
        true,
      ).chord,
    ).toBeNull();
  });
  it("未载入不误报已移除，已载入失效引用不替换其他指法", () => {
    const ref = { identityId: "pc:0/major", defaultVoicingId: "missing" };
    expect(
      resolveChordReference(ref, null, [], undefined, true).reason,
    ).toContain("等待和弦库");
    expect(resolveChordReference(ref, catalog, [], undefined, true)).toEqual({
      chord: null,
      reason: "该预置已移除",
    });
  });
  it("按调性拼写复制 voicing，两个副本可以独立编辑", () => {
    const match = queryChordCatalog(catalog, {
      key: { tonicPc: 6, tonicSpelling: "Gb", mode: "major" },
    }).items.find((m) => m.name === "Cb")!;
    const a = selectedCatalogChord(catalog, match),
      b = selectedCatalogChord(catalog, match);
    expect(a.ok && a.chord.name).toBe("Cb");
    if (a.ok && b.ok) {
      a.chord.diagram.strings[0]!.fret = "x";
      expect(b.chord.diagram.strings[0]!.fret).not.toBe("x");
    }
  });
  it("库只展示暂存候选，初次渲染不回填父草稿，不自行创建 Modal", () => {
    const onConfirm = vi.fn(),
      onCustom = vi.fn();
    const before = structuredClone(draft);
    const html = renderToStaticMarkup(
      <ChordLibraryModal
        draft={draft}
        document={committed()}
        presetsEnabled
        initialTab="all"
        onConfirm={onConfirm}
        onCancel={() => {}}
        onOpenCustom={onCustom}
      />,
    );
    expect(html).toContain("按调性");
    expect(html).toContain("我的指法");
    expect(html).toContain("常用配置");
    expect(html).toContain("选用此指法");
    expect(html).toContain("尚未改变当前草稿");
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("ant-modal");
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCustom).not.toHaveBeenCalled();
    expect(draft).toEqual(before);
  });
  it("跟随当前已提交 A 小调，旧谱只有基准时不猜大调", () => {
    const props = {
      draft,
      presetsEnabled: true,
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
    };
    const minor = renderToStaticMarkup(
      <ChordLibraryModal {...props} document={committed("A", "minor")} />,
    );
    expect(minor).toContain("曲谱 A小调");
    expect(minor).toContain("和声小调补充");
    const legacy = renderToStaticMarkup(
      <ChordLibraryModal {...props} document={committed(null, "major", "G")} />,
    );
    expect(legacy).toContain("大小调未确认");
    expect(legacy).toContain("暂停本调推荐");
    expect(legacy).not.toContain("曲谱 G大调");
  });
  it("固定更多、我的常用与全库加载来自同一资源，名称 Bm 不替换入口文字", () => {
    const onChange = vi.fn();
    const html = renderToStaticMarkup(
      <ChordPresetControls
        draft={draft}
        document={committed()}
        presetsEnabled
        onChange={onChange}
      />,
    );
    expect(html).toContain("更多 ⌄");
    expect(html).toContain("我的常用");
    expect(html).not.toContain("和弦库加载中");
    expect(onChange).not.toHaveBeenCalled();
  });
  it("配置与收藏在没有 HTTP 目录时也保留可操作页面", () => {
    state.snapshot = { status: "error", catalog: null, error: "offline" };
    const html = renderToStaticMarkup(
      <ChordLibraryModal
        draft={draft}
        document={committed()}
        presetsEnabled
        initialTab="config"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(html).toContain("导入 JSON 预览");
    expect(html).toContain("导出已保存配置");
    expect(html).toContain("保存常用配置");
    state.snapshot = { status: "ready", catalog, error: null };
  });
});
