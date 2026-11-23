import { describe, expect, it } from "vitest";
import {
  EXAMPLE_MVP_7_2_DOCUMENT,
  EXAMPLE_TECHNIQUE_RHYTHM_DOCUMENT,
  EXAMPLE_MVP7C_DOCUMENT,
  EXAMPLE_MVP7C_LONG_DOCUMENT,
  EXAMPLE_MUTED_NOTE_DOCUMENT,
  EXAMPLE_MVP_6_DOCUMENT,
  createQualityScore,
  applyScoreCommand,
  LXMScoreCommandEnum,
  getFirstTabCellReference,
  getMeasureDurationTicks,
} from "@liuxianmao/lxm-editor";
import { createBlankScore } from "../components/EditorShell/output/new-score";
import { createEditorSession } from "../stores/editor-store";
import {
  decodeScoreFile,
  inspectScoreFile,
  scoreFileName,
  serializeScoreFile,
  SCORE_FILE_MAX_BYTES,
} from "../components/EditorShell/output/score-file";

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

/** 复制后的所有可变值都独立，包括拍号、时值、连音比例和嵌套数组。 */
const expectIndependentObjects = (source: unknown, copy: unknown): void => {
  if (source === null || typeof source !== "object") return;
  expect(copy).not.toBe(source);
  for (const [key, value] of Object.entries(source))
    expectIndependentObjects(value, (copy as Record<string, unknown>)[key]);
};

/** 不仅断言 JSON 可解析，还实际走下载字节、载入、布局和编辑命令。 */
describe("原生曲谱文件往返", () => {
  it("新建谱的段中短小节保留有效选区，复制和存档保留实际时长，新插入小节继承完整拍号", () => {
    const document = createBlankScore({ title: "短小节", arranger: "", timeSignature: { numerator: 4, denominator: 4 },
      tonality: { version: 1, mode: "major", tonic: "C" } });
    const session = createEditorSession(document);
    const track = document.score.tracks[0]!;
    const measure = track.measures[1]!;
    const last = { trackId: track.id, measureId: measure.id, beatId: measure.beats[3]!.id, string: 2 };
    session.getState().setSelection({ anchor: last, focus: last });
    const result = session.getState().execute({ type: LXMScoreCommandEnum.SetMeasureDuration,
      trackId: track.id, measureId: measure.id, durationTicks: 1920 });
    if (!result?.ok) throw new Error(result?.message ?? "缩短失败");
    const resized = result.document.score.tracks[0]!.measures[1]!;
    expect(resized.beats.map(beat => beat.id)).toEqual(measure.beats.slice(0, 2).map(beat => beat.id));
    expect(session.getState().selection?.focus).toEqual({ ...last, beatId: resized.beats[0]!.id });
    session.getState().undo();
    expect(session.getState().document).toEqual(document);
    session.getState().redo();
    expect(session.getState().execute({ type: LXMScoreCommandEnum.CopyMeasure,
      trackId: track.id, measureId: measure.id })?.ok).toBe(true);
    expect(session.getState().execute({ type: LXMScoreCommandEnum.InsertMeasure,
      trackId: track.id, afterMeasureId: measure.id })?.ok).toBe(true);
    const saved = serializeScoreFile(session.getState().document!);
    if (!saved.ok) throw new Error(saved.errors.join("；"));
    const reopened = decodeScoreFile(encode(saved.text));
    if (!reopened.ok) throw new Error(reopened.errors.join("；"));
    const measures = reopened.document.score.tracks[0]!.measures;
    expect(measures.map(getMeasureDurationTicks)).toEqual([3840, 1920, 3840, 1920, 3840, 3840]);
    expect(measures.every(item => item.timeSignature.numerator === 4 && item.timeSignature.denominator === 4)).toBe(true);
  });

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
                // v7 固定格式没有自动补空的来源字段，新版示例须还原为当时的文件形状。
                beats: measure.beats.map(({ capacityRest: _capacityRest, ...beat }) => beat),
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

  it("连续普通拆分结果可直接保存并重开", () => {
    let document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
    for (let index = 0; index < 2; index++) {
      const track = document.score.tracks[0]!;
      const measure = track.measures[0]!;
      const result = applyScoreCommand(document, {
        type: LXMScoreCommandEnum.SplitBeat,
        trackId: track.id,
        measureId: measure.id,
        beatId: measure.beats[0]!.id,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.message);
      document = result.document;
      const saved = serializeScoreFile(document);
      expect(saved.ok).toBe(true);
      if (!saved.ok) throw new Error(saved.errors.join("；"));
      const reopened = inspectScoreFile(saved.text);
      expect(reopened.ok).toBe(true);
      if (reopened.ok) expect(reopened.document).toEqual(document);
    }
  });

  it.each([
    LXMScoreCommandEnum.CopyMeasure,
    LXMScoreCommandEnum.CopyMeasureRange,
  ])("%s 独立复制值对象，保存重开后仍能编辑副本和撤销", (type) => {
    const session = createEditorSession(EXAMPLE_TECHNIQUE_RHYTHM_DOCUMENT);
    const before = session.getState().document!;
    const track = before.score.tracks[0]!;
    const start = track.measures.findIndex((measure) => measure.tuplets.length);
    expect(start).toBeGreaterThanOrEqual(0);
    const source = track.measures[start]!;
    const count = type === LXMScoreCommandEnum.CopyMeasure ? 1 : 2;
    const result = session.getState().execute(
      type === LXMScoreCommandEnum.CopyMeasure
        ? {
            type: LXMScoreCommandEnum.CopyMeasure,
            trackId: track.id,
            measureId: source.id,
          }
        : {
            type: LXMScoreCommandEnum.CopyMeasureRange,
            trackId: track.id,
            sourceStartMeasureId: source.id,
            sourceEndMeasureId: track.measures[start + 1]!.id,
            afterMeasureId: track.measures.at(-1)!.id,
          },
    );
    expect(result?.ok).toBe(true);
    if (!result?.ok) throw new Error("复制失败");
    const copiedDocument = result.document;
    const copyStart =
      type === LXMScoreCommandEnum.CopyMeasure
        ? start + 1
        : track.measures.length;
    const copies = copiedDocument.score.tracks[0]!.measures.slice(
      copyStart,
      copyStart + count,
    );
    copies.forEach((copy, index) => {
      const original = track.measures[start + index]!;
      expectIndependentObjects(original, copy);
      expect(copy.timeSignature).toEqual(original.timeSignature);
      expect(copy.beats.map((beat) => beat.rhythm)).toEqual(
        original.beats.map((beat) => beat.rhythm),
      );
      expect(copy.tuplets.map((group) => group.ratio)).toEqual(
        original.tuplets.map((group) => group.ratio),
      );
    });
    session.getState().undo();
    expect(session.getState().document).toEqual(before);
    session.getState().redo();
    expect(session.getState().document).toEqual(copiedDocument);

    const saved = serializeScoreFile(session.getState().document!);
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error(saved.errors.join("；"));
    const reopened = decodeScoreFile(encode(saved.text));
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) throw new Error(reopened.errors.join("；"));
    expect(reopened.document).toEqual(copiedDocument);
    expect(
      session.getState().replaceDocument(reopened.document, "file").ok,
    ).toBe(true);
    expect(session.getState().historyDepth.past).toBe(0);
    const edited = session.getState().execute({
      type: LXMScoreCommandEnum.SetNote,
      trackId: track.id,
      measureId: copies[0]!.id,
      beatId: copies[0]!.beats[0]!.id,
      string: 1,
      fret: 19,
    });
    expect(edited?.ok).toBe(true);
    expect(
      session.getState().document!.score.tracks[0]!.measures[start],
    ).toEqual(source);
    session.getState().undo();
    expect(session.getState().document).toEqual(reopened.document);
    session.getState().redo();
    expect(session.getState().document).toEqual(edited?.ok && edited.document);
  });

  it("共享普通 JSON 元数据按每条路径保真保存，重开后值相等且互相独立", () => {
    const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
    const shared = { label: "共享元数据", values: [1, { enabled: true }] };
    document.score.meta = {
      left: shared,
      right: shared,
      list: [shared, shared],
    };
    const saved = serializeScoreFile(document);
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error(saved.errors.join("；"));
    const reopened = decodeScoreFile(encode(saved.text));
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) throw new Error(reopened.errors.join("；"));
    expect(reopened.document).toEqual(document);
    const meta = reopened.document.score.meta;
    expectIndependentObjects(meta.left, meta.right);
  });

  it.each(["self", "mutual", "array"])("拒绝真正的 %s 循环", (kind) => {
    const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
    const meta = document.score.meta;
    if (kind === "self") meta.self = meta;
    else if (kind === "mutual") meta.child = { parent: meta };
    else meta.children = [meta];
    expect(serializeScoreFile(document)).toEqual({
      ok: false,
      errors: ["曲谱包含循环对象，无法保真保存"],
    });
  });

  it("共享 DAG 的展开节点仍计入预算，不能按对象身份跳过", () => {
    const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
    // 18 个共享数组展开后超过 20 万节点，内存中的对象数量很小。
    let dag: unknown = 1;
    for (let level = 0; level < 18; level++) dag = [dag, dag];
    document.score.meta = { dag };
    expect(serializeScoreFile(document)).toEqual({
      ok: false,
      errors: ["曲谱结构超过 200000 个节点"],
    });
  });

  it("共享值在更深路径上仍受深度限制", () => {
    const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
    const shared = { value: 1 };
    let deep: unknown = shared;
    for (let level = 0; level < 61; level++) deep = { child: deep };
    // 栈会先检查 shallow；之后仍必须遍历 deep 中的 shared。
    document.score.meta = { deep, shallow: shared };
    expect(serializeScoreFile(document)).toEqual({
      ok: false,
      errors: ["曲谱嵌套超过 64 层"],
    });
  });

  it("共享值展开后的 UTF-8 文件大小仍受限制", () => {
    const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
    const shared = { text: "中".repeat(700_000) };
    document.score.meta = { copies: Array(5).fill(shared) };
    expect(serializeScoreFile(document)).toEqual({
      ok: false,
      errors: ["曲谱文件超过 10 MiB 上限"],
    });
  });

  it.each([
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    BigInt(1),
    () => 1,
    Symbol("invalid"),
    new Date("2026-01-01"),
    new Map(),
    Object.defineProperty({}, "hidden", { value: 1 }),
    Object.defineProperty({}, "accessor", { enumerable: true, get: () => 1 }),
    { [Symbol("field")]: 1 },
    Array(1),
  ])("共享元数据中的非法 JSON 值仍被拒绝（%#）", (value) => {
    const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
    const shared = { value };
    document.score.meta = { left: shared, right: shared };
    expect(serializeScoreFile(document).ok).toBe(false);
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
