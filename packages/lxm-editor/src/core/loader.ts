import { CURRENT_SCHEMA_VERSION, SCORE_DOCUMENT_SCHEMA } from "./constants";
import { z } from "zod";

import { LXMDocumentSchema } from "./schema";
import {
  LXMDocumentSchema as LegacyDocumentSchema,
  LXMScoreSchema as LegacyScoreSchema,
  LXMTrackSchema as LegacyTrackSchema,
  LXMMeasureSchema as LegacyMeasureSchema,
  LXMBeatSchema as LegacyBeatSchema,
  LXMTechniqueSchema as LegacyTechniqueSchema,
} from "./legacy-document-schema";
import { convertLegacyNumbered } from "./numbered-upgrade";
import { validateDocumentSemantics } from "./semantic-validation";
import type { DocumentLoadResult } from "./types";

const JSON_PARSE_ERROR_MESSAGE = "JSON 格式错误";
const ROOT_PATH_LABEL = "document";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** 显式升级已知旧格式；正常 loader 永不调用迁移入口。 */
/** 升级入口冻结旧格式；转换后才使用当前结构和语义守卫。 */
export const upgradeDocumentToCurrent = (
  value: unknown,
): DocumentLoadResult => {
  if (
    !isRecord(value) ||
    value.schema !== SCORE_DOCUMENT_SCHEMA ||
    ![4, 5, 6, 7].includes(value.schemaVersion as number)
  )
    return { ok: false, errors: ["升级入口只接受 schema 4、5、6 或 7 对象"] };
  const version = value.schemaVersion as 4 | 5 | 6 | 7;
  const oldMeasure =
    version === 7
      ? LegacyMeasureSchema
      : LegacyMeasureSchema.extend({
          beats: z.array(LegacyBeatSchema.omit({ numberedNotation: true })),
        });
  const legacyTechnique =
    version === 7
      ? LegacyTechniqueSchema
      : LegacyTechniqueSchema.superRefine((t, ctx) => {
          if (t.type === "bend" && t.semitones !== 2)
            ctx.addIssue({ code: "custom", message: "旧版本只支持全音推弦" });
        });
  const oldScore =
    version >= 6
      ? LegacyScoreSchema
      : LegacyScoreSchema.omit({ arranger: true, keySignature: true }).extend({
          title: z.string(),
        });
  const track = (
    version === 4 ? LegacyTrackSchema.omit({ capo: true }) : LegacyTrackSchema
  ).extend({
    measures: z.array(
      version === 4 ? oldMeasure.omit({ sectionLabel: true }) : oldMeasure,
    ),
    techniques: z.array(legacyTechnique),
  });
  const schema = LegacyDocumentSchema.extend({
    schemaVersion: z.literal(version),
    score: oldScore.extend({ tracks: z.array(track) }),
  });
  const parsed = schema.safeParse(migrateLegacyChordTraversalRanges(value));
  if (!parsed.success)
    return { ok: false, errors: parsed.error.issues.map(formatZodIssue) };
  const prepared = LegacyDocumentSchema.safeParse({
    ...parsed.data,
    schemaVersion: 7,
    score: {
      ...parsed.data.score,
      arranger:
        "arranger" in parsed.data.score ? parsed.data.score.arranger : "",
      keySignature:
        "keySignature" in parsed.data.score
          ? parsed.data.score.keySignature
          : null,
      tracks: parsed.data.score.tracks.map((t) => ({
        ...t,
        capo: "capo" in t ? t.capo : 0,
      })),
    },
  });
  if (!prepared.success)
    return { ok: false, errors: prepared.error.issues.map(formatZodIssue) };
  try {
    return loadDocument(JSON.stringify(convertLegacyNumbered(prepared.data)));
  } catch {
    return { ok: false, errors: ["旧文档无法序列化为 JSON"] };
  }
};

/**
 * 兼容弦范围字段引入前保存的 v5 文档。
 *
 * 旧 strum/arpeggio 只保存 beatId，曾默认覆盖该 Beat 所有 Note。加载边界用这些
 * Note 的最小/最大弦号补齐等价范围；无法推导至少两根弦时保持原值，让 strict
 * schema 给出正常字段错误。迁移只处理解析后的临时 JSON，不修改调用方对象。
 */
const migrateLegacyChordTraversalRanges = (value: unknown): unknown => {
  if (!isRecord(value)) return value;
  const score = value.score;
  if (!isRecord(score) || !Array.isArray(score.tracks)) return value;

  return {
    ...value,
    score: {
      ...score,
      tracks: score.tracks.map((trackValue) => {
        if (!isRecord(trackValue) || !Array.isArray(trackValue.techniques))
          return trackValue;
        const beatsById = new Map<string, Record<string, unknown>>();
        if (Array.isArray(trackValue.measures))
          trackValue.measures.forEach((measureValue) => {
            if (!isRecord(measureValue) || !Array.isArray(measureValue.beats))
              return;
            measureValue.beats.forEach((beatValue) => {
              if (isRecord(beatValue) && typeof beatValue.id === "string")
                beatsById.set(beatValue.id, beatValue);
            });
          });

        return {
          ...trackValue,
          techniques: trackValue.techniques.map((techniqueValue) => {
            if (
              !isRecord(techniqueValue) ||
              (techniqueValue.type !== "strum" &&
                techniqueValue.type !== "arpeggio") ||
              techniqueValue.minString !== undefined ||
              techniqueValue.maxString !== undefined ||
              typeof techniqueValue.beatId !== "string"
            )
              return techniqueValue;
            const beat = beatsById.get(techniqueValue.beatId);
            const strings = Array.isArray(beat?.notes)
              ? beat.notes.flatMap((noteValue) =>
                  isRecord(noteValue) && typeof noteValue.string === "number"
                    ? [noteValue.string]
                    : [],
                )
              : [];
            const minString = Math.min(...strings);
            const maxString = Math.max(...strings);
            return Number.isFinite(minString) && minString < maxString
              ? { ...techniqueValue, minString, maxString }
              : techniqueValue;
          }),
        };
      }),
    },
  };
};

/** 格式化 zod 错误，方便调用侧直接展示字段路径。 */
const formatZodIssue = (issue: z.ZodIssue): string => {
  const path = issue.path.join(".");
  const fieldPath = path.length > 0 ? path : ROOT_PATH_LABEL;

  return `${fieldPath}: ${issue.message}`;
};

/** 加载 JSON 字符串，完成解析、schema 校验并返回统一结果。 */
export const loadDocument = (json: string): DocumentLoadResult => {
  let rawDocument: unknown;

  try {
    rawDocument = JSON.parse(json);
  } catch {
    return {
      ok: false,
      errors: [JSON_PARSE_ERROR_MESSAGE],
    };
  }

  if (
    isRecord(rawDocument) &&
    rawDocument.schema === SCORE_DOCUMENT_SCHEMA &&
    rawDocument.schemaVersion !== undefined &&
    rawDocument.schemaVersion !== CURRENT_SCHEMA_VERSION
  )
    return {
      ok: false,
      errors: [`不支持的文档版本，当前支持 ${CURRENT_SCHEMA_VERSION}`],
    };

  const parsedDocument = LXMDocumentSchema.safeParse(
    migrateLegacyChordTraversalRanges(rawDocument),
  );

  if (!parsedDocument.success) {
    return {
      ok: false,
      errors: parsedDocument.error.issues.map(formatZodIssue),
    };
  }

  const semanticResult = validateDocumentSemantics(parsedDocument.data);
  if (!semanticResult.ok) {
    return {
      ok: false,
      errors: semanticResult.issues.map(
        (issue) => `${issue.path}: ${issue.message}`,
      ),
    };
  }

  return {
    ok: true,
    document: parsedDocument.data,
  };
};
