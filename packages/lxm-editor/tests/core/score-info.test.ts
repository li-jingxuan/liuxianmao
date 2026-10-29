import { asLegacyFixture } from "../helpers/legacy";
import { describe, it, expect } from "vitest";
import {
  applyScoreCommand,
  LXMScoreCommandEnum,
  EXAMPLE_MVP_6_DOCUMENT,
  upgradeDocumentToCurrent,
  loadDocument,
  buildLayout,
  hitTestLayout,
} from "../../src";
const fixture = () => structuredClone(EXAMPLE_MVP_6_DOCUMENT);
describe("基础谱面信息", () => {
  it("三字段原子提交、规范化、no-op、音乐实体和 meta 不变", () => {
    const doc = fixture();
    const original = structuredClone(doc);
    const command = {
      type: LXMScoreCommandEnum.SetNotationInfo as const,
      title: " 新歌 ",
      arranger: " 作者 ",
      keySignature: "C" as const,
    };
    const result = applyScoreCommand(doc, command);
    if (!result.ok) throw new Error(result.message);
    expect(result.document.score.title).toBe("新歌");
    expect(result.document.score.arranger).toBe("作者");
    expect(result.document.score.tracks).toEqual(original.score.tracks);
    expect(result.document.score.meta).toEqual(original.score.meta);
    expect(doc).toEqual(original);
    const noop = applyScoreCommand(result.document, command);
    expect(noop.ok && noop.document).toBe(result.document);
    expect(loadDocument(JSON.stringify(result.document)).ok).toBe(true);
  });
  it.each(["\n", "中".repeat(129), "bad\u2028name"])(
    "非法歌曲名称原子拒绝 %s",
    (title) => {
      const doc = fixture();
      expect(
        applyScoreCommand(doc, {
          type: LXMScoreCommandEnum.SetNotationInfo,
          title,
          arranger: "",
          keySignature: null,
        }).ok,
      ).toBe(false);
    },
  );
  it("空信息允许、作者长度/未知调性/schema6 未规范化文字拒绝", () => {
    const doc = fixture();
    expect(
      applyScoreCommand(doc, {
        type: LXMScoreCommandEnum.SetNotationInfo,
        title: "",
        arranger: "",
        keySignature: null,
      }).ok,
    ).toBe(true);
    expect(
      applyScoreCommand(doc, {
        type: LXMScoreCommandEnum.SetNotationInfo,
        title: "歌",
        arranger: "中".repeat(65),
        keySignature: null,
      }).ok,
    ).toBe(false);
    expect(
      loadDocument(
        JSON.stringify({ ...doc, score: { ...doc.score, keySignature: "H" } }),
      ).ok,
    ).toBe(false);
    expect(
      loadDocument(
        JSON.stringify({ ...doc, score: { ...doc.score, title: " 名称 " } }),
      ).ok,
    ).toBe(false);
  });
  it.each([4, 5])(
    "显式升级 schema %s 保持音乐事实，loader 不隐式接收",
    (version) => {
      const doc = fixture();
      // 旧版本没有独立简谱歌词，不把当前版本的 eventId 锚点伪装成旧文件。
      doc.score.tracks.forEach((track) =>
        track.measures.forEach((measure) => {
          measure.lyrics = [];
          measure.numberedVoice = { events: [], tuplets: [] };
        }),
      );
      const old = JSON.parse(JSON.stringify(doc));
      old.schemaVersion = version;
      delete old.score.arranger;
      delete old.score.keySignature;
      if (version === 4)
        old.score.tracks.forEach((t: { capo?: number }) => {
          delete t.capo;
        });
      const before = structuredClone(old);
      expect(loadDocument(JSON.stringify(old)).ok).toBe(false);
      const result = upgradeDocumentToCurrent(asLegacyFixture(old));
      if (!result.ok) throw new Error(result.errors.join(";"));
      expect(result.document.schemaVersion).toBe(8);
      expect(result.document.score.keySignature).toBeNull();
      expect(result.document.score.arranger).toBe("");
      expect(result.document.score.tracks).toEqual(doc.score.tracks);
      expect(old).toEqual(before);
      old.score.title = "中".repeat(129);
      expect(upgradeDocumentToCurrent(asLegacyFixture(old)).ok).toBe(false);
    },
  );
  it("长标题与作者换行，不改变正文宽度，命中使用最终平移坐标", () => {
    const doc = fixture();
    doc.score.title = "中文长歌名".repeat(20);
    doc.score.arranger = "编谱者".repeat(20);
    doc.score.keySignature = "Bb";
    doc.score.tracks[0]!.capo = 3;
    const before = structuredClone(doc);
    const layout = buildLayout(doc, { systemWidth: 180 });
    expect(layout.scoreHeader!.length).toBeGreaterThan(3);
    for (const label of layout.scoreHeader!) {
      expect(label.bounds.x).toBeGreaterThanOrEqual(layout.x);
      expect(label.bounds.x + label.bounds.width).toBeLessThanOrEqual(
        layout.x + 180,
      );
    }
    const headerBottom = Math.max(
      ...layout.scoreHeader!.map((l) => l.bounds.y + l.bounds.height),
    );
    expect(layout.systems[0]!.y).toBeGreaterThan(headerBottom);
    const measure = layout.systems[0]!.measures[0]!;
    expect(
      hitTestLayout(layout, {
        x: measure.beats[0]!.x,
        y: measure.strings[0]!.y1,
      }),
    ).toBeTruthy();
    expect(doc).toEqual(before);
  });
  it("空标题兜底，作者/未设置调性/capo0 省略，基础拍号展示来自首小节", () => {
    const doc = fixture();
    doc.score.title = "";
    const layout = buildLayout(doc);
    const text = layout.scoreHeader!.map((l) => l.text).join("");
    expect(text).toContain("未命名歌曲");
    expect(text).toContain("4/4");
    expect(text).not.toContain("Capo");
    expect(text).not.toContain("调弦");
    expect(text).not.toContain("编谱：");
  });
});
