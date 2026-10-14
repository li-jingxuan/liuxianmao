import {
  A4_CONTENT_WIDTH,
  buildLayout,
  CURRENT_SCHEMA_VERSION,
  upgradeDocumentToCurrent,
  type ILXMDocument,
} from "@liuxianmao/lxm-editor";
import { loadEditorDocument } from "../../stores/editor-store";
import { buildScoreScene } from "./score-scene";

/** 文件大小、结构深度和乐谱规模共用同一预算，保证本版导出的文件可再次导入。 */
export const SCORE_FILE_MAX_BYTES = 10 * 1024 * 1024;
const MAX_DEPTH = 64;
const MAX_NODES = 200_000;
const MAX_MEASURES = 1_000;
const MAX_BEATS = 20_000;
const MAX_TECHNIQUES = 20_000;

type FileResult =
  | {
      ok: true;
      document: ILXMDocument;
      sourceVersion: number;
      upgraded: boolean;
    }
  | { ok: false; errors: string[] };
export type ExportResult =
  | { ok: true; text: string; name: string }
  | { ok: false; errors: string[] };

const fail = (message: string): FileResult => ({
  ok: false,
  errors: [message],
});

/** 不递归遍历外部对象，先限制 Zod 和排版要处理的规模。 */
const inspectStructure = (
  value: unknown,
  serializing = false,
): string | null => {
  const stack = [{ value, depth: 0 }];
  const seen = new WeakSet<object>();
  let nodes = 0;
  while (stack.length) {
    const current = stack.pop()!;
    if (++nodes > MAX_NODES) return `曲谱结构超过 ${MAX_NODES} 个节点`;
    if (current.depth > MAX_DEPTH) return `曲谱嵌套超过 ${MAX_DEPTH} 层`;
    const item = current.value;
    if (!serializing && item === undefined) continue;
    if (item === null || typeof item === "string" || typeof item === "boolean")
      continue;
    if (typeof item === "number" && Number.isFinite(item)) continue;
    if (typeof item !== "object") return "曲谱包含无法保真保存的值";
    if (serializing) {
      if (Object.getOwnPropertySymbols(item).length)
        return "曲谱包含无法保存的 Symbol 字段";
      if (seen.has(item)) return "曲谱包含循环或共享对象，无法保真保存";
      seen.add(item);
      if (
        !Array.isArray(item) &&
        Object.getPrototypeOf(item) !== Object.prototype
      )
        return "曲谱包含非普通对象，无法保真保存";
    }
    if (Array.isArray(item)) {
      if (serializing && Object.keys(item).length !== item.length)
        return "曲谱包含稀疏数组或额外属性，无法保真保存";
      for (const child of item)
        stack.push({ value: child, depth: current.depth + 1 });
    } else {
      if (serializing) {
        const descriptors = Object.getOwnPropertyDescriptors(item);
        if (
          Object.values(descriptors).some(
            (descriptor) => !descriptor.enumerable || !("value" in descriptor),
          )
        )
          return "曲谱包含不可枚举字段或访问器，无法保真保存";
      }
      for (const [key, child] of Object.entries(item)) {
        // 领域模型只有这两项可选字段可省略，扩展元信息中的 undefined 必须拒绝。
        if (
          serializing &&
          child === undefined &&
          key === "sectionLabel" &&
          "beats" in item
        )
          continue;
        stack.push({ value: child, depth: current.depth + 1 });
      }
    }
  }
  return null;
};

/** 数量上限与结构限制一起防止小文件中包含大量空对象而拖慢布局。 */
const inspectMusicScale = (document: ILXMDocument): string | null => {
  let measures = 0;
  let beats = 0;
  let techniques = 0;
  for (const track of document.score.tracks) {
    techniques += track.techniques.length + track.numberedMarks.length;
    for (const measure of track.measures) {
      measures += 1;
      beats += measure.beats.length + measure.numberedVoice.events.length;
      techniques +=
        measure.tuplets.length + measure.numberedVoice.tuplets.length;
    }
  }
  if (
    measures > MAX_MEASURES ||
    beats > MAX_BEATS ||
    techniques > MAX_TECHNIQUES
  )
    return `曲谱超过支持范围（最多 ${MAX_MEASURES} 小节、${MAX_BEATS} 拍点、${MAX_TECHNIQUES} 项技巧）`;
  return null;
};

/** 正式布局和场景预检，避免合法 schema 却无法正常绘制的文件替换当前曲谱。 */
const inspectScene = (document: ILXMDocument): string | null => {
  try {
    const layout = buildLayout(document, {
      x: 0,
      y: 0,
      systemWidth: A4_CONTENT_WIDTH,
      density: "compact",
    });
    const measures = layout.systems.flatMap((system) => system.measures);
    if (
      !layout.systems.length ||
      !Number.isFinite(layout.width) ||
      !Number.isFinite(layout.height) ||
      layout.height <= 0 ||
      measures.length !== document.score.tracks[0]!.measures.length ||
      measures.some(
        (measure, index) =>
          measure.id !== document.score.tracks[0]!.measures[index]!.id ||
          measure.beats.length !==
            document.score.tracks[0]!.measures[index]!.beats.length ||
          measure.beats.some(
            (beat, beatIndex) =>
              beat.id !==
              document.score.tracks[0]!.measures[index]!.beats[beatIndex]!.id,
          ),
      )
    )
      return "曲谱布局不完整，无法导入";
    for (const [i, measure] of measures.entries()) {
      const source = document.score.tracks[0]!.measures[i]!;
      if (
        JSON.stringify(measure.numberedSlots.map((e) => e.id)) !==
          JSON.stringify(source.numberedVoice.events.map((e) => e.id)) ||
        JSON.stringify(
          (measure.numberedNotation ?? []).map((e) => e.eventId),
        ) !==
          JSON.stringify(
            source.numberedVoice.events
              .filter((e) => e.kind !== "gap")
              .map((e) => e.id),
          ) ||
        measure.timeAnchors.some(
          (a) => !Number.isFinite(a.x) || !Number.isInteger(a.tick),
        )
      )
        return "简谱布局或时间锚点不完整，无法导入";
    }
    const scene = buildScoreScene(layout);
    if (scene.systems.length !== layout.systems.length)
      return "曲谱场景不完整，无法导入";
    // 两份投影各自受限；不能把同一音乐事实重复投影的节点相加后误拒绝常规长谱。
    const error = inspectStructure(layout) ?? inspectStructure(scene);
    if (error) return `曲谱布局无效：${error}`;
    return null;
  } catch {
    return "曲谱无法完成排版，未替换当前曲谱";
  }
};

/** 导入和导出回读共用入口，始终以本版编辑器可操作的完整曲谱为准。 */
export const inspectScoreFile = (text: string): FileResult => {
  if (new TextEncoder().encode(text).byteLength > SCORE_FILE_MAX_BYTES)
    return fail("曲谱文件超过 10 MiB 上限");
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    return fail("JSON 格式错误，无法导入曲谱");
  }
  const structureError = inspectStructure(raw);
  if (structureError) return fail(structureError);
  const sourceVersion =
    raw &&
    typeof raw === "object" &&
    "schemaVersion" in raw &&
    typeof raw.schemaVersion === "number"
      ? raw.schemaVersion
      : 0;
  const upgraded = [4, 5, 6, 7].includes(sourceVersion);
  const candidate = upgraded ? upgradeDocumentToCurrent(raw) : null;
  if (candidate && !candidate.ok) return candidate;
  const loaded = loadEditorDocument(candidate?.ok ? candidate.document : raw);
  if (!loaded.ok) return loaded;
  const scaleError = inspectMusicScale(loaded.document);
  if (scaleError) return fail(scaleError);
  const sceneError = inspectScene(loaded.document);
  if (sceneError) return fail(sceneError);
  return {
    ...loaded,
    sourceVersion: sourceVersion || CURRENT_SCHEMA_VERSION,
    upgraded,
  };
};

/** 使用严格 UTF-8 解码；错误字节不能被替换字符掩盖并写入谱面。 */
export const decodeScoreFile = (bytes: ArrayBuffer): FileResult => {
  if (bytes.byteLength > SCORE_FILE_MAX_BYTES)
    return fail("曲谱文件超过 10 MiB 上限");
  try {
    return inspectScoreFile(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch {
    return fail("文件不是有效的 UTF-8 曲谱文件");
  }
};

export const scoreFileName = (title: string): string => {
  const clean = [...title]
    .map((char) =>
      /[\\/:*?"<>|]/.test(char) ||
      char.charCodeAt(0) < 32 ||
      char.charCodeAt(0) === 127
        ? "_"
        : char,
    )
    .join("")
    .replace(/[.\s]+$/g, "")
    .trim()
    .slice(0, 80)
    .replace(/[.\s]+$/g, "");
  return `${clean || "未命名曲谱"}.lxm.json`;
};

/** 下载前再次走完整导入预检，保证生成的文件能够用本编辑器重新打开。 */
export const serializeScoreFile = (document: ILXMDocument): ExportResult => {
  const structureError = inspectStructure(document, true);
  if (structureError) return { ok: false, errors: [structureError] };
  let text: string;
  try {
    text = `${JSON.stringify(document, null, 2)}\n`;
  } catch {
    return { ok: false, errors: ["曲谱无法序列化为 JSON"] };
  }
  const checked = inspectScoreFile(text);
  return checked.ok
    ? { ok: true, text, name: scoreFileName(checked.document.score.title) }
    : checked;
};
