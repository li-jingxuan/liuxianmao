const scenarios = {
  same: { notes: ['6̣', '6̣'], start: 7, available: ['tie', 'slur'] },
  different: { notes: ['6̣', '5̣'], start: 5, available: ['slur'] },
  phrase: { notes: ['6̣', '6̣', '5̣'], start: 5, available: ['slur'] },
  rest: { notes: ['6̣', '0', '5̣'], start: 5, available: [], blocked: '选区含休止符' },
};

const commandNames = { tie: '延音线', slur: '圆滑线' };
const addDetails = { tie: '同音持续发声', slur: '各音保留原时值' };
const unavailableDetails = { tie: '需要两个相邻同音', slur: '需要连续音符' };
const score = document.querySelector('#score');
const anchor = document.querySelector('#arc-anchor');
const trigger = document.querySelector('#arc-trigger');
const popover = document.querySelector('#arc-popover');
const feedback = document.querySelector('#feedback');
const undo = document.querySelector('#undo');
const redo = document.querySelector('#redo');
const caseButtons = [...document.querySelectorAll('[data-case]')];
const commandButtons = [...popover.querySelectorAll('[data-command]')];
const past = [];
const future = [];
let activeCase = 'same';
let appliedMarks = {};

function setNote(value, note) {
  value.dataset.low = String(note.endsWith('\u0323'));
  value.textContent = note.replace('\u0323', '');
}

function buildSystem({ notes, frets, chords, firstMeasure, editable = false }) {
  const system = document.createElement('section');
  system.className = 'system';
  system.setAttribute('aria-label', `第 ${firstMeasure} 到 ${firstMeasure + 2} 小节`);
  const staff = document.createElement('div');
  staff.className = 'staff';
  staff.setAttribute('aria-hidden', 'true');
  const numbered = document.createElement('div');
  numbered.className = 'numbered';
  const stringPositions = [8, 16, 24, 32, 24, 8, 16, 32, 24, 32, 16, 8];

  for (const [index, note] of notes.entries()) {
    const staffNote = document.createElement('div');
    staffNote.className = 'staff-note';
    if (index % 4 === 0) {
      const measure = document.createElement('span');
      measure.className = 'measure-number';
      measure.textContent = firstMeasure + index / 4;
      const chord = document.createElement('span');
      chord.className = 'chord';
      chord.textContent = chords[index / 4];
      staffNote.append(measure, chord);
    }
    const fret = document.createElement('span');
    fret.className = 'tab-digit';
    fret.textContent = frets[index];
    fret.style.setProperty('--string', `${stringPositions[index]}px`);
    staffNote.append(fret);
    staff.append(staffNote);

    const numberedNote = document.createElement('span');
    numberedNote.className = 'numbered-note';
    const value = document.createElement('span');
    value.className = 'note-value';
    setNote(value, note);
    numberedNote.append(value);
    numbered.append(numberedNote);
  }

  if (editable) {
    const selection = document.createElement('div');
    selection.className = 'selection';
    const tie = document.createElement('div');
    tie.className = 'mark';
    tie.dataset.mark = 'tie';
    const slur = document.createElement('div');
    slur.className = 'mark mark-slur';
    slur.dataset.mark = 'slur';
    numbered.append(selection, tie, slur);
    numbered.id = 'editable-numbered';
  }
  system.append(staff, numbered);
  return system;
}

const referenceNotes = ['5̣', '6̣', '1', '3', '2', '1', '6̣', '5̣', '3', '2', '1', '5̣'];
const frets = ['0', '2', '0', '0', '2', '0', '3', '2', '0', '1', '0', '2'];
score.append(
  buildSystem({ notes: referenceNotes, frets, chords: ['G', 'Em', 'C'], firstMeasure: 1, editable: true }),
  buildSystem({ notes: ['1', '2', '3', '5', '3', '2', '1', '6̣', '5̣', '6̣', '1', '0'], frets, chords: ['Am', 'D', 'G'], firstMeasure: 4 }),
);

const numbered = document.querySelector('#editable-numbered');
const noteNodes = [...numbered.querySelectorAll('.numbered-note')];
const selection = numbered.querySelector('.selection');
const markNodes = [...numbered.querySelectorAll('[data-mark]')];

function render() {
  const { notes, start, available, blocked } = scenarios[activeCase];
  const marks = appliedMarks[activeCase] ?? [];
  const cells = noteNodes.length;
  for (const [index, node] of noteNodes.entries()) {
    const selected = index >= start && index < start + notes.length;
    setNote(node.firstElementChild, selected ? notes[index - start] : referenceNotes[index]);
    node.classList.toggle('selected', selected);
  }
  selection.style.setProperty('--left', `${(start + 0.12) / cells * 100}%`);
  selection.style.setProperty('--width', `${(notes.length - 0.24) / cells * 100}%`);
  for (const arc of markNodes) {
    arc.style.setProperty('--start', `${(start + 0.5) / cells * 100}%`);
    arc.style.setProperty('--span', `${(notes.length - 1) / cells * 100}%`);
    arc.hidden = !marks.includes(arc.dataset.mark);
  }

  for (const button of commandButtons) {
    const key = button.dataset.command;
    const existing = marks.includes(key);
    const recommended = available[0] === key && !existing;
    button.disabled = !available.includes(key);
    button.dataset.recommended = String(recommended);
    button.querySelector('.command-label').textContent = `${existing ? '移除' : ''}${commandNames[key]}`;
    button.querySelector('.recommendation').hidden = !recommended;
    button.querySelector('.command-detail').textContent = button.disabled ? (blocked ?? unavailableDetails[key]) : addDetails[key];
    button.setAttribute('aria-labelledby', recommended ? `${key}-label ${key}-recommendation` : `${key}-label`);
  }
  undo.disabled = past.length === 0;
  redo.disabled = future.length === 0;
  for (const button of caseButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.case === activeCase));
  }
}

function setOpen(open, moveFocus = false) {
  popover.hidden = !open;
  trigger.setAttribute('aria-expanded', String(open));
  if (moveFocus) {
    const command = open ? commandButtons.find(button => !button.disabled) : null;
    (command ?? trigger).focus();
  }
}

trigger.addEventListener('click', event => setOpen(popover.hidden, event.detail === 0));
document.addEventListener('click', event => {
  if (!anchor.contains(event.target) && !event.target.closest('[data-case]')) setOpen(false);
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || popover.hidden) return;
  event.preventDefault();
  setOpen(false, true);
});
for (const button of caseButtons) {
  button.addEventListener('click', () => {
    activeCase = button.dataset.case;
    feedback.textContent = '';
    render();
    setOpen(true);
  });
}
for (const button of commandButtons) {
  button.addEventListener('click', () => {
    const key = button.dataset.command;
    const marks = appliedMarks[activeCase] ?? [];
    const existing = marks.includes(key);
    past.push({ marks: appliedMarks, activeCase });
    future.length = 0;
    appliedMarks = { ...appliedMarks, [activeCase]: existing ? marks.filter(mark => mark !== key) : [...marks, key] };
    render();
    setOpen(false, true);
    feedback.textContent = `已${existing ? '移除' : '添加'}${commandNames[key]}`;
  });
}

function restore(from, to, message) {
  to.push({ marks: appliedMarks, activeCase });
  const entry = from.pop();
  appliedMarks = entry.marks;
  activeCase = entry.activeCase;
  render();
  feedback.textContent = message;
}

undo.addEventListener('click', () => restore(past, future, '已撤销'));
redo.addEventListener('click', () => restore(future, past, '已重做'));
render();
