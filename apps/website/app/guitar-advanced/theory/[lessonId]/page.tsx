import { notFound } from "next/navigation";
import { TheoryLessonView } from "../../../../components/GuitarAdvanced/TheoryLessonView";
import { GUITAR_ADVANCED_DATA } from "../../../../data/guitar-advanced";
import { findLesson } from "../../../../lib/guitar-advanced/catalog";

const TheoryLessonPage = async ({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) => {
  const { lessonId } = await params;
  const lesson = findLesson(GUITAR_ADVANCED_DATA, lessonId);
  if (!lesson) notFound();
  return <TheoryLessonView lesson={lesson} />;
};

export default TheoryLessonPage;
