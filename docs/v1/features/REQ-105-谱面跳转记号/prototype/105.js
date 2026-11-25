const $ = (id) => document.getElementById(id);
const types = {
  segno: { name: 'Segno', score: '𝄋', side: 'start', meaning: '回跳落点，从小节开头接着演奏。' },
  ds: { name: 'D.S.', score: 'D.S.', side: 'end', meaning: '弹完所在小节，回到配对的 Segno。' },
  dsc: { name: 'D.S. al Coda', score: 'D.S. al Coda', side: 'end', meaning: '先回 Segno，再由配对的 To Coda 离开重奏段。' },
  to: { name: 'To Coda', score: 'To Coda', side: 'end', meaning: '首次经过时顺行，指定重奏中弹完本小节再跳。' },
  coda: { name: 'Coda', score: '𝄌', side: 'start', meaning: '尾声落点，从小节开头接着演奏。' },
};
const chords = ['C', 'Am', 'F', 'G', 'C', 'G', 'Am', 'C'];
const idealChords = 'G C Asus2 G G Am D G G Gadd9 Asus2 Gadd9 G Asus2 Dsus2 Gadd9 C G C G C Bm Am Am C G Am G C Bm Am C Dsus4 C C Dsus4 D C G C D7 G'.split(' ');
const demoFrets = {
  C: [[5, 3], [3, 0], [2, 1], [1, 0]], Am: [[5, 0], [3, 2], [2, 1], [1, 0]],
  F: [[6, 1], [4, 3], [2, 1], [1, 1]], G: [[6, 3], [3, 0], [2, 0], [1, 3]],
  D: [[4, 0], [3, 2], [2, 3], [1, 2]], Bm: [[5, 2], [3, 4], [2, 3], [1, 2]],
  Asus2: [[5, 0], [4, 2], [3, 2], [2, 0]], Gadd9: [[6, 3], [3, 2], [2, 0], [1, 3]],
  Dsus2: [[4, 0], [3, 2], [2, 3], [1, 0]], Dsus4: [[4, 0], [3, 2], [2, 3], [1, 3]],
  D7: [[4, 0], [3, 2], [2, 1], [1, 2]],
};
const storageKey = 'lxm-req105-prototype-v1';
const presets = { coda: 'D.S. al Coda 完整示例', pure: '纯 D.S.', empty: '空白练习谱', missing: '悬空配对', ambiguous: '多个同类候选' };
const state = {
  view: '', marks: [], source: 'coda', selected: 6, form: null, snapshot: null, saved: '',
  audition: false, cursor: -1, playing: false, timer: 0, plan: [], planError: null, limit: null,
  route: 'A', reading: 'house', issue: null, nextId: 10,
};

const range = (start, end) => Array.from({ length: end - start + 1 }, (_, i) => start + i);
const title = (type) => types[type].name;
const nameAt = (mark) => `第 ${mark.n} 小节 ${title(mark.kind)}`;
// 本地浏览器不一定有音乐字体，用交叉环和带斜划、双点的 S 保留两个谱面图形。
const musicGlyph = (kind) => `<span class="music-sign ${kind}" aria-hidden="true"><i>${kind === 'segno' ? 'S' : ''}</i></span>`;
const notesAt = (n) => demoFrets[(state.view === 'ideal' ? idealChords : chords)[n - 1]];
const isIdeal = () => state.view === 'ideal';
const savedPayload = () => JSON.stringify({ source: state.source, marks: state.marks, nextId: state.nextId });

function makePreset(kind) {
  const marks = [
    { id: 1, n: 2, kind: 'segno' },
    { id: 2, n: 4, kind: 'to', coda: 4 },
    { id: 3, n: 6, kind: 'dsc', segno: 1, to: 2 },
    { id: 4, n: 8, kind: 'coda' },
  ];
  if (kind === 'empty') return [];
  if (kind === 'pure') return [marks[0], { id: 3, n: 6, kind: 'ds', segno: 1 }];
  if (kind === 'missing') return marks.filter((mark) => mark.kind !== 'coda');
  if (kind === 'ambiguous') {
    return [{ id: 5, n: 1, kind: 'segno' }, marks[0], { ...marks[1], coda: null },
      { ...marks[2], segno: null, to: null }, { id: 6, n: 7, kind: 'coda' }, marks[3]];
  }
  return marks;
}

// 配对候选只取同类记号。已经绑定的目标遗失时保留其 ID，避免删除后悄悄跳到另一处。
function resolve(mark, kind, marks = state.marks) {
  const candidates = marks.filter((candidate) => candidate.kind === kind);
  const field = mark[kind];
  const target = field ? candidates.find((candidate) => candidate.id === field) : candidates.length === 1 ? candidates[0] : null;
  if (target) return { target };
  const error = field ? `原配对的 ${title(kind)} 已删除或改类` : candidates.length ? `有 ${candidates.length} 个 ${title(kind)}，请指定一处` : `缺少 ${title(kind)}，请先插入`;
  return { error };
}

function inspect(mark, marks = state.marks) {
  const problems = [];
  const targets = {};
  const take = (owner, kind) => {
    const { target, error } = resolve(owner, kind, marks);
    if (error) problems.push({ owner, field: kind, text: error });
    else targets[kind] = target;
    return target;
  };
  if (mark.kind === 'ds' || mark.kind === 'dsc') {
    const segno = take(mark, 'segno');
    if (segno && segno.n > mark.n) problems.push({ owner: mark, field: 'segno', text: 'Segno 须位于回跳指令之前或该小节开头' });
    if (mark.kind === 'dsc') {
      const to = take(mark, 'to');
      if (to && segno && (to.n < segno.n || to.n >= mark.n)) {
        problems.push({ owner: mark, field: 'to', text: 'To Coda 须位于 Segno 到回跳指令之间' });
      }
      if (to) {
        const coda = take(to, 'coda');
        if (coda && coda.n <= to.n) problems.push({ owner: to, field: 'coda', text: 'Coda 须位于 To Coda 之后' });
      }
    }
  }
  if (mark.kind === 'to') {
    const coda = take(mark, 'coda');
    if (coda && coda.n <= mark.n) problems.push({ owner: mark, field: 'coda', text: 'Coda 须位于 To Coda 之后' });
  }
  return { problems, targets };
}

// 到访以小节为单位。先播放指令所在小节，下一事件才改变游标和发音位置。
function practicePlan() {
  const plan = [];
  const executed = new Set();
  let armed = null;
  let n = 1;
  let detail = '从谱首开始';
  let jump = null;
  while (n <= 8 && plan.length < 80) {
    plan.push({ n, detail, jump });
    const end = state.marks.find((mark) => mark.n === n && types[mark.kind].side === 'end');
    detail = '';
    jump = null;
    if (end?.kind === 'to') {
      if (armed?.to.id === end.id) {
        detail = `${n} → ${armed.coda.n} · To Coda 跳到 Coda`;
        jump = { from: end.id, to: armed.coda.id };
        n = armed.coda.n;
        armed = null;
        continue;
      }
      detail = `经过第 ${n} 小节 To Coda · 顺行`;
    }
    if (end && (end.kind === 'ds' || end.kind === 'dsc') && !executed.has(end.id)) {
      const { problems, targets } = inspect(end);
      if (problems.length) return { plan, error: { n, ...problems[0] } };
      executed.add(end.id);
      if (end.kind === 'dsc') armed = targets;
      detail = `${n} → ${targets.segno.n} · ${title(end.kind)} 回到 Segno`;
      jump = { from: end.id, to: targets.segno.id };
      n = targets.segno.n;
      continue;
    }
    n++;
  }
  return { plan, error: null };
}

function idealSegments() {
  return [range(1, 33), range(17, state.route === 'A' ? 31 : 34),
    ...(state.route === 'A' ? [[34]] : []), range(25, 31), range(35, 42)];
}

function idealPlan() {
  const segments = idealSegments();
  const plan = segments.flatMap((segment, group) => segment.map((n, offset) => {
    let detail = '';
    if (!offset && !group) detail = '从谱首开始';
    if (state.route === 'B' && group === 1 && n === 34) detail = '第二遍 31 → 32 → 33 → 34 · 顺行';
    if (!offset && group) {
      const prev = segments[group - 1].at(-1);
      const reasons = {
        '33-17': '普通反复', '31-34': '路线 A 跳过 32、33',
        '34-25': '「又一个」→「年代在变幻」',
        '31-35': state.reading === 'house' ? '进入三房 · 花儿再次' : 'To Coda → 共同尾声 · 花儿再次',
      };
      detail = `${prev} → ${n} · ${reasons[`${prev}-${n}`]}`;
    }
    return { n, detail, group };
  }));
  return { plan, error: null };
}

function updatePlan() {
  const result = isIdeal() ? idealPlan() : practicePlan();
  state.plan = result.plan;
  state.planError = result.error;
}

function fretMarkup(n) {
  const notes = notesAt(n);
  return notes.map(([string, fret], index) => `<span class="fret" style="left:${(index + 1) * 100 / (notes.length + 1)}%;top:${(string - 1) * 8}px">${fret}</span>`).join('');
}

function notationMarkup(mark, editable, variant = '') {
  const type = types[mark.kind];
  const name = nameAt(mark);
  const content = type.side === 'start' ? `${musicGlyph(mark.kind)}<span class="sr-only">${type.name}</span>` : type.score;
  const className = `notation ${type.side}${variant ? ` ${variant}` : ''}`;
  if (!editable) return `<span class="${className}" title="${name}">${content}</span>`;
  return `<button type="button" class="${className} notation-button" data-score-mark="${mark.id}" aria-label="编辑${name}" title="编辑${name}">${content}</button>`;
}

function measureMarkup(n) {
  const ideal = isIdeal();
  const editable = !ideal && !state.audition;
  const draft = state.form?.draft;
  const items = ideal ? [] : state.marks.filter((mark) => mark.n === n);
  const draftHere = editable && draft?.n === n;
  const occupied = draftHere && items.some((mark) => mark.id !== draft.id && types[mark.kind].side === types[draft.kind].side);
  let overlay = items.filter((mark) => !draftHere || occupied || mark.id !== draft.id).map((mark) => {
    const unresolved = inspect(mark).problems.length;
    return notationMarkup(mark, editable, unresolved ? 'unresolved' : '');
  }).join('');
  if (draftHere && !occupied) overlay += notationMarkup(draft, false, 'draft');
  let line = '';
  if (ideal) {
    if (n === 17) line = 'repeat-begin';
    if (n === 33) line = 'repeat';
    if (n === 24 || n === 34) line = 'double';
    if (n === 35 && state.reading === 'house') overlay = '<span class="house-demo">3. 起点示意</span>';
    const referenceKind = { 25: 'segno', 31: 'to', 34: 'dsc', 35: 'coda' }[n];
    if (state.reading === 'coda' && referenceKind) overlay = notationMarkup({ n, kind: referenceKind }, false, 'candidate');
  }
  const chord = (ideal ? idealChords : chords)[n - 1];
  const names = items.map((mark) => title(mark.kind));
  const chosen = editable && n === state.selected;
  return `<div class="measure${chosen ? ' selected' : ''}${draftHere ? ' draft-measure' : ''}" data-n="${n}">
      ${editable ? `<button class="measure-select" type="button" aria-label="第 ${n} 小节${names.length ? ` · ${names.join('、')}` : ''}" aria-pressed="${chosen}"></button>` : ''}
      <span class="num">${n}</span>${overlay}<span class="chord">${chord}</span><span class="staff ${line}">${fretMarkup(n)}</span></div>`;
}

function practiceSequence() {
  const visits = state.plan.map(({ n, jump }, index) => {
    return `<li>${index ? `<span class="visit-arrow${jump ? ' jump-arrow' : ''}" aria-hidden="true">${jump ? '↪' : '→'}</span>` : ''}<span class="visit" data-visit="${index}">${n}</span></li>`;
  }).join('');
  return `<section class="practice-sequence" aria-labelledby="sequence-heading"><div class="sequence-heading"><h3 id="sequence-heading">演奏顺序</h3><span id="visit-count">${state.plan.length} 次到访</span></div>
    <ol class="visits">${visits}</ol>
    <p class="hint">↪ 表示跳转${state.planError ? `。第 ${state.planError.n} 小节末暂停，等待补全配对` : ''}。</p></section>`;
}

function renderPaper() {
  const ideal = isIdeal();
  const cols = ideal ? 7 : 4;
  const rows = ideal ? 6 : 2;
  const heading = ideal ? '理想' : '跳转练习';
  const source = ideal ? '谱面写法对照 · TAB 与声音为示意' : '吉他六线谱 · 标准调弦';
  const route = ideal ? `<div class="route-result" aria-label="路线片段"><span>从片段播放</span>${idealSegments().map((segment, i) => `<button data-segment="${i}">${segment[0]}${segment.length > 1 ? `–${segment.at(-1)}` : ''}</button>`).join('')}</div>` : '';
  const sequence = ideal ? '' : practiceSequence();
  $('paper').classList.toggle('ideal', ideal);
  $('paper').innerHTML = `<header class="paper-heading" id="${ideal ? 'ideal' : 'practice'}"><h1>${heading}</h1><p>${source}</p></header>${route}
    ${range(0, rows - 1).map((row) => `<div class="sys" style="--cols:${cols}">${range(row * cols + 1, (row + 1) * cols).map(measureMarkup).join('')}</div>`).join('')}${sequence}`;
  paintCursor(false);
}

function fieldMarkup(form, field, label, problems) {
  const candidates = state.marks.filter((mark) => mark.kind === field);
  const current = form[field];
  const auto = candidates.length === 1 ? `唯一候选 · 第 ${candidates[0].n} 小节` : candidates.length ? '请选择一处' : '暂无候选';
  const missing = current && !candidates.some((mark) => mark.id === current);
  const error = problems.find((problem) => problem.owner.id === form.id && problem.field === field);
  return `<label>${label}<select id="field-${field}" data-field="${field}"${error ? ` aria-invalid="true" aria-describedby="error-${field}"` : ''}>
    <option value="">${auto}</option>${missing ? `<option value="${current}" selected>原目标已删除或改类</option>` : ''}
    ${candidates.map((mark) => `<option value="${mark.id}"${mark.id === current ? ' selected' : ''}>${nameAt(mark)}</option>`).join('')}</select>
    ${error ? `<span class="field-error" id="error-${field}">${error.text}</span>` : ''}</label>`;
}

function markFormMarkup() {
  const { draft, duplicate } = state.form;
  const { problems } = inspect(draft);
  const chained = problems.find((problem) => problem.owner.id !== draft.id);
  const canEditCoda = chained && state.marks.some((mark) => mark.id === chained.owner.id);
  return `<form id="mark-form" class="mark-form">
    <div class="form-heading"><h3>${draft.id ? '编辑记号' : '插入记号'}</h3><span class="draft-key">谱面草稿</span></div>
    <label>记号类型<select id="mark-type" data-field="kind">${Object.keys(types).map((kind) => `<option value="${kind}"${kind === draft.kind ? ' selected' : ''}>${title(kind)}</option>`).join('')}</select></label>
    ${draft.id ? `<label>位置小节<select id="mark-position" data-field="n">${range(1, 8).map((n) => `<option value="${n}"${n === draft.n ? ' selected' : ''}>第 ${n} 小节</option>`).join('')}</select></label>` : ''}
    <p class="hint">第 ${draft.n} 小节${types[draft.kind].side === 'start' ? '开头，与小节线对齐' : '末端，弹完整节后触发'}。</p>
    ${draft.kind === 'ds' || draft.kind === 'dsc' ? fieldMarkup(draft, 'segno', '回到 Segno', problems) : ''}
    ${draft.kind === 'dsc' ? fieldMarkup(draft, 'to', '重奏中的 To Coda', problems) : ''}
    ${draft.kind === 'to' ? fieldMarkup(draft, 'coda', '跳到 Coda', problems) : ''}
    ${chained ? `<p class="field-error">第 ${chained.owner.n} 小节 To Coda · ${chained.text}</p>` : ''}
    ${canEditCoda ? `<button type="button" data-locate="${chained.owner.id}">编辑该 To Coda</button>` : ''}
    ${duplicate ? '<p class="field-error" role="alert">这个小节的同一端已有记号，请编辑现有记号。</p>' : ''}
    <div class="actions"><button class="primary" type="submit">应用</button><button type="button" data-cancel>取消</button>
    ${draft.id ? '<button type="button" class="delete" data-delete>删除</button>' : ''}</div>
  </form>`;
}

function pairingMarkup(mark) {
  const { targets, problems } = inspect(mark);
  const rows = [];
  if (['ds', 'dsc'].includes(mark.kind)) {
    rows.push({ source: mark, target: targets.segno, kind: 'segno', label: '弹完回跳', issue: problems.find(({ field }) => field === 'segno') });
  }
  if (mark.kind === 'dsc' && !targets.to) {
    rows.push({ source: null, target: null, kind: 'to', label: '重奏时找出口', issue: problems.find(({ field }) => field === 'to') });
  }
  const exit = mark.kind === 'to' ? mark : targets.to;
  if (exit) {
    rows.push({ source: exit, target: targets.coda, kind: 'coda', label: '重奏时进入尾声', issue: problems.find(({ field }) => field === 'to' || field === 'coda') });
  }
  if (types[mark.kind].side === 'start') {
    rows.push(...incoming(mark).map((source) => ({ source, target: mark, kind: mark.kind, label: '从这里跳入' })));
  }
  const node = (item) => `<span class="pair-node"><span class="pair-number">${item.n}</span>${title(item.kind)}</span>`;
  if (!rows.length) return '<p class="hint">还没有指令指向此落点。</p>';
  return `<ul class="pairings">${rows.map(({ source, target, kind, label, issue }) => `<li>
    <span class="pair-label">${label}</span>
    <div class="pair-line">${source ? `${source.id === mark.id ? node(source) : `<button type="button" class="pair-link" data-locate="${source.id}" aria-label="编辑${nameAt(source)}">${node(source)}</button>`}<span class="pair-arrow" aria-hidden="true">→</span>` : ''}
      ${target ? target.id === mark.id ? node(target) : `<button type="button" class="pair-link" data-locate="${target.id}" aria-label="编辑${nameAt(target)}">${node(target)}</button>` : `<span class="pair-missing">${title(kind)} 待配对</span>`}</div>
    ${issue ? `<p class="field-error">${issue.text}</p>` : ''}</li>`).join('')}</ul>`;
}

function rehearsalMarkup() {
  const jumps = state.plan.flatMap(({ jump, n }, index) => {
    if (!jump) return [];
    const source = state.marks.find(({ id }) => id === jump.from);
    const target = state.marks.find(({ id }) => id === jump.to);
    return [`<button class="rehearsal" data-preview="${index}" type="button"><span>第 ${source.n} 小节 → 第 ${n} 小节</span><small>${title(source.kind)} → ${title(target.kind)}</small></button>`];
  });
  return jumps.length ? `<div class="subsection"><h3>试听单次跳转</h3><div class="jump-list">${jumps.join('')}</div></div>` : '';
}

function practiceInspector() {
  const at = state.marks.filter((mark) => mark.n === state.selected);
  const groups = Object.entries(types).map(([kind, type]) => `<dt>${title(kind)}${type.score !== type.name ? ` ${musicGlyph(kind)}` : ''}</dt><dd>${type.meaning}</dd>`).join('');
  const issues = state.marks.flatMap((mark) => inspect(mark).problems.filter(({ owner }) => owner.id === mark.id).map((problem) => ({ ...problem, mark })));
  if (state.audition) {
    return `<div class="section-head"><h2>试听</h2><span class="mode-label">谱面只读</span></div><p class="listen-position" id="listen-position">从谱首开始</p><p class="listen-detail" id="listen-detail">用底部控制条播放或逐小节试听。</p>
      ${state.planError ? `<div class="subsection"><p class="notice">第 ${state.planError.n} 小节的跳转待补全。弹完这里后暂停。</p><button data-locate="${state.planError.owner.id}">返回编辑并定位</button></div>` : ''}
      ${rehearsalMarkup()}
      <div class="subsection"><h3>跳转释义</h3><dl class="symbols">${groups}</dl></div>`;
  }
  return `<div class="section-head"><h2 tabindex="-1" id="control-heading">反复与跳转</h2><button id="add-mark">插入记号</button></div>
    ${state.form ? markFormMarkup() : ''}
    ${state.form ? '' : `<div class="marks">${at.length ? at.map((mark) => `<section class="mark-card"><div class="mark-row"><span><strong>${title(mark.kind)}</strong><small>${types[mark.kind].side === 'start' ? '小节开头 · 落点' : '小节末 · 弹完触发'}</small></span><button data-edit="${mark.id}" aria-label="编辑 ${title(mark.kind)}">编辑</button></div>${pairingMarkup(mark)}</section>`).join('') : '<p class="empty-marks">本小节还没有跳转记号。可用右上的「插入记号」添加。</p>'}</div>`}
    ${issues.length ? `<div class="subsection"><h3>配对待补全</h3><div class="jump-list">${issues.map(({ mark, text }) => `<button data-locate="${mark.id}">${nameAt(mark)}<small>${text}</small></button>`).join('')}</div></div>` : ''}
    <div class="subsection"><label for="preset"><strong>练习谱例</strong></label><p class="hint">可切换练习条件，已保存的模拟版本可重开。</p>
    <select id="preset" class="preset">${Object.entries(presets).map(([key, label]) => `<option value="${key}"${state.source === key ? ' selected' : ''}>${label}</option>`).join('')}</select></div>
    <div class="subsection"><details open><summary><strong>符号释义</strong></summary><dl class="symbols">${groups}</dl></details></div>`;
}

function idealInspector() {
  return `<div class="section-head"><h2 tabindex="-1" id="control-heading">反复与跳转</h2></div>
    <div class="routes" aria-label="参考演奏路线">
      <button class="route" data-route="A" aria-pressed="${state.route === 'A'}"><strong>A · 飞书原描述</strong><small>1–33 → 17–31 → 34 → 25–31 → 35–42</small></button>
      <button class="route" data-route="B" aria-pressed="${state.route === 'B'}"><strong>B · 现有实现与飞书备注</strong><small>1–33 → 17–34 → 25–31 → 35–42</small></button>
    </div>
    <p class="reference-note">参考对照 · ${state.route === 'A' ? '64 次到访。第二遍 31 → 34，跳过 32–33。' : '66 次到访。第二遍 31 → 32 → 33 → 34。'}</p>
    <div class="reading"><h3>35 小节 · 谱面写法对照</h3>
      <label><input type="radio" name="reading" value="house"${state.reading === 'house' ? ' checked' : ''}>三房起点</label>
      <label><input type="radio" name="reading" value="coda"${state.reading === 'coda' ? ' checked' : ''}>共同尾声 · Coda</label>
      <p class="muted">${state.reading === 'house' ? '重奏仍弹 25–31，31 后进入三房。谱面只示意起点，房子归属、起止和第三遍判定取决于完整记谱。' : '重奏仍弹 25–31。在 31 末执行 To Coda，从 35 的 Coda 开始。房子边界由谱面括线标明。'}</p>
    </div>
    <div class="subsection"><h3>试听关键衔接</h3><div class="jump-list">
      <button data-edge="33-17">33 → 17<small>保留首轮普通反复</small></button>
      ${state.route === 'A' ? '<button data-edge="31-34">31 → 34<small>第二遍跳过 32–33</small></button>' : '<button data-edge="31-32">31 → 32 → 33 → 34<small>第二遍顺行</small></button>'}
      <button data-edge="34-25">34 → 25<small>「又一个」→「年代在变幻」 · 两小节均标 C</small></button>
      <button data-edge="31-35">31 → 35<small>「却依然天真地相信」→「花儿再次」</small></button>
    </div></div>
    <div class="subsection"><details><summary><strong>谱件与工单依据</strong></summary><p class="hint">谱件的 32–33 与 34 均含「沉入失望的生活里」，34 末还有「又一个」。本页第 35 节用谱件中的短标记。拟议括线和跳转符号供对照。</p><p class="hint"><a href="review.html">历史对照记录</a></p></details></div>`;
}

function renderInspector(focusId) {
  $('selection-label').textContent = isIdeal() ? '路线对照' : state.audition ? '试听进度' : `第 ${state.selected} 小节`;
  $('inspector-content').innerHTML = isIdeal() ? idealInspector() : practiceInspector();
  if (focusId) $(focusId)?.focus();
}

function render() {
  const ideal = isIdeal();
  $('document-name').textContent = ideal ? '理想' : '跳转练习';
  for (const [id, active] of [['practice-link', !ideal], ['ideal-link', ideal]]) {
    if (active) $(id).setAttribute('aria-current', 'page');
    else $(id).removeAttribute('aria-current');
  }
  $('save').disabled = ideal || state.audition;
  $('reopen').disabled = ideal || state.audition;
  $('measure-tool').disabled = !ideal && state.audition;
  $('audition').textContent = state.audition ? '退出试听' : '试听';
  $('audition').setAttribute('aria-pressed', String(state.audition));
  renderPaper();
  renderInspector();
  paintCursor(false);
}

function report(message) { $('file-state').textContent = message; }

function syncFileState() {
  const current = savedPayload();
  report(isIdeal() ? '参考对照 · 实际演奏顺序由谱面符号规定' : current === state.saved ? '模拟版本已保存' : state.saved ? '有未保存的修改' : '交互原型 · 保存模拟');
}

function canLeaveForm() {
  return !state.form?.dirty || window.confirm('放弃未应用的记号编辑？');
}

function selectMeasure(n, focus = false) {
  if (n !== state.selected && !canLeaveForm()) return false;
  if (n !== state.selected) state.form = null;
  state.selected = n;
  renderPaper();
  renderInspector();
  if (focus) document.querySelector(`[data-n="${n}"] .measure-select`)?.focus({ preventScroll: true });
  return true;
}

function editMark(id) {
  if (state.form?.draft.id === id) return $('mark-type').focus();
  if (!canLeaveForm()) return;
  const original = state.marks.find((mark) => mark.id === id);
  if (!original) return;
  stopPlayback();
  state.audition = false;
  state.selected = original.n;
  state.form = { draft: { ...original }, dirty: false };
  render();
  document.querySelector(`[data-n="${original.n}"]`)?.scrollIntoView({ block: 'nearest' });
  $('mark-type').focus();
}

function insertMark() {
  if (!canLeaveForm()) return;
  const at = state.marks.filter((mark) => mark.n === state.selected);
  const kind = at.some((mark) => types[mark.kind].side === 'start') ? 'dsc' : 'segno';
  state.form = { draft: { n: state.selected, kind }, dirty: false };
  renderPaper();
  renderInspector('mark-type');
}

function cancelForm() {
  const id = state.form?.draft.id;
  state.form = null;
  renderPaper();
  renderInspector(id ? undefined : 'add-mark');
  if (id) document.querySelector(`[data-edit="${id}"]`)?.focus();
}

function commitForm() {
  const draft = { ...state.form.draft };
  const duplicate = state.marks.some((mark) => mark.id !== draft.id && mark.n === draft.n && types[mark.kind].side === types[draft.kind].side);
  if (duplicate) {
    state.form.duplicate = true;
    renderInspector('mark-type');
    return;
  }
  const activeFields = draft.kind === 'dsc' ? ['segno', 'to'] : draft.kind === 'ds' ? ['segno'] : draft.kind === 'to' ? ['coda'] : [];
  for (const field of ['segno', 'to', 'coda']) {
    if (!activeFields.includes(field)) delete draft[field];
    else if (!draft[field]) draft[field] = resolve(draft, field).target?.id ?? null;
  }
  const original = state.marks.find((mark) => mark.id === draft.id);
  if (original && original.kind !== draft.kind && !confirmImpact(original, '改类')) return;
  if (draft.id) state.marks = state.marks.map((mark) => mark.id === draft.id ? draft : mark);
  else state.marks.push({ ...draft, id: state.nextId++ });
  state.selected = draft.n;
  state.form = null;
  updatePlan();
  render();
  const error = inspect(draft).problems.length;
  report(error ? `已应用第 ${draft.n} 小节 · 配对待补全` : `已应用第 ${draft.n} 小节 ${title(draft.kind)}`);
  $('add-mark').focus();
}

function incoming(mark) {
  return state.marks.filter((owner) => {
    const field = mark.kind;
    const uses = (field === 'segno' && ['ds', 'dsc'].includes(owner.kind)) || (field === 'to' && owner.kind === 'dsc') || (field === 'coda' && owner.kind === 'to');
    return uses && resolve(owner, field).target?.id === mark.id;
  });
}

function confirmImpact(mark, action) {
  const owners = incoming(mark);
  if (action === '改类' && owners.length && !window.confirm(`改类会使${owners.map(nameAt).join('、')}的配对悬空。继续改类？`)) return false;
  // 固定原有效目标，即使原来按唯一候选解析，也能准确呈现删除影响。
  for (const owner of owners) owner[mark.kind] = mark.id;
  return true;
}

function deleteMark() {
  const mark = state.marks.find((item) => item.id === state.form.draft.id);
  const owners = incoming(mark);
  const downstream = mark.kind === 'coda' ? owners.flatMap(incoming) : [];
  $('confirm-title').textContent = `删除${nameAt(mark)}？`;
  $('confirm-text').textContent = owners.length ? `会使${owners.map(nameAt).join('、')}的配对悬空${downstream.length ? `，并影响${downstream.map(nameAt).join('、')}` : ''}。请重新指定目标，试听遇到未补全的跳转时会暂停。` : '应用后，谱面将移除此记号。';
  const dialog = $('confirm');
  dialog.returnValue = '';
  dialog.addEventListener('close', () => {
    if (dialog.returnValue !== 'confirm') return;
    confirmImpact(mark, '删除');
    state.marks = state.marks.filter((item) => item.id !== mark.id);
    state.form = null;
    updatePlan();
    render();
    report(`已删除${nameAt(mark)}${owners.length ? ' · 有配对待补全' : ''}`);
    $('add-mark').focus();
  }, { once: true });
  dialog.showModal();
}

function changePreset(source) {
  state.marks = makePreset(source);
  state.source = source;
  state.selected = source === 'empty' ? 1 : 6;
  state.nextId = 10;
  state.form = null;
  stopPlayback();
  updatePlan();
  render();
  report(`已载入${presets[source]}`);
}

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
    notesAt(n).forEach(([string, fret], index) => {
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
  document.querySelector('.visit[aria-current]')?.removeAttribute('aria-current');
  document.querySelector('.rehearsal[aria-current]')?.removeAttribute('aria-current');
  const item = state.plan[state.cursor];
  if (item) {
    const node = document.querySelector(`[data-n="${item.n}"]`);
    node?.classList.add('playing');
    document.querySelector(`[data-visit="${state.cursor}"]`)?.setAttribute('aria-current', 'step');
    document.querySelector(`[data-preview="${state.cursor}"]`)?.setAttribute('aria-current', 'step');
    if (follow && $('follow').checked) node?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  $('playing-label').classList.toggle('active', Boolean(item));
  const status = state.issue || (item ? `第 ${item.n} 小节 · 到访 ${state.cursor + 1}/${state.plan.length}${item.detail ? ` · ${item.detail}` : ''}` : isIdeal() ? '试听路线 · 选择一条路线或一个衔接' : '示意音 · 从谱首试听');
  $('playing-label').textContent = status;
  if ($('visit-count')) $('visit-count').textContent = item ? `到访 ${state.cursor + 1} / ${state.plan.length}` : `${state.plan.length} 次到访`;
  if ($('listen-position')) {
    $('listen-position').textContent = item ? `第 ${item.n} 小节` : '从谱首开始';
    const next = state.plan[state.cursor + 1];
    const atToCoda = item && state.marks.some((mark) => mark.n === item.n && mark.kind === 'to');
    let detail = '用底部控制条播放或逐小节试听。';
    if (item?.jump) detail = item.detail;
    else if (item && next?.jump) detail = `弹完本小节后跳到第 ${next.n} 小节。`;
    else if (atToCoda && next) detail = '本次经过 To Coda，继续顺行。';
    else if (item && next) detail = '顺行至下一小节。';
    else if (item) detail = state.planError ? '弹完本小节后暂停，等待补全配对。' : '演奏到谱尾。';
    $('listen-detail').textContent = state.issue || detail;
  }
  $('play').textContent = state.playing ? '暂停' : item && !state.issue && state.cursor < playbackEnd() ? '继续' : '播放';
  $('back').disabled = state.cursor < 1;
  $('step').disabled = state.cursor >= state.plan.length - 1 && Boolean(state.issue);
  $('stop').disabled = !item && !state.playing;
}

function playbackEnd() { return state.limit ?? state.plan.length - 1; }

function pausePlayback() {
  clearTimeout(state.timer);
  state.playing = false;
  silence();
}

function stopPlayback() {
  pausePlayback();
  state.cursor = -1;
  state.limit = null;
  state.issue = null;
  paintCursor(false);
}

function enableAudition() {
  if (state.audition || isIdeal()) return true;
  if (!canLeaveForm()) return false;
  state.form = null;
  state.audition = true;
  updatePlan();
  render();
  return true;
}

function advance(sound = true) {
  if (state.cursor >= playbackEnd()) {
    pausePlayback();
    const last = state.plan[state.cursor];
    state.issue = state.planError && state.limit === null
      ? `第 ${state.planError.n} 小节 · 试听已暂停 · ${state.planError.text}`
      : `第 ${last?.n ?? 1} 小节 · 到访 ${state.cursor + 1}/${state.plan.length}${last?.detail ? ` · ${last.detail}` : ''} · ${state.limit === null ? '试听结束' : '片段试听结束'}`;
    paintCursor();
    return;
  }
  state.issue = null;
  state.cursor++;
  paintCursor();
  if (sound) playSound(state.plan[state.cursor].n);
  if (state.playing) state.timer = window.setTimeout(advance, isIdeal() ? 510 : 690);
}

function autoplay(start, end = null) {
  if (!enableAudition()) return;
  stopPlayback();
  state.limit = end;
  state.cursor = start - 1;
  state.playing = true;
  advance();
}

function compare(route, reading) {
  stopPlayback();
  state.route = route;
  state.reading = reading;
  updatePlan();
  render();
  document.querySelector(`.route[data-route="${route}"]`)?.focus({ preventScroll: true });
}

function switchView() {
  const view = location.hash === '#ideal' ? 'ideal' : 'practice';
  if (view === state.view) return;
  if (!canLeaveForm()) {
    history.replaceState(null, '', state.view === 'ideal' ? '#ideal' : '#practice');
    return;
  }
  state.form = null;
  state.audition = false;
  state.view = view;
  stopPlayback();
  updatePlan();
  render();
  document.querySelector('.canvas').scrollTop = 0;
  $('inspector-content').scrollTop = 0;
  syncFileState();
}

$('paper').addEventListener('click', (event) => {
  const segment = event.target.closest('[data-segment]');
  if (segment) {
    const group = Number(segment.dataset.segment);
    const first = state.plan.findIndex((item) => item.group === group);
    return autoplay(first, first + idealSegments()[group].length - 1);
  }
  const mark = event.target.closest('[data-score-mark]');
  if (mark) return editMark(Number(mark.dataset.scoreMark));
  const node = event.target.closest('[data-n]');
  if (node && !state.audition && !isIdeal()) selectMeasure(Number(node.dataset.n), true);
});

function showContext(n, x, y) {
  if (state.audition || isIdeal() || !selectMeasure(n)) return;
  const menu = $('context-menu');
  menu.style.left = `${Math.min(x, window.innerWidth - 190)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - 55)}px`;
  menu.hidden = false;
  $('context-entry').focus();
}

$('paper').addEventListener('contextmenu', (event) => {
  const node = event.target.closest('[data-n]');
  if (!node || state.audition || isIdeal()) return;
  event.preventDefault();
  showContext(Number(node.dataset.n), event.clientX, event.clientY);
});
$('paper').addEventListener('keydown', (event) => {
  if (!(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) return;
  const node = event.target.closest('[data-n]');
  if (!node) return;
  event.preventDefault();
  const rect = node.getBoundingClientRect();
  showContext(Number(node.dataset.n), rect.left + 10, rect.top + 20);
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
    document.querySelector(`[data-n="${state.selected}"] .measure-select`)?.focus();
  } else if (state.audition) $('audition').click();
  else if (state.form && event.target.closest('#mark-form')) cancelForm();
});

$('inspector-content').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.id === 'add-mark') insertMark();
  if (button.hasAttribute('data-cancel')) cancelForm();
  if (button.hasAttribute('data-delete')) deleteMark();
  if (button.dataset.edit || button.dataset.locate) editMark(Number(button.dataset.edit || button.dataset.locate));
  if (button.dataset.route) compare(button.dataset.route, state.reading);
  if (button.dataset.preview) {
    const arrival = Number(button.dataset.preview);
    autoplay(arrival - 1, arrival);
  }
  if (button.dataset.edge) {
    const [from, to] = button.dataset.edge.split('-').map(Number);
    const first = state.plan.findIndex((item, i) => item.n === from && state.plan[i + 1]?.n === to && (to !== 32 || item.group === 1));
    autoplay(first, first + (to === 32 ? 3 : 1));
  }
});
$('inspector-content').addEventListener('change', (event) => {
  const element = event.target;
  if (element.name === 'reading') {
    compare(state.route, element.value);
    document.querySelector(`input[name="reading"][value="${element.value}"]`)?.focus({ preventScroll: true });
  }
  if (element.id === 'preset') {
    if (canLeaveForm() && (!state.marks.length || savedPayload() === state.saved || window.confirm('切换练习谱例并替换当前内容？'))) changePreset(element.value);
    else element.value = state.source;
    $('preset')?.focus();
  }
  const field = element.dataset.field;
  if (field && state.form) {
    state.form.draft[field] = field === 'kind' ? element.value : Number(element.value) || null;
    state.form.dirty = true;
    state.form.duplicate = false;
    renderPaper();
    renderInspector(element.id);
  }
});
$('inspector-content').addEventListener('submit', (event) => {
  if (event.target.id !== 'mark-form') return;
  event.preventDefault();
  commitForm();
});

$('save').onclick = () => {
  $('file-menu').open = false;
  if (state.form?.dirty) return report('先应用或取消记号编辑，再保存模拟。');
  state.snapshot = state.saved = savedPayload();
  try {
    localStorage.setItem(storageKey, state.saved);
    report('模拟版本已保存 · 可在文件菜单重开');
  } catch { report('已保存到当前页面 · 可在文件菜单重开'); }
};
$('reopen').onclick = () => {
  $('file-menu').open = false;
  if (!canLeaveForm()) return;
  let snapshot = state.snapshot;
  try { snapshot ||= localStorage.getItem(storageKey); } catch { /* 当前页面仍可回读。 */ }
  if (!snapshot) return report('还没有模拟存档。先选择「保存模拟」。');
  if (snapshot !== savedPayload() && !window.confirm('重开保存的版本并替换当前编辑？')) return;
  try {
    const data = JSON.parse(snapshot);
    if (!Array.isArray(data.marks) || !(data.source in presets)) throw new Error('invalid snapshot');
    Object.assign(state, data, { form: null, saved: snapshot });
  } catch { return report('模拟存档无法读取'); }
  stopPlayback();
  updatePlan();
  render();
  report('已重开模拟存档 · 记号可继续编辑');
};

$('audition').onclick = () => {
  if (isIdeal()) return autoplay(0);
  if (!state.audition) return enableAudition();
  stopPlayback();
  state.audition = false;
  render();
  $('audition').focus();
};
$('play').onclick = () => {
  if (!enableAudition()) return;
  if (state.playing) { pausePlayback(); paintCursor(); return; }
  if (state.cursor === -1 || state.issue || state.cursor >= playbackEnd()) return autoplay(0);
  state.playing = true;
  advance();
};
$('step').onclick = () => {
  if (!enableAudition()) return;
  pausePlayback();
  state.limit = null;
  advance();
};
$('back').onclick = () => {
  pausePlayback();
  state.issue = null;
  state.limit = null;
  state.cursor = Math.max(0, state.cursor - 1);
  paintCursor();
  playSound(state.plan[state.cursor].n);
};
$('stop').onclick = stopPlayback;
$('follow').onchange = () => paintCursor();
$('sound').onchange = () => { if (!$('sound').checked) silence(); };
window.addEventListener('hashchange', switchView);
window.addEventListener('pagehide', stopPlayback);
state.marks = makePreset(state.source);
switchView();
