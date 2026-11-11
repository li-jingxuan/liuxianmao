import { describe, expect, it } from "vitest";
import { editorLayoutMode } from "../components/EditorShell/workspace/use-editor-host-width";

describe("editor host breakpoints", () => {
  it.each([
    [375, "narrow"],
    [768, "narrow"],
    [959, "narrow"],
    [960, "compact"],
    [1199, "compact"],
    [1200, "desktop"],
    [1599, "desktop"],
    [1600, "wide"],
  ] as const)("uses host CSS width %i as %s", (width, mode) => {
    expect(editorLayoutMode(width)).toBe(mode);
  });
});
