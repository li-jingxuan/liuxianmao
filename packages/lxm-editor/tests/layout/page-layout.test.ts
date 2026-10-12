import { describe, it, expect } from "vitest";
import {
  buildLayout,
  createQualityScore,
  paginateLayout,
  A4_PAGE_OPTIONS,
  A4_CONTENT_WIDTH,
  EXAMPLE_MVP_6_DOCUMENT,
  type ILXMLayout,
} from "../../src";

const fixture = () =>
  buildLayout(EXAMPLE_MVP_6_DOCUMENT, {
    systemWidth: A4_CONTENT_WIDTH,
    density: "compact",
  });
describe("A4 完整行分页", () => {
  it("100 小节混合谱合法、确定性分页，全部谱行恰好一次且不改输入", () => {
    const document = createQualityScore(100);
    expect(document.score.tracks[0]!.measures).toHaveLength(100);
    const layout = buildLayout(document, {
      systemWidth: A4_CONTENT_WIDTH,
      density: "compact",
    });
    const before = JSON.stringify(layout);
    const result = paginateLayout(layout);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages.length).toBeGreaterThan(1);
    expect(
      result.pages.flatMap((p) => p.systems.map((s) => s.systemIndex)),
    ).toEqual(layout.systems.map((s) => s.index));
    for (const page of result.pages) {
      expect(page.footer.text).toBe(
        `${page.index + 1} / ${result.pages.length}`,
      );
      for (const p of page.systems) {
        const s = layout.systems.find((s) => s.index === p.systemIndex)!;
        expect(s.y + p.translateY).toBeGreaterThanOrEqual(
          A4_PAGE_OPTIONS.margins.top - 1e-6,
        );
        expect(s.y + s.height + p.translateY).toBeLessThanOrEqual(
          page.height -
            A4_PAGE_OPTIONS.margins.bottom -
            A4_PAGE_OPTIONS.footerHeight +
            1e-6,
        );
      }
    }
    expect(paginateLayout(layout)).toEqual(result);
    expect(JSON.stringify(layout)).toBe(before);
  });
  it("精确容量允许，少一个单位换页且页顶不带上一页 gap", () => {
    const layout = fixture();
    const s = layout.systems[0]!;
    const small: ILXMLayout = {
      ...layout,
      scoreHeader: [],
      scoreHeaderHeight: 0,
      scoreHeaderBounds: undefined,
      systems: [s, { ...s, index: 1 }],
    };
    const options = {
      ...A4_PAGE_OPTIONS,
      pageHeight: s.height * 2 + 12,
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      footerHeight: 0,
    };
    const exact = paginateLayout(small, options);
    expect(exact.ok && exact.pages.length).toBe(1);
    const overflow = paginateLayout(small, {
      ...options,
      pageHeight: options.pageHeight - 1,
    });
    expect(overflow.ok && overflow.pages.length).toBe(2);
    if (overflow.ok)
      expect(overflow.pages[1]!.systems[0]!.translateY).toBe(-s.y);
  });
  it("超宽/超高和首页容量错误不会输出半成品页面", () => {
    const layout = fixture();
    const s = layout.systems[0]!;
    const wide = { ...layout, systems: [{ ...s, width: 900 }] };
    expect(paginateLayout(wide)).toMatchObject({
      ok: false,
      pages: [],
      diagnostics: [{ code: "system-too-wide" }],
    });
    expect(
      paginateLayout({ ...layout, systems: [{ ...s, height: 2000 }] }),
    ).toMatchObject({ ok: false, diagnostics: [{ code: "system-too-tall" }] });
    const capacity =
      A4_PAGE_OPTIONS.pageHeight -
      A4_PAGE_OPTIONS.margins.top -
      A4_PAGE_OPTIONS.margins.bottom -
      A4_PAGE_OPTIONS.footerHeight;
    expect(
      paginateLayout({
        ...layout,
        scoreHeaderHeight: capacity - 1,
        systems: [s],
      }),
    ).toMatchObject({
      ok: false,
      diagnostics: [{ code: "first-page-overflow" }],
    });
  });
  it("非零起点正确平移；空谱和坏坐标明确拒绝", () => {
    const layout = buildLayout(EXAMPLE_MVP_6_DOCUMENT, {
      x: 30,
      y: 70,
      systemWidth: A4_CONTENT_WIDTH,
    });
    const result = paginateLayout(layout);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.pages[0]!.scoreHeaderTranslation).toEqual({
        x: A4_PAGE_OPTIONS.margins.left - 30,
        y: A4_PAGE_OPTIONS.margins.top - 70,
      });
    expect(paginateLayout({ ...layout, systems: [] })).toMatchObject({
      ok: false,
      diagnostics: [{ code: "empty-score" }],
    });
    expect(
      paginateLayout({
        ...layout,
        systems: [{ ...layout.systems[0]!, height: NaN }],
      }),
    ).toMatchObject({ ok: false, diagnostics: [{ code: "invalid-geometry" }] });
    expect(() =>
      paginateLayout(layout, { ...A4_PAGE_OPTIONS, systemGap: -1 }),
    ).toThrow(RangeError);
  });
  it("技巧 marker 箭头具备已平移的显式三角形", () => {
    const layout = buildLayout(createQualityScore(16), {
      systemWidth: A4_CONTENT_WIDTH,
      density: "compact",
    });
    const arrows = layout.systems
      .flatMap((s) => s.techniques)
      .filter((t) => t.path?.markerEnd);
    expect(arrows.length).toBeGreaterThan(0);
    for (const t of arrows) {
      expect(t.path!.arrowPoints).toHaveLength(3);
      for (const [x, y] of t.path!.arrowPoints!) {
        expect(x).toBeGreaterThanOrEqual(t.visualBounds.x);
        expect(y).toBeGreaterThanOrEqual(t.visualBounds.y);
        expect(y).toBeLessThanOrEqual(t.visualBounds.y + t.visualBounds.height);
      }
    }
  });
});
