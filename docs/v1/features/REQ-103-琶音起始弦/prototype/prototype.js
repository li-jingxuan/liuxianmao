"use strict";

const strings = [1, 2, 3, 4, 5, 6];
const endpoints = ["upper", "lower"];
const endpointLabels = { upper: "上端弦", lower: "下端弦" };
const directionLabels = { up: "上行", down: "下行" };
const chordFrets = {
  C: [0, 1, 0, 2, 3, 0], G: [3, 0, 0, 0, 2, 3], Am: [0, 1, 2, 2, 0, 0],
  F: [1, 1, 2, 3, 3, 1], Em: [0, 0, 0, 2, 2, 0], Dm: [1, 3, 2, 0, 0, 1],
};
const arpeggios = [
  { id: "a", measure: 1, beat: 1, direction: "up", upper: 2, lower: 5 },
  { id: "b", measure: 2, beat: 3, direction: "down", upper: 3, lower: 6 },
  { id: "c", measure: 5, beat: 2, direction: "down", upper: 2, lower: 4 },
  { id: "d", measure: 7, beat: 4, direction: "up", upper: 1, lower: 5 },
];
const scoreRows = [
  [
    { chord: "C", picking: [[], [3], [2], [1]] },
    { chord: "G", picking: [[6], [4], [], [2, 3]] },
    { chord: "Am", picking: [[5], [3], [2], [1, 4]] },
    { chord: "F", picking: [[6], [4], [3], [2, 1]] },
  ],
  [
    { chord: "C", picking: [[5], [], [2], [1]] },
    { chord: "Em", picking: [[6], [4], [3], [2]] },
    { chord: "F", picking: [[6], [4], [3], []] },
    { chord: "G", picking: [[6], [3], [2], [1, 4]] },
  ],
  [
    { chord: "Am", picking: [[5], [3], [2], [1]] },
    { chord: "Dm", picking: [[4], [3], [2], [1]] },
    { chord: "G", picking: [[6], [4], [3], [1, 2]] },
    { chord: "C", picking: [[5], [4], [3], [1, 2, 3]] },
  ],
];

const byId = (id) => document.getElementById(id);
const score = byId("score");
const ui = {
  contextTitle: byId("context-title"), contextDetail: byId("context-detail"),
  empty: byId("empty-selection"), inspector: byId("range-inspector"),
  rangeDirection: byId("range-direction"), rangeSummary: byId("range-summary"),
  preview: byId("preview-state"), rangeRule: byId("range-rule"),
  list: byId("selected-ranges"), batchHelp: byId("batch-help"),
  selectionStatus: byId("selection-status"), actionStatus: byId("action-status"),
  undo: byId("undo"), redo: byId("redo"), upper: byId("upper"), lower: byId("lower"),
};
const initialRanges = Object.fromEntries(arpeggios.map(({ id, upper, lower }) => [id, { upper, lower }]));
const geometry = new Map();
const selected = new Set(["a"]);
const undoStack = [];
const redoStack = [];
let ranges = initialRanges;
let activeId = "a";
let drag = null;

const namespace = "http://www.w3.org/2000/svg";
const staffStart = 19;
const staffEnd = 695;
const stringSpacing = 13.5;
const stringY = (staffY, string) => staffY + (string - 1) * stringSpacing;
const staffYAt = (row) => 63 + row * 156;

function svg(parent, type, attributes = {}, content) {
  const node = document.createElementNS(namespace, type);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  if (content !== undefined) node.textContent = content;
  parent.append(node);
  return node;
}

function line(parent, x1, y1, x2, y2, className) {
  return svg(parent, "line", { x1, y1, x2, y2, class: className });
}

function drawScore() {
  const staff = svg(score, "g", { "aria-hidden": "true" });
  const snapGuide = svg(score, "g", { class: "snap-guide", "aria-hidden": "true", hidden: "" });
  const notation = svg(score, "g", { "aria-hidden": "true" });
  const marks = svg(score, "g", { "aria-label": "谱面琶音" });
  const measures = [staffStart, 205, 368, 531, staffEnd];
  svg(notation, "text", { x: 20, y: 18, class: "tempo" }, "♩ = 84");

  scoreRows.forEach((row, rowIndex) => {
    const staffY = staffYAt(rowIndex);
    const staffBottom = stringY(staffY, 6);
    const stemStart = staffBottom + 9;
    const stemEnd = stemStart + 18;
    strings.forEach((string) => line(staff, staffStart, stringY(staffY, string), staffEnd, stringY(staffY, string), "staff-lines"));
    measures.forEach((x) => line(staff, x, staffY, x, staffBottom, "bar-lines"));
    if (rowIndex === scoreRows.length - 1) {
      line(staff, staffEnd - 5, staffY, staffEnd - 5, staffBottom, "bar-lines");
      line(staff, staffEnd, staffY, staffEnd, staffBottom, "final-bar");
    }

    // 和产品的 TAB 谱号一样，用白描边清出字形周围的空间，六根弦线仍贯穿谱号区。
    [..."TAB"].forEach((letter, index) => svg(notation, "text", {
      x: 26, y: staffY + 16 + index * 20, class: "clef", "paint-order": "stroke", stroke: "white", "stroke-width": 4,
    }, letter));
    if (rowIndex === 0) {
      [24, 51].forEach((offset) => svg(notation, "text", {
        x: 46, y: staffY + offset, class: "time-signature", "paint-order": "stroke", stroke: "white", "stroke-width": 4,
      }, "4"));
    }

    row.forEach(({ chord, picking }, measureIndex) => {
      const measure = rowIndex * 4 + measureIndex + 1;
      const left = measures[measureIndex];
      const chordX = left + (measureIndex === 0 ? 55 : 17);
      const firstNote = chordX + 10;
      const noteSpacing = (measures[measureIndex + 1] - 22 - firstNote) / 3;
      svg(notation, "text", { x: left, y: staffY - 35, class: "measure-number" }, measure);
      svg(notation, "text", { x: chordX, y: staffY - 12, class: "chord" }, chord);
      picking.forEach((picked, beatIndex) => {
        const fretX = firstNote + noteSpacing * beatIndex;
        const mark = arpeggios.find((item) => item.measure === measure && item.beat === beatIndex + 1);
        line(notation, fretX, stemStart, fretX, stemEnd, "stems");
        for (const string of mark ? strings : picked) {
          svg(notation, "text", { x: fretX, y: stringY(staffY, string), class: "fret" }, chordFrets[chord][string - 1]);
        }
        if (mark) addMark(marks, mark, fretX, staffY, stemStart, stemEnd);
      });
    });
  });
  const snapLine = line(snapGuide, staffStart, 0, staffEnd, 0, "snap-line");
  const snapCaption = svg(snapGuide, "g", { class: "snap-caption" });
  svg(snapCaption, "rect", { x: -28, y: -9, width: 43, height: 18, rx: 3 });
  const snapText = svg(snapCaption, "text", { x: -21, y: 4 });
  const handles = svg(score, "g", { "aria-label": "当前琶音的端点" });
  const controls = Object.fromEntries(endpoints.map((endpoint) => [endpoint, addHandle(handles, endpoint)]));
  return { snapGuide, snapLine, snapCaption, snapText, handles, controls };
}

function addMark(parent, mark, fretX, staffY, stemStart, stemEnd) {
  const group = svg(parent, "g", {
    class: "arpeggio", role: "button", tabindex: 0, "aria-pressed": "false",
    "data-arpeggio": mark.id, "data-direction": mark.direction,
  });
  const wave = svg(group, "path", { class: "wave" });
  const arrow = svg(group, "polygon", { class: "arrowhead" });
  line(group, fretX, stemStart, fretX, stemEnd, "stem-highlight");
  const x = fretX - 19;
  const hit = svg(group, "rect", { class: "symbol-hit", x: x - 7, width: 14, rx: 2 });
  svg(group, "rect", { class: "symbol-hit", x: fretX - 7, y: stemStart - 3, width: 14, height: stemEnd - stemStart + 6, rx: 2 });
  geometry.set(mark.id, { mark, x, staffY, group, wave, arrow, hit });
}

function addHandle(parent, endpoint) {
  const group = svg(parent, "g", { class: "handle", role: "slider", tabindex: 0,
    "aria-label": endpointLabels[endpoint], "aria-orientation": "vertical", "data-handle": endpoint });
  line(group, 0, 0, 9, 0, "handle-stem");
  svg(group, "circle", { cx: 9, r: 4, class: "handle-knob" });
  svg(group, "circle", { cx: 9, r: 6.5, class: "handle-hit" });
  return group;
}

function wavePath(x, start, end) {
  // 等分波形至箭头底边。相邻两弦仍能画出完整的波形，两种方向共用同一条绘制规则。
  const length = end - start;
  const cycles = Math.max(1, Math.round(Math.abs(length) / 7));
  const step = length / cycles;
  let path = `M${x} ${start}`;
  for (let i = 0; i < cycles; i++) {
    const y = start + i * step;
    path += ` Q${x - 3} ${y + step / 4} ${x} ${y + step / 2}`;
    path += ` Q${x + 3} ${y + 3 * step / 4} ${x} ${y + step}`;
  }
  return path;
}

const drawing = drawScore();

function formatLocation(mark) {
  return `第 ${mark.measure} 小节 · 第 ${mark.beat} 拍`;
}

function formatRange(range) {
  return `${range.upper}–${range.lower} 弦`;
}

function limits(endpoint) {
  // 批量合法范围取所有所选琶音的交集。每个对象的对端独立保留，并始终与编辑端至少相隔一根弦线。
  const ids = [...selected];
  return endpoint === "upper"
    ? { min: 1, max: Math.min(...ids.map((id) => ranges[id].lower)) - 1 }
    : { min: Math.max(...ids.map((id) => ranges[id].upper)) + 1, max: 6 };
}

function visibleRange(id) {
  if (drag?.string == null || !selected.has(id)) return ranges[id];
  return { ...ranges[id], [drag.endpoint]: drag.string };
}

function renderScore() {
  for (const [id, { mark, x, staffY, group, wave, arrow, hit }] of geometry) {
    const range = visibleRange(id);
    const top = stringY(staffY, range.upper) - 2;
    const bottom = stringY(staffY, range.lower) + 2;
    // TAB 的低音弦在下。上行箭尖在上端，下行箭尖在下端，编辑上下端不会改变发音方向。
    const rising = mark.direction === "up";
    const tip = rising ? top : bottom;
    const base = tip + (rising ? 5.5 : -5.5);
    wave.setAttribute("d", wavePath(x, rising ? bottom : top, base));
    arrow.setAttribute("points", `${x},${tip} ${x - 3.5},${base} ${x + 3.5},${base}`);
    hit.setAttribute("y", top - 4);
    hit.setAttribute("height", bottom - top + 8);
    group.classList.toggle("is-selected", selected.has(id));
    group.classList.toggle("is-active", activeId === id);
    group.setAttribute("aria-pressed", selected.has(id));
    group.setAttribute("aria-label", `${formatLocation(mark)}，${directionLabels[mark.direction]}琶音，${formatRange(range)}`);
    group.dataset.upper = range.upper;
    group.dataset.lower = range.lower;
  }

  drawing.handles.toggleAttribute("hidden", !activeId);
  drawing.snapGuide.toggleAttribute("hidden", drag?.string == null);
  if (!activeId) return;
  const { x, staffY } = geometry.get(activeId);
  const range = visibleRange(activeId);
  endpoints.forEach((endpoint) => {
    const knob = drawing.controls[endpoint];
    const { min, max } = limits(endpoint);
    knob.setAttribute("transform", `translate(${x},${stringY(staffY, range[endpoint])})`);
    knob.setAttribute("aria-valuemin", Math.min(min, range[endpoint]));
    knob.setAttribute("aria-valuemax", Math.max(max, range[endpoint]));
    knob.setAttribute("aria-valuenow", range[endpoint]);
    knob.setAttribute("aria-valuetext", `第 ${range[endpoint]} 弦`);
    knob.toggleAttribute("data-dragging", drag?.endpoint === endpoint);
    knob.dataset.string = range[endpoint];
  });
  if (drag?.string != null) {
    const y = stringY(staffY, drag.string);
    drawing.snapLine.setAttribute("y1", y);
    drawing.snapLine.setAttribute("y2", y);
    drawing.snapCaption.setAttribute("transform", `translate(0,${y})`);
    drawing.snapText.textContent = `第 ${drag.string} 弦`;
  }
}

function directionLabel(direction) {
  const span = document.createElement("span");
  span.className = "direction";
  const icon = svg(span, "svg", { class: "icon", "aria-hidden": "true" });
  svg(icon, "use", { href: `#icon-${direction}` });
  span.append(directionLabels[direction]);
  return span;
}

function selectedRangeRow(id) {
  const { mark } = geometry.get(id);
  const row = document.createElement("li");
  row.className = `selected-range${id === activeId ? " is-active" : ""}`;
  const place = document.createElement("span");
  place.textContent = formatLocation(mark);
  const range = document.createElement("strong");
  range.textContent = formatRange(visibleRange(id));
  row.append(place, directionLabel(mark.direction), range);
  return row;
}

function renderInspector() {
  const ids = arpeggios.map(({ id }) => id).filter((id) => selected.has(id));
  const count = ids.length;
  const batch = count > 1;
  const active = geometry.get(activeId);
  ui.empty.hidden = count > 0;
  ui.inspector.hidden = count === 0;
  ui.preview.hidden = drag?.string == null;
  ui.batchHelp.hidden = !batch;
  ui.list.hidden = !batch;
  ui.contextTitle.textContent = count ? `已选 ${count} 个琶音` : "琶音";
  ui.contextDetail.textContent = active ? `${batch ? "当前琶音在" : ""}${formatLocation(active.mark)}` : "未选择琶音";
  ui.selectionStatus.textContent = count ? `${formatLocation(active.mark)}  ·  已选 ${count} 个琶音` : "未选择琶音";
  ui.undo.disabled = undoStack.length === 0;
  ui.redo.disabled = redoStack.length === 0;
  if (!active) return;

  const visible = visibleRange(activeId);
  const mixed = (endpoint) => ids.some((id) => visibleRange(id)[endpoint] !== visible[endpoint]);
  ui.rangeDirection.replaceChildren(...(batch ? [] : [directionLabel(active.mark.direction)]));
  ui.rangeDirection.hidden = batch;
  ui.rangeSummary.textContent = endpoints.some(mixed) ? "多个范围" : formatRange(visible);
  ui.rangeRule.textContent = drag?.clamped ? "已吸附到最近可用弦。每个琶音至少覆盖两根弦。" : "每个琶音至少覆盖两根弦。";
  for (const endpoint of endpoints) {
    const field = ui[endpoint];
    const { min, max } = limits(endpoint);
    field.options[0].hidden = !mixed(endpoint);
    for (const string of strings) field.options[string].disabled = string < min || string > max;
    field.value = mixed(endpoint) ? "" : String(visible[endpoint]);
    field.disabled = Boolean(drag);
  }
  ui.list.replaceChildren(...(batch ? ids.map(selectedRangeRow) : []));
}

function render() {
  renderScore();
  renderInspector();
}

function select(id, toggle) {
  if (toggle && selected.has(id)) {
    selected.delete(id);
  } else {
    if (!toggle) selected.clear();
    if (id) selected.add(id);
  }
  // 与扫弦一致，增选时保留当前手柄的位置。活动记号被移除后，手柄落到仍选中的第一项。
  if (!toggle || !selected.has(activeId)) activeId = selected.values().next().value ?? null;
  ui.actionStatus.textContent = "";
  render();
}

function commit(endpoint, string) {
  if (!selected.size) return false;
  const { min, max } = limits(endpoint);
  if (!Number.isInteger(string) || string < min || string > max) return false;
  if ([...selected].every((id) => ranges[id][endpoint] === string)) return false;
  const next = { ...ranges };
  // 只覆盖当前端点。用原子快照记录整批修改，一次撤销恢复所有受影响的琶音。
  for (const id of selected) next[id] = { ...ranges[id], [endpoint]: string };
  undoStack.push(ranges);
  redoStack.length = 0;
  ranges = next;
  ui.actionStatus.textContent = `已将 ${selected.size} 个琶音的${endpointLabels[endpoint]}设为第 ${string} 弦`;
  return true;
}

function historyStep(redo) {
  if (drag) return;
  const source = redo ? redoStack : undoStack;
  const destination = redo ? undoStack : redoStack;
  if (!source.length) return;
  destination.push(ranges);
  ranges = source.pop();
  ui.actionStatus.textContent = redo ? "已重做端点调整" : "已撤销端点调整";
  render();
}

function pointerY(event) {
  const matrix = score.getScreenCTM();
  return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()).y;
}

function startDrag(event, endpoint) {
  if (!activeId) return;
  const { staffY } = geometry.get(activeId);
  const origin = ranges[activeId][endpoint];
  drag = {
    endpoint, origin, string: null, staffY, pointerId: event.pointerId,
    offset: pointerY(event) - stringY(staffY, origin), clamped: false,
  };
  // 捕获由持续存在的 SVG 根节点持有，拖出谱面或跨过另一端后仍能完成或取消手势。
  score.setPointerCapture(event.pointerId);
  ui.actionStatus.textContent = "";
  render();
}

function updateDrag(event) {
  const raw = Math.round((pointerY(event) - drag.offset - drag.staffY) / stringSpacing) + 1;
  const { min, max } = limits(drag.endpoint);
  const candidate = Math.max(min, Math.min(max, raw));
  // 按住手柄未换弦或拖回起点时，保留多选前的各个范围，也不产生历史记录。
  const clamped = raw !== drag.origin && raw >= 1 && raw <= 6 && raw !== candidate;
  const string = raw === drag.origin || candidate === drag.origin ? null : candidate;
  if (string === drag.string && clamped === drag.clamped) return;
  drag.string = string;
  drag.clamped = clamped;
  render();
}

function finishDrag(save) {
  if (!drag) return;
  const { endpoint, pointerId, string } = drag;
  // 放手前的绘制与侧栏只读预览使用临时值。先清手势再释放捕获，避免失去捕获时重复结束。
  drag = null;
  if (score.hasPointerCapture(pointerId)) score.releasePointerCapture(pointerId);
  if (!save) ui.actionStatus.textContent = "已取消拖动";
  else if (string !== null) commit(endpoint, string);
  render();
}

for (const endpoint of endpoints) {
  const field = ui[endpoint];
  field.add(new Option("多个值", ""));
  field.options[0].disabled = true;
  strings.forEach((string) => field.add(new Option(`第 ${string} 弦`, string)));
  field.addEventListener("change", () => {
    if (drag) return;
    commit(endpoint, Number(field.value));
    render();
  });
}

score.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || drag) return;
  const handle = event.target.closest("[data-handle]");
  const mark = event.target.closest("[data-arpeggio]");
  if (handle) {
    event.preventDefault();
    if (event.altKey) select(activeId, true);
    else startDrag(event, handle.dataset.handle);
    return;
  }
  if (mark) {
    select(mark.dataset.arpeggio, event.altKey);
    return;
  }
  if (!event.altKey) select(null, false);
});

document.querySelector(".viewport").addEventListener("pointerdown", (event) => {
  if (event.button === 0 && !event.altKey && !drag && activeId && !score.contains(event.target)) {
    select(null, false);
  }
});

score.addEventListener("pointermove", (event) => {
  if (drag?.pointerId === event.pointerId) updateDrag(event);
});
score.addEventListener("pointerup", (event) => {
  if (drag?.pointerId !== event.pointerId) return;
  updateDrag(event);
  finishDrag(true);
});
for (const type of ["pointercancel", "lostpointercapture"]) {
  score.addEventListener(type, (event) => {
    if (drag?.pointerId === event.pointerId) finishDrag(false);
  });
}
window.addEventListener("blur", () => finishDrag(false));

score.addEventListener("keydown", (event) => {
  if (drag) return;
  const mark = event.target.closest("[data-arpeggio]");
  if (mark && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    select(mark.dataset.arpeggio, event.altKey);
  }
  const handle = event.target.closest("[data-handle]");
  if (handle && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
    event.preventDefault();
    const endpoint = handle.dataset.handle;
    const step = event.key === "ArrowUp" ? -1 : 1;
    const current = ranges[activeId][endpoint];
    const { min, max } = limits(endpoint);
    const target = step < 0 ? Math.min(max, current + step) : Math.max(min, current + step);
    if (commit(endpoint, target)) render();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && drag) {
    event.preventDefault();
    finishDrag(false);
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    historyStep(event.shiftKey);
  }
});

ui.undo.addEventListener("click", () => historyStep(false));
ui.redo.addEventListener("click", () => historyStep(true));
byId("technique").addEventListener("click", () => (activeId ? ui.upper : geometry.get("a").group).focus());
byId("reset").addEventListener("click", () => {
  finishDrag(false);
  ranges = initialRanges;
  undoStack.length = 0;
  redoStack.length = 0;
  select("a", false);
  ui.actionStatus.textContent = "已重置示例";
});

render();
