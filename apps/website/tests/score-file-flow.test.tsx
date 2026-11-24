import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { keySignatureForTonality, LXMScoreCommandEnum, readScoreTonality, type ScoreTonalityV1 } from "@liuxianmao/lxm-editor";
import { EXAMPLE_MVP_7_2_DOCUMENT } from "../../../packages/lxm-editor/example/fixtures";
import { createEditorSessionStore as createEditorSession, selectScoreFileStatus } from "../../../packages/lxm-editor-react/src/stores/editor-store";
import { ScoreImportModal } from "../../../packages/lxm-editor-react/src/EditorShell/output/ScoreImportModal";
import { useScoreFileFlow, type BoundScoreFile } from "../../../packages/lxm-editor-react/src/EditorShell/output/use-score-file-flow";
import type { EditorHost, EditorHostFile, EditorHostResult } from "../../../packages/lxm-editor-react/src/editor-host";
import { captureEditorVersion } from "../../../packages/lxm-editor-react/src/EditorShell/session/editor-session-version";
import { decodeScoreFile, serializeScoreFile } from "../../../packages/lxm-editor-react/src/EditorShell/output/score-file";
import { createBlankScore, newScoreSignatures, newScoreTonics } from "../../../packages/lxm-editor-react/src/EditorShell/output/new-score";

const harness = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = harness.cursor++;
    if (!(index in harness.values)) harness.values[index] = typeof initial === "function" ? initial() : initial;
    return [harness.values[index], (next: unknown) => { harness.values[index] = next; }];
  },
  useRef: (initial: unknown) => {
    const index = harness.cursor++;
    if (!(index in harness.values)) harness.values[index] = { current: initial };
    return harness.values[index];
  },
  useEffect: (effect: () => void) => effect(),
}));

beforeEach(() => { harness.values = []; harness.cursor = 0; });

type NodeProps = { children?: ReactNode; onClick?: () => void; onChange?: (event: unknown) => void; type?: string; disabled?: boolean };
const nodes = (tree: ReactNode): ReactElement<NodeProps>[] => {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!isValidElement<NodeProps>(tree)) return [];
  return [tree, ...nodes(tree.props.children)];
};
const rename = (session: ReturnType<typeof createEditorSession>, title: string) => {
  const current = session.getState().document!.score;
  expect(session.getState().execute({
    type: LXMScoreCommandEnum.SetNotationInfo, title, arranger: current.arranger, keySignature: current.keySignature,
  })?.ok).toBe(true);
};

function importHarness() {
  const session = createEditorSession(EXAMPLE_MVP_7_2_DOCUMENT);
  const canContinue = vi.fn(() => true);
  const onOpen = vi.fn();
  const render = () => {
    harness.cursor = 0;
    return nodes(ScoreImportModal({ session, canContinue, onClose: vi.fn(), onOpen }));
  };
  const serialized = serializeScoreFile(EXAMPLE_MVP_7_2_DOCUMENT);
  if (!serialized.ok) throw new Error("示例曲谱无法序列化");
  const bytes = new TextEncoder().encode(serialized.text).buffer;
  const open = () => render().find((node) => node.props.children === "打开曲谱")!.props;
  const choose = () => {
    let resolve!: (bytes: ArrayBuffer) => void;
    const reading = new Promise<ArrayBuffer>((done) => { resolve = done; });
    const input = render().find((node) => node.props.type === "file")!;
    input.props.onChange!({ currentTarget: {
      files: [{ size: bytes.byteLength, name: "同名.LxM", arrayBuffer: () => reading }], value: "同名.LxM",
    } });
    return async () => { resolve(bytes); await reading; await Promise.resolve(); };
  };
  return { session, canContinue, onOpen, open, choose };
}

function desktopFileHarness() {
  const session = createEditorSession(EXAMPLE_MVP_7_2_DOCUMENT);
  const host = {
    openScore: vi.fn<EditorHost["openScore"]>(), saveScore: vi.fn<EditorHost["saveScore"]>(),
    writeOutput: vi.fn<EditorHost["writeOutput"]>(), print: vi.fn<EditorHost["print"]>(),
    onAction: vi.fn<EditorHost["onAction"]>(), resolveClose: vi.fn<EditorHost["resolveClose"]>(),
  } satisfies EditorHost;
  const boundFileRef = { current: undefined as BoundScoreFile | undefined };
  const useFileFlowForTest = () => {
    harness.cursor = 0;
    return useScoreFileFlow({ session, host, boundFileRef });
  };
  return { session, host, render: useFileFlowForTest, boundFileRef };
}

describe("曲谱文件流程", () => {
  it("读取期间新增草稿时拒绝旧候选，重新选择同名文件可以继续", async () => {
    const { canContinue, onOpen, open, choose } = importHarness();
    const finish = choose();
    canContinue.mockReturnValue(false);
    await finish();
    expect(open().disabled).toBe(true);
    expect(onOpen).not.toHaveBeenCalled();
    canContinue.mockReturnValue(true);
    await choose()();
    expect(open().disabled).toBe(false);
    open().onClick!();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("开始读取后即使修改再撤销，候选仍然过期", async () => {
    const { session, onOpen, open, choose } = importHarness();
    const finish = choose();
    rename(session, "变化");
    session.getState().undo();
    await finish();
    expect(open().disabled).toBe(true);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("预览后文档改变，确认不会替换当前谱", async () => {
    const { session, onOpen, open, choose } = importHarness();
    await choose()();
    rename(session, "保留");
    open().onClick!();
    expect(onOpen).not.toHaveBeenCalled();
    expect(open().disabled).toBe(true);
    expect(session.getState().document?.score.title).toBe("保留");
  });

  it("草稿阻断打开文件面板及候选替换，完成后不续跑原操作", () => {
    const session = createEditorSession(EXAMPLE_MVP_7_2_DOCUMENT);
    const isBlocked = vi.fn(() => true);
    const onBlocked = vi.fn();
    const flow = useScoreFileFlow({ session, isBlocked, onBlocked });
    flow.showPanel("import", null);
    flow.showPanel("json", null);
    flow.requestReplacement(EXAMPLE_MVP_7_2_DOCUMENT, "file", captureEditorVersion(session.getState()));
    expect(onBlocked).toHaveBeenCalledTimes(3);
    isBlocked.mockReturnValue(false);
    harness.cursor = 0;
    expect(useScoreFileFlow({ session, isBlocked, onBlocked }).panel).toBeUndefined();
    expect(session.getState().sessionVersion).toBe(0);
  });

  it("新建调性全部可导出，空谱保留每个单位拍的可编辑位置", () => {
    expect(newScoreTonics.major).toHaveLength(12);
    expect(newScoreTonics.minor).toHaveLength(12);
    for (const [mode, tonics] of Object.entries(newScoreTonics)) {
      for (const tonic of tonics) {
        const tonality: ScoreTonalityV1 = mode === "minor" ? { version: 1, mode, tonic, minorTonicDegree: 6 } : { version: 1, mode: "major", tonic };
        const document = createBlankScore({ title: "  调性测试  ", arranger: "作者 <&>", tonality, timeSignature: newScoreSignatures[2]! });
        expect(document.score.title).toBe("调性测试");
        expect(document.score.keySignature).toBe(keySignatureForTonality(tonality));
        expect(readScoreTonality(document)).toMatchObject({ kind: "confirmed", tonality });
        const measures = document.score.tracks[0]!.measures;
        expect(measures).toHaveLength(4);
        expect(measures.every((measure) => measure.beats.length === measure.timeSignature.numerator && measure.beats.every((beat) => beat.kind === "notes" && !beat.notes.length))).toBe(true);
        expect(serializeScoreFile(document).ok).toBe(true);
      }
    }
  });

  it.each([
    ["standard", [64, 59, 55, 50, 45, 40]],
    ["dropD", [64, 59, 55, 50, 45, 38]],
    ["halfStepDown", [63, 58, 54, 49, 44, 39]],
    ["openG", [62, 59, 55, 50, 43, 38]],
    ["dadgad", [62, 57, 55, 50, 45, 38]],
  ] as const)("新建曲谱的 %s 调弦通过原生文件往返", (tuning, midi) => {
    const document = createBlankScore({
      title: "调弦测试", arranger: "", tonality: { version: 1, mode: "major", tonic: "C" },
      timeSignature: { numerator: 4, denominator: 4 }, tuning,
    });
    const strings = document.score.tracks[0]!.tuning.strings;
    expect(strings.map((string) => string.midi)).toEqual(midi);
    const serialized = serializeScoreFile(document);
    if (!serialized.ok) throw new Error(serialized.errors.join("\n"));
    const restored = decodeScoreFile(new TextEncoder().encode(serialized.text).buffer);
    expect(restored).toMatchObject({ ok: true, document });
  });

  it("文件基线比较曲谱内容，过期快照与其他会话不得标记当前新修改已导出", () => {
    const session = createEditorSession(EXAMPLE_MVP_7_2_DOCUMENT);
    const read = () => selectScoreFileStatus(session.getState());
    expect(read()).toBe("example");
    session.getState().replaceDocument(EXAMPLE_MVP_7_2_DOCUMENT, "file");
    const baseline = session.getState();
    expect(read()).toBe("imported");
    rename(session, "编辑之后");
    expect(read()).toBe("pending");
    session.getState().recordScoreExport(baseline.document!, baseline.sessionVersion);
    expect(read()).toBe("pending");
    rename(session, baseline.document!.score.title);
    expect(read()).toBe("exported");
    session.getState().replaceDocument(EXAMPLE_MVP_7_2_DOCUMENT, "new");
    session.getState().recordScoreExport(baseline.document!, baseline.sessionVersion);
    expect(read()).toBe("pending");
    expect(session.getState().selection).not.toBeNull();
  });

  it("桌面确认打开后沿用文件标识，失败和取消保留旧谱覆盖提示", async () => {
    const { session, host, render, boundFileRef } = desktopFileHarness();
    host.openScore.mockResolvedValue({ status: "ok", value: { id: "old", name: "旧谱.lxm", bytes: new ArrayBuffer(0) } });
    render().showPanel("import", null);
    await Promise.resolve();
    const preview = render();
    expect(preview.nativeImport?.id).toBe("old");
    expect(boundFileRef.current).toBeUndefined();
    preview.requestReplacement(EXAMPLE_MVP_7_2_DOCUMENT, "file", preview.nativeImport!.version, "旧谱.lxm", 7);
    expect(boundFileRef.current).toMatchObject({ id: "old", sourceVersion: 7 });
    rename(session, "改过的谱");

    host.saveScore.mockResolvedValueOnce({ status: "cancelled" }).mockResolvedValueOnce({ status: "error", message: "磁盘写入失败" });
    await render().saveNative();
    await render().saveNative();
    expect(host.saveScore).toHaveBeenCalledTimes(2);
    expect(host.saveScore).toHaveBeenLastCalledWith(expect.objectContaining({ fileId: "old", confirmUpgrade: true }));
    expect(selectScoreFileStatus(session.getState())).toBe("pending");
    expect(boundFileRef.current).toMatchObject({ id: "old", sourceVersion: 7 });

    host.saveScore.mockResolvedValueOnce({ status: "ok", value: { id: "copy", name: "副本.lxm" } });
    await render().saveNative(true);
    expect(host.saveScore).toHaveBeenLastCalledWith(expect.objectContaining({ fileId: undefined, confirmUpgrade: false }));
    expect(selectScoreFileStatus(session.getState())).toBe("exported");
    expect(boundFileRef.current).toMatchObject({ id: "copy" });
  });

  it("保存并关闭时按系统回执记录实际快照，新修改阻止关闭", async () => {
    const { session, host, render } = desktopFileHarness();
    rename(session, "保存时的曲名");
    render().requestClose();
    let finish!: (result: EditorHostResult<EditorHostFile>) => void;
    host.saveScore.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const saving = render().saveNative(false, true);
    rename(session, "等待期间修改的曲名");
    finish({ status: "ok", value: { id: "saved", name: "测试.lxm" } });
    await saving;

    expect(host.resolveClose).not.toHaveBeenCalled();
    expect(render().error).toContain("保存期间曲谱已变化");
    expect(session.getState().fileBaseline?.document.score.title).toBe("保存时的曲名");
    expect(selectScoreFileStatus(session.getState())).toBe("pending");
  });
});
