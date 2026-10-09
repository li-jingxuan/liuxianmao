import { describe, expect, it } from "vitest";

import EXAMPLE_MVP_2 from "../../example/example-mvp2.json";
import EXAMPLE_MVP_5 from "../../example/example-mvp5.json";
import { resolveTechniqueSelection } from "../../src/editing/technique-selection";

describe("technique selection", () => {
  it.each(EXAMPLE_MVP_5.score.tracks[0]!.techniques)(
    "$type 点击后恢复可编辑的稳定选区",
    (technique) => {
      for (const endpoint of ["start", "end"] as const) {
        expect(
          resolveTechniqueSelection(EXAMPLE_MVP_5, technique.id, endpoint),
        ).not.toBeNull();
      }
    },
  );
  it.each([
    ["start", 6],
    ["end", 2],
  ] as const)(
    "点击 down strum 的 %s 端时 focus 落到弦 %s",
    (endpoint, focusString) => {
      const document = structuredClone(EXAMPLE_MVP_2);
      document.score.tracks[0]!.techniques = [
        {
          id: "tech-selection-strum",
          type: "strum",
          beatId: "mvp2-beat-1-2",
          minString: 2,
          maxString: 6,
          stroke: "down",
        },
      ];

      const selection = resolveTechniqueSelection(
        document,
        "tech-selection-strum",
        endpoint,
      );
      expect(selection?.focus).toMatchObject({
        beatId: "mvp2-beat-1-2",
        string: focusString,
      });
      expect(
        new Set([selection?.anchor.string, selection?.focus.string]),
      ).toEqual(new Set([2, 6]));
    },
  );
});
