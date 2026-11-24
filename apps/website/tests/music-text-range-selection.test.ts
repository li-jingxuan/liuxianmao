import { describe, expect, it } from "vitest";
import { collectMusicTextRangeSlots, buildLayout, LXMScoreCommandEnum, type MusicTextRange } from "@liuxianmao/lxm-editor";
import { DEFAULT_MOCK_DOCUMENT } from "../../../packages/lxm-editor/example/fixtures";
import { rangeFromTarget, navigateMusicTextRange, musicTextRangeRects } from "../../../packages/lxm-editor-react/src/EditorShell/music-text/music-text-range-selection";
import { createEditorSessionStore as createEditorSession } from "../../../packages/lxm-editor-react/src/stores/editor-store";

describe("音乐文本范围界面接缝", () => {
  const document = DEFAULT_MOCK_DOCUMENT;
  const trackId = document.score.tracks[0]!.id;
  const slots = collectMusicTextRangeSlots(document, { trackId, kind: "numbered" });
  const range: MusicTextRange = { trackId, kind: "numbered", anchor: slots[0]!, focus: slots[2]! };

  it("成员命中归一为完整事件，不携带单成员身份", () => {
    const target = rangeFromTarget({ kind: "numbered", trackId, ...slots[0]!, itemId: "member" });
    expect(target?.anchor).toEqual({ measureId: slots[0]!.measureId, eventId: slots[0]!.eventId });
    expect(rangeFromTarget({ kind: "chord", trackId, measureId: slots[0]!.measureId, beatId: "beat", string: 1 })).toBeNull();
  });

  it("正反范围折叠及跨小节扩选使用同一时间顺序", () => {
    expect(navigateMusicTextRange(document, range, -1, false)?.focus).toEqual(slots[0]);
    expect(navigateMusicTextRange(document, { ...range, anchor: range.focus, focus: range.anchor }, 1, false)?.focus).toEqual(slots[2]);
    const boundary = slots.findIndex(slot => slot.measureId !== slots[0]!.measureId) - 1;
    const next = navigateMusicTextRange(document, { ...range, anchor: slots[boundary]!, focus: slots[boundary]! }, 1, true);
    expect(next?.anchor).toEqual(slots[boundary]);
    expect(next?.focus).toEqual(slots[boundary + 1]);
  });

  it("跨行高亮按位置分别绘制，全部事件可定位", () => {
    const layout = buildLayout(document, { purpose: "editing", density: "compact", systemWidth: 700, x: 0, y: 0 });
    const boxes = musicTextRangeRects(document, layout, { ...range, focus: slots.at(-1)! });
    expect(boxes).toHaveLength(slots.length);
    expect(new Set(boxes.map(box => box.y)).size).toBeGreaterThan(1);
    expect(boxes.every(box => box.height < 200)).toBe(true);
    expect(boxes.filter(box => box.focused)).toHaveLength(1);
  });

  it("范围提交只创建一次历史，可撤销恢复并提供可读历史名称", () => {
    const session = createEditorSession(document);
    const before = session.getState().document;
    const result = session.getState().execute({ type: LXMScoreCommandEnum.ReplaceMusicTextRange, range, text: "6 7" });
    expect(result?.ok).toBe(true);
    expect(session.getState().pastEntries).toHaveLength(1);
    expect(session.getState().historyEntries[0]?.label).toBe("替换简谱范围");
    session.getState().undo();
    expect(session.getState().document).toEqual(before);
  });
});
