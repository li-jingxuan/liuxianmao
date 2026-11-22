const templates = [
  { name: "上上下", strokes: ["上", "", "上", "", "下", "", "", ""] },
  { name: "上下上下", strokes: ["上", "", "下", "", "上", "", "下", ""] },
  { name: "下-下上", strokes: ["下", "", "", "", "下", "上", "", ""] },
  { name: "下-下下上", strokes: ["下", "", "", "", "下", "", "下", "上"] },
  { name: "下下上", strokes: ["下", "", "下", "", "上", "", "", ""] },
  { name: "下上下", strokes: ["下", "", "上", "", "下", "", "", ""] },
  { name: "下上下上", strokes: ["下", "", "上", "", "下", "", "上", ""] },
  { name: "下上", strokes: ["下", "", "", "", "上", "", "", ""] },
];
const bars = [
  { chord: "G", meter: "4/4", slots: 8, frets: [3, 3, 0, 0, 2, 3] },
  { chord: "C", meter: "4/4", slots: 8, frets: [0, 1, 0, 2, 3, null], passing: [null, null, null, 3, null, null] },
  { chord: "", meter: "4/4", slots: 8, frets: null },
  { chord: "D", meter: "3/4", slots: 6, frets: [2, 3, 2, 0, null, null] },
];

const get = (id) => document.getElementById(id);
const cards = get("templates");
const score = get("score");
const dialog = get("confirm");
const apply = get("apply");
const undo = get("undo");
const tool = get("tool");
const inspector = get("inspector");
const state = {
  first: 0,
  last: 1,
  anchor: 0,
  selected: templates.findIndex((template) => template.name === "下上下上"),
  view: "preview",
  category: "strum",
  saved: bars.map(() => null),
  history: [],
};
let pending = null;

function press(button, pressed) {
  button.setAttribute("aria-pressed", String(pressed));
}

function affectedBars() {
  return Array.from({ length: state.last - state.first + 1 }, (_, offset) => state.first + offset);
}

function rangeText() {
  return state.first === state.last
    ? `第 ${state.first + 1} 小节`
    : `第 ${state.first + 1}–${state.last + 1} 小节`;
}

function availability(indices) {
  const unsupported = indices.find((index) => bars[index].meter !== "4/4");
  if (unsupported !== undefined) return `第 ${unsupported + 1} 小节为 ${bars[unsupported].meter}。请选择 4/4 的小节。`;
  const missing = indices.find((index) => !bars[index].frets);
  if (missing !== undefined) return `第 ${missing + 1} 小节首拍还没有可扫的音组。请先输入至少两根弦的音。`;
  return "";
}

function beatsMarkup(template, detailed) {
  return Array.from({ length: 4 }, (_, index) => {
    const pair = template.strokes.slice(index * 2, index * 2 + 2);
    if (!detailed) return `<span>${pair.map((stroke) => `<span class="${stroke ? "" : "hold"}">${stroke || "·"}</span>`).join("")}</span>`;
    const description = pair.map((stroke, slot) => `${slot ? "后半拍" : "前半拍"}${stroke ? `${stroke}扫` : "延续"}`).join("，");
    return `<span class="beat" aria-label="第 ${index + 1} 拍，${description}" role="img">
      <span class="counts" aria-hidden="true"><span>${index + 1}</span><span>&amp;</span></span>
      <span class="strokes" aria-hidden="true">${pair.map((stroke) => `<span class="stroke ${stroke ? "hit" : "hold"}">${stroke || "·"}</span>`).join("")}</span>
    </span>`;
  }).join("");
}

function notesFor(bar, templateIndex) {
  if (!bar.frets) return [];
  if (templateIndex === null) {
    const first = { slot: 0, length: bar.passing ? 4 : bar.slots, frets: bar.frets };
    return bar.passing ? [first, { slot: 4, length: 4, frets: bar.passing }] : [first];
  }
  const attacks = templates[templateIndex].strokes.flatMap((direction, slot) => direction ? [{ direction, slot }] : []);
  return attacks.map((attack, index) => ({
    ...attack,
    length: (attacks[index + 1]?.slot ?? bar.slots) - attack.slot,
    frets: bar.frets,
  }));
}

function drawNote(note, staged) {
  const x = 40 + note.slot * 36;
  const stringY = (string) => 57 + string * 9;
  const strings = note.frets.flatMap((fret, string) => fret === null ? [] : [string]);
  const frets = strings.map((string) => `<text class="fret" x="${x}" y="${stringY(string) + 3.5}" text-anchor="middle">${note.frets[string]}</text>`).join("");
  const top = stringY(strings[0]);
  const bottom = stringY(strings.at(-1));
  const shift = x - 12;
  const arrowhead = note.direction === "下" ? `M${shift - 3} ${top + 5}l3 -5 3 5` : `M${shift - 3} ${bottom - 5}l3 5 3 -5`;
  const arrow = note.direction ? `<path class="arrow${staged ? " ghost" : ""}" d="M${shift} ${top}V${bottom} ${arrowhead}"/>` : "";
  const length = x + note.length * 36 - 12;
  return `${frets}${arrow}<path class="duration" d="M${x} 108v10H${length}"/>`;
}

function drawBar(bar, index, selected, staged) {
  const template = staged ? state.selected : state.saved[index];
  const staff = Array.from({ length: 6 }, (_, string) => `M15 ${57 + string * 9}H324`).join(" ");
  const notes = notesFor(bar, template).map((note) => drawNote(note, staged)).join("");
  const content = bar.chord ? `<text class="chord" x="40" y="45">${bar.chord}</text>` : "";
  // The same fret ordering is used by the printed TAB: high E at the top.
  return `<button class="measure" type="button" data-bar="${index}" aria-pressed="${selected}" aria-label="第 ${index + 1} 小节，${bar.meter}，${bar.chord || "空小节"}">
    <svg viewBox="0 0 340 134" aria-hidden="true" focusable="false">
      <text class="bar-meta" x="15" y="24">${index + 1}　${bar.meter}</text>
      ${content}<path class="staff" d="${staff} M15 57v45 M324 57v45"/>
      ${notes}
    </svg>
  </button>`;
}

function render() {
  const indices = affectedBars();
  const block = availability(indices);
  const allSaved = indices.every((index) => state.saved[index] === state.selected);
  const canPreview = state.category === "strum" && !block && !allSaved && !inspector.hidden;
  const previewShown = canPreview && state.view === "preview";
  const passingRemoved = indices.some((index) => bars[index].passing && state.saved[index] === null);
  const meters = [...new Set(indices.map((index) => bars[index].meter))];

  get("meter").textContent = meters.join(" / ");
  get("range").textContent = rangeText();
  get("selection").textContent = `已选 ${rangeText()}`;
  get("sources").innerHTML = indices.map((index) => `<span class="source">第 ${index + 1} 小节<b>${bars[index].chord ? `${bars[index].chord} 音组` : "无音组"}</b></span>`).join("");
  get("timeline").innerHTML = beatsMarkup(templates[state.selected], true);
  const notice = get("notice");
  notice.dataset.kind = allSaved ? "done" : "warning";
  notice.textContent = block || (allSaved ? "所选小节已应用此模板。" : passingRemoved
    ? "将替换原 TAB 节奏，并移除第 2 小节的 1 个经过音。"
    : "将以首拍音组重写原 TAB 节奏。");
  apply.disabled = Boolean(block) || allSaved;
  undo.disabled = state.history.length === 0;
  get("regular").hidden = state.category !== "regular";
  get("strum").hidden = state.category !== "strum";

  document.querySelectorAll("[data-template]").forEach((button) => press(button, Number(button.dataset.template) === state.selected));
  document.querySelectorAll("[data-category]").forEach((button) => press(button, button.dataset.category === state.category));
  document.querySelectorAll("[data-view]").forEach((button) => {
    press(button, (previewShown ? "preview" : "original") === button.dataset.view);
    button.disabled = button.dataset.view === "preview" && !canPreview;
  });
  const originalLabel = allSaved ? "已应用" : "当前曲谱";
  get("view-title").textContent = previewShown ? "扫弦预览" : originalLabel;
  get("view-caption").textContent = previewShown ? `${rangeText()} · 仅预览` : rangeText();
  score.innerHTML = bars.map((bar, index) => {
    const selected = indices.includes(index);
    return drawBar(bar, index, selected, selected && previewShown);
  }).join("");
}

function chooseRange(anchor, end) {
  state.anchor = anchor;
  state.first = Math.min(anchor, end);
  state.last = Math.max(anchor, end);
  state.view = "preview";
  get("status").textContent = `已选择${rangeText()}`;
}

cards.innerHTML = templates.map((template, index) => `<button type="button" class="template" data-template="${index}" aria-pressed="false">
  <strong>${template.name}<span aria-hidden="true">✓</span></strong><span class="mini" aria-hidden="true">${beatsMarkup(template, false)}</span>
</button>`).join("");

cards.addEventListener("click", (event) => {
  const button = event.target.closest("[data-template]");
  if (!button) return;
  state.selected = Number(button.dataset.template);
  state.view = "preview";
  get("status").textContent = `已选择「${templates[state.selected].name}」`;
  render();
});

score.addEventListener("click", (event) => {
  const button = event.target.closest("[data-bar]");
  if (!button) return;
  const index = Number(button.dataset.bar);
  chooseRange(event.shiftKey ? state.anchor : index, index);
  document.querySelectorAll("[data-demo]").forEach((demo) => press(demo, false));
  render();
  score.querySelector(`[data-bar="${index}"]`).focus({ preventScroll: true });
});

document.querySelectorAll("[data-demo]").forEach((button) => button.addEventListener("click", () => {
  const start = Number(button.dataset.demo);
  chooseRange(start, start === 0 ? 1 : start);
  document.querySelectorAll("[data-demo]").forEach((demo) => press(demo, demo === button));
  state.category = "strum";
  inspector.hidden = false;
  tool.setAttribute("aria-expanded", "true");
  render();
}));

document.querySelectorAll("[data-category]").forEach((button) => button.addEventListener("click", () => {
  state.category = button.dataset.category;
  render();
}));
document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => {
  state.view = button.dataset.view;
  render();
}));

tool.addEventListener("click", () => {
  inspector.hidden = !inspector.hidden;
  tool.setAttribute("aria-expanded", String(!inspector.hidden));
  render();
});

apply.addEventListener("click", () => {
  const indices = affectedBars();
  if (availability(indices)) return;
  pending = { indices, template: state.selected };
  const replacesPassing = indices.some((index) => bars[index].passing && state.saved[index] === null);
  const extra = replacesPassing ? "第 2 小节的 1 个经过音会被移除。" : "";
  get("confirm-detail").textContent = `${rangeText()}将使用各自的首拍音组套用「${templates[state.selected].name}」。${extra}应用后可一次撤销。`;
  dialog.returnValue = "";
  dialog.showModal();
});

dialog.addEventListener("close", () => {
  const action = pending;
  pending = null;
  if (dialog.returnValue !== "apply" || !action) return;
  state.history.push([...state.saved]);
  action.indices.forEach((index) => { state.saved[index] = action.template; });
  state.view = "original";
  get("status").textContent = `已为${rangeText()}应用「${templates[action.template].name}」，可撤销。`;
  render();
  undo.focus();
});

undo.addEventListener("click", () => {
  const previous = state.history.pop();
  if (!previous) return;
  state.saved = previous;
  state.view = "original";
  get("status").textContent = "已撤销上一次应用";
  render();
  if (undo.disabled) tool.focus();
});

render();
