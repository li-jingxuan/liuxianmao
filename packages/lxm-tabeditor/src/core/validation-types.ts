export type ValidationLevel = "warning" | "error";

/** 所有结构、语义和命令错误共用可定位的问题格式。 */
export interface ValidationIssue {
  level: ValidationLevel;
  code: string;
  message: string;
  path: string;
  targetId?: string;
}

export const createValidationIssue = (
  code: string,
  message: string,
  path: string,
  targetId?: string,
  level: ValidationLevel = "error",
): ValidationIssue => ({
  level,
  code,
  message,
  path,
  ...(targetId ? { targetId } : {}),
});
