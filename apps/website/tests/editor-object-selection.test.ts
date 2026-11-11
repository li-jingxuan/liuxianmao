import { describe, expect, it } from "vitest";
import {
  A4_CONTENT_WIDTH,
  EXAMPLE_MVP_7_2_DOCUMENT,
  buildLayout,
  createCollapsedTabCellSelection,
  resolveTechniqueSelection,
  LXMScoreCommandEnum as C,
  type ILXMTabCellReference,
} from "@liuxianmao/lxm-editor";
import {
  resolveScorePointerAction,
  isScoreSelectionValid,
  resolveScoreDeleteCommand,
} from "../components/EditorShell/session/editor-object-selection";
import {
  readMusicTextDraft,
  resolveSidebarRequest,
} from "../components/EditorShell/music-text/music-text-draft";
import { createEditorStore } from "../stores/editor-store";
import { resolveChordFocus } from "../components/EditorShell/score/music-text-focus";

/** 路由与草稿决策直接调用生产模块，保持真实布局、命中和业务 ID。 */
const fixture = () => {
  const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
  const layout = buildLayout(document, { systemWidth: A4_CONTENT_WIDTH });
  const measure = layout.systems[0]!.measures[0]!;
  const target: ILXMTabCellReference = {
    trackId: document.score.tracks[0]!.id,
    measureId: measure.id,
    beatId: measure.beats[0]!.id,
    string: 1,
  };
  return {
    document,
    layout,
    measure,
    target,
    lyricTarget: {
      kind: "lyric" as const,
      trackId: target.trackId,
      measureId: target.measureId,
      eventId: measure.numberedNotation![0]!.eventId,
      verse: 1 as const,
    },
    selection: createCollapsedTabCellSelection(target),
  };
};

describe("谱面对象选择与文字页签解耦", () => {
  it("删除已选 let ring 只移除技巧，保留覆盖的音符、琶音和扫弦，并可一步撤销", () => {
    const { document } = fixture();
    const track = document.score.tracks[0]!;
    const ring = track.techniques.find((item) => item.type === "letRing")!;
    const selection = resolveTechniqueSelection(document, ring.id, "start")!;
    const store = createEditorStore(document);
    store.getState().setSelection(selection);
    store.getState().setSelectedTechniqueId(ring.id);
    const before = store.getState().document!;
    const command = resolveScoreDeleteCommand(before, selection, ring.id)!;
    expect(command).toEqual({ type: C.RemoveTechnique, trackId: track.id, techniqueId: ring.id });
    expect(store.getState().execute(command)).toMatchObject({ ok: true, changed: true });
    const after = store.getState().document!;
    expect(after.score.tracks[0]!.measures).toEqual(before.score.tracks[0]!.measures);
    expect(after.score.tracks[0]!.techniques).toEqual(track.techniques.filter((item) => item.id !== ring.id));
    expect(store.getState().selectedTechniqueId).toBeNull();
    const visible = buildLayout(after).systems.flatMap((system) => system.techniques.map((item) => item.techniqueId));
    for (const technique of track.techniques.filter((item) => item.type === "arpeggio" || item.type === "strum"))
      expect(visible).toContain(technique.id);
    expect(store.getState().historyDepth.past).toBe(1);
    store.getState().undo();
    expect(store.getState().document).toBe(before);
  });
  it("普通 TAB 删除仍删除音符；失效技巧 ID 不回退删除底层音符", () => {
    const { document, selection, target } = fixture();
    expect(resolveScoreDeleteCommand(document, selection, null)).toMatchObject({
      type: C.RemoveNotesInRect, range: { trackId: target.trackId, anchor: selection.anchor, focus: selection.focus },
    });
    expect(resolveScoreDeleteCommand(document, selection, "missing-technique")).toBeNull();
    expect(resolveScoreDeleteCommand(document, null, null)).toBeNull();
  });
  it("和弦锚点使用真实图元，空拍使用 TAB 光标，失效位置不借邻近拍", () => {
    const { layout, target, measure } = fixture();
    const bounds = layout.hitIndex.musicTextBounds!.find((item) => item.kind === "chord" && item.measureId === target.measureId && item.beatId === target.beatId);
    expect(resolveChordFocus(layout, { ...target, kind: "chord" })).toBe(bounds);
    const empty = measure.beats.find((beat) => !layout.hitIndex.musicTextBounds!.some((item) => item.kind === "chord" && item.measureId === target.measureId && item.beatId === beat.id))!;
    const focus = resolveChordFocus(layout, { ...target, beatId: empty.id, kind: "chord" });
    expect(focus).toMatchObject({ beatId: empty.id, measureId: target.measureId });
    expect(resolveChordFocus(layout, { ...target, beatId: "removed", kind: "chord" })).toBeNull();
  });
  it.each(["lyric", "numbered", "chord"] as const)(
    "%s 草稿下点击同拍弦格仍是六线谱选择，未应用内容直接丢弃",
    (kind) => {
      const { document, layout, measure, target, lyricTarget, selection } =
        fixture();
      const action = resolveScorePointerAction(
        document,
        layout,
        {
          x: measure.beats[0]!.x,
          y: measure.strings[0]!.y1,
        },
        selection,
        false,
      )!;
      expect(action).toEqual({ type: "selection", selection });
      const draft =
        kind === "numbered"
          ? null
          : readMusicTextDraft(
              document,
              kind === "lyric" ? lyricTarget : { ...target, kind },
            );
      expect(resolveSidebarRequest(draft, action)).toBe("execute");
      if (draft) {
        if (kind === "lyric") draft.text = "待应用";
        else draft.chord.chord.name = "Dm";
      }
      expect(
        resolveSidebarRequest(draft, action, {
          numberedTarget: kind === "numbered" ? { ...target, kind } : undefined,
          numberedDirty: kind === "numbered",
        }),
      ).toBe("execute");
    },
  );

  it.each(["lyric", "numbered", "chord"] as const)(
    "点击真实 %s 对象不受六线谱选区限制",
    (kind) => {
      const { document, layout, measure, selection } = fixture();
      const bounds =
        kind === "lyric"
          ? measure.lyrics![0]!.bounds
          : kind === "chord"
            ? measure.chordSymbols![0]!.bounds
            : measure.numberedNotation![0]!.bounds;
      const action = resolveScorePointerAction(
        document,
        layout,
        { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
        selection,
        false,
      );
      expect(action).toMatchObject({
        type: "target",
        target: {
          kind,
          trackId: selection.focus.trackId,
          measureId: measure.id,
        },
      });
    },
  );

  it("技巧对象优先于可能重叠的六线谱单元格", () => {
    const { document, layout, measure, selection } = fixture();
    // 使用命中索引的真实 seam 模拟技巧边界覆盖弦格，验证页面实际路由优先级。
    layout.hitIndex.techniqueBounds.push({
      techniqueId: "unknown-technique",
      trackId: selection.focus.trackId,
      systemIndex: 0,
      x: measure.beats[0]!.x - 2,
      y: measure.strings[0]!.y1 - 2,
      width: 4,
      height: 4,
    });
    expect(
      resolveScorePointerAction(
        document,
        layout,
        {
          x: measure.beats[0]!.x,
          y: measure.strings[0]!.y1,
        },
        selection,
        false,
      ),
    ).toMatchObject({ type: "selection", techniqueId: "unknown-technique" });
  });

  it("空编辑位仍是文字对象，退出时的空白区域则清空六线谱选区", () => {
    const { document, lyricTarget, selection } = fixture();
    document.score.tracks[0]!.measures[0]!.lyrics = [];
    const layout = buildLayout(document, {
      systemWidth: A4_CONTENT_WIDTH,
      // 空位属于编辑态，不能依赖恰好同谱行的其它小节歌词撑出占位。
      purpose: "editing",
      paragraphEditing: lyricTarget,
    });
    const bounds = layout.systems[0]!.musicTextCells!.find(
      (c) => c.kind === "lyric" && c.empty,
    )!;
    expect(
      resolveScorePointerAction(
        document,
        layout,
        { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
        selection,
        false,
      ),
    ).toMatchObject({
      type: "target",
      target: { kind: "lyric", eventId: bounds.eventId },
    });
    expect(
      resolveScorePointerAction(
        document,
        layout,
        { x: -10, y: -10 },
        selection,
        false,
      ),
    ).toEqual({ type: "selection", selection: null });
    expect(
      resolveScorePointerAction(
        document,
        layout,
        { x: -10, y: -10 },
        selection,
        true,
      ),
    ).toBeNull();
  });

  it("Shift 保留 anchor 和真实命中弦号；普通点击重新开始选区", () => {
    const { document, layout, measure, selection } = fixture();
    const point = { x: measure.beats[1]!.x, y: measure.strings[2]!.y1 };
    expect(
      resolveScorePointerAction(document, layout, point, selection, true),
    ).toMatchObject({
      type: "selection",
      selection: {
        anchor: selection.anchor,
        focus: { beatId: measure.beats[1]!.id, string: 3 },
      },
    });
    const action = resolveScorePointerAction(
      document,
      layout,
      point,
      selection,
      false,
    );
    expect(action?.type === "selection" && action.selection?.anchor).toEqual(
      action?.type === "selection" && action.selection?.focus,
    );
  });

  it("简谱重复激活不丢草稿；同拍转 beat、换歌词或切标签直接丢弃，设置脏时仍确认", () => {
    const { target, lyricTarget, selection } = fixture();
    const numberedTarget = { ...target, kind: "numbered" as const };
    const guards = { numberedTarget, numberedDirty: true };
    expect(
      resolveSidebarRequest(
        null,
        { type: "target", target: numberedTarget },
        guards,
      ),
    ).toBe("ignore");
    expect(
      resolveSidebarRequest(null, { type: "selection", selection }, guards),
    ).toBe("execute");
    expect(
      resolveSidebarRequest(
        null,
        { type: "target", target: lyricTarget },
        guards,
      ),
    ).toBe("execute");
    expect(
      resolveSidebarRequest(null, { type: "tab", kind: "score" }, guards),
    ).toBe("execute");
    expect(
      resolveSidebarRequest(
        null,
        { type: "selection", selection },
        { settingsDirty: true },
      ),
    ).toBe("confirm");
  });
  it("同拍切换到另一个简谱事件直接丢弃未应用修改", () => {
    const { target } = fixture();
    const first = {
      ...target,
      kind: "numbered" as const,
      eventId: "first",
      itemId: "first-item",
    };
    const second = { ...first, eventId: "second", itemId: "second-item" };
    expect(
      resolveSidebarRequest(
        null,
        { type: "target", target: second },
        {
          numberedTarget: first,
          numberedDirty: true,
        },
      ),
    ).toBe("execute");
  });

  it("待选区按最新文档校验；失效 ID 不按旧像素重选", () => {
    const { document, selection } = fixture();
    expect(isScoreSelectionValid(document, selection)).toBe(true);
    expect(isScoreSelectionValid(document, null)).toBe(true);
    expect(isScoreSelectionValid(null, selection)).toBe(false);
    document.score.tracks[0]!.measures[0]!.beats.shift();
    expect(isScoreSelectionValid(document, selection)).toBe(false);
  });

  it("对象点击和选区导航不写文档或撤销历史", () => {
    const { document, selection } = fixture();
    const store = createEditorStore(document);
    store.getState().setSelection(selection);
    expect(store.getState().document).toBe(document);
    expect(store.getState().historyDepth).toEqual({ past: 0, future: 0 });
  });
});
