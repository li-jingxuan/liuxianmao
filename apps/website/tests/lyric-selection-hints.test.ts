import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  buildLayout,
  EXAMPLE_MVP_7_2_DOCUMENT,
  type ILXMNumberedEvent,
} from "@liuxianmao/lxm-editor";
import { MusicTextEditingHints } from "../components/EditorShell/MusicTextEditingHints";

describe("歌词占位框渲染", () => {
  it.each(["single", "whole", "eighths"] as const)(
    "%s 场景的占位紧贴音符，宽度不超过 24",
    (scenario) => {
      const document = structuredClone(EXAMPLE_MVP_7_2_DOCUMENT);
      const track = document.score.tracks[0]!;
      const measure = track.measures[0]!;
      track.measures = [measure];
      track.techniques = [];
      track.numberedMarks = [];
      measure.lyrics = [];
      measure.chordSymbols = [];
      const count = scenario === "whole" ? 1 : scenario === "eighths" ? 8 : 4;
      measure.numberedVoice = {
        tuplets: [],
        events: Array.from(
          { length: count },
          (_, i): ILXMNumberedEvent => ({
            id: `event-${i}`,
            tick: i * (scenario === "eighths" ? 480 : 960),
            rhythm: {
              base:
                scenario === "whole"
                  ? "whole"
                  : scenario === "eighths"
                    ? "eighth"
                    : "quarter",
              dots: 0,
            },
            kind: scenario === "single" && i !== 2 ? "rest" : "notes",
            items: [
              {
                id: `item-${i}`,
                token: scenario === "single" && i !== 2 ? "0" : "5",
              },
            ],
          }),
        ),
      };
      const layout = buildLayout(document, {
        purpose: "editing",
        systemWidth: 720,
        paragraphEditing: { measureId: measure.id, kind: "lyric", verse: 1 },
      });
      const markup = renderToStaticMarkup(
        createElement(MusicTextEditingHints, {
          layout,
          activeFocus: null,
          hoverFocus: null,
        }),
      );
      const tags = [
        ...markup.matchAll(
          /<(rect|line)\b[^>]*data-paragraph-cell="lyric\/[^>]*>/g,
        ),
      ];
      const notes = layout.systems[0]!.measures[0]!.numberedSlots.filter(
        (slot) => slot.kind === "notes",
      );
      expect(tags).toHaveLength(scenario === "eighths" ? 8 : 1);
      tags.forEach(([tag], i) => {
        const attr = (name: string) =>
          Number(tag.match(new RegExp(` ${name}="([^"]+)"`))![1]);
        expect(tag).toContain(`/${notes[i]!.id}/1"`);
        if (tag.startsWith("<rect")) {
          expect(attr("width")).toBeLessThanOrEqual(24);
          expect(attr("x") + attr("width") / 2).toBeCloseTo(notes[i]!.x);
        } else {
          expect(attr("x1")).toBe(notes[i]!.x);
          expect(attr("x2")).toBe(notes[i]!.x);
        }
      });
      if (scenario === "whole")
        expect(tags[0]![0]).toContain('data-paragraph-placeholder="box"');
    },
  );
});
