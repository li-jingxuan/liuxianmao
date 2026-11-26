const hero = document.querySelector('.hero');
const toggle = hero.querySelector('.cue-toggle');
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
let visible = false;
let userPaused = false;

// 离开首屏或切换标签页时冻结当前进度。手动暂停独立保留，重新进入视口也不会擅自恢复。
function syncCue() {
  const enabled = !reduce.matches;
  hero.classList.toggle('cue-enabled', enabled);
  hero.classList.toggle('cue-running', enabled && visible && !document.hidden && !userPaused);
  toggle.hidden = !enabled;
  toggle.textContent = userPaused ? '继续选框' : '暂停选框';
}

toggle.addEventListener('click', () => {
  userPaused = !userPaused;
  syncCue();
});
new IntersectionObserver(([entry]) => {
  visible = entry.isIntersecting && entry.intersectionRatio >= 0.2;
  syncCue();
}, { threshold: 0.2 }).observe(hero);
document.addEventListener('visibilitychange', syncCue);
reduce.addEventListener('change', syncCue);
syncCue();
