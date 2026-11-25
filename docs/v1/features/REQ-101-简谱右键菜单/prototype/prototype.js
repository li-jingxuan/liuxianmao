const byId = (id) => document.getElementById(id);
const score = byId('score');
const context = byId('context');
const menu = byId('menu');
const dialog = byId('confirmation');
const tool = byId('tool');
const toolBody = byId('tool-body');
const notes = [];
const tabs = [];
const lyrics = { 12: '风', 13: '过', 14: '原', 15: '野' };
const scores = ['5', '6', '7', '1', '2', '3', '5', '0', '', '', '6', '6', '3', '2', '1', '2', '3', '4', '5', '2', '1', '2', '-', '1'];
const chords = ['C', 'G', 'Am', 'F', 'Dm', 'C'];
const frets = [[3, 0, 2, 0], [3, 0, 0, 3], [0, 1, 2, 0], [1, 1, 2, 3], [0, 1, 3, 2], [3, 2, 0, 1]];
const stringRows = [4, 2, 3, 1];
const measure = (index) => Math.floor(index / 4);
const beat = (index) => index % 4 + 1;
const position = (index) => `第 ${measure(index) + 1} 小节 · 第 ${beat(index)} 拍`;
const within = (index, { from, to }) => index >= from && index <= to;
const span = (from, to) => ({ from: Math.min(from, to), to: Math.max(from, to) });
const rangeLabel = ({ from, to }) => {
  if (from === to) return position(from);
  if (measure(from) === measure(to)) return `第 ${measure(from) + 1} 小节 · 第 ${beat(from)}–${beat(to)} 拍`;
  return `${position(from)} ～ ${position(to)}`;
};

let content;
let groups;
let marks;
let rhythms;
let anchor;
let focus;
let clipboard;
let layer;
let scene;
let drag = null;
let suppressClick = false;
let confirmAction = null;
const history = [];
const announce = (message = '') => { byId('status').textContent = message; };
const focusScore = () => (layer === 'tab' ? tabs : notes)[focus]?.focus({ preventScroll: true });

function buildScore() {
  for (let system = 0; system < 2; system++) {
    const line = document.createElement('div');
    line.className = 'system';
    line.innerHTML = '<div class="legend" aria-hidden="true"><b></b><b>TAB</b><span>简谱</span></div>';
    for (let column = 0; column < 3; column++) {
      const bar = system * 3 + column;
      const section = document.createElement('div');
      section.className = 'measure';
      section.innerHTML = `<span class="bar-number">${bar + 1}</span><span class="chord">${chords[bar]}</span>
        <div class="staff"></div><div class="numbered-row"></div><div class="lyric-row"></div>`;
      for (let at = 0; at < 4; at++) {
        const index = bar * 4 + at;
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'tab-slot';
        tab.dataset.tab = index;
        tab.tabIndex = -1;
        tab.setAttribute('aria-label', `TAB ${position(index)}`);
        tab.innerHTML = `<span style="--string:${stringRows[at]}">${frets[bar][at]}</span>`;
        section.querySelector('.staff').append(tab);
        tabs.push(tab);

        const note = document.createElement('button');
        note.type = 'button';
        note.className = 'note';
        note.dataset.note = index;
        section.querySelector('.numbered-row').append(note);
        notes.push(note);

        const lyric = document.createElement('span');
        lyric.textContent = lyrics[index] ?? '';
        section.querySelector('.lyric-row').append(lyric);
      }
      line.append(section);
    }
    score.append(line);
  }
}

function render() {
  const range = span(anchor, focus);
  for (const [index, note] of notes.entries()) {
    const value = content[index];
    const selected = layer === 'numbered' && within(index, range);
    note.innerHTML = value || '<span class="gap" aria-hidden="true">·</span>';
    note.classList.toggle('start', selected && (index === range.from || beat(index) === 1));
    note.classList.toggle('end', selected && (index === range.to || beat(index) === 4));
    note.classList.toggle('focused', selected && index === focus);
    note.dataset.rhythm = rhythms[index] ?? '';
    note.setAttribute('aria-pressed', selected);
    note.setAttribute('aria-label', `${position(index)}，${value === '0' ? '休止' : value === '-' ? '延音' : value || '空位'}`);
    note.tabIndex = layer === 'numbered' && index === focus ? 0 : -1;
    tabs[index].setAttribute('aria-pressed', layer === 'tab' && index === focus);
    tabs[index].tabIndex = layer === 'tab' && index === focus ? 0 : -1;
  }
  score.querySelectorAll('.arc, .group').forEach((element) => element.remove());
  for (const { from, to, kind } of marks) {
    for (let bar = measure(from); bar <= measure(to); bar++) {
      const symbol = document.createElement('span');
      symbol.className = 'arc';
      symbol.dataset.kind = kind;
      symbol.setAttribute('aria-hidden', 'true');
      symbol.style.left = `${bar === measure(from) ? (beat(from) - 0.5) * 25 : 0}%`;
      symbol.style.right = `${bar === measure(to) ? (4.5 - beat(to)) * 25 : 0}%`;
      notes[bar * 4].parentElement.append(symbol);
    }
  }
  for (const { from, to, ratio } of groups) {
    const symbol = document.createElement('span');
    symbol.className = 'group';
    symbol.setAttribute('aria-hidden', 'true');
    symbol.style.left = `${(beat(from) - (from === to ? 0.85 : 0.5)) * 25}%`;
    symbol.style.right = `${((from === to ? 4.15 : 4.5) - beat(to)) * 25}%`;
    symbol.innerHTML = `<span>${ratio.split(':')[0]}</span>`;
    notes[from].parentElement.append(symbol);
  }
  byId('selection-title').textContent = layer === 'tab' ? '当前六线谱拍点' : '当前简谱选区';
  byId('selection').textContent = rangeLabel(range);
  byId('values').textContent = layer === 'tab' ? '' : content.slice(range.from, range.to + 1).map((note) => note || '空位').join('　');
  byId('clipboard').textContent = clipboard ? `${clipboard.values.length} 个位置　${clipboard.values.map((note) => note || '空位').join('　')}` : '尚未复制';
  byId('undo').disabled = !history.length;
  document.querySelectorAll('[data-scene]').forEach((button) => button.setAttribute('aria-pressed', button.dataset.scene === scene));
}

function select(index, { extend = false, preserve = false, nextLayer = 'numbered' } = {}) {
  if (preserve && nextLayer === layer && within(index, span(anchor, focus))) return;
  if (!extend || nextLayer !== layer) anchor = index;
  focus = index;
  layer = nextLayer;
  render();
}

const intersects = (left, right) => left.from <= right.to && right.from <= left.to;
const fullyInside = (item, range) => within(item.from, range) && within(item.to, range);
const partialGroup = (range) => groups.some((group) => intersects(group, range) && !fullyInside(group, range));
const hasContent = ({ from, to }) => content.slice(from, to + 1).some(Boolean);

function getOptions(range) {
  const copyReason = measure(range.from) !== measure(range.to) ? '首版支持复制同一小节内的简谱。'
    : partialGroup(range) ? '请选中完整的简谱连音组。'
    : !hasContent(range) ? '所选范围没有可复制的简谱内容。' : '';
  const destination = clipboard ? { from: range.from, to: range.from + clipboard.values.length - 1 } : null;
  const pasteReason = !destination ? '先复制一段简谱。'
    : measure(destination.from) !== measure(destination.to) ? '剪贴板内容超出当前小节，请选择更靠前的拍位。'
    : range.from !== range.to && destination.to > range.to ? '剪贴板内容比当前选区长，请扩大选区或选择一个拍位。'
    : partialGroup(destination) ? '粘贴会切断简谱连音组，请选择其他落点。'
    : Object.keys(lyrics).some((index) => within(Number(index), destination)) ? '写入范围含有关联歌词，请选择其他简谱位置。' : '';
  const clearReason = !hasContent(range) ? '所选范围已经是空位。' : '';
  return { copyReason, pasteReason, clearReason, destination };
}

function copy(range) {
  const offset = (item) => ({ ...item, from: item.from - range.from, to: item.to - range.from });
  clipboard = {
    values: content.slice(range.from, range.to + 1),
    rhythms: Array.from({ length: range.to - range.from + 1 }, (_, index) => rhythms[range.from + index]),
    groups: groups.filter((item) => fullyInside(item, range)).map(offset),
    marks: marks.filter((item) => fullyInside(item, range)).map(offset),
  };
  const omitted = marks.filter((item) => intersects(item, range) && !fullyInside(item, range)).length;
  render();
  announce(omitted ? `已复制简谱，已略过 ${omitted} 个端点在选区外的记号。` : '已复制简谱。');
}

function change(values, nextGroups, nextMarks, message, nextRhythms = rhythms) {
  history.push({ content, groups, marks, rhythms });
  content = values;
  groups = nextGroups;
  marks = nextMarks;
  rhythms = nextRhythms;
  render();
  announce(message);
  focusScore();
}

function requestConfirmation(title, text, actionLabel, action, onCancel = focusScore) {
  byId('confirm-title').textContent = title;
  byId('confirm-copy').textContent = text;
  byId('confirm').textContent = actionLabel;
  confirmAction = { action, onCancel };
  dialog.showModal();
  byId('cancel').focus();
}

function finishConfirmation(accepted) {
  const pending = confirmAction;
  confirmAction = null;
  dialog.close();
  if (accepted) pending?.action();
  else pending?.onCancel();
}

function paste(target) {
  const apply = () => {
    const values = [...content];
    values.splice(target.from, clipboard.values.length, ...clipboard.values);
    const offset = (item) => ({ ...item, from: item.from + target.from, to: item.to + target.from });
    const nextRhythms = { ...rhythms };
    clipboard.rhythms.forEach((value, index) => { nextRhythms[target.from + index] = value; });
    change(values, [...groups.filter((item) => !intersects(item, target)), ...clipboard.groups.map(offset)],
      [...marks.filter((item) => !intersects(item, target)), ...clipboard.marks.map(offset)], '已粘贴简谱。', nextRhythms);
  };
  if (!hasContent(target)) {
    apply();
    return;
  }
  const removed = marks.filter((item) => intersects(item, target)).length;
  requestConfirmation('覆盖已有简谱？', `${rangeLabel(target)}已有简谱内容。${removed ? `覆盖会同时移除 ${removed} 个连接记号。` : ''}提交后可撤销。`, '覆盖并粘贴', apply);
}

function replaceContents(range, tokens) {
  const affected = new Set(tokens.flatMap((token, index) => token !== content[range.from + index] ? [range.from + index] : []));
  if (!affected.size) {
    focusScore();
    return;
  }
  const touchesMark = ({ from, to }) => affected.has(from) || affected.has(to);
  const removed = marks.filter(touchesMark).length;
  const apply = () => {
    const values = [...content];
    values.splice(range.from, tokens.length, ...tokens);
    change(values, groups, marks.filter((item) => !touchesMark(item)), '已清空简谱内容。');
  };
  if (removed) {
    requestConfirmation('简谱连接记号影响确认', `${rangeLabel(range)}的修改会移除 ${removed} 个连接记号。取消可保留现有内容和选区。`,
      '清空内容', apply);
  } else apply();
}

function fitOverlay(node, x, y) {
  const margin = 8;
  const left = Math.max(margin, Math.min(x, window.innerWidth - node.offsetWidth - margin));
  const top = Math.max(margin, y + node.offsetHeight + margin <= window.innerHeight ? y : y - node.offsetHeight - 12);
  Object.assign(node.style, { left: `${left}px`, top: `${top}px` });
}

function closeTool(restore = false) {
  if (tool.hidden) return;
  tool.hidden = true;
  toolBody.replaceChildren();
  if (restore) focusScore();
}

function toolButton(label, action, { reason, primary, pressed } = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  if (reason) {
    button.disabled = true;
    button.setAttribute('aria-description', reason);
  }
  if (primary) button.classList.add('primary');
  if (pressed !== undefined) button.setAttribute('aria-pressed', pressed);
  button.onclick = action;
  return button;
}

const rhythmPatterns = [
  { id: 'quarter', name: '四分音符', symbol: '♩' },
  { id: 'eighths', name: '两个八分', symbol: '♫' },
  { id: 'eight-sixteen', name: '前八后十六', symbol: '♪ ♬' },
  { id: 'sixteenths', name: '四个十六分', symbol: '♬ ♬' },
];

function rhythmTool(range) {
  const choices = document.createElement('div');
  choices.className = 'tool-grid';
  const preview = document.createElement('output');
  preview.className = 'tool-preview';
  const blocked = groups.some((group) => intersects(group, range));
  let selected = rhythmPatterns.find((pattern) => pattern.id === rhythms[range.from]) ?? rhythmPatterns[0];
  const apply = toolButton('应用节奏型', () => {
    const nextRhythms = { ...rhythms };
    for (let index = range.from; index <= range.to; index++) nextRhythms[index] = selected.id;
    closeTool();
    change(content, groups, marks, `已应用节奏型「${selected.name}」。`, nextRhythms);
  }, { primary: true, reason: blocked ? '请先移除该位置的连音组。' : '' });
  const update = () => {
    [...choices.children].forEach((button, index) => button.setAttribute('aria-pressed', rhythmPatterns[index] === selected));
    preview.textContent = blocked ? '选区包含连音组，请先移除连音组。' : `预览　${selected.symbol}　${selected.name}`;
  };
  for (const pattern of rhythmPatterns) {
    const button = toolButton(pattern.name, () => { selected = pattern; update(); });
    const symbol = document.createElement('span');
    symbol.textContent = pattern.symbol;
    symbol.setAttribute('aria-hidden', 'true');
    button.prepend(symbol);
    choices.append(button);
  }
  toolBody.append(choices, preview, apply);
  update();
}

function arcTool(range) {
  const chosen = content.slice(range.from, range.to + 1);
  const singleNotes = chosen.length > 1 && chosen.every((value) => /^[1-7]$/.test(value));
  const options = [
    { kind: 'tie', name: '延音线', valid: singleNotes && chosen.length === 2 && chosen[0] === chosen[1], reason: '请选择两个相邻同音。' },
    { kind: 'slur', name: '圆滑线', valid: singleNotes, reason: '请选择至少两个连续简谱单音。' },
  ];
  for (const { kind, name, valid, reason } of options) {
    const existing = marks.find((mark) => mark.kind === kind && mark.from === range.from && mark.to === range.to);
    toolBody.append(toolButton(existing ? `移除${name}` : name, () => {
      const nextMarks = existing ? marks.filter((mark) => mark !== existing) : [...marks, { ...range, kind }];
      closeTool();
      change(content, groups, nextMarks, `已${existing ? '移除' : '添加'}${name}。`);
    }, { reason: existing || valid ? '' : reason }));
  }
  if (!toolBody.querySelector('button:not(:disabled)')) {
    const message = document.createElement('p');
    message.textContent = '请选择至少两个连续简谱单音。';
    toolBody.append(message);
  }
}

function tupletTool(range, touchPosition) {
  const count = range.to - range.from + 1;
  const overlaps = groups.find((group) => intersects(group, range));
  const current = groups.find((group) => group.from === range.from && group.to === range.to || count === 1 && within(range.from, group));
  const valid = !overlaps && measure(range.from) === measure(range.to) && content.slice(range.from, range.to + 1).every((value) => /^[1-7]$/.test(value));
  const grid = document.createElement('div');
  grid.className = 'tool-grid ratios';
  for (const [name, ratio] of [['二连音', '2:3'], ['三连音', '3:2'], ['四连音', '4:3'], ['五连音', '5:4'], ['五连音', '5:3'], ['六连音', '6:4']]) {
    const reason = !valid || Number(ratio[0]) !== count ? '请选择对应数量的连续简谱音符。' : '';
    grid.append(toolButton(`${name}（${ratio}）`, () => {
      closeTool();
      change(content, [...groups, { ...range, ratio }], marks, `已设置${name}。`);
    }, { reason, pressed: current?.ratio === ratio }));
  }
  toolBody.append(grid);
  if (current) {
    toolBody.append(toolButton('删除连音组', () => {
      closeTool();
      change(content, groups.filter((group) => group !== current), marks, '已删除连音组。');
    }));
  } else if (valid && count === 1 && ['eighths', 'eight-sixteen'].includes(rhythms[range.from])) {
    const showPreview = () => {
      const preview = document.createElement('output');
      preview.className = 'tool-preview';
      preview.textContent = `三连音预览　${content[range.from]}　·　·`;
      const apply = toolButton('应用', () => {
        closeTool();
        change(content, [...groups, { ...range, ratio: '3:2' }], marks, '已创建拍内三连音。');
      }, { primary: true });
      toolBody.replaceChildren(preview, apply, toolButton('返回', () => {
        toolBody.replaceChildren();
        tupletTool(range, touchPosition);
        touchPosition();
        byId('create-in-beat').focus();
      }));
      touchPosition();
      apply.focus();
    };
    const create = toolButton('在本拍创建三连音', showPreview);
    create.id = 'create-in-beat';
    toolBody.append(create);
  } else if (!grid.querySelector('button:not(:disabled)')) {
    const message = document.createElement('p');
    message.textContent = overlaps ? '请选择完整连音组，或点选其中一个音符。' : '请选择时值相同的连续简谱音符。';
    toolBody.append(message);
  }
}

function openTool(name, renderTool, range, rect) {
  byId('tool-title').textContent = name;
  byId('tool-scope').textContent = rangeLabel(range);
  tool.hidden = false;
  const positionTool = () => {
    const x = rect.right + 6 + tool.offsetWidth <= window.innerWidth - 8 ? rect.right + 6 : rect.left - tool.offsetWidth - 6;
    fitOverlay(tool, x, rect.top);
  };
  renderTool(range, positionTool);
  positionTool();
  (toolBody.querySelector('button:not(:disabled)') ?? byId('close-tool')).focus({ preventScroll: true });
}

const menuIcons = {
  rhythm: '<path d="M7 14V5l9-2v9M7 8l9-2"/><ellipse cx="5" cy="14.5" rx="2" ry="1.5"/><ellipse cx="14" cy="12.5" rx="2" ry="1.5"/>',
  arc: '<path d="M3 12c3-7 11-7 14 0"/>',
  tuplet: '<path d="M3 12V8h4m6 0h4v4M9 7h2l-1.5 2H11v3H9"/>',
  copy: '<rect x="6" y="6" width="10" height="11" rx="2"/><path d="M12 6V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h1"/>',
  paste: '<path d="M7 5H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M7 11h6m-6 3h4"/><rect x="7" y="3" width="6" height="4" rx="1"/>',
  clear: '<path d="M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11M9 9v5m2-5v5"/>',
};

function openMenu(x, y, restoreFocus = true) {
  closeTool();
  const range = span(anchor, focus);
  const { copyReason, pasteReason, clearReason, destination } = getOptions(range);
  const isNumbered = layer === 'numbered';
  const entries = isNumbered ? [
    { label: '节奏型', icon: 'rhythm', tool: rhythmTool },
    { label: '圆弧/连音线', icon: 'arc', tool: arcTool },
    { label: '连音设置', icon: 'tuplet', tool: tupletTool },
    { label: '复制简谱', icon: 'copy', reason: copyReason, run: () => { copy(range); focusScore(); } },
    { label: '粘贴简谱…', icon: 'paste', reason: pasteReason, run: () => paste(destination) },
    { label: '清空简谱内容', icon: 'clear', reason: clearReason, run: () => replaceContents(range, Array(range.to - range.from + 1).fill('')) },
  ] : ['小节工具', '节奏型', '技巧', '添加和弦', '复制当前小节'].map((label) => ({ label, reason: '六线谱菜单沿用现有交互。' }));
  byId('menu-title').textContent = isNumbered ? '简谱工具' : '谱面工具';
  byId('menu-scope').textContent = rangeLabel(range);
  context.hidden = false;
  menu.replaceChildren();
  for (const entry of entries) {
    if (entry.icon === 'copy' || entry.icon === 'clear') {
      const separator = document.createElement('div');
      separator.setAttribute('role', 'separator');
      menu.append(separator);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.tabIndex = -1;
    button.setAttribute('role', 'menuitem');
    button.setAttribute('aria-disabled', Boolean(entry.reason));
    if (entry.reason) button.setAttribute('aria-description', entry.reason);
    if (entry.tool) button.setAttribute('aria-haspopup', 'dialog');
    if (entry.icon === 'clear') button.classList.add('danger');
    button.innerHTML = `<span class="action-icon" aria-hidden="true">${entry.icon ? `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${menuIcons[entry.icon]}</svg>` : ''}</span>${entry.label}${entry.tool ? '<span class="menu-arrow" aria-hidden="true">›</span>' : ''}`;
    button.onclick = () => {
      if (entry.reason) return;
      const rect = context.getBoundingClientRect();
      closeMenu();
      if (entry.tool) openTool(entry.label, entry.tool, range, rect);
      else entry.run();
    };
    menu.append(button);
  }
  fitOverlay(context, x, y);
  if (restoreFocus) menu.querySelector('button').focus({ preventScroll: true });
}

function openAtSelection(takeFocus = true) {
  const rect = (layer === 'tab' ? tabs : notes)[focus].getBoundingClientRect();
  openMenu(rect.right + 6, rect.bottom + 3, takeFocus);
}

function closeMenu(restore = false) {
  if (context.hidden) return;
  context.hidden = true;
  if (restore) focusScore();
}

function reset(nextScene = 'default', takeFocus = true) {
  closeTool();
  closeMenu();
  scene = nextScene;
  content = [...scores];
  groups = [{ from: 16, to: 18, ratio: '3:2' }];
  marks = [{ from: 1, to: 2, kind: 'slur' }];
  rhythms = {};
  clipboard = nextScene === 'paste' ? { values: ['2', '3'], rhythms: [undefined, undefined], groups: [], marks: [] } : null;
  layer = 'numbered';
  [anchor, focus] = { default: [0, 1], cross: [2, 5], paste: [8, 8], group: [16, 17] }[scene];
  history.length = 0;
  byId('canvas').scrollTop = 0;
  announce();
  render();
  openAtSelection(takeFocus);
}

function undo() {
  const previous = history.at(-1);
  if (!previous || dialog.open) return;
  closeTool();
  history.pop();
  ({ content, groups, marks, rhythms } = previous);
  render();
  announce('已撤销一次简谱修改。');
  focusScore();
}

const hit = (element) => {
  const slot = element?.closest('[data-note], [data-tab]');
  if (!slot) return null;
  return { index: Number(slot.dataset.note ?? slot.dataset.tab), nextLayer: slot.dataset.note === undefined ? 'tab' : 'numbered' };
};

score.addEventListener('contextmenu', (event) => {
  const target = hit(event.target);
  if (!target) return;
  event.preventDefault();
  if (dialog.open) return;
  select(target.index, { ...target, preserve: true });
  openMenu(event.clientX + 8, event.clientY + 8);
});
context.addEventListener('contextmenu', (event) => event.preventDefault());

score.addEventListener('pointerdown', (event) => {
  suppressClick = false;
  const target = hit(event.target);
  if (event.button !== 0 || target?.nextLayer !== 'numbered' || dialog.open) return;
  drag = { pointerId: event.pointerId, start: event.shiftKey && layer === 'numbered' ? anchor : target.index, index: target.index, moved: false };
});
document.addEventListener('pointermove', (event) => {
  if (drag?.pointerId !== event.pointerId || !(event.buttons & 1)) return;
  const target = hit(document.elementFromPoint(event.clientX, event.clientY));
  if (target?.nextLayer !== 'numbered' || (!drag.moved && target.index === drag.index)) return;
  drag.moved = true;
  anchor = drag.start;
  focus = target.index;
  layer = 'numbered';
  render();
});
document.addEventListener('pointerup', (event) => {
  if (drag?.pointerId !== event.pointerId) return;
  suppressClick = drag.moved;
  if (drag.moved) focusScore();
  drag = null;
});
document.addEventListener('pointercancel', () => { drag = null; });
score.addEventListener('click', (event) => {
  if (suppressClick) { suppressClick = false; return; }
  const target = hit(event.target);
  if (!target) return;
  select(target.index, { ...target, extend: event.shiftKey });
  focusScore();
});

score.addEventListener('keydown', (event) => {
  const target = hit(event.target);
  if (!target || event.isComposing || dialog.open) return;
  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
    event.preventDefault();
    select(target.index, { ...target, preserve: true });
    openAtSelection();
  } else if (target.nextLayer === 'numbered' && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault();
    const index = Math.max(0, Math.min(notes.length - 1, focus + (event.key === 'ArrowLeft' ? -1 : 1)));
    select(index, { extend: event.shiftKey });
    focusScore();
  }
});
menu.addEventListener('keydown', (event) => {
  const items = [...menu.querySelectorAll('button')];
  const index = items.indexOf(event.target);
  if (index === -1) return;
  const movement = { ArrowDown: (index + 1) % items.length, ArrowUp: (index + items.length - 1) % items.length, Home: 0, End: items.length - 1 };
  if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); }
  else if (event.key === 'Tab') closeMenu(true);
  else if (event.key === 'ArrowRight' && event.target.hasAttribute('aria-haspopup')) {
    event.preventDefault();
    event.target.click();
  }
  else if (Object.hasOwn(movement, event.key)) {
    event.preventDefault();
    items[movement[event.key]].focus({ preventScroll: true });
  }
});

document.addEventListener('pointerdown', (event) => {
  if (!context.contains(event.target)) closeMenu();
  if (!tool.contains(event.target)) closeTool();
});
const dismissOverlays = () => {
  closeMenu(context.contains(document.activeElement));
  closeTool(tool.contains(document.activeElement));
};
byId('canvas').addEventListener('scroll', dismissOverlays);
window.addEventListener('resize', dismissOverlays);
tool.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  closeTool(true);
});
byId('close-tool').onclick = () => closeTool(true);
dialog.addEventListener('cancel', (event) => { event.preventDefault(); finishConfirmation(false); });
byId('cancel').onclick = () => finishConfirmation(false);
byId('confirm').onclick = () => finishConfirmation(true);
byId('undo').onclick = undo;
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z' && !event.target.closest('input')) {
    event.preventDefault();
    closeMenu();
    undo();
  }
});
document.querySelectorAll('[data-scene]').forEach((button) => { button.onclick = () => reset(button.dataset.scene); });
byId('reset').onclick = () => reset();

buildScore();
reset('default', false);
