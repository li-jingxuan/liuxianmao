const reviewHints = {
  empty: '空值不显示谱面速度标记，试听仍使用默认 90 BPM。',
  saved: '曲谱速度随曲谱保存，并在第一小节上方显示。',
  playback: '试听弹层中的临时调速只影响当前播放，可一键恢复曲谱速度。',
};

const reviewButtons = [...document.querySelectorAll('[data-review]')];
const performanceForm = document.querySelector('#performance-form');
const capoSelect = document.querySelector('#capo-select');
const bpmInput = document.querySelector('#bpm-input');
const displayTempo = document.querySelector('#display-tempo');
const applyPerformance = document.querySelector('#apply-performance');
const scoreInfo = document.querySelector('#score-info');
const savedBpmLabel = document.querySelector('#saved-bpm-label');
const playbackBpm = document.querySelector('#playback-bpm');
const playbackBpmValue = document.querySelector('#playback-bpm-value');
const resetPlayback = document.querySelector('#reset-playback');
const playbackPopover = document.querySelector('#playback-popover');
const playButton = document.querySelector('#play-button');
const saveMessage = document.querySelector('#save-message');
const playbackState = document.querySelector('#playback-state');
const popoverPlay = document.querySelector('#popover-play');
const sliderLabels = document.querySelectorAll('.slider-scale span');
const defaultBpm = 90;
const sliderMin = Number(playbackBpm.min);
const sliderMax = Number(playbackBpm.max);
let savedSettings = { capo: '0', bpm: defaultBpm, displayTempo: true };
let temporaryBpm = null;

function updateApplyButton() {
  const savedBpmInput = savedSettings.bpm === null ? '' : String(savedSettings.bpm);
  applyPerformance.disabled = bpmInput.validity.valid
    && capoSelect.value === savedSettings.capo
    && bpmInput.value === savedBpmInput
    && displayTempo.checked === savedSettings.displayTempo;
}

function renderPerformance() {
  // 展示选项只控制谱面标记。试听仍读取已应用的 BPM，留空时使用默认速度。
  const { capo, bpm, displayTempo: visible } = savedSettings;
  scoreInfo.textContent = [
    '1=G',
    '4/4',
    capo !== '0' ? `Capo ${capo}` : '',
    bpm !== null && visible ? `♩ = ${bpm}` : '',
  ].filter(Boolean).join(' · ');
  savedBpmLabel.textContent = bpm === null ? `未设置 · 默认 ${defaultBpm} BPM` : `${bpm} BPM`;
  resetPlayback.querySelector('span').textContent = `${bpm ?? defaultBpm} BPM`;
  updateApplyButton();
  updatePlaybackValue();
}

function showReview(state) {
  reviewButtons.forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.review === state));
  });
  document.querySelector('#review-hint').textContent = reviewHints[state];
  savedSettings = { capo: '0', bpm: state === 'empty' ? null : defaultBpm, displayTempo: true };
  capoSelect.value = savedSettings.capo;
  bpmInput.value = savedSettings.bpm ?? '';
  displayTempo.checked = savedSettings.displayTempo;
  temporaryBpm = state === 'playback' ? 120 : null;
  saveMessage.textContent = '';
  renderPerformance();
  if (state === 'playback') openPlayback();
}

function openPlayback() {
  playbackPopover.hidden = false;
  playButton.setAttribute('aria-expanded', 'true');
}

function closePlayback() {
  playbackPopover.hidden = true;
  playButton.setAttribute('aria-expanded', 'false');
}

function updatePlaybackValue() {
  const baseline = savedSettings.bpm ?? defaultBpm;
  const effectiveBpm = temporaryBpm ?? baseline;
  // 滑杆必须容纳已应用的速度，否则浏览器会把恢复值限制在滑杆原有范围内。
  playbackBpm.min = Math.min(sliderMin, baseline, effectiveBpm);
  playbackBpm.max = Math.max(sliderMax, baseline, effectiveBpm);
  sliderLabels[0].textContent = playbackBpm.min;
  sliderLabels[2].textContent = playbackBpm.max;
  playbackBpm.value = effectiveBpm;
  playbackBpmValue.textContent = `${effectiveBpm} BPM`;
  if (popoverPlay.dataset.playing !== 'true') {
    playbackState.textContent = effectiveBpm === baseline ? '按曲谱速度试听' : '临时调速试听';
  }
}

reviewButtons.forEach((button) => button.addEventListener('click', () => showReview(button.dataset.review)));
playButton.addEventListener('click', () => (playbackPopover.hidden ? openPlayback() : closePlayback()));
document.querySelector('#close-popover').addEventListener('click', closePlayback);
playbackBpm.addEventListener('input', () => {
  const baseline = savedSettings.bpm ?? defaultBpm;
  temporaryBpm = playbackBpm.valueAsNumber === baseline ? null : playbackBpm.valueAsNumber;
  updatePlaybackValue();
});
resetPlayback.addEventListener('click', () => {
  temporaryBpm = null;
  updatePlaybackValue();
});
performanceForm.addEventListener('input', () => {
  saveMessage.textContent = '';
  updateApplyButton();
});
performanceForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (applyPerformance.disabled) return;
  savedSettings = {
    capo: capoSelect.value,
    bpm: bpmInput.value === '' ? null : bpmInput.valueAsNumber,
    displayTempo: displayTempo.checked,
  };
  renderPerformance();
  saveMessage.textContent = '演奏设置已应用';
});
popoverPlay.addEventListener('click', (event) => {
  const button = event.currentTarget;
  const isPlaying = button.dataset.playing === 'true';
  button.dataset.playing = String(!isPlaying);
  button.setAttribute('aria-label', isPlaying ? '播放' : '暂停');
  button.innerHTML = isPlaying
    ? '<svg aria-hidden="true" viewBox="0 0 20 20"><path d="M7 4.8v10.4a1 1 0 0 0 1.54.84l7.44-5.2a1 1 0 0 0 0-1.68L8.54 3.96A1 1 0 0 0 7 4.8Z"/></svg>'
    : '<svg aria-hidden="true" viewBox="0 0 20 20"><path d="M6 4h3v12H6zm5 0h3v12h-3z"/></svg>';
  playbackState.textContent = isPlaying ? '准备试听' : '正在试听';
});

renderPerformance();
