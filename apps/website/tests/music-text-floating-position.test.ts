import { describe, expect, it } from "vitest";
import {
  computeFloatingPanelGeometry as place,
  type FloatingAnchorRect,
} from "../components/EditorShell/music-text/music-text-floating-position";

const viewport = { left: 20, top: 100, right: 1020, bottom: 800 };
const panel = { width: 320, height: 180 };

describe("简谱与歌词气泡定位", () => {
  it("优先放在目标下方，箭头指向目标中心", () => {
    expect(
      place({ left: 400, top: 200, right: 440, bottom: 240 }, panel, viewport),
    ).toEqual({
      kind: "placed",
      left: 260,
      top: 248,
      placement: "bottom",
      arrowOffset: 160,
    });
  });
  it("下方不足时翻到上方，保持 8px 间距", () => {
    expect(
      place({ left: 400, top: 700, right: 440, bottom: 740 }, panel, viewport),
    ).toEqual({
      kind: "placed",
      left: 260,
      top: 512,
      placement: "top",
      arrowOffset: 160,
    });
  });
  it.each([
    [{ left: 400, top: 300, right: 440, bottom: 340 }, "right", 448],
    [{ left: 700, top: 300, right: 740, bottom: 340 }, "left", 372],
  ] as const)("上下不足时尝试侧向：%s", (anchor, placement, left) => {
    expect(
      place(
        anchor,
        { width: 320, height: 300 },
        { ...viewport, top: 200, bottom: 500 },
      ),
    ).toEqual({ kind: "sidebar-required" });
    expect(
      place(
        anchor,
        { width: 320, height: 260 },
        { ...viewport, top: 200, bottom: 500 },
      ),
    ).toEqual({ kind: "placed", placement, left, top: 212, arrowOffset: 108 });
  });
  it.each([
    [{ left: 32, top: 200, right: 58, bottom: 240 }, 32, 16],
    [{ left: 982, top: 200, right: 1008, bottom: 240 }, 688, 304],
  ] as const)(
    "靠边时移动箭头到目标可见范围且避开圆角：%s",
    (anchor, left, arrowOffset) => {
      expect(place(anchor, panel, viewport)).toEqual({
        kind: "placed",
        placement: "bottom",
        left,
        top: 248,
        arrowOffset,
      });
    },
  );
  it("部分离屏使用可见交集，但始终避开完整目标", () => {
    const anchor = { left: 300, top: 50, right: 340, bottom: 160 };
    expect(place(anchor, panel, viewport)).toEqual({
      kind: "placed",
      placement: "bottom",
      left: 160,
      top: 168,
      arrowOffset: 160,
    });
  });
  it("目标只露出边缘，箭头无法指向时拒绝候选", () => {
    expect(
      place({ left: 0, top: 200, right: 25, bottom: 240 }, panel, viewport),
    ).toEqual({
      kind: "placed",
      placement: "right",
      left: 33,
      top: 130,
      arrowOffset: 90,
    });
  });
  it("不会夹紧主轴而盖住目标", () => {
    expect(
      place({ left: 200, top: 250, right: 850, bottom: 650 }, panel, viewport),
    ).toEqual({ kind: "sidebar-required" });
  });
  it.each([
    { left: 0, top: 200, right: 20, bottom: 240 },
    { left: 1020, top: 200, right: 1040, bottom: 240 },
    { left: 300, top: 800, right: 340, bottom: 840 },
  ])("完全离屏或只接触视口边缘时隐藏：%s", (anchor) => {
    expect(place(anchor, panel, viewport)).toEqual({
      kind: "hidden",
      reason: "offscreen",
    });
  });
  it.each([null, { left: 0, top: 0, right: 0, bottom: 0 }])(
    "缺失锚点时等待布局",
    (anchor) => {
      expect(place(anchor, panel, viewport)).toEqual({
        kind: "hidden",
        reason: "layout-pending",
      });
    },
  );
  it("布局未就绪时不产生默认位置", () => {
    const anchor = { left: 300, top: 200, right: 340, bottom: 240 };
    expect(
      place(anchor, panel, { left: 0, top: 0, right: 0, bottom: 0 }),
    ).toEqual({ kind: "hidden", reason: "layout-pending" });
    expect(place(anchor, { width: 320, height: 0 }, viewport)).toEqual({
      kind: "hidden",
      reason: "layout-pending",
    });
  });
  it("最小 280px 卡片也放不下时要求侧栏", () => {
    expect(
      place(
        { left: 140, top: 200, right: 160, bottom: 240 },
        { width: 280, height: 180 },
        { left: 0, top: 100, right: 300, bottom: 800 },
      ),
    ).toEqual({ kind: "sidebar-required" });
  });
  it("目标或视口变化时始终重新跟随", () => {
    const a = place(
      { left: 400, top: 200, right: 440, bottom: 240 },
      panel,
      viewport,
    );
    const b = place(
      { left: 500, top: 300, right: 540, bottom: 340 },
      panel,
      viewport,
    );
    expect(
      a.kind === "placed" &&
        b.kind === "placed" && [b.left - a.left, b.top - a.top],
    ).toEqual([100, 100]);
  });
  it("各种边界下的可见卡片均在安全区域内、不遮挡且箭头命中", () => {
    for (const left of [0, 20, 40, 300, 700, 990, 1020]) {
      for (const top of [80, 100, 120, 300, 650, 770, 800]) {
        const anchor: FloatingAnchorRect = {
          left,
          top,
          right: left + 40,
          bottom: top + 40,
        };
        const result = place(anchor, panel, viewport);
        if (result.kind !== "placed") continue;
        expect(result.left).toBeGreaterThanOrEqual(viewport.left + 12);
        expect(result.top).toBeGreaterThanOrEqual(viewport.top + 12);
        expect(result.left + panel.width).toBeLessThanOrEqual(
          viewport.right - 12,
        );
        expect(result.top + panel.height).toBeLessThanOrEqual(
          viewport.bottom - 12,
        );
        expect(
          result.left < anchor.right &&
            result.left + panel.width > anchor.left &&
            result.top < anchor.bottom &&
            result.top + panel.height > anchor.top,
        ).toBe(false);
        const horizontal =
          result.placement === "bottom" || result.placement === "top";
        const arrow =
          (horizontal ? result.left : result.top) + result.arrowOffset;
        expect(result.arrowOffset).toBeGreaterThanOrEqual(16);
        expect(result.arrowOffset).toBeLessThanOrEqual(
          (horizontal ? panel.width : panel.height) - 16,
        );
        expect(arrow).toBeGreaterThanOrEqual(
          Math.max(
            horizontal ? anchor.left : anchor.top,
            horizontal ? viewport.left : viewport.top,
          ),
        );
        expect(arrow).toBeLessThanOrEqual(
          Math.min(
            horizontal ? anchor.right : anchor.bottom,
            horizontal ? viewport.right : viewport.bottom,
          ),
        );
      }
    }
  });
});
