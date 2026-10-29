import { describe, expect, it } from "vitest";
import {
  EXAMPLE_MVP_7_2_DOCUMENT,
  EXAMPLE_TECHNIQUE_RHYTHM_DOCUMENT,
  EXAMPLE_MVP7C_DOCUMENT,
  EXAMPLE_MVP7C_LONG_DOCUMENT,
  EXAMPLE_MUTED_NOTE_DOCUMENT,
  EXAMPLE_MVP_6_DOCUMENT,
  createQualityScore,
  LXMScoreCommandEnum,
  getFirstTabCellReference,
} from "@liuxianmao/lxm-editor";
import { createEditorSession } from "../stores/editor-store";
import {
  decodeScoreFile,
  inspectScoreFile,
  scoreFileName,
  serializeScoreFile,
  SCORE_FILE_MAX_BYTES,
} from "../components/EditorShell/score-file";

const examples = [
  EXAMPLE_MVP_7_2_DOCUMENT,
  EXAMPLE_TECHNIQUE_RHYTHM_DOCUMENT,
  EXAMPLE_MUTED_NOTE_DOCUMENT,
  EXAMPLE_MVP7C_DOCUMENT,
  EXAMPLE_MVP7C_LONG_DOCUMENT,
  createQualityScore(16),
  createQualityScore(100),
];
const encode = (text: string) =>
  new TextEncoder().encode(text).buffer as ArrayBuffer;

/** 不仅断言 JSON 可解析，还实际走下载字节、载入、布局和编辑命令。 */
describe("原生曲谱文件往返", () => {
  it("旧文件只在文件导入预检中显式升级，宿主加载仍严格拒绝旧格式", () => {
    const legacyScore = {
      ...structuredClone(EXAMPLE_MVP_7_2_DOCUMENT),
      schemaVersion: 7,
      score: {
        ...structuredClone(EXAMPLE_MVP_7_2_DOCUMENT.score),
        tracks: EXAMPLE_MVP_7_2_DOCUMENT.score.tracks.map(
          ({ numberedMarks: _marks, ...track }) => ({
            ...track,
            measures: track.measures.map(
              ({ numberedVoice: _voice, ...measure }) => ({
                ...measure,
                lyrics: [],
              }),
            ),
          }),
        ),
      },
    };
    const session = createEditorSession(EXAMPLE_MVP_7_2_DOCUMENT),
      previous = session.getState().document;
    expect(session.getState().replaceDocument(legacyScore).ok).toBe(false);
    expect(session.getState().document).toBe(previous);
    const candidate = inspectScoreFile(JSON.stringify(legacyScore));
    expect(candidate).toMatchObject({
      ok: true,
      upgraded: true,
      sourceVersion: 7,
      document: { schemaVersion: 8 },
    });
    if (candidate.ok)
      expect(
        session.getState().replaceDocument(candidate.document, "file").ok,
      ).toBe(true);
  });
  it.each(examples)("所有当前标准谱例均可保真导出再导入", (document) => {
    const output = serializeScoreFile(document);
    expect(
      output.ok,
      output.ok ? "" : `${document.score.title}: ${output.errors.join("；")}`,
    ).toBe(true);
    if (!output.ok) return;
    const loaded = decodeScoreFile(encode(output.text));
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.document).toEqual(document);
  });

  it("编辑过的曲谱重新导入后仍可编辑和撤销", () => {
    const session = createEditorSession(EXAMPLE_MVP_7_2_DOCUMENT);
    const first = getFirstTabCellReference(session.getState().document!)!;
    const edited = session.getState().execute({
      type: LXMScoreCommandEnum.SetNote,
      ...first,
      fret: 7,
    });
    expect(edited?.ok).toBe(true);
    const output = serializeScoreFile(session.getState().document!);
    expect(output.ok).toBe(true);
    if (!output.ok) return;
    const loaded = decodeScoreFile(encode(output.text));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(session.getState().replaceDocument(loaded.document, "file").ok).toBe(
      true,
    );
    expect(session.getState().historyDepth.past).toBe(0);
    expect(session.getState().loadNotice).toContain("已导入");
    const changed = session.getState().execute({
      type: LXMScoreCommandEnum.SetNote,
      ...first,
      fret: 8,
    });
    expect(changed?.ok).toBe(true);
    expect(session.getState().canUndo).toBe(true);
    session.getState().undo();
    expect(session.getState().document).toEqual(loaded.document);
    session.getState().redo();
    expect(session.getState().document).toEqual(
      changed?.ok && changed.document,
    );
  });

  it("兼容 UTF-8 BOM；拒绝非法 UTF-8、超限与空输入", () => {
    expect(
      decodeScoreFile(encode(`\uFEFF${JSON.stringify(EXAMPLE_MVP7C_DOCUMENT)}`))
        .ok,
    ).toBe(true);
    expect(decodeScoreFile(new Uint8Array([0xff]).buffer)).toMatchObject({
      ok: false,
    });
    expect(
      decodeScoreFile(new Uint8Array(SCORE_FILE_MAX_BYTES + 1).buffer),
    ).toMatchObject({ ok: false });
    expect(inspectScoreFile("")).toMatchObject({ ok: false });
    expect(inspectScoreFile("{")).toMatchObject({ ok: false });
  });

  it("版本、未知字段、断拍和无效引用均不应被静默修补", () => {
    expect(
      inspectScoreFile(
        JSON.stringify({ ...EXAMPLE_MVP_6_DOCUMENT, schemaVersion: 6 }),
      ).ok,
    ).toBe(false);
    const unknown = { ...EXAMPLE_MVP_7_2_DOCUMENT, extra: true };
    expect(inspectScoreFile(JSON.stringify(unknown)).ok).toBe(false);
    const broken = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
    broken.score.tracks[0]!.measures[0]!.beats[0]!.tick = 1024;
    expect(inspectScoreFile(JSON.stringify(broken)).ok).toBe(false);
    const missing = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
    const measure = missing.score.tracks[0]!.measures.find(
      (candidate) => candidate.lyrics.length,
    );
    if (measure) {
      measure.lyrics[0]!.eventId = "missing-event";
      expect(inspectScoreFile(JSON.stringify(missing)).ok).toBe(false);
    }
  });

  it("拒绝多轨、空小节和异常元数据的静默丢失", () => {
    const multi = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
    multi.score.tracks.push({ ...multi.score.tracks[0]!, id: "another-track" });
    expect(inspectScoreFile(JSON.stringify(multi)).ok).toBe(false);
    const empty = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
    empty.score.tracks[0]!.measures = [];
    expect(inspectScoreFile(JSON.stringify(empty)).ok).toBe(false);
    const invalid = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
    invalid.score.meta = { unstable: Number.NaN };
    expect(serializeScoreFile(invalid).ok).toBe(false);
    const cyclic = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
    cyclic.score.meta = {};
    cyclic.score.meta.self = cyclic.score.meta;
    expect(serializeScoreFile(cyclic).ok).toBe(false);
  });

  it("深度与对象数量预算能在 Zod 之前拒绝异常 JSON", () => {
    expect(
      inspectScoreFile(
        JSON.stringify({
          nested: Array.from({ length: 65 }).reduce(
            (value) => [value],
            null as unknown,
          ),
        }),
      ).ok,
    ).toBe(false);
    expect(
      inspectScoreFile(
        JSON.stringify({ nested: Array.from({ length: 200_001 }, () => 1) }),
      ).ok,
    ).toBe(false);
  });

  it("下载文件名兼容中文、空标题和路径字符", () => {
    expect(scoreFileName("春风/又绿:江南?岸.")).toBe(
      "春风_又绿_江南_岸.lxm.json",
    );
    expect(scoreFileName("  ")).toBe("未命名曲谱.lxm.json");
  });
});
