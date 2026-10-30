import { ExamResultPage } from "../../../../../components/GuitarAdvanced/ExamResultPage";
import { GUITAR_ADVANCED_DATA, GUITAR_ADVANCED_EXAM } from "../../../../../data/guitar-advanced";

export default async function ExamResultRoute({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;
  return (
    <ExamResultPage
      attemptId={attemptId}
      data={GUITAR_ADVANCED_DATA}
      exams={[GUITAR_ADVANCED_EXAM]}
    />
  );
}
