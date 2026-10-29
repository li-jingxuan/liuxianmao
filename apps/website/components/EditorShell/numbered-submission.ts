import {
  createDocumentIdFactory,
  editNumberedTrack,
  type ILXMApplyScoreCommandResult,
  type ILXMNumberedVoiceCommand,
  type NumberedCandidate,
} from "@liuxianmao/lxm-editor";
import {
  captureEditorVersion,
  sameEditorVersion,
  type EditorSessionVersion,
} from "./editor-session-version";

export type NumberedDraftGroup = "content" | "rhythm" | "itemPitch";
export type NumberedPropertyApplyResult =
  | { status: "applied" | "noop"; group: NumberedDraftGroup }
  | {
      status: "blocked" | "cancelled" | "stale";
      group: NumberedDraftGroup;
      message: string;
    };
export type NumberedImpact = Extract<NumberedCandidate, { ok: true }>;

/** 一个 owner、一个执行锁：按钮和协调器等待相同的影响确认终态。 */
export const createNumberedSubmission = (options: {
  getVersion: () => EditorSessionVersion;
  commit: (
    operation: ILXMNumberedVoiceCommand,
  ) => ILXMApplyScoreCommandResult | null;
  check: (
    operation: ILXMNumberedVoiceCommand,
    candidate: NumberedImpact,
    group: NumberedDraftGroup,
    grouped: boolean,
  ) => string | null;
  onPending: (impact: NumberedImpact | null) => void;
  onSuccess: (
    group: NumberedDraftGroup,
    operation: ILXMNumberedVoiceCommand,
    result: Extract<ILXMApplyScoreCommandResult, { ok: true }>,
    grouped: boolean,
  ) => void;
}) => {
  let committing = false;
  let active: {
    version: EditorSessionVersion;
    operation: ILXMNumberedVoiceCommand;
    group: NumberedDraftGroup;
    grouped: boolean;
    candidate: NumberedImpact;
    isCurrent: () => boolean;
    resolve: (result: NumberedPropertyApplyResult) => void;
  } | null = null;
  const settle = (result: NumberedPropertyApplyResult) => {
    const request = active;
    active = null;
    options.onPending(null);
    request?.resolve(result);
  };
  const cancel = (status: "cancelled" | "stale" = "cancelled") => {
    if (active)
      settle({
        status,
        group: active.group,
        message:
          status === "stale"
            ? "预览已过期，请重新操作。"
            : "已取消，保留输入。",
      });
  };
  const confirm = () => {
    const request = active;
    if (!request) return;
    if (
      !sameEditorVersion(options.getVersion(), request.version) ||
      !request.isCurrent()
    ) {
      cancel("stale");
      return;
    }
    try {
      const issue = options.check(
        request.operation,
        request.candidate,
        request.group,
        request.grouped,
      );
      if (issue) {
        settle({ status: "blocked", group: request.group, message: issue });
        return;
      }
      committing = true;
      const result = options.commit({
        ...request.operation,
        expectedRevision: request.version.document!.documentRevision,
        confirmedRemovedMarkIds: request.candidate.removedMarkIds,
        confirmedChangedMarkIds: request.candidate.changedMarkIds,
      });
      committing = false;
      if (!result?.ok) {
        settle({
          status: "blocked",
          group: request.group,
          message: result?.message ?? "当前无法应用修改。",
        });
        return;
      }
      options.onSuccess(
        request.group,
        request.operation,
        result,
        request.grouped,
      );
      settle({
        status: result.changed ? "applied" : "noop",
        group: request.group,
      });
    } catch {
      committing = false;
      settle({
        status: "blocked",
        group: request.group,
        message: "提交失败，输入已保留。",
      });
    }
  };
  return {
    request(
      operation: ILXMNumberedVoiceCommand,
      group: NumberedDraftGroup,
      isCurrent = () => true,
      grouped = true,
    ): Promise<NumberedPropertyApplyResult> {
      if (active)
        return Promise.resolve({
          status: "blocked",
          group,
          message: "正在处理简谱修改，请先完成确认。",
        });
      const version = captureEditorVersion(options.getVersion());
      const track = version.document?.score.tracks.find(
        (item) => item.id === operation.trackId,
      );
      if (!track || !version.document || !isCurrent())
        return Promise.resolve({
          status: "stale",
          group,
          message: "当前目标已失效。",
        });
      const frozen = structuredClone(operation);
      const candidate = editNumberedTrack(
        track,
        frozen,
        createDocumentIdFactory(version.document),
        true,
      );
      const issue = candidate.ok
        ? options.check(frozen, candidate, group, grouped)
        : candidate.message;
      if (issue || !candidate.ok)
        return Promise.resolve({
          status: "blocked",
          group,
          message: issue ?? "当前修改无效。",
        });
      return new Promise((resolve) => {
        active = {
          version,
          operation: frozen,
          group,
          grouped,
          candidate,
          isCurrent,
          resolve,
        };
        if (
          candidate.movedEventIds.length ||
          candidate.resizedEventIds.length ||
          (frozen.type !== "numbered.mark.remove" &&
            (candidate.removedMarkIds.length ||
              candidate.changedMarkIds.length))
        )
          options.onPending(candidate);
        else confirm();
      });
    },
    confirm,
    cancel,
    invalidate: () => {
      if (
        active &&
        !committing &&
        !sameEditorVersion(options.getVersion(), active.version)
      )
        cancel("stale");
    },
    isBusy: () => !!active,
  };
};
