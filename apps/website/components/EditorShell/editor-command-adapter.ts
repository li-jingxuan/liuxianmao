import type { StoreApi } from "zustand/vanilla";
import type {
  ILXMApplyScoreCommandResult,
  ILXMScoreCommand,
} from "@liuxianmao/lxm-editor";
import type { EditorStoreState } from "../../stores/editor-store";
import type { EditorModalController } from "./editor-modal-controller";
import {
  captureEditorVersion,
  sameEditorSession,
} from "./editor-session-version";

export type EditorCommandResult =
  | {
      status: "applied";
      result: Extract<ILXMApplyScoreCommandResult, { ok: true }>;
    }
  | {
      status: "noop";
      result: Extract<ILXMApplyScoreCommandResult, { ok: true }>;
    }
  | {
      status: "needs-impact";
      result: Extract<ILXMApplyScoreCommandResult, { ok: false }>;
    }
  | { status: "blocked" | "cancelled" | "stale"; message: string };
export type EditorCommandAdapter = (
  command: ILXMScoreCommand,
  impact?: "modal" | "caller",
) => Promise<EditorCommandResult>;

/** 将公共结构确认转换为最终结果；粘贴自行在原弹层承接影响，禁止嵌套 Modal。 */
export const createEditorCommandAdapter =
  (
    session: StoreApi<EditorStoreState>,
    modals: EditorModalController,
  ): EditorCommandAdapter =>
  async (command, impact = "modal") => {
    const snapshot = captureEditorVersion(session.getState());
    const capturedSelection = JSON.stringify(session.getState().selection);
    const capturedNumbered = JSON.stringify(
      session.getState().numberedSelection,
    );
    const result = session.getState().execute(command);
    if (!sameEditorSession(session.getState(), snapshot))
      return { status: "stale", message: "编辑会话已变化。" };
    if (result?.ok)
      return { status: result.changed ? "applied" : "noop", result };
    if (!result || result.code !== "NUMBERED_IMPACT_REQUIRED")
      return {
        status: "blocked",
        message: result?.message ?? "当前无法提交修改。",
      };
    if (impact === "caller") return { status: "needs-impact", result };
    return new Promise<EditorCommandResult>((resolve) => {
      let outcome: EditorCommandResult | null = null;
      const id = modals.open({
        kind: "structure-impact",
        title: "公共结构影响确认",
        message: `这次结构修改将删除 ${result.removedMarkIds?.length ?? 0} 个简谱连接记号。确认后与结构修改一起提交、一起撤销。`,
        version: snapshot,
        isValid: () =>
          capturedSelection === JSON.stringify(session.getState().selection) &&
          capturedNumbered ===
            JSON.stringify(session.getState().numberedSelection),
        confirm: ({ isCurrent }) => {
          if (!isCurrent()) return false;
          const next = session.getState().execute({
            ...command,
            expectedRevision: snapshot.document!.documentRevision,
            confirmedRemovedMarkIds: result.removedMarkIds ?? [],
            confirmedChangedMarkIds: result.changedMarkIds ?? [],
          });
          if (!sameEditorSession(session.getState(), snapshot)) return false;
          if (!next?.ok) return false;
          outcome = { status: next.changed ? "applied" : "noop", result: next };
          return true;
        },
        onClose: (reason) =>
          resolve(
            outcome ?? {
              status: reason === "stale" ? "stale" : "cancelled",
              message:
                reason === "stale"
                  ? "结构预览已过期，请重新操作。"
                  : "已取消修改。",
            },
          ),
      });
      if (id === null)
        resolve({ status: "blocked", message: "请先完成当前弹层操作。" });
    });
  };
