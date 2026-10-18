import { describe, expect, it } from "vitest";
import { GUITAR_ADVANCED_DATA as data } from "../../data/guitar-advanced";
import { gradeExercise } from "../../lib/guitar-advanced/grading";
import type { ExerciseAnswer } from "../../lib/guitar-advanced/model";
const answer = (
  type: ExerciseAnswer["type"],
  ids: string[],
): ExerciseAnswer => {
  switch (type) {
    case "singleChoice":
      return { type, optionId: ids[0] ?? "" };
    case "multipleChoice":
      return { type, optionIds: ids };
    case "ordering":
      return { type, orderedIds: ids };
    case "targetSelection":
      return { type, targetIds: ids };
  }
};
describe("gradeExercise", () => {
  it("marks a valid incorrect answer for each published exercise", () => {
    const wrongAnswers: ExerciseAnswer[] = [
      { type: "singleChoice", optionId: "once-per-beat" },
      { type: "singleChoice", optionId: "two-parts" },
      { type: "multipleChoice", optionIds: ["c", "e"] },
      { type: "ordering", orderedIds: ["g", "c", "f"] },
      { type: "targetSelection", targetIds: ["string-6-fret-5"] },
      { type: "singleChoice", optionId: "muted-is-rest" },
    ];
    data.exercises.forEach((exercise, index) => {
      expect(
        gradeExercise(exercise, wrongAnswers[index]!, "now"),
      ).toMatchObject({
        ok: true,
        result: { isCorrect: false },
      });
    });
  });
  it("grades all six known answers and clones submitted input", () => {
    for (const e of data.exercises) {
      const result = gradeExercise(e, e.answer, "now");
      expect(result.ok && result.result.isCorrect).toBe(true);
      if (result.ok) expect(result.result.answer).not.toBe(e.answer);
    }
  });
  it("rejects unanswered, unknown, duplicate and mismatched input without a result", () => {
    for (const e of data.exercises) {
      expect(gradeExercise(e, null, "now")).toEqual({
        ok: false,
        reason: "unanswered",
      });
      expect(gradeExercise(e, answer(e.type, []), "now")).toEqual({
        ok: false,
        reason: "unanswered",
      });
      expect(gradeExercise(e, answer(e.type, ["missing"]), "now")).toEqual({
        ok: false,
        reason: "invalidAnswer",
      });
      expect(
        gradeExercise(
          e,
          e.type === "singleChoice"
            ? { type: "multipleChoice", optionIds: ["x"] }
            : { type: "singleChoice", optionId: "x" },
          "now",
        ),
      ).toEqual({ ok: false, reason: "typeMismatch" });
    }
    expect(
      gradeExercise(
        data.exercises[2]!,
        { type: "multipleChoice", optionIds: ["c", "c"] },
        "now",
      ),
    ).toEqual({ ok: false, reason: "invalidAnswer" });
    expect(
      gradeExercise(
        data.exercises[3]!,
        { type: "ordering", orderedIds: ["c", "f"] },
        "now",
      ).ok,
    ).toBe(false);
  });
  it("compares sets independent of order, but requires the entire set", () => {
    const e = data.exercises[2]!;
    expect(
      gradeExercise(
        e,
        { type: "multipleChoice", optionIds: ["g", "e", "c"] },
        "now",
      ),
    ).toMatchObject({ ok: true, result: { isCorrect: true } });
    for (const ids of [["c"], ["c", "e", "g", "d"]])
      expect(
        gradeExercise(e, { type: "multipleChoice", optionIds: ids }, "now"),
      ).toMatchObject({ ok: true, result: { isCorrect: false } });
    const t = data.exercises[4]!;
    if (t.answer.type !== "targetSelection") throw new Error("fixture");
    expect(
      gradeExercise(
        t,
        {
          type: "targetSelection",
          targetIds: [...t.answer.targetIds].reverse(),
        },
        "now",
      ),
    ).toMatchObject({ ok: true, result: { isCorrect: true } });
    expect(
      gradeExercise(
        t,
        { type: "targetSelection", targetIds: ["string-6-fret-5"] },
        "now",
      ),
    ).toMatchObject({ ok: true, result: { isCorrect: false } });
  });
  it("treats valid wrong answers and ordering permutations as incorrect", () => {
    expect(
      gradeExercise(
        data.exercises[0]!,
        { type: "singleChoice", optionId: "once-per-beat" },
        "now",
      ),
    ).toMatchObject({ ok: true, result: { isCorrect: false } });
    expect(
      gradeExercise(
        data.exercises[3]!,
        { type: "ordering", orderedIds: ["g", "c", "f"] },
        "now",
      ),
    ).toMatchObject({ ok: true, result: { isCorrect: false } });
  });
});
