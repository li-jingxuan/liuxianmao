import { describe, expect, it } from "vitest";
import {
  placeFloatingPanel,
  clampFloatingPanel,
} from "../components/EditorShell/music-text-floating-position";

describe("简谱与歌词浮窗定位", () => {
  it("避开顶栏和侧栏，只在谱面可见区域内定位", () => {
    expect(
      placeFloatingPanel(
        { left: 900, top: 300, right: 940, bottom: 340 },
        { width: 560, height: 320 },
        { left: 20, top: 150, width: 980, height: 700 },
      ),
    ).toEqual({ left: 428, top: 352 });
  });
  it("手动位置在缩放后只夹紧边界，不重新吸附目标", () => {
    expect(
      clampFloatingPanel(
        { left: 600, top: 500 },
        { width: 560, height: 320 },
        { left: 12, top: 162, right: 988, bottom: 788 },
      ),
    ).toEqual({ left: 428, top: 468 });
  });
  it("优先放在目标下方", () => {
    expect(
      placeFloatingPanel(
        { left: 200, top: 100, right: 240, bottom: 140 },
        { width: 560, height: 320 },
        { width: 1200, height: 800 },
      ),
    ).toEqual({ left: 200, top: 152 });
  });

  it("下方空间不足时放到目标上方，并限制在视口内", () => {
    expect(
      placeFloatingPanel(
        { left: 1100, top: 700, right: 1140, bottom: 740 },
        { width: 560, height: 320 },
        { width: 1200, height: 800 },
      ),
    ).toEqual({ left: 628, top: 368 });
  });

  it("窗口太高时仍保留可见边距", () => {
    expect(
      placeFloatingPanel(
        { left: 4, top: 10, right: 20, bottom: 30 },
        { width: 560, height: 900 },
        { width: 800, height: 600 },
      ),
    ).toEqual({ left: 12, top: 12 });
  });
});
