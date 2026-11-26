// 图片与说明均在 HTML 中。脚本只增强轮播；首张图及所有下载操作可独立使用。
const gallery = document.querySelector('.gallery');
const slides = Array.from(gallery.querySelectorAll('.slide'));
const controls = gallery.querySelector('.gallery-controls');
const playButton = controls.querySelector('.autoplay');
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const interval = 7000;
let current = 0;
let paused = false;
let timer;

function changeSlide(direction, manual) {
  slides[current].hidden = true;
  current = (current + direction + slides.length) % slides.length;
  gallery.classList.add('is-switching');
  slides[current].hidden = false;
  controls.querySelector('.gallery-count').textContent = `${current + 1} / ${slides.length}`;
  if (manual) {
    const title = slides[current].querySelector('h2').textContent;
    gallery.querySelector('[role="status"]').textContent = `第 ${current + 1} 张，共 ${slides.length} 张，${title}`;
  }
  schedule();
}

// 离开悬停或键盘焦点后重新给满七秒。用户主动暂停、减弱动态、页面后台和模态阅读均优先。
function schedule() {
  window.clearTimeout(timer);
  if (paused || reduced.matches || document.hidden || document.querySelector('dialog[open]') || gallery.matches(':hover, :focus-within')) return;
  timer = window.setTimeout(() => changeSlide(1, false), interval);
}

function updatePlayback() {
  playButton.hidden = reduced.matches;
  playButton.textContent = paused ? '继续轮播' : '暂停轮播';
  playButton.setAttribute('aria-label', paused ? '继续自动轮播' : '暂停自动轮播');
  schedule();
}

controls.querySelector('.previous').addEventListener('click', () => changeSlide(-1, true));
controls.querySelector('.next').addEventListener('click', () => changeSlide(1, true));
playButton.addEventListener('click', () => { paused = !paused; updatePlayback(); });
for (const event of ['pointerenter','pointerleave','focusin']) gallery.addEventListener(event, schedule);
gallery.addEventListener('focusout', () => window.queueMicrotask(schedule));
document.addEventListener('visibilitychange', schedule);
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('toggle', schedule);
reduced.addEventListener('change', updatePlayback);
controls.hidden = false;
updatePlayback();
