import { describe, expect, it } from "vitest";
import example from "../../example/example-mvp5.1.json";
import { buildLayout, hitTestLayout, hitTestTuplet } from "../../src/layout";

describe("TAB 连音标注命中", () => {
  it.each(["compact", "comfortable"] as const)(
    "%s 使用最终对齐和换行后的数字、水平括号及两端竖线",
    (density) => {
      for (const systemWidth of [720, 10000]) {
        const layout = buildLayout(example, { systemWidth, density });
        if (systemWidth === 720) expect(layout.systems.length).toBeGreaterThan(1);
        for (const system of layout.systems) {
          for (const measure of system.measures) {
            for (const group of measure.tuplets) {
              const target = {
                trackId: layout.trackId,
                measureId: measure.id,
                tupletId: group.id,
                beatIds: group.beatIds,
              };
              expect(hitTestTuplet(layout, {
                x: group.label.x,
                y: group.label.y - group.label.fontSize / 2,
              })).toEqual(target);
              for (const line of group.bracket!.lines) {
                expect(hitTestTuplet(layout, {
                  x: (line.x1 + line.x2) / 2,
                  y: (line.y1 + line.y2) / 2,
                })).toEqual(target);
              }
            }
          }
        }
      }
    },
  );

  it("括号仅命中线段附近，组内空白、弦格和谱面外均不命中", () => {
    const layout = buildLayout(example, { systemWidth: 10000 });
    const measure = layout.systems[0]!.measures[0]!;
    const group = measure.tuplets[0]!;
    const line = group.bracket!.lines[0]!;
    const middleX = (line.x1 + line.x2) / 2;
    expect(hitTestTuplet(layout, { x: middleX, y: line.y1 + 3 })?.tupletId)
      .toBe(group.id);
    expect(hitTestTuplet(layout, { x: middleX, y: line.y1 + 15 })).toBeNull();
    const tabPoint = { x: measure.beats[0]!.x, y: measure.strings[0]!.y1 };
    expect(hitTestLayout(layout, tabPoint)).not.toBeNull();
    expect(hitTestTuplet(layout, tabPoint)).toBeNull();
    expect(hitTestTuplet(layout, { x: -10, y: -10 })).toBeNull();
  });

  it("无括号时仍可点击数字，空布局返回 null", () => {
    const layout = buildLayout(example);
    const group = layout.systems[0]!.measures[0]!.tuplets[0]!;
    group.bracket = null;
    expect(hitTestTuplet(layout, {
      x: group.label.x,
      y: group.label.y - group.label.fontSize / 2,
    })?.tupletId).toBe(group.id);
    expect(hitTestTuplet({ ...layout, systems: [] }, { x: 0, y: 0 })).toBeNull();
  });
});
