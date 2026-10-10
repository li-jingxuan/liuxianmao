import { describe, expect, it } from "vitest";
import {
  EXAMPLE_TECHNIQUE_RHYTHM_DOCUMENT,
  EXAMPLE_MUTED_NOTE_DOCUMENT,
  LXMScoreCommandEnum,
  getFirstTabCellReference,
} from "@liuxianmao/lxm-editor";
import { createEditorSession } from "../stores/editor-store";

describe("闷音会话集成", () => {
  it("初始/SSR 快照直接携带合法混合谱，不先闪现空文档错误", () => {
    const session = createEditorSession(EXAMPLE_MUTED_NOTE_DOCUMENT);
    expect(session.getInitialState().document).toEqual(
      EXAMPLE_MUTED_NOTE_DOCUMENT,
    );
    expect(session.getInitialState().errorMessage).toBeNull();
    expect(session.getState().sessionVersion).toBe(0);
  });
  it("数字转 x 一条历史含技巧影响，撤销/重做完整恢复并通知宿主", () => {
    const changes: string[] = [];
    const session = createEditorSession(EXAMPLE_TECHNIQUE_RHYTHM_DOCUMENT, {
      onChange: (event) => changes.push(event.reason),
    });
    const first = getFirstTabCellReference(session.getState().document!)!;
    session
      .getState()
      .execute({ type: LXMScoreCommandEnum.SetNote, ...first, fret: "x" });
    expect(session.getState().historyDepth.past).toBe(1);
    expect(
      session
        .getState()
        .effects.filter((effect) => effect.kind === "technique.removed"),
    ).toHaveLength(2);
    expect(
      session.getState().document!.score.tracks[0]!.measures[0]!.beats[0]!
        .notes[0]!.fret,
    ).toBe("x");
    session.getState().undo();
    expect(session.getState().document).toEqual(
      EXAMPLE_TECHNIQUE_RHYTHM_DOCUMENT,
    );
    session.getState().redo();
    expect(
      session.getState().document!.score.tracks[0]!.measures[0]!.beats[0]!
        .notes[0]!.fret,
    ).toBe("x");
    expect(changes).toEqual(["command", "undo", "redo"]);
    expect(session.getState().effects).toEqual([]);
  });
});
