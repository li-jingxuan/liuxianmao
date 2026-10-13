import { describe, expect, it } from "vitest";
import {
  A4_CONTENT_WIDTH,
  EXAMPLE_MVP_7_2_DOCUMENT,
  buildLayout,
  createCollapsedTabCellSelection,
  type ILXMTabCellReference,
} from "@liuxianmao/lxm-editor";
import {
  resolveScorePointerAction,
  isScoreSelectionValid,
} from "../components/EditorShell/editor-object-selection";
import {
  readMusicTextDraft,
  resolveSidebarRequest,
} from "../components/EditorShell/music-text-draft";
import { createEditorStore } from "../stores/editor-store";

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
    selection: createCollapsedTabCellSelection(target),
  };
};

describe("谱面对象选择与文字页签解耦", () => {
  it.each(["lyric", "numbered", "chord"] as const)(
    "%s 草稿下点击同拍弦格仍是六线谱选择",
    (kind) => {
      const { document, layout, measure, target, selection } = fixture();
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
          : readMusicTextDraft(document, { ...target, kind });
      expect(resolveSidebarRequest(draft, action)).toBe("execute");
      if (draft) {
        if (kind === "lyric") draft.text = "待应用";
        else draft.chord.chord.name = "Dm";
      }
      expect(
        resolveSidebarRequest(draft, action, {
          numberedDirty: kind === "numbered",
        }),
      ).toBe("confirm");
    },
  );

  it.each(["lyric", "numbered"] as const)(
    "点击真实 %s 对象不受六线谱选区限制",
    (kind) => {
      const { document, layout, measure, selection } = fixture();
      const bounds =
        kind === "lyric"
          ? measure.lyrics![0]!.bounds
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
    const { document, target, selection } = fixture();
    document.score.tracks[0]!.measures[0]!.lyrics = [];
    const layout = buildLayout(document, {
      systemWidth: A4_CONTENT_WIDTH,
      paragraphEditing: { ...target, kind: "lyric", verse: 1 },
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
      target: { kind: "lyric", beatId: bounds.beatId },
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

  it("简谱重复激活不丢草稿；同拍转 beat 或换歌词仍需确认", () => {
    const { target, selection } = fixture();
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
    ).toBe("confirm");
    expect(
      resolveSidebarRequest(
        null,
        { type: "target", target: { ...target, kind: "lyric", verse: 1 } },
        guards,
      ),
    ).toBe("confirm");
    expect(
      resolveSidebarRequest(null, { type: "tab", kind: "score" }, guards),
    ).toBe("confirm");
    expect(
      resolveSidebarRequest(
        null,
        { type: "selection", selection },
        { settingsDirty: true },
      ),
    ).toBe("confirm");
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
