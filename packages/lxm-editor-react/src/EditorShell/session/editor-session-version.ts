import type { EditorStoreState } from "../../stores/editor-store";

/** 文档对象与单调版本共同标识快照，撤销回相同 revision 也不会误认旧预览。 */
export type EditorSessionVersion = Pick<
  EditorStoreState,
  "document" | "stateVersion" | "sessionId" | "sessionVersion"
>;

export const captureEditorVersion = (
  state: EditorSessionVersion,
): EditorSessionVersion => ({
  document: state.document,
  stateVersion: state.stateVersion,
  sessionId: state.sessionId,
  sessionVersion: state.sessionVersion,
});

export const sameEditorSession = (
  current: EditorSessionVersion,
  expected: EditorSessionVersion,
): boolean =>
  current.sessionId === expected.sessionId &&
  current.sessionVersion === expected.sessionVersion;

export const sameEditorVersion = (
  current: EditorSessionVersion,
  expected: EditorSessionVersion,
): boolean =>
  sameEditorSession(current, expected) &&
  current.document === expected.document &&
  current.stateVersion === expected.stateVersion;
