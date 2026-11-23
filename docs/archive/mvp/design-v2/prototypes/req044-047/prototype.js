(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const clone = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const svg = content => `<svg class="icon" viewBox="0 0 28 28" aria-hidden="true">${content}</svg>`;
  const icons = {
    trash: svg('<path d="M5 7h18M11 7V4h6v3M8 7l1 17h10l1-17M12 11v9m4-9v9"/>'),
    add: svg('<path d="M5 5h13v18H5ZM21 8v10m-5-5h10M9 10h5m-5 5h5"/>'),
    copy: svg('<path d="M9 8h14v17H9ZM5 20H3V3h15v2"/>'),
    measure: svg('<path d="M5 5v18m18-18v18M5 9h18M5 13h18M5 17h18M5 21h18M11 5v18M17 5v18"/>'),
    chord: svg('<path d="M5 6h18v18H5ZM5 11h18M5 16h18M5 21h18M10 6v18M15 6v18M20 6v18M5 6V3m6 3V3m6 3V3m6 3V3"/><circle cx="10" cy="13.5" r="2" fill="currentColor"/><circle cx="20" cy="18.5" r="2" fill="currentColor"/>'),
    rhythm: svg('<path d="M7 21V6h15v15M7 6l15-2v4L7 10Z"/><ellipse cx="4" cy="22" rx="3" ry="2" fill="currentColor"/><ellipse cx="19" cy="22" rx="3" ry="2" fill="currentColor"/>'),
    technique: svg('<path d="M5 23V13C5 2 16 0 22 11l2-4M19 19q2-4 4 0t4 0"/><circle cx="3" cy="23" r="2" fill="currentColor"/>'),
    hammerOn: svg('<path d="M3 22Q14 5 25 22"/><path d="M10 5v9m8-9v9m-8-5h8"/>'),
    pullOff: svg('<path d="M3 22Q14 5 25 22M11 14V4h5a3 3 0 0 1 0 6h-5"/>'),
    slideUp: svg('<path d="m5 22 17-17m-6 0h6v6"/>'),
    slideDown: svg('<path d="m5 5 17 17m-6 0h6v-6"/>'),
    tie: svg('<path d="M3 20Q14 3 25 20"/>'),
    bend: svg('<path d="M4 23Q16 25 19 4m-4 4 4-4 4 4"/><text x="2" y="12" stroke="none" fill="currentColor" font-size="9">full</text>'),
    vibrato: svg('<path d="M2 15q3-12 6 0t6 0t6 0t6 0"/>'),
    naturalHarmonic: svg('<path d="m14 3 7 11-7 11-7-11Z"/>'),
    artificialHarmonic: svg('<path d="m8 5 6 9-6 9-6-9Z"/><text x="16" y="20" stroke="none" fill="currentColor" font-size="13">A</text>'),
    tapping: svg('<path d="M6 5h16M14 5v19"/>'),
    trill: svg('<text x="3" y="20" stroke="none" fill="currentColor" font-size="21" font-style="italic" font-family="Georgia">tr</text>'),
    strum: svg('<path d="M6 7h16M6 12h16M6 17h16M6 22h16M14 24V3m-4 4 4-4 4 4"/>'),
    arpeggio: svg('<path d="M13 25q-8-3 0-6t0-6t0-6V2m-4 4 4-4 4 4"/>'),
    pickStroke: svg('<path d="m5 5 9 19 9-19M7 5h14"/>'),
    palmMute: svg('<text x="1" y="17" stroke="none" fill="currentColor" font-size="10">P.M.</text><path d="M2 23h24" stroke-dasharray="3 3"/>'),
    letRing: svg('<text x="1" y="15" stroke="none" fill="currentColor" font-size="8">let ring</text><path d="M2 21h24v-4" stroke-dasharray="3 2"/>')
  };
  const ratios = [
    { actual: 2, normal: 3, name: '二连音' }, { actual: 3, normal: 2, name: '三连音' },
    { actual: 4, normal: 3, name: '四连音' }, { actual: 5, normal: 4, name: '5:4' },
    { actual: 5, normal: 3, name: '5:3' }, { actual: 6, normal: 4, name: '六连音' }
  ];
  const techniques = [
    ['hammerOn', '击弦 H', 0], ['pullOff', '勾弦 P', 0], ['slideUp', '上滑音', 0], ['slideDown', '下滑音', 0], ['tie', '延音线', 0],
    ['bend', '推弦', 1], ['vibrato', '颤音', 1], ['naturalHarmonic', '自然泛音', 1], ['artificialHarmonic', '人工泛音', 1], ['tapping', '点弦 T', 1], ['trill', '颤音奏 tr', 1],
    ['strum', '扫弦', 2], ['arpeggio', '琶音', 2], ['pickStroke', '拨片方向', 2], ['palmMute', '手掌闷音', 2], ['letRing', 'Let Ring', 2]
  ];
  const common = [
    ['quarter', '四分音符', [4]], ['eighths', '两个八分', [2, 2]], ['eight-sixteen', '前八后十六', [2, 1, 1]], ['sixteen-eight', '前十六后八', [1, 1, 2]],
    ['sixteenths', '四个十六分', [1, 1, 1, 1]], ['dotted-eight', '附点八分＋十六', [3, 1]], ['small-syncopation', '小切分', [1, 2, 1]], ['reverse-dotted', '十六＋附点八分', [1, 3]],
    ['dotted-two-thirtyseconds', '附点八分＋两三十二', [3, .5, .5]], ['two-thirtyseconds-dotted', '两三十二＋附点八分', [.5, .5, 3]], ['eighth-four-thirtyseconds', '八分＋四三十二', [2, .5, .5, .5, .5]], ['four-thirtyseconds-eighth', '四三十二＋八分', [.5, .5, .5, .5, 2]]
  ];
  const compound = [['dotted-quarter', '附点四分', [6]], ['three-eighths', '三个八分', [2, 2, 2]], ['quarter-eight', '四分＋八分', [4, 2]], ['eight-quarter', '八分＋四分', [2, 4]], ['six-sixteenths', '六个十六分', [1, 1, 1, 1, 1, 1]]];
  const barlines = [['single', '单小节线'], ['double', '双小节线'], ['final', '终止线'], ['repeatStart', '开始反复'], ['repeatEnd', '结束反复'], ['repeatBoth', '双向反复']];
  const durations = [[16, '全音符'], [8, '二分音符'], [4, '四分音符'], [2, '八分音符'], [1, '十六分音符'], [.5, '三十二分音符']];
  const s = { req: '044', panel: null, tab: 'note', scenario: 'continuous', layer: 'tab', meter: '4/4', count: 3, current: 1, selected: [0, 1, 2], crossbar: false, chordSelection: false, doc: null, history: [], template: 'eight-sixteen', rhythmConfirm: false, deleteConfirm: false, pending: null, replacement: null, explicitTechnique: null, stale: false, fine: false, message: '就绪', zoom: 125, revision: 0, busy: false };
  let uid = 1000, returnFocus = null, toastTimer;
  const layerName = () => s.layer === 'tab' ? 'TAB 六线谱' : '简谱';
  const library = () => s.meter === '6/8' ? compound : common;
  const unit = () => s.meter === '6/8' ? 6 : 4;
  const total = () => s.meter === '4/4' ? 16 : 12;
  const current = () => s.doc.bars[s.current];
  const events = () => current().events;
  const firstIndex = () => Math.min(...s.selected);
  const selectedEvents = () => s.selected.map(i => events()[i]).filter(Boolean);
  const nameOf = type => techniques.find(t => t[0] === type)?.[1] || type;
  const tupletIcon = (value, ratio = false) => `<svg class="tuplet-icon" viewBox="0 0 38 24" aria-hidden="true"><path d="M2 5v11h8m18 0h8V5"/><text x="19" y="20" text-anchor="middle" style="font-size:${ratio ? 10 : 12}px">${value}</text></svg>`;
  function durationIcon(value) {
    const flags = value <= 2 ? Math.log2(4 / value) : 0;
    return svg(`<ellipse cx="11" cy="21" rx="4" ry="2.7" transform="rotate(-20 11 21)" ${value >= 8 ? 'fill="white" stroke="currentColor"' : 'fill="currentColor"'}/>${value < 16 ? '<path d="M15 20V3"/>' : ''}${Array.from({ length: flags }, (_, i) => `<path d="M15 ${3 + i * 5}q11 4 5 11"/>`).join('')}`);
  }
  function barlineIcon(type) {
    return `<svg viewBox="0 0 30 28" aria-hidden="true"><path d="M12 3v22" stroke="currentColor" stroke-width="${['repeatStart', 'repeatBoth'].includes(type) ? 3 : 1}"/>${type !== 'single' ? `<path d="M18 3v22" stroke="currentColor" stroke-width="${['final', 'repeatEnd'].includes(type) ? 3 : 1}"/>` : ''}${['repeatEnd', 'repeatBoth'].includes(type) ? '<circle cx="6" cy="11" r="1.5" fill="currentColor"/><circle cx="6" cy="17" r="1.5" fill="currentColor"/>' : ''}${['repeatStart', 'repeatBoth'].includes(type) ? '<circle cx="24" cy="11" r="1.5" fill="currentColor"/><circle cx="24" cy="17" r="1.5" fill="currentColor"/>' : ''}</svg>`;
  }
  function disabledWrap(content, reason = '') {
    return `<span class="disabled-tip" ${reason ? `tabindex="0" title="${esc(reason)}" aria-label="${esc(reason)}"` : ''}>${content}</span>`;
  }
  function seed() {
    const number = s.scenario === 'only' ? 1 : 8;
    s.doc = { bars: Array.from({ length: number }, (_, m) => ({ id: `bar-${++uid}`, chord: ['G', 'C', 'Em', 'G', 'Am', 'D', 'G', 'G'][m], barline: m === number - 1 ? 'final' : 'single', events: Array.from({ length: total() / 2 }, (_, i) => ({ id: `note-${++uid}`, start: i * 2, duration: 2, base: 2, dots: 0, fret: [0, 2, 3, 2, 0, 0, 3, 2][i], pitch: [3, 4, 5, 4, 3, 3, 5, 4][i], kind: 'note', lyric: ['风', '吹', '过', '山', '谷', '带', '来', '信'][i], state: null })), tuplet: null })), techniques: [], startRepeat: false };
    s.current = ['first', 'only'].includes(s.scenario) ? 0 : s.scenario === 'last' ? number - 1 : 1;
    s.crossbar = s.scenario === 'crossbar'; s.chordSelection = s.scenario === 'chord';
    s.selected = s.scenario === 'none' ? [] : ['single', 'chord'].includes(s.scenario) ? [0] : Array.from({ length: s.count }, (_, i) => i);
    s.explicitTechnique = null;
    if (['technique', 'multi-technique'].includes(s.scenario)) {
      s.doc.techniques.push({ id: `tech-${++uid}`, barId: current().id, eventIds: [events()[0].id], type: 'vibrato', detail: '' });
      if (s.scenario === 'multi-technique') s.doc.techniques.push({ id: `tech-${++uid}`, barId: current().id, eventIds: [events()[1].id], type: 'tapping', detail: '' });
    }
    if (s.scenario === 'tuplet') current().tuplet = { actual: s.count, normal: ratios.find(r => r.actual === s.count).normal, eventIds: selectedEvents().map(e => e.id) };
    s.history = []; s.pending = null; s.replacement = null; s.deleteConfirm = false; s.rhythmConfirm = false; s.stale = false; s.revision++; s.message = `${layerName()} · ${location()}`;
  }
  function location() {
    if (!s.selected.length) return '未选择谱面目标';
    if (s.crossbar) return `第 ${s.current + 1}–${s.current + 2} 小节 · 跨小节选区`;
    return `第 ${s.current + 1} 小节 · ${s.selected.length === 1 ? `第 ${firstIndex() + 1} 拍点` : `连续 ${s.selected.length} 个实际拍点`}${s.chordSelection ? ' · 第 1–3 弦' : ''}`;
  }
  function commit(message, mutate) {
    const before = clone({ doc: s.doc, current: s.current, selected: s.selected, explicitTechnique: s.explicitTechnique });
    mutate();
    if (JSON.stringify(before.doc) === JSON.stringify(s.doc)) { toast('当前已是此状态，未新增撤销记录', false); return false; }
    s.history.push(before); s.revision++; s.message = message; s.rhythmConfirm = false; s.deleteConfirm = false; s.stale = false;
    render(); toast(message, true); return true;
  }
  function undo() {
    const previous = s.history.pop(); if (!previous) return;
    Object.assign(s, previous); s.revision++; s.pending = null; s.replacement = null; s.rhythmConfirm = false; s.deleteConfirm = false; s.stale = false;
    s.message = '已撤销上一次修改，恢复音符、歌词与相关标记'; render(); toast(s.message, false);
  }
  function toast(message, undoable = false) {
    clearTimeout(toastTimer); $('toast-message').textContent = message; $('toast-undo').hidden = !undoable; $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6500);
  }
  function selectedMarks() {
    const ids = new Set(selectedEvents().map(e => e.id));
    return s.doc.techniques.filter(t => t.barId === current().id && t.eventIds.some(id => ids.has(id)));
  }
  function uniqueTechnique() {
    const marks = selectedMarks();
    return marks.find(t => t.id === s.explicitTechnique) || (marks.length === 1 ? marks[0] : null);
  }
  function rhythmScope() {
    if (!s.selected.length) return { error: '请先在活动谱层选择音符或连续选区。' };
    if (s.crossbar) return { error: '选区跨越小节，请改选同一小节内的范围。' };
    const source = selectedEvents(), start = Math.floor(source[0].start / unit()) * unit();
    const last = source[source.length - 1], end = Math.min(total(), Math.ceil((last.start + last.duration) / unit()) * unit());
    return { start, end, count: (end - start) / unit(), first: start / unit() + 1, last: end / unit() };
  }
  function rhythmPlan() {
    const scope = rhythmScope(), template = library().find(t => t[0] === s.template) || library()[0];
    const p = { ...scope, template, before: [], after: [], removed: [], added: 0, groups: [] };
    if (scope.error) return p;
    p.before = events().filter(e => e.start < scope.end && e.start + e.duration > scope.start);
    if (p.before.some(e => e.kind !== 'gap' && (e.start < scope.start || e.start + e.duration > scope.end))) { p.error = '发声事件跨出完整处理范围，请扩大选区，避免截断内容。'; return p; }
    if (current().tuplet) {
      const insideIds = new Set(p.before.map(e => e.id));
      const group = current().tuplet;
      if (group.eventIds.some(id => insideIds.has(id)) && !group.eventIds.every(id => insideIds.has(id))) { p.error = '选区只包含部分连音组，请扩大到完整连音组再应用。'; return p; }
      if (group.eventIds.every(id => insideIds.has(id))) p.removed.push({ type: 'tuplet', name: '连音组' });
    }
    for (let start = scope.start; start < scope.end; start += unit()) {
      const contents = events().filter(e => e.start >= start && e.start < start + unit() && (e.kind !== 'gap' || e.lyric));
      if (contents.length > template[2].length) { p.error = `第 ${start / unit() + 1} 拍有 ${contents.length} 个内容，模板仅 ${template[2].length} 个位置。请换用更多位置的模板。`; return p; }
      let cursor = start;
      const group = template[2].map((duration, i) => {
        const original = contents[i];
        const item = original ? { ...clone(original), start: cursor, duration, base: duration, dots: 0 } : { id: `gap-${current().id}-${cursor}-${duration}`, start: cursor, duration, base: duration, dots: 0, kind: 'gap', lyric: '' };
        if (!original) p.added++; cursor += duration; return item;
      });
      p.after.push(...group); p.groups.push(group);
    }
    const ids = new Set(p.before.map(e => e.id));
    p.removed.push(...s.doc.techniques.filter(t => t.barId === current().id && t.eventIds.some(id => ids.has(id))).map(t => ({ ...t, name: nameOf(t.type) })));
    return p;
  }
  function rhythmSVG(values) {
    const xs = values.map((_, i) => values.length === 1 ? 63 : 11 + i * 112 / (values.length - 1));
    let g = values.map((v, i) => `<ellipse cx="${xs[i]}" cy="31" rx="4.7" ry="3" transform="rotate(-18 ${xs[i]} 31)" fill="currentColor"/><path d="M${xs[i] + 4} 30V6" stroke="currentColor" stroke-width="1.3"/>${[3, 6].includes(v) ? `<circle cx="${xs[i] + 11}" cy="28" r="1.5" fill="currentColor"/>` : ''}`).join('');
    const levels = values.map(v => v < 1 ? 3 : v < 2 ? 2 : v <= 3 ? 1 : 0);
    for (let level = 1; level <= 3; level++) values.forEach((v, i) => {
      if (levels[i] < level) return;
      const x = xs[i] + 4, y = 6 + (level - 1) * 5;
      if (levels[i + 1] >= level) g += `<path d="M${x} ${y}H${xs[i + 1] + 4}" stroke="currentColor" stroke-width="3"/>`;
      else if (!(levels[i - 1] >= level)) g += values.length === 1 ? `<path d="M${x} ${y}q10 4 6 13" stroke="currentColor" stroke-width="1.6" fill="none"/>` : `<path d="M${x} ${y}h${i === values.length - 1 ? -8 : 8}" stroke="currentColor" stroke-width="3"/>`;
    });
    return `<svg viewBox="0 0 144 39" aria-hidden="true">${g}</svg>`;
  }
  function previewSVG(items, start, end) {
    const width = 300, xAt = n => 14 + (n - start) / (end - start || unit()) * 268;
    let g = '';
    if (s.layer === 'tab') for (let l = 0; l < 6; l++) g += `<path d="M5 ${10 + l * 5}H295" stroke="#c6d0dd" stroke-width=".7"/>`;
    items.forEach(e => {
      const x = xAt(e.start + Math.min(e.duration / 2, .5));
      if (e.kind === 'gap') g += `<rect x="${x - 5}" y="15" width="11" height="15" rx="2" stroke="#8badcf" stroke-dasharray="2 2" fill="#fff"/>`;
      else {
        const value = e.kind === 'rest' ? '0' : s.layer === 'tab' ? e.fret : e.pitch;
        g += `<rect x="${x - 5}" y="10" width="11" height="17" fill="#f8fafc"/><text x="${x}" y="24" text-anchor="middle" fill="#38516e" font-size="16">${value}</text>`;
      }
      if (e.duration < 4) for (let l = 0; l < (e.duration < 1 ? 3 : e.duration < 2 ? 2 : 1); l++) g += `<path d="M${x - 4} ${35 + l * 4}h9" stroke="#4f6b89" stroke-width="1.3"/>`;
      if ([3, 6].includes(e.duration)) g += `<circle cx="${x + 9}" cy="23" r="1.4" fill="#4f6b89"/>`;
      g += `<text x="${x}" y="55" text-anchor="middle" font-size="8" fill="#7f8fa3">${e.duration === .5 ? '1/32' : e.duration === 1 ? '1/16' : e.duration === 2 ? '1/8' : e.duration === 3 ? '附点1/8' : e.duration === 6 ? '附点1/4' : '1/4'}</text>`;
    });
    return `<svg viewBox="0 0 ${width} 60" role="img" aria-label="${items.map(e => e.kind === 'gap' ? '待填空位' : e.kind === 'rest' ? '休止' : `${s.layer === 'tab' ? '品位' : '音高'}${s.layer === 'tab' ? e.fret : e.pitch}`).join('、')}">${g}</svg>`;
  }
  function rhythmHTML(inPopover = false) {
    const p = rhythmPlan();
    const card = t => `<button class="template-card" data-template="${t[0]}" aria-label="${t[1]}" aria-pressed="${s.template === t[0]}"><span>${t[1]}</span>${rhythmSVG(t[2])}</button>`;
    const context = p.error && !p.before.length ? location() : `第 ${s.current + 1} 小节第 ${p.first}–${p.last} 演奏拍 · 逐拍套用`;
    const error = s.stale ? '选区已变化，请重新预览。' : p.error;
    return `${inPopover ? `<div class="rhythm-context">${layerName()} · ${s.meter}${s.layer === 'tab' ? ' · 全部六弦' : ''}<br>${context}${s.meter === '6/8' ? ' · 每拍＝附点四分' : ''}</div>` : ''}
      <div class="template-grid">${library().map(card).join('')}</div>
      <div class="preview"><div class="preview-title"><span>当前</span><span>应用后 · 尚未应用</span></div><div class="preview-pair">${p.before.length ? previewSVG(p.before, p.start, p.end) : '<span>待选区</span>'}<span>→</span>${p.after.length && !p.error ? previewSVG(p.after, p.start, p.end) : '<span>待调整</span>'}</div></div>
      ${inPopover && !p.error ? `<p class="result-summary">「${p.template[1]}」· ${p.count} 个完整演奏拍<br>保留 ${p.before.filter(e => e.kind === 'note').length} 个音${p.before.some(e => e.kind === 'rest') ? `、${p.before.filter(e => e.kind === 'rest').length} 个休止` : ''}，新增 ${p.added} 个待填空位；歌词随原内容、和弦原拍点保留。</p>` : ''}
      ${error ? `<p class="reason ${s.stale ? 'warning' : 'error'}" role="alert">${error}</p>` : ''}${s.stale ? '<button class="text-button" data-action="refresh-rhythm">重新预览</button>' : ''}
      ${p.removed.length && !p.error ? `<p class="reason warning">将移除 ${p.removed.length} 项标记：${p.removed.map(t => t.name).join('、')}。应用时需确认。</p>` : ''}
      ${s.rhythmConfirm && !error ? `<div class="confirmation"><strong>将移除 ${p.removed.length} 项标记：${p.removed.map(t => t.name).join('、')}。</strong><br>保留原音符、歌词与和弦，按节奏型调整。<div class="rhythm-actions"><button data-action="cancel-rhythm-confirm">返回预览</button><button class="primary" data-action="confirm-rhythm">确认调整</button></div></div>` : `<div class="rhythm-actions">${inPopover ? '<button data-action="close">取消</button>' : ''}<button class="primary" data-action="apply-rhythm" ${error ? 'disabled' : ''}>应用节奏型</button></div>`}`;
  }
  function tupletReason(r) {
    if (s.layer !== 'tab') return '连音工具需要活动 TAB 目标，请在谱面激活六线谱。';
    if (!s.selected.length || s.crossbar) return `需要同小节内连续 ${r.actual} 个实际拍点。`;
    if (s.selected.length !== r.actual) return `需要 ${r.actual} 个实际拍点，当前已选 ${s.selected.length} 个。`;
    if (!s.selected.every((value, index) => !index || value === s.selected[index - 1] + 1)) return '请选择同小节内连续拍点。';
    return '';
  }
  function tupletHTML(iconsOnly = false) {
    return `<div class="tuplets">${ratios.map((r, index) => {
      const reason = tupletReason(r), chosen = current().tuplet?.actual === r.actual && current().tuplet?.normal === r.normal;
      const label = `${r.name}，${r.actual}:${r.normal}`;
      const symbol = iconsOnly && r.actual === 5 ? tupletIcon(`${r.actual}:${r.normal}`, true) : tupletIcon(r.actual);
      return disabledWrap(`<button data-tuplet="${index}" aria-label="${label}" title="${label}" aria-description="${esc(reason)}" aria-pressed="${chosen}" ${reason ? 'disabled' : ''}>${symbol}${iconsOnly ? '' : `<span>${r.name}</span>`}</button>`, reason ? `${label}：${reason}` : '');
    }).join('')}</div>`;
  }
  function canRemoveTuplet() {
    return s.layer === 'tab' && !s.crossbar && current().tuplet && current().tuplet.eventIds.some(id => selectedEvents().some(e => e.id === id));
  }
  function boundaryHTML() {
    const atEnd = s.current === s.doc.bars.length - 1, absent = !s.selected.length;
    const startReason = absent ? '请先选择目标小节。' : s.current !== 0 ? '谱首反复仅对第一小节可用。' : '';
    const startIcon = `<svg viewBox="0 0 30 28" aria-hidden="true"><path d="M4 3v22M10 3v22" stroke="currentColor" stroke-width="1"/><path d="M10 3v22" stroke="currentColor" stroke-width="3"/><path d="M10 4h17M10 24h17" stroke="currentColor" stroke-width="1"/><circle cx="18" cy="11" r="1.5" fill="currentColor"/><circle cx="18" cy="17" r="1.5" fill="currentColor"/></svg>`;
    return `<div class="barline-picker" role="group" aria-label="小节线与反复">${barlines.map(([value, label]) => {
      const reason = absent ? '请先选择目标小节。' : atEnd && ['repeatStart', 'repeatBoth'].includes(value) ? '谱尾右边界没有下一小节，不能开始反复。' : '';
      return `<div class="barline-option">${disabledWrap(`<button data-barline="${value}" aria-label="${label}" title="${label}：第 ${s.current + 1} 小节右侧边界" aria-pressed="${current().barline === value}" ${reason ? 'disabled' : ''}>${barlineIcon(value)}</button>`, reason)}</div>`;
    }).join('')}<div class="barline-option score-start-option">${disabledWrap(`<button data-action="start-repeat" aria-label="谱首反复" aria-pressed="${s.doc.startRepeat}" title="谱首反复：${s.doc.startRepeat ? '开' : '关'}，作用于整谱左边界" ${startReason ? 'disabled' : ''}>${startIcon}</button>`, startReason)}</div></div><div class="barline-labels">${barlines.map(b => `<span>${b[1].replace('小节线', '线')}</span>`).join('')}<span>谱首反复</span></div>`;
  }
  function measureActionsHTML() {
    const disabled = !s.selected.length;
    const insertIcon = svg('<path d="M4 6v17M17 6v17M4 9h13M4 13h13M4 17h13M4 21h13M22 7v10m-5-5h10"/>');
    return `<div class="measure-action-section"><div class="measure-actions" role="group" aria-label="当前小节操作"><button class="measure-action-add" data-action="add-measure" aria-label="在当前小节后新增" title="在第 ${s.current + 1} 小节后新增空白小节" ${disabled ? 'disabled' : ''}><span class="measure-action-icon">${insertIcon}</span><span>新增小节</span></button><button class="measure-action-copy" data-action="copy-measure" aria-label="复制当前小节" title="副本紧跟第 ${s.current + 1} 小节" ${disabled ? 'disabled' : ''}><span class="measure-action-icon">${icons.copy}</span><span>复制小节</span></button><button class="measure-action-delete" data-action="ask-delete-measure" aria-label="删除当前小节" title="删除第 ${s.current + 1} 小节，操作前确认" ${disabled || s.doc.bars.length === 1 ? 'disabled' : ''}><span class="measure-action-icon">${icons.trash}</span><span>删除小节</span></button></div></div>${s.doc.bars.length === 1 ? '<p class="reason warning">仅剩一个小节，不能删除。</p>' : ''}${s.deleteConfirm ? `<div class="confirmation measure-confirm"><strong>删除第 ${s.current + 1} 小节？</strong><br>${events().filter(e => e.kind === 'note').length} 个音符、${events().filter(e => e.kind === 'rest').length} 个休止、${events().filter(e => e.lyric).length} 字歌词、${s.doc.techniques.filter(t => t.barId === current().id).length} 项技巧、${current().chord ? 1 : 0} 个和弦${current().tuplet ? '、1 个连音组' : ''}将一并删除。可一次撤销。<div class="rhythm-actions"><button data-action="cancel-delete-measure">取消</button><button class="danger" data-action="confirm-delete-measure">确认删除</button></div></div>` : ''}`;
  }
  function durationButtons(side = false) {
    const target = selectedEvents()[0];
    return durations.map(([value, label]) => `<button data-duration="${value}" aria-label="${label}" title="${label}" aria-pressed="${target?.base === value}" ${!target || s.crossbar ? 'disabled' : ''}>${durationIcon(value)}</button>`).join('');
  }
  function dotButtons() {
    const target = selectedEvents()[0];
    return [0, 1, 2].map((dots, i) => `<button data-dots="${dots}" aria-label="${['无附点', '单附点', '双附点'][i]}" title="${['无附点', '单附点', '双附点'][i]}" aria-pressed="${target?.dots === dots}" ${!target || s.crossbar ? 'disabled' : ''}>${['·̸', '·', '··'][i]}</button>`).join('');
  }
  function renderSidebar() {
    $('side-layer').textContent = layerName();
    $('side-context').innerHTML = `<strong>${s.selected.length ? s.chordSelection ? 'TAB 同拍多弦选区' : s.layer === 'tab' ? 'TAB 音符选区' : '简谱音符选区' : '尚未选择对象'}</strong>${location()}`;
    $('tab-note').setAttribute('aria-selected', String(s.tab === 'note')); $('tab-measure').setAttribute('aria-selected', String(s.tab === 'measure'));
    if (s.tab === 'measure') {
      $('side-content').innerHTML = `<section><div class="side-section-heading"><h3>当前小节</h3><span>第 ${s.current + 1} / ${s.doc.bars.length} 小节</span></div><p class="reason">${s.meter} · ${events().filter(e => e.kind === 'note').length} 个音符 · ${events().filter(e => e.lyric).length} 字歌词</p></section><section>${boundaryHTML()}${measureActionsHTML()}</section>`; return;
    }
    const target = selectedEvents()[0];
    $('side-content').innerHTML = `<div class="selection-summary"><span class="summary-symbol">${target?.kind === 'rest' ? '休' : '♪'}</span><div><strong>${s.selected.length ? `已选 ${s.selected.length} 个实际拍点 · ${selectedEvents().filter(e => e.kind === 'note').length} 个音符` : '先在谱面选择目标'}</strong><small>${s.crossbar ? '跨小节选区；部分工具不可用' : '时值、连音与节奏型在此直接编辑'}</small></div></div>
      <section><div class="side-section-heading"><h3>时值 / 附点</h3><span>同一行快速设置</span></div><div class="inline-music-row"><div class="duration-row">${durationButtons(true)}</div><span class="vline"></span><div class="dots-row">${dotButtons()}</div></div></section>
      <section class="sidebar-tuplet-section"><div class="side-section-heading"><h3>连音</h3></div>${tupletHTML(true)}${current().tuplet ? `<button class="text-button danger" data-action="remove-tuplet" ${!canRemoveTuplet() ? 'disabled' : ''}>删除当前连音组</button>` : ''}<p class="reason">同小节内，连续拍点数须与连音数字一致。</p></section>
      <section><div class="side-section-heading"><h3>音符状态</h3></div><div class="note-states">${[['muted', '× 弹奏'], ['sustain', '— 延音'], ['rest', target?.kind === 'rest' ? '♪ 取消休止' : '𝄽 休止']].map(([value, label]) => `<button data-note-state="${value}" aria-pressed="${target?.state === value}" ${!target || s.crossbar ? 'disabled' : ''}>${label}</button>`).join('')}</div></section>
      <section id="side-rhythm"><div class="side-section-heading"><h3>常见节奏型</h3></div>${rhythmHTML()}</section>`;
  }
  function techniqueReason(type) {
    if (s.layer !== 'tab') return '吉他技巧需要活动 TAB 目标。';
    if (!s.selected.length) return '请先在 TAB 中选择实际音符。';
    const target = selectedEvents()[0];
    if (!target || target.kind !== 'note' || target.state === 'sustain') return '请选择实际起音，休止、待填空位与延音标记不能作为此技巧目标。';
    if (['strum', 'arpeggio'].includes(type) && !s.chordSelection) return '需要同一拍点内至少两根弦；可载入「同拍多弦」评审场景。';
    if (['hammerOn', 'pullOff', 'slideUp', 'slideDown', 'tie'].includes(type)) {
      const next = events()[firstIndex() + 1];
      if (!next || next.kind !== 'note') return '未找到无休止间隔的同弦下一音，请调整选区。';
      if (type === 'tie' && target.fret !== next.fret) return '延音线要求相邻拍点的同弦同品位；当前下一音品位不同。';
      if (['hammerOn', 'slideUp'].includes(type) && next.fret <= target.fret) return '技巧方向与品位不符：下一音需高于起始音。';
      if (['pullOff', 'slideDown'].includes(type) && next.fret >= target.fret) return '技巧方向与品位不符：下一音需低于起始音。';
    }
    return '';
  }
  function parameterHTML() {
    if (!s.pending) return '';
    const { type, mode, editId } = s.pending;
    const editing = s.doc.techniques.find(t => t.id === editId);
    let content = '';
    if (mode === 'connection') {
      const next = events()[firstIndex() + 1];
      content = `<p style="margin:0 0 8px">起点：第 ${firstIndex() + 1} 拍点 · 2 弦 ${selectedEvents()[0].fret} 品。<br>已找到同弦下一音，请点击谱面蓝框目标或下方目标确认连接。</p><button class="primary" data-action="complete-connection">连接至第 ${firstIndex() + 2} 拍点 · 2 弦 ${next.fret} 品</button>`;
    } else if (type === 'bend') content = `<div class="choice-row"><span>推弦幅度</span><button data-param="1" aria-pressed="${editing?.detail === '半音'}">半音</button><button data-param="2" aria-pressed="${editing?.detail === '全音'}">全音</button></div><p>点击离散值即${editing ? '更新当前对象' : '新增技巧'}。</p>`;
    else if (type === 'trill') content = `<div class="choice-row"><label>辅助品位<input id="trill-fret" type="number" min="0" max="24" step="1" value="${editing ? Number(editing.detail.match(/\d+/)?.[0] ?? 7) : 7}"></label><button data-action="apply-trill" class="primary">应用</button></div><p>0–24 的整数，且不同于主品位。Enter、失焦或点击应用提交完整值。</p><p id="trill-error" class="reason error" role="alert" hidden></p>`;
    else content = `<div class="choice-row"><span>${type === 'arpeggio' ? '音高方向' : '演奏方向'}</span><button data-param="down" class="primary">${type === 'arpeggio' ? '↑ 上行' : '↓ 下'}</button><button data-param="up">${type === 'arpeggio' ? '↓ 下行' : '↑ 上'}</button></div>`;
    return `<div class="parameter-region"><h3>${nameOf(type)} · ${editing ? '编辑当前技巧' : mode === 'connection' ? '确认下一目标' : type === 'trill' ? '完整输入后应用' : '选择参数即应用'}</h3>${content}<div class="cancel-line"><button class="text-button" data-action="cancel-technique">取消本次操作</button></div></div>`;
  }
  function techniqueHTML() {
    const selected = uniqueTechnique(), marks = selectedMarks();
    return `${s.replacement ? `<div class="confirmation" style="margin:0 0 12px"><strong>替换当前「${nameOf(s.replacement.type)}」</strong><br>在下方 16 类中选择新类型。完成所需参数或下一音确认后，更新同一对象；取消保留原技巧。<button class="text-button" data-action="cancel-replace-technique">取消更换</button></div>` : ''}${[0, 1, 2].map(group => `<div class="technique-group">${['音符连接', '音高与修饰', '演奏方向与范围'][group]}</div><div class="technique-grid">${techniques.filter(t => t[2] === group).map(([type, name]) => {
      const reason = techniqueReason(type);
      return disabledWrap(`<button class="technique-item" data-technique="${type}" aria-label="${name}" aria-description="${esc(reason)}" aria-pressed="${s.pending?.type === type || selected?.type === type}" ${reason ? 'disabled' : ''}>${icons[type]}<span>${name}</span></button>`, reason);
    }).join('')}</div>`).join('')}${parameterHTML()}${marks.length > 1 ? `<div class="technique-chips" role="group" aria-label="选择要编辑或删除的技巧">${marks.map(t => `<button data-select-technique="${t.id}" aria-pressed="${selected?.id === t.id}">${nameOf(t.type)}</button>`).join('')}</div>` : ''}`;
  }
  function openPanel(panel, source) {
    if (s.panel === panel && source?.dataset.panel) { closePanel(); return; }
    if (s.pending?.dirty) { toast('请先提交完整有效的辅助品位，或取消本次操作。'); return; }
    s.panel = panel; s.pending = null; s.replacement = null; s.deleteConfirm = false; s.rhythmConfirm = false;
    returnFocus = source || $(`trigger-${panel}`); render(); fitPanel();
    const candidate = panel === 'rhythm' ? $('popover').querySelector('[data-template][aria-pressed=true]') : $('popover').querySelector('button:not(:disabled)');
    candidate?.focus({ preventScroll: true });
  }
  function closePanel(focus = true) {
    if (!s.panel) return;
    s.panel = null; s.pending = null; s.replacement = null; s.deleteConfirm = false; s.rhythmConfirm = false; render();
    if (focus) returnFocus?.focus({ preventScroll: true });
  }
  function submitTrill() {
    if (s.pending?.type !== 'trill' || s.busy) return false;
    const input = $('trill-fret');
    if (!input) return false;
    const value = input.value.trim() === '' ? NaN : Number(input.value);
    if (!Number.isInteger(value) || value < 0 || value > 24 || value === selectedEvents()[0]?.fret) {
      $('trill-error').hidden = false;
      $('trill-error').textContent = '辅助品位须为 0–24 的整数，且不同于主品位。';
      input.setAttribute('aria-invalid', 'true');
      return false;
    }
    addTechnique('trill', `辅助 ${value} 品`);
    return true;
  }
  function renderPanel() {
    const root = $('popover');
    document.querySelectorAll('[data-panel]').forEach(b => b.setAttribute('aria-expanded', String(b.dataset.panel === s.panel)));
    root.hidden = !s.panel; if (!s.panel) return;
    const titles = { technique: '所有技巧', tuplet: '连音工具', measure: '小节工具', rhythm: '节奏型', chord: '和弦' };
    root.className = `popover ${s.panel}-panel`;
    const selected = uniqueTechnique(), removeReason = selected ? '' : selectedMarks().length > 1 ? '当前有多项技巧，请先唯一定位一个技巧对象。' : '请先选中一个已有技巧对象。';
    let body = '';
    if (s.panel === 'technique') body = techniqueHTML();
    if (s.panel === 'tuplet') body = `${tupletHTML(true)}${disabledWrap(`<button class="delete-tuplet" data-action="remove-tuplet" aria-label="删除连音组" ${!canRemoveTuplet() ? 'disabled' : ''}>${icons.trash}删除连音组</button>`, !canRemoveTuplet() ? '请在 TAB 中选中一个已有连音组。' : '')}<p class="reason">同小节内，连续拍点数须与连音数字一致。</p>`;
    if (s.panel === 'measure') body = `${boundaryHTML()}${measureActionsHTML()}`;
    if (s.panel === 'rhythm') body = rhythmHTML(true);
    if (s.panel === 'chord') body = `<p class="rhythm-context">第 ${s.current + 1} 小节起点 · 选择和弦即应用</p><div class="chord-grid">${['G', 'C', 'Em', 'Am', 'D', 'Dm', 'F', 'Cmaj7'].map(c => `<button data-chord="${c}" aria-pressed="${current().chord === c}" ${!s.selected.length ? 'disabled' : ''}>${c}</button>`).join('')}</div>`;
    root.innerHTML = `<header class="popover-header"><h2 id="popover-title">${titles[s.panel]}</h2>${s.panel === 'measure' ? `<span class="current-measure">第 ${s.current + 1} 小节</span>` : ''}${s.panel === 'technique' && selected && !s.replacement ? '<button class="text-button" data-action="replace-technique">更换类型</button>' : ''}${s.panel === 'technique' ? disabledWrap(`<button class="icon-button danger" data-action="delete-technique" aria-label="删除当前选中技巧" title="${selected ? `删除「${nameOf(selected.type)}」` : removeReason}" ${removeReason || s.layer !== 'tab' ? 'disabled' : ''}>${icons.trash}</button>`, removeReason) : ''}<button class="icon-button close" data-action="close" aria-label="关闭${titles[s.panel]}">×</button></header>${body}`;
    fitPanel();
  }
  function fitPanel() {
    if (!s.panel) return;
    const frame = $('editor').getBoundingClientRect(), trigger = $(`trigger-${s.panel}`).getBoundingClientRect(), root = $('popover');
    root.style.left = `${Math.max(12, Math.min(trigger.left - frame.left, frame.width - root.offsetWidth - 16))}px`;
    root.style.top = `${trigger.bottom - frame.top + 9}px`;
    root.style.maxHeight = `${Math.max(360, Math.min(720, window.innerHeight - trigger.bottom - 20))}px`;
  }
  function scoreSVG() {
    const width = 836, rowHeight = s.layer === 'tab' ? 221 : 180, columns = 4;
    const rowCount = Math.ceil(s.doc.bars.length / columns), barWidth = 194, left = 31;
    let g = '';
    s.doc.bars.forEach((bar, barIndex) => {
      const row = Math.floor(barIndex / columns), col = barIndex % columns, x0 = left + col * barWidth, y0 = 18 + row * rowHeight, staffY = y0 + 72;
      const xAt = time => x0 + 16 + time / total() * (barWidth - 25);
      const active = barIndex === s.current;
      g += `<text x="${x0 + 3}" y="${y0 + 7}" fill="#8b99aa" font-size="10">${barIndex + 1}</text><text x="${x0 + 25}" y="${y0 + 4}" fill="#24384e" font-size="12">${esc(bar.chord)}</text>`;
      if (s.layer === 'tab') {
        const chordX = x0 + 16, chordY = y0 + 13;
        for (let string = 0; string < 6; string++) g += `<path d="M${chordX + string * 5} ${chordY}v28" stroke="#596675" stroke-width=".7"/>`;
        for (let fret = 0; fret < 5; fret++) g += `<path d="M${chordX} ${chordY + fret * 7}h25" stroke="#596675" stroke-width="${fret ? .7 : 1.7}"/>`;
        g += `<circle cx="${chordX + 5}" cy="${chordY + 11}" r="2.5" fill="#3d4b5c"/><circle cx="${chordX + 20}" cy="${chordY + 18}" r="2.5" fill="#3d4b5c"/>`;
        for (let line = 0; line < 6; line++) g += `<path d="M${x0} ${staffY + line * 8}h${barWidth}" stroke="#56616e" stroke-width=".8"/>`;
      }
      if (active && s.selected.length) {
        const range = selectedEvents(), start = range[0]?.start || 0, last = range[range.length - 1], end = last ? last.start + last.duration : unit();
        g += `<rect x="${xAt(start) - 10}" y="${staffY - 13}" width="${Math.max(18, xAt(end) - xAt(start))}" height="${s.layer === 'tab' ? 83 : 70}" rx="3" fill="#1677ff0d" stroke="#91caff" stroke-dasharray="3 3"/>`;
      }
      if (s.crossbar && barIndex === s.current + 1) g += `<rect x="${x0}" y="${staffY - 13}" width="40" height="83" rx="3" fill="#e6f4ff" stroke="#91caff" stroke-dasharray="3 3"/>`;
      bar.events.forEach((e, i) => {
        const x = xAt(e.start + Math.min(e.duration / 2, .45)), selected = active && s.selected.includes(i), pending = active && s.pending?.mode === 'connection' && i === firstIndex() + 1;
        const color = selected ? '#1677ff' : '#202c3b', noteY = staffY + (s.layer === 'tab' ? 8 : 17);
        if (s.layer === 'tab' && e.kind !== 'gap' && e.kind !== 'rest') g += `<rect x="${x - 6}" y="${noteY - 8}" width="12" height="15" fill="${selected ? '#e6f4ff' : '#fff'}"/>`;
        if (e.kind === 'gap') g += `<rect x="${x - 5}" y="${noteY - 8}" width="11" height="16" rx="2" fill="#fff" stroke="#91abc8" stroke-dasharray="2 2"/>`;
        else if (e.kind === 'rest' && s.layer === 'tab') g += `<rect x="${x - 6}" y="${staffY + 7}" width="12" height="28" fill="#fff"/><path d="m${x + 2} ${staffY + 6}-4 8 5 7-5 6 3 6-6-4 3-6-4-7Z" fill="${color}"/>`;
        else {
          const value = e.kind === 'rest' ? '0' : e.state === 'sustain' ? '−' : e.state === 'muted' ? '×' : s.layer === 'tab' ? e.fret : e.pitch;
          g += `<text x="${x}" y="${noteY + 5}" text-anchor="middle" fill="${color}" font-size="${s.layer === 'tab' ? 14 : 20}">${value}</text>`;
          if (s.chordSelection && active && i === firstIndex() && s.layer === 'tab') [0, 2].forEach((line, index) => { g += `<rect x="${x - 6}" y="${staffY + line * 8 - 8}" width="12" height="15" fill="#e6f4ff"/><text x="${x}" y="${staffY + line * 8 + 5}" text-anchor="middle" fill="#1677ff" font-size="14">${index ? 2 : 0}</text>`; });
        }
        if (s.layer === 'tab' && e.kind === 'note') {
          const y = staffY + 58, level = e.duration < 1 ? 3 : e.duration < 2 ? 2 : e.duration <= 3 ? 1 : 0;
          g += `<path d="M${x} ${staffY + 43}V${y}" stroke="${color}" stroke-width="1"/>`;
          const next = bar.events[i + 1], sameBeat = next && Math.floor(next.start / unit()) === Math.floor(e.start / unit());
          for (let l = 0; l < level; l++) {
            const nextLevel = next ? next.duration < 1 ? 3 : next.duration < 2 ? 2 : next.duration <= 3 ? 1 : 0 : 0;
            const endX = sameBeat && nextLevel > l ? xAt(next.start + Math.min(next.duration / 2, .45)) : x + 6;
            g += `<path d="M${x} ${y - l * 4}H${endX}" stroke="${color}" stroke-width="2"/>`;
          }
        } else if (s.layer === 'jian' && e.duration < 4) for (let l = 0; l < (e.duration < 1 ? 3 : e.duration < 2 ? 2 : 1); l++) g += `<path d="M${x - 5} ${noteY + 12 + l * 4}h10" stroke="${color}" stroke-width="1.3"/>`;
        if ([3, 6, 12].includes(e.duration) || e.dots) for (let d = 0; d < (e.dots || 1); d++) g += `<circle cx="${x + 8 + d * 4}" cy="${noteY + 3}" r="1.3" fill="${color}"/>`;
        if (e.lyric) g += `<text x="${x}" y="${staffY + (s.layer === 'tab' ? 102 : 68)}" text-anchor="middle" font-size="12" fill="#4a5667">${esc(e.lyric)}</text>`;
        if (pending) g += `<rect x="${x - 9}" y="${noteY - 13}" width="18" height="26" rx="2" fill="none" stroke="#1677ff" stroke-width="2"/>`;
        g += `<g class="score-hit" tabindex="0" role="button" data-score-bar="${barIndex}" data-score-note="${i}" aria-label="第${barIndex + 1}小节，第${i + 1}实际拍点，${e.kind === 'gap' ? '待填空位' : e.kind === 'rest' ? '休止' : `2弦${e.fret}品，简谱${e.pitch}`}" aria-pressed="${selected}"><rect class="hit" x="${x - 9}" y="${staffY - 12}" width="18" height="80" fill="transparent"/></g>`;
      });
      const endX = x0 + barWidth;
      g += `<path d="M${endX} ${staffY - 1}v${s.layer === 'tab' ? 69 : 52}" stroke="${active ? '#1677ff' : '#53606f'}" stroke-width="${bar.barline === 'final' ? 3 : 1}"/>`;
      if (bar.barline !== 'single') g += `<path d="M${endX - 5} ${staffY - 1}v${s.layer === 'tab' ? 69 : 52}" stroke="#53606f" stroke-width="${['repeatStart', 'repeatBoth'].includes(bar.barline) ? 3 : 1}"/>`;
      if (['repeatEnd', 'repeatBoth'].includes(bar.barline)) g += `<circle cx="${endX - 11}" cy="${staffY + 16}" r="2" fill="#53606f"/><circle cx="${endX - 11}" cy="${staffY + 24}" r="2" fill="#53606f"/>`;
      if (['repeatStart', 'repeatBoth'].includes(bar.barline)) g += `<circle cx="${endX + 6}" cy="${staffY + 16}" r="2" fill="#53606f"/><circle cx="${endX + 6}" cy="${staffY + 24}" r="2" fill="#53606f"/>`;
      if (col === 0) {
        g += `<path d="M${x0} ${staffY - 1}v${s.layer === 'tab' ? 69 : 52}" stroke="#53606f" stroke-width="1"/>`;
        if (s.layer === 'tab') g += `<text x="${x0 - 12}" y="${staffY + 8}" font-size="13" fill="#53606f">T</text><text x="${x0 - 12}" y="${staffY + 24}" font-size="13" fill="#53606f">A</text><text x="${x0 - 12}" y="${staffY + 40}" font-size="13" fill="#53606f">B</text>`;
        if (barIndex === 0 && s.doc.startRepeat) g += `<path d="M${x0 + 5} ${staffY}v40" stroke="#26364a" stroke-width="3"/><circle cx="${x0 + 11}" cy="${staffY + 16}" r="2"/><circle cx="${x0 + 11}" cy="${staffY + 24}" r="2"/>`;
      }
      if (bar.tuplet) {
        const relevant = bar.events.filter(e => bar.tuplet.eventIds.includes(e.id));
        if (relevant.length) {
          const a = xAt(relevant[0].start) - 4, b = xAt(relevant[relevant.length - 1].start + relevant[relevant.length - 1].duration) - 4, mid = (a + b) / 2, yy = staffY - 10;
          g += `<path d="M${a} ${yy + 5}v-6H${mid - 9}M${mid + 9} ${yy - 1}H${b}v6" stroke="#1677ff" fill="none" stroke-width="1.2"/><text x="${mid}" y="${yy + 2}" text-anchor="middle" fill="#1677ff" font-size="11">${bar.tuplet.actual}</text>`;
        }
      }
      s.doc.techniques.filter(t => t.barId === bar.id).forEach((t, markIndex) => {
        const source = bar.events.find(e => e.id === t.eventIds[0]); if (!source) return;
        const target = bar.events.find(e => e.id === t.eventIds[1]);
        const x = xAt(source.start + .45), yy = staffY - 15 - markIndex * 14;
        if (target) g += `<path d="M${x} ${yy + 7}Q${(x + xAt(target.start + .45)) / 2} ${yy - 5} ${xAt(target.start + .45)} ${yy + 7}" stroke="#4b6b90" fill="none"/>`;
        g += `<text x="${x + (target ? 10 : 0)}" y="${yy}" fill="#47678c" font-size="10">${({ hammerOn: 'H', pullOff: 'P', slideUp: '/', slideDown: '\\', tie: '⌒', vibrato: '∿', bend: t.detail, naturalHarmonic: '◇', artificialHarmonic: 'A.H.', tapping: 'T', trill: 'tr', strum: t.detail, arpeggio: '↟', pickStroke: t.detail, palmMute: 'P.M. ┄', letRing: 'let ring ┄' })[t.type]}</text>`;
      });
      if (active) g += `<text x="${x0 + 10}" y="${staffY + 128}" font-size="9" fill="#7d94b0">当前第 ${barIndex + 1} 小节${bar.tuplet ? ` · ${bar.tuplet.actual}:${bar.tuplet.normal}` : ''}</text>`;
    });
    return `<svg class="score-svg" viewBox="0 0 ${width} ${Math.max(220, rowCount * rowHeight + 18)}" role="group" aria-label="${layerName()}演示谱，${s.doc.bars.length}个小节，点击音符选择；Shift点击扩选">${g}</svg>`;
  }
  function render() {
    $('main-duration').innerHTML = durationButtons(); $('main-dots').innerHTML = dotButtons();
    $('quick-techniques').innerHTML = ['hammerOn', 'pullOff', 'slideUp', 'tie', 'strum', 'arpeggio'].map(type => `<button class="tool-icon" data-technique="${type}" data-tip="${nameOf(type)}${techniqueReason(type) ? `：${techniqueReason(type)}` : ''}" aria-label="${nameOf(type)}" ${techniqueReason(type) ? 'disabled' : ''}>${icons[type]}</button>`).join('');
    $('trigger-technique').innerHTML = icons.technique; $('trigger-rhythm').innerHTML = icons.rhythm; $('trigger-tuplet').innerHTML = tupletIcon(3); $('trigger-measure').innerHTML = icons.measure; $('trigger-chord').innerHTML = icons.chord;
    $('toolbar-meter').textContent = s.meter; $('paper-meter').textContent = `1 = C　${s.meter}`;
    $('selection-caption').textContent = `${layerName()} · ${location()}`; $('canvas-layer').textContent = `当前活动谱层：${layerName()}`;
    $('score').innerHTML = scoreSVG(); $('status').textContent = s.message; $('undo').disabled = !s.history.length;
    $('document-state').textContent = s.history.length ? `原型内已修改 · ${s.history.length} 次可撤销` : '交互确认稿 · 内存演示';
    renderSidebar(); renderPanel();
  }
  function applyRhythm(confirmed = false) {
    const p = rhythmPlan(); if (p.error || s.stale) return;
    if (p.removed.length && !confirmed) { s.rhythmConfirm = true; renderSidebar(); renderPanel(); document.querySelector('#popover:not([hidden]) [data-action="confirm-rhythm"], #side-content [data-action="confirm-rhythm"]')?.focus({ preventScroll: true }); return; }
    const selectedIds = new Set(p.after.map(e => e.id));
    const applied = commit(`已应用「${p.template[1]}」· ${layerName()} · ${p.count} 个演奏拍`, () => {
      current().events = [...events().filter(e => e.start < p.start || e.start >= p.end), ...p.after].sort((a, b) => a.start - b.start);
      s.doc.techniques = s.doc.techniques.filter(t => !p.removed.some(mark => mark.id === t.id));
      if (p.removed.some(t => t.type === 'tuplet')) current().tuplet = null;
      s.selected = events().map((e, i) => selectedIds.has(e.id) ? i : -1).filter(i => i >= 0);
    });
    if (applied && s.panel === 'rhythm') closePanel();
  }
  function chooseTechnique(type) {
    if (s.pending?.dirty || s.busy) { toast('请先提交完整有效的辅助品位，或取消本次操作。'); return; }
    if (techniqueReason(type)) return;
    const target = uniqueTechnique();
    const editId = s.replacement?.id || (target?.type === type ? target.id : null);
    if (['hammerOn', 'pullOff', 'slideUp', 'slideDown', 'tie'].includes(type)) {
      if (s.panel !== 'technique') openPanel('technique', $('trigger-technique'));
      s.pending = { type, mode: 'connection', editId, revision: s.revision }; render(); return;
    }
    if (['bend', 'trill', 'strum', 'arpeggio', 'pickStroke'].includes(type)) {
      if (s.panel !== 'technique') openPanel('technique', $('trigger-technique'));
      s.pending = { type, mode: 'parameter', editId, revision: s.revision, dirty: false }; renderPanel(); $('trill-fret')?.focus(); return;
    }
    if (editId && !s.replacement) { toast(`当前已选「${nameOf(type)}」，该技巧没有额外参数。`); return; }
    addTechnique(type);
  }
  function addTechnique(type, detail = '') {
    if (s.busy) return;
    if ((s.pending && s.pending.revision !== s.revision) || (s.replacement && s.replacement.revision !== s.revision)) { toast('技巧目标已变化，请取消后重新操作。'); return; }
    const reason = techniqueReason(type); if (reason) { toast(reason); return; }
    const connection = ['hammerOn', 'pullOff', 'slideUp', 'slideDown', 'tie'].includes(type);
    const ids = connection ? [events()[firstIndex()].id, events()[firstIndex() + 1].id] : ['palmMute', 'letRing'].includes(type) ? selectedEvents().map(e => e.id) : [events()[firstIndex()].id];
    const editingId = s.pending?.editId || s.replacement?.id;
    const existing = editingId ? s.doc.techniques.find(t => t.id === editingId) : null;
    s.pending = null; s.replacement = null;
    s.busy = true;
    commit(`${existing ? '已更新当前' : '已新增'}${nameOf(type)}${detail ? ` · ${detail}` : ''}${connection ? ' · 已连接同弦下一音' : ''}`, () => {
      if (existing) { existing.type = type; existing.eventIds = ids; existing.detail = detail; s.explicitTechnique = existing.id; }
      else { const t = { id: `tech-${++uid}`, barId: current().id, eventIds: ids, type, detail }; s.doc.techniques.push(t); s.explicitTechnique = t.id; }
    });
    s.busy = false;
  }
  function selectScore(barIndex, noteIndex, expand = false) {
    if (s.pending?.dirty) { toast('请先完成辅助品位输入，或取消本次操作，再更换选区。'); return; }
    if (s.pending?.mode === 'connection') {
      if (barIndex === s.current && noteIndex === firstIndex() + 1) { addTechnique(s.pending.type); return; }
      toast('请选择已标出的同弦下一音，或先取消本次连接。'); return;
    }
    const previous = s.selected[0] ?? noteIndex;
    if (expand && barIndex !== s.current) { s.crossbar = true; s.selected = [previous]; }
    else { s.selected = expand ? Array.from({ length: Math.abs(noteIndex - previous) + 1 }, (_, i) => Math.min(noteIndex, previous) + i) : [noteIndex]; s.crossbar = false; s.current = barIndex; }
    s.chordSelection = false; s.explicitTechnique = null; s.deleteConfirm = false; s.rhythmConfirm = false; s.pending = null; s.replacement = null; s.stale = true; s.revision++;
    s.message = `${layerName()} · ${location()}`; render();
  }
  function changeDuration(base, dots) {
    if (!s.selected.length || s.crossbar) return;
    const ids = new Set(selectedEvents().map(e => e.id));
    const next = clone(events());
    // Duration changes consume only adjacent empty time; notes and lyrics are never overwritten.
    for (const id of ids) {
      const index = next.findIndex(e => e.id === id), event = next[index];
      const chosenBase = base ?? event.base, chosenDots = dots ?? event.dots, value = chosenBase * (chosenDots === 2 ? 1.75 : chosenDots === 1 ? 1.5 : 1);
      const oldEnd = event.start + event.duration, end = event.start + value;
      if (end > total() || next.some(e => e.id !== id && e.kind !== 'gap' && e.start >= oldEnd && e.start < end)) { toast('所需时值会覆盖后续内容或超出小节，请先缩短时值或选择有空位的位置。'); return; }
      next.splice(index, 1, { ...event, base: chosenBase, dots: chosenDots, duration: value });
      for (let i = next.length - 1; i >= 0; i--) {
        const gap = next[i]; if (gap.kind !== 'gap' || gap.id === id || gap.start >= end || gap.start + gap.duration <= oldEnd) continue;
        if (gap.start + gap.duration > end) { gap.duration -= end - gap.start; gap.start = end; } else next.splice(i, 1);
      }
      if (end < oldEnd) next.push({ id: `gap-${++uid}`, kind: 'gap', start: end, duration: oldEnd - end, base: oldEnd - end, dots: 0, lyric: '' });
    }
    commit('已更新时值 / 附点 · 原内容与小节长度保留', () => { current().events = next.sort((a, b) => a.start - b.start); s.selected = events().map((e, i) => ids.has(e.id) ? i : -1).filter(i => i >= 0); });
  }
  const reqCopy = {
    '044': ['音符与小节两个页签；时值附点一行，连音与常见节奏型直接展开', '384px 选区侧栏：摘要 → 时值／附点 → 连音 → 音符状态 → 常见节奏型。节奏型遵循 REQ-043 v2.1：跟随活动谱层，按完整演奏拍处理；保留内容、空位补齐、影响确认，一次撤销。'],
    '045': ['16 类技巧直接可见；复杂技巧保留真实参数与下一音确认', '标题“所有技巧”。图标＋名称直接选择；右上角删除仅针对唯一定位的一个技巧对象，多项须先定位。推弦、颤音奏、演奏方向就近输入；连接技巧确认实际同弦下一音。工具栏顺序为节奏型 → 连音 → 小节工具 → 和弦，后三项为纯谱学图标。'],
    '046': ['六类连音按实际拍点数启用；删除当前组', '二连音 2:3、三连音 3:2、四连音 4:3、5:4、5:3、六连音 6:4。必须为同小节连续实际拍点，数量严格等于 actual。用上方“实际拍点”切换 2–6，可演示全部六类。简谱上下文保留不可用说明；无比例详情入口。'],
    '047': ['新增、紧邻复制、删除；当前小节右边界直接设置', '小节工具位于连音之后、和弦之前。副本紧跟当前小节；删除在区内确认，说明内容数量，可取消、一次撤销，唯一小节禁止删除。六类边界与侧栏共用完全相同控件；谱尾禁用开始反复和双向反复；谱首独立开关仅第一小节可用。']
  };
  function jumpReq(req, source) {
    if (s.pending?.dirty) { toast('请先提交完整有效的辅助品位，或取消本次操作。'); return; }
    s.req = req;
    document.querySelectorAll('[data-req]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.req === req)));
    $('req-summary').textContent = `REQ-${req} · ${reqCopy[req][0]}`; $('req-description').textContent = reqCopy[req][1];
    $('reference-link').href = `./references/REQ-${req}.${req === '044' ? 'jpg' : 'png'}`;
    if (req === '044') { closePanel(false); s.tab = 'note'; renderSidebar(); document.querySelector('.sidebar').classList.remove('side-flash'); requestAnimationFrame(() => document.querySelector('.sidebar').classList.add('side-flash')); document.querySelector('.sidebar').scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    else { openPanel(({ '045': 'technique', '046': 'tuplet', '047': 'measure' })[req], source); $('popover').scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  }
  function resetScenario() {
    if (s.pending?.dirty) {
      $('review-scenario').value = s.scenario; $('review-count').value = String(s.count); $('review-layer').value = s.layer; $('review-meter').value = s.meter;
      toast('请先完成辅助品位输入，或取消本次操作，再切换评审场景。'); return;
    }
    s.scenario = $('review-scenario').value; s.count = Number($('review-count').value); s.layer = $('review-layer').value; s.meter = $('review-meter').value;
    s.template = s.meter === '6/8' ? 'three-eighths' : 'eight-sixteen';
    seed(); $('toast').hidden = true; render();
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    const hit = event.target.closest('[data-score-note]');
    if (hit) { selectScore(Number(hit.dataset.scoreBar), Number(hit.dataset.scoreNote), event.shiftKey); return; }
    if (!button || button.disabled) {
      if (s.panel && !event.target.closest('#popover, #toolbar, .review, .sidebar, #toast')) {
        if (s.pending?.dirty) toast('辅助品位尚未提交，请输入有效值或取消本次操作。');
        else closePanel(false);
      }
      return;
    }
    if (button.dataset.req) { jumpReq(button.dataset.req, button); return; }
    if (button.dataset.panel) { openPanel(button.dataset.panel, button); return; }
    if (button.dataset.tab) { s.tab = button.dataset.tab; s.deleteConfirm = false; renderSidebar(); return; }
    if (button.dataset.template) { s.template = button.dataset.template; s.rhythmConfirm = false; renderSidebar(); renderPanel(); const container = event.target.closest('#popover') ? $('popover') : $('side-content'); container.querySelector(`[data-template="${s.template}"]`)?.focus({ preventScroll: true }); return; }
    if (button.dataset.duration) { changeDuration(Number(button.dataset.duration), null); return; }
    if (button.dataset.dots !== undefined) { changeDuration(null, Number(button.dataset.dots)); return; }
    if (button.dataset.tuplet !== undefined) {
      const ratio = ratios[Number(button.dataset.tuplet)]; if (tupletReason(ratio)) return;
      commit(`已应用${ratio.name} · ${ratio.actual}:${ratio.normal} · 第 ${s.current + 1} 小节`, () => { current().tuplet = { actual: ratio.actual, normal: ratio.normal, eventIds: selectedEvents().map(e => e.id) }; }); return;
    }
    if (button.dataset.technique) { chooseTechnique(button.dataset.technique); return; }
    if (button.dataset.selectTechnique) { s.explicitTechnique = button.dataset.selectTechnique; renderPanel(); return; }
    if (button.dataset.param && s.pending) { const { type } = s.pending; addTechnique(type, type === 'bend' ? button.dataset.param === '1' ? '半音' : '全音' : type === 'arpeggio' ? button.dataset.param === 'down' ? '上行' : '下行' : button.dataset.param === 'down' ? '↓ 下' : '↑ 上'); return; }
    if (button.dataset.barline) { commit(`第 ${s.current + 1} 小节右边界已设为${barlines.find(b => b[0] === button.dataset.barline)[1]}`, () => { current().barline = button.dataset.barline; }); return; }
    if (button.dataset.noteState) {
      const value = button.dataset.noteState;
      commit('已更新选区音符状态', () => selectedEvents().forEach(e => { const remove = e.state === value; e.state = remove ? null : value; e.kind = value === 'rest' && !remove ? 'rest' : 'note'; })); return;
    }
    if (button.dataset.chord) { commit(`第 ${s.current + 1} 小节已设为 ${button.dataset.chord} 和弦`, () => { current().chord = button.dataset.chord; }); return; }
    const action = button.dataset.action;
    if (action === 'close') closePanel();
    if (action === 'apply-rhythm') applyRhythm();
    if (action === 'confirm-rhythm') applyRhythm(true);
    if (action === 'cancel-rhythm-confirm') { s.rhythmConfirm = false; renderSidebar(); renderPanel(); }
    if (action === 'refresh-rhythm') { s.stale = false; s.rhythmConfirm = false; renderSidebar(); renderPanel(); }
    if (action === 'cancel-technique' || action === 'cancel-replace-technique') { s.pending = null; s.replacement = null; render(); }
    if (action === 'replace-technique') {
      const target = uniqueTechnique();
      if (target && !s.pending?.dirty) { s.pending = null; s.replacement = { id: target.id, type: target.type, revision: s.revision }; renderPanel(); }
    }
    if (action === 'complete-connection' && s.pending) addTechnique(s.pending.type);
    if (action === 'apply-trill' && s.pending) { if (!submitTrill()) $('trill-fret')?.focus(); }
    if (action === 'delete-technique') {
      const target = uniqueTechnique(); if (target) commit(`已删除当前技巧「${nameOf(target.type)}」· 其他技巧保留`, () => { s.doc.techniques = s.doc.techniques.filter(t => t.id !== target.id); s.explicitTechnique = null; });
    }
    if (action === 'remove-tuplet' && canRemoveTuplet()) commit('已删除当前连音组 · 音符保留', () => { current().tuplet = null; });
    if (action === 'start-repeat' && s.current === 0) commit(`谱首开始反复已${s.doc.startRepeat ? '关闭' : '开启'}`, () => { s.doc.startRepeat = !s.doc.startRepeat; });
    if (action === 'ask-delete-measure' && s.doc.bars.length > 1) { s.deleteConfirm = true; renderSidebar(); renderPanel(); (s.panel === 'measure' ? $('popover') : $('side-content')).querySelector('[data-action="cancel-delete-measure"]')?.focus({ preventScroll: true }); }
    if (action === 'cancel-delete-measure') { s.deleteConfirm = false; renderSidebar(); renderPanel(); }
    if (action === 'confirm-delete-measure' && s.doc.bars.length > 1) commit(`已删除第 ${s.current + 1} 小节及其内容`, () => { const removed = current(); s.doc.bars.splice(s.current, 1); s.doc.techniques = s.doc.techniques.filter(t => t.barId !== removed.id); s.current = Math.min(s.current, s.doc.bars.length - 1); s.selected = [0]; });
    if (['add-measure', 'copy-measure'].includes(action)) {
      const original = clone(current()), copy = action === 'copy-measure';
      commit(`已在第 ${s.current + 1} 小节后${copy ? '插入副本' : '新增空白小节'}`, () => {
        const bar = copy ? original : { chord: '', barline: 'single', tuplet: null, events: Array.from({ length: total() / unit() }, (_, i) => ({ id: `gap-${++uid}`, start: i * unit(), duration: unit(), base: unit(), dots: 0, kind: 'gap', lyric: '' })) };
        bar.id = `bar-${++uid}`; const mapping = {};
        bar.events.forEach(e => { const old = e.id; e.id = `note-${++uid}`; mapping[old] = e.id; });
        if (bar.tuplet) bar.tuplet.eventIds = bar.tuplet.eventIds.map(id => mapping[id]);
        if (s.current === s.doc.bars.length - 1) current().barline = 'single';
        if (copy) s.doc.techniques.filter(t => t.barId === original.id).forEach(t => s.doc.techniques.push({ ...clone(t), id: `tech-${++uid}`, barId: bar.id, eventIds: t.eventIds.map(id => mapping[id]) }));
        s.doc.bars.splice(s.current + 1, 0, bar); s.current++; s.selected = [0]; s.explicitTechnique = null;
      });
    }
    if (button.id === 'undo' || button.id === 'toast-undo') undo();
    if (button.id === 'review-reset') { resetScenario(); toast('已重置当前评审场景'); }
  });
  document.addEventListener('input', event => {
    if (event.target.id === 'trill-fret' && s.pending?.type === 'trill') {
      s.pending.dirty = true;
      event.target.removeAttribute('aria-invalid');
      $('trill-error').hidden = true;
    }
  });
  document.addEventListener('focusout', event => {
    if (event.target.id !== 'trill-fret' || !s.pending?.dirty) return;
    if (event.relatedTarget?.closest('[data-action="cancel-technique"], [data-action="close"]')) return;
    submitTrill();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && s.panel) { event.preventDefault(); closePanel(); return; }
    if (event.key === 'Escape' && s.rhythmConfirm) { s.rhythmConfirm = false; renderSidebar(); return; }
    const editing = event.target.matches('input,select,textarea');
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !editing) { event.preventDefault(); undo(); }
    if (event.key === 'Enter' && event.target.id === 'trill-fret') { event.preventDefault(); $('popover').querySelector('[data-action="apply-trill"]')?.click(); }
    const hit = event.target.closest('[data-score-note]');
    if (hit && ['Enter', ' '].includes(event.key)) { event.preventDefault(); selectScore(Number(hit.dataset.scoreBar), Number(hit.dataset.scoreNote), event.shiftKey); }
  });
  ['review-scenario', 'review-count', 'review-layer', 'review-meter'].forEach(id => $(id).addEventListener('change', resetScenario));
  $('zoom').addEventListener('change', () => { s.zoom = Number($('zoom').value); $('paper').style.zoom = `${s.zoom}%`; toast(`谱面缩放至 ${s.zoom}%`); });
  window.addEventListener('resize', fitPanel);
  seed(); render(); jumpReq('044');
  // Read-only review access for browser smoke checks; no product integration.
  window.prototypeReview = { snapshot: () => clone(s), ratios: clone(ratios), templateCount: () => library().length };
})();
