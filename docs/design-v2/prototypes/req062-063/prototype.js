const logo = '../../../../apps/website/public/assets/brand/liuxianmao-128.png';
document.querySelectorAll('[data-logo]').forEach((image) => { image.src = logo; });

const groups = [
  { title: '编辑历史', rows: [
    { id: 'undo', name: '撤销', keys: ['$mod + Z'], detail: '撤销谱面修改。文本框内保留原生撤销。' },
    { id: 'redo', name: '重做', mac: ['⌘ + Shift + Z'], pc: ['Ctrl + Shift + Z', 'Ctrl + Y'], detail: '重做谱面修改。' },
  ] },
  { title: '六线谱（TAB）', rows: [
    { id: 'tabMove', name: '移动选中格', keys: ['方向键'], alias: 'arrow ↑ ↓ ← →', detail: '焦点在六线谱上时生效。' },
    { id: 'tabSelect', name: '扩展六线谱选区', keys: ['Shift + 方向键'], alias: 'arrow ↑ ↓ ← →' },
    { id: 'fret', name: '输入品位', keys: ['0–9'], detail: '可录入 0–24 品。1、2 可在 600 ms 内接第二位。' },
    { id: 'mute', name: '输入 x 弹奏标记', keys: ['X'] },
    { id: 'sustain', name: '输入横线延音标记', keys: ['-'] },
    { id: 'rest', name: '设为休止', keys: ['R'], detail: '在六线谱选中拍点时，整拍设为休止。' },
    { id: 'unrest', name: '取消休止', keys: ['Shift + R'], detail: '取消后得到空拍，恢复原音符可使用撤销。' },
    { id: 'delete', name: '删除选中的音符或技巧', keys: ['Backspace', 'Delete'] },
    { id: 'tabEscape', name: '取消品位输入或收拢选区', keys: ['Esc'] },
  ] },
  { title: '歌词、简谱与和弦', rows: [
    { id: 'lyricNav', name: '前／后一个录入位置', keys: ['$alt + ←/→'], alias: 'arrow left right', detail: '在歌词或简谱单项编辑中移动。' },
    { id: 'textMove', name: '移动连续选区焦点', keys: ['←/→'], alias: 'arrow left right', detail: '在谱面上移动歌词或简谱范围。' },
    { id: 'textSelect', name: '扩展连续选区', keys: ['Shift + ←/→'], alias: 'arrow left right', detail: '在谱面上扩展歌词或简谱范围。' },
    { id: 'textDelete', name: '清除连续选区内容', keys: ['Backspace', 'Delete'], detail: '焦点在谱面上时生效。' },
    { id: 'textEscape', name: '收拢连续选区或退出单项编辑', keys: ['Esc'], detail: '作用取决于当前是谱面选区还是属性编辑。' },
    { id: 'lyricNewline', name: '歌词输入换行', keys: ['Enter'], detail: '空格或换行可分隔录入位置。' },
    { id: 'apply', name: '应用输入', keys: ['Enter'], detail: '在简谱、和弦和歌词／简谱范围的输入框生效。' },
    { id: 'applyModified', name: '应用当前属性编辑', keys: ['$mod + Enter'], detail: '适用于歌词、简谱和和弦。单项歌词应用后留在当前位置。' },
  ] },
  { title: '曲谱设置与技巧', rows: [
    { id: 'settings', name: '应用设置或技巧参数', keys: ['Enter'], detail: '在歌曲或小节设置输入框应用当前修改组，在技巧数字输入框提交参数。' },
  ] },
  { title: '自定义和弦指法', rows: [
    { id: 'gridMove', name: '移动指法网格焦点', keys: ['方向键'], alias: 'arrow ↑ ↓ ← →' },
    { id: 'gridApply', name: '操作当前网格', keys: ['Enter', 'Space'] },
    { id: 'finger', name: '设置手指、拇指或未指定', keys: ['1–4', 'T', '0'], detail: '先选中一个按点。' },
    { id: 'diagramUndo', name: '撤销指法修改', keys: ['$mod + Z'] },
    { id: 'diagramRedo', name: '重做指法修改', keys: ['$mod + Shift + Z', '$mod + Y'] },
    { id: 'diagramApply', name: '完成指法编辑', keys: ['Enter'], detail: '焦点在指法文本框时生效。' },
    { id: 'diagramExit', name: '关闭指法编辑', keys: ['Esc'], detail: '沿用指法草稿保护。' },
  ] },
];
const shortcuts = new Map(groups.flatMap(({ rows }) => rows.map((row) => [row.id, row])));
const dialog = document.querySelector('#shortcuts');
const search = document.querySelector('#search');
const platform = document.querySelector('#platform');
const results = document.querySelector('#shortcut-results');
const searchStatus = document.querySelector('#search-status');
const os = navigator.userAgentData?.platform ?? navigator.platform ?? '';
platform.value = /mac|iphone|ipad|ipod/i.test(os) ? 'mac' : 'pc';

function keysFor(row, osMode = platform.value) {
  const modifiers = osMode === 'mac' ? { $mod: '⌘', $alt: '⌥' } : { $mod: 'Ctrl', $alt: 'Alt' };
  return (row[osMode] ?? row.keys).map((combo) => combo.replace(/\$mod|\$alt/g, (token) => modifiers[token]));
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function keyCaps(row) {
  const keys = element('span', 'key-sequences');
  keysFor(row).forEach((sequence, index) => {
    if (index) keys.append(element('span', 'key-or', '/'));
    const combo = element('span', 'key-combo');
    combo.append(...sequence.split(' + ').map((key) => element('kbd', '', key)));
    keys.append(combo);
  });
  return keys;
}

function normalize(text) {
  return text.normalize('NFKC').toLowerCase()
    .replace(/⌘|\b(?:cmd|command)\b/g, ' command ')
    .replace(/⌥|\b(?:alt|option)\b/g, ' option ')
    .replace(/\b(?:control|ctrl)\b/g, ' ctrl ')
    .replace(/\bescape\b/g, ' esc ')
    .replace(/\breturn\b|回车/g, ' enter ')
    .replace(/[+＋]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function renderShortcuts() {
  const query = normalize(search.value).split(' ').filter(Boolean);
  let count = 0;
  results.replaceChildren();
  for (const group of groups) {
    const list = element('ul');
    for (const row of group.rows) {
      const keys = [...keysFor(row, 'mac'), ...keysFor(row, 'pc')];
      const haystack = normalize([group.title, row.name, row.detail, row.alias, ...keys].filter(Boolean).join(' '));
      const words = haystack.match(/[a-z0-9]+/g) ?? [];
      if (!query.every((token) => /^[a-z0-9]$/.test(token) ? words.includes(token) : haystack.includes(token))) continue;
      const item = element('li', 'shortcut-row');
      const text = element('div');
      text.append(element('b', '', row.name));
      if (row.detail) text.append(element('p', '', row.detail));
      item.append(text, keyCaps(row));
      list.append(item);
      count += 1;
    }
    if (list.childElementCount) {
      const section = element('section', 'shortcuts-group');
      section.append(element('h3', '', group.title), list);
      results.append(section);
    }
  }
  if (!count) {
    const empty = element('div', 'no-results');
    const reset = element('button', 'control', '清除搜索');
    reset.type = 'button';
    reset.addEventListener('click', () => {
      search.value = '';
      renderShortcuts();
      search.focus();
    });
    empty.append(element('p', '', '未找到匹配的快捷键'), reset);
    results.append(empty);
  }
  results.scrollTop = 0;
  searchStatus.textContent = `${count} 项快捷键`;
}

let dialogOpener;
document.querySelectorAll('#open-shortcuts, [data-open-shortcuts]').forEach((button) => {
  button.addEventListener('click', (event) => {
    hideTooltip();
    dialogOpener = button;
    search.value = '';
    renderShortcuts();
    dialog.showModal();
    dialog.dataset.narrow = String(document.querySelector('#preview').classList.contains('is-narrow'));
    if (event.detail !== 0 && matchMedia('(pointer: coarse)').matches) document.querySelector('#close-shortcuts').focus();
  });
});
document.querySelector('#close-shortcuts').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => {
  suppressTooltip = dialogOpener;
  dialogOpener?.focus({ preventScroll: true });
  hideTooltip();
});
dialog.addEventListener('keydown', (event) => {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    dialog.close();
  }
  if (event.key !== 'Tab') return;
  const controls = dialog.querySelectorAll('button, input, select, [tabindex="0"]');
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});
dialog.addEventListener('cancel', (event) => event.preventDefault());
search.addEventListener('input', renderShortcuts);
platform.addEventListener('change', renderShortcuts);

const screenButtons = Array.from(document.querySelectorAll('[data-screen]'));
function showScreen(screen, moveFocus = false) {
  const active = screenButtons.find((button) => button.dataset.screen === screen) ?? screenButtons[0];
  document.querySelectorAll('[data-scene]').forEach((scene) => { scene.hidden = scene.dataset.scene !== active.dataset.screen; });
  screenButtons.forEach((button) => button.setAttribute('aria-pressed', String(button === active)));
  hideTooltip();
  if (moveFocus) active.focus();
}
screenButtons.forEach((button) => button.addEventListener('click', () => showScreen(button.dataset.screen)));
document.querySelectorAll('[data-link]').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    showScreen(link.dataset.link, true);
  });
});
document.querySelector('#narrow').addEventListener('click', (event) => {
  const isNarrow = document.querySelector('#preview').classList.toggle('is-narrow');
  event.currentTarget.setAttribute('aria-pressed', String(isNarrow));
  hideTooltip();
});

const lessonPages = {
  学习路径: ['认识指板', '从六根空弦开始，熟悉指板上的音名与位置。'],
  课程模块: ['指板基础', '依次学习空弦音名、半音与音程。'],
  理论课程: ['标准调弦', '从第六弦到第一弦，依次是 E、A、D、G、B、E。'],
  练习中心: ['找到第六弦上的 G', '从空弦 E 出发，沿指板向上找到目标音。'],
  综合考试: ['基础能力测验', '检查你对指板、音程与和弦的掌握。'],
  考试作答: ['第 1 题', '标准调弦时，第六弦的空弦音是什么？'],
  考试成绩: ['基础能力测验', '在此回顾答案和需要复习的知识点。'],
  学习进度: ['本地学习记录', '查看已学课程、练习与考试。'],
};
const lessonButtons = Array.from(document.querySelectorAll('[data-lesson]'));
lessonButtons.forEach((button) => button.addEventListener('click', () => {
  const title = button.dataset.lesson;
  const [subtitle, description] = lessonPages[title];
  document.querySelector('#learning-title').textContent = title;
  document.querySelector('#learning-subtitle').textContent = subtitle;
  document.querySelector('#learning-description').textContent = description;
  lessonButtons.forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
}));

function scoreSample(container) {
  const chords = element('div', 'chords');
  chords.append(element('span', '', 'C'), element('span', '', 'G'));
  const staff = element('div', 'tab-staff');
  const pitches = [0, 3, 1, 0, 0, 2, 3, 0];
  const strings = [2, 4, 1, 3, 2, 4, 1, 3];
  pitches.forEach((pitch, index) => {
    const selected = index === 2 && container.dataset.score === 'editable';
    const note = element(selected ? 'button' : 'span', `tab-note${selected ? ' selected' : ''}`, pitch);
    note.style.setProperty('--fret-line', `${strings[index] * 12}px`);
    if (selected) {
      note.type = 'button';
      note.classList.add('hint-trigger');
      note.dataset.tooltip = 'fret';
      note.setAttribute('aria-label', '已选六线谱格，1 品');
    }
    staff.append(note);
  });
  const numbered = element('div', 'numbered-sample');
  const lyric = element('div', 'lyric-sample');
  ['1', '2', '3', '5', '6', '5', '3', '2'].forEach((value) => numbered.append(element('span', '', value)));
  Array.from('风吹过山谷听回响').forEach((value) => lyric.append(element('span', '', value)));
  container.append(chords, staff, numbered, lyric);
}
document.querySelectorAll('[data-score]').forEach(scoreSample);

const tooltip = document.querySelector('#tooltip');
let tooltipTrigger;
let suppressTooltip;
let tooltipTimer;
let hideTimer;

function hideTooltip() {
  clearTimeout(tooltipTimer);
  clearTimeout(hideTimer);
  tooltipTrigger?.removeAttribute('aria-describedby');
  tooltipTrigger = undefined;
  tooltip.hidden = true;
}

function showTooltip(trigger) {
  hideTooltip();
  if (dialog.open || suppressTooltip === trigger) return;
  const id = trigger.dataset.tooltip;
  const descriptions = {
    help: [], undo: [['撤销', 'undo']], redo: [['重做', 'redo']],
    rest: [['设为休止', 'rest'], ['取消休止', 'unrest']],
    delete: [['删除所选内容', 'delete']], fret: [['输入品位', 'fret'], ['弹奏标记', 'mute'], ['横线延音', 'sustain']],
    lyricNav: [['移动录入位置', 'lyricNav'], ['歌词输入换行', 'lyricNewline']], apply: [['应用歌词', 'applyModified']],
  };
  const notes = { help: '快捷键', redo: '没有可重做的修改。', rest: '取消休止后得到空拍。' };
  tooltip.replaceChildren();
  descriptions[id].forEach(([label, shortcut]) => {
    const row = element('div', 'tooltip-row');
    row.append(element('span', '', label), keyCaps(shortcuts.get(shortcut)));
    tooltip.append(row);
  });
  if (notes[id]) tooltip.append(element('p', '', notes[id]));
  tooltip.hidden = false;
  tooltipTrigger = trigger;
  trigger.setAttribute('aria-describedby', tooltip.id);
  const target = trigger.getBoundingClientRect();
  const width = tooltip.offsetWidth;
  const height = tooltip.offsetHeight;
  const left = Math.min(window.innerWidth - width - 8, Math.max(8, target.left + (target.width - width) / 2));
  const top = target.bottom + 6 + height <= window.innerHeight ? target.bottom + 6 : Math.max(8, target.top - height - 6);
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function deferHide() {
  clearTimeout(tooltipTimer);
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hideTooltip, 140);
}

document.querySelectorAll('.hint-trigger').forEach((trigger) => {
  trigger.addEventListener('pointerenter', (event) => {
    if (event.pointerType === 'touch') return;
    suppressTooltip = undefined;
    clearTimeout(tooltipTimer);
    clearTimeout(hideTimer);
    tooltipTimer = setTimeout(() => showTooltip(trigger), 300);
  });
  trigger.addEventListener('pointerleave', () => {
    if (!trigger.matches(':focus-visible')) deferHide();
  });
  trigger.addEventListener('focus', () => {
    if (trigger.matches(':focus-visible')) showTooltip(trigger);
  });
  trigger.addEventListener('blur', () => {
    if (suppressTooltip === trigger) suppressTooltip = undefined;
    hideTooltip();
  });
});
tooltip.addEventListener('pointerenter', () => clearTimeout(hideTimer));
tooltip.addEventListener('pointerleave', () => {
  if (!tooltipTrigger?.matches(':focus-visible')) deferHide();
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || dialog.open || tooltip.hidden || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  suppressTooltip = tooltipTrigger;
  hideTooltip();
});
window.addEventListener('resize', hideTooltip);
window.addEventListener('scroll', hideTooltip, { passive: true });
