export type GuitarModuleId =
  | "rhythm-and-beat"
  | "chords-and-progressions"
  | "scales-and-fretboard"
  | "playing-techniques";

export type ModuleAvailability = "available" | "comingSoon";

export interface GuitarModule {
  readonly id: GuitarModuleId;
  readonly title: string;
  readonly summary: string;
  readonly order: number;
  readonly availability: ModuleAvailability;
  readonly lessonIds: readonly string[];
  readonly exerciseIds: readonly string[];
}

export type TheoryBlock =
  | {
      readonly type: "paragraph";
      readonly title?: string;
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

export type ExerciseType = "singleChoice";

export interface ExerciseOption {
  readonly id: string;
  readonly label: string;
}

export interface Exercise {
  readonly id: string;
  readonly lessonId: string;
  readonly moduleId: GuitarModuleId;
  readonly type: ExerciseType;
  readonly title: string;
  readonly prompt: string;
  readonly options: readonly ExerciseOption[];
  readonly answer: { readonly optionId: string };
  readonly explanation: string;
  readonly relatedLessonId: string;
}

export interface GuitarAdvancedData {
  readonly modules: readonly GuitarModule[];
  readonly lessons: readonly Lesson[];
  readonly exercises: readonly Exercise[];
}

export interface ExerciseResult {
  readonly exerciseId: string;
  readonly selectedOptionId: string | null;
  readonly isCorrect: boolean;
  readonly submittedAt: string;
}

export interface LastVisitedContent {
  readonly kind: "lesson" | "exercise";
  readonly id: string;
}

export interface GuitarProgressV1 {
  readonly schemaVersion: 1;
  readonly completedLessonIds: readonly string[];
  readonly completedExerciseIds: readonly string[];
  readonly exerciseResults: Readonly<Record<string, ExerciseResult>>;
  readonly lastVisited: LastVisitedContent | null;
  readonly updatedAt: string | null;
}

export interface ScoreExampleRef {
  readonly id: string;
  readonly title: string;
  readonly caption: string;
  readonly source: "lxm-editor-example";
  readonly sourceDocument: "mvp-7-2";
}

export interface GuitarAdvancedSettings {
  readonly contentVersion: "v1";
  readonly progressSchemaVersion: 1;
  readonly progressStorageKey: "lxm-guitar-advanced-progress:v1";
}
