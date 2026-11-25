const $ = (id) => document.getElementById(id);
const range = (start, end) => Array.from({ length: end - start + 1 }, (_, i) => start + i);
const variants = { complete: '一／二／三房完整示例', missing: '缺少二房', empty: '空白结尾练习' };
const passes = [1, 2, 3];
const start = 4;
const end = 10;
const last = 12;
const storageKey = 'lxm-req106-prototype-v1';
const chords = ['C', 'G', 'Am', 'F', 'G', 'C', 'Am', 'G', 'F', 'C', 'G', 'C'];
const frets = {
  C: [[5, 3], [3, 0], [2, 1], [1, 0]], G: [[6, 3], [3, 0], [2, 0], [1, 3]],
  Am: [[5, 0], [3, 2], [2, 1], [1, 0]], F: [[6, 1], [4, 3], [2, 1], [1, 1]],
};
const state = {
  houses: [], variant: 'complete', nextId: 4, anchor: 4, focus: 6, form: null, snapshot: null,
  audition: false, playing: false, timer: 0, cursor: -1, plan: [], issue: null, missing: null,
};

function fixture(variant) {
  const complete = [{ id: 1, from: 4, to: 6, passes: [1] }, { id: 2, from: 7, to: 8, passes: [2] }, { id: 3, from: 9, to: 10, passes: [3] }];
  if (variant === 'missing') return complete.filter((house) => house.id !== 2);
  if (variant === 'empty') return [];
  return complete;
}

const interval = (a, b) => ({ from: Math.min(a, b), to: Math.max(a, b) });
const selection = () => interval(state.anchor, state.focus);
const intersects = (a, b) => a.from <= b.to && b.from <= a.to;
const rangeText = ({ from, to }) => from === to ? `第 ${from} 小节` : `第 ${from}–${to} 小节`;
const passText = (house) => house.passes.map((pass) => `${pass}.`).join('、');
const name = (house) => `${passText(house)} 房 · ${rangeText(house)}`;
const payload = () => JSON.stringify({ houses: state.houses, variant: state.variant, nextId: state.nextId });

// 练习谱预设 1–3 为共享段，4–10 为结尾区。遍次仅来自此处明示的三遍练习规则。
function makePlan() {
  const plan = [];
  state.missing = null;
  for (const pass of passes) {
    for (const n of range(1, 3)) {
      const previous = plan.at(-1);
      const detail = n > 1 ? '' : pass === 1 ? '从谱首开始' : `${previous.n} → 1 · 回到共享段`;
      plan.push({ n, pass, detail });
    }
    const house = state.houses.find((item) => item.passes.includes(pass));
    if (!house) {
      state.missing = pass;
      break;
    }
    for (const n of range(house.from, house.to)) {
      plan.push({ n, pass, detail: n === house.from ? `3 → ${n} · 进入 ${passText(house)} 房` : '' });
    }
  }
  if (!state.missing) {
    const previous = plan.at(-1).n;
    for (const n of range(11, last)) plan.push({ n, pass: null, detail: n === 11 ? `${previous} → 11 · 进入共同尾段` : '' });
  }
  state.plan = plan;
}

function bracket(house, first, lastInSystem, draft = false) {
  const left = Math.max(house.from, first);
  const right = Math.min(house.to, lastInSystem);
  const begins = left === house.from;
  const ends = right === house.to;
  const focused = !state.audition && intersects(house, selection());
  const classes = ['bracket', begins ? 'start' : 'continuation', ends ? 'end' : '', focused ? 'focused' : '', draft ? 'draft' : ''].join(' ');
  const caption = begins ? passText(house) : `(${passText(house)})`;
  return `<div class="${classes}" data-house="${draft ? 'draft' : house.id}"${draft ? ' aria-hidden="true"' : ` role="img" aria-label="${name(house)}${begins ? '' : '，换行续线'}"`} style="--left:${(left - first) * 25}%;--width:${(right - left + 1) * 25}%">${draft ? '' : `<span>${caption}</span>`}</div>`;
}

function measure(n) {
  const chord = chords[n - 1];
  const notes = frets[chord];
  const selected = !state.audition && intersects({ from: n, to: n }, selection());
  const house = state.houses.find((item) => n >= item.from && n <= item.to);
  const line = n === 1 ? 'repeat-start' : n === last ? 'final' : house?.to === n && house.passes.some((pass) => pass < 3) ? 'repeat-end' : '';
  return `<button class="measure${selected ? ' selected' : ''}" data-n="${n}" aria-label="第 ${n} 小节${house ? ` · ${passText(house)} 房` : ''}" aria-pressed="${selected}"${state.audition ? ' disabled' : ''}>
    <span class="num">${n}</span><span class="chord">${chord}</span><span class="staff ${line}">
    ${notes.map(([string, fret], i) => `<span class="fret" style="left:${(i + 1) * 20}%;top:${(string - 1) * 8}px">${fret}</span>`).join('')}</span></button>`;
}

function renderPaper() {
  const rows = range(0, 2).map((row) => {
    const first = row * 4 + 1;
    const lastInSystem = first + 3;
    const area = { from: first, to: lastInSystem };
    const draft = state.form?.draft;
    const overlays = state.houses.filter((house) => intersects(house, area)).map((house) => bracket(house, first, lastInSystem));
    if (state.form?.dirty && draft.from >= start && draft.to <= end && draft.from <= draft.to && intersects(draft, area)) {
      overlays.push(bracket(draft, first, lastInSystem, true));
    }
    return `<div class="sys">${range(first, lastInSystem).map(measure).join('')}${overlays.join('')}</div>`;
  });
  const steps = [...passes, null].map((pass) => {
    const visits = state.plan.filter((item) => item.pass === pass);
    const text = visits.map(({ n }) => n).join(' → ');
    const label = pass ? `第 ${pass} 遍` : '共同尾段';
    return `<div><strong>${label}</strong><p class="muted">${text || '—'}${pass && pass === state.missing ? ' · 缺房时暂停' : ''}</p></div>`;
  });
  $('paper').innerHTML = `<header class="paper-heading"><h1>分遍结尾练习</h1><p>吉他六线谱 · 三遍反复示意</p></header>${rows.join('')}
    <div class="subsection"><h3>演奏顺序预览</h3><div class="sequence">${steps.join('')}</div></div>`;
  paintCursor(false);
}

function validation(draft) {
  if (!Number.isInteger(draft.from) || !Number.isInteger(draft.to) || draft.from < start || draft.to > end || draft.from > draft.to) {
    return { field: 'range', message: '请在第 4–10 小节内填写起止，起点须早于或等于终点。' };
  }
  if (!draft.passes.length) return { field: 'passes', message: '请至少选择一个遍次。' };
  const other = state.houses.filter((house) => house.id !== draft.id);
  const overlapping = other.find((house) => intersects(house, draft));
  if (overlapping) return { field: 'range', message: `范围与 ${name(overlapping)} 重叠。请调整起止。` };
  const duplicate = other.find((house) => draft.passes.some((pass) => house.passes.includes(pass)));
  if (duplicate) return { field: 'passes', message: `${name(duplicate)} 已占用该遍次。请选择其他遍次。` };
  return null;
}

function formMarkup() {
  const { draft, error } = state.form;
  const rangeError = error?.field === 'range';
  const passError = error?.field === 'passes';
  const describeRange = rangeError ? 'range-error' : 'range-help';
  return `<form id="house-form" class="house-form" novalidate>
    <h3>${draft.id ? '编辑反复房子' : '插入反复房子'}</h3>
    <p class="hint" id="range-help">本练习的结尾区为 4–10 小节，括线包含起止小节。</p>
    <div class="form-range"><label>起始小节<input id="from" data-field="from" type="number" value="${draft.from}" min="4" max="10" aria-describedby="${describeRange}"${rangeError ? ' aria-invalid="true"' : ''}></label>
    <label>结束小节<input id="to" data-field="to" type="number" value="${draft.to}" min="4" max="10" aria-describedby="${describeRange}"${rangeError ? ' aria-invalid="true"' : ''}></label></div>
    ${rangeError ? `<p id="range-error" class="field-error" role="alert">${error.message}</p>` : ''}
    <fieldset><legend>使用遍次</legend>${passes.map((pass) => `<label><input id="pass-${pass}" type="checkbox" data-pass="${pass}"${draft.passes.includes(pass) ? ' checked' : ''}${passError ? ' aria-invalid="true" aria-describedby="pass-error"' : ''}>第 ${pass} 遍</label>`).join('')}</fieldset>
    ${passError ? `<p id="pass-error" class="field-error" role="alert">${error.message}</p>` : ''}
    <div class="actions"><button type="submit" class="primary">应用</button><button type="button" data-cancel>取消</button>${draft.id ? '<button type="button" data-delete class="delete">删除</button>' : ''}</div>
  </form>`;
}

function inspectorMarkup() {
  const legend = '<dl class="symbols"><dt>1. / 2. / 3.</dt><dd>括线内的小节在对应遍次演奏。</dd><dt>(1.)</dt><dd>上一谱行的同一条括线继续。</dd><dt>反复线</dt><dd>在此练习中，第 1、2 遍结尾演奏后回到共享段，第 3 遍接尾段。</dd></dl>';
  if (state.audition) {
    return `<div class="section-head"><h2>试听</h2></div><p class="hint">从谱首按已应用的范围和遍次试听。声音为 Web Audio 示意音。</p>
      ${state.missing ? `<div class="subsection"><p class="notice">缺少第 ${state.missing} 遍的结尾。弹完该遍共享段后暂停。</p><button data-repair>返回编辑并补房</button></div>` : ''}
      <div class="subsection"><h3>符号释义</h3>${legend}</div>`;
  }
  const sorted = [...state.houses].sort((a, b) => a.from - b.from);
  const list = sorted.map((house) => `<div class="house-row ${intersects(house, selection()) ? 'current' : ''}"><span><strong>${passText(house)} 房</strong><small>${rangeText(house)}${Math.floor((house.from - 1) / 4) !== Math.floor((house.to - 1) / 4) ? ' · 跨谱行' : ''}</small></span><button data-edit="${house.id}" aria-label="编辑 ${passText(house)} 房">编辑</button></div>`).join('');
  const missing = passes.filter((pass) => !state.houses.some((house) => house.passes.includes(pass)));
  return `<div class="section-head"><h2 tabindex="-1" id="control-heading">反复与跳转</h2><button id="add-house">插入反复房子</button></div>
    <p class="hint">拖动或按 Shift 选连续小节，也可直接填写起止。</p>
    <div class="house-list">${list || '<p class="muted">本练习还没有反复房子。</p>'}</div>
    ${state.form ? formMarkup() : ''}
    ${missing.length ? `<div class="subsection"><p class="notice">缺少第 ${missing.join('、')} 遍的结尾。试听在首次缺房的分岔处暂停。</p><button data-repair>补设第 ${missing[0]} 遍</button></div>` : ''}
    <div class="subsection"><label for="preset"><strong>练习谱例</strong></label><p class="hint">载入完整、缺房或空白练习。</p><select id="preset" class="preset">${Object.entries(variants).map(([variant, label]) => `<option value="${variant}"${state.variant === variant ? ' selected' : ''}>${label}</option>`).join('')}</select></div>
    <div class="subsection"><details open><summary><strong>符号释义</strong></summary>${legend}</details></div>`;
}

function renderInspector(focusId) {
  $('selection-label').textContent = rangeText(selection());
  $('inspector-content').innerHTML = inspectorMarkup();
  if (focusId) $(focusId)?.focus();
}

function render() {
  $('measure-tool').disabled = state.audition;
  $('save').disabled = state.audition;
  $('reopen').disabled = state.audition;
  $('audition').setAttribute('aria-pressed', String(state.audition));
  $('audition').textContent = state.audition ? '退出试听' : '试听';
  renderPaper();
  renderInspector();
}

function report(message) { $('file-state').textContent = message; }

function canLeaveForm() {
  return !state.form?.dirty || window.confirm('放弃未应用的反复房子编辑？');
}

function selectMeasures(anchor, focus, keyboardFocus = true) {
  const unchanged = state.anchor === anchor && state.focus === focus;
  if (!unchanged && !canLeaveForm()) { renderPaper(); return false; }
  if (!unchanged) state.form = null;
  state.anchor = anchor;
  state.focus = focus;
  renderPaper();
  renderInspector();
  if (keyboardFocus) document.querySelector(`[data-n="${focus}"]`)?.focus({ preventScroll: true });
  return true;
}

function insertHouse(repair = false) {
  if (!canLeaveForm()) return;
  if (state.audition) exitAudition();
  const pass = passes.find((value) => !state.houses.some((house) => house.passes.includes(value))) || 1;
  if (repair) {
    const bar = range(start, end).find((n) => !state.houses.some((house) => house.from <= n && house.to >= n));
    if (bar) state.anchor = state.focus = bar;
  }
  state.form = { draft: { ...selection(), passes: [pass] }, dirty: false, error: null };
  renderPaper();
  renderInspector('from');
}

function editHouse(id) {
  if (!canLeaveForm()) return;
  const house = state.houses.find((item) => item.id === id);
  state.anchor = house.from;
  state.focus = house.to;
  state.form = { draft: { ...house, passes: [...house.passes] }, dirty: false, error: null };
  renderPaper();
  document.querySelector(`[data-n="${house.from}"]`)?.scrollIntoView({ block: 'nearest' });
  renderInspector('from');
}

function applyHouse() {
  const draft = state.form.draft;
  const error = validation(draft);
  if (error) {
    state.form.error = error;
    return renderInspector(error.field === 'range' ? 'from' : 'pass-1');
  }
  const house = { ...draft, id: draft.id || state.nextId++ };
  state.houses = draft.id ? state.houses.map((item) => item.id === house.id ? house : item) : [...state.houses, house];
  state.anchor = house.from;
  state.focus = house.to;
  state.form = null;
  makePlan();
  render();
  report(`已应用 ${name(house)}`);
  document.querySelector(`[data-edit="${house.id}"]`)?.focus();
}

function deleteHouse() {
  const house = state.houses.find((item) => item.id === state.form.draft.id);
  $('confirm-text').textContent = `删除 ${name(house)} 后，第 ${house.passes.join('、')} 遍将缺少结尾。试听将在该遍分岔处暂停。`;
  const dialog = $('confirm');
  dialog.returnValue = '';
  dialog.addEventListener('close', () => {
    if (dialog.returnValue !== 'confirm') return;
    state.houses = state.houses.filter((item) => item.id !== house.id);
    state.form = null;
    makePlan();
    render();
    report(`已删除 ${name(house)} · 有遍次待补房`);
    $('add-house').focus();
  }, { once: true });
  dialog.showModal();
}

function loadFixture(variant) {
  state.variant = variant;
  state.houses = fixture(variant);
  state.nextId = 4;
  state.anchor = 4;
  state.focus = 6;
  state.form = null;
  makePlan();
  render();
  report(`已载入${variants[variant]}`);
}

let drag = null;
let ignoreClick = false;
const measureAt = (target) => Number(target?.closest('[data-n]')?.dataset.n) || null;
$('paper').addEventListener('pointerdown', (event) => {
  const n = measureAt(event.target);
  if (state.audition || event.button !== 0 || event.shiftKey || !n) return;
  drag = { n, last: n, pointer: event.pointerId };
});
document.addEventListener('pointermove', (event) => {
  if (!drag || drag.pointer !== event.pointerId) return;
  const n = measureAt(document.elementFromPoint(event.clientX, event.clientY));
  if (!n || n === drag.last) return;
  drag.last = n;
  const proposed = interval(drag.n, n);
  document.querySelectorAll('[data-n]').forEach((node) => {
    const index = Number(node.dataset.n);
    node.classList.toggle('selected', index >= proposed.from && index <= proposed.to);
  });
});
document.addEventListener('pointerup', (event) => {
  if (!drag || drag.pointer !== event.pointerId) return;
  const picked = drag;
  drag = null;
  const n = measureAt(document.elementFromPoint(event.clientX, event.clientY)) || picked.last;
  if (picked.n === n && picked.last === picked.n) return;
  ignoreClick = true;
  window.setTimeout(() => { ignoreClick = false; }, 0);
  selectMeasures(picked.n, n);
});
document.addEventListener('pointercancel', () => {
  if (!drag) return;
  drag = null;
  renderPaper();
});
$('paper').addEventListener('click', (event) => {
  const n = measureAt(event.target);
  if (!state.audition && n && !ignoreClick) selectMeasures(event.shiftKey ? state.anchor : n, n);
});

function showContext(n, x, y) {
  if (state.audition || (!intersects({ from: n, to: n }, selection()) && !selectMeasures(n, n, false))) return;
  const menu = $('context-menu');
  menu.style.left = `${Math.min(x, window.innerWidth - 190)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - 55)}px`;
  menu.hidden = false;
  $('context-entry').focus();
}
$('paper').addEventListener('contextmenu', (event) => {
  const n = measureAt(event.target);
  if (!n || state.audition) return;
  event.preventDefault();
  showContext(n, event.clientX, event.clientY);
});
$('paper').addEventListener('keydown', (event) => {
  const n = measureAt(event.target);
  if (!n) return;
  if (event.shiftKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault();
    const next = Math.max(1, Math.min(last, n + (event.key === 'ArrowRight' ? 1 : -1)));
    selectMeasures(state.anchor, next);
  }
  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
    event.preventDefault();
    const rect = event.target.getBoundingClientRect();
    showContext(n, rect.left + 10, rect.top + 20);
  }
});
$('context-entry').onclick = () => { $('context-menu').hidden = true; $('control-heading')?.focus(); };
$('measure-tool').onclick = () => $('control-heading')?.focus();
document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('#context-menu')) $('context-menu').hidden = true;
  if (!event.target.closest('#file-menu')) $('file-menu').open = false;
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || $('confirm').open) return;
  if (!$('context-menu').hidden) {
    $('context-menu').hidden = true;
    document.querySelector(`[data-n="${state.focus}"]`)?.focus();
  } else if (state.audition) exitAudition();
});

$('inspector-content').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.id === 'add-house') insertHouse();
  if (button.dataset.edit) editHouse(Number(button.dataset.edit));
  if (button.hasAttribute('data-repair')) insertHouse(true);
  if (button.hasAttribute('data-delete')) deleteHouse();
  if (button.hasAttribute('data-cancel')) {
    state.form = null;
    renderPaper();
    renderInspector('add-house');
  }
});
$('inspector-content').addEventListener('input', (event) => {
  const field = event.target.dataset.field;
  const pass = event.target.dataset.pass;
  if (!state.form || (!field && !pass)) return;
  const { draft } = state.form;
  if (field) draft[field] = event.target.valueAsNumber;
  if (pass) draft.passes = [...$('house-form').querySelectorAll('[data-pass]:checked')].map((item) => Number(item.dataset.pass));
  state.form.dirty = true;
  renderPaper();
});
$('inspector-content').addEventListener('change', (event) => {
  if (event.target.id !== 'preset') return;
  if (canLeaveForm() && (payload() === state.snapshot || window.confirm('切换练习谱例并替换当前内容？'))) loadFixture(event.target.value);
  else event.target.value = state.variant;
  $('preset')?.focus();
});
$('inspector-content').addEventListener('submit', (event) => {
  if (event.target.id !== 'house-form') return;
  event.preventDefault();
  applyHouse();
});

$('save').onclick = () => {
  $('file-menu').open = false;
  if (state.form?.dirty) return report('先应用或取消反复房子编辑，再保存模拟。');
  state.snapshot = payload();
  try {
    localStorage.setItem(storageKey, state.snapshot);
    report('模拟版本已保存 · 可在文件菜单重开');
  } catch { report('已保存到当前页面 · 可在文件菜单重开'); }
};
$('reopen').onclick = () => {
  $('file-menu').open = false;
  if (!canLeaveForm()) return;
  let snapshot = state.snapshot;
  try { snapshot ||= localStorage.getItem(storageKey); } catch { /* 当前页面仍可回读。 */ }
  if (!snapshot) return report('还没有模拟存档。先选择「保存模拟」。');
  if (snapshot !== payload() && !window.confirm('重开保存的版本并替换当前编辑？')) return;
  try {
    const data = JSON.parse(snapshot);
    if (!Array.isArray(data.houses) || !(data.variant in variants)) throw new Error('invalid snapshot');
    Object.assign(state, data, { snapshot, form: null });
  } catch { return report('模拟存档无法读取'); }
  makePlan();
  render();
  report('已重开模拟存档 · 反复房子可继续编辑');
};

let audio;
let audioOutput;
function silence() {
  if (audioOutput) {
    audioOutput.disconnect();
    audioOutput = null;
  }
}
function playSound(n) {
  if (!$('sound').checked) return;
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) return;
  try {
    audio ||= new Audio();
    audio.resume().catch(() => {});
    silence();
    audioOutput = audio.createGain();
    audioOutput.connect(audio.destination);
    const tuning = [64, 59, 55, 50, 45, 40];
    frets[chords[n - 1]].forEach(([string, fret], index) => {
      const start = audio.currentTime + index * 0.09;
      const osc = audio.createOscillator();
      const envelope = audio.createGain();
      osc.type = 'triangle';
      osc.frequency.value = 440 * 2 ** ((tuning[string - 1] + fret - 69) / 12);
      envelope.gain.setValueAtTime(0.001, start);
      envelope.gain.exponentialRampToValueAtTime(0.11, start + 0.012);
      envelope.gain.exponentialRampToValueAtTime(0.001, start + 0.23);
      osc.connect(envelope).connect(audioOutput);
      osc.start(start);
      osc.stop(start + 0.24);
    });
  } catch { /* 声音不可用时保留随谱游标与逐步核验。 */ }
}

function paintCursor(follow = true) {
  document.querySelector('.measure.playing')?.classList.remove('playing');
  const item = state.plan[state.cursor];
  if (item) {
    const node = document.querySelector(`[data-n="${item.n}"]`);
    node?.classList.add('playing');
    if (follow && $('follow').checked) node?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  $('playing-label').classList.toggle('active', Boolean(item));
  $('playing-label').textContent = state.issue || (item ? `第 ${item.n} 小节 · ${item.pass ? `第 ${item.pass} 遍` : '共同尾段'}${item.detail ? ` · ${item.detail}` : ''}` : '示意音 · 从谱首试听');
  $('play').textContent = state.playing ? '暂停' : item && !state.issue && state.cursor < state.plan.length - 1 ? '继续' : '播放';
  $('back').disabled = state.cursor < 1;
  $('step').disabled = Boolean(state.issue);
  $('stop').disabled = !item;
}

function pausePlayback() {
  clearTimeout(state.timer);
  state.playing = false;
  silence();
}
function stopPlayback() {
  pausePlayback();
  state.cursor = -1;
  state.issue = null;
  paintCursor(false);
}
function enterAudition() {
  if (state.audition) return true;
  if (!canLeaveForm()) return false;
  state.form = null;
  state.audition = true;
  makePlan();
  render();
  return true;
}
function exitAudition() {
  stopPlayback();
  state.audition = false;
  render();
  $('audition').focus();
}
function advance() {
  const next = state.plan[state.cursor + 1];
  if (!next) {
    pausePlayback();
    state.issue = state.missing ? `第 3 小节 · 试听已暂停 · 缺少第 ${state.missing} 遍结尾` : '第 12 小节 · 试听结束';
    paintCursor();
    return;
  }
  state.issue = null;
  state.cursor++;
  paintCursor();
  playSound(next.n);
  if (state.playing) state.timer = window.setTimeout(advance, 690);
}

$('audition').onclick = () => state.audition ? exitAudition() : enterAudition();
$('play').onclick = () => {
  if (!enterAudition()) return;
  if (state.playing) { pausePlayback(); paintCursor(); return; }
  if (state.issue || state.cursor >= state.plan.length - 1) stopPlayback();
  state.playing = true;
  advance();
};
$('step').onclick = () => {
  if (!enterAudition()) return;
  pausePlayback();
  advance();
};
$('back').onclick = () => {
  pausePlayback();
  state.issue = null;
  state.cursor--;
  paintCursor();
  playSound(state.plan[state.cursor].n);
};
$('stop').onclick = stopPlayback;
$('follow').onchange = () => paintCursor();
$('sound').onchange = () => { if (!$('sound').checked) silence(); };
window.addEventListener('pagehide', stopPlayback);
state.houses = fixture(state.variant);
makePlan();
render();
