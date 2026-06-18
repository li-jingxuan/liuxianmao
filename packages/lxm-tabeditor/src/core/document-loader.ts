import { z } from "zod";
import { CURRENT_SCHEMA_VERSION, SCORE_DOCUMENT_SCHEMA } from "./constants";
import { lxmScoreDocumentSchema, type LxmScoreDocument } from "./schema";
import { validateScoreSemantics } from "./validation";
import {
  createValidationIssue,
  type ValidationIssue,
} from "./validation-types";

export type DocumentLoadErrorCode =
  | "INVALID_JSON"
  | "INVALID_SCHEMA"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "INVALID_DOCUMENT_STRUCTURE"
  | "INVALID_DOCUMENT_SEMANTICS";

export type DocumentLoadResult =
  | { ok: true; document: LxmScoreDocument; warnings: ValidationIssue[] }
  | { ok: false; code: DocumentLoadErrorCode; issues: ValidationIssue[] };

const formatZodPath = (path: Array<string | number>): string =>
  path.reduce<string>(
    (result, segment) =>
      typeof segment === "number"
        ? `${result}[${segment}]`
        : `${result}.${segment}`,
    "$",
  );

const getVersionEnvelope = (
  value: unknown,
): { schema?: unknown; schemaVersion?: unknown } =>
  typeof value === "object" && value !== null ? value : {};

/**
 * 严格执行 JSON、版本、结构、语义四阶段加载；任一阶段失败都不会返回业务文档。
 */
export const loadScoreDocument = (json: string): DocumentLoadResult => {
  let rawDocument: unknown;
  try {
    rawDocument = JSON.parse(json) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法解析 JSON";
    return {
      ok: false,
      code: "INVALID_JSON",
      issues: [createValidationIssue("INVALID_JSON", message, "$")],
    };
  }

  const envelope = getVersionEnvelope(rawDocument);
  if (envelope.schema !== SCORE_DOCUMENT_SCHEMA) {
    return {
      ok: false,
      code: "INVALID_SCHEMA",
      issues: [
        createValidationIssue(
          "INVALID_SCHEMA",
          `文档 schema 必须为 “${SCORE_DOCUMENT_SCHEMA}”`,
          "$.schema",
        ),
      ],
    };
  }
  if (envelope.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    return {
      ok: false,
      code: "UNSUPPORTED_SCHEMA_VERSION",
      issues: [
        createValidationIssue(
          "UNSUPPORTED_SCHEMA_VERSION",
          `仅支持 schemaVersion ${CURRENT_SCHEMA_VERSION}`,
          "$.schemaVersion",
        ),
      ],
    };
  }

  const structureResult = lxmScoreDocumentSchema.safeParse(rawDocument);
  if (!structureResult.success) {
    return {
      ok: false,
      code: "INVALID_DOCUMENT_STRUCTURE",
      issues: structureResult.error.issues.map((issue: z.ZodIssue) =>
        createValidationIssue(
          `ZOD_${issue.code.toUpperCase()}`,
          issue.message,
          formatZodPath(issue.path),
        ),
      ),
    };
  }

  const semanticIssues = validateScoreSemantics(structureResult.data);
  const errors = semanticIssues.filter((issue) => issue.level === "error");
  if (errors.length > 0) {
    return {
      ok: false,
      code: "INVALID_DOCUMENT_SEMANTICS",
      issues: semanticIssues,
    };
  }

  return {
    ok: true,
    document: structureResult.data,
    warnings: semanticIssues,
  };
};
