const reviewHints = {
  empty: '空值不显示谱面速度标记，试听仍使用默认 90 BPM。',
  saved: '曲谱速度随曲谱保存，并在第一小节上方显示。',
  playback: '试听弹层中的临时调速只影响当前播放，可一键恢复曲谱速度。',
};

const reviewButtons = [...document.querySelectorAll('[data-review]')];
const bpmInput = document.querySelector('#bpm-input');
const tempoMark = document.querySelector('#tempo-mark');
const savedBpmLabel = document.querySelector('#saved-bpm-label');
const playbackBpm = document.querySelector('#playback-bpm');
const playbackBpmValue = document.querySelector('#playback-bpm-value');
const resetPlayback = document.querySelector('#reset-playback');
const playbackPopover = document.querySelector('#playback-popover');
const playButton = document.querySelector('#play-button');
const saveMessage = document.querySelector('#save-message');
const playbackState = document.querySelector('#playback-state');
let savedBpm = 90;

function renderSavedSpeed() {
  const value = Number(bpmInput.value);
  savedBpm = Number.isFinite(value) && value > 0 ? value : null;
  tempoMark.textContent = savedBpm ? `♩ = ${savedBpm}` : '';
  tempoMark.classList.toggle('is-empty', !savedBpm);
  savedBpmLabel.textContent = savedBpm ? `${savedBpm} BPM` : '未设置 · 默认 90 BPM';
  resetPlayback.querySelector('span').textContent = `${savedBpm || 90} BPM`;
  if (!playbackPopover.hidden && playbackBpm.value === playbackBpm.dataset.previousSaved) {
    playbackBpm.value = savedBpm || 90;
  }
  playbackBpm.dataset.previousSaved = String(savedBpm || 90);
}

function showReview(state) {
  reviewButtons.forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.review === state));
  });
  document.querySelector('#review-hint').textContent = reviewHints[state];
  if (state === 'empty') {
    bpmInput.value = '';
    renderSavedSpeed();
  }
  if (state === 'saved') {
    bpmInput.value = 90;
    renderSavedSpeed();
  }
  if (state === 'playback') {
    bpmInput.value = 90;
    renderSavedSpeed();
    openPlayback();
    playbackBpm.value = 120;
    updatePlaybackValue();
  }
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
  playbackBpmValue.textContent = `${playbackBpm.value} BPM`;
  playbackState.textContent = Number(playbackBpm.value) === (savedBpm || 90) ? '按曲谱速度试听' : '临时调速试听';
}

reviewButtons.forEach((button) => button.addEventListener('click', () => showReview(button.dataset.review)));
playButton.addEventListener('click', () => (playbackPopover.hidden ? openPlayback() : closePlayback()));
document.querySelector('#close-popover').addEventListener('click', closePlayback);
playbackBpm.addEventListener('input', updatePlaybackValue);
resetPlayback.addEventListener('click', () => {
  playbackBpm.value = savedBpm || 90;
  updatePlaybackValue();
});
document.querySelector('#song-form').addEventListener('submit', (event) => {
  event.preventDefault();
  renderSavedSpeed();
  saveMessage.textContent = savedBpm ? `曲谱速度已应用 · ♩ = ${savedBpm}` : '曲谱速度已清空';
});
document.querySelector('#clear-bpm').addEventListener('click', () => {
  bpmInput.value = '';
  renderSavedSpeed();
  saveMessage.textContent = '曲谱速度已清空 · 试听默认 90 BPM';
});
document.querySelector('#popover-play').addEventListener('click', (event) => {
  const button = event.currentTarget;
  const isPlaying = button.dataset.playing === 'true';
  button.dataset.playing = String(!isPlaying);
  button.setAttribute('aria-label', isPlaying ? '播放' : '暂停');
  button.innerHTML = isPlaying
    ? '<svg aria-hidden="true" viewBox="0 0 20 20"><path d="M7 4.8v10.4a1 1 0 0 0 1.54.84l7.44-5.2a1 1 0 0 0 0-1.68L8.54 3.96A1 1 0 0 0 7 4.8Z"/></svg>'
    : '<svg aria-hidden="true" viewBox="0 0 20 20"><path d="M6 4h3v12H6zm5 0h3v12h-3z"/></svg>';
  playbackState.textContent = isPlaying ? '准备试听' : '正在试听';
});

renderSavedSpeed();
