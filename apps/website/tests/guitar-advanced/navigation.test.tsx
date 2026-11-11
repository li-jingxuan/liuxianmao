import { describe, expect, it, vi } from "vitest";
import type { MouseEvent } from "react";
import { LearningButton } from "../../components/GuitarAdvanced/LearningButton";
import { createGuitarProgressStore } from "../../stores/guitar-advanced-store";
import {
  GUITAR_ADVANCED_DATA as data,
  GUITAR_ADVANCED_EXAM as exam,
  GUITAR_ADVANCED_INITIAL_PROGRESS as initialProgress,
} from "../../data/guitar-advanced";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

describe("learning navigation with unsaved records", () => {
  it("routes internally without reloading and keeps failed practice and exam writes until retry", () => {
    let failWrite = true;
    let saved = "";
    const store = createGuitarProgressStore({
      catalog: data,
      exam,
      initialProgress: {
        ...initialProgress,
        completedLessonIds: data.lessons.map((lesson) => lesson.id),
        completedExerciseIds: data.exercises.map((exercise) => exercise.id),
      },
      storage: {
        read: () => null,
        write: (_key, value) => {
          if (failWrite) throw new Error("quota");
          saved = value;
        },
        remove: () => { throw new Error("delete denied"); },
      },
      now: () => "2026-10-18T12:00:00.000Z",
      createId: () => "unsaved-attempt",
    });
    const exercise = data.exercises[0]!;
    expect(store.getState().submitExercise(exercise.id, exercise.answer)).toEqual({ ok: true, persisted: false });
    const started = store.getState().startExam();
    expect(started).toMatchObject({ ok: true, persisted: false });
    const snapshot = store.getState().progress;
    expect(snapshot.examAttempts).toHaveLength(1);
    const button = LearningButton({ href: "/guitar-advanced/progress", children: "学习进度" });
    expect(button.props.href).toBeUndefined();
    button.props.onClick({ defaultPrevented: false } as MouseEvent<HTMLButtonElement>);
    expect(push).toHaveBeenCalledWith("/guitar-advanced/progress");
    // 新页面记录访问位置也不能清空同一布局 store 中的临时答卷与练习记录。
    store.getState().setLastVisited({ kind: "exercise", id: exercise.id });
    expect(store.getState().progress.examAttempts).toEqual(snapshot.examAttempts);
    expect(store.getState().progress.exerciseResults).toEqual(snapshot.exerciseResults);
    expect(store.getState().requestProductExit()).toBe(false);
    expect(store.getState().notification).toContain("重试保存");
    expect(store.getState().storageIssue?.kind).toBe("writeFailed");
    // 清除失败会改变提示类型，但不能把未保存状态误判为已保存。
    store.getState().clearProgress();
    expect(store.getState().storageIssue?.kind).toBe("deleteFailed");
    expect(store.getState().requestProductExit()).toBe(false);
    failWrite = false;
    expect(store.getState().retryPersist()).toEqual({ ok: true, persisted: true });
    expect(store.getState().requestProductExit()).toBe(true);
    expect(JSON.parse(saved).examAttempts).toEqual(snapshot.examAttempts);
    expect(JSON.parse(saved).exerciseResults).toEqual(snapshot.exerciseResults);
  });

  it("respects a cancelled action and preserves button accessibility props", () => {
    push.mockClear();
    const button = LearningButton({
      href: "/guitar-advanced/exam",
      disabled: true,
      "aria-label": "继续考试",
      onClick: (event) => event.preventDefault(),
    });
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    button.props.onClick(event as MouseEvent<HTMLButtonElement>);
    expect(push).not.toHaveBeenCalled();
    expect(button.props.disabled).toBe(true);
    expect(button.props["aria-label"]).toBe("继续考试");
  });
});
