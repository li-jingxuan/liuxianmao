import type { GuitarAdvancedData } from "../../lib/guitar-advanced/model";
import { GUITAR_ADVANCED_COURSES } from "./guitar-advanced.data";
import { GUITAR_ADVANCED_SCORE_EXAMPLES } from "./score-examples.data";
import { GUITAR_ADVANCED_DIAGRAMS } from "./diagrams.data";
import { GUITAR_ADVANCED_STIMULI } from "./stimuli.data";
import { GUITAR_ADVANCED_TEACHING_DOCUMENTS } from "./teaching-documents.data";
export const GUITAR_ADVANCED_DATA: GuitarAdvancedData = {
  ...GUITAR_ADVANCED_COURSES,
  scoreExamples: GUITAR_ADVANCED_SCORE_EXAMPLES,
  diagrams: GUITAR_ADVANCED_DIAGRAMS,
  stimuli: GUITAR_ADVANCED_STIMULI,
  teachingDocuments: GUITAR_ADVANCED_TEACHING_DOCUMENTS,
};
export { GUITAR_ADVANCED_SCORE_EXAMPLES };
export { GUITAR_ADVANCED_INITIAL_PROGRESS } from "./initial-progress.data";
export { GUITAR_ADVANCED_SETTINGS } from "./settings.data";
export { GUITAR_ADVANCED_EXAM } from "./exam.data";
