import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ILXMCommandEffect } from "@liuxianmao/lxm-editor";
import {
  EditorHistoryPanel,
  EditorHistoryRail,
  getEditorHistoryRows,
  reconcileExpandedHistoryIds,
  type EditorHistoryItem,
} from "../components/EditorShell/workspace/EditorHistoryPanel";
import {
  EditorFeedbackController,
  type EditorFeedbackEvent,
} from "../components/EditorShell/workspace/EditorFeedback";
import {
  EditorImpactDetails,
  EditorImpactNotice,
  formatEditorImpact,
  formatEditorImpactSummary,
} from "../components/EditorShell/workspace/EditorImpactNotice";

const effect: ILXMCommandEffect = {
  kind: "technique.removed",
  trackId: "track",
  measureId: "measure",
  measureNumber: 7,
  techniqueId: "technique",
  techniqueType: "slideUp",
};
const omission: ILXMCommandEffect = { ...effect, kind: "technique.omitted" };
const item = (
  id: string,
  effects: ILXMCommandEffect[] = [effect],
): EditorHistoryItem => ({
  id,
  label: `操作 ${id}`,
  target: { summary: "提交时第 7 小节" },
  effects,
});
const command = (eventId: string, entryId = "A"): EditorFeedbackEvent => ({
  eventId,
  source: "command",
  entryId,
  effects: [effect],
});
const copy = (eventId: string): EditorFeedbackEvent => ({
  eventId,
  source: "clipboard",
  effects: [{ ...omission }],
});
const panelProps = {
  open: true,
  entries: [item("A"), item("B"), item("C")],
  appliedCount: 2,
  baselineAdvanced: false,
  sessionKey: 1,
  onClose: vi.fn(),
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  canUndo: true,
  canRedo: true,
};

describe("历史列表只读呈现", () => {
  it("按完整逻辑时间逆序，当前位于最后一条已应用操作", () => {
    expect(
      getEditorHistoryRows(panelProps.entries, 2).map(
        ({ entry, undone, current }) => [entry.id, undone, current],
      ),
    ).toEqual([
      ["C", true, false],
      ["B", false, true],
      ["A", false, false],
    ]);
    const markup = renderToStaticMarkup(<EditorHistoryPanel {...panelProps} />);
    expect(markup.indexOf("操作 C")).toBeLessThan(markup.indexOf("操作 B"));
    expect(markup.indexOf("操作 B")).toBeLessThan(markup.indexOf("操作 A"));
    expect(markup).toContain("已撤销");
    expect(markup).toContain("提交时第 7 小节");
    expect(markup).toContain('id="editor-history-panel"');
    expect(markup).toContain("data-history-panel");
    expect(markup).not.toContain('role="dialog"');
  });
  it("全部撤销时当前为裁切起点，不能声称回到原始状态", () => {
    const markup = renderToStaticMarkup(
      <EditorHistoryPanel {...panelProps} appliedCount={0} baselineAdvanced />,
    );
    expect(markup).toContain("更早状态（保留范围起点）");
    expect(markup.match(/已撤销/g)).toHaveLength(3);
    expect(markup.match(/>当前</g)).toHaveLength(1);
  });
  it("收起时不创建列表正文，空列表有明确说明", () => {
    expect(
      renderToStaticMarkup(<EditorHistoryPanel {...panelProps} open={false} />),
    ).not.toContain("操作 A");
    expect(
      renderToStaticMarkup(
        <EditorHistoryPanel {...panelProps} entries={[]} appliedCount={0} />,
      ),
    ).toContain("暂无操作");
  });
  it("无附带影响也有记录，但无多余详情入口", () => {
    const markup = renderToStaticMarkup(
      <EditorHistoryPanel {...panelProps} entries={[item("A", [])]} />,
    );
    expect(markup).toContain("操作 A");
    expect(markup).not.toContain("影响详情");
  });
  it("展开已撤销项只显示当时影响，保留来源位置", () => {
    const entries = [item("C")];
    const before = JSON.stringify(entries);
    const markup = renderToStaticMarkup(
      <EditorHistoryPanel
        {...panelProps}
        entries={entries}
        appliedCount={0}
        expandedEntryIds={["C"]}
      />,
    );
    expect(markup).toContain("此操作已撤销");
    expect(markup).toContain("编辑前第 7 小节");
    expect(markup).toContain("曾因目标或关系失效而移除");
    expect(JSON.stringify(entries)).toBe(before);
  });
  it("分叉和裁切清理不存在及无详情 ID，不复用到其他条目", () => {
    expect(
      reconcileExpandedHistoryIds(
        ["A", "C", "A", "X", "empty"],
        [item("A"), item("B"), item("empty", [])],
      ),
    ).toEqual(["A"]);
  });
  it("窄屏面板是具名 dialog，rail 具备可访问展开状态", () => {
    const markup = renderToStaticMarkup(
      <EditorHistoryPanel {...panelProps} modal blocked />,
    );
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('tabindex="-1"');
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
    const rail = renderToStaticMarkup(
      <EditorHistoryRail open onToggle={() => {}} />,
    );
    expect(rail).toContain('aria-expanded="true"');
    expect(rail).toContain('aria-controls="editor-history-panel"');
    expect(rail).toContain("data-history-rail");
  });
});

describe("影响详情语境", () => {
  it("保留 preview 确认前文案", () => {
    const markup = renderToStaticMarkup(
      <EditorImpactNotice effects={[effect]} preview />,
    );
    expect(markup).toContain("本次预览影响");
    expect(markup).toContain("确认后一起提交");
    expect(markup).toContain("将移除");
    expect(markup).not.toContain("已移除");
  });
  it("复制详情独立于文档撤销，不使用编辑或可撤销措辞", () => {
    const markup = renderToStaticMarkup(
      <EditorImpactDetails effects={[omission]} context="clipboard" />,
    );
    expect(markup).toContain("源曲谱未改变");
    expect(markup).toContain("复制范围第 7 小节");
    expect(markup).not.toContain("可撤销");
    expect(markup).not.toContain("本次编辑");
  });
  it("每种连音组效果有正文；未知类型可安全降级", () => {
    expect(
      formatEditorImpact({
        kind: "tuplets.structured",
        trackId: "t",
        measureId: "m",
        measureNumber: 3,
        operation: "set",
        ratio: { actual: 3, normal: 2 },
        count: 1,
      }),
    ).toContain("设置连音组（3:2，1 组）");
    const unknown = {
      kind: "future.effect",
      measureNumber: 8,
    } as unknown as ILXMCommandEffect;
    expect(formatEditorImpactSummary([unknown])).toBe("其他影响 1 项");
    expect(formatEditorImpact(unknown)).toBe("编辑前第 8 小节：其他附带影响");
    expect(
      renderToStaticMarkup(<EditorImpactNotice effects={[]} preview />),
    ).toBe("");
  });
});

describe("反馈 owner 生命周期与竞态", () => {
  afterEach(() => vi.useRealTimers());
  const setup = () => {
    vi.useFakeTimers();
    const controller = new EditorFeedbackController("session-1");
    const entries = [item("A"), item("B")];
    controller.update("session-1", command("event-1"), entries);
    return { controller, entries };
  };
  it("4 秒关闭，重复同 eventId 和 undo 清 effects 不重发", () => {
    const { controller, entries } = setup();
    vi.advanceTimersByTime(3999);
    expect(controller.getSnapshot().toast?.eventId).toBe("event-1");
    controller.update("session-1", null, entries);
    vi.advanceTimersByTime(1);
    expect(controller.getSnapshot().toast).toBeNull();
    controller.update("session-1", command("event-1"), entries);
    expect(controller.getSnapshot().toast).toBeNull();
    controller.dispose();
  });
  it("指针和焦点独立暂停，全部离开后按剩余时间继续", () => {
    const { controller } = setup();
    vi.advanceTimersByTime(1500);
    controller.pause("pointer", true);
    controller.pause("focus", true);
    vi.advanceTimersByTime(10000);
    controller.pause("pointer", false);
    vi.advanceTimersByTime(10000);
    expect(controller.getSnapshot().toast).not.toBeNull();
    controller.pause("focus", false);
    vi.advanceTimersByTime(2499);
    expect(controller.getSnapshot().toast).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(controller.getSnapshot().toast).toBeNull();
  });
  it("连续事件只显示最新，旧计时器和旧关闭回调不能清掉新事件", () => {
    const { controller, entries } = setup();
    vi.advanceTimersByTime(3000);
    controller.update("session-1", command("event-2", "B"), entries);
    controller.dismiss("event-1", "session-1");
    vi.advanceTimersByTime(3999);
    expect(controller.getSnapshot().toast?.eventId).toBe("event-2");
    vi.advanceTimersByTime(1);
    expect(controller.getSnapshot().toast).toBeNull();
  });
  it("用户关闭悬停或聚焦 toast 后，下一事件仍能超时", () => {
    const { controller, entries } = setup();
    controller.pause("focus", true);
    controller.pause("pointer", true);
    controller.dismiss("event-1", "session-1");
    controller.update("session-1", command("event-2"), entries);
    vi.advanceTimersByTime(4000);
    expect(controller.getSnapshot().toast).toBeNull();
  });
  it("原位替换 toast 保持实际悬停暂停；裁掉旧 toast 后不会残留暂停", () => {
    const { controller, entries } = setup();
    controller.pause("pointer", true);
    controller.update("session-1", command("event-2", "B"), entries);
    vi.advanceTimersByTime(6000);
    expect(controller.getSnapshot().toast?.eventId).toBe("event-2");
    controller.pause("pointer", false);
    vi.advanceTimersByTime(4000);
    expect(controller.getSnapshot().toast).toBeNull();
    controller.update("session-1", command("event-3", "A"), entries);
    controller.pause("pointer", true);
    controller.update("session-1", command("event-3", "A"), [entries[1]!]);
    controller.update("session-1", command("event-4", "B"), [entries[1]!]);
    vi.advanceTimersByTime(4000);
    expect(controller.getSnapshot().toast).toBeNull();
  });
  it("复制详情使用独立快照，toast 超时和新事件不关闭详情", async () => {
    const { controller, entries } = setup();
    const source = copy("copy-1");
    controller.update("session-1", source, entries);
    const onOpen = vi.fn(() => true);
    await controller.showDetails("copy-1", "session-1", onOpen);
    expect(onOpen).not.toHaveBeenCalled();
    expect(controller.getSnapshot().clipboardDetails?.effects).not.toBe(
      source.effects,
    );
    (source.effects[0] as { measureNumber: number }).measureNumber = 99;
    vi.advanceTimersByTime(4000);
    expect(controller.getSnapshot().toast).toBeNull();
    expect(
      controller.getSnapshot().clipboardDetails?.effects[0]?.measureNumber,
    ).toBe(7);
    controller.update("session-1", command("event-2"), entries);
    expect(controller.getSnapshot().clipboardDetails?.eventId).toBe("copy-1");
    controller.closeClipboardDetails();
    expect(controller.getSnapshot().clipboardDetails).toBeNull();
    controller.dispose();
  });
  it("布局保护返回 false 保留请求，toast 到时仍可重试，true 才清理", async () => {
    const { controller } = setup();
    const blocked = vi.fn(async () => false);
    await controller.showDetails("event-1", "session-1", blocked);
    expect(controller.getSnapshot().pendingEntryId).toBe("A");
    vi.advanceTimersByTime(4000);
    expect(controller.getSnapshot().pendingEntryId).toBe("A");
    const opened = vi.fn(async () => true);
    await controller.retry(opened);
    expect(opened).toHaveBeenCalledWith("A");
    expect(controller.getSnapshot().pendingEntryId).toBeNull();
  });
  it("隐藏暂停计时和历史打开，但保留 pending 与复制快照", async () => {
    const { controller, entries } = setup();
    controller.update("session-1", copy("copy"), entries);
    await controller.showDetails("copy", "session-1", () => true);
    controller.update("session-1", command("event-2"), entries);
    controller.pause("hidden", true);
    const onOpen = vi.fn(() => true);
    await controller.showDetails("event-2", "session-1", onOpen);
    vi.advanceTimersByTime(9000);
    expect(onOpen).not.toHaveBeenCalled();
    expect(controller.getSnapshot().pendingEntryId).toBe("A");
    expect(controller.getSnapshot().clipboardDetails).not.toBeNull();
    expect(controller.getSnapshot().toast).not.toBeNull();
    controller.pause("hidden", false);
    await controller.retry(onOpen);
    expect(onOpen).toHaveBeenCalledWith("A");
    controller.dispose();
  });
  it("分叉或裁切清理入口和 pending，不打开别的条目", async () => {
    const { controller, entries } = setup();
    await controller.showDetails("event-1", "session-1", () => false);
    controller.update(
      "session-1",
      command("event-1"),
      entries.filter((entry) => entry.id !== "A"),
    );
    const onOpen = vi.fn(() => true);
    await controller.retry(onOpen);
    expect(onOpen).not.toHaveBeenCalled();
    expect(controller.getSnapshot().toast).toBeNull();
    expect(controller.getSnapshot().pendingEntryId).toBeNull();
  });
  it("换文档清所有 UI，旧异步打开结果不能吞掉新请求", async () => {
    const { controller, entries } = setup();
    let complete!: (value: boolean) => void;
    const oldRequest = controller.showDetails(
      "event-1",
      "session-1",
      () =>
        new Promise<boolean>((resolve) => {
          complete = resolve;
        }),
    );
    controller.update("session-2", command("event-1", "B"), entries);
    await controller.showDetails("event-1", "session-2", () => false);
    complete(true);
    await oldRequest;
    expect(controller.getSnapshot().pendingEntryId).toBe("B");
    controller.dismiss("event-1", "session-1");
    expect(controller.getSnapshot().toast).not.toBeNull();
    controller.update("session-3", null, []);
    expect(controller.getSnapshot()).toEqual({
      sessionKey: "session-3",
      toast: null,
      clipboardDetails: null,
      pendingEntryId: null,
    });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("同会话旧请求完成不能吞掉最新请求，卸载取消计时", async () => {
    const { controller, entries } = setup();
    let complete!: (value: boolean) => void;
    const old = controller.showDetails(
      "event-1",
      "session-1",
      () =>
        new Promise<boolean>((resolve) => {
          complete = resolve;
        }),
    );
    controller.update("session-1", command("event-2", "B"), entries);
    await controller.showDetails("event-2", "session-1", () => false);
    complete(true);
    await old;
    expect(controller.getSnapshot().pendingEntryId).toBe("B");
    controller.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("无 effects 或无有效 entry 的事件不生成提示", () => {
    const { controller, entries } = setup();
    controller.update(
      "session-1",
      { ...command("empty"), effects: [] },
      entries,
    );
    expect(controller.getSnapshot().toast).toBeNull();
    controller.update("session-1", command("invalid", "missing"), entries);
    expect(controller.getSnapshot().toast).toBeNull();
  });
});
