import type { z } from "zod";

import { LXMDocumentSchema } from "./schema";
import type { DocumentLoadResult } from "./types";

const JSON_PARSE_ERROR_MESSAGE = "JSON 格式错误";
const ROOT_PATH_LABEL = "document";

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

  const parsedDocument = LXMDocumentSchema.safeParse(rawDocument);

  if (!parsedDocument.success) {
    return {
      ok: false,
      errors: parsedDocument.error.issues.map(formatZodIssue),
    };
  }

  return {
    ok: true,
    document: parsedDocument.data,
  };
};
