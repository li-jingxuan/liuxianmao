import { describe, it, expect, vi } from "vitest";
import {
  EXAMPLE_MVP_7_2_DOCUMENT,
  createCollapsedTabCellSelection,
  planBeatPaste,
  type ILXMScoreCommand,
  LXMScoreCommandEnum as C,
} from "@liuxianmao/lxm-editor";
import { createEditorSession } from "../stores/editor-store";
import { createEditorDraftCoordinator } from "../components/EditorShell/editor-draft-coordinator";
import { createEditorModalController } from "../components/EditorShell/editor-modal-controller";
import { createEditorCommandAdapter } from "../components/EditorShell/editor-command-adapter";
import { createBeatPasteController } from "../components/EditorShell/beat-paste-controller";

/** 使用真实 store/核心规划验证历史、版本与影响确认，而非只断言组件 state。 */
const setup = (marked = false) => {
  const source = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT),
    track = source.score.tracks[0]!;
  track.techniques = [];
  track.numberedMarks = [];
  track.measures = [
    {
      id: "m",
      timeSignature: { numerator: 4, denominator: 4 },
      barline: "final",
      lyrics: [],
      chordSymbols: [],
      tuplets: [],
      beats: Array.from({ length: 4 }, (_, i) => ({
        id: `b${i}`,
        tick: i * 960,
        rhythm: { base: "quarter" as const, dots: 0 },
        kind: "notes" as const,
        notes: [{ id: `n${i}`, string: 1, fret: i + 3 }],
      })),
      numberedVoice: {
        events: marked
          ? [
              {
                id: "e",
                tick: 0,
                rhythm: { base: "quarter", dots: 0 },
                kind: "notes",
                items: [{ id: "item", token: "1" }],
              },
            ]
          : [],
        tuplets: [],
      },
    },
  ];
  if (marked)
    track.numberedMarks = [{ id: "mark", type: "fermata", eventId: "e" }];
  const session = createEditorSession(source);
  expect(session.getState().document).not.toBeNull();
  const target = { trackId: track.id, measureId: "m", beatId: "b0", string: 1 };
  session.getState().setSelection(createCollapsedTabCellSelection(target));
  session.getState().copyBeats({
    ...target,
    startBeatId: "b0",
    endBeatId: "b0",
    layers: "both",
  });
  const drafts = createEditorDraftCoordinator(session.getState);
  const restore = vi.fn(),
    modals = createEditorModalController(session.getState, () => restore);
  const execute = vi.fn(createEditorCommandAdapter(session, modals));
  let blocked: string | null = null;
  const controller = createBeatPasteController({
    session,
    drafts,
    modals,
    execute,
    beforeAction: vi.fn(),
    getBlockedReason: () => blocked,
    restoreFocus: restore,
  });
  const release = controller.start();
  const unsubscribe = session.subscribe(modals.invalidate);
  const dispose = () => {
    release();
    unsubscribe();
  };
  return {
    session,
    target,
    drafts,
    modals,
    controller,
    execute,
    restore,
    dispose,
    block: (value: string | null) => {
      blocked = value;
      controller.invalidate();
    },
  };
};

describe("稳定拍点粘贴预览", () => {
  it.each(["undo", "redo"] as const)(
    "%s 历史切换直接使已准备候选失效，不能按回退后的 revision 继续应用",
    async (action) => {
      const s = setup();
      s.session.getState().execute({
        type: C.SetNotationInfo,
        title: "历史候选基线",
        arranger: "",
        keySignature: "C",
      });
      if (action === "redo") s.session.getState().undo();
      await s.controller.request({ type: "prepare", mode: "overwrite" });
      expect(s.controller.getSnapshot().candidate).not.toBeNull();
      s.session.getState()[action]();
      expect(s.controller.getSnapshot().candidate).toBeNull();
      expect(s.drafts.isOutputBlocked()).toBe(false);
      expect(await s.controller.request({ type: "apply" })).toBe(false);
      expect(s.execute).not.toHaveBeenCalled();
      s.dispose();
    },
  );

  it("StrictMode 式启动/清理/重启仅保留当前草稿登记", async () => {
    const s = setup();
    s.dispose();
    const release = s.controller.start();
    await s.controller.request({ type: "prepare", mode: "overwrite" });
    expect(s.drafts.inspect().pending).toHaveLength(1);
    release();
    expect(s.drafts.inspect().pending).toHaveLength(0);
    expect(s.modals.isOpen()).toBe(false);
    const nextRelease = s.controller.start();
    await s.controller.request({ type: "prepare", mode: "overwrite" });
    expect(s.drafts.inspect().pending).toHaveLength(1);
    nextRelease();
    expect(s.drafts.isOutputBlocked()).toBe(false);
  });

  it("Modal 确认与协调器应用同时触发时共享同一次提交", async () => {
    const s = setup();
    const originalExecute = s.execute.getMockImplementation()!;
    // 延后真正写入，确保第二入口命中提交中的锁，而不是提交后的版本失效。
    s.execute.mockImplementation(async (...args) => {
      await Promise.resolve();
      return originalExecute(...args);
    });
    await s.controller.request({ type: "prepare", mode: "overwrite" });
    await s.controller.request({ type: "confirm", checked: true });
    const record = s.drafts.inspect().pending[0]!;
    const first = s.modals.confirm(s.modals.getSnapshot()!.id);
    const second = s.drafts.request({ type: "apply", id: record.id });
    expect(await first).toBe(true);
    expect(await second).toMatchObject({ status: "blocked" });
    expect(s.execute).toHaveBeenCalledTimes(1);
    expect(s.session.getState().historyDepth.past).toBe(1);
    expect(s.drafts.isOutputBlocked()).toBe(false);
    s.dispose();
  });

  it("prepare 同步登记草稿；无确认不写入，取消保留剪贴板且零历史", async () => {
    const s = setup(),
      original = s.session.getState().document;
    const preparing = s.controller.request({
      type: "prepare",
      mode: "overwrite",
    });
    expect(s.drafts.isOutputBlocked()).toBe(true);
    expect(await preparing).toBe(true);
    expect(await s.controller.request({ type: "apply" })).toBe(false);
    expect(s.session.getState().document).toBe(original);
    await s.controller.request({ type: "cancel" });
    expect(s.drafts.isOutputBlocked()).toBe(false);
    expect(s.session.getState().historyDepth.past).toBe(0);
    expect(s.session.getState().getBeatClipboard()).not.toBeNull();
    s.dispose();
  });
  it("自己的预览/Modal 不自锁；一次粘贴及全部关联内容一次撤销", async () => {
    const s = setup(),
      original = s.session.getState().document;
    await s.controller.request({ type: "prepare", mode: "overwrite" });
    await s.controller.request({ type: "confirm", checked: true });
    const result = s.controller.request({ type: "apply" });
    expect(await s.controller.request({ type: "apply" })).toBe(false);
    expect(await result).toBe(true);
    expect(s.execute).toHaveBeenCalledTimes(1);
    expect(s.modals.isOpen()).toBe(false);
    expect(s.drafts.isOutputBlocked()).toBe(false);
    expect(s.controller.getSnapshot().notice).toContain("已粘贴");
    expect(s.session.getState().historyDepth.past).toBe(1);
    s.session.getState().undo();
    expect(s.session.getState().document).toBe(original);
    s.dispose();
  });
  it("草稿协调器应用走同一 busy 锁，不被自己的登记挡住", async () => {
    const s = setup();
    await s.controller.request({ type: "prepare", mode: "overwrite" });
    await s.controller.request({ type: "confirm", checked: true });
    const record = s.drafts.inspect().pending[0]!;
    expect(
      await s.drafts.request({ type: "apply", id: record.id }),
    ).toMatchObject({ status: "accepted" });
    expect(s.session.getState().historyDepth.past).toBe(1);
    s.dispose();
  });
  it("模式变更重算且清确认；无效模式保留原目标和错误", async () => {
    const s = setup();
    await s.controller.request({ type: "prepare", mode: "overwrite" });
    await s.controller.request({ type: "confirm", checked: true });
    const clipboard = s.controller.getSnapshot().candidate!.clipboard;
    await s.controller.request({ type: "mode", mode: "insert" });
    expect(s.controller.getSnapshot().confirmed).toBe(false);
    expect(s.controller.getSnapshot().candidate?.clipboard).toBe(clipboard);
    await s.controller.request({ type: "mode", mode: "overwrite" });
    expect(s.controller.canApply()).toBe(false);
    s.dispose();
  });
  for (const change of [
    "document",
    "selection",
    "anchor",
    "clipboard",
    "session",
    "undo",
  ] as const) {
    it(`${change} 改变显式作废预览并解除登记，旧候选零提交`, async () => {
      const s = setup();
      await s.controller.request({ type: "prepare", mode: "overwrite" });
      await s.controller.request({ type: "confirm", checked: true });
      if (change === "document" || change === "undo") {
        s.session.getState().execute({
          type: C.SetNotationInfo,
          title: "外部修改",
          arranger: "",
          keySignature: "C",
        });
        if (change === "undo") s.session.getState().undo();
      } else if (change === "selection")
        s.session
          .getState()
          .setSelection(
            createCollapsedTabCellSelection({ ...s.target, string: 2 }),
          );
      else if (change === "anchor")
        s.session.getState().setSelection({
          anchor: { ...s.target, string: 2 },
          focus: s.target,
        });
      else if (change === "clipboard")
        s.session
          .getState()
          .copyBeats({ ...s.target, startBeatId: "b1", endBeatId: "b1" });
      else
        s.session
          .getState()
          .replaceDocument(structuredClone(s.session.getState().document));
      expect(s.controller.getSnapshot().candidate).toBeNull();
      expect(s.drafts.isOutputBlocked()).toBe(false);
      expect(await s.controller.request({ type: "apply" })).toBe(false);
      expect(s.execute).not.toHaveBeenCalled();
      s.dispose();
    });
  }
  it("仅改下次复制偏好不改变旧载荷；无关错误通知不使候选过期", async () => {
    const s = setup();
    await s.controller.request({ type: "prepare", mode: "overwrite" });
    const candidate = s.controller.getSnapshot().candidate;
    await s.controller.request({ type: "layers", layers: "tab" });
    s.session.getState().setErrorMessage("无关通知");
    expect(s.controller.getSnapshot().candidate).toBe(candidate);
    expect(candidate?.clipboard.layers).toBe("both");
    s.dispose();
  });
  it("失败复制保留旧载荷与剪贴板版本，不使已有合法预览失效", async () => {
    const s = setup();
    await s.controller.request({ type: "prepare", mode: "overwrite" });
    const candidate = s.controller.getSnapshot().candidate;
    const clipboard = s.session.getState().getBeatClipboard();
    const version = s.session.getState().clipboardVersion;
    expect(
      s.session.getState().copyBeats({
        ...s.target,
        startBeatId: "missing",
        endBeatId: "b1",
        layers: "tab",
      }),
    ).toBe(false);
    expect(s.session.getState().getBeatClipboard()).toEqual(clipboard);
    expect(s.session.getState().clipboardVersion).toBe(version);
    expect(s.controller.getSnapshot().candidate).toBe(candidate);
    expect(s.session.getState().historyDepth.past).toBe(0);
    s.dispose();
  });
  it("追加简谱记号影响仍在同一 Modal，重新确认后一次提交", async () => {
    const s = setup(true),
      original = s.session.getState().document;
    await s.controller.request({ type: "prepare", mode: "overwrite" });
    const id = s.modals.getSnapshot()!.id;
    await s.controller.request({ type: "confirm", checked: true });
    expect(await s.controller.request({ type: "apply" })).toBe(false);
    expect(s.modals.getSnapshot()?.id).toBe(id);
    expect(s.controller.getSnapshot()).toMatchObject({
      phase: "needs-impact",
      confirmed: false,
      candidate: { removedIds: ["mark"] },
    });
    expect(s.session.getState().document).toBe(original);
    await s.controller.request({ type: "confirm", checked: true });
    expect(await s.controller.request({ type: "apply" })).toBe(true);
    expect(s.session.getState().historyDepth.past).toBe(1);
    s.session.getState().undo();
    expect(s.session.getState().document).toBe(original);
    s.dispose();
  });
  it("其他 Modal 占用、活动对象保护均不制造可应用候选", async () => {
    const s = setup();
    const id = s.modals.open({
      kind: "keyboard-help",
      title: "帮助",
      message: "",
    })!;
    expect(
      await s.controller.request({ type: "prepare", mode: "overwrite" }),
    ).toBe(false);
    expect(s.drafts.isOutputBlocked()).toBe(false);
    s.modals.close(id, "cancel");
    s.block("简谱正在编辑");
    expect(
      await s.controller.request({ type: "prepare", mode: "overwrite" }),
    ).toBe(false);
    expect(s.controller.getSnapshot().notice).toContain("简谱");
    s.dispose();
  });
  it("核心失败保留预览与载荷、禁用旧候选，切模式重新规划后可再试", async () => {
    const s = setup(),
      original = s.session.getState().document;
    await s.controller.request({ type: "prepare", mode: "overwrite" });
    await s.controller.request({ type: "confirm", checked: true });
    s.execute.mockResolvedValueOnce({
      status: "blocked",
      message: "目标当前不可写",
    });
    expect(await s.controller.request({ type: "apply" })).toBe(false);
    expect(s.modals.isOpen()).toBe(true);
    expect(s.controller.getSnapshot()).toMatchObject({
      phase: "planning-error",
      confirmed: false,
      error: "目标当前不可写",
    });
    expect(s.controller.canApply()).toBe(false);
    expect(s.session.getState().document).toBe(original);
    expect(s.session.getState().historyDepth.past).toBe(0);
    await s.controller.request({ type: "mode", mode: "overwrite" });
    await s.controller.request({ type: "confirm", checked: true });
    expect(await s.controller.request({ type: "apply" })).toBe(true);
    s.dispose();
  });

  it("活动对象保护改变时立即作废，不靠文档版本变化触发", async () => {
    const s = setup();
    await s.controller.request({ type: "prepare", mode: "overwrite" });
    s.block("当前激活独立简谱");
    expect(s.controller.getSnapshot().candidate).toBeNull();
    expect(s.drafts.isOutputBlocked()).toBe(false);
    expect(s.modals.isOpen()).toBe(false);
    expect(s.session.getState().historyDepth.past).toBe(0);
    s.dispose();
  });

  it("卸载后迟到失败不覆盖后来新建的候选和登记", async () => {
    const s = setup();
    await s.controller.request({ type: "prepare", mode: "overwrite" });
    await s.controller.request({ type: "confirm", checked: true });
    let finish!: (value: { status: "blocked"; message: string }) => void;
    s.execute.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const old = s.controller.request({ type: "apply" });
    s.dispose();
    const release = s.controller.start();
    await s.controller.request({ type: "prepare", mode: "overwrite" });
    const candidate = s.controller.getSnapshot().candidate;
    finish({ status: "blocked", message: "迟到错误" });
    expect(await old).toBe(false);
    expect(s.controller.getSnapshot().candidate).toBe(candidate);
    expect(s.drafts.inspect().pending).toHaveLength(1);
    expect(s.controller.getSnapshot().error).toBeNull();
    release();
  });

  it("公共确认适配器返回最终结果；取消零历史，确认之后才成功", async () => {
    const s = setup(true),
      original = s.session.getState().document;
    const clipboard = s.session.getState().getBeatClipboard()!;
    const plan = planBeatPaste(
      original!,
      { ...s.target, mode: "overwrite" },
      clipboard,
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const command: ILXMScoreCommand = {
      type: C.PasteBeats,
      ...s.target,
      mode: "overwrite" as const,
      clipboard,
      allowOverwrite: true,
      expectedConfirmationKey: plan.confirmationKey,
    };
    const execute = createEditorCommandAdapter(s.session, s.modals);
    const cancelled = execute(command);
    const firstId = s.modals.getSnapshot()!.id;
    expect(s.modals.getSnapshot()!.request.kind).toBe("structure-impact");
    expect(s.session.getState().document).toBe(original);
    s.modals.close(firstId, "cancel");
    expect(await cancelled).toMatchObject({ status: "cancelled" });
    const stale = execute(command);
    s.session
      .getState()
      .setSelection(
        createCollapsedTabCellSelection({ ...s.target, string: 2 }),
      );
    expect(await stale).toMatchObject({ status: "stale" });
    expect(s.session.getState().historyDepth.past).toBe(0);
    s.session
      .getState()
      .setSelection(createCollapsedTabCellSelection(s.target));
    const applied = execute(command);
    const secondId = s.modals.getSnapshot()!.id;
    expect(s.session.getState().historyDepth.past).toBe(0);
    expect(await s.modals.confirm(secondId)).toBe(true);
    expect(await applied).toMatchObject({ status: "applied" });
    expect(s.session.getState().historyDepth.past).toBe(1);
    s.session.getState().undo();
    expect(s.session.getState().document).toBe(original);
    s.dispose();
  });
});
