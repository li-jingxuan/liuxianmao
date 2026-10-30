"use client";
import type {
  Exercise,
  ExerciseAnswer,
  GuitarAdvancedData,
} from "../../lib/guitar-advanced/model";
import { getAnswerIds } from "../../lib/guitar-advanced/grading";
import type { prepareExerciseMaterials } from "./score-presentation";
import { PreparedScoreView } from "./GuitarScoreExample";
import { FretboardDiagram } from "./FretboardDiagram";
import { OrderingAnswerInput } from "./OrderingAnswerInput";
import styles from "./LearningUi.module.scss";
export const initialExerciseAnswer = (e: Exercise): ExerciseAnswer | null =>
  e.type === "ordering"
    ? { type: "ordering", orderedIds: [...e.initialOrderIds] }
    : null;
export const ExerciseAnswerInput = ({
  exercise,
  data,
  answer,
  disabled,
  onChange,
  materials,
}: {
  exercise: Exercise;
  data: GuitarAdvancedData;
  answer: ExerciseAnswer | null;
  disabled: boolean;
  onChange: (a: ExerciseAnswer) => void;
  materials: ReturnType<typeof prepareExerciseMaterials>;
}) => {
  const selected = answer ? getAnswerIds(answer) : [];
  if (exercise.type === "ordering")
    return (
      <OrderingAnswerInput
        items={exercise.items}
        ids={selected.length ? selected : exercise.initialOrderIds}
        disabled={disabled}
        onChange={(ids) => onChange({ type: "ordering", orderedIds: ids })}
      />
    );
  if (exercise.type === "targetSelection") {
    const diagram = data.diagrams.find((d) => d.id === exercise.diagramId);
    return diagram ? (
      <FretboardDiagram
        diagram={diagram}
        allowedIds={exercise.targetIds}
        selectedIds={selected}
        reveal={disabled}
        disabled={disabled}
        onChange={(ids) =>
          onChange({ type: "targetSelection", targetIds: ids })
        }
      />
    ) : null;
  }
  return (
    <fieldset className={styles.fieldset} disabled={disabled}>
      <legend>
        {exercise.type === "singleChoice" ? "请选择一项" : "请选择所有符合项"}
      </legend>
      <div className={styles.stack}>
        {exercise.options.map((option) => {
          const media = option.stimulusId
            ? materials.scores[option.stimulusId]
            : null;
          return (
            <label
              key={option.id}
              className={styles.option}
              data-selected={selected.includes(option.id)}
            >
              <input
                type={exercise.type === "singleChoice" ? "radio" : "checkbox"}
                name={exercise.id}
                value={option.id}
                checked={selected.includes(option.id)}
                onChange={() =>
                  onChange(
                    exercise.type === "singleChoice"
                      ? { type: "singleChoice", optionId: option.id }
                      : {
                          type: "multipleChoice",
                          optionIds: selected.includes(option.id)
                            ? selected.filter((id) => id !== option.id)
                            : [...selected, option.id],
                        },
                  )
                }
              />
              <div className={styles.optionContent}>
                <p>{option.label}</p>
                {media && (
                  <PreparedScoreView
                    prepared={media.prepared}
                    title={media.reference.title}
                    caption={media.caption}
                  />
                )}
              </div>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
};
