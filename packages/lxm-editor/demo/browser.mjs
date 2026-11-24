import {
  LXMScoreCommandEnum, applyScoreCommand, buildLayout, buildScoreScene,
  createDocumentHistory, hitTestLayout, loadDocument, transitionDocumentHistory,
} from "@liuxianmao/lxm-editor";
import { exampleScoreJson } from "./score.mjs";

const svg = document.querySelector("#score");
const fret = document.querySelector("#fret");
const status = document.querySelector("#status");
const undo = document.querySelector("#undo");
const redo = document.querySelector("#redo");
const loaded = loadDocument(exampleScoreJson);
if (!loaded.ok) {
  status.textContent = loaded.errors.join("；");
  throw new Error(status.textContent);
}
let score = loaded.document;
let history = createDocumentHistory();
let layout;

/** 场景已经按绘制顺序提供几何与样式。文字通过 textContent 写入，保留原始曲谱文字。 */
function renderPrimitive({ kind, text, points, fill = "none", ...attributes }) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", kind);
  element.setAttribute("fill", fill);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || key.endsWith("Id")) continue;
    const attribute = key === "dash" ? "stroke-dasharray"
      : key === "lineCap" ? "stroke-linecap"
      : key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    element.setAttribute(attribute, value);
  }
  if (kind === "text") element.textContent = text;
  if (kind === "polygon") element.setAttribute("points", points.map((pair) => pair.join(",")).join(" "));
  return element;
}

function render() {
  layout = buildLayout(score, { systemWidth: 600, purpose: "editing" });
  const scene = buildScoreScene(layout);
  svg.setAttribute("viewBox", `${layout.x} ${layout.y} ${layout.width} ${layout.height}`);
  svg.replaceChildren(...scene.header.map(renderPrimitive),
    ...scene.systems.flatMap(({ items }) => items.map(renderPrimitive)));
  status.textContent = `文档版本 ${score.documentRevision}`;
  undo.disabled = !history.past.length;
  redo.disabled = !history.future.length;
}

svg.addEventListener("click", (event) => {
  // 指针坐标属于视口。逆 SVG 屏幕矩阵同时处理 viewBox、CSS 缩放和页面滚动。
  const matrix = svg.getScreenCTM();
  if (!matrix) return;
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  const target = hitTestLayout(layout, point);
  if (!target) {
    status.textContent = "请点击小节内的弦线。";
    return;
  }
  const result = applyScoreCommand(score, {
    type: LXMScoreCommandEnum.SetNote,
    trackId: target.trackId,
    measureId: target.measureId,
    beatId: target.beatId,
    string: target.string,
    fret: fret.valueAsNumber,
    expectedRevision: score.documentRevision,
  });
  if (!result.ok) {
    status.textContent = result.message;
    return;
  }
  if (!result.changed) return;
  history = transitionDocumentHistory(history, { type: "commit", document: score, entry: "修改品位" });
  score = result.document;
  render();
});

undo.addEventListener("click", () => {
  const keepCount = history.past.length - 1;
  const snapshot = history.past[keepCount];
  if (!snapshot) return;
  history = transitionDocumentHistory(history, { type: "undo", document: score, keepCount });
  score = snapshot;
  render();
});

redo.addEventListener("click", () => {
  const snapshot = history.future[0];
  if (!snapshot) return;
  history = transitionDocumentHistory(history, { type: "redo", document: score });
  score = snapshot;
  render();
});

render();
