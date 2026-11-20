const byId = (id) => document.getElementById(id);
const all = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const press = (attribute, value) => all(`[data-${attribute}]`).forEach((button) => {
  button.setAttribute('aria-pressed', String(button.dataset[attribute] === value));
});

const chordNames = ['G', 'C', 'Em', 'G', 'Am', 'D', 'G', 'Gadd9', 'Am', 'Gadd9', 'Asus2', 'Dadd9'];
const frets = [3, 2, 0, 2, 0, 3, 2, 0, 0, 1, 2, 3, 4, 0, 1, 0];
const initialMeasures = 12;
const onMac = /Mac|iPhone|iPad/.test(navigator.platform);
const dialog = byId('dialog');
const score = byId('score');
const textInput = byId('text-input');
const history = [];
const future = [];
const values = new Map();
let count = initialMeasures;
let current = { measure: 9, slot: 3, layer: 'numbered' };
let anchor = current;
let side = 'selection';
let detail = 'note';
let textMode = 'numbered';
let activeMenu = null;
let menuReturn = null;
let zoom = 100;
let pending = false;

const targetKey = ({ measure, slot }) => `${measure}-${slot}`;
const ordinal = ({ measure, slot }) => measure * 8 + slot;
const svgText = (x, y, content, className) => `<text x="${x}" y="${y}" class="${className}">${content}</text>`;
const line = (x1, y1, x2, y2, className = 'staff-line') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${className}"/>`;
const chars = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escapeText = (value) => String(value).replace(/[&<>"]/g, (char) => chars[char]);
const numberedValue = ({ measure, slot }) => measure < 5 ? '0' : String(1 + (slot + measure) % 5);

function chord(x, y, name, index) {
  const grid = Array.from({ length: 6 }, (_, i) => line(x + i * 5, y, x + i * 5, y + 20));
  const rows = Array.from({ length: 5 }, (_, i) => line(x, y + i * 5, x + 25, y + i * 5));
  const dots = [0, 1, 3].map((i) => `<circle cx="${x + ((i + index) % 6) * 5}" cy="${y + 2.5 + ((i + index) % 4) * 5}" r="2.25" fill="#282f3b"/>`);
  return `<g aria-hidden="true">${svgText(x + 12, y - 7, name, 'chord-name')}${grid.join('')}${rows.join('')}${dots.join('')}</g>`;
}

function measureMarkup(index) {
  const row = Math.floor(index / 5);
  const x = 16 + index % 5 * 148;
  const y = 58 + row * 141;
  const width = 148;
  const body = [];
  for (let string = 0; string < 6; string++) body.push(line(x, y + string * 7, x + width, y + string * 7));
  body.push(line(x, y, x, y + 35), line(x + width, y, x + width, y + 35));
  body.push(svgText(x + 3, y - 3, index + 1, 'bar-label'));
  if (index < initialMeasures) body.push(chord(x + 18, y - 39, chordNames[index], index));
  for (let slot = 0; slot < 8; slot++) {
    const bx = x + 13 + slot * 17;
    const target = { measure: index, slot };
    const tabY = y + ((slot + index) % 6) * 7;
    const numberedY = y + 65;
    const contents = values.get(targetKey(target));
    if (index < initialMeasures) {
      const fret = frets[(index * 3 + slot) % frets.length];
      body.push(line(bx + 6, tabY, bx + 6, y + 50), svgText(bx, tabY + 3.5, fret, 'note-mark'));
      if (slot % 2 === 0) body.push(line(bx + 6, y + 49, bx + 23, y + 49));
    }
    if (index < initialMeasures || contents?.numbered) {
      const digit = contents?.numbered ?? numberedValue(target);
      body.push(svgText(bx, numberedY, escapeText(digit), 'numbered-mark'));
      if (index >= 5 && slot % 4 !== 3) body.push(line(bx - 1, numberedY + 3, bx + 8, numberedY + 3));
    }
    if (contents?.lyrics) body.push(svgText(bx, numberedY + 18, escapeText(contents.lyrics), 'numbered-mark'));
    const start = Math.min(ordinal(anchor), ordinal(current));
    const end = Math.max(ordinal(anchor), ordinal(current));
    for (const layer of ['tab', 'numbered']) {
      const active = current.layer === layer && ordinal(target) >= start && ordinal(target) <= end;
      const focus = current.layer === layer && ordinal(target) === ordinal(current);
      const label = `第 ${index + 1} 小节 第 ${slot + 1} 个${layer === 'numbered' ? '简谱' : '六线谱'}位置`;
      body.push(`<g class="score-target" role="button" tabindex="${focus ? 0 : -1}" aria-label="${label}" aria-pressed="${active}" data-measure="${index}" data-slot="${slot}" data-layer="${layer}"><rect x="${bx - 5}" y="${layer === 'tab' ? y - 4 : numberedY - 15}" width="17" height="${layer === 'tab' ? 44 : 22}" rx="2"/></g>`);
    }
  }
  if (index === count - 1) {
    const edge = x + width;
    const extensions = Array.from({ length: 6 }, (_, i) => line(edge + 1, y + i * 7, edge + 30, y + i * 7, 'lines'));
    body.push(`<g class="tail" role="button" tabindex="0" aria-label="在曲末新增小节" data-command="append"><title>在曲末新增小节</title><rect class="hit" x="${edge + 1}" y="${y - 3}" width="34" height="41"/>${extensions.join('')}<rect class="outline" x="${edge + 2}" y="${y - 3}" width="32" height="41" rx="2"/><path class="plus" d="M${edge + 10} ${y + 17.5}h12m-6-6v12"/></g>`);
  }
  return body.join('');
}

function paintScore() {
  score.setAttribute('viewBox', `0 0 810 ${Math.ceil(count / 5) * 141 + 25}`);
  score.innerHTML = Array.from({ length: count }, (_, index) => measureMarkup(index)).join('');
}

function locationText(target) {
  const beat = Math.floor(target.slot / 2) + 1;
  return `第 ${target.measure + 1} 小节 · 第 ${beat} 拍${target.slot % 2 ? ' + 1/2' : ''}`;
}

function paintInspector() {
  const range = Math.abs(ordinal(current) - ordinal(anchor)) + 1;
  const isNumbered = current.layer === 'numbered';
  const isEmpty = current.measure >= initialMeasures;
  const kind = isNumbered ? (isEmpty ? '简谱录入位置' : '简谱音符') : '六线谱拍点';
  const where = locationText(current);
  const meta = isNumbered ? (range > 1 ? `${range} 个位置` : isEmpty ? '未录入' : '1 个成员 · 十六分音符') : `${range} 个拍点`;
  byId('location').innerHTML = `${kind}<small>${where}</small>`;
  byId('status-location').textContent = `${kind} · ${where}${range > 1 ? ` · 已选 ${range} 个位置` : ''}`;
  byId('numbered-summary').innerHTML = `<p class="muted">${meta}</p>${isNumbered ? '<div class="text-actions"><button class="text-action" data-command="edit-lyrics">编辑歌词 <span aria-hidden="true">→</span></button><button class="text-action" data-command="edit-numbered">编辑简谱 <span aria-hidden="true">→</span></button></div>' : ''}`;
  byId('measure-meter').textContent = `第 ${current.measure + 1} 小节 · 4/4`;
  byId('selection-panel').hidden = side !== 'selection';
  byId('text-panel').hidden = side !== 'text';
  byId('other-panel').hidden = !['chords', 'song'].includes(side);
  byId('other-title').textContent = side === 'chords' ? '和弦' : '歌曲';
  byId('other-help').textContent = side === 'chords' ? '在六线谱上选择一个拍点编辑和弦。' : '编辑曲名、署名与全曲拍号。';
  byId('note-panel').hidden = detail !== 'note';
  byId('measure-panel').hidden = detail !== 'measure';
  press('side', side);
  press('detail', detail);
  press('text', textMode);
}

function focusTarget() {
  score.querySelector(`[data-measure="${current.measure}"][data-slot="${current.slot}"][data-layer="${current.layer}"]`)?.focus();
}

function selectTarget(target, extend = false) {
  if (!extend || current.layer !== target.layer) anchor = target;
  current = target;
  paintScore();
  if (side === 'text') editText(textMode, false);
  else paintInspector();
  focusTarget();
}

function setSide(value) {
  side = value;
  paintInspector();
}

function editText(mode, focus = true) {
  textMode = mode;
  setSide('text');
  byId('text-label').textContent = mode === 'numbered' ? '简谱音高' : '歌词';
  textInput.value = values.get(targetKey(current))?.[mode] ?? (mode === 'numbered' && current.measure < initialMeasures ? numberedValue(current) : '');
  if (focus) textInput.focus();
}

function announce(message) {
  byId('message').textContent = message;
}

function paintHistory() {
  document.querySelector('.tools [data-command="undo"]').disabled = !history.length;
  document.querySelector('.tools [data-command="redo"]').disabled = !future.length;
  byId('file-status').toggleAttribute('data-pending', pending);
  byId('file-status').querySelector('span').textContent = pending ? '待导出 JSON' : '示例曲谱';
  for (const [command, enabled] of [['undo', history.length], ['redo', future.length]]) {
    document.querySelector(`.popup [data-command="${command}"]`).setAttribute('aria-disabled', String(!enabled));
  }
}

function snapshot() {
  return { count, current, anchor, pending, values: new Map(values) };
}

function remember() {
  history.push(snapshot());
  future.length = 0;
  pending = true;
}

function restore(from, to, message) {
  if (!from.length) return;
  to.push(snapshot());
  const state = from.pop();
  ({ count, current, anchor, pending } = state);
  values.clear();
  state.values.forEach((value, key) => values.set(key, value));
  paintScore();
  paintInspector();
  if (side === 'text') editText(textMode, false);
  paintHistory();
  announce(message);
}

const menus = [
  ['file', '文件', [['new', '新建曲谱…'], ['import', '导入曲谱…'], null, ['home', '返回首页']]],
  ['edit', '编辑', [['undo', '撤销', onMac ? '⌘ Z' : 'Ctrl Z'], ['redo', '重做', onMac ? '⇧ ⌘ Z' : 'Ctrl Shift Z']]],
  ['view', '视图', [['inspector', '隐藏侧栏'], ['zoom-in', '放大'], ['zoom-out', '缩小'], ['zoom-reset', '实际大小']]],
  ['help', '帮助', [['shortcuts', '快捷键…'], ['learn', '吉他进阶']]],
  ['export', '导出', [['json', 'JSON 曲谱…'], ['png', 'PNG 图片…'], null, ['print', '打印…']]],
];

for (const [key, label, items] of menus) {
  const menu = document.createElement('div');
  menu.className = 'menu-wrapper';
  menu.innerHTML = `<button class="menu-trigger" id="trigger-${key}" role="menuitem" aria-expanded="false" aria-haspopup="menu" aria-controls="menu-${key}" tabindex="${key === 'file' || key === 'export' ? 0 : -1}">${label}${key === 'export' ? ' <span aria-hidden="true">⌄</span>' : ''}</button><div class="popup" id="menu-${key}" role="menu" aria-labelledby="trigger-${key}" hidden>${items.map((item) => item ? `<button role="menuitem" tabindex="-1" data-command="${item[0]}"><span>${item[1]}</span>${item[2] ? `<kbd>${item[2]}</kbd>` : ''}</button>` : '<hr role="separator">').join('')}</div>`;
  byId(key === 'export' ? 'export-menu' : 'menubar').append(menu);
}

const menuItems = (trigger) => all('[role="menuitem"]', byId(trigger.getAttribute('aria-controls')));

function closeMenu(restoreFocus = false) {
  if (!activeMenu) return;
  activeMenu.setAttribute('aria-expanded', 'false');
  byId(activeMenu.getAttribute('aria-controls')).hidden = true;
  if (restoreFocus) activeMenu.focus();
  activeMenu = null;
}

function openMenu(trigger, edge = 0) {
  closeMenu();
  activeMenu = trigger;
  all('.menu-trigger', trigger.closest('.menubar')).forEach((item) => { item.tabIndex = item === trigger ? 0 : -1; });
  trigger.setAttribute('aria-expanded', 'true');
  byId(trigger.getAttribute('aria-controls')).hidden = false;
  menuItems(trigger).at(edge)?.focus();
}

function moveMenu(trigger, key, open) {
  const triggers = all('.menu-trigger', trigger.closest('.menubar'));
  const index = triggers.indexOf(trigger);
  const next = key === 'Home' ? triggers[0] : key === 'End' ? triggers.at(-1) : triggers[(index + (key === 'ArrowRight' ? 1 : -1) + triggers.length) % triggers.length];
  triggers.forEach((item) => { item.tabIndex = item === next ? 0 : -1; });
  if (open) openMenu(next);
  else next.focus();
}

function showDialog(title, copy) {
  menuReturn = document.activeElement;
  byId('dialog-title').textContent = title;
  byId('dialog-copy').textContent = copy;
  dialog.showModal();
}

dialog.addEventListener('close', () => menuReturn?.focus());

function command(action) {
  switch (action) {
    case 'append': {
      remember();
      const measure = count++;
      selectTarget({ measure, slot: 0, layer: 'tab' });
      paintHistory();
      announce(`已添加第 ${count} 小节`);
      break;
    }
    case 'undo': restore(history, future, '已撤销'); break;
    case 'redo': restore(future, history, '已重做'); break;
    case 'edit-lyrics': editText('lyrics'); break;
    case 'edit-numbered': editText('numbered'); break;
    case 'back-to-selection': setSide('selection'); byId('numbered-summary').querySelector(`[data-command="edit-${textMode}"]`)?.focus(); break;
    case 'inspector': {
      const inspector = byId('inspector');
      inspector.hidden = !inspector.hidden;
      byId('inspector-tool').setAttribute('aria-pressed', String(!inspector.hidden));
      document.querySelector('.popup [data-command="inspector"] span').textContent = inspector.hidden ? '显示侧栏' : '隐藏侧栏';
      break;
    }
    case 'zoom-in': case 'zoom-out': case 'zoom-reset':
      zoom = action === 'zoom-reset' ? 100 : Math.min(150, Math.max(75, zoom + (action === 'zoom-in' ? 25 : -25)));
      document.querySelector('.paper').style.zoom = `${zoom}%`;
      byId('zoom-value').value = `${zoom}%`;
      break;
    case 'shortcuts': showDialog('快捷键', '撤销　⌘ / Ctrl + Z\n重做　⌘ / Ctrl + Shift + Z\n扩选　Shift + 方向键\n菜单　方向键浏览，Esc 关闭'); break;
    case 'new': showDialog('新建曲谱', '进入现有新建曲谱流程。'); break;
    case 'import': showDialog('导入曲谱', '进入现有本地曲谱导入流程。'); break;
    case 'home': showDialog('返回首页', '有待处理的编辑时，沿用现有离开确认。'); break;
    case 'learn': showDialog('吉他进阶', '从编辑器前往吉他进阶。'); break;
    case 'json': showDialog('导出 JSON 曲谱', '进入现有 JSON 曲谱导出流程。'); break;
    case 'png': showDialog('导出 PNG 图片', '进入现有图片导出流程。'); break;
    case 'print': showDialog('打印', '打印预览中仅显示可打印曲谱。可用浏览器打印功能查看此原型。'); break;
    case 'copy-measures': showDialog('复制小节范围', `当前目标为第 ${current.measure + 1} 小节。`); break;
  }
}

const reviewHints = {
  selection: '选中单音或 Shift 扩选，查看右侧入口',
  tail: '在末小节右侧试点加号，也可用撤销回到原状态',
  header: '打开文件、编辑、视图、帮助或导出菜单',
};

function changeReview(value, focus = false) {
  const view = value in reviewHints ? value : 'selection';
  press('review', view);
  byId('review-hint').textContent = reviewHints[view];
  if (focus) location.replace(`#${view}`);
  if (view === 'selection') {
    if (byId('inspector').hidden) command('inspector');
    detail = 'note';
    side = 'selection';
    current = { measure: 9, slot: 3, layer: 'numbered' };
    anchor = current;
    paintScore();
    paintInspector();
    if (focus) byId('canvas').scrollIntoView({ block: 'nearest' });
  } else if (view === 'tail') {
    const tail = score.querySelector('.tail');
    if (focus) tail?.focus();
    tail?.scrollIntoView({ block: 'center' });
  } else if (focus) byId('menubar').querySelector('[tabindex="0"]').focus();
}

document.addEventListener('click', (event) => {
  const trigger = event.target.closest('.menu-trigger');
  if (trigger) {
    if (activeMenu === trigger) closeMenu(true);
    else openMenu(trigger);
    return;
  }
  const action = event.target.closest('[data-command]');
  if (action?.getAttribute('aria-disabled') === 'true') return;
  closeMenu(Boolean(action?.closest('.popup')));
  if (event.target.closest('.brand')) {
    event.preventDefault();
    command('home');
    return;
  }
  if (action) {
    command(action.dataset.command);
    return;
  }
  const review = event.target.closest('[data-review]');
  if (review) changeReview(review.dataset.review, true);
  const tab = event.target.closest('[data-side]');
  if (tab) tab.dataset.side === 'text' ? editText(textMode, false) : setSide(tab.dataset.side);
  const detailButton = event.target.closest('[data-detail]');
  if (detailButton) { detail = detailButton.dataset.detail; paintInspector(); }
  const textTab = event.target.closest('[data-text]');
  if (textTab) editText(textTab.dataset.text, false);
  const pattern = event.target.closest('.patterns button');
  if (pattern) all('.patterns button').forEach((button) => button.setAttribute('aria-pressed', String(button === pattern)));
  const target = event.target.closest('.score-target');
  if (target) selectTarget({ measure: +target.dataset.measure, slot: +target.dataset.slot, layer: target.dataset.layer }, event.shiftKey);
});

document.addEventListener('keydown', (event) => {
  if (event.isComposing) return;
  const modifier = onMac ? event.metaKey : event.ctrlKey;
  if (modifier && !event.altKey && event.key.toLowerCase() === 'z' && !dialog.open && !event.target.closest('input')) {
    event.preventDefault();
    if (!event.repeat) {
      const wasOnScore = Boolean(event.target.closest('#score'));
      command(event.shiftKey ? 'redo' : 'undo');
      if (wasOnScore) focusTarget();
    }
    return;
  }
  const trigger = event.target.closest('.menu-trigger');
  const item = event.target.closest('.popup [role="menuitem"]');
  if (trigger && ['ArrowRight', 'ArrowLeft', 'Home', 'End', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
    event.preventDefault();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') openMenu(trigger, event.key === 'ArrowUp' ? -1 : 0);
    else moveMenu(trigger, event.key, Boolean(activeMenu));
    return;
  }
  if (item && activeMenu) {
    if (event.key === 'Tab') { closeMenu(true); return; }
    if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); return; }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      moveMenu(activeMenu, event.key, true);
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const items = menuItems(activeMenu);
      const index = items.indexOf(item);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
      return;
    }
  }
  if (event.target.closest('.tail') && ['Enter', ' '].includes(event.key)) {
    event.preventDefault();
    if (!event.repeat) command('append');
    return;
  }
  if (event.target.closest('.score-target') && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault();
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      selectTarget({ ...current, layer: event.key === 'ArrowUp' ? 'tab' : 'numbered' });
    } else {
      const next = Math.max(0, Math.min(count * 8 - 1, ordinal(current) + (event.key === 'ArrowRight' ? 1 : -1)));
      selectTarget({ measure: Math.floor(next / 8), slot: next % 8, layer: current.layer }, event.shiftKey);
    }
  }
});

byId('text-form').addEventListener('submit', (event) => {
  event.preventDefault();
  remember();
  const key = targetKey(current);
  values.set(key, { ...values.get(key), [textMode]: textInput.value });
  paintScore();
  paintHistory();
  announce(textMode === 'numbered' ? '已应用简谱' : '已应用歌词');
});

paintScore();
paintInspector();
paintHistory();
changeReview(location.hash.slice(1));
