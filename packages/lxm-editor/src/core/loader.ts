import type { z } from "zod";

import { LXMDocumentSchema } from "./schema";
import { validateDocumentSemantics } from "./semantic-validation";
import type { DocumentLoadResult } from "./types";

const JSON_PARSE_ERROR_MESSAGE = "JSON 格式错误";
const ROOT_PATH_LABEL = "document";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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
    return { ok: false, errors: semanticResult.issues.map((issue) => `${issue.path}: ${issue.message}`) };
  }

  return {
    ok: true,
    document: parsedDocument.data,
  };
};
