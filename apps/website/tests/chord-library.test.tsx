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
import { quickChordMatches } from "../components/EditorShell/chords/chord-recommendations";

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
  it.each([committed(), committed(null)])("和弦库移除曲谱调性设置入口，保留临时调性浏览 %#", document => {
    const onOpenSettings = vi.fn();
    const html = renderToStaticMarkup(<ChordLibraryModal draft={draft} document={document} presetsEnabled
      onConfirm={vi.fn()} onCancel={vi.fn()} onOpenSettings={onOpenSettings} />);
    expect(html).not.toContain("设置曲谱调性");
    expect(html).not.toContain("设置调性");
    expect(html).toContain('aria-label="临时浏览主音"');
    expect(html).toContain('aria-label="临时浏览大小调"');
    expect(onOpenSettings).not.toHaveBeenCalled();
  });
  it.each([
    [0, "C", "major", ["C", "G", "Am", "F", "Dm", "Em", "G7", "Cmaj7"]],
    [7, "G", "major", ["G", "D", "Em", "C", "Am", "Bm", "D7", "Gmaj7"]],
    [9, "A", "minor", ["Am", "Dm", "E", "C", "G", "F", "Em", "E7"]],
  ] as const)("快捷推荐跟随%s/%s/%s并提供8项真实指法", (tonicPc, tonicSpelling, mode, names) => {
    const matches = quickChordMatches(catalog, { tonicPc, tonicSpelling, mode });
    expect(matches.map(match => match.name)).toEqual(names);
    for (const match of matches) {
      const result = selectedCatalogChord(catalog, match);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.chord.diagram.strings).toHaveLength(6);
        if (["C", "G", "Am", "F", "Dm", "Em"].includes(match.name)) {
          expect(result.chord.diagram.strings.every(string => string.fret === "x" || string.fret <= 3)).toBe(true);
        }
      }
    }
    if (mode === "minor") expect(matches.filter(match => match.group === "harmonic").map(match => match.name)).toEqual(["E", "E7"]);
  });
  it("默认六项均解析为低把位常用指法，F 使用一品横按", () => {
    const defaults = createDefaultChordPreferences();
    const chords = defaults.quickItems.map((reference) => resolveChordReference(reference, catalog, [], STANDARD_GUITAR_TUNING, true).chord);
    expect(chords.map((chord) => chord?.name)).toEqual(["C", "G", "Am", "F", "Dm", "Em"]);
    for (const chord of chords) {
      expect(chord?.diagram).toBeTruthy();
      expect(chord!.diagram!.strings.every((string) => string.fret === "x" || string.fret <= 3)).toBe(true);
    }
    expect(chords[3]!.diagram!.barres.some((barre) => barre.fret === 1 && barre.minString === 1 && barre.maxString === 6)).toBe(true);
  });
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
    expect(html).toContain("按调性浏览");
    expect(html).toContain("我的指法");
    expect(html).not.toContain("常用配置");
    expect(html).not.toContain('id="chord-library-tab-key"');
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
    expect(minor).toContain("A 小调 · 自然三和弦");
    expect(minor).toContain("和声小调补充");
    expect(minor.match(/<section[^>]*>/g)).toHaveLength(4);
    const legacy = renderToStaticMarkup(
      <ChordLibraryModal {...props} document={committed(null, "major", "G")} />,
    );
    expect(legacy).toContain("大小调未确认");
    expect(legacy).toContain("暂停本调推荐");
    expect(legacy).not.toContain("曲谱 G大调");
    const absoluteSections = legacy.match(/<section[^>]*>[\s\S]*?<\/section>/g)!;
    expect(absoluteSections).toHaveLength(1);
    expect(absoluteSections[0]).toContain("<h4>全部和弦</h4>");
    for (const section of absoluteSections) {
      expect(section.match(/<b>/g)).toHaveLength(catalog.items.length);
      // With no confirmed key, cards have names but no fabricated degree spans.
      expect(section.match(/<b>[^<]+<\/b><\/span>/g)).toHaveLength(catalog.items.length);
    }
  });
  it("A 小调恢复七个自然三和弦、七个七和弦和四个和声补充，剩余身份只在其他和弦出现", () => {
    const html = renderToStaticMarkup(
      <ChordLibraryModal
        draft={draft}
        document={committed("A", "minor")}
        presetsEnabled
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const sections = html.match(/<section[^>]*>[\s\S]*?<\/section>/g)!;
    expect(sections).toHaveLength(4);
    expect(sections.map(section => section.match(/<h4>([^<]+)<\/h4>/)?.[1])).toEqual(
      ["A 小调 · 自然三和弦", "七和弦", "和声小调补充", "其他和弦"],
    );
    const names = sections.map(section => [...section.matchAll(/<b>([^<]+)<\/b>/g)].map(match => match[1]));
    expect(names[0]).toEqual(["Am", "Bdim", "C", "Dm", "Em", "F", "G"]);
    expect(names[1]).toEqual(["Am7", "Bm7b5", "Cmaj7", "Dm7", "Em7", "Fmaj7", "G7"]);
    expect(names[2]).toEqual(["E", "E7", "G#dim", "G#dim7"]);
    expect(names[3]).toHaveLength(catalog.items.length - 18);
    expect(new Set(names.flat()).size).toBe(catalog.items.length);
    for (const [index, name, degree] of [
      [0, "Am", "i"], [0, "Bdim", "ii°"], [0, "C", "III"], [0, "F", "VI"], [0, "G", "VII"],
      [1, "Am7", "i7"], [1, "Bm7b5", "iiø7"], [2, "E", "V"], [2, "E7", "V7"],
      [2, "G#dim", "♯vii°"], [2, "G#dim7", "♯vii°7"],
      [3, "A", "I"], [3, "A7", "I7"], [3, "Amaj7", "Imaj7"], [3, "Caug", "III+"],
    ] as const) {
      const cards = [...sections[index]!.matchAll(/<b>([^<]+)<\/b><span[^>]*>([^<]+)<\/span>/g)]
        .map(card => [card[1], card[2]]);
      expect(cards).toContainEqual([name, degree]);
    }
  });
  it.each([
    ["C", "major", "C", "I", "自然三和弦"],
    ["C", "major", "C7", "I7", "含调外音"],
    ["C", "major", "Cmaj7", "Imaj7", "自然七和弦"],
    ["C", "major", "Csus4", "Isus4", "自然调内"],
    ["C", "major", "D7", "II7", "含调外音"],
    ["A", "minor", "Am7", "i7", "自然七和弦"],
    ["A", "minor", "E7", "V7", "和声小调内"],
    ["A", "minor", "G#dim7", "♯vii°7", "和声小调内"],
    ["A", "minor", "Caug", "III+", "和声小调内"],
    ["A", "minor", "A7", "I7", "含调外音"],
  ] as const)("详情按 %s %s 解释 %s 的级数与完整构成音关系", (tonic, mode, name, degree, relationship) => {
    const match = queryChordCatalog(catalog, { text: name }).items.find(item => item.name === name)!;
    const copied = selectedCatalogChord(catalog, match);
    if (!copied.ok) throw new Error(copied.error);
    const html = renderToStaticMarkup(<ChordLibraryModal
      draft={{ display: "name", chord: copied.chord }} document={committed(tonic, mode)} presetsEnabled
      onConfirm={vi.fn()} onCancel={vi.fn()}
    />);
    const detail = html.match(/<aside[^>]*data-testid="chord-library-detail"[^>]*>([\s\S]*?)<\/aside>/)?.[1];
    expect(detail).toBeDefined();
    expect(detail).toContain(`<h3>${name}</h3>`);
    expect(detail).toContain(`>${degree}</span>`);
    expect(detail).toContain(`${tonic} ${mode === "major" ? "大调" : "小调"} · ${relationship}<br/>`);
  });
  it("精确暂存当前草稿的非默认指法，预览和六到一弦说明不重置版本", () => {
    const match = queryChordCatalog(catalog, { text: "G" }).items.find(
      (m) => m.name === "G",
    )!;
    const voicing = match.item.voicings.find(
      (v) => v.id !== match.item.defaultVoicingId,
    )!;
    const copied = selectedCatalogChord(catalog, match, voicing.id);
    if (!copied.ok) throw new Error(copied.error);
    const seed: ChordDraft = { display: "name", chord: copied.chord };
    const original = structuredClone(seed);
    const onConfirm = vi.fn();
    const html = renderToStaticMarkup(
      <ChordLibraryModal
        draft={seed}
        document={committed()}
        presetsEnabled
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const escaped = voicing.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expect(html).toContain('aria-label="指法图预览"');
    expect(html).toMatch(
      new RegExp(`aria-pressed="true"[^>]*><b>${escaped}</b>`),
    );
    expect(html).toContain("6 → 1 弦");
    expect(html).not.toContain("更新常用指法");
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*><span>选用此指法/);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(seed).toEqual(original);
    const changed = structuredClone(seed);
    changed.chord.diagram!.strings[0]!.finger = null;
    changed.chord.diagram!.startFret += 1;
    const unmatched = renderToStaticMarkup(
      <ChordLibraryModal
        draft={changed}
        document={committed()}
        presetsEnabled
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    expect(unmatched).toContain("尚未改变当前草稿");
    expect(unmatched).not.toContain('aria-current="true"');
  });
  it("非标准调弦可暂存并查看精确指法，但不能确认写回", () => {
    const match = queryChordCatalog(catalog, { text: "G" }).items.find(
      (m) => m.name === "G",
    )!;
    const copied = selectedCatalogChord(catalog, match);
    if (!copied.ok) throw new Error(copied.error);
    const tuning: { pitch: string; midi: number }[] = STANDARD_GUITAR_TUNING.map((s) => ({ ...s }));
    tuning[5]!.pitch = "D2";
    tuning[5]!.midi = 38;
    const html = renderToStaticMarkup(
      <ChordLibraryModal
        draft={{ display: "name", chord: copied.chord }}
        document={committed()}
        tuning={tuning}
        presetsEnabled
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(html).toContain('aria-label="指法图预览"');
    expect(html).toContain("系统指法仅供标准调弦");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*><span>选用此指法/);
  });
  it("C 大调恢复七个自然三和弦和七个七和弦，192 个身份与真实图形无缺失或重复", () => {
    const html = renderToStaticMarkup(
      <ChordLibraryModal
        draft={draft}
        document={committed()}
        presetsEnabled
        initialTab="all"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(html).toContain('aria-label="临时浏览主音"');
    const sections = html.match(/<section[^>]*>[\s\S]*?<\/section>/g)!;
    expect(sections).toHaveLength(3);
    expect(sections.map(section => section.match(/<h4>([^<]+)<\/h4>/)?.[1])).toEqual(
      ["C 大调 · 自然三和弦", "七和弦", "其他和弦"],
    );
    const namesBySection = sections.map((section, index) => {
      const names = [...section.matchAll(/<b>([^<]+)<\/b>/g)].map(match => match[1]);
      expect(section.match(/aria-label="指法图预览"/g)).toHaveLength(index < 2 ? 7 : catalog.items.length - 14);
      return names;
    });
    expect(namesBySection[0]).toEqual(["C", "Dm", "Em", "F", "G", "Am", "Bdim"]);
    expect(namesBySection[1]).toEqual(["Cmaj7", "Dm7", "Em7", "Fmaj7", "G7", "Am7", "Bm7b5"]);
    const renderedNames = namesBySection.flat();
    expect(renderedNames).toHaveLength(192);
    expect(new Set(renderedNames).size).toBe(192);
    expect(html).not.toContain("和声小调补充");
    expect(html.match(/aria-label="指法图预览"/g)).toHaveLength(catalog.items.length);
    expect(html).not.toContain("保存常用配置");
  });
  it.each([
    [committed("D", "major", "D"), "1=D", ["D", "A", "Bm", "G", "Em", "F#m", "A7", "Dmaj7"]],
    [committed(null, "major", "D"), "1=D", ["D", "A", "Bm", "G", "Em", "F#m", "A7", "Dmaj7"]],
    [committed("A", "minor"), "1=C", ["Am", "Dm", "E", "C", "G", "F", "Em", "E7"]],
    [committed(null, "major", null), null, []],
    [committed("D"), null, []],
  ] as const)("常用卡片按谱面调性展示名称与指法 %#", (document, signature, names) => {
    const onChange = vi.fn();
    const original = structuredClone(document);
    const html = renderToStaticMarkup(
      <ChordPresetControls
        draft={draft}
        document={document}
        presetsEnabled
        onOpenLibrary={vi.fn()}
        onChange={onChange}
      />,
    );
    expect(html).toContain('aria-label="和弦库"');
    expect(html).not.toContain('aria-label="更多和弦"');
    expect([...html.matchAll(/aria-label="([^"]+)" aria-pressed=/g)].map(match => match[1])).toEqual(names);
    expect(html.match(/aria-label="指法图预览"/g) ?? []).toHaveLength(names.length);
    if (signature) expect(html).toContain(signature);
    else expect(html).not.toContain("1=");
    expect(html).not.toMatch(/大调|小调/);
    expect(html).not.toContain("和弦库加载中");
    expect(onChange).not.toHaveBeenCalled();
    expect(document).toEqual(original);
  });
  it("收藏在没有 HTTP 目录时仍可独立浏览", () => {
    state.snapshot = { status: "error", catalog: null, error: "offline" };
    const html = renderToStaticMarkup(
      <ChordLibraryModal
        draft={draft}
        document={committed()}
        presetsEnabled
        initialTab="mine"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(html).toContain("我的指法");
    expect(html).toContain("还没有保存的指法");
    expect(html).not.toContain("保存常用配置");
    state.snapshot = { status: "ready", catalog, error: null };
  });
  it("从自定义进入空收藏时不把系统指法冒充为已选择的收藏", () => {
    const match = queryChordCatalog(catalog, { text: "C" }).items.find(item => item.name === "C")!;
    const copied = selectedCatalogChord(catalog, match);
    if (!copied.ok) throw new Error(copied.error);
    const html = renderToStaticMarkup(<ChordLibraryModal
      draft={{ display: "nameAndDiagram", chord: copied.chord }} document={committed()} presetsEnabled
      initialTab="mine" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(html).toContain("还没有保存的指法");
    expect(html).toContain("选择一个和弦查看指法");
    expect(html).not.toContain("指法版本");
    expect(html).not.toContain("自然三和弦");
  });
});
