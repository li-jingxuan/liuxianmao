import { describe, expect, it, vi } from "vitest";
import {
  EXAMPLE_MVP_7_2_DOCUMENT,
  LXMScoreCommandEnum,
  type ILXMNumberedVoiceCommand,
} from "@liuxianmao/lxm-editor";
import { createEditorSession } from "../stores/editor-store";
import { createNumberedSubmission } from "../components/EditorShell/numbered-submission";
import {
  createEditorDraftCoordinator,
  type EditorDraftRecord,
} from "../components/EditorShell/editor-draft-coordinator";
import { captureEditorVersion } from "../components/EditorShell/editor-session-version";

const setup = () => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  const measure = track.measures[0]!;
  const event = measure.numberedVoice.events[0]!;
  track.numberedMarks = [
    { id: "s3-fermata", type: "fermata", eventId: event.id },
  ];
  const session = createEditorSession(document);
  const onPending = vi.fn(),
    onSuccess = vi.fn();
  const check = vi.fn((): string | null => null);
  const commit = vi.fn((operation: ILXMNumberedVoiceCommand) =>
    session.getState().execute(operation),
  );
  const owner = createNumberedSubmission({
    getVersion: session.getState,
    commit,
    check,
    onPending,
    onSuccess,
  });
  session.subscribe(() => owner.invalidate());
  const remove: ILXMNumberedVoiceCommand = {
    type: "numbered.event.remove",
    trackId: track.id,
    measureId: measure.id,
    eventId: event.id,
  };
  return {
    session,
    owner,
    track,
    measure,
    event,
    remove,
    onPending,
    onSuccess,
    commit,
    check,
  };
};

describe("S3 简谱提交终态", () => {
  it("影响确认前零写入，确认成功才结束 Promise，一次撤销恢复内容和记号", async () => {
    const { owner, session, remove, commit, onSuccess } = setup();
    const original = session.getState().document;
    const result = owner.request(remove, "content");
    expect(owner.isBusy()).toBe(true);
    expect(commit).not.toHaveBeenCalled();
    owner.confirm();
    expect(await result).toEqual({ status: "applied", group: "content" });
    expect(commit).toHaveBeenCalledOnce();
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(session.getState().historyDepth.past).toBe(1);
    session.getState().undo();
    expect(session.getState().document).toEqual(original);
  });

  it("取消及 Esc 共用结算，释放执行锁并保留文档", async () => {
    const { owner, remove, commit } = setup();
    const first = owner.request(remove, "content");
    owner.cancel();
    expect(await first).toMatchObject({ status: "cancelled" });
    expect(owner.isBusy()).toBe(false);
    const second = owner.request(remove, "content");
    owner.cancel();
    expect(await second).toMatchObject({ status: "cancelled" });
    owner.confirm();
    expect(commit).not.toHaveBeenCalled();
  });

  it("双入口重复应用不会重复提交或另开确认", async () => {
    const { owner, remove, commit } = setup();
    const first = owner.request(remove, "content");
    expect(await owner.request(remove, "content")).toMatchObject({
      status: "blocked",
    });
    owner.confirm();
    owner.confirm();
    expect(await first).toMatchObject({ status: "applied" });
    expect(commit).toHaveBeenCalledOnce();
  });

  it.each(["replace", "undo"] as const)(
    "%s 使等待中的旧候选结算 stale，迟到确认零写入",
    async (change) => {
      const { owner, session, remove, commit } = setup();
      const result = owner.request(remove, "content");
      if (change === "replace")
        session.getState().replaceDocument(EXAMPLE_MVP_7_2_DOCUMENT);
      else {
        session
          .getState()
          .execute({
            type: LXMScoreCommandEnum.SetNotationInfo,
            title: "changed",
            arranger: "",
            keySignature: "C",
          });
        session.getState().undo();
      }
      expect(await result).toMatchObject({ status: "stale" });
      owner.confirm();
      expect(commit).not.toHaveBeenCalled();
      expect(owner.isBusy()).toBe(false);
    },
  );

  it("待确认期间依赖冲突再次检查，阻断后保留文档与历史", async () => {
    const { owner, remove, check, commit, session } = setup();
    const result = owner.request(remove, "content");
    check.mockReturnValue("先处理 A 草稿");
    owner.confirm();
    expect(await result).toMatchObject({
      status: "blocked",
      message: "先处理 A 草稿",
    });
    expect(commit).not.toHaveBeenCalled();
    expect(session.getState().historyDepth.past).toBe(0);
  });

  it("输入代次失效或卸载结算后不允许旧回调写入", async () => {
    const { owner, remove, commit } = setup();
    let current = true;
    const result = owner.request(remove, "content", () => current);
    current = false;
    owner.confirm();
    expect(await result).toMatchObject({ status: "stale" });
    const unmounted = owner.request(remove, "content");
    owner.cancel("stale");
    expect(await unmounted).toMatchObject({ status: "stale" });
    expect(commit).not.toHaveBeenCalled();
  });

  it("协调器重登记相同输入不使确认过期，实际输入变化则失效", async () => {
    const { session, owner, remove, commit } = setup();
    const coordinator = createEditorDraftCoordinator(session.getState);
    const record = (inputKey: string): EditorDraftRecord => ({
      id: "s3",
      kind: "numbered",
      targetKey: "target",
      label: "简谱",
      dirty: true,
      composing: false,
      canApply: true,
      error: null,
      inputKey,
      version: captureEditorVersion(session.getState()),
      focus: () => true,
      discard: () => true,
      apply: async ({ isCurrent }) => {
        const result = await owner.request(remove, "content", isCurrent);
        return result.status === "applied" || result.status === "noop"
          ? "applied"
          : result.status === "stale"
            ? "stale"
            : "blocked";
      },
    });
    coordinator.register(record("a"));
    const first = coordinator.request({ type: "apply", id: "s3" });
    coordinator.register(record("a"));
    owner.confirm();
    expect(await first).toMatchObject({ status: "accepted" });
    expect(commit).toHaveBeenCalledOnce();
    session.getState().undo();
    coordinator.register(record("a"));
    const changed = coordinator.request({ type: "apply", id: "s3" });
    coordinator.register(record("b"));
    owner.confirm();
    expect(await changed).toMatchObject({ status: "stale" });
    expect(commit).toHaveBeenCalledOnce();
  });

  it("无变化的命令返回 noop，提交失败释放锁且不确认成功", async () => {
    const { owner, track, measure, event, session, commit } = setup();
    expect(
      await owner.request(
        {
          type: "numbered.event.setRhythm",
          trackId: track.id,
          measureId: measure.id,
          eventId: event.id,
          rhythm: event.rhythm,
        },
        "rhythm",
      ),
    ).toMatchObject({ status: "noop" });
    expect(session.getState().historyDepth.past).toBe(0);
    commit.mockImplementationOnce(() => {
      throw new Error("failed");
    });
    expect(
      await owner.request(
        {
          type: "numbered.event.setRhythm",
          trackId: track.id,
          measureId: measure.id,
          eventId: event.id,
          rhythm: { base: "eighth", dots: 0 },
        },
        "rhythm",
      ),
    ).toMatchObject({ status: "blocked" });
    expect(owner.isBusy()).toBe(false);
  });
});
