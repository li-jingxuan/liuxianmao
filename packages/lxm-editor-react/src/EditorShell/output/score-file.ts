import {
  A4_CONTENT_WIDTH,
  buildLayout,
  CURRENT_SCHEMA_VERSION,
  SCORE_DOCUMENT_SCHEMA,
  upgradeDocumentToCurrent,
  type ILXMDocument,
} from "@liuxianmao/lxm-editor";
import { loadEditorDocument } from "../../stores/editor-store";
import { buildScoreScene } from "@liuxianmao/lxm-editor";

// 文件扩展名和界面显示名共用此约定，文档内部仍使用现有 JSON 和 Schema 版本。
export const SCORE_FILE_EXTENSION = ".lxm";
export const SCORE_FILE_LABEL = `六线猫专用谱(${SCORE_FILE_EXTENSION})`;

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
  | { ok: false; errors: string[]; reason?: "format" | "version" | "syntax" };
export type ExportResult =
  | { ok: true; text: string; name: string }
  | { ok: false; errors: string[] };

const fail = (message: string, reason?: "format" | "version" | "syntax"): FileResult => ({
  ok: false,
  errors: [message],
  reason,
});

/** 不递归遍历外部对象，先限制 Zod 和排版要处理的规模。 */
const inspectStructure = (
  value: unknown,
  serializing = false,
): string | null => {
  const stack: { value: unknown; depth: number; exit?: boolean }[] = [
    { value, depth: 0 },
  ];
  const ancestors = new WeakSet<object>();
  let nodes = 0;
  while (stack.length) {
    const current = stack.pop()!;
    if (current.exit) {
      ancestors.delete(current.value as object);
      continue;
    }
    if (++nodes > MAX_NODES) return `曲谱结构超过 ${MAX_NODES} 个节点`;
    if (current.depth > MAX_DEPTH) return `曲谱嵌套超过 ${MAX_DEPTH} 层`;
    const item = current.value;
    if (!serializing && item === undefined) continue;
    if (item === null || typeof item === "string" || typeof item === "boolean")
      continue;
    if (typeof item === "number" && Number.isFinite(item)) continue;
    if (typeof item !== "object") return "曲谱包含无法保真保存的值";
    if (ancestors.has(item)) return "曲谱包含循环对象，无法保真保存";
    if (serializing) {
      if (Object.getOwnPropertySymbols(item).length)
        return "曲谱包含无法保存的 Symbol 字段";
      if (
        !Array.isArray(item) &&
        Object.getPrototypeOf(item) !== Object.prototype
      )
        return "曲谱包含非普通对象，无法保真保存";
    }
    // 只在当前路径内判环；共享 JSON 值在每条路径上都要完整检查并计入预算。
    ancestors.add(item);
    stack.push({ value: item, depth: current.depth, exit: true });
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

const inspectSceneProjection = (document: ILXMDocument): string | null => {
  try {
    const layout = buildLayout(document, {
      x: 0,
      y: 0,
      systemWidth: A4_CONTENT_WIDTH,
      density: "compact",
    });
    const measures = layout.systems.flatMap((system) => system.measures);
    const sourceMeasures = document.score.tracks[0]!.measures;
    if (
      !layout.systems.length ||
      !Number.isFinite(layout.width) ||
      !Number.isFinite(layout.height) ||
      layout.height <= 0 ||
      measures.length !== sourceMeasures.length ||
      measures.some((measure, index) => {
        const source = sourceMeasures[index]!;
        const repeat = measure.measureRepeat;
        const beats = repeat?.playbackBeats ?? measure.beats;
        return measure.id !== source.id || Boolean(repeat) !== Boolean(source.measureRepeat) ||
          (repeat && (measure.beats.length > 0 || beats.some((beat) => !Number.isFinite(beat.x)))) ||
          beats.length !== source.beats.length ||
          beats.some((beat, beatIndex) => beat.id !== source.beats[beatIndex]!.id);
      })
    )
      return "曲谱布局不完整，无法导入";
    for (const [i, measure] of measures.entries()) {
      const events = measure.measureRepeat ? [] : sourceMeasures[i]!.numberedVoice.events;
      if (
        JSON.stringify(measure.numberedSlots.map((e) => e.id)) !==
          JSON.stringify(events.map((e) => e.id)) ||
        JSON.stringify(
          (measure.numberedNotation ?? []).map((e) => e.eventId),
        ) !==
          JSON.stringify(
            events
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

/** 先校验显示的谱面，再将含隐藏简谱的快照临时展开，用同一套布局和场景约束检查其内容。 */
const inspectScene = (document: ILXMDocument): string | null => {
  const error = inspectSceneProjection(document);
  if (error) return error;
  const track = document.score.tracks[0]!;
  const hidesNumbered = (measure: (typeof track.measures)[number]) =>
    Boolean(measure.measureRepeat && measure.numberedVoice.events.length);
  if (!track.measures.some(hidesNumbered)) return null;
  const measures = track.measures.map((measure) => {
    if (!hidesNumbered(measure)) return measure;
    const { measureRepeat: _measureRepeat, ...snapshot } = measure;
    return snapshot;
  });
  return inspectSceneProjection({
    ...document,
    score: { ...document.score, tracks: [{ ...track, measures }] },
  });
};

/** 导入和导出回读共用入口，始终以本版编辑器可操作的完整曲谱为准。 */
export const inspectScoreFile = (text: string): FileResult => {
  if (new TextEncoder().encode(text).byteLength > SCORE_FILE_MAX_BYTES)
    return fail("曲谱文件超过 10 MiB 上限");
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    return fail("曲谱文件内容格式错误，无法导入。", "syntax");
  }
  const structureError = inspectStructure(raw);
  if (structureError) return fail(structureError);
  if (!raw || typeof raw !== "object" || !("schema" in raw) || raw.schema !== SCORE_DOCUMENT_SCHEMA)
    return fail(`文件内容不是有效的${SCORE_FILE_LABEL}，请选择由六线猫导出的曲谱。`, "format");
  const sourceVersion =
    raw &&
    typeof raw === "object" &&
    "schemaVersion" in raw &&
    typeof raw.schemaVersion === "number"
      ? raw.schemaVersion
      : 0;
  const upgraded = [4, 5, 6, 7].includes(sourceVersion);
  if (sourceVersion && !upgraded && sourceVersion !== CURRENT_SCHEMA_VERSION)
    return fail(`不支持的文档版本 ${sourceVersion}，当前支持 ${CURRENT_SCHEMA_VERSION}`, "version");
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

/** 沿用曲名清理和默认名，按浏览器本地日期生成 yyMMdd，避免 UTC 换日时文件名早一天或晚一天。 */
export const scoreFileName = (title: string, date = new Date()): string => {
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
  const year = String(date.getFullYear()).slice(-2).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${clean || "未命名曲谱"}_${year}${month}${day}${SCORE_FILE_EXTENSION}`;
};

/** 下载前再次走完整导入预检，保证生成的文件能够用本编辑器重新打开。 */
export const serializeScoreFile = (document: ILXMDocument): ExportResult => {
  const structureError = inspectStructure(document, true);
  if (structureError) return { ok: false, errors: [structureError] };
  let text: string;
  try {
    text = `${JSON.stringify(document, null, 2)}\n`;
  } catch {
    return { ok: false, errors: ["无法生成曲谱文件。"] };
  }
  const checked = inspectScoreFile(text);
  return checked.ok
    ? { ok: true, text, name: scoreFileName(checked.document.score.title) }
    : checked;
};

/** 主动导出与离开确认都在实际下载时取当天日期，保留 UTF-8 JSON 内容类型。 */
export const downloadScoreFile = (score: ILXMDocument): { ok: true; name: string } | { ok: false; errors: string[] } => {
  const result = serializeScoreFile(score);
  if (!result.ok) return result;
  let url: string | undefined;
  let link: HTMLAnchorElement | undefined;
  try {
    url = URL.createObjectURL(new Blob([result.text], { type: "application/json;charset=utf-8" }));
    link = document.createElement("a");
    link.href = url;
    link.download = result.name;
    document.body.appendChild(link);
    link.click();
    return { ok: true, name: result.name };
  } catch {
    return { ok: false, errors: ["浏览器未能发起下载，请重试。"] };
  } finally {
    link?.remove();
    const capturedUrl = url;
    // 下载交给浏览器后可能立即跳转或换谱，延迟回收地址，给浏览器留出读取文件的时间。
    if (capturedUrl) window.setTimeout(() => URL.revokeObjectURL(capturedUrl), 60_000);
  }
};
