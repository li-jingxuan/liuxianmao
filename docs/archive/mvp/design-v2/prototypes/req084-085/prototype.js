const byId = id => document.getElementById(id);
const context = byId('context');
const techniques = byId('techniques');
const direction = byId('direction');
const destinations = byId('destinations');
const techniqueButtons = [...techniques.querySelectorAll('[data-technique]')];
const copyModes = [...document.querySelectorAll('[data-mode]')];
const copyTrigger = byId('copy-trigger');
const shapes = [
  { chord: 'G', tab: ['3', '0', '0', '0', '2', '3'] },
  { chord: 'Em', tab: ['0', '0', '0', '2', '2', '0'] },
  { chord: 'C', tab: ['0', '1', '0', '2', '3', 'x'] },
  { chord: 'D', tab: ['2', '3', '2', '0', 'x', 'x'] },
  { chord: 'Am', tab: ['0', '1', '2', '2', '0', 'x'] },
];
const labels = {
  strum: { name: '扫弦', choices: [['向下', '↓'], ['向上', '↑']] },
  arpeggio: { name: '琶音', choices: [['上行', '∿'], ['下行', '﹏']] },
};
const undoStack = [];
let score = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, shape: shapes[i % shapes.length], techniques: {} }));
let nextId = score.length + 1;
let selected = { id: 3, beat: 1 };
let copyMode = new URLSearchParams(location.search).get('variant') === 'confirm' ? 'confirm' : 'direct';
let copyIndex = null;
let techniqueAnchor = null;
let directionAnchor = null;

const measureIndex = () => score.findIndex(measure => measure.id === selected.id);
const scope = () => `第 ${measureIndex() + 1} 小节第 ${selected.beat} 拍`;
const selectedBeat = () => document.querySelector('.beat.selected');

function renderScore() {
  const rows = [];
  for (let start = 0; start < score.length; start += 4) {
    const row = score.slice(start, start + 4).map((measure, index) => {
      const marker = start + index + 1;
      const beats = Array.from({ length: 4 }, (_, i) => {
        const beat = i + 1;
        const technique = measure.techniques[beat];
        const active = selected.id === measure.id && selected.beat === beat;
        const notes = measure.shape.tab.map(note => `<span>${note}</span>`).join('');
        return `<button type="button" class="beat${active ? ' selected' : ''}" data-id="${measure.id}" data-beat="${beat}" aria-label="第 ${marker} 小节第 ${beat} 拍" aria-pressed="${active}">${notes}${technique ? `<b aria-hidden="true">${technique.symbol}</b>` : ''}</button>`;
      }).join('');
      return `<div class="measure${measure.copied ? ' copied' : ''}"><span class="measure-no">${marker}</span><span class="chord">${measure.shape.chord}</span><div class="beats">${beats}</div></div>`;
    }).join('');
    rows.push(`<div class="score-row">${row}</div>`);
  }
  byId('score').innerHTML = rows.join('');
  byId('selection').textContent = `已选中 ${scope()} · 第 3–6 弦`;
  byId('undo').disabled = undoStack.length === 0;
}

function fit(panel, x, y) {
  const edge = 12;
  const left = Math.max(edge, Math.min(x, innerWidth - panel.offsetWidth - edge));
  const top = Math.max(edge, Math.min(y, innerHeight - panel.offsetHeight - 36));
  Object.assign(panel.style, { left: `${left}px`, top: `${top}px` });
  return { left, top };
}

function beside(panel, anchor, parent = anchor) {
  const rect = anchor.getBoundingClientRect();
  const bounds = parent.getBoundingClientRect();
  const leftSide = bounds.right + 8 + panel.offsetWidth > innerWidth - 12;
  const desiredTop = panel === techniques ? bounds.top + 44 : rect.top - 5;
  const { top } = fit(panel, leftSide ? bounds.left - panel.offsetWidth - 8 : bounds.right + 8, desiredTop);
  panel.dataset.side = leftSide ? 'left' : 'right';
  panel.style.setProperty('--arrow-y', `${Math.max(6, Math.min(rect.top + rect.height / 2 - top - 5, panel.offsetHeight - 16))}px`);
}

function vertically(panel, anchor) {
  const rect = anchor.getBoundingClientRect();
  const above = rect.bottom + 8 + panel.offsetHeight > innerHeight - 36;
  const { left } = fit(panel, rect.left, above ? rect.top - panel.offsetHeight - 8 : rect.bottom + 8);
  panel.dataset.side = above ? 'top' : 'bottom';
  panel.style.setProperty('--arrow-x', `${rect.left + rect.width / 2 - left - 5}px`);
}

function hideDirection(restore = false) {
  direction.hidden = true;
  directionAnchor?.setAttribute('aria-expanded', 'false');
  if (restore) directionAnchor?.focus({ preventScroll: true });
  directionAnchor = null;
}

function hideTechniques(restore = false) {
  hideDirection();
  techniques.hidden = true;
  techniqueAnchor?.setAttribute('aria-expanded', 'false');
  if (restore) techniqueAnchor?.focus({ preventScroll: true });
  techniqueAnchor = null;
}

function hideCopy(restore = false) {
  destinations.hidden = true;
  copyTrigger.setAttribute('aria-expanded', 'false');
  if (restore) copyTrigger.focus({ preventScroll: true });
}

function hideAll(restore = false) {
  hideTechniques();
  hideCopy();
  context.hidden = true;
  if (restore) selectedBeat()?.focus({ preventScroll: true });
}

function openContext(x, y) {
  hideAll();
  byId('context-scope').textContent = scope();
  byId('context-hint').textContent = '调整当前小节的小节线，或管理小节。';
  context.hidden = false;
  fit(context, x, y);
  byId('context-technique').focus({ preventScroll: true });
}

function updateTechniqueTiles() {
  const saved = score[measureIndex()].techniques[selected.beat];
  techniqueButtons.forEach(button => { button.dataset.applied = saved?.type === button.dataset.technique; });
}

function openTechniques(anchor) {
  if (techniqueAnchor === anchor) { hideTechniques(true); return; }
  hideTechniques();
  hideCopy();
  if (!context.contains(anchor)) context.hidden = true;
  techniqueAnchor = anchor;
  anchor.setAttribute('aria-expanded', 'true');
  techniques.hidden = false;
  if (context.contains(anchor)) {
    byId('context-hint').textContent = '查看当前选区可用的演奏技巧。';
    beside(techniques, anchor, context);
  } else vertically(techniques, anchor);
  updateTechniqueTiles();
  techniqueButtons[0].focus({ preventScroll: true });
}

function openDirection(anchor) {
  if (directionAnchor === anchor) { hideDirection(true); return; }
  hideDirection();
  directionAnchor = anchor;
  const type = anchor.dataset.technique;
  const { name, choices } = labels[type];
  const saved = score[measureIndex()].techniques[selected.beat];
  byId('direction-title').textContent = `${name}方向`;
  byId('direction-scope').textContent = `${scope()} · 第 3–6 弦`;
  byId('direction-choices').replaceChildren(...choices.map(([label, symbol]) => {
    const choice = document.createElement('button');
    choice.type = 'button';
    choice.className = 'direction-choice';
    choice.textContent = label;
    choice.setAttribute('aria-pressed', String(saved?.type === type && saved.label === label));
    choice.onclick = () => {
      if (saved?.type !== type || saved.label !== label) {
        undoStack.push(score);
        score = score.map(measure => measure.id === selected.id
          ? { ...measure, techniques: { ...measure.techniques, [selected.beat]: { type, label, symbol } } }
          : measure);
      }
      byId('result').textContent = `已应用${name} · ${label}`;
      renderScore();
      updateTechniqueTiles();
      hideDirection(true);
    };
    return choice;
  }));
  anchor.setAttribute('aria-expanded', 'true');
  direction.hidden = false;
  vertically(direction, anchor);
  (direction.querySelector('[aria-pressed="true"]') ?? direction.querySelector('button')).focus({ preventScroll: true });
}

function copyAt(index, targetLabel) {
  const sourceNumber = measureIndex() + 1;
  const copy = { ...score[sourceNumber - 1], id: nextId++, copied: true };
  undoStack.push(score);
  score = [...score.slice(0, index), copy, ...score.slice(index)];
  byId('result').textContent = `已将第 ${sourceNumber} 小节复制到${targetLabel} · 副本为第 ${index + 1} 小节`;
  renderScore();
  hideAll(true);
}

function openCopy() {
  if (!destinations.hidden) { hideCopy(true); return; }
  hideTechniques();
  byId('context-hint').textContent = '选择副本要插入的位置。';
  copyIndex = null;
  byId('copy-source').textContent = `来源 · 第 ${measureIndex() + 1} 小节`;
  const options = [['曲首', 0], ['曲末', score.length], ...score.map((_, i) => [`第 ${i + 1} 小节后`, i + 1])];
  const confirm = byId('confirm-copy');
  const list = byId('locations');
  const needsConfirm = copyMode === 'confirm';
  byId('copy-actions').hidden = !needsConfirm;
  confirm.disabled = true;
  list.replaceChildren(...options.map(([label, index]) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'location';
    option.textContent = label;
    if (needsConfirm) option.setAttribute('aria-pressed', 'false');
    option.onclick = () => {
      if (!needsConfirm) { copyAt(index, label); return; }
      copyIndex = { index, label };
      list.querySelector('[aria-pressed="true"]')?.setAttribute('aria-pressed', 'false');
      option.setAttribute('aria-pressed', 'true');
      confirm.disabled = false;
    };
    return option;
  }));
  copyTrigger.setAttribute('aria-expanded', 'true');
  destinations.hidden = false;
  beside(destinations, copyTrigger, context);
  list.scrollTop = 0;
  list.firstElementChild.focus({ preventScroll: true });
}

function selectBeat(beat) {
  selected = { id: Number(beat.dataset.id), beat: Number(beat.dataset.beat) };
  renderScore();
}

function demoContext() {
  selected = { id: score[2].id, beat: 1 };
  renderScore();
  const rect = selectedBeat().getBoundingClientRect();
  openContext(rect.left - 130, rect.bottom + 4);
}

for (const id of ['context-technique', 'toolbar-technique']) {
  byId(id).onclick = event => openTechniques(event.currentTarget);
}
techniqueButtons.forEach(button => { button.onclick = () => openDirection(button); });
byId('close-techniques').onclick = () => hideTechniques(true);
copyTrigger.onclick = openCopy;
byId('cancel-copy').onclick = () => hideCopy(true);
byId('confirm-copy').onclick = () => { if (copyIndex) copyAt(copyIndex.index, copyIndex.label); };
byId('undo').onclick = () => {
  score = undoStack.pop() ?? score;
  if (measureIndex() < 0) selected = { id: score[0].id, beat: 1 };
  byId('result').textContent = '已撤销';
  renderScore();
};
byId('demo-technique').onclick = () => {
  demoContext();
  openTechniques(byId('context-technique'));
  openDirection(techniqueButtons[0]);
};
copyModes.forEach(button => {
  button.setAttribute('aria-pressed', String(button.dataset.mode === copyMode));
  button.onclick = () => {
    copyMode = button.dataset.mode;
    copyModes.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    const url = new URL(location.href);
    url.searchParams.set('variant', copyMode);
    window.history.replaceState(null, '', url);
    demoContext();
    openCopy();
  };
});
byId('score').addEventListener('click', event => {
  const beat = event.target.closest('.beat');
  if (beat) { selectBeat(beat); selectedBeat().focus({ preventScroll: true }); }
});
byId('score').addEventListener('contextmenu', event => {
  const beat = event.target.closest('.beat');
  if (!beat) return;
  event.preventDefault();
  selectBeat(beat);
  openContext(event.clientX || selectedBeat().getBoundingClientRect().right, event.clientY || selectedBeat().getBoundingClientRect().bottom);
});
document.addEventListener('pointerdown', event => {
  const target = event.target;
  if (target.closest('.review, .toolbar, .overlay')) return;
  hideAll();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (!direction.hidden) hideDirection(true);
    else if (!destinations.hidden) hideCopy(true);
    else if (!techniques.hidden) hideTechniques(true);
    else if (!context.hidden) hideAll(true);
    else return;
    event.preventDefault();
  }
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && event.target.closest('#locations')) {
    const options = [...byId('locations').children];
    const current = options.indexOf(event.target);
    const index = { ArrowDown: current + 1, ArrowUp: current - 1, Home: 0, End: options.length - 1 }[event.key];
    options[Math.max(0, Math.min(index, options.length - 1))].focus();
    event.preventDefault();
  }
});
window.addEventListener('resize', () => hideAll());
renderScore();
