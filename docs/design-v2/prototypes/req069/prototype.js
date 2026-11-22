const $ = (selector) => document.querySelector(selector);
const score = $("#score");
const menu = $("#menu");
const menuItems = [...menu.querySelectorAll("[data-action]")];
const tool = $("#tool");
const toolBody = $("#tool-body");
const toolTriggers = [...document.querySelectorAll("[data-tool-trigger]")];
const assets = "../../../../apps/website/public/assets/svg/music-controls/";

const note = (frets, duration = 1) => ({ frets, duration, rest: false });
const rest = (duration = 1) => ({ frets: {}, duration, rest: true });
const example = [
  [note({ 6: 3 }), note({ 4: 2, 3: 0 }), note({ 5: 2 }), note({ 2: 1, 1: 0 })],
  [note({ 5: 0, 3: 2 }), note({ 4: 2, 2: 1 }), rest(), rest()],
  [rest(), rest(), note({ 4: 0 }), note({ 2: 1, 1: 1 })],
  [note({ 6: 3 }), note({ 3: 0, 2: 0 }), note({ 4: 0, 2: 3 }), note({ 5: 3, 1: 0 })],
  [note({ 6: 1 }), note({ 4: 3, 3: 2 }), note({ 3: 0 }), note({ 2: 1, 1: 0 })],
  [note({ 5: 3, 4: 2 }), note({ 2: 1 }), note({ 1: 0 }), note({})],
];
const chords = ["C", "Am", "F", "G", "F", "C"];
const melody = ["1 3 2 1", "6 1 – –", "– – 4 6", "5 7 2 1", "4 6 5 1", "1 3 1 –"];
const barlines = [
  ["single", "单线"], ["double", "双线"], ["final", "终止线"], ["repeatStart", "开始反复"],
  ["repeatEnd", "结束反复"], ["repeatBoth", "双向反复"], ["startRepeat", "谱首反复"],
];
const patterns = [
  ["四分音符", [1]], ["两个八分", [.5, .5]], ["前八后十六", [.5, .25, .25]],
  ["前十六后八", [.25, .25, .5]], ["四个十六分", [.25, .25, .25, .25]], ["附点八分＋十六", [.75, .25]],
  ["小切分", [.25, .5, .25]], ["十六＋附点八分", [.25, .75]], ["附点八分＋两三十二", [.75, .125, .125]],
  ["两三十二＋附点八分", [.125, .125, .75]], ["八分＋四三十二", [.5, .125, .125, .125, .125]],
  ["四三十二＋八分", [.125, .125, .125, .125, .5]],
];
const measurePatterns = [
  ["交替分解", [2, 4, 2, 4]], ["前后十六交替", [2, 3, 2, 3]], ["四分与分解", [0, 2, 0, 2]],
  ["均匀八分", [1, 1, 1, 1]], ["均匀十六分", [4, 4, 4, 4]], ["八十六交替", [1, 4, 1, 4]],
  ["四八交替", [0, 1, 0, 1]], ["附点推进", [5, 1, 5, 1]], ["正反附点", [5, 7, 5, 7]],
  ["切分交替", [1, 6, 1, 6]], ["先疏后密", [0, 1, 2, 4]], ["后半段加密", [1, 1, 4, 4]],
  ["四拍收束", [1, 2, 4, 0]], ["均匀四分", [0, 0, 0, 0]],
];
const techniqueGroups = [
  ["音符连接", [["击弦 H", "H"], ["勾弦 P", "P"], ["上滑音", "╱"], ["下滑音", "╲"], ["延音线", "⌒"]]],
  ["音高与修饰", [["推弦", "↱"], ["颤音", "∿"], ["自然泛音", "◇"], ["人工泛音", "A"], ["点弦 T", "T"], ["颤音奏 tr", "tr"]]],
  ["演奏方向与范围", [["扫弦", "↟"], ["琶音", "⇡"], ["拨片方向", "∨"], ["手掌闷音 P.M.", "P.M."], ["Let Ring", "┄"]]],
];
const chordChoices = { C: "x32010", G: "320003", Am: "x02210", F: "133211", Dm: "xx0231", Em: "022000", G7: "320001", D: "xx0232" };
for (const [measure, chord] of chords.entries()) Object.assign(example[measure][0], { chord, diagram: chordChoices[chord] });
const rhythms = new Map([
  [4, ["whole", 0]], [3.5, ["half", 2]], [3, ["half", 1]], [2, ["half", 0]],
  [1.75, ["quarter", 2]], [1.5, ["quarter", 1]], [1, ["quarter", 0]],
  [.875, ["eighth", 2]], [.75, ["eighth", 1]], [.5, ["eighth", 0]],
  [.4375, ["sixteenth", 2]], [.375, ["sixteenth", 1]], [.25, ["sixteenth", 0]],
  [.21875, ["thirty-second", 2]], [.1875, ["thirty-second", 1]], [.125, ["thirty-second", 0]],
]);
let measures = structuredClone(example);
let measureDetails = melody.map((numbered) => ({ numbered, barline: "single", startRepeat: false }));
let selection = null;
let past = [];
let drag = null;
let menuOrigin = null;
let activeTool = null;

const same = (left, right) => left?.measure === right?.measure && left?.index === right?.index;
const findBeat = ({ measure, index }) => score.querySelector(`[data-beat="${measure}-${index}"]`);
const toolTrigger = (kind) => toolTriggers.find((button) => button.dataset.toolTrigger === kind);
const loc = ({ measure, index }) => `第 ${measure + 1} 小节第 ${index + 1} 拍`;
const order = () => measures.flatMap((beats, measure) => beats.map((_, index) => ({ measure, index })));
const escapeText = (value) => value.replace(/[&<>]/g, (token) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[token]);

function selectedBeats() {
  if (!selection) return [];
  const positions = order();
  const first = positions.findIndex((position) => same(position, selection.anchor));
  const last = positions.findIndex((position) => same(position, selection.focus));
  return positions.slice(Math.min(first, last), Math.max(first, last) + 1);
}

function describe(range) {
  if (!range.length) return "未选中拍点";
  const first = range[0];
  const last = range.at(-1);
  if (range.length === 1) return loc(first);
  if (first.measure === last.measure) return `第 ${first.measure + 1} 小节第 ${first.index + 1}–${last.index + 1} 拍`;
  return `${loc(first)}至${loc(last)}`;
}

function beatMarkup(beat) {
  if (beat.rest) return '<span class="rest" aria-hidden="true"></span>';
  return Object.entries(beat.frets).map(([string, fret]) =>
    `<span class="fret" style="grid-row:${string}" aria-hidden="true">${fret}</span>`,
  ).join("");
}

function renderMeasure(measure) {
  const columns = measures[measure].map((beat, index) => {
    const position = { measure, index };
    const description = beat.rest ? "，休止拍" : Object.keys(beat.frets).length ? "" : "，空拍";
    const [rhythm, dots] = rhythms.get(beat.duration);
    return `<div class="score-column" style="flex:${beat.duration} 1 0">
      <span class="score-chord">${escapeText(beat.chord ?? "")}${beat.technique ? `<span class="technique-mark" aria-label="${beat.technique.label}">${beat.technique.symbol}</span>` : ""}</span>
      <button type="button" class="beat" tabindex="-1" aria-pressed="false" aria-label="${loc(position)}${description}" data-beat="${measure}-${index}">${beatMarkup(beat)}</button>
      <span class="rhythm" aria-hidden="true"><img src="${assets}note-${rhythm}.svg" alt="">${"·".repeat(dots)}</span>
    </div>`;
  });
  const detail = measureDetails[measure];
  const numbered = detail.numbered.split(" ").map((value) => `<span>${value}</span>`).join("");
  const dots = detail.barline.startsWith("repeat") ? '<span class="barline-dots" aria-hidden="true"></span>' : "";
  const start = measure === 0 && detail.startRepeat ? '<span class="barline-dots start" aria-hidden="true"></span>' : "";
  return `<div class="measure" data-number="${measure + 1}" data-barline="${detail.barline}" data-start-repeat="${measure === 0 && detail.startRepeat}">${columns.join("")}${dots}${start}<div class="numbered">${numbered}</div></div>`;
}

function renderScore() {
  score.innerHTML = Array.from({ length: Math.ceil(measures.length / 3) }, (_, row) => row * 3).map((start) => `<div class="system">
    <div class="tab-label" aria-hidden="true">T<br>A<br>B</div>
    ${measures.slice(start, start + 3).map((_, index) => renderMeasure(start + index)).join("")}
  </div>`).join("");
  renderSelection();
}

function renderSelection() {
  const range = selectedBeats();
  const focus = selection?.focus ?? { measure: 0, index: 0 };
  score.querySelectorAll(".beat").forEach((button) => {
    button.tabIndex = -1;
    button.setAttribute("aria-pressed", "false");
    button.classList.remove("range-start", "range-end");
  });
  findBeat(focus).tabIndex = 0;
  for (const [index, beat] of range.entries()) {
    const button = findBeat(beat);
    button.setAttribute("aria-pressed", "true");
    if (index === 0 || beat.measure !== range[index - 1].measure) button.classList.add("range-start");
    if (index === range.length - 1 || beat.measure !== range[index + 1].measure) button.classList.add("range-end");
  }
  $("#selection-location").textContent = describe(range);
  $("#selection-detail").textContent = range.length ? `六线谱 · ${range.length} 个拍点` : "点击谱面选择拍点";
  const chordTrigger = toolTrigger("chord");
  const chordLabel = range.length === 1 && measures[focus.measure][focus.index].chord ? "编辑和弦" : "添加和弦";
  chordTrigger.setAttribute("aria-label", chordLabel);
  chordTrigger.setAttribute("aria-disabled", String(range.length !== 1));
  chordTrigger.title = range.length === 1 ? chordLabel : "请选择一个六线谱拍点，再添加和弦。";
  $("#chord-add-icon").style.display = chordLabel === "编辑和弦" ? "none" : "";
  $("#undo").disabled = !past.length;
}

function select(position, extend = false, focus = true) {
  selection = { anchor: extend && selection ? selection.anchor : position, focus: position };
  renderSelection();
  if (focus) findBeat(position).focus({ preventScroll: true });
}

function positionOf(button) {
  const [measure, index] = button.dataset.beat.split("-").map(Number);
  return { measure, index };
}

function showHint(item) {
  const measure = `第 ${menuOrigin.measure + 1} 小节`;
  const hints = {
    measure: `打开${measure}的小节工具。`,
    rhythm: "对当前六线谱选区选择节奏型。",
    technique: "查看当前选区可用的演奏技巧。",
    chord: `在${loc(menuOrigin)}打开和弦面板。`,
    "copy-measure": `复制${measure}，副本紧跟其后。`,
  };
  $("#menu-hint").textContent = item ? item.dataset.reason || hints[item.dataset.action] : hints.measure;
}

function showMenu(position, point, focusMenu = true) {
  closeTool();
  if (!selectedBeats().some((beat) => same(beat, position))) select(position, false, false);
  const range = selectedBeats();
  menuOrigin = selection.focus;
  $("#menu-range").textContent = describe(range);
  $("#chord-label").textContent = range.length === 1 && measures[menuOrigin.measure][menuOrigin.index].chord ? "编辑和弦" : "添加和弦";
  const chord = menu.querySelector('[data-action="chord"]');
  chord.dataset.reason = range.length === 1 ? "" : "请选择一个六线谱拍点，再添加和弦。";
  chord.setAttribute("aria-disabled", String(!!chord.dataset.reason));
  menu.hidden = false;
  showHint(null);
  const beatBounds = findBeat(position).getBoundingClientRect();
  placeOverlay(menu, point ?? { x: beatBounds.right + 5, y: beatBounds.top + 26 });
  if (focusMenu) menuItems[0].focus({ preventScroll: true });
}

function placeOverlay(overlay, point) {
  const { width, height } = overlay.getBoundingClientRect();
  overlay.style.left = `${Math.max(8, Math.min(point.x, window.innerWidth - width - 8))}px`;
  overlay.style.top = `${Math.max(8, Math.min(point.y, window.innerHeight - height - 8))}px`;
}

function closeMenu(restore = false) {
  if (menu.hidden) return;
  if (activeTool && menu.contains(activeTool.trigger)) closeTool();
  menu.hidden = true;
  if (restore && menuOrigin) findBeat(menuOrigin)?.focus({ preventScroll: true });
}

function commitScore(nextMeasures, nextDetails, nextFocus, message) {
  if (tool.hidden) closeMenu();
  past.push({ measures, measureDetails, selection });
  measures = nextMeasures;
  measureDetails = nextDetails;
  if (nextFocus) selection = { anchor: nextFocus, focus: nextFocus };
  renderScore();
  if (tool.hidden && selection) findBeat(selection.focus).focus({ preventScroll: true });
  $("#status").textContent = "";
  $("#toast-message").textContent = message;
  $("#toast").hidden = false;
}

function copyCurrentMeasure(measure) {
  const index = measure + 1;
  const detail = { ...measureDetails[measure], startRepeat: false };
  commitScore(measures.toSpliced(index, 0, structuredClone(measures[measure])),
    measureDetails.toSpliced(index, 0, detail), { measure: index, index: 0 },
    `已复制第 ${measure + 1} 小节，副本位于第 ${index + 1} 小节。`);
  revealSelectedBeat();
}

function revealSelectedBeat() {
  findBeat(selection.focus).scrollIntoView({ block: "nearest", inline: "nearest" });
}

function toolChoice(value, label, symbol, pressed, reason = "") {
  return `<button type="button" data-choice="${value}" aria-pressed="${pressed}" ${reason ? `aria-disabled="true" aria-description="${reason}" title="${reason}"` : ""}><strong aria-hidden="true">${symbol}</strong><span>${label}</span></button>`;
}

function openTool(kind, trigger) {
  const range = selectedBeats();
  if (!range.length || kind === "chord" && range.length !== 1) return;
  const target = selection.focus;
  closeTool();
  if (!menu.contains(trigger)) closeMenu();
  else showHint(trigger);
  activeTool = { kind, target, range, trigger, choice: null, remove: false, expanded: new Set() };
  const currentChord = measures[target.measure][target.index].chord;
  tool.dataset.kind = kind;
  trigger.setAttribute("aria-expanded", "true");
  $("#tool-title").textContent = { measure: "小节工具", rhythm: "节奏型", technique: "所有技巧", chord: currentChord ? "编辑和弦" : "添加和弦" }[kind];
  $("#tool-context").textContent = kind === "measure" ? `第 ${target.measure + 1} 小节`
    : kind === "chord" ? `TAB · ${loc(target)}` : "";
  $("#tool-context").hidden = !["measure", "chord"].includes(kind);
  $("#close-tool").setAttribute("aria-label", `关闭${$("#tool-title").textContent}`);
  renderTool();
  tool.hidden = false;
  alignTool();
  const firstControl = kind === "chord" ? $("#chord-name") : kind === "rhythm" ? $("#rhythm-beat button") : $("#close-tool");
  firstControl.focus({ preventScroll: true });
}

function alignTool() {
  const { kind, target, trigger } = activeTool;
  const anchor = trigger.getBoundingClientRect();
  if (menu.contains(trigger)) {
    const bounds = menu.getBoundingClientRect();
    const width = tool.offsetWidth;
    let x = bounds.right + 6;
    let y = anchor.top;
    if (x + width > window.innerWidth - 8) {
      if (bounds.left - 6 - width >= 8) x = bounds.left - 6 - width;
      else {
        x = bounds.left;
        const below = window.innerHeight - bounds.bottom - 14;
        const above = bounds.top - 14;
        const space = Math.max(below, above);
        if (space >= 180) {
          tool.style.maxHeight = `${space}px`;
          y = below >= above ? bounds.bottom + 6 : bounds.top - 6 - tool.offsetHeight;
        }
      }
    }
    placeOverlay(tool, { x, y });
    return;
  }
  if (kind === "chord") {
    const bounds = findBeat(target).getBoundingClientRect();
    const fitsBelow = bounds.bottom + 6 + tool.offsetHeight <= window.innerHeight - 8;
    placeOverlay(tool, { x: bounds.left + (bounds.width - tool.offsetWidth) / 2, y: fitsBelow ? bounds.bottom + 6 : bounds.top - tool.offsetHeight - 6 });
    return;
  }
  tool.style.maxHeight = `${Math.min(660, Math.max(80, window.innerHeight - anchor.bottom - 14))}px`;
  placeOverlay(tool, { x: anchor.left, y: anchor.bottom + 6 });
}

function closeTool(restore = false) {
  if (tool.hidden) return;
  const { trigger } = activeTool;
  trigger.setAttribute("aria-expanded", "false");
  tool.hidden = true;
  tool.style.maxHeight = "";
  activeTool = null;
  if (restore) trigger.focus({ preventScroll: true });
}

new ResizeObserver(() => { if (activeTool) alignTool(); }).observe(tool);

function barlineIcon(value) {
  const before = value === "repeatEnd" || value === "repeatBoth";
  const after = value === "repeatStart" || value === "repeatBoth" || value === "startRepeat";
  const left = `<path d="M12 2V22" stroke="currentColor" stroke-width="${after ? 3 : 1}"/>`;
  const right = value === "single" ? "" : `<path d="M18 2V22" stroke="currentColor" stroke-width="${before || value === "final" ? 3 : 1}"/>`;
  const dots = (x) => `<circle cx="${x}" cy="9" r="1.5"/><circle cx="${x}" cy="15" r="1.5"/>`;
  return `<svg width="30" height="24" viewBox="0 0 30 24" fill="currentColor" aria-hidden="true">${left}${right}${before ? dots(7) : ""}${after ? dots(24) : ""}</svg>`;
}

function rhythmSymbol(durations) {
  const x = (index) => durations.length === 1 ? 53 : 12 + index * 80 / (durations.length - 1);
  const flags = durations.map((duration) => duration < .25 ? 3 : duration < .5 ? 2 : duration < 1 ? 1 : 0);
  return `<svg viewBox="0 0 108 27" aria-hidden="true">${durations.map((duration, index) => {
    const notes = `<ellipse cx="${x(index) - 2}" cy="22" rx="3.8" ry="2.5"/><path d="M${x(index) + 1} 22V4" stroke="currentColor"/>`;
    const beams = [1, 2, 3].map((level) => {
      if (flags[index] < level || flags[index + 1] < level && flags[index - 1] >= level) return "";
      const end = flags[index + 1] >= level ? x(index + 1) + 1 : x(index) + (index === durations.length - 1 ? -7 : 9);
      return `<path d="M${x(index) + 1} ${4 + (level - 1) * 4}H${end}" stroke="currentColor" stroke-width="2"/>`;
    }).join("");
    return notes + beams + (duration === .75 ? `<circle cx="${x(index) + 7}" cy="21" r="1.2"/>` : "");
  }).join("")}</svg>`;
}

function chordDiagram(frets) {
  if (!frets) return '<span class="diagram-empty">暂无指法</span>';
  const x = (index) => 9 + index * 7;
  const strings = Array.from(frets, (fret, index) => {
    const marker = fret === "x" || fret === "0" ? `<text x="${x(index)}" y="8">${fret === "0" ? "○" : "×"}</text>` : `<circle cx="${x(index)}" cy="${7 + Number(fret) * 7}" r="2.5"/>`;
    return `<path d="M${x(index)} 10V38" stroke="currentColor" stroke-width=".6"/>${marker}`;
  }).join("");
  return `<svg viewBox="0 0 53 41" width="43" height="34" aria-hidden="true">${strings}<path d="M9 10H44M9 17H44M9 24H44M9 31H44M9 38H44" fill="none" stroke="currentColor" stroke-width=".7"/></svg>`;
}

const techniqueParameters = {
  推弦: ["推弦幅度", ["半音", "全音"]], 扫弦: ["演奏方向", ["向下", "向上"]], 琶音: ["演奏方向", ["上行", "下行"]],
  拨片方向: ["演奏方向", ["向下", "向上"]], "颤音奏 tr": ["辅助品位"],
};

function renderTool() {
  const { kind, target, range, choice, remove } = activeTool;
  const { measure, index } = target;
  const current = measures[measure][index];
  const detail = measureDetails[measure];
  const deleteTechnique = tool.querySelector(".technique-delete");
  deleteTechnique.hidden = kind !== "technique";
  deleteTechnique.disabled = !current.technique;
  if (kind === "measure") {
    const options = barlines.map(([value, label]) => {
      const reason = value === "startRepeat" && measure !== 0 ? "谱首反复仅用于第一个小节。"
        : ["repeatStart", "repeatBoth"].includes(value) && measure === measures.length - 1 ? "谱尾不能开始反复。" : "";
      const pressed = value === "startRepeat" ? detail.startRepeat : detail.barline === value;
      return `<div class="boundary-choice"><button type="button" data-choice="${value}" aria-label="${label}" aria-pressed="${pressed}" ${reason ? `aria-disabled="true" title="${reason}"` : ""}>${barlineIcon(value)}</button><span aria-hidden="true">${label}</span></div>`;
    });
    const disabled = remove ? "disabled" : "";
    toolBody.innerHTML = `<div class="boundary-choices" role="group" aria-label="小节线与反复">${options.join("")}</div>
      <div class="measure-actions" role="group" aria-label="当前小节操作"><button type="button" data-tool-action="insert-measure" ${disabled}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 5v14M20 5v14M4 9h16M4 15h16M12 2v6M9 5h6"/></svg>新增小节</button><button type="button" data-tool-action="copy-measure" ${disabled}><span class="action-icon copy-icon" aria-hidden="true"></span>复制小节</button><button class="danger" type="button" data-tool-action="remove-measure" ${measures.length === 1 || remove ? "disabled" : ""}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 9v9m4-9v9"/></svg>删除小节</button></div>
      ${remove ? `<div class="confirm-box">将删除第 ${measure + 1} 小节及其中的 ${measures[measure].length} 个拍点、简谱和和弦。此操作可一次撤销。<div class="dialog-actions"><button type="button" data-tool-action="cancel-remove">取消</button><button type="button" class="danger" data-tool-action="confirm-remove">确认删除第 ${measure + 1} 小节</button></div></div>` : ""}`;
  } else if (kind === "rhythm") {
    const templateCards = (type, templates, name, meta) => {
      const expanded = activeTool.expanded.has(type);
      const cards = templates.map(([label, values], key) => {
        const whole = type === "measure";
        const id = `${type}-${key}`;
        const notation = whole ? values.map((pattern) => rhythmSymbol(patterns[pattern][1])).join("") : rhythmSymbol(values);
        return `<button type="button" data-choice="${id}" class="rhythm-card" aria-pressed="${choice === id}" ${key >= 6 && !expanded ? "hidden" : ""}><span>${label}</span><div class="rhythm-notation">${notation}</div></button>`;
      });
      return `<div class="rhythm-section"><strong>${name}</strong><span>${meta}</span></div><div id="rhythm-${type}" class="rhythm-cards" data-template-scope="${type}" role="group" aria-label="${name}">${cards.join("")}</div><button type="button" class="rhythm-toggle" data-tool-action="toggle-${type}" aria-expanded="${expanded}" aria-controls="rhythm-${type}">${expanded ? "收起" : "展开"}${name} ${expanded ? "▴" : "▾"}</button>`;
    };
    const [type, key] = choice?.split("-") ?? [];
    const whole = type === "measure";
    const targetRange = whole ? measures[measure].map((_, index) => ({ measure, index })) : range;
    const supported = targetRange.every((position) => measures[position.measure][position.index].duration === 1);
    const template = (whole ? measurePatterns : patterns)[key];
    const scrollTop = toolBody.querySelector(".rhythm-templates")?.scrollTop ?? 0;
    toolBody.innerHTML = `<p class="rhythm-rule">⚠ 应用后保留仍适用的技巧和连线，失效的标记会列在下方。</p>
      <div class="rhythm-templates" tabindex="0" role="region" aria-label="节奏型模板">${templateCards("beat", patterns, "拍内模板", "4/4")}${templateCards("measure", measurePatterns, "整小节模板", `${measurePatterns.length} 条`)}</div>
      <div class="rhythm-footer">${!supported ? '<p class="rhythm-rule">请选择未细分的四分拍应用此示例。</p>' : ""}<div class="rhythm-footer-line"><span>${whole ? `第 ${measure + 1} 小节` : describe(range)}${template ? ` · ${template[0]}` : ""}</span><div class="dialog-actions"><button type="button" data-tool-action="close">取消</button><button type="button" class="primary" data-tool-action="apply" ${!template || !supported ? "disabled" : ""}>应用节奏型</button></div></div></div>`;
    toolBody.querySelector(".rhythm-templates").scrollTop = scrollTop;
  } else if (kind === "technique") {
    const hasNotes = Object.keys(current.frets).length > 0;
    const canConnect = Object.keys(current.frets).some((string) => Object.hasOwn(measures[measure][index + 1]?.frets ?? {}, string));
    const parameters = techniqueParameters[choice];
    const connection = techniqueGroups[0][1].some(([name]) => name === choice);
    toolBody.innerHTML = techniqueGroups.map(([group, items]) => `<h3 class="tool-body-title">${group}</h3><div class="tool-options">${items.map(([label, symbol]) => {
      const reason = !hasNotes ? "请选择已有音符。" : group === "音符连接" && !canConnect ? "需要同弦的下一音。" : "";
      return toolChoice(label, label, symbol, choice === label, reason);
    }).join("")}</div>`).join("") + (parameters || connection ? `<div class="technique-parameters"><strong>${current.technique?.label === choice ? "正在编辑" : "新增"}：${choice}</strong><p>${loc(target)}${connection ? ` → ${loc({ measure, index: index + 1 })}` : ""}</p>${parameters ? parameters[1] ? `<div class="technique-parameter-options" aria-label="${parameters[0]}">${parameters[1].map((value) => `<button type="button" data-tool-action="apply" data-parameter="${value}">${value}</button>`).join("")}</div>` : '<label>辅助品位 <input type="number" id="technique-fret" min="0" max="24" value="3" required></label><button type="button" data-tool-action="apply-fret">应用</button>' : '<button type="button" data-tool-action="apply">应用到此目标</button>'}</div>` : "");
  } else {
    activeTool.diagram = current.diagram;
    toolBody.innerHTML = `<label class="chord-field" for="chord-name">和弦名称</label><div class="chord-name-row"><input id="chord-name" type="text" placeholder="例如 C、Am、G7" maxlength="32" autocomplete="off" aria-describedby="chord-error"><button type="button" class="primary" data-tool-action="apply" disabled>应用</button></div>
      <p class="chord-name-error" id="chord-error" hidden>和弦名称须为单行文字，最多 32 个字符，不能为空。</p>
      <div class="chord-preset-heading"><strong>常用和弦</strong><span>1=C</span></div>
      <div class="chord-choices" aria-label="常用和弦">${Object.entries(chordChoices).map(([name, frets]) => `<button type="button" data-choice="${name}"><span>${name}</span>${chordDiagram(frets)}</button>`).join("")}</div>
      <div class="chord-summary"><div id="chord-diagram"></div><div><strong id="chord-summary-name"></strong><p id="chord-summary-detail"></p></div></div>`;
    $("#chord-name").value = current.chord ?? "";
    updateChordChoice();
  }
}

function updateChordChoice() {
  const { target, diagram } = activeTool;
  const value = $("#chord-name").value.trim();
  const current = measures[target.measure][target.index];
  const invalid = !value && !current.chord;
  toolBody.querySelector('[data-tool-action="apply"]').disabled = invalid || value === (current.chord ?? "") && diagram === current.diagram;
  $("#chord-error").hidden = !invalid;
  $("#chord-name").setAttribute("aria-invalid", String(invalid));
  toolBody.querySelectorAll("[data-choice]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.choice === value)));
  $("#chord-diagram").innerHTML = chordDiagram(diagram);
  $("#chord-summary-name").textContent = `当前指法 · ${value || "未命名"}`;
  $("#chord-summary-detail").textContent = diagram ? (diagram === chordChoices.F ? "横按指法" : "开放指法") : "暂无指法";
}

function subdivideBeat(beat, durations) {
  return durations.map((duration, part) => part === 0 ? { ...beat, duration } : { ...note({}, duration), rest: beat.rest });
}

function applyRhythm(range, durationsFor) {
  return measures.map((beats, measure) => {
    const indexes = new Set(range.filter((position) => position.measure === measure).map((position) => position.index));
    return beats.flatMap((beat, index) => indexes.has(index) ? subdivideBeat(beat, durationsFor(index)) : [beat]);
  });
}

function runToolAction(action, parameter) {
  const { kind, target, range, choice } = activeTool;
  const { measure, index } = target;
  const current = measures[measure][index];
  if (action === "apply-fret") {
    const input = $("#technique-fret");
    if (input.reportValidity()) runToolAction("apply", input.value);
  } else if (action === "close") {
    closeTool(true);
  } else if (action.startsWith("toggle-")) {
    const type = action.slice(7);
    const { expanded } = activeTool;
    if (expanded.has(type)) expanded.delete(type);
    else expanded.add(type);
    renderTool();
    toolBody.querySelector(`[data-tool-action="${action}"]`).focus({ preventScroll: true });
  } else if (action === "copy-measure") {
    closeTool();
    copyCurrentMeasure(measure);
  } else if (action === "insert-measure") {
    closeTool();
    const blank = Array.from({ length: 4 }, () => rest());
    const details = { numbered: "– – – –", barline: "single", startRepeat: false };
    commitScore(measures.toSpliced(measure + 1, 0, blank), measureDetails.toSpliced(measure + 1, 0, details),
      { measure: measure + 1, index: 0 }, "已新增小节。");
    revealSelectedBeat();
  } else if (action === "remove-measure" || action === "cancel-remove") {
    activeTool.remove = action === "remove-measure";
    renderTool();
    toolBody.querySelector(`[data-tool-action="${activeTool.remove ? "cancel-remove" : "remove-measure"}"]`).focus();
  } else if (action === "confirm-remove") {
    closeTool();
    const nextFocus = { measure: Math.min(measure, measures.length - 2), index: 0 };
    commitScore(measures.toSpliced(measure, 1), measureDetails.toSpliced(measure, 1), nextFocus, "已删除小节。");
  } else if (action === "delete-technique") {
    const beat = { ...current, technique: undefined };
    commitScore(measures.toSpliced(measure, 1, measures[measure].toSpliced(index, 1, beat)), measureDetails, null, "已删除技巧。");
    activeTool.choice = null;
    renderTool();
    tool.focus({ preventScroll: true });
  } else if (action === "apply") {
    if (kind === "rhythm") {
      const [type, key] = choice.split("-");
      const whole = type === "measure";
      const scope = whole ? measures[measure].map((_, index) => ({ measure, index })) : range;
      const next = applyRhythm(scope, (index) => whole ? patterns[measurePatterns[key][1][index]][1] : patterns[key][1]);
      closeTool();
      commitScore(next, measureDetails, scope[0], "已应用节奏型。");
    } else if (kind === "technique") {
      const [label, symbol] = techniqueGroups.flatMap(([, items]) => items).find(([label]) => label === choice);
      const technique = { label, symbol, parameter };
      commitScore(measures.toSpliced(measure, 1, measures[measure].toSpliced(index, 1, { ...current, technique })), measureDetails, null, `已添加${label}。`);
      if (parameter) activeTool.choice = null;
      renderTool();
      toolBody.querySelector(`[data-choice="${choice}"]`).focus({ preventScroll: true });
    } else if (kind === "chord") {
      const chord = $("#chord-name").value.trim() || undefined;
      const diagram = chord ? activeTool.diagram : undefined;
      closeTool();
      commitScore(measures.toSpliced(measure, 1, measures[measure].toSpliced(index, 1, { ...current, chord, diagram })), measureDetails, null, chord ? `已应用和弦 ${chord}。` : "已删除和弦。");
    }
  }
}

tool.addEventListener("click", (event) => {
  if (event.target.closest("#close-tool")) return closeTool(true);
  const button = event.target.closest("button");
  if (!button || button.disabled || button.getAttribute("aria-disabled") === "true") return;
  const { kind, target } = activeTool;
  const { choice, toolAction } = button.dataset;
  if (toolAction) return runToolAction(toolAction, button.dataset.parameter);
  if (choice === undefined) return;
  if (kind === "measure") {
    const current = measureDetails[target.measure];
    if (choice !== "startRepeat" && choice === current.barline) return;
    const detail = choice === "startRepeat" ? { ...current, startRepeat: !current.startRepeat } : { ...current, barline: choice };
    commitScore(measures, measureDetails.toSpliced(target.measure, 1, detail), null, "已更新小节线。");
  } else if (kind === "chord") {
    $("#chord-name").value = choice;
    activeTool.diagram = chordChoices[choice];
    updateChordChoice();
    return;
  } else {
    activeTool.choice = choice;
    if (kind === "technique" && !techniqueParameters[choice] && !techniqueGroups[0][1].some(([name]) => name === choice)) return runToolAction("apply");
  }
  renderTool();
  alignTool();
  toolBody.querySelector(`[data-choice="${choice}"]`).focus({ preventScroll: true });
});

tool.addEventListener("input", (event) => {
  if (event.target.id === "chord-name") updateChordChoice();
});
tool.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.isComposing || event.repeat) return;
  if (event.target.id === "technique-fret") runToolAction("apply-fret");
  if (event.target.id === "chord-name" || activeTool.kind === "rhythm" && event.target.matches("[data-choice][aria-pressed=true]")) {
    event.preventDefault();
    toolBody.querySelector('[data-tool-action="apply"]').click();
  }
});

function loadScene(scene) {
  const positions = {
    single: [{ measure: 1, index: 1 }],
    multiple: [{ measure: 2, index: 0 }, { measure: 2, index: 1 }],
    across: [{ measure: 1, index: 2 }, { measure: 2, index: 1 }],
  };
  const [anchor, focus = anchor] = positions[scene];
  measures = structuredClone(example);
  measureDetails = melody.map((numbered) => ({ numbered, barline: "single", startRepeat: false }));
  selection = { anchor, focus };
  past = [];
  $("#toast").hidden = true;
  $("#status").textContent = "";
  renderScore();
  for (const button of document.querySelectorAll("[data-scene]")) button.setAttribute("aria-pressed", String(button.dataset.scene === scene));
  showMenu(focus, null, false);
}

score.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || !event.isPrimary) return;
  const button = event.target.closest(".beat");
  if (!button) return;
  event.preventDefault();
  select(positionOf(button), event.shiftKey);
  drag = event.pointerId;
});

score.addEventListener("click", (event) => {
  const button = event.target.closest(".beat");
  if (button && event.detail === 0) select(positionOf(button), event.shiftKey);
});

document.addEventListener("pointermove", (event) => {
  if (drag !== event.pointerId) return;
  const button = document.elementFromPoint(event.clientX, event.clientY)?.closest(".beat");
  if (button && !same(positionOf(button), selection.focus)) select(positionOf(button), true);
});

for (const type of ["pointerup", "pointercancel"]) document.addEventListener(type, (event) => {
  if (event.pointerId === drag) drag = null;
});

score.addEventListener("contextmenu", (event) => {
  const button = event.target.closest(".beat");
  if (!button) return;
  event.preventDefault();
  showMenu(positionOf(button), { x: event.clientX + 8, y: event.clientY + 8 });
});

score.addEventListener("keydown", (event) => {
  const button = event.target.closest(".beat");
  if (!button) return;
  const position = positionOf(button);
  if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
    event.preventDefault();
    showMenu(position);
  } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    const positions = order();
    const index = positions.findIndex((beat) => same(beat, position));
    const next = positions[index + (event.key === "ArrowLeft" ? -1 : 1)];
    if (next) select(next, event.shiftKey);
  }
});

menu.addEventListener("click", (event) => {
  const item = event.target.closest("[data-action]");
  if (!item || item.getAttribute("aria-disabled") === "true") return;
  if (item.dataset.action === "copy-measure") {
    closeMenu(true);
    copyCurrentMeasure(selection.focus.measure);
  } else {
    openTool(item.dataset.action, item);
  }
});

for (const trigger of toolTriggers) trigger.addEventListener("click", () => {
  const kind = trigger.dataset.toolTrigger;
  if (activeTool?.trigger === trigger && kind === "chord") $("#chord-name").focus({ preventScroll: true });
  else if (activeTool?.trigger === trigger) closeTool(true);
  else openTool(kind, trigger);
});
menu.addEventListener("focusin", (event) => showHint(event.target.closest("[data-action]")));
menu.addEventListener("pointerover", (event) => {
  const item = event.target.closest("[data-action]");
  if (item) showHint(item);
});
menu.addEventListener("pointerleave", () => showHint(menu.querySelector('[aria-expanded="true"]') ?? document.activeElement.closest("[data-action]")));
menu.addEventListener("keydown", (event) => {
  const index = menuItems.indexOf(event.target);
  if (event.key === "ArrowRight" && event.target.hasAttribute("aria-haspopup")) {
    event.preventDefault();
    event.target.click();
    return;
  }
  if (event.key === "Tab") {
    closeMenu(true);
    return;
  }
  const count = menuItems.length;
  const destinations = { ArrowDown: (index + 1) % count, ArrowUp: (index + count - 1) % count, Home: 0, End: count - 1 };
  if (Object.hasOwn(destinations, event.key)) {
    event.preventDefault();
    menuItems[destinations[event.key]].focus();
  }
});

document.addEventListener("pointerdown", (event) => {
  if (tool.contains(event.target)) return;
  if (!menu.contains(event.target)) closeMenu();
  if (!event.target.closest("[data-tool-trigger], [data-action]")) closeTool();
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || event.isComposing) return;
  if (!tool.hidden) {
    event.preventDefault();
    closeTool(true);
  } else if (!menu.hidden) {
    event.preventDefault();
    closeMenu(true);
  }
});
window.addEventListener("resize", () => {
  if (!menu.hidden) placeOverlay(menu, menu.getBoundingClientRect());
  if (activeTool) {
    tool.style.maxHeight = "";
    alignTool();
  }
});
window.addEventListener("scroll", (event) => {
  if (tool.contains(event.target)) return;
  if (!menu.contains(event.target)) closeMenu(menu.contains(document.activeElement) || tool.contains(document.activeElement));
  if (activeTool) alignTool();
}, true);

for (const button of document.querySelectorAll("[data-scene]")) button.addEventListener("click", () => loadScene(button.dataset.scene));
function resetPreview() {
  loadScene("single");
  menu.querySelector('[data-action="technique"]').click();
}
$("#reset").addEventListener("click", resetPreview);
function undo() {
  const previous = past.pop();
  if (!previous) return;
  closeTool();
  closeMenu();
  ({ measures, measureDetails, selection } = previous);
  renderScore();
  findBeat(selection.focus).focus({ preventScroll: true });
  revealSelectedBeat();
  $("#toast").hidden = true;
  $("#status").textContent = "已撤销";
}
$("#undo").addEventListener("click", undo);
$("#toast-undo").addEventListener("click", undo);

resetPreview();
