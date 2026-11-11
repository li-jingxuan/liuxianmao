export type GuitarModuleId =
  | "rhythm-and-beat"
  | "chords-and-progressions"
  | "scales-and-fretboard"
  | "playing-techniques";
export interface GuitarModule {
  readonly id: GuitarModuleId;
  readonly title: string;
  readonly summary: string;
  readonly order: number;
  readonly availability: "available" | "comingSoon";
  readonly lessonIds: readonly string[];
  readonly exerciseIds: readonly string[];
}
export type TheoryBlock =
  | {
      readonly type: "paragraph";
      readonly title: string;
      readonly content: string;
    }
  | {
      readonly type: "callout";
      readonly tone: "info" | "warning";
      readonly title: string;
      readonly content: string;
    }
  | {
      readonly type: "scoreExample";
      readonly documentId: string;
      readonly caption: string;
    }
  | {
      readonly type: "diagram";
      readonly diagramId: string;
      readonly caption: string;
    };
export interface Lesson {
  readonly id: string;
  readonly moduleId: GuitarModuleId;
  readonly title: string;
  readonly durationMinutes: number;
  readonly order: number;
  readonly objectives: readonly string[];
  readonly blocks: readonly TheoryBlock[];
  readonly exerciseIds: readonly string[];
  readonly previousLessonId: string | null;
  readonly nextLessonId: string | null;
}
export type ExerciseAnswer =
  | { readonly type: "singleChoice"; readonly optionId: string }
  | { readonly type: "multipleChoice"; readonly optionIds: readonly string[] }
  | { readonly type: "ordering"; readonly orderedIds: readonly string[] }
  | { readonly type: "targetSelection"; readonly targetIds: readonly string[] };
export interface ExerciseOption {
  readonly id: string;
  readonly label: string;
  readonly stimulusId?: string;
}
interface ExerciseBase {
  readonly id: string;
  readonly lessonId: string;
  readonly moduleId: GuitarModuleId;
  readonly title: string;
  readonly prompt: string;
  readonly explanation: string;
  readonly relatedLessonId: string;
  readonly reviewLessonIds: readonly string[];
  readonly stimulusId?: string;
}
export type Exercise = ExerciseBase &
  (
    | {
        readonly type: "singleChoice";
        readonly options: readonly ExerciseOption[];
        readonly answer: Extract<ExerciseAnswer, { type: "singleChoice" }>;
      }
    | {
        readonly type: "multipleChoice";
        readonly options: readonly ExerciseOption[];
        readonly answer: Extract<ExerciseAnswer, { type: "multipleChoice" }>;
      }
    | {
        readonly type: "ordering";
        readonly items: readonly ExerciseOption[];
        readonly initialOrderIds: readonly string[];
        readonly answer: Extract<ExerciseAnswer, { type: "ordering" }>;
      }
    | {
        readonly type: "targetSelection";
        readonly diagramId: string;
        readonly targetIds: readonly string[];
        readonly answer: Extract<ExerciseAnswer, { type: "targetSelection" }>;
      }
  );
export interface FretboardDiagramData {
  readonly id: string;
  readonly type: "fretboard";
  readonly title: string;
  readonly tuning: "standard";
  readonly stringNumbers: readonly number[];
  readonly fretRange: { readonly from: number; readonly to: number };
  readonly positions: readonly {
    readonly id: string;
    readonly stringNumber: number;
    readonly fret: number;
    readonly noteName: string;
  }[];
}
export interface ExerciseStimulus {
  readonly id: string;
  readonly type: "scoreExample";
  readonly scoreExampleId: string;
  readonly caption: string;
}
export interface ScoreExampleRef {
  readonly id: string;
  readonly title: string;
  readonly caption: string;
  readonly source: "teaching-document";
  readonly documentId: string;
}
export interface GuitarAdvancedData {
  readonly modules: readonly GuitarModule[];
  readonly lessons: readonly Lesson[];
  readonly exercises: readonly Exercise[];
  readonly scoreExamples: readonly ScoreExampleRef[];
  readonly diagrams: readonly FretboardDiagramData[];
  readonly stimuli: readonly ExerciseStimulus[];
  /** 文档保持 JSON 形状，进入正式 loader 后才取得领域类型。 */
  readonly teachingDocuments: Readonly<Record<string, unknown>>;
}
export interface ExerciseResult {
  readonly exerciseId: string;
  readonly answer: ExerciseAnswer;
  readonly isCorrect: boolean;
  readonly submittedAt: string;
}
export type ExamQuestion = Exercise & {
  readonly order: number;
  readonly points: number;
};
/** 考试定义不可变；attempt 会保存此结构的完整快照。 */
export interface GuitarAdvancedExam {
  readonly id: string;
  readonly title: string;
  readonly passingScore: number;
  readonly maxScore: number;
  readonly questions: readonly ExamQuestion[];
}
export type ExamQuestionSnapshot = ExamQuestion;
export interface ExamAttempt {
  readonly id: string;
  readonly examId: string;
  readonly passingScore: number;
  readonly status: "draft" | "submitted";
  readonly questionSnapshot: readonly ExamQuestionSnapshot[];
  readonly answers: Readonly<Record<string, ExerciseAnswer>>;
  readonly currentQuestionIndex: number;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly submittedAt: string | null;
  readonly score: number | null;
  readonly moduleScores: Readonly<Record<GuitarModuleId, number>> | null;
  readonly passed: boolean | null;
}
export interface ExamQuestionGrade {
  readonly questionId: string;
  readonly moduleId: GuitarModuleId;
  readonly points: number;
  readonly earnedPoints: number;
  readonly isCorrect: boolean;
  readonly answer: ExerciseAnswer | null;
  readonly correctAnswer: ExerciseAnswer;
}
export interface ExamGrade {
  readonly questionGrades: readonly ExamQuestionGrade[];
  readonly score: number;
  readonly moduleScores: Readonly<Record<GuitarModuleId, number>>;
  readonly unansweredQuestionIds: readonly string[];
  readonly passed: boolean;
}
export interface LastVisitedContent {
  readonly kind: "lesson" | "exercise";
  readonly id: string;
}
export type LearningTarget = LastVisitedContent & {
  readonly moduleId: GuitarModuleId;
  readonly title: string;
  readonly href: string;
};
export interface GuitarProgressV2 {
  readonly schemaVersion: 2;
  readonly completedLessonIds: readonly string[];
  readonly completedExerciseIds: readonly string[];
  readonly exerciseResults: Readonly<Record<string, ExerciseResult>>;
  readonly wrongExerciseIds: readonly string[];
  readonly reviewedExerciseIds: readonly string[];
  readonly lastVisited: LastVisitedContent | null;
  readonly updatedAt: string | null;
}
export interface GuitarProgressV3 extends Omit<GuitarProgressV2, "schemaVersion"> {
  readonly schemaVersion: 3;
  readonly examAttempts: readonly ExamAttempt[];
  readonly activeExamAttemptId: string | null;
}
export interface ExamQuestionReview {
  readonly attemptId: string;
  readonly reviewedAt: string;
}
export interface GuitarProgressV4 extends Omit<GuitarProgressV3, "schemaVersion"> {
  readonly schemaVersion: 4;
  /** key 为 examId:questionId，状态只对应最近一次具体错题答卷。 */
  readonly examQuestionReviews: Readonly<Record<string, ExamQuestionReview>>;
}
export type GuitarProgress =
  | GuitarProgressV1
  | GuitarProgressV2
  | GuitarProgressV3
  | GuitarProgressV4;
/** 保留原始 v1 结构，仅用于校验和单向迁移。 */
export interface GuitarProgressV1 {
  readonly schemaVersion: 1;
  readonly completedLessonIds: readonly string[];
  readonly completedExerciseIds: readonly string[];
  readonly exerciseResults: Readonly<
    Record<
      string,
      {
        readonly exerciseId: string;
        readonly selectedOptionId: string | null;
        readonly isCorrect: boolean;
        readonly submittedAt: string;
      }
    >
  >;
  readonly lastVisited: LastVisitedContent | null;
  readonly updatedAt: string | null;
}
export interface GuitarAdvancedSettings {
  readonly contentVersion: "v2";
  readonly progressSchemaVersion: 4;
  readonly progressStorageKey: string;
  readonly v3ProgressStorageKey: string;
  readonly v2ProgressStorageKey: string;
  readonly legacyProgressStorageKey: string;
}
