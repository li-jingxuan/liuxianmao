import { StrictMode, useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { ImageExportSnapshot, PreparedScoreImages } from "../components/EditorShell/output/image-export-controller";
import { useImageExportTask } from "../components/EditorShell/output/use-image-export-task";
import { preparations, encodings } from "./image-export-task-controller.fixture";

const snapshot = {} as ImageExportSnapshot;
let current = true;
let task: ReturnType<typeof useImageExportTask>;
const invalid: string[] = [];
const created: string[] = [];
const revoked: string[] = [];
const createUrl = URL.createObjectURL.bind(URL);
const revokeUrl = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = (blob) => {
  const url = createUrl(blob);
  created.push(url);
  return url;
};
URL.revokeObjectURL = (url) => {
  revoked.push(url);
  revokeUrl(url);
};
function Fixture() {
  const result = useImageExportTask({
    snapshot,
    isCurrent: () => current,
    onInvalid: (stage) => invalid.push(stage),
  });
  useLayoutEffect(() => {
    task = result;
    document.body.dataset.status = result.status;
  }, [result]);
  return null;
}
const root = createRoot(document.getElementById("root")!);
flushSync(() => root.render(<StrictMode><Fixture /></StrictMode>));

Object.assign(window, { imageTaskTest: {
  state: () => ({
    status: task.status, title: task.prepared?.title, download: task.download,
    inspected: task.inspected, invalid, created, revoked,
    preparations: preparations.map((item) => item.signal.aborted),
    encodings: encodings.map((item) => item.signal.aborted),
  }),
  prepare: (index: number, title: string, fail = false) => {
    if (fail) preparations[index]!.reject(new Error("late preparation"));
    else preparations[index]!.resolve({ title, pages: [{ index: 0 }, { index: 1 }] } as PreparedScoreImages);
  },
  generate: () => flushSync(() => { void task.generate({ type: "page", index: 0 }); }),
  encode: (index: number, fail = false) => {
    if (fail) encodings[index]!.reject(new Error("late encoding"));
    else encodings[index]!.resolve(new Blob(["png"], { type: "image/png" }));
  },
  cancel: () => flushSync(() => task.cancel()),
  stop: () => flushSync(() => task.stop()),
  reprepare: () => flushSync(() => task.reprepare()),
  inspect: (index: number) => flushSync(() => task.inspectPage(index)),
  range: () => flushSync(() => task.changeRange("page")),
  validate: () => task.validateCurrent(),
  current: (value: boolean) => { current = value; },
  font: () => flushSync(() => document.fonts.dispatchEvent(new Event("loadingdone"))),
  unmount: () => flushSync(() => root.unmount()),
} });
