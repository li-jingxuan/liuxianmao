const forms = {
  '四分音符': [4], '两个八分': [2, 2], '前八后十六': [2, 1, 1], '前十六后八': [1, 1, 2],
  '四个十六分': [1, 1, 1, 1], '附点八分＋十六': [3, 1], '小切分': [1, 2, 1], '十六＋附点八分': [1, 3],
  '附点八分＋两三十二': [3, 0.5, 0.5], '两三十二＋附点八分': [0.5, 0.5, 3],
  '八分＋四三十二': [2, 0.5, 0.5, 0.5, 0.5], '四三十二＋八分': [0.5, 0.5, 0.5, 0.5, 2],
};
const regularPatterns = Object.entries(forms).map(([form, lengths]) => ({ id: form, name: form, form, lengths }));
const [quarter, eighths, eightSixteen, sixteenEight, sixteenths, dotted, syncopation, reverseDotted] = [
  '四分音符', '两个八分', '前八后十六', '前十六后八', '四个十六分', '附点八分＋十六', '小切分', '十六＋附点八分',
];
const measurePatterns = [
  ['alternating', '交替分解', [eightSixteen, sixteenths, eightSixteen, sixteenths]],
  ['mirrored', '前后十六交替', [eightSixteen, sixteenEight, eightSixteen, sixteenEight]],
  ['quarter-split', '四分与分解', [quarter, eightSixteen, quarter, eightSixteen]],
  ['eighths', '均匀八分', Array(4).fill(eighths)],
  ['sixteenths', '均匀十六分', Array(4).fill(sixteenths)],
  ['eighth-sixteenth', '八十六交替', [eighths, sixteenths, eighths, sixteenths]],
  ['quarter-eighth', '四八交替', [quarter, eighths, quarter, eighths]],
  ['dotted', '附点推进', [dotted, eighths, dotted, eighths]],
  ['mirrored-dotted', '正反附点', [dotted, reverseDotted, dotted, reverseDotted]],
  ['syncopated', '切分交替', [syncopation, eighths, syncopation, eighths]],
  ['building', '先疏后密', [quarter, eighths, eightSixteen, sixteenths]],
  ['dense-end', '后半段加密', [eighths, eighths, sixteenths, sixteenths]],
  ['closing', '四拍收束', [eighths, eightSixteen, sixteenths, quarter]],
  ['quarters', '均匀四分', Array(4).fill(quarter)],
].map(([id, name, beatForms]) => ({ id, name, beatForms }));
const patterns = [
  ['d', '下', '四分音符'], ['du', '下上', '两个八分'],
  ['uud', '上上下', '前八后十六'], ['udud', '上下上下', '四个十六分'],
  ['ddu', '下下上', '前八后十六'], ['dud', '下上下', '前十六后八'],
  ['ud', '上下', '两个八分'], ['dudu', '下上下上', '四个十六分'],
  ['uud-short', '上上下', '前十六后八'], ['dud-sync', '下上下', '小切分'],
  ['du-dotted', '下上', '附点八分＋十六'], ['ud-dotted', '上下', '十六＋附点八分'],
].map(([id, name, form]) => ({ id, name, form, lengths: forms[form], directions: [...name] }));

const $ = id => document.getElementById(id);
const chordFrets = { G: [3, 0, 0, 0, 2, 3], C: [0, 1, 0, 2, 3, null], Am: [0, 1, 2, 2, 0, null], D: [2, 3, 2, 0, null, null] };
const chords = ['G', 'C', 'Am', 'D', 'G', 'C'];
const beats = chords.flatMap(() => Array.from({length: 4}, () => ({form: '四分音符'})));
beats[1] = patterns.find(p => p.id === 'uud');
const state = {
  mode: location.hash === '#sidebar' ? 'sidebar' : 'bubble', tab: 'rhythm', beat: 1,
  drafts: {}, expanded: { bubble: {}, sidebar: {} }, history: [],
};
const range = (measure = false) => `第 ${Math.floor(state.beat / 4) + 1} 小节 · ${measure ? '整小节' : `第 ${state.beat % 4 + 1} 拍`}`;

function changesFor(template) {
  if (!template) return [];
  const first = template.beatForms ? state.beat - state.beat % 4 : state.beat;
  const replacements = template.beatForms?.map(form => ({ form })) ?? [template.directions ? template : { form: template.form }];
  return replacements.map((next, offset) => ({ index: first + offset, next, previous: beats[first + offset] }))
    .filter(({ next, previous }) => next.id !== previous.id || next.form !== previous.form);
}

function beatDrawing(index, frets) {
  const {form, directions = []} = beats[index];
  const lengths = forms[form];
  const selected = index === state.beat;
  const ink = selected ? '#1969d1' : '#303947';
  const paper = selected ? '#edf5ff' : 'white';
  const lastString = frets.findLastIndex(f => f !== null);
  let slot = 0;
  const xs = lengths.map(length => { const x = 13 + slot * 24; slot += length; return x; });
  const stemY = 96;
  const notes = lengths.map((length, i) => {
    const x = xs[i];
    const dir = directions[i];
    const tip = dir === '下' ? 40 : 40 + lastString * 8;
    const tail = dir === '下' ? 40 + lastString * 8 : 40;
    const head = dir === '下' ? 4 : -4;
    const arrow = dir ? `<path d="M${x-7} ${tail}V${tip}m-2.8 ${head}l2.8 ${-head} 2.8 ${head}" fill="none" stroke="${ink}" stroke-width="1.35"/>` : '';
    const nums = frets.map((f, string) => f === null ? '' : `<text x="${x}" y="${43.5 + string * 8}" text-anchor="middle" stroke="${paper}" stroke-width="2.7" paint-order="stroke" fill="${ink}" font-size="11.5">${f}</text>`).join('');
    const dot = length === 3 ? `<circle cx="${x+4}" cy="87" r="1.6" fill="${ink}"/>` : '';
    return `${arrow}${nums}<path d="M${x} 84V${stemY}" stroke="${ink}"/>${dot}`;
  }).join('');
  let beams = '';
  if (lengths.length > 1) {
    beams = `<path d="M${xs[0]} ${stemY}H${xs.at(-1)}" stroke="${ink}" stroke-width="2.8"/>`;
    for (const [maximum, y] of [[1, stemY - 4], [0.5, stemY - 8]]) {
      lengths.forEach((length, i) => {
        if (length > maximum) return;
        const connectsRight = lengths[i + 1] <= maximum;
        if (!connectsRight && lengths[i - 1] <= maximum) return;
        const end = connectsRight ? xs[i + 1] : xs[i] + (i ? -5 : 5);
        beams += `<path d="M${xs[i]} ${y}H${end}" stroke="${ink}" stroke-width="2.7"/>`;
      });
    }
  }
  const desc = `${Math.floor(index/4)+1} 小节第 ${index%4+1} 拍，${directions.join('')}${form}`;
  return `<g transform="translate(${index%4*99},0)" role="button" tabindex="0" data-beat="${index}" aria-label="第 ${desc}" aria-pressed="${selected}"><rect class="beat-hit" x="0" y="29" width="99" height="82" rx="3" fill="${selected ? '#edf5ff' : 'white'}" stroke="${selected ? '#86b6ff' : 'none'}"/><path d="${Array.from({length:6},(_,s)=>`M0 ${40+s*8}h99`).join(' ')}" stroke="#727984" stroke-width=".8"/>${beams}${notes}${selected ? `<text x="49.5" y="126" text-anchor="middle" font-size="12" fill="${ink}">第 ${index%4+1} 拍</text>` : ''}</g>`;
}

function measureDrawing(i, offset) {
  const chord = chords[i];
  const contents = Array.from({length:4},(_,beat)=>beatDrawing(i*4+beat,chordFrets[chord])).join('');
  return `<g transform="translate(${offset},0)"><text x="2" y="19" fill="#6f7b8d" font-size="11">${i+1}</text><text x="23" y="20" font-size="17" font-weight="650" fill="#263548">${chord}</text>${contents}<path d="M0 40v40M396 40v40" stroke="#56616f" pointer-events="none"/></g>`;
}

function render() {
  const prior = document.activeElement?.closest('[data-action]');
  const priorHost = prior?.closest('#bubble,#sidebar');
  const host = state.mode === 'bubble' ? $('bubble') : state.mode === 'sidebar' ? $('sidebar') : null;
  $('bubble').hidden = state.mode !== 'bubble';
  $('sidebar').hidden = state.mode !== 'sidebar';
  $('side-entry').hidden = state.mode === 'sidebar';
  $('rhythm').setAttribute('aria-expanded', String(state.mode === 'bubble'));
  $('undo').disabled = !state.history.length;
  $('range').textContent = range();
  const beat = beats[state.beat];
  if (host) {
    const strum = state.tab === 'strum';
    const activeStrum = strum && beat.directions ? beat : null;
    const draft = state.drafts[state.tab];
    const selected = draft?.id ?? (strum ? activeStrum?.id : beat.form);
    const last = state.history.at(-1);
    const canUndo = activeStrum && !draft && last?.tab === 'strum' && last.beat === state.beat;
    const detail = draft?.directions ? (draft.id === activeStrum?.id ? `已应用${draft.name} · ${draft.form}` : `待应用${draft.name} · ${draft.form}`) : draft?.name ??
      (activeStrum ? `已应用${activeStrum.name} · ${activeStrum.form}` : strum ? '请选择扫弦模板' : beat.form);
    renderPanel(host, state.mode, {
      tab: state.tab, expanded: state.expanded[state.mode], forms, regularPatterns, measurePatterns, patterns,
      draft, selected, activeStrum, canUndo, detail, canApply: changesFor(draft).length > 0,
      range: range(!!draft?.beatForms),
    });
    if (priorHost === host && prior) {
      [...host.querySelectorAll('[data-action]')].find(b=>b.dataset.action===prior.dataset.action && b.dataset.value===prior.dataset.value)?.focus({preventScroll:true});
    }
  }
  $('score').innerHTML = ['前奏','主歌','间奏'].map((part,row)=>`<div class="staff-line"><span class="section-name">${part}</span><svg viewBox="0 0 826 130" role="group" aria-label="${part}六线谱"><text x="6" y="45" fill="#687789" font-size="12" font-weight="600"><tspan>T</tspan><tspan x="5" dy="16">A</tspan><tspan x="5" dy="16">B</tspan></text>${measureDrawing(2*row,22)}${measureDrawing(2*row+1,418)}</svg></div>`).join('');
}

function openMode(mode) {
  state.mode = mode;
  render();
  if (mode === 'closed') $('rhythm').focus();
  else $(mode).querySelector('[role="tab"][aria-selected="true"]')?.focus({preventScroll:true});
}

function undoBeat(focusPanel = false) {
  const previous = state.history.pop();
  if (!previous) return;
  previous.changes.forEach(({ index, previous: beat }) => { beats[index] = beat; });
  state.beat = previous.beat;
  state.drafts = {};
  $('status-text').textContent = `已撤销 · ${range()}`;
  render();
  if (focusPanel) focusSelection();
}
$('rhythm').onclick = () => openMode(state.mode === 'bubble' ? 'closed' : 'bubble');
$('side-entry').onclick = () => openMode('sidebar');
$('undo').onclick = () => undoBeat();
function selectBeat(index) {
  if (index !== state.beat) state.drafts = {};
  state.beat = index;
  if (state.mode === 'bubble') state.mode = 'sidebar';
  $('status-text').textContent = `已选中${range()}`;
  render();
  $('score').querySelector(`[data-beat="${index}"]`).focus({preventScroll:true});
}

function selectTab(tab) {
  if (state.tab === tab) return;
  state.tab = tab;
  render();
  $(state.mode).querySelector('[role="tab"][aria-selected="true"]')?.focus({preventScroll:true});
}

function applyDraft() {
  const strum = state.tab === 'strum';
  const draft = state.drafts[state.tab];
  const changes = changesFor(draft);
  if (!changes.length) return;
  state.history.push({ tab: state.tab, beat: state.beat, changes });
  changes.forEach(({ index, next }) => { beats[index] = next; });
  state.drafts = {};
  $('status-text').textContent = `${range(!!draft.beatForms)} 已应用${draft.name}${strum ? ` · ${draft.form}` : ''}`;
  if (!strum && state.mode === 'bubble') return openMode('closed');
  render();
  focusSelection();
}

function focusSelection() {
  const host = $(state.mode);
  (host.querySelector('.sp-template[aria-pressed="true"]') ?? host.querySelector('[role="tab"][aria-selected="true"]'))
    ?.focus({preventScroll:true});
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && state.mode === 'bubble') openMode('closed');
  const tab = event.target.closest('[role="tab"]');
  if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const next = event.key === 'Home' ? 'rhythm' : event.key === 'End' ? 'strum' : tab.dataset.value === 'rhythm' ? 'strum' : 'rhythm';
    selectTab(next);
  }
  const beat = event.target.closest('[data-beat]');
  if (beat && ['Enter',' '].includes(event.key)) {
    event.preventDefault();
    selectBeat(Number(beat.dataset.beat));
  }
});
document.addEventListener('click', event => {
  const beat = event.target.closest('[data-beat]');
  if (beat) return selectBeat(Number(beat.dataset.beat));
  const button = event.target.closest('button[data-action]');
  if (!button) {
    if (event.target.closest('.canvas') && state.mode === 'bubble') openMode('closed');
    return;
  }
  const {action,value} = button.dataset;
  if (action === 'cancel') {
    delete state.drafts[state.tab];
    return openMode('closed');
  }
  if (action === 'close' || action === 'sidebar') return openMode(action === 'close' ? 'closed' : 'sidebar');
  if (action === 'undo') return undoBeat(true);
  if (action === 'tab') return selectTab(value);
  if (action === 'apply') return applyDraft();
  const toggles = { expand: 'pattern', 'regular-expand': 'regular', 'measure-expand': 'measure' };
  const group = toggles[action];
  if (group) {
    const expanded = state.expanded[state.mode];
    expanded[group] = !expanded[group];
  } else {
    const choices = { pattern: patterns, regular: regularPatterns, measure: measurePatterns };
    const draft = choices[action]?.find(pattern => pattern.id === value);
    if (!draft) return;
    state.drafts[state.tab] = draft;
  }
  render();
});
$('status-text').textContent = `已选中${range()}`;
render();
