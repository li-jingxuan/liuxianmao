import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { StrumRangeInspector } from "../components/EditorShell/tools/StrumRangeInspector";

const render = (ranges: ComponentProps<typeof StrumRangeInspector>["ranges"], disabled = false) => {
  const markup = renderToStaticMarkup(
    <StrumRangeInspector ranges={ranges} stringCount={6} disabled={disabled} onChange={vi.fn()} />,
  );
  const selectors = markup.match(/<select\b[^>]*>.*?<\/select>/g) ?? [];
  return { markup, selectors };
};

const enabledStrings = (selector: string) =>
  [...selector.matchAll(/<option value="(\d+)"(?: selected="")?>/g)].map((match) => Number(match[1]));

describe("扫弦范围侧栏", () => {
  it("两端各自显示多个值，并禁用会与任一原有对端重合或交叉的弦号", () => {
    const { markup, selectors: [upper, lower] } = render([
      { minString: 1, maxString: 5, stroke: "up" },
      { minString: 3, maxString: 4, stroke: "down" },
    ]);

    expect(markup).toContain("扫弦范围");
    expect(markup).toContain("上端弦");
    expect(markup).toContain("下端弦");
    expect(markup).toContain("多个范围");
    expect(markup).toContain("已选 2 个音符");
    expect(markup).not.toMatch(/上扫|下扫/);
    expect(markup).toContain("<kbd>Alt / ⌥</kbd> + 点按箭头或符干，增选或移除单个音符");
    for (const selector of [upper!, lower!]) {
      expect(selector).toContain('<option value="" disabled="" selected="">多个值</option>');
    }
    expect(enabledStrings(upper!)).toEqual([1, 2, 3]);
    expect(enabledStrings(lower!)).toEqual([4, 5, 6]);
  });

  it("单个扫弦显示当前弦范围和可用的方向", () => {
    const { markup } = render([{ minString: 2, maxString: 5, stroke: "down" }]);
    expect(markup).toContain("2–5 弦");
    expect(markup).toContain("↑ 下扫");
    expect(markup).toContain("已选 1 个音符");
  });

  it("只在实际混合的一端显示多个值，锁定时禁用两端选择", () => {
    const { selectors: [upper, lower] } = render([
      { minString: 2, maxString: 4 },
      { minString: 2, maxString: 6 },
    ], true);

    expect(upper).toContain('<option value="2" selected="">第 2 弦</option>');
    expect(upper).not.toContain("多个值");
    expect(lower).toContain("多个值");
    expect(upper).toMatch(/^<select disabled="">/);
    expect(lower).toMatch(/^<select disabled="">/);
  });

  it("无扫弦目标时隐藏侧栏面板", () => {
    expect(render([]).markup).toBe("");
  });
});
