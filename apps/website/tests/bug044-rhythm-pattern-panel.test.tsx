import { isValidElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EXAMPLE_MVP_7_2_DOCUMENT, planRhythmPattern, TICKS_PER_QUARTER as Q, type ILXMNumberedEvent } from "@liuxianmao/lxm-editor";
import { RhythmPatternPanel, RhythmPatternProvider, useSharedRhythmPatternBusy, type RhythmPatternConfig } from "../components/EditorShell/tools/RhythmPatternPanel";
import { resolveEditorRhythmPatternTarget } from "../components/EditorShell/tools/editor-rhythm-pattern-target";
import type { MusicTextTarget } from "../components/EditorShell/music-text/music-text-draft";
import { createEditorSession } from "../stores/editor-store";

// SSR keeps the real hooks and markup. Retain only the preview state between renders
// so card callbacks and submission guards can be exercised without a DOM shim.
const harness = vi.hoisted(() => ({ preview: null as unknown }));
vi.mock("react", async load => {
  const react = await load<typeof import("react")>();
  return { ...react, useState: (initial: unknown) => {
    const isPreview = typeof initial === "function";
    const [value, setValue] = react.useState(isPreview && harness.preview ? harness.preview : initial);
    if (isPreview) harness.preview = value;
    return [value, (next: unknown) => {
      if (isPreview) harness.preview = typeof next === "function" ? next(value) : next;
      setValue(next);
    }];
  } };
});
afterEach(() => { harness.preview = null; });

const find = (tree: ReactNode, predicate: (props: Record<string, unknown>) => boolean): Record<string, unknown> | null => {
  if (Array.isArray(tree)) {
    for (const child of tree) { const result = find(child, predicate); if (result) return result; }
  } else if (isValidElement<Record<string, unknown>>(tree)) {
    return predicate(tree.props) ? tree.props : find(tree.props.children as ReactNode, predicate);
  }
  return null;
};
const setup = () => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const track = document.score.tracks[0]!;
  const measure = track.measures[0]!;
  document.score.tracks = [track]; track.measures = [measure]; track.techniques = []; track.numberedMarks = [];
  measure.timeSignature = { numerator: 4, denominator: 4 };
  measure.tuplets = []; measure.lyrics = []; measure.chordSymbols = [];
  measure.numberedVoice = { tuplets: [], events: Array.from({ length: 4 }, (_, i): ILXMNumberedEvent => ({
    id: `e${i}`, tick: i * Q, kind: "notes", rhythm: { base: "quarter", dots: 0 }, items: [{ id: `i${i}`, token: "1" }],
  })) };
  measure.beats = Array.from({ length: 4 }, (_, i) => ({ id: `b${i}`, tick: i * Q, kind: "notes" as const,
    rhythm: { base: "quarter" as const, dots: 0 }, notes: [{ id: `n${i}`, string: 1, fret: 3 }] }));
  const cell = { trackId: track.id, measureId: measure.id, beatId: "b0", string: 1 };
  const input = { active: { kind: "numbered", trackId: track.id, measureId: measure.id, eventId: "e0" } as MusicTextTarget | null };
  return { document, track, measure, cell, input };
};
const mount = (fixture: ReturnType<typeof setup>, options: { staleGetters?: boolean; beforeAction?: () => void } = {}) => {
  const { document, cell, input } = fixture;
  const session = createEditorSession(document);
  expect(session.getState().document, session.getState().errorMessage ?? "valid fixture").not.toBeNull();
  const getTargetResult = () => resolveEditorRhythmPatternTarget(session.getState().document!, { anchor: cell, focus: cell }, null, input.active);
  const getTargetIdentity = () => JSON.stringify(getTargetResult());
  const initialTarget = getTargetResult(), initialIdentity = getTargetIdentity();
  const execute = vi.fn<ComponentProps<typeof RhythmPatternPanel>["execute"]>(async command => {
    const result = session.getState().execute(command);
    if (!result) throw new Error("No command result");
    return result.ok ? { status: result.changed ? "applied" : "noop", result } : { status: "blocked", message: result.message };
  });
  const onSuccess = vi.fn();
  const render = () => {
    let tree: ReactNode;
    const Host = () => {
      tree = RhythmPatternPanel({ session, document: session.getState().document!, targetResult: getTargetResult(),
        targetIdentity: getTargetIdentity(),
        getTargetResult: options.staleGetters ? () => initialTarget : getTargetResult,
        getTargetIdentity: options.staleGetters ? () => initialIdentity : getTargetIdentity,
        execute, beforeAction: options.beforeAction ?? (() => {}),
        blocked: false, getBlocked: () => false, onClose: () => {}, onSuccess, onBusyChange: () => {},
      });
      return tree;
    };
    const markup = renderToStaticMarkup(<Host />);
    return { markup, tree: tree!, apply: find(tree!, props => props.children === "应用节奏型")! };
  };
  return { render, session, execute, onSuccess };
};
const setBeatPattern = (measure: ReturnType<typeof setup>["measure"], beatIndex: number, matched: boolean) => {
  const original = measure.numberedVoice.events.find(event => event.id === `e${beatIndex}`)!;
  const rhythms: ILXMNumberedEvent["rhythm"][] = matched
    ? [{ base: "eighth", dots: 0 }, { base: "eighth", dots: 0 }]
    : [{ base: "eighth", dots: 0 }, { base: "sixteenth", dots: 1 }, { base: "thirtySecond", dots: 0 }];
  let tick = beatIndex * Q;
  const events = rhythms.map((rhythm, index): ILXMNumberedEvent => {
    const event = { ...original, kind: "notes" as const, id: index ? `${original.id}-${index}` : original.id, tick, rhythm,
      items: [{ id: `${original.id}-pattern-item-${index}`, token: "1" }] };
    tick += rhythm.base === "eighth" ? Q / 2 : rhythm.base === "sixteenth" ? Q * 3 / 8 : Q / 8;
    return event;
  });
  measure.numberedVoice.events = [...measure.numberedVoice.events.filter(event => event.tick < beatIndex * Q || event.tick >= (beatIndex + 1) * Q), ...events]
    .sort((a, b) => a.tick - b.tick);
};

describe("BUG044 节奏型面板初始选择", () => {
  it("打开匹配活动简谱焦点所在拍，忽略残留TAB选择；重新打开重新识别", () => {
    const fixture = setup();
    const { document, track, measure, input } = fixture;
    const p = planRhythmPattern(document, { layer: "numbered", trackId: track.id, measureId: measure.id,
      startTick: Q, endTick: Q, focusTick: Q }, "two-thirtyseconds-dotted");
    if (!p.ok) throw new Error(p.message);
    track.measures = p.track.measures;
    input.active = { kind: "numbered", trackId: track.id, measureId: measure.id, eventId: p.after[1]!.id };
    const panel = mount(fixture);
    expect(panel.render().markup).toMatch(/aria-pressed="true"[^>]*data-rhythm-template="two-thirtyseconds-dotted"/);
    input.active = null;
    harness.preview = null; // A new opening must not retain the previous selection.
    expect(panel.render().markup).toMatch(/aria-pressed="true"[^>]*data-rhythm-template="quarter"/);
    expect(panel.session.getState().historyDepth).toEqual({ past: 0, future: 0 });
  });

  it("无匹配保持空选和禁用应用；显式选择模板仍可预览和原子提交", async () => {
    const fixture = setup();
    fixture.measure.numberedVoice.events.splice(0, 1, { ...fixture.measure.numberedVoice.events[0]!, rhythm: { base: "eighth", dots: 0 } });
    const panel = mount(fixture);
    const initial = panel.render();
    expect(initial.markup).not.toContain('aria-pressed="true"');
    expect(initial.markup).toContain("当前拍未匹配到节奏型，请选择模板。");
    expect(initial.apply.disabled).toBe(true);
    expect(panel.session.getState().historyDepth).toEqual({ past: 0, future: 0 });
    const card = find(initial.tree, props => (props.template as { id?: string } | undefined)?.id === "eight-sixteen")!;
    (card.onSelect as () => void)();
    const selected = panel.render();
    expect(selected.markup).toMatch(/aria-pressed="true"[^>]*data-rhythm-template="eight-sixteen"/);
    expect(selected.apply.disabled).toBe(false);
    (selected.apply.onClick as () => void)();
    await Promise.resolve(); await Promise.resolve();
    expect(panel.execute).toHaveBeenCalledOnce();
    expect(panel.onSuccess).toHaveBeenCalledOnce();
    expect(panel.session.getState().historyDepth).toEqual({ past: 1, future: 0 });
  });

  it("无匹配后显式选模板仍保护跨窗口长音，不允许提交", () => {
    const fixture = setup();
    fixture.measure.numberedVoice.events.splice(0, 2, { ...fixture.measure.numberedVoice.events[0]!, rhythm: { base: "half", dots: 0 } });
    const panel = mount(fixture);
    const initial = panel.render();
    expect(initial.markup).not.toContain('aria-pressed="true"');
    (find(initial.tree, props => (props.template as { id?: string } | undefined)?.id === "eight-sixteen")!.onSelect as () => void)();
    const selected = panel.render();
    expect(selected.markup).toContain("跨出处理范围");
    expect(selected.apply.disabled).toBe(true);
    (selected.apply.onClick as () => void)();
    expect(panel.execute).not.toHaveBeenCalled();
  });

  it.each([
    ["target", true], ["target", false], ["document", true], ["document", false],
  ] as const)("自动识别在%s变化后重新推断（新拍匹配=%s），不会沿用旧四分模板", (change, matched) => {
    const fixture = setup();
    if (change === "target") setBeatPattern(fixture.measure, 1, matched);
    const panel = mount(fixture);
    expect(panel.render().markup).toMatch(/aria-pressed="true"[^>]*data-rhythm-template="quarter"/);
    if (change === "target") {
      fixture.input.active = { kind: "numbered", trackId: fixture.track.id, measureId: fixture.measure.id, eventId: "e1" };
    } else {
      const next = structuredClone(panel.session.getState().document!);
      setBeatPattern(next.score.tracks[0]!.measures[0]!, 0, matched);
      expect(panel.session.getState().replaceDocument(JSON.stringify(next), "file").ok).toBe(true);
    }
    const refreshed = panel.render();
    expect(refreshed.markup).not.toContain("重新计算预览");
    if (matched) {
      expect(refreshed.markup).toMatch(/aria-pressed="true"[^>]*data-rhythm-template="eighths"/);
      expect(refreshed.apply.disabled).toBe(false);
    } else {
      expect(refreshed.markup).not.toContain('aria-pressed="true"');
      expect(refreshed.markup).toContain("当前拍未匹配到节奏型，请选择模板。");
      expect(refreshed.apply.disabled).toBe(true);
    }
    expect(panel.session.getState().historyDepth).toEqual({ past: 0, future: 0 });
  });

  it.each(["target", "document"] as const)("%s变化自动清除旧手选；旧应用回调不能提交", (change) => {
    const fixture = setup();
    if (change === "target") setBeatPattern(fixture.measure, 1, false);
    const panel = mount(fixture);
    const choose = (tree: ReactNode) => (find(tree, props => (props.template as { id?: string } | undefined)?.id === "eight-sixteen")!.onSelect as () => void)();
    choose(panel.render().tree);
    const previous = panel.render();
    expect(previous.apply.disabled).toBe(false);
    if (change === "target") {
      fixture.input.active = { kind: "numbered", trackId: fixture.track.id, measureId: fixture.measure.id, eventId: "e1" };
    } else {
      const next = structuredClone(panel.session.getState().document!);
      setBeatPattern(next.score.tracks[0]!.measures[0]!, 0, false);
      expect(panel.session.getState().replaceDocument(JSON.stringify(next), "file").ok).toBe(true);
    }
    (previous.apply.onClick as () => void)();
    expect(panel.execute).not.toHaveBeenCalled();
    let refreshed = panel.render();
    expect(refreshed.markup).not.toContain('aria-pressed="true"');
    expect(refreshed.apply.disabled).toBe(true);
    expect(refreshed.markup).not.toContain("重新计算预览");
    choose(refreshed.tree);
    refreshed = panel.render();
    expect(refreshed.markup).toMatch(/aria-pressed="true"[^>]*data-rhythm-template="eight-sixteen"/);
    expect(refreshed.apply.disabled).toBe(false);
    expect(panel.session.getState().historyDepth).toEqual({ past: 0, future: 0 });
  });

  it("预览列出失效连接，应用保留仍适用的记号并可撤销", async () => {
    const fixture = setup();
    fixture.track.numberedMarks = [{ id: "affected", type: "tie", fromItemId: "i0", toItemId: "i1" }, { id: "kept", type: "fermata", eventId: "e0" }, { id: "outside", type: "fermata", eventId: "e3" }];
    fixture.track.techniques = [{ id: "tab-kept", type: "vibrato", fromNoteId: "n0" }];
    const panel = mount(fixture);
    const initial = panel.render();
    expect(initial.markup).toContain("应用后保留仍适用的技巧和连线");
    expect(initial.markup).not.toContain("应用将移除");
    for (const removed of ["选择模板", "常用", "每张覆盖", "确认调整节奏与标记", "应用时需确认"]) expect(initial.markup).not.toContain(removed);
    expect(initial.markup).toContain("第 1 小节 · 第 1 拍");
    expect(initial.markup).not.toContain("三十二分细分");
    expect(initial.markup.match(/data-rhythm-template=/g)).toHaveLength(12);
    (find(initial.tree, props => (props.template as { id?: string } | undefined)?.id === "eighths")!.onSelect as () => void)();
    const selected = panel.render();
    expect(selected.markup).toContain("应用将移除：延音线");
    (selected.apply.onClick as () => void)();
    await Promise.resolve(); await Promise.resolve();
    expect(panel.execute).toHaveBeenCalledOnce();
    expect(panel.execute.mock.calls[0]![0]).toMatchObject({ allowRemoveMarks: true });
    expect(panel.session.getState().document!.score.tracks[0]!.numberedMarks.map(mark => mark.id)).toEqual(["kept", "outside"]);
    expect(panel.session.getState().document!.score.tracks[0]!.techniques).toEqual(fixture.track.techniques);
    expect(panel.session.getState().historyDepth.past).toBe(1);
    panel.session.getState().undo();
    expect(panel.session.getState().document).toEqual(fixture.document);
  });

  it("props目标先更新、实时getter仍指向旧拍时，render按新props刷新且不会循环重渲染", () => {
    const fixture = setup();
    setBeatPattern(fixture.measure, 1, true);
    const panel = mount(fixture, { staleGetters: true });
    expect(panel.render().markup).toMatch(/aria-pressed="true"[^>]*data-rhythm-template="quarter"/);
    fixture.input.active = { kind: "numbered", trackId: fixture.track.id, measureId: fixture.measure.id, eventId: "e1" };
    const next = panel.render();
    expect(next.markup).toMatch(/aria-pressed="true"[^>]*data-rhythm-template="eighths"/);
    // 直到 getter 追上前，提交瞬时校验仍拒绝旧会话目标。
    (next.apply.onClick as () => void)();
    expect(panel.execute).not.toHaveBeenCalled();
  });

  it("beforeAction改变文档时不能把旧预览提交到新文档", async () => {
    const fixture = setup();
    const panel = mount(fixture, { beforeAction: () => {
      const next = structuredClone(panel.session.getState().document!);
      next.documentRevision++;
      panel.session.setState({ document: next });
    } });
    (find(panel.render().tree, props => (props.template as { id?: string } | undefined)?.id === "eighths")!.onSelect as () => void)();
    (panel.render().apply.onClick as () => void)();
    await Promise.resolve();
    expect(panel.execute).not.toHaveBeenCalled();
    expect(panel.session.getState().historyDepth.past).toBe(0);
  });
});

describe("REQ044 侧栏与工具栏共享节奏型", () => {
  const mountShared = (fixture = setup(), executeOverride?: RhythmPatternConfig["execute"]) => {
    const session = createEditorSession(fixture.document);
    const getTargetResult = () => resolveEditorRhythmPatternTarget(session.getState().document!, null, null, fixture.input.active);
    const getTargetIdentity = () => JSON.stringify(getTargetResult());
    const execute = vi.fn<RhythmPatternConfig["execute"]>(executeOverride ?? (async command => {
      const result = session.getState().execute(command);
      if (!result) throw new Error("No result");
      return result.ok ? { status: result.changed ? "applied" : "noop", result } : { status: "blocked", message: result.message };
    }));
    const onSuccess = vi.fn(), toolbarSuccess = vi.fn(), onBusyChange = vi.fn();
    const render = () => {
      const trees: Record<string, ReactNode> = {};
      const config: RhythmPatternConfig = { session, document: session.getState().document!, targetResult: getTargetResult(),
        targetIdentity: getTargetIdentity(), getTargetResult, getTargetIdentity, execute, beforeAction: () => {},
        blocked: false, getBlocked: () => false, onSuccess, onBusyChange };
      const Surface = ({ sidebar }: { sidebar: boolean }) => {
        trees[sidebar ? "sidebar" : "toolbar"] = RhythmPatternPanel({ ...config, presentation: sidebar ? "sidebar" : "toolbar", onClose: () => {},
          onSuccess: sidebar ? onSuccess : toolbarSuccess });
        return trees[sidebar ? "sidebar" : "toolbar"];
      };
      const markup = renderToStaticMarkup(<RhythmPatternProvider {...config}><Surface sidebar /><Surface sidebar={false} /></RhythmPatternProvider>);
      return { markup, trees, apply: (surface: string) => find(trees[surface], props => props.children === "应用节奏型")!,
        choose: (surface: string, id: string) => (find(trees[surface], props => (props.template as { id?: string } | undefined)?.id === id)!.onSelect as () => void)() };
    };
    return { render, session, execute, onSuccess, toolbarSuccess, onBusyChange, fixture };
  };

  it("任一入口手选同步同一模板；双入口旧回调只能提交一次并同时通知根与发起工具栏", async () => {
    const panel = mountShared();
    panel.render().choose("sidebar", "eighths");
    const selected = panel.render();
    expect(selected.markup.match(/aria-pressed="true"[^>]*data-rhythm-template="eighths"/g)).toHaveLength(2);
    (selected.apply("toolbar").onClick as () => void)();
    (selected.apply("sidebar").onClick as () => void)();
    await Promise.resolve(); await Promise.resolve();
    expect(panel.execute).toHaveBeenCalledOnce();
    expect(panel.onSuccess).toHaveBeenCalledOnce();
    expect(panel.toolbarSuccess).toHaveBeenCalledOnce();
    expect(panel.session.getState().historyDepth.past).toBe(1);
    (selected.apply("sidebar").onClick as () => void)();
    expect(panel.execute).toHaveBeenCalledOnce();
  });

  it("侧栏提交调用根成功回调，共享锁覆盖命令等待期间另一入口及模板切换", async () => {
    let resolve!: (result: Awaited<ReturnType<RhythmPatternConfig["execute"]>>) => void;
    const panel = mountShared(undefined, () => new Promise(done => { resolve = done; }));
    const initial = panel.render();
    (initial.apply("sidebar").onClick as () => void)();
    initial.choose("toolbar", "eighths");
    (initial.apply("toolbar").onClick as () => void)();
    expect(panel.execute).toHaveBeenCalledOnce();
    expect(panel.onBusyChange).toHaveBeenLastCalledWith(true);
    resolve({ status: "cancelled", message: "已取消" });
    await Promise.resolve(); await Promise.resolve();
    expect(panel.onBusyChange).toHaveBeenLastCalledWith(false);
    expect(panel.onSuccess).not.toHaveBeenCalled();
    expect(panel.session.getState().historyDepth.past).toBe(0);
  });

  it("旧模板回调在手选变化后失效；同一预览的noop也不能被另一入口重复提交", async () => {
    const panel = mountShared();
    const initial = panel.render();
    initial.choose("sidebar", "eighths");
    (initial.apply("toolbar").onClick as () => void)();
    expect(panel.execute).not.toHaveBeenCalled();
    harness.preview = null;
    const current = panel.render();
    (current.apply("sidebar").onClick as () => void)();
    await Promise.resolve(); await Promise.resolve();
    (current.apply("toolbar").onClick as () => void)();
    expect(panel.execute).toHaveBeenCalledOnce();
    expect(panel.onSuccess).toHaveBeenCalledOnce();
    expect(panel.toolbarSuccess).not.toHaveBeenCalled();
  });

  it.each([[4, 4, 12, 14], [3, 4, 12, 10], [6, 8, 9, 10]])("%s/%s 在两个入口显示 %s 拍内和 %s 整小节模板", (numerator, denominator, count, measures) => {
    const fixture = setup();
    fixture.measure.timeSignature = { numerator, denominator: denominator as 4 | 8 };
    if (numerator !== 4) {
      fixture.measure.beats = fixture.measure.beats.slice(0, 3);
      fixture.measure.numberedVoice.events = fixture.measure.numberedVoice.events.slice(0, 3);
    }
    const panel = mountShared(fixture);
    const result = panel.render();
    expect(result.markup.match(/data-rhythm-template=/g)).toHaveLength(count * 2);
    expect(result.markup.match(/data-rhythm-measure-template=/g)).toHaveLength(measures * 2);
    expect(result.markup).toContain("整小节模板");
    expect(result.markup).not.toContain("三十二分细分");
    expect(result.markup).not.toContain("逐拍套用");
    expect(result.markup).not.toContain("保留 1 个内容位置");
  });

  it("Provider缺失时busy hook兼容返回false", () => {
    const Consumer = () => <span>{String(useSharedRhythmPatternBusy())}</span>;
    expect(renderToStaticMarkup(<Consumer />)).toBe("<span>false</span>");
  });

  it("侧栏显示应用位置、具体标记影响及跨范围警告", () => {
    const fixture = setup();
    fixture.track.numberedMarks = [{ id: "impact", type: "tie", fromItemId: "i0", toItemId: "i1" }];
    const panel = mountShared(fixture);
    const { trees } = panel.render();
    (find(trees.sidebar, props => (props.template as { id?: string } | undefined)?.id === "eighths")!.onSelect as () => void)();
    const result = panel.render();
    const sidebarMarkup = renderToStaticMarkup(result.trees.sidebar);
    expect(sidebarMarkup).toContain("常见节奏型");
    expect(sidebarMarkup).toContain("应用将移除");
    expect(sidebarMarkup).toContain("包含跨出当前范围的连接");
    expect(sidebarMarkup).toContain("点击应用一并确认");
    expect(sidebarMarkup).toContain("第 1 小节 · 第 1 拍");
    for (const text of ["逐拍套用", "保留 1 个内容位置", "三十二分细分", "取消", "六线谱 ·"]) expect(sidebarMarkup).not.toContain(text);
  });

  it("清空选区后两个入口均不显示模板，旧回调不能提交", () => {
    const fixture = setup();
    const panel = mountShared(fixture);
    const initial = panel.render();
    expect(initial.markup).toContain("常见节奏型");
    fixture.input.active = null;
    const result = panel.render();
    expect(result.markup).toBe("");
    (initial.apply("sidebar").onClick as () => void)();
    expect(panel.execute).not.toHaveBeenCalled();
  });
});
