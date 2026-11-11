import { notFound } from "next/navigation";
import { PracticeQuestion } from "../../../../components/GuitarAdvanced/PracticeQuestion";
import { GUITAR_ADVANCED_DATA } from "../../../../data/guitar-advanced";
import { findExercise } from "../../../../lib/guitar-advanced/catalog";

const PracticePage = async ({
  params,
}: {
  params: Promise<{ exerciseId: string }>;
}) => {
  const { exerciseId } = await params;
  const exercise = findExercise(GUITAR_ADVANCED_DATA, exerciseId);
  if (!exercise) notFound();
  return (
    <PracticeQuestion
      key={exercise.id}
      exercise={exercise}
      data={GUITAR_ADVANCED_DATA}
    />
  );
};

export default PracticePage;
