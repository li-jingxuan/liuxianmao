(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const clone = value => JSON.parse(JSON.stringify(value));
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const common = [
    { id: 'quarter', name: '四分音符', values: [4] },
    { id: 'eighths', name: '两个八分', values: [2, 2] },
    { id: 'eight-sixteen', name: '前八后十六', values: [2, 1, 1] },
    { id: 'sixteen-eight', name: '前十六后八', values: [1, 1, 2] },
    { id: 'sixteenths', name: '四个十六分', values: [1, 1, 1, 1] },
    { id: 'dotted-eight', name: '附点八分＋十六', values: [3, 1] },
    { id: 'small-syncopation', name: '小切分', values: [1, 2, 1] },
    { id: 'reverse-dotted', name: '十六＋附点八分', values: [1, 3] },
    { id: 'dotted-two-thirtyseconds', name: '附点八分＋两三十二', values: [3, .5, .5], detail: true },
    { id: 'two-thirtyseconds-dotted', name: '两三十二＋附点八分', values: [.5, .5, 3], detail: true },
    { id: 'eighth-four-thirtyseconds', name: '八分＋四三十二', values: [2, .5, .5, .5, .5], detail: true },
    { id: 'four-thirtyseconds-eighth', name: '四三十二＋八分', values: [.5, .5, .5, .5, 2], detail: true }
  ];
  const compound = [
    { id: 'dotted-quarter', name: '附点四分', values: [6] },
    { id: 'three-eighths', name: '三个八分', values: [2, 2, 2] },
    { id: 'quarter-eight', name: '四分＋八分', values: [4, 2] },
    { id: 'eight-quarter', name: '八分＋四分', values: [2, 4] },
    { id: 'six-sixteenths', name: '六个十六分', values: [1, 1, 1, 1, 1, 1] }
  ];
  const state = {
    scenario: 'single', meter: '4/4', range: 'single', activeLayer: 'jian',
    open: false, selected: 'eight-sixteen', score: null, version: 1,
    preview: null, stale: false, failed: false, busy: false, failNext: true,
    confirmationKey: null, history: [], appliedCount: 0, lastApplied: null
  };
  let toastTimer;
  const library = () => state.meter === '6/8' ? compound : common;
  const unit = () => state.meter === '6/8' ? 6 : 4;
  const beats = () => state.meter === '6/8' ? 2 : Number(state.meter[0]);
  const total = () => unit() * beats();
  const template = () => library().find(item => item.id === state.selected);
  const layerName = () => state.activeLayer === 'jian' ? '简谱' : '六线谱';
  const hasContent = event => event.kind !== 'gap' || Boolean(event.lyric);
  function selection() {
    if (state.scenario === 'none') return null;
    if (state.scenario === 'crossbar') return { start: total() - unit(), length: unit() * 2, focus: total() - unit(), trackId: 'track-1', crossbar: true };
    if (state.range === 'bar') return { start: 0, length: total(), focus: 0, trackId: 'track-1' };
    if (state.range === 'two') return { start: .5, length: unit() + 1, focus: .5, trackId: 'track-1' };
    if (state.range === 'short') return { start: unit() - .5, length: 1, focus: unit() - .5, trackId: 'track-1' };
    return { start: .5, length: 0, focus: .5, trackId: 'track-1' };
  }
  function scope() {
    const raw = selection();
    if (!raw) return { ok: false, error: '请先在当前谱层选择音符或连续选区。' };
    if (raw.crossbar || raw.start + raw.length > total()) return { ok: false, error: '选区跨越小节。首期仅支持同轨、同一小节内的范围，请缩小选区。', raw };
    const start = Math.floor((raw.length < unit() ? raw.focus : raw.start) / unit()) * unit();
    const end = raw.length < unit() ? start + unit() : Math.ceil((raw.start + raw.length) / unit()) * unit();
    return { ok: true, start, end, length: end - start, beatCount: (end - start) / unit(), firstBeat: start / unit() + 1, lastBeat: end / unit(), raw, reason: raw.length === 0 ? '单点自动定位所属完整演奏拍' : raw.length < unit() ? '短选区按焦点所属完整演奏拍处理' : '覆盖首末所属完整演奏拍', trackId: 'track-1', measure: 1 };
  }
  function location(s = scope()) {
    if (!s.ok) return state.scenario === 'none' ? '未选择范围' : '跨小节选区';
    return `第1小节第${s.firstBeat}${s.beatCount > 1 ? `–${s.lastBeat}` : ''}拍`;
  }
  function seedScore() {
    const events = [];
    const make = (beat, index, start, duration, kind = 'note', extra = {}) => ({
      id: `b${beat + 1}-e${index + 1}`, start: beat * unit() + start, duration, kind,
      ...(kind === 'note' ? state.activeLayer === 'jian' ? { pitches: [[1, 3, 5, 6][index % 4]] } : { positions: [{ string: [3, 2, 1, 4][index % 4], fret: [2, 1, 3, 0][index % 4] }] } : kind === 'gap' ? { gap: true } : { rest: true }), ...extra
    });
    for (let beat = 0; beat < beats(); beat++) {
      let scenario = state.scenario;
      if (scenario === 'uneven') scenario = beat === 0 ? 'overflow' : 'single';
      if (scenario === 'decorated') scenario = 'two';
      if (['none', 'crossbar', 'stale', 'failure', 'crossing-note'].includes(scenario)) scenario = 'single';
      const count = scenario === 'two' || scenario === 'mixed-rest' ? 2 : scenario === 'notes' ? 3 : scenario === 'overflow' ? 4 : 1;
      if (scenario === 'blank') {
        events.push(make(beat, 0, 0, unit() / 2, 'gap'));
        // The other half is implicit empty time; neither form is a rest.
      } else if (scenario === 'mixed') {
        events.push(make(beat, 0, 0, 1), make(beat, 1, 1, unit() - 2, 'gap'), make(beat, 2, unit() - 1, 1));
      } else if (scenario === 'content') {
        events.push(make(beat, 0, 0, unit() / 2, 'note', { lyric: '风' }), make(beat, 1, unit() / 2, unit() / 2, 'gap', { lyric: '来' }));
      } else {
        for (let i = 0; i < count; i++) {
          // Stable notes seed: 1,3,5 at [1,1,2] in simple meter.
          const start = count === 3 ? i : i * unit() / count;
          const duration = count === 3 ? (i === 2 ? unit() - 2 : 1) : unit() / count;
          const kind = scenario === 'rest' || scenario === 'mixed-rest' && i === 1 ? 'rest' : 'note';
          const event = make(beat, i, start, duration, kind);
          if (scenario === 'polyphonic') {
            if (state.activeLayer === 'jian') event.pitches = [1, 3, 5];
            else event.positions = [{ string: 3, fret: 2 }, { string: 2, fret: 1 }, { string: 1, fret: 0 }];
          }
          events.push(event);
        }
      }
    }
    if (state.scenario === 'crossing-note') {
      events[0].duration = unit() + 1;
      events[1].start = unit() + 1;
      events[1].duration = unit() - 1;
    }
    const decorated = state.scenario === 'decorated';
    return { documentId: 'prototype-document', trackId: 'track-1', layer: state.activeLayer, events, marks: decorated ? [
      { id: 'hammer-1', type: '击弦', eventIds: ['b1-e1'] },
      { id: 'tie-1', type: '延音线', eventIds: ['b1-e2', 'b2-e1'] },
      { id: 'outside-1', type: '滑音', eventIds: [`b${beats()}-e1`] }
    ] : [], chords: state.scenario === 'content' ? [{ id: 'chord-1', start: 0, name: 'C' }] : [] };
  }
  function buildPreview() {
    const s = scope();
    const result = { key: `${state.version}:${state.activeLayer}:${state.selected}:${JSON.stringify(selection())}`, version: state.version, scope: s, template: clone(template()), plans: [], removedMarks: [], error: s.error || '', after: null };
    if (!s.ok) return result;
    const relevant = state.score.events.filter(event => event.start < s.end && event.start + event.duration > s.start);
    if (relevant.some(event => event.kind === 'note' && (event.start < s.start || event.start + event.duration > s.end))) {
      result.error = '原发声事件跨出完整处理范围，请扩大选区以包含整个音符，避免截断发声。';
      return result;
    }
    if (relevant.some(event => hasContent(event) && (event.start < s.start || event.start + event.duration > s.end))) {
      result.error = '范围边界上的内容无法完整保留，请扩大选区后重新预览。';
      return result;
    }
    for (let start = s.start; start < s.end; start += unit()) {
      const before = state.score.events.filter(event => event.start >= start && event.start < start + unit());
      const contents = before.filter(hasContent).sort((a, b) => a.start - b.start);
      const onsets = [...new Set(contents.map(event => event.start))];
      const plan = { beat: start / unit() + 1, start, contentCount: onsets.length, slotCount: template().values.length, before: clone(before), after: [], error: '', addedGaps: 0 };
      if (onsets.length > plan.slotCount) {
        plan.error = `第${plan.beat}拍有 ${onsets.length} 个内容位置，模板仅 ${plan.slotCount} 个槽位。请换用更多槽位的模板，避免丢音。`;
      } else {
        let cursor = start;
        template().values.forEach((duration, index) => {
          const source = contents.filter(event => event.start === onsets[index]);
          if (source.length) source.forEach(event => plan.after.push({ ...clone(event), start: cursor, duration }));
          else {
            const existing = before.find(event => event.kind === 'gap' && !event.lyric && event.start === cursor && event.duration === duration);
            plan.after.push({ id: existing?.id || `gap-${state.activeLayer}-${cursor}-${duration}`, start: cursor, duration, kind: 'gap', gap: true });
            if (!existing) plan.addedGaps++;
          }
          cursor += duration;
        });
      }
      result.plans.push(plan);
    }
    const errors = result.plans.filter(plan => plan.error);
    if (errors.length) { result.error = errors.map(plan => plan.error).join(' '); return result; }
    const ids = new Set(relevant.filter(hasContent).map(event => event.id));
    result.removedMarks = clone(state.score.marks.filter(mark => mark.eventIds.some(id => ids.has(id))));
    const next = clone(state.score);
    // Remove only target-related connections. Endpoints outside the scope remain untouched.
    next.marks = next.marks.filter(mark => !result.removedMarks.some(item => item.id === mark.id));
    const outside = next.events.flatMap(event => {
      if (event.start + event.duration <= s.start || event.start >= s.end) return [event];
      if (hasContent(event)) return [];
      // Empty gaps may be split at the boundary; preserve their outside portions.
      const pieces = [];
      if (event.start < s.start) pieces.push({ ...event, duration: s.start - event.start });
      if (event.start + event.duration > s.end) pieces.push({ ...event, id: `${event.id}-outside`, start: s.end, duration: event.start + event.duration - s.end });
      return pieces;
    });
    next.events = [...outside, ...result.plans.flatMap(plan => plan.after)].sort((a, b) => a.start - b.start);
    // Lyrics stay on their source events; chord starts keep their original beat positions.
    const lyrics = events => events.filter(event => event.lyric).map(event => `${event.id}:${event.lyric}`).sort();
    if (JSON.stringify(lyrics(next.events)) !== JSON.stringify(lyrics(state.score.events)) || JSON.stringify(next.chords) !== JSON.stringify(state.score.chords)) {
      result.error = '歌词或和弦无法一一保留，请调整范围后重试。';
      return result;
    }
    result.after = next;
    return result;
  }
  function refreshPreview() {
    state.preview = buildPreview(); state.stale = false; state.failed = false; state.confirmationKey = null;
  }
  function validation() {
    if (state.stale || state.preview.version !== state.version) return { ok: false, type: 'warning', text: '目标已变化，请重新预览。' };
    if (state.preview.error) return { ok: false, type: 'error', text: state.preview.error };
    if (state.failed) return { ok: true, type: 'error', text: '应用失败，谱面未更改。当前预览已保留，可重试。' };
    return { ok: true, type: 'ready', text: '' };
  }
  function rhythmSVG(values, label) {
    const positions = values.map((_, index) => values.length === 1 ? 67 : 19 + index * (111 / (values.length - 1)));
    let graphics = '';
    values.forEach((duration, index) => {
      const x = positions[index];
      graphics += `<ellipse cx="${x - 3}" cy="32" rx="5.1" ry="3.5" transform="rotate(-18 ${x - 3} 32)" fill="currentColor"/><path d="M${x + 1} 31V6" fill="none" stroke="currentColor" stroke-width="1.5"/>`;
      if (duration === 3 || duration === 6) graphics += `<circle cx="${x + 9}" cy="29" r="1.7" fill="currentColor"/>`;
    });
    const levels = values.map(duration => duration < 1 ? 3 : duration < 2 ? 2 : duration <= 3 ? 1 : 0);
    for (let level = 1; level <= 3; level++) {
      for (let index = 0; index < values.length; index++) {
        if (levels[index] < level) continue;
        const y = 6 + (level - 1) * 6;
        if (index < values.length - 1 && levels[index + 1] >= level) graphics += `<path d="M${positions[index] + 1} ${y}H${positions[index + 1] + 1}" stroke="currentColor" stroke-width="3.5"/>`;
        else if (index === 0 || levels[index - 1] < level) {
          graphics += values.length === 1 ? `<path d="M${positions[index] + 1} ${y}q11 5 6 15" stroke="currentColor" stroke-width="2" fill="none"/>` : `<path d="M${positions[index] + 1} ${y}h${index === values.length - 1 ? -10 : 10}" stroke="currentColor" stroke-width="3.5"/>`;
        }
      }
    }
    return `<svg class="rhythm-svg" viewBox="0 0 144 43" role="img" aria-label="${escape(label)}">${graphics}</svg>`;
  }
  function durationName(duration) {
    return ({ .5: '1/32', 1: '1/16', 1.5: '附点1/16', 2: '1/8', 3: '附点1/8', 4: '1/4', 6: '附点1/4', 8: '1/2', 12: '附点1/2', 16: '全音符' })[duration] || '延续音';
  }
  function tabRest(x, duration) {
    const dotted = [1.5, 3, 6, 12].includes(duration);
    let graphic;
    if (duration < 4) {
      graphic = `<path d="M${x + 4} 35l-6 24" stroke="#344e6b" stroke-width="1.5" fill="none"/><circle cx="${x}" cy="39" r="2.6" fill="#344e6b"/>`;
      if (duration < 2) graphic += `<circle cx="${x - 2}" cy="46" r="2.6" fill="#344e6b"/>`;
      if (duration < 1) graphic += `<circle cx="${x - 4}" cy="53" r="2.6" fill="#344e6b"/>`;
    } else if (duration < 8) graphic = `<path d="m${x + 2} 33-5 7 7 6-6 5 3 6-7-4 4-7-5-5Z" fill="#344e6b"/>`;
    else graphic = `<rect x="${x - 5}" y="${duration >= 16 ? 42 : 45}" width="10" height="4" fill="#344e6b"/>`;
    return graphic + (dotted ? `<circle cx="${x + 10}" cy="46" r="1.6" fill="#344e6b"/>` : '');
  }
  function describe(event) {
    const value = event.kind === 'gap' ? '待填空位' : event.kind === 'rest' ? '明确休止' : state.activeLayer === 'jian' ? `音高${event.pitches.join('、')}` : event.positions.map(p => `${p.string}弦${p.fret}品`).join('、');
    return `${value}，时值${durationName(event.duration)}${event.lyric ? `，歌词${event.lyric}` : ''}`;
  }
  function staffSVG(events, mini = false, s = scope(), marks = state.score.marks, chords = state.score.chords) {
    const width = mini ? 294 * (s.ok ? s.beatCount : 1) : 700, height = mini ? 124 : 168;
    const left = 12, usable = width - 24, start = mini && s.ok ? s.start : 0, length = mini && s.ok ? s.length : total();
    const xAt = time => left + (time - start) / length * usable;
    let graphics = '';
    if (!mini && s.ok) graphics += `<rect x="${xAt(s.start)}" y="12" width="${s.length / length * usable}" height="112" rx="4" fill="#e6f4ff" stroke="#91caff" stroke-dasharray="4 3"/>`;
    if (state.activeLayer === 'tab') for (let line = 0; line < 6; line++) graphics += `<path d="M${left} ${28 + line * 7}H${width - left}" stroke="#b1bdcd" stroke-width=".7"/>`;
    const span = length / unit();
    for (let i = 1; i < span; i++) graphics += `<path d="M${xAt(start + i * unit())} 18V91" stroke="#dbe4f0" stroke-dasharray="3 3"/>`;
    const positions = new Map();
    events.forEach(event => {
      const x = xAt(event.start + Math.min(event.duration / 2, .55));
      positions.set(event.id, x);
      if (event.kind === 'gap') {
        graphics += `<rect x="${x - 8}" y="39" width="16" height="19" rx="3" fill="#fff" stroke="#93b7df" stroke-dasharray="3 2"/>`;
      } else if (state.activeLayer === 'jian') {
        const pitches = event.kind === 'rest' ? [0] : event.pitches;
        pitches.forEach((pitch, i) => { graphics += `<text x="${x}" y="${53 - i * 15}" text-anchor="middle" font-size="${pitches.length > 1 ? 16 : 23}" fill="#344e6b">${pitch}</text>`; });
      } else if (event.kind === 'rest') {
        graphics += tabRest(x, event.duration);
      } else event.positions.forEach(p => { graphics += `<rect x="${x - 6}" y="${28 + (p.string - 1) * 7 - 7}" width="12" height="14" fill="white"/><text x="${x}" y="${32 + (p.string - 1) * 7}" text-anchor="middle" font-size="${mini ? 15 : 12}" fill="#344e6b">${p.fret}</text>`; });
      if (state.activeLayer === 'jian') {
        if (event.duration <= 3) graphics += `<path d="M${x - 6} 67h12${event.duration < 2 ? `M${x - 6} 71h12` : ''}${event.duration < 1 ? `M${x - 6} 75h12` : ''}" stroke="#4b6480" stroke-width="1.3"/>`;
        if ([1.5, 3, 6].includes(event.duration)) graphics += `<circle cx="${x + 10}" cy="50" r="1.6" fill="#4b6480"/>`;
      } else if (event.kind === 'note') {
        const index = events.indexOf(event), next = events[index + 1], previous = events[index - 1];
        const beamLevel = item => item?.kind === 'note' ? item.duration < 1 ? 3 : item.duration < 2 ? 2 : item.duration <= 3 ? 1 : 0 : 0;
        const sameBeat = other => other && Math.floor(other.start / unit()) === Math.floor(event.start / unit());
        graphics += `<path d="M${x} 69V88" stroke="#4b6480" stroke-width="1.2"/>`;
        for (let level = 1; level <= beamLevel(event); level++) {
          const y = 88 - (level - 1) * 6;
          if (sameBeat(next) && beamLevel(next) >= level) {
            const endX = xAt(next.start + Math.min(next.duration / 2, .55));
            graphics += `<path d="M${x} ${y}H${endX}" stroke="#4b6480" stroke-width="2.5"/>`;
          } else if (!(sameBeat(previous) && beamLevel(previous) >= level)) {
            graphics += `<path d="M${x} ${y}q9 -2 6 -9" stroke="#4b6480" stroke-width="1.8" fill="none"/>`;
          }
        }
        if ([1.5, 3, 6].includes(event.duration)) graphics += `<circle cx="${x + 9}" cy="77" r="1.6" fill="#4b6480"/>`;
      }
      graphics += `<text x="${x}" y="105" text-anchor="middle" font-size="${mini ? 12 : 9}" fill="#71839a">${durationName(event.duration)}</text>`;
      if (event.lyric) graphics += `<text x="${x}" y="119" text-anchor="middle" font-size="${mini ? 13 : 10}" fill="#6c83a0">${escape(event.lyric)}</text>`;
    });
    chords.filter(chord => chord.start >= start && chord.start < start + length).forEach(chord => { graphics += `<text x="${xAt(chord.start) + 8}" y="13" font-size="11" fill="#6c83a0">${escape(chord.name)}</text>`; });
    const visibleMarks = marks.filter(mark => mark.eventIds.some(id => positions.has(id)));
    if (visibleMarks.length) graphics += `<text x="${left}" y="${height - 3}" font-size="9" fill="#b18136">${escape(visibleMarks.map(mark => mark.type).join(' · '))}</text>`;
    if (!mini) for (let beat = 0; beat < beats(); beat++) graphics += `<text x="${xAt(beat * unit() + unit() / 2)}" y="${height - 3}" text-anchor="middle" font-size="9" fill="#8b9cb0">第${beat + 1}拍</text>`;
    return `<svg class="${mini ? 'mini-score' : 'score-svg'}" ${mini ? `style="min-width:${210 * (s.ok ? s.beatCount : 1)}px"` : ''} viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(`${layerName()}：${events.map(describe).join('；') || '纯空白'}`)}">${graphics}</svg>`;
  }
  function renderCards() {
    $('template-count').textContent = `${library().length} 个`;
    const items = library();
    $('template-grid').innerHTML = items.map((item, index) => `${index === 0 || Boolean(item.detail) !== Boolean(items[index - 1].detail) ? `<div class="template-group-title" data-group="${item.detail ? 'detail' : 'common'}">${item.detail ? '三十二分细分' : '常用'}</div>` : ''}<button id="template-${item.id}" class="template-card" data-template="${item.id}" aria-label="${item.name}" aria-pressed="${item.id === state.selected}" ${state.busy ? 'disabled' : ''}><span class="template-name">${item.name}</span>${item.id === state.selected ? '<span class="selection-check" aria-hidden="true">✓</span>' : ''}${rhythmSVG(item.values, item.name)}</button>`).join('');
    $('template-unit-note').textContent = `每张覆盖 1 个演奏拍 · ${state.meter === '6/8' ? '附点四分音符（3 个八分）' : '四分音符'}。`;
    document.querySelectorAll('[data-template]').forEach(button => button.addEventListener('click', () => {
      if (state.busy) return;
      state.selected = button.dataset.template;
      // Selecting a different template creates a new preview and revokes confirmation.
      if (!state.stale) refreshPreview(); else state.confirmationKey = null;
      renderDialog(); $(button.id)?.focus();
    }));
  }
  function summary(preview) {
    if (preview.error) return '请先调整范围或模板';
    const content = preview.plans.flatMap(plan => plan.before).filter(hasContent);
    const notes = new Set(content.filter(event => event.kind === 'note').map(event => event.start)).size;
    const rests = new Set(content.filter(event => event.kind === 'rest').map(event => event.start)).size;
    const lyricGaps = content.filter(event => event.kind === 'gap' && event.lyric).length;
    const kept = [notes ? `${notes}个音` : '', rests ? `${rests}个休止` : '', lyricGaps ? `${lyricGaps}个带词空位` : ''].filter(Boolean).join('、');
    const added = preview.plans.reduce((sum, plan) => sum + plan.addedGaps, 0);
    const gaps = preview.plans.flatMap(plan => plan.after).filter(event => event.kind === 'gap' && !event.lyric).length;
    return `${kept ? `保留${kept}，` : ''}${added ? `新增${added}个空位` : gaps ? `保留${gaps}个空位` : '无新增空位'}`;
  }
  function renderDialog() {
    $('rhythm-dialog').hidden = !state.open;
    $('rhythm-trigger').setAttribute('aria-expanded', String(state.open));
    if (!state.open) return;
    const p = state.preview, s = p.scope, result = validation();
    const confirming = state.confirmationKey === p.key && result.ok;
    $('dialog-context').textContent = `${layerName()} · ${location(s)} · ${state.meter}${state.meter === '6/8' ? ' · 每拍附点四分' : ''}`;
    $('dialog-context').title = s.reason || '';
    $('selected-name').textContent = p.template.name;
    $('cycle-count').textContent = s.ok ? `${s.beatCount} 拍 · 逐拍套用` : '范围待调整';
    renderCards();
    const before = s.ok ? state.score.events.filter(event => event.start >= s.start && event.start < s.end) : [];
    const after = p.plans.flatMap(plan => plan.after);
    $('comparison').innerHTML = `<div class="compare-row"><div class="compare-label">当前<span>${s.ok ? `${s.beatCount} 个演奏拍` : '无有效范围'}</span></div><div class="score-preview-viewport">${s.ok ? staffSVG(before, true, s) : '<div class="blocked-preview">请在谱面选择范围</div>'}</div></div><div class="comparison-arrow" aria-hidden="true">→</div><div class="compare-row after"><div class="compare-label">应用后<span>□ 待填空位</span></div><div class="score-preview-viewport">${p.after ? staffSVG(after, true, s, p.after.marks, p.after.chords) : '<div class="blocked-preview">待调整后生成预览</div>'}</div></div>`;
    $('result-summary').textContent = summary(p);
    const preserved = before.filter(event => event.lyric).map(event => `歌词「${event.lyric}」随原内容保留`);
    if (s.ok && state.score.chords.some(chord => chord.start >= s.start && chord.start < s.end)) preserved.push('和弦保留原拍点');
    $('content-note').hidden = !preserved.length;
    $('content-note').innerHTML = preserved.map(text => `<span class="content-tag">${escape(text)}</span>`).join('');
    $('protection-note').hidden = !p.removedMarks.length;
    $('protection-note').textContent = `将移除${p.removedMarks.length}项标记：${p.removedMarks.map(mark => mark.type).join('、')}。应用时需确认。`;
    $('validation-message').hidden = !result.text;
    $('validation-message').className = `validation-message ${result.type}`;
    $('validation-message').setAttribute('role', result.type === 'error' ? 'alert' : 'status');
    $('validation-message').textContent = result.text;
    $('refresh-preview').hidden = !state.stale && p.version === state.version;
    $('refresh-preview').disabled = state.busy;
    $('confirmation').hidden = !confirming;
    $('confirmation-text').textContent = `将移除${p.removedMarks.length}项标记：${p.removedMarks.map(mark => mark.type).join('、')}。保留原音符并调整时值。`;
    $('cancel-rhythm').hidden = confirming; $('apply-rhythm').hidden = confirming;
    $('back-preview').hidden = !confirming; $('confirm-change').hidden = !confirming;
    ['apply-rhythm', 'confirm-change'].forEach(id => { $(id).disabled = !result.ok || state.busy; });
    $('apply-rhythm').textContent = state.busy ? '应用中…' : '应用节奏型';
    $('confirm-change').textContent = state.busy ? '调整中…' : state.failed ? '重试调整' : '确认调整';
    ['close-rhythm', 'cancel-rhythm', 'back-preview'].forEach(id => { $(id).disabled = state.busy; });
    $('application-target').textContent = state.busy ? '正在应用' : `${layerName()} · ${s.ok ? `${s.beatCount} 拍` : '待选择'}`;
    renderScore(); fitDialog();
  }
  function renderScore() {
    $('active-score').innerHTML = staffSVG(state.score.events);
    $('active-layer-label').textContent = layerName();
    $('toolbar-meter').textContent = state.meter;
    $('paper-meter').textContent = `1 = C　${state.meter}`;
    const s = scope();
    $('selection-caption').textContent = `${location(s)}${s.ok ? ` · ${s.reason}` : ''}`;
    $('side-position').textContent = location(s);
    $('side-layer').textContent = layerName();
    $('side-meter').textContent = `${state.meter}（只读）`;
    $('side-length').textContent = s.ok ? `${s.beatCount} 拍` : '—';
    $('measure-hint').textContent = state.meter === '6/8' ? '6/8：2 个演奏拍，每拍附点四分（3 + 3）' : `${state.meter}：每拍四分音符`;
    $('measure-note').textContent = s.ok ? `自动处理范围 · ${s.beatCount} 拍` : '待选择有效范围';
    $('editor-status-text').textContent = state.lastApplied?.message || `${layerName()} · ${location(s)}`;
    $('undo-button').disabled = !state.history.length || state.busy;
    $('document-status').textContent = state.history.length ? '原型内已更新' : '已保存';
    ['review-scenario', 'review-meter', 'review-range', 'review-layer', 'review-reset'].forEach(id => { $(id).disabled = state.busy; });
  }
  function fitDialog() {
    if (!state.open) return;
    const frame = $('editor-frame').getBoundingClientRect(), trigger = $('rhythm-trigger').getBoundingClientRect(), dialog = $('rhythm-dialog');
    const top = trigger.bottom - frame.top + 9;
    dialog.style.top = `${top}px`;
    if (window.innerWidth > 780) dialog.style.left = `${Math.max(12, Math.min(trigger.left - frame.left, frame.width - dialog.offsetWidth - 14))}px`;
    const available = window.innerHeight - frame.top - top - 12;
    dialog.style.maxHeight = `${Math.max(300, Math.min(650, available))}px`;
  }
  function openDialog() {
    if (state.open) { closeDialog(); return; }
    state.open = true; state.failed = false; state.confirmationKey = null;
    const wasStale = state.stale; refreshPreview(); state.stale = wasStale;
    renderDialog(); $(`template-${state.selected}`)?.focus();
  }
  function closeDialog() {
    if (state.busy) return;
    state.open = false; state.failed = false; state.confirmationKey = null;
    renderDialog(); renderScore(); $('rhythm-trigger').focus();
  }
  function showToast(message, canUndo = false) {
    clearTimeout(toastTimer); $('toast-text').textContent = message; $('toast-undo').hidden = !canUndo; $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4000);
  }
  function undo() {
    if (!state.history.length || state.busy) return;
    state.score = state.history.pop(); state.version++; state.appliedCount--; state.lastApplied = null; state.confirmationKey = null;
    if (state.open) state.stale = true;
    renderScore(); renderDialog(); showToast('已撤销，恢复原内容、标记与空位');
  }
  // Ignore opaque IDs when deciding whether a write would change the score.
  function musicalValue(score) {
    return JSON.stringify({ ...score, events: score.events.map(({ id, ...event }) => event) });
  }
  async function apply(confirmed = false) {
    if (state.busy || !validation().ok) return;
    const p = state.preview;
    if (p.removedMarks.length && (!confirmed || state.confirmationKey !== p.key)) {
      state.confirmationKey = p.key; renderDialog(); $('confirm-change').focus(); return;
    }
    const capturedKey = p.key, capturedVersion = state.version;
    state.busy = true; renderDialog();
    await new Promise(resolve => setTimeout(resolve, 300));
    if (capturedVersion !== state.version || capturedKey !== state.preview.key || state.stale) {
      state.busy = false; state.stale = true; state.confirmationKey = null; renderDialog(); return;
    }
    if (state.scenario === 'failure' && state.failNext) {
      state.failNext = false; state.failed = true; state.busy = false; renderDialog();
      $(state.confirmationKey ? 'confirm-change' : 'apply-rhythm').focus(); return;
    }
    state.busy = false;
    if (musicalValue(p.after) === musicalValue(state.score)) {
      closeDialog(); showToast('当前已是此节奏型，未新增撤销记录'); return;
    }
    state.history.push(clone(state.score)); state.score = clone(p.after); state.version++; state.appliedCount++;
    state.lastApplied = { template: state.selected, layer: state.activeLayer, message: `已应用「${p.template.name}」· ${layerName()}` };
    closeDialog(); showToast(state.lastApplied.message, true);
  }
  function resetScenario() {
    if (state.busy) return;
    state.scenario = $('review-scenario').value; state.meter = $('review-meter').value;
    state.range = $('review-range').value; state.activeLayer = $('review-layer').value;
    state.selected = state.meter === '6/8' ? 'three-eighths' : 'eight-sixteen';
    state.score = seedScore(); state.version++; state.history = []; state.lastApplied = null; state.appliedCount = 0; state.failNext = true;
    refreshPreview(); state.stale = state.scenario === 'stale'; $('toast').hidden = true;
    renderScore(); renderDialog();
  }
  $('rhythm-trigger').addEventListener('click', openDialog);
  ['close-rhythm', 'cancel-rhythm'].forEach(id => $(id).addEventListener('click', closeDialog));
  $('apply-rhythm').addEventListener('click', () => apply());
  $('confirm-change').addEventListener('click', () => apply(true));
  $('back-preview').addEventListener('click', () => { state.confirmationKey = null; state.failed = false; renderDialog(); $('apply-rhythm').focus(); });
  ['undo-button', 'toast-undo'].forEach(id => $(id).addEventListener('click', undo));
  $('refresh-preview').addEventListener('click', () => { refreshPreview(); renderDialog(); $('apply-rhythm').focus(); });
  ['review-scenario', 'review-meter', 'review-range', 'review-layer'].forEach(id => $(id).addEventListener('change', resetScenario));
  $('review-reset').addEventListener('click', resetScenario);
  document.addEventListener('keydown', event => {
    if (state.open && event.key === 'Escape') { event.preventDefault(); closeDialog(); }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !['INPUT', 'SELECT'].includes(event.target.tagName)) { event.preventDefault(); undo(); }
    if (state.open && (/^[0-9]$/.test(event.key) || event.key === 'Delete' || event.key === 'Backspace') && !['INPUT', 'SELECT'].includes(event.target.tagName)) event.preventDefault();
  });
  document.addEventListener('pointerdown', event => {
    if (!state.open || state.busy || $('rhythm-dialog').contains(event.target) || $('rhythm-trigger').contains(event.target) || event.target.closest('.review-controls')) return;
    closeDialog();
  });
  window.addEventListener('resize', fitDialog);
  $('duration-tools').innerHTML = [4, 2, 1].map((value, index) => `<button class="tool-button" aria-label="${['四分', '八分', '十六分'][index]}时值" aria-pressed="${index === 0}">${rhythmSVG([value], '')}<small>${['四分', '八分', '十六分'][index]}</small></button>`).join('');
  document.querySelectorAll('#duration-tools svg').forEach(icon => { icon.setAttribute('viewBox', '51 0 35 43'); icon.setAttribute('aria-hidden', 'true'); });
  document.querySelectorAll('.tool-button').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('.tool-button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    showToast('普通单音编辑仅作位置示意');
  }));
  $('play-button').addEventListener('click', () => showToast('设计原型不播放音频'));
  state.score = seedScore(); refreshPreview(); renderScore();
  Object.defineProperty(window, '__req043', { configurable: false, get: () => clone({
    ...state, status: state.busy ? 'applying' : state.stale ? 'stale' : state.failed ? 'failed' : state.confirmationKey ? 'confirming' : state.preview.error ? 'blocked' : state.open ? 'preview' : 'closed',
    scope: scope(), plans: state.preview.plans, perBeatPlans: state.preview.plans,
    rawSelection: selection(), selection: scope().ok ? scope() : null,
    score: { ...state.score, jian: state.activeLayer === 'jian' ? state.score.events : [], tab: state.activeLayer === 'tab' ? state.score.events : [] },
    library: library(), unit: unit(), beats: beats(), validation: validation(),
    proposed: state.preview.after ? { [state.activeLayer]: state.preview.plans.flatMap(plan => plan.after) } : null,
    historyCount: state.history.length, undo: state.history.at(-1) || null, previewVersion: state.preview.version
  }) });
})();
