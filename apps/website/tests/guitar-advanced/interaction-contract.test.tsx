import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GUITAR_ADVANCED_DATA as data } from "../../data/guitar-advanced";
import { GuitarAdvancedStoreProvider } from "../../stores/guitar-advanced-store";
import { PracticeQuestion } from "../../components/GuitarAdvanced/PracticeQuestion";
import { FretboardDiagram } from "../../components/GuitarAdvanced/FretboardDiagram";
import { prepareExerciseMaterials } from "../../components/GuitarAdvanced/score-presentation";
import { GuitarScoreExample } from "../../components/GuitarAdvanced/GuitarScoreExample";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
describe("guitar exercise interaction contracts", () => {
  it("renders every teaching score through the shared score scene and SVG layer", () => {
    for (const reference of data.scoreExamples) {
      const markup = renderToStaticMarkup(
        <GuitarScoreExample
          reference={reference}
          documents={data.teachingDocuments}
        />,
      );
      expect(markup).toContain('data-layer="score-music"');
      expect(markup).toContain('data-system-index="0"');
      expect(markup).toContain(`<title>${reference.title}</title>`);
      expect(markup).not.toContain('role="alert"');
    }
  });
  it("does not disclose fretboard note names in pre-submit accessible labels", () => {
    const markup = renderToStaticMarkup(
      <FretboardDiagram
        diagram={data.diagrams[0]!}
        reveal={false}
        onChange={() => undefined}
      />,
    );
    expect(markup).toContain('aria-label="第 6 弦 5 品"');
    expect(markup).not.toContain('aria-label="第 6 弦 5 品 A"');
    const revealed = renderToStaticMarkup(
      <FretboardDiagram
        diagram={data.diagrams[0]!}
        reveal
        disabled
        onChange={() => undefined}
      />,
    );
    expect(revealed).toContain('aria-label="第 6 弦 5 品 A"');
  });
  it("does not allow submitting without required score media", () => {
    const broken = { ...data, teachingDocuments: {} };
    const exercise = data.exercises[0]!;
    expect(prepareExerciseMaterials(exercise, broken).ready).toBe(false);
    const markup = renderToStaticMarkup(
      <GuitarAdvancedStoreProvider catalog={broken}>
        <PracticeQuestion exercise={exercise} data={broken} />
      </GuitarAdvancedStoreProvider>,
    );
    expect(markup).toContain("题目素材加载失败，暂不能提交");
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>.*?提交答案/);
    expect(markup).not.toContain("正确答案：");
  });
  it("keeps both theory review links on a shared exercise", () => {
    const exercise = data.exercises[4]!;
    const markup = renderToStaticMarkup(
      <GuitarAdvancedStoreProvider catalog={data}>
        <PracticeQuestion exercise={exercise} data={data} />
      </GuitarAdvancedStoreProvider>,
    );
    expect(markup).toContain(
      "/guitar-advanced/theory/scales-a-minor-pentatonic",
    );
    expect(markup).toContain(
      "/guitar-advanced/theory/scales-root-note-locations",
    );
  });
});
