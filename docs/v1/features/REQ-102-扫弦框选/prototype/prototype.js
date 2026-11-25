'use strict';

const $ = id => document.getElementById(id);
const score = $('score');
const width = 852;
const systemHeight = 168;
const staffTop = 68;
const stringGap = 10;
const measureLeft = 32;
const measureWidth = 264;
const beatGap = 58;

const chordFrets = {
  G: [3, 2, 0, 0, 0, 3], D: [null, null, 0, 2, 3, 2], Em: [0, 2, 2, 0, 0, 0],
  C: [null, 3, 2, 0, 1, 0], Am: [null, 0, 2, 2, 1, 0], D7: [null, null, 0, 2, 1, 2],
};
const measures = [
  ['G', ['strum-down', 'note', 'strum-up', 'arpeggio-up']],
  ['D', ['strum-down', 'note', 'arpeggio-up', 'rest']],
  ['Em', ['strum-up', 'note', 'strum-down', 'note']],
  ['C', ['note', 'arpeggio-up', 'strum-down', 'note']],
  ['G', ['arpeggio-down', 'note', 'strum-down', 'rest']],
  ['D7', ['arpeggio-up', 'strum-up', 'note', 'strum-down']],
  ['Am', ['strum-down', 'note', 'strum-up', 'note']],
  ['C', ['arpeggio-up', 'strum-down', 'note', 'rest']],
  ['G', ['strum-down', 'strum-up', 'note', 'arpeggio-down']],
];
const typeLabels = {
  'strum-up': '上扫', 'strum-down': '下扫', 'arpeggio-up': '上行琶音', 'arpeggio-down': '下行琶音',
};
const stringY = (system, string) => system * systemHeight + staffTop + (string - 1) * stringGap;
const lastBar = measureLeft + 3 * measureWidth;
const beats = measures.flatMap(([chord, contents], measureIndex) => contents.map((type, beatIndex) => ({
  id: `m${measureIndex + 1}b${beatIndex + 1}`,
  measure: measureIndex + 1,
  beat: beatIndex + 1,
  index: measureIndex * 4 + beatIndex,
  system: Math.floor(measureIndex / 3),
  x: measureLeft + (measureIndex % 3) * measureWidth + 46 + beatIndex * beatGap,
  chord,
  type,
})));
const techniques = beats.filter(beat => typeLabels[beat.type]);
const techniqueIds = new Map(techniques.map(beat => [beat.id, beat]));
const positionText = beat => `第 ${beat.measure} 小节 · 第 ${beat.beat} 拍`;
const isStrum = beat => beat.type.startsWith('strum');
const selection = new Set(['m1b1']);
let activeId = 'm1b1';
let tabSelection = null;
let gesture = null;
let keyHeld = false;
let modifierLocked = false;

function chordMarkup(chord, x, y) {
  const frets = chordFrets[chord];
  const columns = frets.map((_, index) => index * 5.5);
  const dots = frets.map((fret, index) => {
    const column = columns[index];
    if (fret === null) return `<path class="chord-diagram" d="M${column - 1.15} -4l2.3 2.3m0 -2.3l-2.3 2.3"/>`;
    if (fret === 0) return `<circle class="chord-diagram" cx="${column}" cy="-3" r="1.15"/>`;
    return `<circle class="chord-dot" cx="${column}" cy="${(fret - .5) * 5.5}" r="1.85"/>`;
  }).join('');
  return `<g transform="translate(${x - 13.75} ${y})">
    <text class="chord" x="13.75" y="-9">${chord}</text>
    <path class="chord-diagram" d="${columns.map(column => `M${column} 0v22`).join(' ')} ${[0, 5.5, 11, 16.5, 22].map(row => `M0 ${row}h27.5`).join(' ')}"/>
    ${dots}
  </g>`;
}

function staffMarkup(system) {
  const top = stringY(system, 1);
  const bottom = stringY(system, 6);
  const strings = Array.from({ length: 6 }, (_, index) => `M${measureLeft} ${stringY(system, index + 1)}H${lastBar}`);
  const bars = Array.from({ length: 4 }, (_, index) => `M${measureLeft + index * measureWidth} ${top}V${bottom}`);
  return `<g>
    <path class="staff-line" d="${strings.join(' ')}"/>
    <path class="bar-line" d="${bars.join(' ')}${system === 2 ? ` M${lastBar - 4} ${top}V${bottom}` : ''}"/>
    <text class="tab-label" x="17" y="${top + 16}"><tspan x="17">T</tspan><tspan x="17" dy="12">A</tspan><tspan x="17" dy="12">B</tspan></text>
    ${measures.slice(system * 3, system * 3 + 3).map(([chord], index) => {
      const x = measureLeft + index * measureWidth;
      return `<text class="measure-number" x="${x + 4}" y="${top - 5}">${system * 3 + index + 1}</text>${chordMarkup(chord, x + 46, top - 34)}`;
    }).join('')}
  </g>`;
}

function fretsMarkup(beat, x, strings) {
  const frets = chordFrets[beat.chord];
  return strings.map(string => {
    const fret = frets[6 - string];
    return fret === null ? '' : `<text class="fret" x="${x}" y="${stringY(beat.system, string) + 4}">${fret}</text>`;
  }).join('');
}

function ordinaryBeatMarkup(beat) {
  const { x, system, type } = beat;
  const bottom = stringY(system, 6);
  if (type === 'rest') {
    const y = stringY(system, 3) - 5;
    return `<path class="music-stroke" d="M${x - 1} ${y}l4 6 -5 6 5 5q-6 -1 -3 4"/>`;
  }
  return `${fretsMarkup(beat, x, [beat.beat === 2 ? 3 : 2])}<path class="duration" d="M${x} ${bottom + 6}v22"/>`;
}

function techniqueMarkup(beat) {
  const { id, system, x, type } = beat;
  const strum = isStrum(beat);
  const arrowDown = type === 'strum-up' || type === 'arpeggio-down';
  const top = stringY(system, 1);
  const bottom = stringY(system, 6);
  const endY = arrowDown ? bottom : top;
  const tailDirection = arrowDown ? -1 : 1;
  const stemX = strum ? x : x + 12;
  const wave = Array(7).fill('q-4 1.75 0 3.5t0 3.5').join(' ');
  // 命中区与可点选的箭头、波纹及各自符干共用。琶音的品位数字另画，普通音符不进入技巧索引。
  beat.targets = [
    { x: x - 6, y: top - 5, w: 12, h: bottom - top + 10 },
    { x: stemX - 4, y: bottom + 5, w: 8, h: 24 },
  ];
  const hitRects = beat.targets.map(({ x, y, w, h }) => `<rect class="technique-hit" x="${x}" y="${y}" width="${w}" height="${h}" rx="2"/>`).join('');
  return `<g class="technique" data-id="${id}" role="button" tabindex="0" aria-label="${positionText(beat)} · ${typeLabels[type]}" aria-pressed="false">
    <rect class="candidate-mark" x="${x - 7}" y="${top - 6}" width="14" height="${bottom - top + 12}" rx="3"/>
    <path class="technique-mark" d="${strum ? `M${x} ${top}V${bottom}` : `M${x} ${top + .5}${wave}`} M${x - 3} ${endY + tailDirection * 5}L${x} ${endY}l3 ${tailDirection * 5}"/>
    <path class="duration" d="M${stemX} ${bottom + 6}v22"/>
    ${hitRects}
  </g>`;
}

$('staff').innerHTML = [0, 1, 2].map(staffMarkup).join('') + beats.map(beat => {
  if (!techniqueIds.has(beat.id)) return ordinaryBeatMarkup(beat);
  if (isStrum(beat)) return '';
  return fretsMarkup(beat, beat.x + 12, [1, 2, 3, 4, 5, 6]);
}).join('');
$('techniques').innerHTML = techniques.map(techniqueMarkup).join('');
for (const item of techniques) item.node = score.querySelector(`[data-id="${item.id}"]`);

function setStatus(message) {
  const status = $('status-text');
  if (status.textContent !== message) status.textContent = message;
}

function paintSelection(message) {
  const ordered = techniques.filter(item => selection.has(item.id));
  const strumCount = ordered.filter(isStrum).length;
  const active = techniqueIds.get(activeId);
  for (const item of techniques) {
    const selected = selection.has(item.id);
    item.node.toggleAttribute('data-selected', selected);
    item.node.toggleAttribute('data-active', item.id === activeId);
    item.node.setAttribute('aria-pressed', String(selected));
  }
  $('context-title').textContent = active ? '六线谱技巧' : '六线谱';
  $('context-position').textContent = active ? positionText(active) : tabSelection ? positionText(tabSelection.focus.beat) : '无选区';
  $('selected-count').textContent = `${ordered.length} 项`;
  $('selection-summary').textContent = ordered.length
    ? `扫弦 ${strumCount} · 琶音 ${ordered.length - strumCount}`
    : tabSelection ? '当前为普通 TAB 选区。' : '点按箭头或波纹开始选择。';
  $('selection-list').innerHTML = ordered.map(item => `<li data-item="${item.id}" ${item.id === activeId ? 'data-active' : ''}>
    <span class="item-mark" aria-hidden="true"></span><span>${positionText(item)}</span><span class="item-type">${typeLabels[item.type]}</span>
  </li>`).join('');
  paintTabSelection();
  setStatus(message);
}

function paintTabSelection() {
  if (!tabSelection) {
    $('tab-selection').innerHTML = '';
    return;
  }
  const { anchor, focus } = tabSelection;
  const startBeat = Math.min(anchor.beat.index, focus.beat.index);
  const endBeat = Math.max(anchor.beat.index, focus.beat.index);
  const firstString = Math.min(anchor.string, focus.string);
  const lastString = Math.max(anchor.string, focus.string);
  $('tab-selection').innerHTML = beats.slice(startBeat, endBeat + 1).map(beat => `<rect class="tab-cell" x="${beat.x - 10}" y="${stringY(beat.system, firstString) - 4.5}" width="20" height="${(lastString - firstString) * stringGap + 9}" rx="2"/>`).join('');
}

function selectTechnique(id, toggle) {
  const item = techniqueIds.get(id);
  const label = `${positionText(item)} ${typeLabels[item.type]}`;
  tabSelection = null;
  let message = `已选中 ${label}`;
  if (!toggle) {
    selection.clear();
    selection.add(id);
  } else if (selection.delete(id)) {
    message = `已移除 ${label}`;
  } else {
    selection.add(id);
    message = `已添加 ${label}`;
  }
  activeId = toggle && selection.has(activeId) ? activeId : selection.values().next().value ?? null;
  paintSelection(message);
}

function scorePoint(event) {
  return new DOMPoint(event.clientX, event.clientY).matrixTransform(score.getScreenCTM().inverse());
}

function normalizeBox(start, end) {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return { x, y, w: Math.abs(end.x - start.x), h: Math.abs(end.y - start.y) };
}

function intersects(a, b) {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

function findCell(point) {
  const system = Math.floor(point.y / systemHeight);
  const relativeY = point.y - system * systemHeight;
  if (point.x < measureLeft || point.x > lastBar || relativeY < staffTop - 5 || relativeY > staffTop + 5 * stringGap + 5) return null;
  const row = beats.filter(beat => beat.system === system);
  if (!row.length) return null;
  const beat = row.reduce((nearest, candidate) => Math.abs(candidate.x - point.x) < Math.abs(nearest.x - point.x) ? candidate : nearest);
  const string = Math.min(6, Math.max(1, Math.round((relativeY - staffTop) / stringGap) + 1));
  return { beat, string };
}

function paintMarquee(box, hits) {
  const added = hits.filter(item => !selection.has(item.id));
  const addedIds = new Set(added.map(item => item.id));
  for (const item of techniques) item.node.toggleAttribute('data-preview', addedIds.has(item.id));
  score.setAttribute('data-dragging', '');
  $('marquee').removeAttribute('hidden');
  const graphic = $('marquee-box');
  graphic.setAttribute('x', box.x);
  graphic.setAttribute('y', box.y);
  graphic.setAttribute('width', Math.max(1, box.w));
  graphic.setAttribute('height', Math.max(1, box.h));
  const badgeX = Math.min(width - 140, Math.max(0, box.x));
  const badgeY = Math.max(0, box.y - 27);
  $('marquee-badge').setAttribute('transform', `translate(${badgeX} ${badgeY})`);
  $('marquee-text').textContent = `命中 ${hits.length} 项 · 新增 ${added.length} 项`;
  setStatus(`框内命中 ${hits.length} 项 · 松手追加 ${added.length} 项 · Esc 取消`);
}

function refreshModifier() {
  const additive = modifierLocked || keyHeld || Boolean(gesture?.additive);
  score.toggleAttribute('data-additive', additive);
  $('status-mode').toggleAttribute('data-additive', additive);
  $('status-mode').textContent = modifierLocked ? 'Alt／Option 已锁定' : additive ? '追加技巧选区' : '六线谱';
}

function releaseGesture() {
  const { pointerId } = gesture;
  gesture = null;
  // 先清状态再释放捕获，否则 lostpointercapture 会把已提交的手势误认为取消。
  if (score.hasPointerCapture(pointerId)) score.releasePointerCapture(pointerId);
  score.removeAttribute('data-dragging');
  $('marquee').setAttribute('hidden', '');
  for (const item of techniques) item.node.removeAttribute('data-preview');
  refreshModifier();
}

function cancelGesture(message) {
  if (!gesture) return;
  // 取消时重画最后一次已提交的选区，框选预览和普通弦格预览都不留下中间状态。
  if (!gesture.additive) tabSelection = gesture.previousTabSelection;
  releaseGesture();
  paintSelection(message);
}

score.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !event.isPrimary || gesture) return;
  event.preventDefault();
  const point = scorePoint(event);
  const target = event.target.closest('[data-id]');
  const item = target && techniqueIds.get(target.dataset.id);
  gesture = {
    pointerId: event.pointerId,
    start: point,
    clientX: event.clientX,
    clientY: event.clientY,
    // 起手时判定组合键，避免按住鼠标后松开 Alt 导致拖框途中切换为普通 TAB 选区。
    additive: event.altKey || modifierLocked,
    clickedId: item?.id,
    cell: findCell(point) ?? (item ? { beat: item, string: 6 } : null),
    previousTabSelection: tabSelection,
    dragging: false,
    hits: [],
  };
  score.setPointerCapture(event.pointerId);
  (target ?? score).focus({ preventScroll: true });
  refreshModifier();
});

function updateGesture(event) {
  // 用屏幕像素判定拖动，避免视口宽度改变时点按抖动被误判为框选。
  if (!gesture.dragging && Math.hypot(event.clientX - gesture.clientX, event.clientY - gesture.clientY) < 4) return;
  gesture.dragging = true;
  const point = scorePoint(event);
  if (gesture.additive) {
    // 整个 SVG 共用坐标系，跨小节与跨谱行走同一套相交判断。每个技巧只按 ID 计一次。
    const box = normalizeBox(gesture.start, point);
    gesture.hits = techniques.filter(item => item.targets.some(target => intersects(box, target)));
    paintMarquee(box, gesture.hits);
  } else if (gesture.cell) {
    const focus = findCell(point) ?? tabSelection?.focus ?? gesture.cell;
    tabSelection = { anchor: gesture.cell, focus };
    paintTabSelection();
  }
}

score.addEventListener('pointermove', event => {
  if (gesture?.pointerId === event.pointerId) updateGesture(event);
});

score.addEventListener('pointerup', event => {
  if (gesture?.pointerId !== event.pointerId) return;
  updateGesture(event);
  const { additive, clickedId, cell, dragging, hits } = gesture;
  releaseGesture();
  if (!dragging && clickedId) {
    selectTechnique(clickedId, additive);
  } else if (additive && dragging) {
    // 框选取并集，与点按切换分开。重复拖过同一记号只计命中，不移除或复制已选项。
    const before = selection.size;
    for (const item of hits) selection.add(item.id);
    if (hits.length) {
      tabSelection = null;
      activeId ??= hits[0].id;
    }
    const added = selection.size - before;
    paintSelection(added ? `已追加 ${added} 项 · 当前已选 ${selection.size} 项` : hits.length ? '框中技巧均已选中' : '框中没有扫弦或琶音');
  } else if (!additive) {
    selection.clear();
    activeId = null;
    if (!dragging || !cell) tabSelection = cell ? { anchor: cell, focus: cell } : null;
    paintSelection(tabSelection ? '已选择普通 TAB 弦格' : '已清除选区');
  }
});

for (const eventName of ['pointercancel', 'lostpointercapture']) {
  score.addEventListener(eventName, event => {
    if (gesture?.pointerId === event.pointerId) cancelGesture('已取消拖动');
  });
}

score.addEventListener('keydown', event => {
  const target = event.target.closest('[data-id]');
  if (!target || event.repeat || gesture || !['Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  selectTechnique(target.dataset.id, modifierLocked || event.altKey);
});

window.addEventListener('keydown', event => {
  if (event.key === 'Alt') {
    keyHeld = true;
    refreshModifier();
  }
  if (event.key === 'Escape' && gesture) {
    event.preventDefault();
    cancelGesture('已取消拖动');
  }
});

window.addEventListener('keyup', event => {
  if (event.key !== 'Alt') return;
  keyHeld = false;
  refreshModifier();
});

window.addEventListener('blur', () => {
  keyHeld = false;
  cancelGesture('已取消拖动');
  refreshModifier();
});

function setGuide(visible) {
  $('guide').toggleAttribute('hidden', !visible);
  $('guide-note').hidden = !visible;
  $('guide-toggle').setAttribute('aria-pressed', String(visible));
}

$('guide-toggle').addEventListener('click', () => setGuide($('guide').hasAttribute('hidden')));
$('modifier-lock').addEventListener('click', () => {
  modifierLocked = !modifierLocked;
  $('modifier-lock').setAttribute('aria-pressed', String(modifierLocked));
  refreshModifier();
});

$('reset').addEventListener('click', () => {
  cancelGesture('已取消拖动');
  selection.clear();
  selection.add('m1b1');
  activeId = 'm1b1';
  tabSelection = null;
  modifierLocked = false;
  $('modifier-lock').setAttribute('aria-pressed', 'false');
  setGuide(false);
  document.querySelector('.canvas').scrollTop = 0;
  paintSelection('已重置示例 · 第 1 小节第 1 拍扫弦已选中');
  refreshModifier();
});

paintSelection('第 1 小节第 1 拍扫弦已选中');
