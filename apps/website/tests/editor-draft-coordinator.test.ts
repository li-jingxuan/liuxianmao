import { describe, expect, it, vi } from "vitest";
import {
  EXAMPLE_MVP_7_2_DOCUMENT,
  LXMScoreCommandEnum,
} from "@liuxianmao/lxm-editor";
import { createEditorSession } from "../stores/editor-store";
import {
  createEditorDraftCoordinator,
  type EditorDraftRecord,
  type EditorDraftApplyResult,
} from "../components/EditorShell/editor-draft-coordinator";
import { captureEditorVersion } from "../components/EditorShell/editor-session-version";

const setup = () => {
  const session = createEditorSession(EXAMPLE_MVP_7_2_DOCUMENT);
  const coordinator = createEditorDraftCoordinator(session.getState);
  const record = (
    overrides: Partial<EditorDraftRecord> = {},
  ): EditorDraftRecord => ({
    id: "numbered:A",
    kind: "numbered",
    targetKey: "event/A/item/1",
    label: "简谱 A",
    dirty: true,
    composing: false,
    canApply: true,
    error: null,
    version: captureEditorVersion(session.getState()),
    focus: () => true,
    apply: () => "applied",
    discard: () => true,
    ...overrides,
  });
  return { session, coordinator, record };
};

describe("会话草稿协调器", () => {
  it("汇总 A/B 暂存与错误、组合输入，干净记录不阻断输出且不写历史", () => {
    const { session, coordinator, record } = setup();
    coordinator.register(record({ id: "clean", dirty: false }));
    expect(coordinator.isOutputBlocked()).toBe(false);
    for (const draft of [
      record(),
      record({ id: "numbered:B" }),
      record({ id: "invalid", dirty: false, error: "目标失效" }),
      record({ id: "ime", dirty: false, composing: true }),
    ])
      coordinator.register(draft);
    expect(coordinator.inspect().pending.map((draft) => draft.id)).toEqual([
      "numbered:A",
      "numbered:B",
      "invalid",
      "ime",
    ]);
    expect(coordinator.inspect().pending[0]?.location).toBeUndefined();
    expect(coordinator.inspect().composing).toBe(true);
    expect(coordinator.isOutputBlocked()).toBe(true);
    expect(session.getState().historyDepth.past).toBe(0);
  });

  it("草稿位置只用于呈现，不影响版本判断和放弃确认", async () => {
    const { coordinator, record } = setup();
    coordinator.register(record({ location: "第 2 小节 · 第 3 拍" }));
    expect(coordinator.inspect().pending[0]).toMatchObject({
      location: "第 2 小节 · 第 3 拍",
      version: expect.any(Object),
    });
    const first = await coordinator.request({ type: "discardAll" });
    expect(first.status).toBe("needs-confirmation");
    if (first.status !== "needs-confirmation") throw new Error("缺少确认");
    await expect(
      coordinator.request({
        type: "discardAll",
        confirmation: first.confirmation,
      }),
    ).resolves.toEqual({ status: "accepted", discarded: 1 });
  });

  it("同 ID 更新后，旧登记清理不能删除新的 owner", () => {
    const { coordinator, record } = setup();
    const oldCleanup = coordinator.register(record());
    const newCleanup = coordinator.register(record({ label: "恢复后的 A" }));
    oldCleanup();
    expect(coordinator.inspect().pending[0]?.label).toBe("恢复后的 A");
    newCleanup();
    expect(coordinator.isOutputBlocked()).toBe(false);
  });

  it("组合输入期间阻止应用、丢弃和焦点迁移", async () => {
    const { coordinator, record } = setup();
    const apply = vi.fn(() => "applied" as const),
      discard = vi.fn(() => true),
      focus = vi.fn(() => true);
    coordinator.register(record({ composing: true, apply, discard, focus }));
    for (const type of ["apply", "discard", "focus"] as const)
      expect(
        await coordinator.request({ type, id: "numbered:A" }),
      ).toMatchObject({ status: "blocked" });
    expect(apply).not.toHaveBeenCalled();
    expect(discard).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  });

  it("全量丢弃先确认目录快照，新增草稿后旧确认无效且返回实际数量", async () => {
    const { coordinator, record } = setup();
    const discardA = vi.fn(() => true),
      discardB = vi.fn(() => false);
    coordinator.register(record({ discard: discardA }));
    const first = await coordinator.request({ type: "discardAll" });
    expect(first.status).toBe("needs-confirmation");
    if (first.status !== "needs-confirmation") throw new Error("缺少确认");
    coordinator.register(record({ id: "numbered:B", discard: discardB }));
    const next = await coordinator.request({
      type: "discardAll",
      confirmation: first.confirmation,
    });
    expect(discardA).not.toHaveBeenCalled();
    if (next.status !== "needs-confirmation") throw new Error("旧确认应过期");
    expect(next.ids).toEqual(["numbered:A", "numbered:B"]);
    expect(
      await coordinator.request({
        type: "discardAll",
        confirmation: next.confirmation,
      }),
    ).toEqual({ status: "accepted", discarded: 1 });
    expect(discardA).toHaveBeenCalledOnce();
    expect(discardB).toHaveBeenCalledOnce();
    expect(
      await coordinator.request({
        type: "discardAll",
        confirmation: next.confirmation,
      }),
    ).toMatchObject({ status: "needs-confirmation" });
  });

  it("丢弃回调改变其他登记时停止，防止把刚生成的输入一起清空", async () => {
    const { coordinator, record } = setup();
    const discardB = vi.fn(() => true);
    coordinator.register(
      record({
        discard: () => {
          coordinator.register(record({ id: "new" }));
          return true;
        },
      }),
    );
    coordinator.register(record({ id: "B", discard: discardB }));
    const pending = await coordinator.request({ type: "discardAll" });
    if (pending.status !== "needs-confirmation") throw new Error("缺少确认");
    expect(
      await coordinator.request({
        type: "discardAll",
        confirmation: pending.confirmation,
      }),
    ).toEqual({ status: "accepted", discarded: 1 });
    expect(discardB).not.toHaveBeenCalled();
  });

  it("选择位置不使草稿过期，焦点定位不产生音乐历史", async () => {
    const { session, coordinator, record } = setup();
    const focus = vi.fn(() => true);
    coordinator.register(record({ focus }));
    session.getState().setSelection(null);
    expect(
      await coordinator.request({ type: "focus", id: "numbered:A" }),
    ).toEqual({ status: "accepted", discarded: 0 });
    expect(focus).toHaveBeenCalledOnce();
    expect(session.getState().historyDepth.past).toBe(0);
  });

  it("成功应用自身引起版本变化不误报 stale，一次命令仍只有一条历史", async () => {
    const { session, coordinator, record } = setup();
    coordinator.register(
      record({
        apply: ({ isCurrent }) => {
          if (!isCurrent()) return "stale";
          const result = session.getState().execute({
            type: LXMScoreCommandEnum.SetNotationInfo,
            title: "应用草稿",
            arranger: "",
            keySignature: "C",
          });
          return result?.ok ? "applied" : "blocked";
        },
      }),
    );
    expect(
      await coordinator.request({ type: "apply", id: "numbered:A" }),
    ).toEqual({ status: "accepted", discarded: 0 });
    expect(session.getState().document?.score.title).toBe("应用草稿");
    expect(session.getState().historyDepth.past).toBe(1);
    expect(
      await coordinator.request({ type: "apply", id: "numbered:A" }),
    ).toEqual({ status: "stale" });
  });

  it("撤销回原文档对象仍使旧记录过期，不调用旧 apply", async () => {
    const { session, coordinator, record } = setup();
    const apply = vi.fn(() => "applied" as const);
    coordinator.register(record({ apply }));
    const before = session.getState().document;
    session.getState().execute({
      type: LXMScoreCommandEnum.SetNotationInfo,
      title: "新内容",
      arranger: "",
      keySignature: "C",
    });
    session.getState().undo();
    expect(session.getState().document).toBe(before);
    expect(
      await coordinator.request({ type: "apply", id: "numbered:A" }),
    ).toEqual({ status: "stale" });
    expect(apply).not.toHaveBeenCalled();
  });

  it("异步应用互斥，替换会话后 owner 的提交前检查拒绝迟到写入", async () => {
    const { session, coordinator, record } = setup();
    let finish: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const write = vi.fn();
    coordinator.register(
      record({
        apply: async ({ isCurrent }): Promise<EditorDraftApplyResult> => {
          await ready;
          if (!isCurrent()) return "stale";
          write();
          return "applied";
        },
      }),
    );
    const first = coordinator.request({ type: "apply", id: "numbered:A" });
    expect(coordinator.inspect().busy).toBe(true);
    expect(
      await coordinator.request({ type: "discard", id: "numbered:A" }),
    ).toMatchObject({ status: "blocked" });
    session.getState().replaceDocument(EXAMPLE_MVP_7_2_DOCUMENT);
    finish!();
    expect(await first).toEqual({ status: "stale" });
    expect(write).not.toHaveBeenCalled();
    expect(coordinator.inspect().busy).toBe(false);
  });

  it("校验失败和异常保留记录，释放 busy 锁；未登记目标返回 stale", async () => {
    const { coordinator, record } = setup();
    coordinator.register(record({ error: "字段错误" }));
    expect(
      await coordinator.request({ type: "apply", id: "numbered:A" }),
    ).toMatchObject({ status: "blocked", reason: "字段错误" });
    coordinator.register(
      record({
        apply: () => {
          throw new Error("失败");
        },
      }),
    );
    expect(
      await coordinator.request({ type: "apply", id: "numbered:A" }),
    ).toMatchObject({ status: "blocked" });
    expect(coordinator.inspect().busy).toBe(false);
    expect(coordinator.inspect().pending).toHaveLength(1);
    expect(await coordinator.request({ type: "apply", id: "missing" })).toEqual(
      { status: "stale" },
    );
  });
  it("焦点和丢弃回调异常不会逃出协调器，全量丢弃只统计成功项", async () => {
    const { coordinator, record } = setup();
    const fail = () => {
      throw new Error("owner 错误");
    };
    coordinator.register(record({ focus: fail, discard: fail }));
    expect(
      await coordinator.request({ type: "focus", id: "numbered:A" }),
    ).toMatchObject({ status: "blocked" });
    expect(
      await coordinator.request({ type: "discard", id: "numbered:A" }),
    ).toMatchObject({ status: "blocked" });
    coordinator.register(record({ id: "B" }));
    const pending = await coordinator.request({ type: "discardAll" });
    if (pending.status !== "needs-confirmation") throw new Error("缺少确认");
    expect(
      await coordinator.request({
        type: "discardAll",
        confirmation: pending.confirmation,
      }),
    ).toEqual({ status: "accepted", discarded: 1 });
    expect(coordinator.inspect().busy).toBe(false);
  });

  it("单项丢弃使已展示的全量确认失效，不能重复使用旧确认清理", async () => {
    const { coordinator, record } = setup();
    const discard = vi.fn(() => true);
    coordinator.register(record({ discard }));
    const pending = await coordinator.request({ type: "discardAll" });
    if (pending.status !== "needs-confirmation") throw new Error("缺少确认");
    await coordinator.request({ type: "discard", id: "numbered:A" });
    expect(
      await coordinator.request({
        type: "discardAll",
        confirmation: pending.confirmation,
      }),
    ).toMatchObject({ status: "needs-confirmation" });
    expect(discard).toHaveBeenCalledOnce();
  });
});
