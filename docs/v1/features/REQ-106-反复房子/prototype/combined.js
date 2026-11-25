const $ = (selector) => document.querySelector(selector);
const between = (first, last) => Array.from({ length: last - first + 1 }, (_, index) => first + index);
const button = (action, text, extra = '') => `<button data-do="${action}" ${extra}>${text}</button>`;
const label = (number) => `第 ${number} 小节`;
const rangeLabel = (first, last) => first === last ? label(first) : `第 ${first}–${last} 小节`;
const markDefinitions = {
  segno: { name: 'Segno', sign: '\uE047', side: 'start', hint: '回跳后从本小节第 1 拍继续' },
  ds: { name: 'D.S.', sign: 'D.S.', hint: '弹完本小节，回到配对的 Segno', fields: ['segno'] },
  dsCoda: { name: 'D.S. al Coda', sign: 'D.S.<br>al Coda', hint: '回到 Segno，重奏时经 To Coda 进入尾声', fields: ['segno', 'toCoda'] },
  toCoda: { name: 'To Coda', sign: 'To<br>Coda', hint: '重奏命中配对时跳至 Coda', fields: ['coda'] },
  coda: { name: 'Coda', sign: '\uE048', side: 'start', hint: '从本小节第 1 拍进入尾声' },
  dc: { name: 'D.C.', sign: 'D.C.', hint: '弹完本小节，回到曲首' },
  fine: { name: 'Fine', sign: 'Fine', hint: '首遍顺行，重奏命中配对时在本小节末结束' },
  dcFine: { name: 'D.C. al Fine', sign: 'D.C.<br>al Fine', hint: '回到曲首，重奏到配对的 Fine 停止', fields: ['fine'] },
  dsFine: { name: 'D.S. al Fine', sign: 'D.S.<br>al Fine', hint: '回到 Segno，重奏到配对的 Fine 停止', fields: ['segno', 'fine'] },
  dcCoda: { name: 'D.C. al Coda', sign: 'D.C.<br>al Coda', hint: '回到曲首，重奏时经 To Coda 进入尾声', fields: ['toCoda'] },
};
const side = (kind) => markDefinitions[kind].side ?? 'end';
const barlines = [
  ['single', '单线'], ['double', '双线'], ['final', '终止线'], ['repeatStart', '开始反复'],
  ['repeatEnd', '结束反复'], ['repeatBoth', '双向反复'], ['scoreStart', '谱首反复'],
];
const settings = {
  rooms: { title: '分遍结尾练习', size: 10 },
  jumps: { title: '曲首回跳练习', size: 8 },
  single: { title: '相同的下一小节', size: 3 },
};
const playbackPolicy = { dc: 'tail', single: 'expand' };
const snapshots = {};
let example = 'rooms';
let score = createExample(example);
let history = [], redo = [];
let anchor = 2, selected = 2;
let popup = true, draft = null, listening = null, timer = null, audio = null;
let returnPoint;

function createExample(kind) {
  const size = settings[kind].size;
  const frets = between(1, size).map((part) => [part % 5 + 2, part % 4, (part + 2) % 5, part % 3]);
  if (kind === 'single') frets[1] = [];
  return {
    frets,
    lines: { [size]: 'final', ...(kind === 'rooms' ? { 5: 'repeatEnd' } : {}) },
    startRepeat: kind === 'rooms',
    rooms: kind === 'rooms' ? [
      { id: 'v1', first: 4, last: 5, passes: [1] }, { id: 'v2', first: 6, last: 6, passes: [2] },
      { id: 'v3', first: 7, last: 8, passes: [3] },
    ] : [],
    marks: kind === 'jumps' ? [{ id: 'fine-3', kind: 'fine', at: 3 }, { id: 'dc-6', kind: 'dcFine', at: 6, fine: 'fine-3' }] : [],
    singles: [],
  };
}

function lineIcon(kind) {
  const start = ['scoreStart', 'repeatStart', 'repeatBoth'].includes(kind);
  const end = ['repeatEnd', 'repeatBoth'].includes(kind);
  const dots = (x) => `<circle cx="${x}" cy="10" r="1.6"/><circle cx="${x}" cy="17" r="1.6"/>`;
  return `<svg aria-hidden="true" viewBox="0 0 32 28" fill="currentColor">
    <path d="M${kind === 'single' ? 16 : 12} 3V25" stroke="currentColor" stroke-width="${start ? 3 : 1}"/>
    ${kind === 'single' ? '' : `<path d="M20 3V25" stroke="currentColor" stroke-width="${kind === 'final' || end ? 3 : 1}"/>`}
    ${start ? dots(26) : ''}${end ? dots(5) : ''}</svg>`;
}

function icon(action, glyph, name, hint, pressed, reason = '') {
  return button(action, glyph, `class="icon" aria-label="${name}" aria-describedby="tooltip" data-tooltip="${name} · ${reason || hint}" aria-pressed="${pressed}"${reason ? ' aria-disabled="true"' : ''}`);
}

function paintPopup() {
  $('#measure-popup').hidden = !popup || Boolean(listening);
  $('#measure-tool').setAttribute('aria-expanded', String(popup && !listening));
  if (!popup || listening) return;
  const multi = anchor !== selected;
  const singleOnly = multi ? '请选择一个小节' : '';
  const currentMarks = score.marks.filter((mark) => mark.at === selected);
  const hasRoom = score.rooms.some((room) => room.first <= selected && room.last >= selected);
  const lines = barlines.map(([kind, name]) => {
    const reason = singleOnly || (kind === 'scoreStart' && selected !== 1 ? '仅第 1 小节可用' : '') ||
      (['repeatStart', 'repeatBoth'].includes(kind) && selected === score.frets.length ? '谱尾后没有下一小节' : '');
    const pressed = kind === 'scoreStart' ? score.startRepeat && selected === 1 : (score.lines[selected] ?? 'single') === kind;
    const boundary = kind === 'scoreStart' ? '切换谱首左边界' : '设置当前小节右边界';
    return `<div${kind === 'scoreStart' ? ' class="rule-left"' : ''}>${icon(`line:${kind}`, lineIcon(kind), name, boundary, pressed, reason)}<small>${name}</small></div>`;
  }).join('');
  const marks = Object.entries(markDefinitions).map(([kind, definition]) => {
    const existing = currentMarks.find((mark) => mark.kind === kind);
    const occupied = currentMarks.some((mark) => side(mark.kind) === side(kind));
    const reason = singleOnly || (kind === 'dc' && playbackPolicy.dc === 'qualified' && !existing ? '请选择 D.C. al Fine 或 D.C. al Coda' : '') ||
      (!existing && occupied ? '该端已有记号，先编辑或删除它' : '');
    return icon(`mark:${kind}`, `<i aria-hidden="true"${definition.side ? ' class="music-char"' : ''}>${definition.sign}</i>`, definition.name, definition.hint, Boolean(existing), reason);
  }).join('');
  const repeatReason = singleOnly || singleIssue();
  const roomReason = example === 'rooms' ? '' : '请选择有反复段的示例';
  $('#measure-popup').innerHTML = `<div class="popup-head"><h2 id="measure-heading" tabindex="-1">小节工具</h2><span>${rangeLabel(Math.min(anchor, selected), Math.max(anchor, selected))}</span>${button('close-popup', '×', 'class="close" aria-label="关闭小节工具"')}</div>
    <div class="barline-grid" role="group" aria-label="小节线">${lines}</div>
    <section class="symbol-section" aria-labelledby="symbol-heading"><h3 id="symbol-heading">反复与跳转</h3><div class="symbols">
    ${icon('room', '<svg aria-hidden="true" viewBox="0 0 32 28"><path d="M4 24V7H29" fill="none" stroke="currentColor"/><text x="8" y="20" fill="currentColor" font-family="Georgia" font-size="13">1.</text></svg>', '反复房子', '设置选区在第几遍演奏', hasRoom, roomReason)}
    <div class="symbol-group rule-left" role="group" aria-label="跳转记号">${marks}</div>
    <div class="rule-left">${icon('single', '<i class="music-char repeat-char" aria-hidden="true">\uE500</i>', '单小节重复', '当前小节重复前一小节的演奏内容', score.singles.includes(selected), repeatReason)}</div></div></section>
    <div class="measure-actions" aria-label="小节操作">${button('structure:add', '＋　新增小节', 'aria-disabled="true" data-tooltip="设计原型使用固定小节数"')}${button('structure:copy', '▢　复制小节', 'aria-disabled="true" data-tooltip="设计原型使用固定小节数"')}${button('structure:delete', '⌫　删除小节', 'aria-disabled="true" data-tooltip="设计原型使用固定小节数"')}</div>`;
}

function measureView(at) {
  const active = listening?.visits[listening.step]?.at === at;
  const chosen = !listening && at >= Math.min(anchor, selected) && at <= Math.max(anchor, selected);
  const preview = draft?.type === 'room' && draft.first <= at && at <= draft.last;
  const room = score.rooms.find((item) => item.first <= at && item.last >= at);
  const shownRoom = room && (at === room.first || (at - 1) % 4 === 0);
  const passes = room?.passes.map((pass) => `${pass}.`).join(' ');
  const music = score.singles.includes(at) ? '<span class="rest-symbol">\uE500</span>' : score.frets[at - 1].map((fret, index) =>
    `<span class="fret" style="left:${18 + 21 * index}%;top:${54 + [24, 16, 8, 16][index]}px">${fret}</span>`).join('');
  const bracket = room ? `<span class="bracket${at === room.first ? ' start' : ''}${at === room.last ? ' end' : ''}" data-edit-room="${room.id}">${shownRoom ? (at === room.first ? passes : `(${passes})`) : ''}</span>` : '';
  const marks = score.marks.filter((mark) => mark.at === at).map((mark) => {
    const definition = markDefinitions[mark.kind];
    const css = definition.side ? 'start-mark music-char' : 'end-mark';
    return `<span class="${css}" data-edit-mark="${mark.id}">${definition.side ? definition.sign : definition.name}</span>`;
  }).join('');
  const visit = active ? listening.visits[listening.step] : null;
  const done = listening?.done && listening.step === listening.visits.length - 1;
  return `<button class="measure${preview ? ' draft' : ''}${active ? ' sounding' : ''}" data-at="${at}" aria-pressed="${chosen}" aria-label="${label(at)}${score.singles.includes(at) ? '，单小节重复' : ''}${marks ? `，${score.marks.filter((mark) => mark.at === at).map((mark) => markDefinitions[mark.kind].name).join('、')}` : ''}">
    <span class="staff ${score.lines[at] ?? ''}${at === 1 && score.startRepeat ? ' score-start' : ''}"></span><span class="number">${at}</span>
    ${score.singles.includes(at) || !score.frets[at - 1].length ? '' : `<span class="chord">${['G', 'D/F♯', 'Em', 'Cadd9'][((at - 1) % 4)]}</span>`}
    ${music}${bracket}${marks}${visit ? `<span class="cursor" style="left:${done ? 98 : 18 + 21 * (listening.beat - 1)}%"></span>` : ''}</button>`;
}

function paintScore() {
  const size = score.frets.length;
  $('#score').innerHTML = between(0, Math.ceil(size / 4) - 1).map((row) => `<div class="system"><div class="tab-label" aria-hidden="true"><span>T</span><span>A</span><span>B</span></div>${between(row * 4 + 1, Math.min(size, row * 4 + 4)).map(measureView).join('')}</div>`).join('');
}

function lookup(id) {
  return score.marks.find((mark) => mark.id === id);
}

function sidePanel() {
  if (listening) return auditionPanel();
  const number = rangeLabel(Math.min(anchor, selected), Math.max(anchor, selected));
  const marks = score.marks.filter((mark) => mark.at === selected);
  const rooms = score.rooms.filter((room) => room.first <= selected && room.last >= selected);
  const hasSingle = score.singles.includes(selected);
  const roomRows = rooms.map((room) => `<div class="mark-row"><span>第 ${room.passes.join('、')} 房<small>${rangeLabel(room.first, room.last)}</small></span>${button(`edit-room:${room.id}`, '编辑', 'aria-label="编辑反复房子"')}</div>`).join('');
  const markRows = marks.map((mark) => {
    const definition = markDefinitions[mark.kind];
    const issue = markError(mark);
    const pairs = (definition.fields ?? []).flatMap((field) => {
      const target = lookup(mark[field]);
      return target ? [`${markDefinitions[field].name} · ${label(target.at)}`] : [];
    });
    return `<div class="mark-row"><span>${definition.name}<small${issue ? ' class="pair-warning"' : ''}>${issue?.text || pairs.join(' ／ ') || definition.hint}</small></span>${button(`edit-mark:${mark.id}`, '编辑', `aria-label="编辑 ${definition.name}"`)}</div>`;
  }).join('');
  return `<div class="sidebar-head"><h2 tabindex="-1">小节</h2><span>${number}</span></div>
    <div class="panel"><div class="property"><h3>小节拍号</h3><span class="muted">4/4</span></div><div class="property"><h3>小节时长</h3><span class="muted">4 拍</span></div></div>
    <div class="panel"><div class="property"><h3>反复与跳转</h3>${button('open-popup', '选记号…')}</div>
    ${draft ? editorForm() : `${roomRows}${markRows}${hasSingle ? `<div class="mark-row"><span>单小节重复<small>${label(selected - 1)} → ${label(selected)}</small></span>${button('single', '查看')}</div>` : ''}`}
    ${!draft && !roomRows && !markRows && !hasSingle ? '<p class="muted">当前选区尚未添加记号。</p>' : ''}</div>
    ${!draft && example === 'single' && score.frets[selected - 1].length && !hasSingle ? `<form id="fret-form" class="panel fields"><h3>TAB 首拍</h3><label><span>第 5 弦品位</span><input name="fret" type="number" min="0" max="24" required value="${score.frets[selected - 1][0]}"></label><div class="form-actions"><button type="submit">应用品位</button></div></form>` : ''}
    ${!draft && example !== 'rooms' ? `<div class="panel"><h3>评审方案</h3>${example === 'single' ? `<label class="fields"><span>源小节内容改变</span><select id="single-policy"><option value="expand" ${playbackPolicy.single === 'expand' ? 'selected' : ''}>保留内容并展开</option><option value="sync" ${playbackPolicy.single === 'sync' ? 'selected' : ''}>同步并保留记号</option></select></label>` : `<label class="fields"><span>独立 D.C. 结束方式</span><select id="dc-policy"><option value="tail" ${playbackPolicy.dc === 'tail' ? 'selected' : ''}>重奏到曲尾</option><option value="qualified" ${playbackPolicy.dc === 'qualified' ? 'selected' : ''}>只提供 al Fine / al Coda</option></select></label>`}</div>` : ''}`;
}

function paint(focus = '') {
  hideTooltip();
  const title = settings[example].title;
  $('#document-title').textContent = title;
  $('#score-title').textContent = title;
  $('#example').value = example;
  $('#example').disabled = Boolean(listening);
  $('#audition').textContent = listening ? '退出试听' : '试听';
  $('[data-do="undo"]').disabled = !history.length || Boolean(listening);
  $('[data-do="redo"]').disabled = !redo.length || Boolean(listening);
  $('[data-do="save"]').disabled = Boolean(listening);
  $('[data-do="load"]').disabled = Boolean(listening);
  $('#measure-tool').disabled = Boolean(listening);
  paintScore();
  paintPopup();
  $('#inspector').innerHTML = sidePanel();
  if (focus) $(focus)?.focus({ preventScroll: true });
}

function announce(text) {
  $('#status').textContent = text;
}

function commit(update, message, focus = '') {
  history.push(structuredClone(score));
  redo = [];
  update();
  draft = null;
  paint(focus || (popup ? '#measure-heading' : '.sidebar-head h2'));
  announce(message);
}

function selectMeasure(at, extend = false) {
  if (!extend) anchor = at;
  selected = at;
  draft = null;
}

function setDraft(next) {
  draft = next;
  popup = false;
  paint('#draft-title');
}

function existingRoom(id) {
  const room = score.rooms.find((item) => item.id === id);
  anchor = room.first;
  selected = room.last;
  setDraft({ type: 'room', ...structuredClone(room) });
}

function openRoom() {
  const room = score.rooms.find((item) => Math.min(anchor, selected) === item.first && Math.max(anchor, selected) === item.last);
  if (room) return existingRoom(room.id);
  const passes = [1, 2, 3].filter((pass) => !score.rooms.some((item) => item.passes.includes(pass)));
  setDraft({ type: 'room', first: Math.max(4, Math.min(anchor, selected)), last: Math.max(4, anchor, selected), passes: passes.slice(0, 1) });
}

function roomError(room) {
  if (!room.first || !room.last || room.first < 4 || room.last > 8 || room.first > room.last) return '请选择第 4–8 小节内的有效连续范围。';
  if (!room.passes.length) return '请选择至少一个演奏遍次。';
  const other = score.rooms.filter((item) => item.id !== room.id);
  if (other.some((item) => item.first <= room.last && room.first <= item.last)) return '范围与已有反复房子重叠。';
  if (other.some((item) => item.passes.some((pass) => room.passes.includes(pass)))) return '该遍次已分配给另一间房子。';
  return '';
}

function markCandidates(mark, field) {
  const start = lookup(mark.segno)?.at ?? 1;
  return score.marks.filter((option) => option.kind === field && (
    field === 'segno' ? option.at <= mark.at : field === 'coda' ? option.at > mark.at : option.at >= start && option.at < mark.at
  )).sort((a, b) => a.at - b.at);
}

function markError(mark) {
  const definition = markDefinitions[mark.kind];
  if (mark.kind === 'dc' && playbackPolicy.dc === 'qualified') return { at: mark.at, id: mark.id, text: '请选择 D.C. al Fine 或 D.C. al Coda。' };
  for (const field of definition.fields ?? []) {
    if (!markCandidates(mark, field).some((candidate) => candidate.id === mark[field])) {
      return { at: mark.at, id: mark.id, text: `请配对可达的 ${markDefinitions[field].name}。` };
    }
  }
  if (mark.toCoda) return markError(lookup(mark.toCoda));
  return null;
}

function openMark(kind, existing) {
  if (existing) selectMeasure(existing.at);
  const next = { type: 'mark', ...(existing || { kind, at: selected }) };
  for (const field of markDefinitions[next.kind].fields ?? []) {
    const candidates = markCandidates(next, field);
    if (!next[field] && candidates.length === 1) next[field] = candidates[0].id;
  }
  setDraft(next);
}

function singleIssue() {
  if (selected === 1) return '第 1 小节没有前一小节';
  if (score.singles.includes(selected)) return '';
  if (score.singles.includes(selected - 1)) return '请先展开前一小节的重复记号';
  if ((score.lines[selected - 1] ?? 'single') !== 'single') return '前一小节和当前小节之间有结构边界';
  if (!score.frets[selected - 2].length) return '请先录入前一小节的演奏内容';
  return '';
}

function editorForm() {
  if (draft.type === 'single') {
    const hasSingle = score.singles.includes(selected);
    const reason = singleIssue();
    return `<h3 id="draft-title" tabindex="-1">单小节重复</h3><p>${label(selected - 1)} → ${label(selected)} · 4 拍</p>
      <p class="hint${reason ? ' warning' : ''}">${reason || (hasSingle ? '当前小节保留自己的拍位。展开后可以编辑实际音符。' : '当前小节将使用前一小节的演奏内容。')}</p>
      <div class="form-actions">${button(hasSingle ? 'source' : 'cancel', hasSingle ? '编辑前一小节' : '取消')}${button(hasSingle ? 'expand' : 'apply-single', hasSingle ? '展开为普通小节' : '添加单小节重复', `class="primary"${reason ? ' disabled' : ''}`)}</div>`;
  }
  if (draft.type === 'room') {
    const field = (name, title) => `<label><span>${title}</span><input name="${name}" type="number" min="4" max="8" value="${draft[name]}" required></label>`;
    const error = roomError(draft);
    return `<h3 id="draft-title" tabindex="-1">${draft.id ? '编辑' : '添加'}反复房子</h3><form id="room-form" class="fields">
      <p class="hint">共享段 1–3 小节 · 结尾区 4–8 小节</p><div class="field-pair">${field('first', '起始小节')}${field('last', '结束小节')}</div>
      <fieldset><legend>演奏遍次</legend>${[1, 2, 3].map((pass) => `<label><input name="pass" type="checkbox" value="${pass}" ${draft.passes.includes(pass) ? 'checked' : ''}>第 ${pass} 遍</label>`).join('')}</fieldset>
      <p id="room-error" class="hint warning" role="status"${error ? '' : ' hidden'}>${error}</p>
      <div class="form-actions">${draft.id ? button('delete-room', '删除', 'type="button" class="danger"') : ''}${button('cancel', '取消', 'type="button"')}<button class="primary" type="submit"${error ? ' disabled' : ''}>应用</button></div></form>`;
  }
  const definition = markDefinitions[draft.kind];
  const fields = (definition.fields ?? []).map((field) => {
    const candidates = markCandidates(draft, field);
    const missing = draft[field] && !candidates.some((candidate) => candidate.id === draft[field]);
    return `<label><span>${field === 'coda' ? '跳到' : '配对'} ${markDefinitions[field].name}</span><select data-pair="${field}">
      <option value="">${candidates.length ? '请选择' : '没有可达记号'}</option>${missing ? `<option selected value="${draft[field]}">配对已失效</option>` : ''}
      ${candidates.map((candidate) => `<option value="${candidate.id}" ${draft[field] === candidate.id ? 'selected' : ''}>${label(candidate.at)}</option>`).join('')}</select></label>`;
  }).join('');
  const error = markError(draft);
  const repair = error?.id && error.id !== draft.id ? button(`edit-mark:${error.id}`, `查看${label(error.at)}的 To Coda`) : '';
  return `<h3 id="draft-title" tabindex="-1">${draft.id ? '编辑' : '添加'} ${definition.name}</h3><p class="hint">${label(draft.at)}${definition.side ? '开头' : '末端'} · ${definition.hint}</p>
    <div class="fields">${fields}</div>${error ? `<p class="hint warning">${error.text}${repair ? ` ${label(error.at)}的 To Coda 需要落点。` : ''}</p>${repair}` : ''}
    <div class="form-actions">${draft.id ? button('delete-mark', '删除', 'class="danger"') : ''}${button('cancel', '取消')}${button('apply-mark', '应用', `class="primary"${draft.kind === 'dc' && playbackPolicy.dc === 'qualified' ? ' disabled' : ''}`)}</div>`;
}

function makeRoute() {
  const visits = [];
  const executed = new Set(), repeated = new Set();
  const handlingRooms = example === 'rooms';
  let at = 1, pass = 1, repeatFrom = 1, activeRoom, armed;
  let issue, endedByFine = false;
  while (at <= score.frets.length && visits.length < 120) {
    visits.push({ at, pass: handlingRooms && at <= 8 ? pass : undefined });
    const line = score.lines[at];
    const repeatBack = ['repeatEnd', 'repeatBoth'].includes(line) && !repeated.has(at) && !(handlingRooms && at === 5);
    const branch = handlingRooms && at === 3;
    const finishRoom = handlingRooms && at === activeRoom?.last;
    const mark = score.marks.find((item) => item.at === at && side(item.kind) === 'end');
    const isExit = mark && armed === mark.id;
    const jump = mark?.kind.startsWith('d') && !executed.has(mark.id);
    if ((jump || isExit) && (repeatBack || branch || finishRoom)) {
      issue = { at, id: mark.id, text: '同一小节末同时触发跳转与反复，请调整记号位置。' };
      break;
    }
    if (isExit && mark.kind === 'fine') {
      endedByFine = true;
      break;
    }
    if (isExit && mark.kind === 'toCoda') {
      issue = markError(mark);
      if (issue) break;
      at = lookup(mark.coda).at;
      armed = undefined;
      continue;
    }
    if (jump) {
      issue = markError(mark) ?? (armed ? { at, id: mark.id, text: '上一次重奏的结束或尾声出口尚未经过。' } : null);
      if (issue) break;
      executed.add(mark.id);
      armed = mark.fine || mark.toCoda;
      at = lookup(mark.segno)?.at ?? 1;
      continue;
    }
    if (branch) {
      activeRoom = score.rooms.find((room) => room.passes.includes(pass));
      if (!activeRoom) {
        issue = { at, pass, text: `第 ${pass} 遍没有反复房子。` };
        break;
      }
      at = activeRoom.first;
      continue;
    }
    if (finishRoom) {
      at = pass < 3 ? 1 : 9;
      pass = Math.min(3, pass + 1);
      activeRoom = undefined;
      continue;
    }
    if (repeatBack) {
      repeated.add(at);
      at = repeatFrom;
      continue;
    }
    if (['repeatStart', 'repeatBoth'].includes(line)) repeatFrom = at + 1;
    at++;
  }
  if (!issue && (armed && !endedByFine)) {
    const mark = lookup(armed);
    issue = { at: mark.at, id: mark.id, text: `本次重奏没有经过配对的 ${markDefinitions[mark.kind].name}。` };
  }
  if (!issue && visits.length === 120 && at <= score.frets.length && !endedByFine) {
    issue = { at, text: '演奏路线反复进入相同位置，请核对反复和跳转设置。' };
  }
  return { visits, issue, endedByFine };
}

function auditionPanel() {
  const { visits, step, beat, done, playing, issue, endedByFine, origin, finishedLabel } = listening;
  const visit = visits[step];
  const problem = done && issue;
  const summary = problem ? problem.text : finishedLabel || (done ? (endedByFine ? `重奏结束 · ${label(visit.at)}末` : '试听结束') :
    visit ? `${visit.pass ? `第 ${visit.pass} 遍 · ` : ''}${label(visit.at)} · 第 ${beat} 拍` : '准备试听');
  const sequence = visits.map((item, index) => `${index && item.at !== visits[index - 1].at + 1 ? '<b aria-hidden="true">↪</b>' : ''}<span${index === step ? ' aria-current="step"' : ''} aria-label="第 ${index + 1} 次到访，${label(item.at)}">${item.at}</span>`).join('');
  return `<div class="sidebar-head"><h2 tabindex="-1">木吉他试听</h2></div><div class="panel">
    <label class="fields"><span>试听起点</span><select id="audition-origin"><option value="head" ${origin === 'head' ? 'selected' : ''}>从曲首</option><option value="selected" ${origin === 'selected' ? 'selected' : ''}>从${label(returnPoint.selected)}</option></select></label>
    <div class="listen-actions">${button('play', playing ? '暂停' : '播放', 'class="primary"')}${button('stop', '停止')}${button('step', '下一拍')}</div>
    <p class="hint ${problem ? 'warning' : 'listening'}" id="audition-status" role="status">${summary}</p>
    ${problem ? button('repair', `返回编辑${label(problem.at)}`) : ''}</div>
    <div class="panel"><h3>小节到访顺序</h3><div class="sequence" aria-label="演奏顺序">${sequence || '<p class="muted">当前起点在可播放路线之外。</p>'}</div><p class="muted">↪ 表示跳过或回到其他小节。试听使用合成示意音。</p></div>`;
}

function startListening(origin = 'selected') {
  const route = makeRoute();
  const start = origin === 'head' ? 0 : route.visits.findIndex((item) => item.at === returnPoint.selected);
  listening = { ...route, visits: start < 0 ? [] : route.visits.slice(start), origin, step: -1, beat: 0, playing: false, done: false };
  if (start < 0) listening.finishedLabel = '所选小节未到访，请改为从曲首试听。';
}

function advance() {
  if (!listening.visits.length || listening.done) return false;
  if (listening.beat < 4 && listening.step >= 0) {
    listening.beat++;
  } else if (listening.step < listening.visits.length - 1) {
    listening.step++;
    listening.beat = 1;
  } else {
    listening.done = true;
    return false;
  }
  return true;
}

function sound() {
  const visit = listening.visits[listening.step];
  const fret = visit && score.frets[visit.at - 1][listening.beat - 1];
  if (!audio || fret === undefined) return;
  const time = audio.currentTime;
  const tone = audio.createOscillator(), volume = audio.createGain();
  tone.type = 'triangle';
  tone.frequency.value = 110 * 2 ** (fret / 12);
  volume.gain.setValueAtTime(0.055, time);
  volume.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
  tone.connect(volume).connect(audio.destination);
  tone.start(time);
  tone.stop(time + 0.31);
}

function tick(focus = '') {
  if (advance()) {
    sound();
    if (listening.playing) timer = setTimeout(tick, 60000 / 90);
  } else {
    listening.playing = false;
  }
  const retained = focus || (document.activeElement?.dataset.do === 'play' ? '[data-do="play"]' : '');
  paint(retained);
  $('#score .sounding')?.scrollIntoView({ block: 'nearest' });
}

function stopClock() {
  clearTimeout(timer);
  if (listening) listening.playing = false;
}

function exitListening() {
  stopClock();
  listening = null;
  ({ anchor, selected, popup } = returnPoint);
  paint('#audition');
  announce(`已返回${label(selected)}。`);
}

function showConfirmation(title, copy, action, onConfirm) {
  const dialog = $('#confirmation');
  const origin = document.activeElement;
  $('#confirm-title').textContent = title;
  $('#confirm-copy').textContent = copy;
  $('#confirm-action').textContent = action;
  dialog.returnValue = 'cancel';
  dialog.addEventListener('close', () => {
    if (dialog.returnValue === 'confirm') onConfirm();
    else origin?.focus();
  }, { once: true });
  dialog.showModal();
}

function handleApplySingle() {
  if (singleIssue()) return;
  const source = score.frets[selected - 2];
  const target = score.frets[selected - 1];
  const apply = () => commit(() => {
    score.frets[selected - 1] = [...source];
    score.singles.push(selected);
  }, `${label(selected)}已添加单小节重复，可撤销。`, `[data-at="${selected}"]`);
  if (target.length) showConfirmation('替换现有演奏内容？', `${label(selected - 1)} → ${label(selected)}。首拍 ${target[0]} 品将变为 ${source[0]} 品，共替换 ${target.length} 个音。`, '替换并添加记号', apply);
  else apply();
}

function handleApplyMark() {
  if (!draft || draft.kind === 'dc' && playbackPolicy.dc === 'qualified') return;
  const { type, ...fields } = draft;
  const entry = { ...fields, id: fields.id || `mark-${Date.now()}` };
  const error = markError(entry);
  commit(() => {
    score.marks = [...score.marks.filter((item) => item.id !== entry.id), entry];
  }, error ? `已保存 ${markDefinitions[entry.kind].name}。${error.text}` : `已应用 ${markDefinitions[entry.kind].name}。`, `[data-at="${entry.at}"]`);
}

function openTools(fromContext = false) {
  $('#context').hidden = true;
  popup = fromContext || !popup;
  draft = null;
  paint(popup ? '#measure-heading' : '#measure-tool');
}

function restoreFocusAfterHistory() {
  draft = null;
  paint();
}

const actions = {
  tools: (_, control) => openTools(Boolean(control.closest('#context'))),
  'open-popup': () => openTools(true),
  'close-popup': () => { popup = false; paint('#measure-tool'); },
  line: (kind) => commit(() => {
    if (kind === 'scoreStart') score.startRepeat = !score.startRepeat;
    else score.lines[selected] = kind;
  }, `已更新${label(selected)}的小节线。`, `[data-do="line:${kind}"]`),
  room: openRoom,
  'edit-room': existingRoom,
  'delete-room': () => {
    const { id, passes } = draft;
    showConfirmation('删除反复房子？', `删除后，第 ${passes.join('、')} 遍需要补房。试听会在相应遍次的分岔处暂停。`, '删除房子', () =>
      commit(() => { score.rooms = score.rooms.filter((item) => item.id !== id); }, '已删除反复房子，可撤销。', `[data-at="${selected}"]`));
  },
  mark: (kind) => openMark(kind, score.marks.find((item) => item.at === selected && item.kind === kind)),
  'edit-mark': (id) => { const mark = lookup(id); if (mark) openMark(mark.kind, mark); },
  'apply-mark': handleApplyMark,
  'delete-mark': () => {
    const { id, kind } = draft;
    const affectedIds = new Set([id]);
    let changed = true;
    while (changed) {
      const count = affectedIds.size;
      score.marks.filter((item) => (markDefinitions[item.kind].fields ?? []).some((field) => affectedIds.has(item[field])))
        .forEach((item) => affectedIds.add(item.id));
      changed = affectedIds.size > count;
    }
    const affected = score.marks.filter((item) => item.id !== id && affectedIds.has(item.id));
    const note = affected.length ? `以下配对需要修复：${affected.map((item) => `${label(item.at)} ${markDefinitions[item.kind].name}`).join('、')}。` : '可以通过撤销恢复。';
    showConfirmation(`删除 ${markDefinitions[kind].name}？`, note, '删除记号', () =>
      commit(() => { score.marks = score.marks.filter((item) => item.id !== id); }, '已删除记号。', `[data-at="${selected}"]`));
  },
  single: () => setDraft({ type: 'single' }),
  'apply-single': handleApplySingle,
  expand: () => commit(() => { score.singles = score.singles.filter((at) => at !== selected); }, `已展开${label(selected)}，保留演奏内容。`, '#fret-form input'),
  source: () => { selectMeasure(selected - 1); paint('#fret-form input'); },
  cancel: () => { draft = null; paint('[data-do="open-popup"]'); announce('已取消编辑。'); },
  undo: () => { if (!history.length) return; redo.push(score); score = history.pop(); restoreFocusAfterHistory(); announce('已撤销。'); },
  redo: () => { if (!redo.length) return; history.push(score); score = redo.pop(); restoreFocusAfterHistory(); announce('已重做。'); },
  audition: () => {
    if (listening) return exitListening();
    if (draft) { announce('先应用或取消当前表单，再试听。'); return; }
    returnPoint = { anchor, selected, popup };
    startListening();
    paint('.sidebar-head h2');
    announce('已进入只读试听。');
  },
  play: () => {
    if (!listening.visits.length) return;
    if (listening.playing) { stopClock(); paint('[data-do="play"]'); return; }
    if (listening.done) startListening(listening.origin);
    audio ??= new AudioContext();
    void audio.resume();
    listening.playing = true;
    tick('[data-do="play"]');
  },
  stop: () => { stopClock(); startListening(listening.origin); paint('[data-do="stop"]'); },
  step: () => {
    stopClock();
    audio ??= new AudioContext();
    void audio.resume();
    tick('[data-do="step"]');
  },
  repair: () => {
    const { issue } = listening;
    exitListening();
    popup = false;
    selectMeasure(issue.at);
    if (issue.id && lookup(issue.id)) return actions['edit-mark'](issue.id);
    if (issue.pass) {
      const first = between(4, 8).find((at) => !score.rooms.some((room) => room.first <= at && room.last >= at)) ?? 4;
      return setDraft({ type: 'room', first, last: first, passes: [issue.pass] });
    }
    paint(`[data-at="${selected}"]`);
  },
  save: () => {
    $('#file-menu').open = false;
    if (draft) { announce('先应用或取消当前表单，再保存。'); return; }
    snapshots[example] = structuredClone(score);
    try {
      localStorage.setItem(`lxm-combined-review-${example}`, JSON.stringify(score));
      announce('已保存当前谱例的模拟快照。');
    } catch {
      announce('已在当前页面保存模拟快照。');
    }
  },
  load: () => {
    $('#file-menu').open = false;
    let saved = snapshots[example];
    try { saved ??= JSON.parse(localStorage.getItem(`lxm-combined-review-${example}`)); } catch { /* 同页快照仍可使用。 */ }
    if (!saved) { announce('当前谱例还没有模拟快照。'); return; }
    const apply = () => {
      score = structuredClone(saved);
      history = [];
      redo = [];
      selectMeasure(2);
      paint('#measure-tool');
      announce('已重开当前谱例的模拟快照。');
    };
    if (draft || history.length) showConfirmation('重开已保存的谱例？', '当前谱例的修改会被已保存的快照替换。', '重开模拟', apply);
    else apply();
  },
};

function withDraftProtection(next) {
  if (draft) showConfirmation('放弃当前表单？', '表单内的修改尚未应用。', '放弃修改', next);
  else next();
}

function showTooltip(control) {
  const tip = $('#tooltip');
  tip.textContent = control.dataset.tooltip;
  tip.hidden = false;
  const rect = control.getBoundingClientRect();
  const left = rect.left + (rect.width - tip.offsetWidth) / 2;
  tip.style.left = `${Math.max(8, Math.min(innerWidth - tip.offsetWidth - 8, left))}px`;
  tip.style.top = `${rect.bottom + tip.offsetHeight + 14 < innerHeight ? rect.bottom + 7 : rect.top - tip.offsetHeight - 7}px`;
}

function hideTooltip() { $('#tooltip').hidden = true; }

function openContext(at, x, y) {
  withDraftProtection(() => {
    if (at < Math.min(anchor, selected) || at > Math.max(anchor, selected)) selectMeasure(at);
    draft = null;
    paint();
    const menu = $('#context');
    menu.hidden = false;
    menu.style.left = `${Math.min(innerWidth - menu.offsetWidth - 8, x)}px`;
    menu.style.top = `${Math.min(innerHeight - menu.offsetHeight - 8, y)}px`;
    menu.querySelector('button').focus();
  });
}

document.addEventListener('click', (event) => {
  const control = event.target.closest('[data-do]');
  if (control) {
    event.preventDefault();
    if (control.getAttribute('aria-disabled') === 'true') return;
    const [action, value] = control.dataset.do.split(':');
    if (draft && ['tools', 'open-popup'].includes(action)) withDraftProtection(() => actions[action](value, control));
    else actions[action]?.(value, control);
    return;
  }
  if (!event.target.closest('#context')) $('#context').hidden = true;
  const bar = event.target.closest('[data-at]');
  if (!bar || listening) return;
  const at = +bar.dataset.at;
  const room = event.target.closest('[data-edit-room]');
  const mark = event.target.closest('[data-edit-mark]');
  withDraftProtection(() => {
    if (!event.shiftKey && room) return existingRoom(room.dataset.editRoom);
    if (!event.shiftKey && mark) return actions['edit-mark'](mark.dataset.editMark);
    selectMeasure(at, event.shiftKey);
    if (score.singles.includes(at) && !event.shiftKey) return actions.single();
    paint(`[data-at="${at}"]`);
  });
});

document.addEventListener('contextmenu', (event) => {
  const bar = event.target.closest('[data-at]');
  if (!bar || listening) return;
  event.preventDefault();
  openContext(+bar.dataset.at, event.clientX, event.clientY);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('#confirmation').open) {
    if (!$('#tooltip').hidden) return hideTooltip();
    if (!$('#context').hidden) { $('#context').hidden = true; $(`[data-at="${selected}"]`)?.focus(); return; }
    if (draft) return actions.cancel();
    if (popup) { popup = false; paint('#measure-tool'); }
  }
  const bar = event.target.closest('[data-at]');
  if (!bar || listening) return;
  if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
    event.preventDefault();
    const rect = bar.getBoundingClientRect();
    openContext(+bar.dataset.at, rect.left + 10, rect.top + 20);
  }
  if (event.shiftKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault();
    const at = Math.max(1, Math.min(score.frets.length, +bar.dataset.at + (event.key === 'ArrowLeft' ? -1 : 1)));
    withDraftProtection(() => { selectMeasure(at, true); paint(`[data-at="${at}"]`); });
  }
});

document.addEventListener('focusin', (event) => {
  const control = event.target.closest('[data-tooltip]');
  if (control) showTooltip(control);
  else hideTooltip();
});
document.addEventListener('pointerover', (event) => {
  const control = event.target.closest('[data-tooltip]');
  if (control) showTooltip(control);
});
document.addEventListener('pointerout', (event) => {
  const control = event.target.closest('[data-tooltip]');
  if (control && !control.contains(event.relatedTarget) && document.activeElement !== control) hideTooltip();
});
document.addEventListener('focusout', (event) => { if (event.target.matches('[data-tooltip]')) hideTooltip(); });
window.addEventListener('resize', hideTooltip);

document.addEventListener('input', (event) => {
  if (!event.target.closest('#room-form')) return;
  const values = new FormData($('#room-form'));
  draft.first = Number(values.get('first'));
  draft.last = Number(values.get('last'));
  draft.passes = values.getAll('pass').map(Number);
  const error = roomError(draft);
  $('#room-error').textContent = error;
  $('#room-error').hidden = !error;
  $('#room-form button[type="submit"]').disabled = Boolean(error);
  paintScore();
});

document.addEventListener('submit', (event) => {
  if (!['room-form', 'fret-form'].includes(event.target.id)) return;
  event.preventDefault();
  if (event.target.id === 'room-form') {
    if (roomError(draft)) return;
    const { type, ...room } = draft;
    const entry = { ...room, id: room.id || `room-${Date.now()}` };
    commit(() => {
      score.rooms = [...score.rooms.filter((item) => item.id !== entry.id), entry];
      anchor = entry.first;
      selected = entry.last;
    }, '反复房子已应用。', `[data-at="${entry.last}"]`);
  } else {
    const next = Number(new FormData(event.target).get('fret'));
    if (next === score.frets[selected - 1][0]) return;
    const affectsNext = score.singles.includes(selected + 1);
    const sync = playbackPolicy.single === 'sync';
    commit(() => {
      score.frets[selected - 1][0] = next;
      if (affectsNext && sync) score.frets[selected][0] = next;
      if (affectsNext && !sync) score.singles = score.singles.filter((at) => at !== selected + 1);
    }, affectsNext ? `${label(selected + 1)}${sync ? '已同步，保留记号。' : '已展开，保留原演奏内容。'}` : '首拍品位已更新。', '#fret-form input');
  }
});

document.addEventListener('change', (event) => {
  const control = event.target;
  if (control.id === 'example') {
    const next = control.value;
    control.value = example;
    withDraftProtection(() => {
      example = next;
      score = createExample(example);
      selectMeasure(2);
      history = [];
      redo = [];
      popup = true;
      paint('#example');
      announce('已切换评审谱例。');
    });
  } else if (control.dataset.pair) {
    const field = control.dataset.pair;
    draft[field] = control.value;
    if (field === 'segno') {
      for (const dependent of ['fine', 'toCoda'].filter((kind) => markDefinitions[draft.kind].fields.includes(kind))) {
        const candidates = markCandidates(draft, dependent);
        if (!candidates.some((candidate) => candidate.id === draft[dependent])) draft[dependent] = candidates.length === 1 ? candidates[0].id : '';
      }
    }
    paint(`[data-pair="${field}"]`);
  } else if (control.id === 'single-policy' || control.id === 'dc-policy') {
    playbackPolicy[control.id.split('-')[0]] = control.value;
    paint(`#${control.id}`);
  } else if (control.id === 'audition-origin') {
    stopClock();
    startListening(control.value);
    paint('#audition-origin');
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && listening?.playing) {
    stopClock();
    paint();
    announce('页面切到后台，试听已暂停。');
  }
});

paint();
announce('已选中第 2 小节。指向记号或用 Tab 聚焦可查看释义。');
