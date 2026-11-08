import { describe, expect, it } from "vitest";
import {
  EXAMPLE_TECHNIQUE_RHYTHM_DOCUMENT,
  EXAMPLE_MUTED_NOTE_DOCUMENT,
  LXMScoreCommandEnum,
  getFirstTabCellReference,
} from "@liuxianmao/lxm-editor";
import { createEditorSession } from "../stores/editor-store";

describe("x 弹奏标记会话集成", () => {
  it("初始/SSR 快照直接携带合法混合谱，不先闪现空文档错误", () => {
    const session = createEditorSession(EXAMPLE_MUTED_NOTE_DOCUMENT);
    expect(session.getInitialState().document).toEqual(
      EXAMPLE_MUTED_NOTE_DOCUMENT,
    );
    expect(session.getInitialState().errorMessage).toBeNull();
    expect(session.getState().sessionVersion).toBe(0);
  });
  it("数字转 x 保留技巧，一条历史可撤销/重做并通知宿主", () => {
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
    ).toHaveLength(0);
    expect(session.getState().document!.score.tracks[0]!.techniques).toEqual(
      EXAMPLE_TECHNIQUE_RHYTHM_DOCUMENT.score.tracks[0]!.techniques,
    );
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
