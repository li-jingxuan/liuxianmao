import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXAMPLE_MVP_7_2_DOCUMENT,
  LXMScoreCommandEnum,
} from "@liuxianmao/lxm-editor";
import { createEditorSession } from "../stores/editor-store";
import { ScoreFileControls } from "../components/EditorShell/output/ScoreFileControls";
import { serializeScoreFile } from "../components/EditorShell/output/score-file";

const harness = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = harness.cursor++;
    if (!(index in harness.values))
      harness.values[index] =
        typeof initial === "function" ? initial() : initial;
    return [
      harness.values[index],
      (next: unknown) => {
        harness.values[index] = next;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = harness.cursor++;
    if (!(index in harness.values))
      harness.values[index] = { current: initial };
    return harness.values[index];
  },
  useEffect: () => {},
  useLayoutEffect: (effect: () => void) => effect(),
}));
vi.mock("antd", () => ({ Button: "button" }));

beforeEach(() => {
  harness.values = [];
  harness.cursor = 0;
});

type NodeProps = {
  children?: ReactNode;
  onClick?: () => void;
  onChange?: (event: unknown) => void;
  type?: string;
};
const find = (
  tree: ReactNode,
  predicate: (node: ReactElement<NodeProps>) => boolean,
): ReactElement<NodeProps> | null => {
  if (Array.isArray(tree)) {
    for (const child of tree) {
      const found = find(child, predicate);
      if (found) return found;
    }
  } else if (isValidElement<NodeProps>(tree)) {
    if (predicate(tree)) return tree;
    return find(tree.props.children, predicate);
  }
  return null;
};
const contains = (tree: ReactNode, text: string): boolean => {
  if (typeof tree === "string") return tree.includes(text);
  if (Array.isArray(tree)) return tree.some((child) => contains(child, text));
  return isValidElement<NodeProps>(tree) && contains(tree.props.children, text);
};
const setup = () => {
  const session = createEditorSession(EXAMPLE_MVP_7_2_DOCUMENT);
  const onBlocked = vi.fn();
  const props = { session, isBlocked: () => false, onBlocked };
  const render = () => {
    harness.cursor = 0;
    return ScoreFileControls(props);
  };
  const click = (tree: ReactNode, label: string) => {
    const button = find(tree, (node) => node.props.children === label);
    expect(button).not.toBeNull();
    button!.props.onClick!();
  };
  let resolve!: (bytes: ArrayBuffer) => void;
  const reading = new Promise<ArrayBuffer>((done) => {
    resolve = done;
  });
  const file = {
    size: 100,
    name: "score.lxm.json",
    arrayBuffer: () => reading,
  };
  const serialized = serializeScoreFile(EXAMPLE_MVP_7_2_DOCUMENT);
  if (!serialized.ok) throw new Error("示例曲谱不能序列化");
  const bytes = new TextEncoder().encode(serialized.text).buffer;
  const choose = () => {
    const input = find(render(), (node) => node.props.type === "file")!;
    input.props.onChange!({
      currentTarget: { files: [file], value: file.name },
    });
  };
  const completeRead = async () => {
    resolve(bytes);
    await reading;
    await Promise.resolve();
  };
  return { session, props, onBlocked, render, click, choose, completeRead };
};

describe("文件入口的当前输入保护", () => {
  it("导入及导出受阻时通知统一提示，处理完成不会自动继续", () => {
    const { props, onBlocked, render, click, session } = setup();
    const before = session.getState();
    props.isBlocked = () => true;
    click(render(), "导入曲谱");
    click(render(), "导出曲谱");
    expect(onBlocked.mock.calls).toEqual([["import"], ["export"]]);
    props.isBlocked = () => false;
    expect(contains(render(), "导入并替换")).toBe(false);
    expect(session.getState()).toBe(before);
  });

  it("读取期间出现未应用输入时用最新闸门拒绝候选，处理后要求重试", async () => {
    const { choose, completeRead, props, render, onBlocked, session } = setup();
    const before = session.getState();
    choose();
    props.isBlocked = () => true;
    render();
    await completeRead();
    expect(onBlocked).toHaveBeenCalledWith("import");
    expect(contains(render(), "导入并替换")).toBe(false);
    props.isBlocked = () => false;
    render();
    expect(session.getState()).toBe(before);
  });

  it("读取期间编辑再撤销，完整版本仍拒绝导入", async () => {
    const { choose, completeRead, render, session } = setup();
    const document = session.getState().document;
    choose();
    session
      .getState()
      .execute({
        type: LXMScoreCommandEnum.SetNotationInfo,
        title: "变化",
        arranger: "",
        keySignature: "C",
      });
    session.getState().undo();
    expect(session.getState().document).toBe(document);
    await completeRead();
    expect(contains(render(), "读取期间曲谱已变化")).toBe(true);
    expect(contains(render(), "导入并替换")).toBe(false);
  });

  it("候选确认前新增输入则关闭并丢弃候选，应用输入后不能续跑旧导入", async () => {
    const { choose, completeRead, props, render, click, onBlocked, session } =
      setup();
    const before = session.getState();
    choose();
    await completeRead();
    expect(contains(render(), "导入并替换")).toBe(true);
    props.isBlocked = () => true;
    click(render(), "导入并替换");
    expect(onBlocked).toHaveBeenCalledWith("import");
    props.isBlocked = () => false;
    expect(contains(render(), "导入并替换")).toBe(false);
    expect(session.getState()).toBe(before);
  });

  it("确认前版本改变不会覆盖当前文档，干净候选经明确确认才替换会话", async () => {
    const { choose, completeRead, render, click, session } = setup();
    choose();
    await completeRead();
    session
      .getState()
      .execute({
        type: LXMScoreCommandEnum.SetNotationInfo,
        title: "保留",
        arranger: "",
        keySignature: "C",
      });
    click(render(), "导入并替换");
    expect(session.getState().document?.score.title).toBe("保留");
    expect(contains(render(), "导入并替换")).toBe(false);
    choose();
    await completeRead();
    const previousVersion = session.getState().sessionVersion;
    click(render(), "导入并替换");
    expect(session.getState().document?.score.title).toBe(
      EXAMPLE_MVP_7_2_DOCUMENT.score.title,
    );
    expect(session.getState().sessionVersion).toBeGreaterThan(previousVersion);
    expect(session.getState().historyDepth.past).toBe(0);
  });
});
