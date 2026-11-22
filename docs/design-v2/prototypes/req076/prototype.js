const measures = [
  ["G", [[6, 3, 2, 3], [4, 0], [3, 0], [2, 1]]],
  ["C", [[6, 0], [4, 2], [3, 0], [2, 1]]],
  ["Em", [[6, 0, 1, 0], [5, 2], [4, 2], [3, 0]]],
  ["G", [[6, 3, 2, 3], [3, 2], [2, 0], [3, 0]]],
  ["G", [[6, 3], [4, 0], [3, 0], [2, 3]]],
  ["Am", [[5, 0, 2, 1], [4, 2], [3, 2], [1, 0]]],
  ["D", [[4, 0, 3, 2], [2, 3], [1, 2], [3, 2]]],
  ["G", [[6, 3], [4, 0], [3, 0], [2, 3]]],
  ["Em", [[6, 0, 1, 0], [5, 2], [4, 2], [3, 0]]],
  ["C", [[5, 3, 2, 1], [4, 2], [3, 0], [1, 0]]],
  ["D", [[4, 0], [3, 2], [2, 3], [1, 2]]],
  ["G", [[6, 3, 2, 3], [4, 0], [3, 0], [1, 3]]],
];

const byId = (id) => document.getElementById(id);
const audition = byId("audition");
const playbackTools = byId("transport");
const editingTools = byId("editing-tools");
const sidebar = byId("sidebar");
const play = byId("play");
const stop = byId("stop");
const start = byId("start");
const tempo = byId("tempo");
const follow = byId("follow");
const viewport = byId("viewport");
const score = byId("score");
const demoButtons = document.querySelectorAll("[data-demo]");
const labels = {
  idle: "播放",
  loading: "加载中",
  playing: "暂停",
  paused: "继续",
  error: "重试",
};

let demo = "normal";
let phase = "idle";
let failsOnLoad = false;
let follows = true;
let selection = { measure: 1, beat: 0 };
let visitedBeats = [];
let currentIndex = -1;
let elapsed = 0;
let playingSince = 0;
let beatLength = 0;
let frame = 0;
let loadingTimer = 0;

function renderScore() {
  const staff = [];
  const notes = [];
  const beatTargets = [];
  for (const [measure, [chord, beats]] of measures.entries()) {
    const column = measure % 3;
    const row = Math.floor(measure / 3);
    const x = 25 + column * 237;
    const y = 59 + row * 149;

    if (column === 0) {
      for (let string = 0; string < 6; string++) {
        staff.push(`<path class="staff-line" d="M25 ${y + string * 10}H736"/>`);
      }
      staff.push(`<text class="tab-label" x="7" y="${y + 14}">T<tspan x="7" dy="13">A</tspan><tspan x="7" dy="13">B</tspan></text>`);
    }
    staff.push(`<path class="staff-line" d="M${x} ${y}v50"/>`);
    if (column === 2) {
      staff.push(`<path class="staff-line" d="M736 ${y}v50"/>`);
    }
    if (demo === "repeat" && measure === 2) {
      staff.push(`<path class="repeat-boundary" d="M732 ${y}v50"/><circle cx="726" cy="${y + 20}" r="1.8"/><circle cx="726" cy="${y + 30}" r="1.8"/>`);
    }
    staff.push(`<text class="bar-number" x="${x + 5}" y="${y - 32}">${measure + 1}</text><text class="chord-name" x="${x + 27}" y="${y - 13}">${chord}</text>`);

    for (const [beat, values] of beats.entries()) {
      const noteX = x + 32 + beat * 55;
      const lowestString = Math.max(...values.filter((_, i) => i % 2 === 0));
      notes.push(`<path class="stem" d="M${noteX} ${y + (lowestString - 1) * 10 + 6}V${y + 66}"/>`);
      for (let i = 0; i < values.length; i += 2) {
        notes.push(`<text class="fret" data-fret-for="${measure}:${beat}:${i}" x="${noteX}" y="${y + (values[i] - 1) * 10}">${values[i + 1]}</text>`);
      }
      beatTargets.push(`<g class="beat" tabindex="0" role="button" aria-pressed="false" aria-label="第 ${measure + 1} 小节第 ${beat + 1} 拍" data-measure="${measure}" data-beat="${beat}" data-x="${noteX}" data-y="${y}"><rect x="${noteX - 15}" y="${y - 7}" width="30" height="76" rx="3"/></g>`);
    }
  }

  score.innerHTML = `<svg viewBox="0 0 760 584" aria-label="试听示例谱">${staff.join("")}${beatTargets.join("")}${notes.join("")}<g class="playhead" hidden aria-hidden="true"><rect class="playhead-bg" x="-13" y="-7" width="26" height="76" rx="3"/><path d="M-5 -13H5L0 -7Z"/><path class="playhead-line" d="M0 -7V69"/></g></svg>`;
  showSelection();
}

function showSelection() {
  const { measure, beat } = selection;
  score.querySelector('[aria-pressed="true"]')?.setAttribute("aria-pressed", "false");
  getBeatTarget(selection).setAttribute("aria-pressed", "true");
  const [string, fret] = measures[measure][1][beat];
  byId("selected-fret").textContent = fret;
  byId("selected-measure").textContent = `第 ${measure + 1} 小节 · 第 ${beat + 1} 拍`;
  byId("selected-string").textContent = `第 ${string} 弦 · ${fret} 品`;
  byId("selection-status").textContent = `编辑选区 · 第 ${measure + 1} 小节第 ${beat + 1} 拍`;
}

function getBeatTarget({ measure, beat }) {
  return score.querySelector(`[data-measure="${measure}"][data-beat="${beat}"]`);
}

function selectBeat(target) {
  selection = { measure: Number(target.dataset.measure), beat: Number(target.dataset.beat) };
  showSelection();
}

function setPhase(next, message) {
  phase = next;
  play.dataset.phase = next;
  play.disabled = next === "loading";
  byId("play-label").textContent = labels[next];
  byId("status").textContent = message;
  byId("status-dot").dataset.phase = next;
  const active = ["loading", "playing", "paused"].includes(next);
  audition.toggleAttribute("data-active", next === "playing" || next === "loading");
  stop.disabled = !active;
  start.disabled = active;
  tempo.disabled = active;
  score.querySelector(".playhead").toggleAttribute("data-paused", next === "paused");
}

function setAuditionMode(enabled) {
  if (enabled) setPhase("idle", "试听模式 · 可播放");
  else reset("已退出试听 · 编辑模式");
  editingTools.hidden = enabled;
  playbackTools.hidden = !enabled;
  audition.setAttribute("aria-pressed", String(enabled));
  audition.title = enabled ? "退出木吉他试听" : "进入木吉他试听";
  (enabled ? play : audition).focus({ preventScroll: true });
}

function setSidebar(open) {
  byId("inspector").hidden = !open;
  sidebar.setAttribute("aria-expanded", String(open));
}

function reset(message = "可试听") {
  clearTimeout(loadingTimer);
  cancelAnimationFrame(frame);
  visitedBeats = [];
  currentIndex = -1;
  elapsed = 0;
  score.querySelector(".playhead").setAttribute("hidden", "");
  byId("progress").textContent = "";
  setPhase("idle", message);
}

function showPlayhead(index) {
  const location = visitedBeats[index];
  const target = getBeatTarget(location);
  const cursor = score.querySelector(".playhead");
  cursor.removeAttribute("hidden");
  cursor.setAttribute("transform", `translate(${target.dataset.x} ${target.dataset.y})`);
  byId("progress").textContent = `第 ${location.measure + 1} 小节 · ${location.beat + 1} / 4 拍`;
  if (!follows) return;

  const staff = target.getBoundingClientRect();
  const visible = viewport.getBoundingClientRect();
  if (staff.top < visible.top + 24 || staff.bottom > visible.bottom - 12) {
    viewport.scrollTop += staff.top - visible.top - 45;
  }
}

function updatePlayback(now) {
  if (phase !== "playing") return;
  const index = Math.floor((elapsed + Math.max(0, now - playingSince)) / beatLength);
  if (index >= visitedBeats.length) {
    reset("播放完毕");
    return;
  }
  if (index !== currentIndex) {
    currentIndex = index;
    showPlayhead(index);
  }
  frame = requestAnimationFrame(updatePlayback);
}

function resume() {
  playingSince = performance.now();
  setPhase("playing", "正在试听 · 静音演示");
  updatePlayback(playingSince);
  if (!playbackTools.hidden && document.activeElement === document.body) play.focus({ preventScroll: true });
}

function begin() {
  if (!tempo.reportValidity()) return;
  const writtenOrder = measures.map((_, measure) => measure);
  const order = demo === "repeat" ? [0, 1, 2, ...writtenOrder] : writtenOrder;
  const startIndex = start.value === "selected" ? order.indexOf(selection.measure) : 0;
  visitedBeats = order.slice(startIndex).flatMap((measure) =>
    measures[measure][1].map((_, beat) => ({ measure, beat })),
  );
  beatLength = 60000 / Number(tempo.value);
  setPhase("loading", "正在加载木吉他音色…");
  loadingTimer = setTimeout(() => {
    if (failsOnLoad) {
      failsOnLoad = false;
      setPhase("error", "木吉他音色加载失败，请重试");
      if (!playbackTools.hidden && document.activeElement === document.body) play.focus({ preventScroll: true });
      return;
    }
    resume();
  }, 650);
}

function setFollow(enabled) {
  follows = enabled;
  follow.setAttribute("aria-pressed", String(enabled));
  if (enabled && currentIndex >= 0) showPlayhead(currentIndex);
}

audition.addEventListener("click", () => setAuditionMode(playbackTools.hidden));
audition.closest(".toolbar").addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !playbackTools.hidden && (playbackTools.contains(event.target) || event.target === audition)) {
    event.preventDefault();
    setAuditionMode(false);
  }
});
sidebar.addEventListener("click", () => setSidebar(byId("inspector").hidden));

play.addEventListener("click", () => {
  if (phase === "playing") {
    elapsed += performance.now() - playingSince;
    cancelAnimationFrame(frame);
    setPhase("paused", "已暂停");
  } else if (phase === "paused") {
    resume();
  } else {
    begin();
  }
});

stop.addEventListener("click", () => {
  reset("已停止");
  play.focus({ preventScroll: true });
});
tempo.addEventListener("input", () => {
  if (tempo.validity.valid) byId("score-tempo").textContent = `♩ = ${tempo.value}`;
});
follow.addEventListener("click", () => setFollow(!follows));
for (const event of ["wheel", "touchmove"]) {
  viewport.addEventListener(event, () => {
    if (phase === "playing") setFollow(false);
  }, { passive: true });
}
score.addEventListener("click", (event) => {
  const target = event.target.closest(".beat");
  if (target) selectBeat(target);
});
score.addEventListener("keydown", (event) => {
  const target = event.target.closest(".beat");
  if (target && ["Enter", " "].includes(event.key)) {
    event.preventDefault();
    selectBeat(target);
  }
});

for (const button of demoButtons) {
  button.addEventListener("click", () => {
    demo = button.dataset.demo;
    for (const other of demoButtons) other.setAttribute("aria-pressed", String(other === button));
    reset();
    selection = { measure: 1, beat: 0 };
    failsOnLoad = demo === "failure";
    start.value = demo === "repeat" ? "selected" : "beginning";
    byId("repeat-note").hidden = demo !== "repeat";
    viewport.scrollTop = 0;
    setFollow(true);
    renderScore();
    setAuditionMode(true);
  });
}

byId("edit-demo").addEventListener("click", () => {
  const { measure, beat } = selection;
  const notes = measures[measure][1][beat];
  notes[1] = (notes[1] + 1) % 13;
  const wasActive = ["loading", "playing", "paused"].includes(phase);
  reset(wasActive ? "曲谱已修改，试听已停止" : "品位已修改");
  score.querySelector(`[data-fret-for="${measure}:${beat}:0"]`).textContent = notes[1];
  showSelection();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && phase === "playing") {
    elapsed += performance.now() - playingSince;
    cancelAnimationFrame(frame);
    setPhase("paused", "已暂停 · 返回后可继续");
  }
});

renderScore();
setSidebar(!matchMedia("(max-width: 790px)").matches);
