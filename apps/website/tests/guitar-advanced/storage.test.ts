import { describe, expect, it } from "vitest";
import { GUITAR_ADVANCED_INITIAL_PROGRESS } from "../../data/guitar-advanced";
import {
  cloneProgress,
  parseProgress,
  type ProgressStorage,
} from "../../lib/guitar-advanced/storage";
import { createGuitarProgressStore } from "../../stores/guitar-advanced-store";
import { GUITAR_ADVANCED_DATA } from "../../data/guitar-advanced";

const createMemoryStorage = (): ProgressStorage & { value: string | null } => ({
  value: null,
  read() {
    return this.value;
  },
  write(value) {
    this.value = value;
  },
  remove() {
    this.value = null;
  },
});

describe("guitar progress storage", () => {
  it("restores empty, valid, malformed, and unsupported data safely", () => {
    expect(
      parseProgress(null, GUITAR_ADVANCED_INITIAL_PROGRESS).error,
    ).toBeNull();
    const valid = {
      ...cloneProgress(GUITAR_ADVANCED_INITIAL_PROGRESS),
      updatedAt: "now",
    };
    expect(
      parseProgress(JSON.stringify(valid), GUITAR_ADVANCED_INITIAL_PROGRESS)
        .progress,
    ).toEqual(valid);
    expect(
      parseProgress("{broken", GUITAR_ADVANCED_INITIAL_PROGRESS).error,
    ).toBeTruthy();
    expect(
      parseProgress(
        JSON.stringify({ schemaVersion: 2 }),
        GUITAR_ADVANCED_INITIAL_PROGRESS,
      ).error,
    ).toBeTruthy();
  });

  it("hydrates once and persists lesson and exercise progress", () => {
    const storage = createMemoryStorage();
    let tick = 0;
    const store = createGuitarProgressStore({
      catalog: GUITAR_ADVANCED_DATA,
      initialProgress: GUITAR_ADVANCED_INITIAL_PROGRESS,
      storage,
      now: () => `t${++tick}`,
    });
    store.getState().hydrate();
    store.getState().markLessonComplete("rhythm-eighth-sixteenth");
    store
      .getState()
      .submitExercise("rhythm-identify-eighth-notes", "twice-per-beat");
    expect(store.getState().progress.completedLessonIds).toEqual([
      "rhythm-eighth-sixteenth",
    ]);
    expect(
      store.getState().progress.exerciseResults["rhythm-identify-eighth-notes"]
        ?.isCorrect,
    ).toBe(true);
    expect(storage.value).toContain("rhythm-identify-eighth-notes");
    store.getState().resetExerciseAttempt("rhythm-identify-eighth-notes");
    expect(store.getState().progress.completedExerciseIds).toContain(
      "rhythm-identify-eighth-notes",
    );
    expect(
      store.getState().progress.exerciseResults["rhythm-identify-eighth-notes"],
    ).toBeUndefined();

    const reloaded = createGuitarProgressStore({
      catalog: GUITAR_ADVANCED_DATA,
      initialProgress: GUITAR_ADVANCED_INITIAL_PROGRESS,
      storage,
      now: () => "later",
    });
    reloaded.getState().hydrate();
    expect(reloaded.getState().progress.completedLessonIds).toEqual([
      "rhythm-eighth-sixteenth",
    ]);
  });

  it("hydrates saved progress before an early page effect writes lastVisited", () => {
    const storage = createMemoryStorage();
    storage.value = JSON.stringify({
      ...cloneProgress(GUITAR_ADVANCED_INITIAL_PROGRESS),
      completedLessonIds: ["rhythm-eighth-sixteenth"],
      completedExerciseIds: ["rhythm-identify-eighth-notes"],
      updatedAt: "saved-before-navigation",
    });
    const store = createGuitarProgressStore({
      catalog: GUITAR_ADVANCED_DATA,
      initialProgress: GUITAR_ADVANCED_INITIAL_PROGRESS,
      storage,
      now: () => "new-visit",
    });

    store.getState().setLastVisited({
      kind: "exercise",
      id: "rhythm-identify-eighth-notes",
    });

    expect(store.getState().progress.completedLessonIds).toEqual([
      "rhythm-eighth-sixteenth",
    ]);
    expect(store.getState().progress.completedExerciseIds).toEqual([
      "rhythm-identify-eighth-notes",
    ]);
    expect(store.getState().progress.lastVisited).toEqual({
      kind: "exercise",
      id: "rhythm-identify-eighth-notes",
    });
  });

  it("keeps in-memory state when storage writes fail", () => {
    const store = createGuitarProgressStore({
      catalog: GUITAR_ADVANCED_DATA,
      initialProgress: GUITAR_ADVANCED_INITIAL_PROGRESS,
      storage: {
        read: () => null,
        write: () => {
          throw new Error("quota");
        },
        remove: () => {
          throw new Error("denied");
        },
      },
      now: () => "now",
    });
    store.getState().hydrate();
    store.getState().markLessonComplete("rhythm-eighth-sixteenth");
    expect(store.getState().progress.completedLessonIds).toEqual([
      "rhythm-eighth-sixteenth",
    ]);
    expect(store.getState().storageError).toBeTruthy();
  });
});
