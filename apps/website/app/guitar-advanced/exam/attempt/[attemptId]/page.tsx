import { ExamAttemptPage } from "../../../../../components/GuitarAdvanced/ExamAttemptPage";
import { GUITAR_ADVANCED_DATA, GUITAR_ADVANCED_EXAM } from "../../../../../data/guitar-advanced";

export default async function ExamAttemptRoute({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;
  return (
    <ExamAttemptPage
      attemptId={attemptId}
      data={GUITAR_ADVANCED_DATA}
      exam={GUITAR_ADVANCED_EXAM}
    />
  );
}
