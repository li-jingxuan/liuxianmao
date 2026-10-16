import { describe, expect, it } from "vitest";
import { GUITAR_ADVANCED_DATA } from "../../data/guitar-advanced";
import { gradeSingleChoice } from "../../lib/guitar-advanced/grading";

const exercise = GUITAR_ADVANCED_DATA.exercises[0]!;

describe("gradeSingleChoice", () => {
  it("marks the correct answer", () => {
    expect(
      gradeSingleChoice(
        exercise,
        exercise.answer.optionId,
        "2026-10-16T00:00:00.000Z",
      ).isCorrect,
    ).toBe(true);
  });

  it("marks wrong, missing, or unknown answers incorrect", () => {
    expect(gradeSingleChoice(exercise, "once-per-beat", "now").isCorrect).toBe(
      false,
    );
    expect(gradeSingleChoice(exercise, null, "now").isCorrect).toBe(false);
    const unknown = gradeSingleChoice(exercise, "unknown", "now");
    expect(unknown.isCorrect).toBe(false);
    expect(unknown.selectedOptionId).toBeNull();
  });
});
