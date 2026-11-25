"use strict";

const $ = (id) => document.getElementById(id);
const symbols = {
  dc: { label: "D.C.", description: "Da Capo。弹完当前小节后回到第 1 小节第 1 拍。独立指令的结束方式待确认。", directive: true, fields: [] },
  dcFine: { label: "D.C. al Fine", description: "回到曲首重奏，弹完指定 Fine 所在小节后结束。", directive: true, fields: ["fine"] },
  dsFine: { label: "D.S. al Fine", description: "回到指定 Segno 所在小节第 1 拍，弹完指定 Fine 所在小节后结束。", directive: true, fields: ["segno", "fine"] },
  dcCoda: { label: "D.C. al Coda", description: "回到曲首重奏，弹完指定 To Coda 所在小节后，按该记号的设置跳到 Coda。", directive: true, fields: ["toCoda"] },
  fine: { label: "Fine", description: "小节末端。首遍经过照常顺行，重奏弹完本小节后可在此结束。" },
  segno: { label: "Segno", glyph: "\uE047", atStart: true, description: "小节开头。D.S. 回跳到本小节第 1 拍。" },
  toCoda: { label: "To Coda", description: "小节末端。首遍经过照常顺行，重奏跳到在此记号设置的 Coda。", fields: ["coda"] },
  coda: { label: "Coda", glyph: "\uE048", atStart: true, description: "小节开头。跳入后从本小节第 1 拍继续。" },
};
const examples = {
  fine: { name: "D.C. al Fine", marks: [["f3", "fine", 3], ["j6", "dcFine", 6, { fine: "f3" }]] },
  ds: { name: "D.S. al Fine", marks: [["s2", "segno", 2], ["f3", "fine", 3], ["j6", "dsFine", 6, { segno: "s2", fine: "f3" }]] },
  coda: { name: "D.C. al Coda", marks: [["t3", "toCoda", 3, { coda: "c8" }], ["j6", "dcCoda", 6, { toCoda: "t3" }], ["c8", "coda", 8]] },
  codaMissing: { name: "To Coda 缺少落点", marks: [["t3", "toCoda", 3], ["j6", "dcCoda", 6, { toCoda: "t3" }]] },
  dc: { name: "独立 D.C.", marks: [["j6", "dc", 6]] },
  missing: { name: "无匹配 Fine", marks: [["j6", "dcFine", 6]] },
  multiple: { name: "多个 Fine 待配对", marks: [["f3", "fine", 3], ["f5", "fine", 5], ["j6", "dcFine", 6]] },
  empty: { name: "空白记号", marks: [] },
};
const music = [
  ["C",  [4, 3, 2, 1], [3, 2, 0, 1]], ["Am", [4, 3, 2, 1], [0, 2, 2, 1]],
  ["F",  [5, 3, 2, 1], [1, 3, 2, 1]], ["G",  [5, 3, 2, 1], [3, 0, 0, 0]],
  ["Em", [5, 3, 2, 1], [0, 2, 0, 0]], ["Dm", [3, 2, 1, 0], [0, 2, 3, 1]],
  ["G",  [5, 3, 2, 1], [3, 0, 0, 0]], ["C",  [4, 3, 2, 0], [3, 2, 0, 0]],
];
const beatPositions = [18, 39, 60, 81];
const storageKey = "liuxianmao-req107-prototype-v1";
const state = {
  marks: [], policy: "tail", example: "fine", selected: 6, activeMark: "j6", draft: null,
  dirty: false, saved: null, showingSaved: false, nextId: 1, audition: false, start: 1, run: null,
  timer: null, audio: null, voice: null, confirm: null, contextOwner: null,
};

const label = (kind) => symbols[kind].label;
const symbolMarkup = ({ glyph, label }) => glyph ? `<span class="music-glyph" aria-hidden="true">${glyph}</span> ${label}` : label;
const isInstruction = (mark) => !!symbols[mark.kind].directive;
const markLocation = (mark) => `${mark.measure} 小节${symbols[mark.kind].atStart ? "第 1 拍" : "末"}`;
const locateButton = (mark, caption = `第 ${markLocation(mark)}`) => `<button class="plain text-button" type="button" data-action="locate" data-id="${mark.id}">${caption}</button>`;
const getMark = (id) => state.marks.find((mark) => mark.id === id);
const onMeasure = (measure) => state.marks.filter((mark) => mark.measure === measure);
const markOrder = (a, b) => Number(isInstruction(a)) - Number(isInstruction(b)) || a.measure - b.measure;
const option = (value, text, selected = false, disabled = false) =>
  `<option value="${value}"${selected ? " selected" : ""}${disabled ? " disabled" : ""}>${text}</option>`;

// 同一配对函数同时服务属性、草稿和试听。已明确选择的旧目标失效时保留诊断，避免悄悄改跳另一处。
function pairing(mark, marks = state.marks, policy = state.policy, suggest = false) {
  const picked = {};
  const fields = [];
  const issues = [];
  if (mark.kind === "dc" && policy === "explicit") {
    issues.push("当前备选要求显式设置终止方式，请改为 D.C. al Fine 或 D.C. al Coda。");
  }
  for (const kind of symbols[mark.kind].fields || []) {
    const left = mark.kind === "dsFine" ? picked.segno?.measure : 1;
    const blocked = kind === "fine" && !left;
    const candidates = blocked ? [] : marks.filter((item) => {
      if (item.kind !== kind) return false;
      if (kind === "coda") return item.measure > mark.measure;
      return item.measure >= (kind === "segno" ? 1 : left) && item.measure <= mark.measure;
    }).sort(markOrder);
    const id = mark.links[kind];
    const target = id ? candidates.find((item) => item.id === id) : suggest && candidates.length === 1 ? candidates[0] : null;
    const outside = kind === "coda" ? `第 ${mark.measure} 小节之后的小节开头` : kind === "segno" ? `第 ${mark.measure} 小节或之前的小节开头` : `第 ${left} 至 ${mark.measure} 小节末端`;
    let message = "";
    if (blocked) message = "请先配对 Segno。";
    else if (id && !target) message = `原配对的 ${label(kind)} 已失效，请重新选择。`;
    else if (!candidates.length) message = `无匹配 ${label(kind)}，请在${outside}添加。`;
    else if (!target) message = candidates.length === 1
      ? `已找到第 ${markLocation(candidates[0])}的 ${label(kind)}，请编辑并应用配对。`
      : `找到 ${candidates.length} 个 ${label(kind)}，请选择一个。`;
    if (message && !blocked) issues.push(message);
    if (target) picked[kind] = target;
    fields.push({ kind, blocked, candidates, message, target, id });
  }
  // al Coda 指令只持有 To Coda 的引用。Coda 始终由 To Coda 自己的配对提供。
  let chain = null;
  if (mark.kind === "dcCoda" && picked.toCoda) {
    const owner = picked.toCoda;
    const downstream = pairing(owner, marks, policy);
    const target = downstream.picked.coda;
    const error = downstream.issues.length ? `第 ${markLocation(owner)}的 To Coda 落点待处理。${downstream.issues.join(" ")}` : "";
    chain = { owner, target, error };
    if (target) picked.coda = target;
    if (error) issues.push(error);
  }
  return { picked, fields, issues, chain };
}

function setMessage(text = "") { $("message").textContent = text; }

function selectExample(key) {
  exitAudition(false);
  state.example = key;
  state.marks = examples[key].marks.map(([id, kind, measure, links = {}]) => ({ id, kind, measure, links: { ...links } }));
  state.selected = key === "empty" ? 3 : 6;
  state.activeMark = key === "empty" ? null : "j6";
  state.draft = null;
  state.dirty = false;
  state.showingSaved = false;
  $("scenario").value = key;
  setMessage();
  render();
}

function renderScore() {
  const position = state.run?.position;
  const frozen = state.audition && ["playing", "paused"].includes(state.run?.phase);
  $("score").innerHTML = [0, 4].map((offset) => {
    const measures = music.slice(offset, offset + 4).map(([chord, strings, frets], index) => {
      const number = offset + index + 1;
      const selected = !state.audition && state.selected === number;
      const at = onMeasure(number).sort(markOrder);
      const lane = (atStart) => at.filter((mark) => !!symbols[mark.kind].atStart === atStart).map((mark) => {
        const info = symbols[mark.kind];
        const warning = pairing(mark).issues.length > 0;
        return `<button class="score-mark${!state.audition && state.activeMark === mark.id ? " current" : ""}${warning ? " warning" : ""}"
          data-action="score-mark" data-id="${mark.id}" aria-label="${label(mark.kind)}，第 ${markLocation(mark)}${warning ? "，配对待处理" : ""}"${state.audition ? " disabled" : ""}>${symbolMarkup(info)}</button>`;
      }).join("");
      const notes = beatPositions.map((x, beat) => `<span class="note" style="left:${x}%;top:${strings[beat] * 10 + 61}px">${frets[beat]}</span><span class="stem" style="left:${x}%"></span><span class="beat" style="left:${x}%">${beat + 1}</span>`).join("");
      const cursor = position?.measure === number ? `<span class="cursor${position.edge ? " end" : ""}" style="left:${position.edge ? 98 : beatPositions[position.beat - 1]}%"></span>` : "";
      return `<div class="measure${selected ? " selected" : ""}" data-measure="${number}">
        <button class="measure-target${frozen ? " frozen" : state.audition ? " pick-start" : ""}" data-action="measure" data-number="${number}"
          aria-label="${state.audition && !frozen ? "从" : ""}第 ${number} 小节${state.audition && !frozen ? "试听" : ""}"${frozen ? ' aria-disabled="true" tabindex="-1"' : ` aria-pressed="${state.audition ? !state.run && state.start === number : selected}"`}></button>
        <div aria-hidden="true" class="position">${number}</div><div class="chord" aria-hidden="true">${chord}</div>
        <div class="staff" aria-hidden="true"></div><div aria-hidden="true" class="notes">${notes}</div>
        <div class="mark-lane start">${lane(true)}</div><div class="mark-lane">${lane(false)}</div>${cursor}
      </div>`;
    }).join("");
    return `<div class="system"><div class="tab-clef" aria-hidden="true"><span>T</span><span>A</span><span>B</span></div>${measures}</div>`;
  }).join("");
}

function inspectorMark(mark) {
  const { fields, issues, chain } = pairing(mark);
  const incoming = state.marks.filter((source) => symbols[source.kind].fields?.includes(mark.kind) && pairing(source).fields.some((field) => field.target?.id === mark.id));
  const rows = fields.map(({ kind, target }) => `<dt>${label(kind)}</dt><dd>${target ? locateButton(target) : '<span class="no-match">待配对</span>'}</dd>`);
  if (isInstruction(mark) && mark.kind !== "dsFine") {
    rows.unshift('<dt>回跳起点</dt><dd><button class="plain text-button" data-action="first">第 1 小节第 1 拍</button></dd>');
  }
  if (mark.kind === "dcCoda") {
    const codaLocation = chain?.target ? locateButton(chain.target) : chain ? locateButton(chain.owner, "定位缺少落点的 To Coda") : '<span class="no-match">先配对 To Coda</span>';
    rows.push(`<dt>Coda 落点</dt><dd>${codaLocation}</dd>`);
  }
  if (incoming.length) rows.push(`<dt>关联记号</dt><dd>${incoming.map((source) => locateButton(source)).join(" ")}</dd>`);
  if (mark.kind === "dc" && state.policy === "tail") rows.push("<dt>重奏结束</dt><dd>全曲末端</dd>");
  return `<article class="mark-row${state.activeMark === mark.id ? " active" : ""}">
    <div class="mark-row-title"><strong class="mark-name">${symbolMarkup(symbols[mark.kind])}</strong><span class="small">${symbols[mark.kind].atStart ? "小节开头" : "小节末端"}</span></div>
    <p>${symbols[mark.kind].description}</p>${rows.length ? `<dl class="pairs">${rows.join("")}</dl>` : ""}
    ${issues.map((message) => `<p class="warning-box">${message}</p>`).join("")}
    <div class="actions"><button data-action="edit" data-id="${mark.id}"${state.draft ? " disabled" : ""}>编辑</button><button class="plain subtle-danger" data-action="delete" data-id="${mark.id}"${state.draft ? " disabled" : ""}>删除</button></div>
  </article>`;
}

function formMarkup() {
  const { mark, original, changed } = state.draft;
  const info = symbols[mark.kind];
  const { fields, issues, chain } = pairing(mark, state.marks, state.policy, true);
  const others = onMeasure(mark.measure).filter((item) => item.id !== original);
  const taken = (kind) => others.some((item) => item.kind === kind || (isInstruction(item) && symbols[kind].directive));
  const available = Object.keys(symbols).filter((kind) => kind !== "dc" || state.policy === "tail" || mark.kind === "dc");
  const options = available.map((kind) => option(kind, label(kind), kind === mark.kind, taken(kind) || (kind === "dc" && state.policy === "explicit"))).join("");
  const fixedStart = info.directive && mark.kind !== "dsFine" ? " 回跳到第 1 小节第 1 拍。" : "";
  const unbound = (field) => field.target && !field.id ? `唯一候选 · 第 ${markLocation(field.target)}` : "请选择小节";
  const fieldsMarkup = fields.map((field) => `<div class="form-field">
    <label for="pair-${field.kind}">${field.kind === "coda" ? "跳到 Coda" : `配对 ${label(field.kind)}`}</label>
    <select id="pair-${field.kind}" data-pair="${field.kind}" aria-describedby="hint-${field.kind}"${field.message ? ' aria-invalid="true"' : ""}${field.blocked ? " disabled" : ""}>
      ${option("", unbound(field), !field.id)}
      ${field.id && !field.target ? option(field.id, "原配对已失效", true, true) : ""}
      ${field.candidates.map((candidate) => option(candidate.id, `第 ${markLocation(candidate)}`, candidate.id === field.id)).join("")}
    </select><p id="hint-${field.kind}" class="small${field.message ? " no-match" : ""}">${field.message || "应用后记录选定位置。"}</p>
  </div>`).join("");
  const chainMarkup = chain ? `<div class="${chain.error ? "warning-box" : "chain-note small"}">${chain.error
    ? `${chain.error} ${locateButton(chain.owner, "定位 To Coda")}`
    : `Coda 落点 ${locateButton(chain.target)}，由 To Coda 设置。`}</div>` : "";
  return `<form class="editor-form" id="editor-form">
    <h3>${original ? "编辑记号" : "添加记号"}</h3>
    <div class="form-field"><label for="mark-type">记号</label><select id="mark-type" aria-describedby="type-hint">${options}</select>
    <p id="type-hint" class="small">第 ${mark.measure} 小节${info.atStart ? "开头" : "末端"}。${fixedStart}</p></div>
    ${mark.kind === "dc" && issues.length ? `<p class="warning-box">${issues[0]}</p>` : ""}${fieldsMarkup}${chainMarkup}
    <div class="actions end"><button type="button" data-action="cancel-form">取消</button>
    <button type="submit" class="primary"${issues.length || taken(mark.kind) || (!changed && !fields.some((field) => field.target && !field.id)) ? " disabled" : ""}>应用</button></div>
  </form>`;
}

function renderInspector() {
  $("side-tab").textContent = state.audition ? "演奏顺序" : "小节";
  if (state.audition) {
    renderAudition();
    return;
  }
  const all = onMeasure(state.selected).sort(markOrder);
  $("side-body").innerHTML = `<div class="selected-heading"><h2>第 ${state.selected} 小节</h2><span class="object-meta">六线谱 / 4/4</span></div>
    <section class="property-group" aria-labelledby="jump-heading">
    <div class="group-heading"><h3 id="jump-heading" tabindex="-1">反复与跳转</h3><button id="add-mark" data-action="add"${state.draft ? " disabled" : ""}>＋ 添加记号</button></div>
    ${all.length ? all.map(inspectorMark).join("") : '<p class="small property-empty">本小节暂无记号。</p>'}
    ${state.draft ? formMarkup() : ""}</section>`;
  $("side-foot").textContent = "也可右键小节或按 Shift + F10 打开此处。";
}

function phaseTitle(run) {
  if (!run) return "准备试听";
  if (run.phase === "issue") return "试听已停止 · 配对待处理";
  if (run.phase === "ended") return run.stage === "initial" ? "试听结束" : "重奏结束";
  if (run.phase === "playing") return "正在播放";
  return "已暂停";
}

function renderAudition() {
  const run = state.run;
  const position = run?.position;
  const transit = (item, index) => {
    const arrow = index ? `<span class="flow-arrow${item.jump ? " jump" : ""}" aria-label="${item.jump ? "跳转到" : "然后"}">${item.jump ? "↪" : "→"}</span>` : "";
    const current = index === run.visits.length - 1;
    return `${arrow}<span class="bar-no${current ? " active" : ""}"${current ? ' aria-current="step"' : ""} aria-label="第 ${item.measure} 小节">${item.measure}</span>`;
  };
  const events = run?.events || [];
  const latest = events.at(-1);
  const stage = run?.stage === "replay" ? "重奏" : run?.stage === "coda" ? "尾段" : "首遍";
  const summary = position ? `第 ${position.measure} 小节${position.edge ? "末" : `第 ${position.beat} 拍`} · ${stage}` : "点播放连续听，或单步走一小节。";
  const issueMark = run?.phase === "issue" ? latest?.id : null;
  const issueMeasure = issueMark ? getMark(issueMark)?.measure : null;
  $("side-body").innerHTML = `<div class="selected-heading"><h2>试听</h2><span class="object-meta">谱面只读</span></div>
    <p class="read-context">${state.start === 1 ? "从曲首" : `从第 ${state.start} 小节`}开始</p>
    <section class="property-group" aria-label="试听状态">
      <div class="step-state ${run?.phase === "issue" ? "issue" : run ? "live" : ""}"><strong>${phaseTitle(run)}</strong><p>${summary}</p>
      ${run && ["ended", "issue"].includes(run.phase) ? `<p>${latest.text}</p>` : ""}
      ${issueMeasure ? `<button data-action="repair" data-id="${issueMark}">返回编辑第 ${issueMeasure} 小节</button>` : ""}</div>
      <h3>已走小节</h3>
      ${run ? `<div class="route" id="route">${run.visits.map(transit).join("")}</div>` : '<p class="small property-empty">开始后显示实际演奏顺序。</p>'}
      ${events.length ? `<h3>经过的记号</h3><ol class="route-log">${events.map((event) => `<li><span>${event.measure} 小节</span><div>${event.text}</div></li>`).join("")}</ol>` : ""}
    </section>`;
  $("side-foot").textContent = "单步推进至下一小节第 1 拍或结束边界。";
}

function render() {
  const active = state.run?.phase === "playing" || state.run?.phase === "paused";
  document.body.classList.toggle("audition", state.audition);
  $("edit-tools").hidden = state.audition;
  $("play-tools").hidden = !state.audition;
  $("audition-toggle").setAttribute("aria-pressed", state.audition);
  $("audition-label").textContent = state.audition ? "退出试听" : "试听";
  $("play").textContent = state.run?.phase === "playing" ? "暂停" : state.run?.phase === "paused" ? "继续" : "播放";
  $("stop").disabled = !state.run;
  $("step").disabled = state.run?.phase === "playing" || ["ended", "issue"].includes(state.run?.phase);
  $("start").value = state.start;
  $("start").disabled = active;
  $("file-status").textContent = state.dirty ? "有未保存的修改" : state.showingSaved ? "已模拟保存" : "示例曲谱";
  $("selection-status").textContent = state.audition ? phaseTitle(state.run) : `第 ${state.selected} 小节 / 共 ${music.length} 小节`;
  renderScore();
  renderInspector();
}

function renderPlaybackFrame() {
  const body = $("side-body");
  const scroll = body.scrollTop;
  const focus = document.activeElement;
  render();
  body.scrollTop = scroll;
  if (focus.id && focus !== document.activeElement) $(focus.id)?.focus({ preventScroll: true });
  if ($("follow").checked) document.querySelector(".cursor")?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function switchMeasure(number, id = null, focus = "", reveal = false) {
  if (state.audition) {
    if (state.run?.phase === "playing" || state.run?.phase === "paused") return;
    state.start = number;
    stop(true);
    $("start").focus();
    return;
  }
  function select() {
    const moved = number !== state.selected;
    state.selected = number;
    state.activeMark = id;
    render();
    if (moved) $("side-body").scrollTop = 0;
    if (reveal) document.querySelector(`[data-measure="${number}"]`)?.scrollIntoView({ block: "nearest" });
    if (focus === "properties") $("jump-heading").focus();
    if (focus === "score") document.querySelector(`.measure-target[data-number="${number}"]`)?.focus({ preventScroll: true });
  }
  if (number !== state.selected || (id && id !== state.activeMark)) discardDraft(select);
  else select();
}

function editMark(id) {
  function edit() {
    const original = getMark(id);
    state.activeMark = id;
    state.draft = {
      original: id, changed: !original,
      mark: original ? { ...original, links: { ...original.links } } : { id: "draft", kind: "fine", measure: state.selected, links: {} },
    };
    if (!original) {
      const others = onMeasure(state.selected);
      state.draft.mark.kind = ["fine", "segno", "toCoda", "coda", "dcFine"].find((kind) => !others.some((item) => item.kind === kind || (isInstruction(item) && symbols[kind].directive)));
      if (!state.draft.mark.kind) {
        state.draft = null;
        setMessage("本小节可添加的记号已齐全，可编辑或删除现有记号。");
        return;
      }
    }
    render();
    $("mark-type").focus();
  }
  discardDraft(edit);
}

function applyDraft() {
  const { original, mark } = state.draft;
  const { fields, issues } = pairing(mark, state.marks, state.policy, true);
  if (issues.length) return;
  const id = original || `m${state.nextId++}`;
  const links = Object.fromEntries(fields.map(({ kind, target }) => [kind, target.id]));
  const updated = { ...mark, id, links };
  const message = original ? "记号已更新。" : "记号已添加。";
  const commit = () => {
    state.marks = state.marks.filter((item) => item.id !== original).concat(updated);
    state.activeMark = id;
    state.draft = null;
    state.dirty = true;
    render();
    setMessage(message);
    $("jump-heading").focus();
  };
  const previous = getMark(original);
  const affected = previous && previous.kind !== mark.kind ? affectedSources(original) : [];
  if (affected.length) {
    ask("更换记号类型？", `${affected.map((source) => `第 ${markLocation(source)}的 ${label(source.kind)}`).join("、")}将失去配对。`, "更换类型", commit);
  } else commit();
}

function affectedSources(id) {
  return state.marks.filter((mark) => symbols[mark.kind].fields && Object.values(pairing(mark).picked).some((target) => target.id === id));
}

function deleteMark(id) {
  const mark = getMark(id);
  const affected = affectedSources(id);
  const extra = affected.length ? ` ${affected.map((source) => `第 ${markLocation(source)}的 ${label(source.kind)}`).join("、")}将失去配对，可以随后修复。` : "";
  ask("删除记号？", `删除第 ${markLocation(mark)}的 ${label(mark.kind)}。${extra}`, "删除记号", () => {
    state.marks = state.marks.filter((item) => item.id !== id);
    state.activeMark = null;
    state.dirty = true;
    render();
    setMessage(`已删除 ${label(mark.kind)}。`);
    $("add-mark").focus();
  }, true);
}

function ask(title, copy, button, proceed, destructive = false) {
  state.confirm = proceed;
  $("confirm-title").textContent = title;
  $("confirm-copy").textContent = copy;
  $("confirm-action").textContent = button;
  $("confirm-action").className = destructive ? "danger" : "primary";
  $("confirm").showModal();
}

function discardDraft(proceed) {
  if (!state.draft?.changed) { state.draft = null; proceed(); return; }
  ask("放弃未应用的记号修改？", `第 ${state.selected} 小节的表单仍有未应用修改。`, "放弃修改", () => {
    state.draft = null;
    proceed();
  });
}

function guardDocument(proceed) {
  if (!state.dirty && !state.draft?.changed) { proceed(); return; }
  ask("放弃当前修改？", "当前示例有尚未保存或应用的修改。", "放弃并继续", proceed);
}

function enterAudition() {
  if (state.draft?.changed) {
    setMessage("请先应用或取消小节属性中的修改，再进入试听。");
    $("mark-type").focus();
    return;
  }
  state.draft = null;
  state.audition = true;
  state.start = state.selected;
  closeContext();
  setMessage();
  render();
  $("play").focus();
}

function exitAudition(update = true) {
  stop(false);
  state.audition = false;
  if (update) {
    setMessage();
    render();
    $("audition-toggle").focus();
  }
}

// 每个边界只推进一次。回跳时首拍和声音都由同一位置驱动，单步与连续试听共用此状态。
function startRun() {
  state.run = {
    stage: "initial", phase: "paused", active: null, position: { measure: state.start, beat: 1, edge: false },
    visits: [{ measure: state.start, jump: false }], events: [],
  };
}

function finishMeasure() {
  const run = state.run;
  const measure = run.position.measure;
  const current = onMeasure(measure).sort(markOrder);
  const event = (text, id) => run.events.push({ measure, text, id });
  const enter = (number, jump) => {
    run.position = { measure: number, beat: 1, edge: false };
    run.visits.push({ measure: number, jump });
  };
  const end = (phase, text, id) => {
    run.phase = phase;
    run.position = { measure, beat: 4, edge: true };
    event(text, id);
  };
  for (const mark of current.filter((item) => item.kind === "fine" || item.kind === "toCoda")) {
    if (run.stage === "replay" && run.active?.picked[mark.kind]?.id === mark.id) {
      if (mark.kind === "fine") {
        end("ended", "命中配对 Fine，弹完本小节后结束。", mark.id);
        return;
      }
      run.stage = "coda";
      const coda = run.active.picked.coda.measure;
      event(`重奏经过配对 To Coda，跳至第 ${coda} 小节第 1 拍。`, mark.id);
      enter(coda, true);
      return;
    }
    const reason = run.stage === "initial" ? "首遍经过" : "当前演奏未启用此记号";
    event(`${reason} ${label(mark.kind)}，顺行。`, mark.id);
  }
  const jump = current.find(isInstruction);
  if (jump && run.stage === "initial") {
    const resolved = pairing(jump);
    if (resolved.issues.length) {
      end("issue", `${label(jump.kind)}：${resolved.issues.join(" ")}`, resolved.chain?.error ? resolved.chain.owner.id : jump.id);
      return;
    }
    run.stage = "replay";
    run.active = resolved;
    const destination = resolved.picked.segno?.measure || 1;
    const target = resolved.picked.segno ? " Segno" : "曲首";
    event(`执行 ${label(jump.kind)}，回到${target}（第 ${destination} 小节第 1 拍）。`, jump.id);
    enter(destination, true);
    return;
  }
  if (jump && run.stage === "replay") event(`${label(jump.kind)} 在本次重奏中顺行。`, jump.id);
  if (measure === music.length) { end("ended", "到达全曲末端。", null); return; }
  enter(measure + 1, false);
}

function hush() {
  if (state.voice) {
    try { state.voice.stop(); } catch { /* 音符可能已自然结束。 */ }
    state.voice = null;
  }
}

function prepareAudio() {
  const Audio = window.AudioContext || window.webkitAudioContext;
  try {
    if (!Audio) throw new Error("audio unavailable");
    state.audio ||= new Audio();
    state.audio.resume().catch(() => { $("sound-label").textContent = "示意音不可用，仍可查看游标"; });
  } catch {
    $("sound-label").textContent = "示意音不可用，仍可查看游标";
  }
}

function playNote() {
  if (!state.audio) return;
  hush();
  const { measure, beat } = state.run.position;
  const [, strings, frets] = music[measure - 1];
  const midi = [64, 59, 55, 50, 45, 40][strings[beat - 1]] + frets[beat - 1];
  const { currentTime: time, destination } = state.audio;
  const oscillator = state.audio.createOscillator();
  const gain = state.audio.createGain();
  oscillator.type = "triangle";
  oscillator.frequency.value = 440 * 2 ** ((midi - 69) / 12);
  gain.gain.setValueAtTime(.065, time);
  gain.gain.exponentialRampToValueAtTime(.001, time + .34);
  oscillator.connect(gain).connect(destination);
  oscillator.start(time);
  oscillator.stop(time + .35);
  state.voice = oscillator;
}

function playClock() {
  if (state.run.phase !== "playing") return;
  playNote();
  state.timer = setTimeout(() => {
    const run = state.run;
    if (run.position.beat < 4) run.position.beat++;
    else finishMeasure();
    renderPlaybackFrame();
    if (run.phase === "ended" || run.phase === "issue") setMessage(`${phaseTitle(run)}，第 ${run.position.measure} 小节末。`);
    playClock();
  }, 60000 / 90);
}

function stop(update = true) {
  clearTimeout(state.timer);
  hush();
  state.run = null;
  if (update) render();
}

function togglePlay() {
  if (state.run?.phase === "playing") {
    clearTimeout(state.timer);
    hush();
    state.run.phase = "paused";
    renderPlaybackFrame();
    return;
  }
  prepareAudio();
  if (state.run?.phase !== "paused") startRun();
  state.run.phase = "playing";
  renderPlaybackFrame();
  playClock();
}

function step() {
  if (!state.run) startRun();
  else finishMeasure();
  renderPlaybackFrame();
  const phase = state.run.phase;
  if (phase === "ended" || phase === "issue") {
    const next = phase === "issue" ? document.querySelector('[data-action="repair"]') : $("play");
    next?.focus({ preventScroll: true });
    setMessage(`${phaseTitle(state.run)}，第 ${state.run.position.measure} 小节末。`);
  } else {
    setMessage(`第 ${state.run.position.measure} 小节第 1 拍。`);
    $("step").focus({ preventScroll: true });
  }
}

function snapshot() {
  return { marks: state.marks.map((mark) => ({ ...mark, links: { ...mark.links } })), nextId: state.nextId, example: state.example };
}

function save() {
  $("file-menu").open = false;
  if (state.draft?.changed) {
    setMessage("请先应用或取消小节属性中的修改，再模拟保存。");
    $("mark-type").focus();
    return;
  }
  state.saved = snapshot();
  state.dirty = false;
  state.showingSaved = true;
  let message = "已模拟保存。可用「文件 → 模拟重开」复查。";
  try { localStorage.setItem(storageKey, JSON.stringify(state.saved)); }
  catch { message = "已临时模拟保存。本页内可重开，关闭页面后会清除。"; }
  render();
  setMessage(message);
  $("file-menu").querySelector("summary").focus();
}

function reopen() {
  $("file-menu").open = false;
  const saved = state.saved;
  if (!saved) {
    setMessage("暂无已保存的示例，请先模拟保存。");
    $("file-menu").querySelector("summary").focus();
    return;
  }
  guardDocument(() => {
    exitAudition(false);
    state.draft = null;
    state.marks = saved.marks.map((mark) => ({ ...mark, links: { ...mark.links } }));
    state.nextId = saved.nextId;
    state.example = "reopened";
    state.selected = 1;
    state.activeMark = null;
    state.dirty = false;
    state.showingSaved = true;
    $("scenario").value = "reopened";
    render();
    setMessage("已重开保存的曲谱。选择小节可继续编辑。");
    $("file-menu").querySelector("summary").focus();
  });
}

function closeContext(restore = false) {
  $("context").hidden = true;
  if (restore && state.contextOwner) document.querySelector(`.measure-target[data-number="${state.contextOwner}"]`)?.focus();
  state.contextOwner = null;
}

function openContext(number, x, y) {
  if (state.audition) return;
  function show() {
    switchMeasure(number);
    const context = $("context");
    state.contextOwner = number;
    $("context-title").textContent = `第 ${number} 小节`;
    context.style.left = `${Math.min(x, window.innerWidth - 178)}px`;
    context.style.top = `${Math.min(y, window.innerHeight - 78)}px`;
    context.hidden = false;
    context.querySelector("button").focus();
  }
  if (number !== state.selected) discardDraft(show);
  else show();
}

const actions = {
  audition: () => state.audition ? exitAudition() : enterAudition(),
  play: togglePlay, stop: () => { stop(); setMessage("试听已停止。"); $("play").focus(); }, step,
  "measure-tool": () => $("jump-heading").focus(),
  measure: ({ number }) => switchMeasure(Number(number), null, "score"),
  "score-mark": ({ id }) => {
    const mark = getMark(id);
    switchMeasure(mark.measure, id, "properties");
  },
  locate: ({ id }) => {
    const mark = getMark(id);
    switchMeasure(mark.measure, id, "properties", true);
  },
  first: () => switchMeasure(1, null, "score", true),
  "context-edit": () => { closeContext(); $("jump-heading").focus(); },
  add: () => editMark(null), edit: ({ id }) => editMark(id), delete: ({ id }) => deleteMark(id),
  "cancel-form": () => { state.draft = null; render(); $("jump-heading").focus(); },
  repair: ({ id }) => { exitAudition(false); switchMeasure(getMark(id).measure, id); editMark(id); },
  legend: () => $("legend").showModal(), "close-legend": () => $("legend").close(),
  save, reopen,
  "cancel-confirm": () => $("confirm").close(),
  confirm: () => { const proceed = state.confirm; $("confirm").close(); proceed?.(); },
};

function initialize() {
  $("scenario").innerHTML = Object.entries(examples).map(([key, example]) => option(key, example.name)).join("") + option("reopened", "已重开的曲谱", false, true);
  $("start").innerHTML = music.map((_, index) => option(index + 1, index ? `从第 ${index + 1} 小节` : "从曲首")).join("");
  $("legend-list").innerHTML = Object.values(symbols).map((info) => `<div><dt>${symbolMarkup(info)}</dt><dd>${info.description}</dd></div>`).join("");
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey));
    if (Array.isArray(stored?.marks)) state.saved = stored;
  } catch { /* file:// 的存储权限由浏览器决定，页内仍可重开。 */ }
  selectExample("fine");
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!$("context").hidden && !event.target.closest("#context")) closeContext();
  if ($("file-menu").open && !event.target.closest("#file-menu")) $("file-menu").open = false;
  if (button) actions[button.dataset.action]?.(button.dataset);
});
document.addEventListener("contextmenu", (event) => {
  const measure = event.target.closest("[data-measure]");
  if (!measure) return;
  event.preventDefault();
  openContext(Number(measure.dataset.measure), event.clientX, event.clientY);
});
document.addEventListener("keydown", (event) => {
  if ($("legend").open || $("confirm").open) return;
  const measure = event.target.closest("[data-measure]");
  if (measure && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) {
    event.preventDefault();
    const rect = measure.getBoundingClientRect();
    openContext(Number(measure.dataset.measure), rect.left + 12, rect.top + 12);
  }
  if (event.key === "Escape") {
    if (!$("context").hidden) closeContext(true);
    else if ($("file-menu").open) { $("file-menu").open = false; $("file-menu").querySelector("summary").focus(); }
    else if (state.audition) exitAudition();
  }
});
document.addEventListener("submit", (event) => {
  if (event.target.id !== "editor-form") return;
  event.preventDefault();
  applyDraft();
});
document.addEventListener("change", (event) => {
  const input = event.target;
  if (input.id === "scenario") {
    const key = input.value;
    input.value = state.example;
    guardDocument(() => selectExample(key));
  } else if (input.id === "policy") {
    const choice = input.value;
    input.value = state.policy;
    discardDraft(() => {
      state.policy = choice;
      input.value = choice;
      stop(false);
      render();
      setMessage("已切换独立 D.C. 的评审备选。此项不写入曲谱。");
    });
  } else if (input.id === "start") {
    state.start = Number(input.value);
    stop();
    setMessage();
  } else if (input.id === "mark-type" || input.dataset.pair) {
    const { mark } = state.draft;
    if (input.id === "mark-type") {
      mark.kind = input.value;
      mark.links = {};
    } else {
      mark.links[input.dataset.pair] = input.value;
    }
    state.draft.changed = true;
    const scroll = $("side-body").scrollTop;
    renderInspector();
    $("side-body").scrollTop = scroll;
    $(input.id).focus();
  }
});
initialize();
