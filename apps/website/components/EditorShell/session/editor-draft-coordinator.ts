import {
  sameEditorSession,
  sameEditorVersion,
  type EditorSessionVersion,
} from "./editor-session-version";

export type EditorDraftKind =
  | "fret"
  | "settings"
  | "lyric"
  | "numbered"
  | "chord"
  | "technique"
  | "beatPaste";
export type EditorDraftApplyResult = "applied" | "blocked" | "stale";

/** 每个 hook 实例独占一个 owner；generation 在接受离开时同步递增。 */
export interface EditorDraftOwner {
  readonly token: symbol;
  generation: number;
}
export const createEditorDraftOwner = (): EditorDraftOwner => ({
  token: Symbol("editor-draft-owner"),
  generation: 0,
});
export interface EditorDraftRegistration {
  owner: EditorDraftOwner;
  generation: number;
}

export interface EditorDraftRecord {
  id: string;
  kind: EditorDraftKind;
  targetKey: string;
  label: string;
  /** 只用于输出闸门定位；不参与版本、确认 token 或协调行为。 */
  location?: string;
  dirty: boolean;
  composing: boolean;
  canApply: boolean;
  error: string | null;
  version: EditorSessionVersion;
  /** 同一 owner 的实际输入身份；仅重新登记不使等待中的确认过期。 */
  inputKey?: string;
  focus: () => boolean;
  /** 异步准备完成后、真正写入前必须再次检查 isCurrent。 */
  apply: (context: {
    isCurrent: () => boolean;
  }) => EditorDraftApplyResult | Promise<EditorDraftApplyResult>;
  discard: () => boolean;
}

export type EditorDraftAction =
  | { type: "focus" | "apply" | "discard"; id: string }
  | { type: "discardAll"; confirmation?: number };
export type EditorDraftActionResult =
  | { status: "accepted"; discarded: number }
  | { status: "blocked"; reason: string }
  | { status: "stale" }
  | { status: "needs-confirmation"; ids: string[]; confirmation: number };

/** 会话级草稿目录：只协调 UI owner，不持有音乐内容，也不自动批量应用。 */
export const createEditorDraftCoordinator = (
  getVersion: () => EditorSessionVersion,
) => {
  const records = new Map<string, EditorDraftRecord>();
  const registrations = new WeakMap<
    EditorDraftRecord,
    EditorDraftRegistration
  >();
  const listeners = new Set<() => void>();
  let revision = 0;
  let busy = false;
  let busyOwner: EditorDraftOwner | undefined;
  const publish = () => {
    revision += 1;
    listeners.forEach((listener) => listener());
  };
  const inspect = (exceptOwner?: EditorDraftOwner) => {
    const pending = [...records.values()].filter(
      (record) => (record.dirty || record.composing || record.error) &&
        (!exceptOwner || registrations.get(record)?.owner.token !== exceptOwner.token),
    );
    return {
      pending,
      composing: pending.some((record) => record.composing),
      busy: busy && (!exceptOwner || busyOwner?.token !== exceptOwner.token),
    };
  };
  const attempt = (action: () => boolean): boolean => {
    try {
      return action();
    } catch {
      return false;
    }
  };
  const ownerIsCurrent = (record: EditorDraftRecord) => {
    const registration = registrations.get(record);
    return (
      !registration || registration.owner.generation === registration.generation
    );
  };
  const sameOwner = (left: EditorDraftRecord, right: EditorDraftRecord) => {
    const a = registrations.get(left),
      b = registrations.get(right);
    return a?.owner.token === b?.owner.token && a?.generation === b?.generation;
  };
  const request = async (
    action: EditorDraftAction,
  ): Promise<EditorDraftActionResult> => {
    if (busy) return { status: "blocked", reason: "正在处理草稿，请稍候。" };
    if (inspect().composing)
      return { status: "blocked", reason: "请先完成输入法组合输入。" };
    if (action.type === "discardAll") {
      const pending = inspect().pending;
      if (!pending.length) return { status: "accepted", discarded: 0 };
      if (action.confirmation !== revision)
        return {
          status: "needs-confirmation",
          ids: pending.map((record) => record.id),
          confirmation: revision,
        };
      let discarded = 0;
      // 确认绑定目录版本；任何回调改变其他草稿时立即停止，不能清除新输入。
      const confirmedRevision = revision;
      busy = true;
      try {
        for (const record of pending) {
          if (revision !== confirmedRevision) break;
          if (attempt(record.discard)) discarded += 1;
        }
      } finally {
        busy = false;
        publish();
      }
      return { status: "accepted", discarded };
    }
    const record = records.get(action.id);
    if (!record) return { status: "stale" };
    if (action.type === "focus")
      return attempt(record.focus)
        ? { status: "accepted", discarded: 0 }
        : { status: "blocked", reason: "请从原编辑入口定位这处草稿。" };
    if (action.type === "discard") {
      busy = true;
      const discarded = attempt(record.discard);
      busy = false;
      publish();
      return discarded
        ? { status: "accepted", discarded: 1 }
        : { status: "blocked", reason: "当前草稿暂时不能丢弃。" };
    }
    if (!sameEditorVersion(getVersion(), record.version))
      return { status: "stale" };
    if (!record.canApply || record.error)
      return {
        status: "blocked",
        reason: record.error ?? "请在原表单完成校验。",
      };
    busy = true;
    busyOwner = registrations.get(record)?.owner;
    publish();
    try {
      const result = await record.apply({
        isCurrent: () =>
          ownerIsCurrent(record) &&
          (records.get(record.id) === record ||
            (record.inputKey !== undefined &&
              records.get(record.id)?.inputKey === record.inputKey &&
              sameOwner(record, records.get(record.id)!) &&
              sameEditorVersion(
                records.get(record.id)!.version,
                record.version,
              ))) &&
          sameEditorVersion(getVersion(), record.version),
      });
      // 成功提交本来就会改变文档版本；这里只阻止旧会话的迟到结果。
      if (
        !ownerIsCurrent(record) ||
        !sameEditorSession(getVersion(), record.version) ||
        result === "stale"
      )
        return { status: "stale" };
      return result === "applied"
        ? { status: "accepted", discarded: 0 }
        : { status: "blocked", reason: "草稿尚未提交，请继续在原表单处理。" };
    } catch {
      return {
        status: "blocked",
        reason: "草稿处理失败，输入仍由原表单保留。",
      };
    } finally {
      busy = false;
      busyOwner = undefined;
      publish();
    }
  };
  return {
    register(
      record: EditorDraftRecord,
      registration?: EditorDraftRegistration,
    ) {
      // effect 使用 render 时捕获的代次；接受离开后迟到的 effect 无权复活记录。
      if (
        registration &&
        registration.owner.generation !== registration.generation
      )
        return () => {};
      // 清理使用登记实例身份，旧 effect 的清理不能删除同 ID 的新登记。
      const entry = { ...record };
      if (registration) registrations.set(entry, { ...registration });
      records.set(entry.id, entry);
      publish();
      return () => {
        if (records.get(entry.id) === entry) {
          records.delete(entry.id);
          publish();
        }
      };
    },
    invalidateOwner(owner: EditorDraftOwner) {
      owner.generation += 1;
      // 一个设置 owner 可登记多个组；只删除仍属于这个实例的登记。
      for (const [id, record] of records) {
        if (registrations.get(record)?.owner.token === owner.token)
          records.delete(id);
      }
      publish();
    },
    inspect,
    /** 仅供专用设置交接核对实际登记身份，不能据此免除其他草稿。 */
    registrationOf: (record: EditorDraftRecord) => registrations.get(record),
    request,
    isOutputBlocked: () => busy || inspect().pending.length > 0,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => revision,
  };
};
export type EditorDraftCoordinator = ReturnType<
  typeof createEditorDraftCoordinator
>;
