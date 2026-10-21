(() => {
  "use strict";

  const STORAGE_KEY = "lumi-demo-progress-v1";
  const STORAGE_UNAVAILABLE_TEXT = "进度无法保存，仅本次浏览有效";
  const STORAGE_AVAILABLE_TEXT = "进度只保存在这台设备";

  const COURSE_CONFIG = {
    colors: { title: "颜色与形状", total: 4 },
    animals: { title: "动物朋友", total: 5 },
    family: { title: "我的家人", total: 4 },
    food: { title: "美味食物", total: 5 },
  };

  const COURSE_KEYWORDS = {
    colors: "颜色 形状 红色 蓝色 黄色 基础 colors shapes red blue yellow",
    animals: "动物 朋友 猫 狗 兔子 宠物 animals animal cat dog rabbit",
    family: "家人 家庭 妈妈 爸爸 温暖 family mother father sister",
    food: "食物 美味 水果 野餐 苹果 面包 牛奶 food apple bread milk",
  };

  const COLORS = {
    blue: {
      en: "Blue",
      zh: "蓝色",
      swatch: "#4d96e8",
      ipa: "/bluː/",
      fallback: "发音提示：blue /bluː/，像晴空一样的蓝色。",
    },
    yellow: {
      en: "Yellow",
      zh: "黄色",
      swatch: "#ffd15b",
      ipa: "/ˈjel.oʊ/",
      fallback: "发音提示：yellow /ˈjel.oʊ/，像暖洋洋的太阳。",
    },
    red: {
      en: "Red",
      zh: "红色",
      swatch: "#ef5b68",
      ipa: "/red/",
      fallback: "发音提示：red /red/，像熟透的草莓。",
    },
    green: {
      en: "Green",
      zh: "绿色",
      swatch: "#7ab84d",
      ipa: "/ɡriːn/",
      fallback: "发音提示：green /ɡriːn/，像春天的小叶子。",
    },
    pink: {
      en: "Pink",
      zh: "粉色",
      swatch: "#f393b7",
      ipa: "/pɪŋk/",
      fallback: "发音提示：pink /pɪŋk/，像软软的花瓣。",
    },
  };

  const QUIZ_QUESTIONS = [
    {
      word: "blue",
      options: ["yellow", "blue", "red"],
      hint: "Blue 像晴朗的天空。",
    },
    {
      word: "yellow",
      options: ["green", "red", "yellow"],
      hint: "Yellow 像暖洋洋的太阳。",
    },
    {
      word: "red",
      options: ["red", "pink", "blue"],
      hint: "Red 像熟透的草莓。",
    },
  ];

  const LETTER_ROUNDS = [
    {
      upper: "B",
      lower: "b",
      options: ["b", "p", "d"],
      ipa: "/biː/",
      hint: "b 的小肚子在右边。",
    },
    {
      upper: "D",
      lower: "d",
      options: ["q", "b", "d"],
      ipa: "/diː/",
      hint: "d 的小肚子在左边。",
    },
    {
      upper: "G",
      lower: "g",
      options: ["j", "g", "q"],
      ipa: "/dʒiː/",
      hint: "g 有一条向下的小尾巴。",
    },
    {
      upper: "P",
      lower: "p",
      options: ["b", "p", "q"],
      ipa: "/piː/",
      hint: "p 的小圆肚子朝上。",
    },
  ];

  const REWARD_TIERS = [
    { threshold: 3, name: "彩虹贴纸" },
    { threshold: 8, name: "月亮徽章" },
    { threshold: 15, name: "星光探险家" },
  ];

  const $ = (selector, context = document) => context.querySelector(selector);
  const $$ = (selector, context = document) => [...context.querySelectorAll(selector)];

  const elements = {
    stars: $$("[data-star-count]"),
    streak: $("[data-streak]"),
    streakPill: $("#streak-pill"),
    storageNote: $("[data-storage-note]"),
    heroCtaLabel: $("#adventure-cta-label"),
    heroNoteText: $("[data-hero-note-text]"),
    letterScore: $("[data-letters-solved]"),
    search: $("#course-search"),
    searchForm: $(".course-search"),
    searchClearButtons: $$("[data-clear-search]"),
    searchStatus: $("#search-status"),
    courseCount: $("#course-count"),
    coursesEmpty: $("#courses-empty"),
    courseCards: $$("[data-course-card]"),
    globalStatus: $("#global-status"),
    toast: $("#toast"),
    toastText: $("[data-toast-text]"),
    adventureDialog: $("#adventure-dialog"),
    quizContent: $("[data-quiz-content]"),
    quizComplete: $("[data-quiz-complete]"),
    quizTitle: $("#adventure-title"),
    quizCompleteTitle: $("#quiz-complete-title"),
    quizWord: $("[data-quiz-word]"),
    quizZh: $("[data-quiz-zh]"),
    quizCurrent: $("[data-quiz-current]"),
    quizTotal: $("[data-quiz-total]"),
    quizEarned: $("[data-quiz-earned]"),
    quizCompleteStars: $("[data-quiz-complete-stars]"),
    quizProgress: $("[data-quiz-progress]"),
    quizColorOptions: $("[data-color-options]"),
    quizFeedback: $("[data-quiz-feedback]"),
    quizNext: $("[data-quiz-next]"),
    quizListenButton: $(".quiz-audio .sound-button"),
    letterGame: $("[data-letter-game]"),
    letterComplete: $("[data-letter-complete]"),
    letterCompleteTitle: $("[data-letter-complete-title]"),
    letterRound: $("[data-letter-round]"),
    letterUpper: $("[data-letter-upper]"),
    letterTarget: $("[data-letter-target]"),
    letterPrompt: $("#letter-prompt"),
    letterOptions: $$("[data-letter-option]"),
    letterFeedback: $("[data-letter-feedback]"),
    letterNext: $("[data-letter-next]"),
    letterDots: $$("[data-round-dots] i"),
    letterListenButton: $(".letter-question .sound-button"),
    resetDialog: $("#reset-dialog"),
  };

  const mediaReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  let storageAvailable = true;
  let state = loadState();
  let quizReturnFocus = null;
  let resetReturnFocus = null;
  let toastTimer = 0;

  const quiz = {
    index: 0,
    earned: 0,
    solved: false,
  };

  const letterGame = {
    index: 0,
    solved: false,
  };

  function createDefaultState() {
    const courses = {};
    Object.keys(COURSE_CONFIG).forEach((key) => {
      courses[key] = 0;
    });

    return {
      stars: 0,
      streak: 1,
      lastVisit: getDateKey(),
      adventureDate: null,
      courses,
      lettersSolved: 0,
    };
  }

  function loadState() {
    const fallback = createDefaultState();

    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return fallback;
      }

      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== "object") {
        return fallback;
      }

      const courses = {};
      Object.entries(COURSE_CONFIG).forEach(([key, config]) => {
        courses[key] = clampInteger(saved.courses?.[key], 0, config.total);
      });

      return {
        stars: clampInteger(saved.stars, 0, 9999),
        streak: clampInteger(saved.streak, 1, 999),
        lastVisit: isDateKey(saved.lastVisit) ? saved.lastVisit : fallback.lastVisit,
        adventureDate: isDateKey(saved.adventureDate) ? saved.adventureDate : null,
        courses,
        lettersSolved: clampInteger(saved.lettersSolved, 0, 9999),
      };
    } catch {
      storageAvailable = false;
      return fallback;
    }
  }

  function saveState() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      storageAvailable = true;
    } catch {
      storageAvailable = false;
    }
    renderStorageNote();
  }

  function getDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function isDateKey(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  function dateKeyToUtc(value) {
    const [year, month, day] = value.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  }

  function daysBetween(from, to) {
    return Math.round((dateKeyToUtc(to) - dateKeyToUtc(from)) / 86400000);
  }

  function clampInteger(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number) || !Number.isInteger(number)) {
      return min;
    }
    return Math.min(max, Math.max(min, number));
  }

  function updateStreakForVisit() {
    const today = getDateKey();
    const difference = daysBetween(state.lastVisit, today);

    if (difference === 1) {
      state.streak += 1;
    } else if (difference !== 0) {
      state.streak = 1;
    }

    state.lastVisit = today;
    saveState();
  }

  function renderStorageNote() {
    if (!elements.storageNote) {
      return;
    }
    elements.storageNote.textContent = storageAvailable
      ? STORAGE_AVAILABLE_TEXT
      : STORAGE_UNAVAILABLE_TEXT;
  }

  function renderStars() {
    elements.stars.forEach((node) => {
      node.textContent = String(state.stars);
    });

    let earnedRewards = 0;
    $$("[data-reward-threshold]").forEach((card) => {
      const threshold = Number(card.dataset.rewardThreshold);
      const earned = state.stars >= threshold;
      const stateLabel = $("[data-reward-state]", card);
      card.classList.toggle("is-earned", earned);
      if (earned) {
        earnedRewards += 1;
      }
      if (stateLabel) {
        stateLabel.textContent = earned
          ? "已解锁"
          : `还差 ${threshold - state.stars} 颗星`;
      }
    });

    const meter = $("[data-star-meter]");
    const meterFill = $("[data-star-meter-fill]");
    const meterLabel = $("[data-star-meter-label]");
    const visibleStars = Math.min(state.stars, 15);
    const percent = (visibleStars / 15) * 100;

    if (meter) {
      meter.setAttribute("aria-valuenow", String(visibleStars));
      meter.setAttribute(
        "aria-valuetext",
        state.stars >= 15
          ? `已收集 ${state.stars} 颗星，全部奖励已点亮`
          : `已收集 ${state.stars} 颗星，共 15 颗星解锁全部奖励`,
      );
    }
    if (meterFill) {
      meterFill.style.width = `${percent}%`;
    }
    if (meterLabel) {
      meterLabel.textContent =
        earnedRewards === REWARD_TIERS.length ? "全部点亮" : `${visibleStars} / 15`;
    }
  }

  function renderStreak() {
    if (elements.streak) {
      elements.streak.textContent = String(state.streak);
    }
    if (elements.streakPill) {
      elements.streakPill.setAttribute("aria-label", `连续学习 ${state.streak} 天`);
    }
  }

  function renderLetterScore() {
    if (elements.letterScore) {
      elements.letterScore.textContent = String(state.lettersSolved);
    }
  }

  function renderHero() {
    const completedToday = state.adventureDate === getDateKey();
    if (elements.heroCtaLabel) {
      elements.heroCtaLabel.textContent = completedToday ? "再玩一次" : "开始冒险";
    }
    if (elements.heroNoteText) {
      elements.heroNoteText.textContent = completedToday
        ? "今天的冒险已完成，随时可以再挑战"
        : "答对 1 题就点亮 1 颗星";
    }
  }

  function renderCourses() {
    elements.courseCards.forEach((card) => {
      const key = card.dataset.courseCard;
      const config = COURSE_CONFIG[key];
      if (!config) {
        return;
      }

      const current = clampInteger(state.courses[key], 0, config.total);
      const completed = current >= config.total;
      const percent = (current / config.total) * 100;
      const count = $("[data-course-count]", card);
      const bar = $("[data-course-bar]", card);
      const progress = $(".progress-track", card);
      const button = $("[data-course-action]", card);
      const label = $("[data-course-label]", card);
      const reward = $(".course-star", card);

      if (count) {
        count.textContent = `${current} / ${config.total} 节`;
      }
      if (bar) {
        bar.style.width = `${percent}%`;
      }
      if (progress) {
        progress.setAttribute("aria-valuenow", String(current));
        progress.setAttribute("aria-valuetext", `${current} / ${config.total} 节`);
      }
      if (button) {
        button.setAttribute("aria-disabled", String(completed));
      }
      if (label) {
        label.textContent = completed ? "主题已完成" : `完成第 ${current + 1} 节`;
      }
      if (reward) {
        reward.hidden = completed;
      }
    });
  }

  function renderAll() {
    renderStorageNote();
    renderStars();
    renderStreak();
    renderLetterScore();
    renderHero();
    renderCourses();
  }

  function addStars(amount) {
    const safeAmount = Math.max(0, Math.floor(Number(amount) || 0));
    if (!safeAmount) {
      return;
    }

    const before = state.stars;
    state.stars = Math.min(9999, state.stars + safeAmount);
    saveState();
    renderStars();

    const newlyUnlocked = REWARD_TIERS.filter(
      (tier) => before < tier.threshold && state.stars >= tier.threshold,
    ).map((tier) => tier.name);

    if (newlyUnlocked.length) {
      announce(`新的星光奖励：${newlyUnlocked.join("、")}。`);
    }
  }

  function announce(message) {
    if (!elements.globalStatus) {
      return;
    }
    elements.globalStatus.textContent = "";
    window.setTimeout(() => {
      elements.globalStatus.textContent = message;
    }, 40);
  }

  function showToast(message) {
    if (!elements.toast || !elements.toastText) {
      return;
    }
    window.clearTimeout(toastTimer);
    elements.toastText.textContent = message;
    elements.toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => {
      elements.toast.classList.remove("is-visible");
    }, 3400);
  }

  function updateBodyLock() {
    const anyDialogOpen = $$("dialog[open]").length > 0;
    document.body.classList.toggle("dialog-open", anyDialogOpen);
  }

  function openAdventure() {
    quizReturnFocus = document.activeElement;
    stopSpeech(true);
    quiz.index = 0;
    quiz.earned = 0;
    quiz.solved = false;
    elements.quizContent.hidden = false;
    elements.quizComplete.hidden = true;
    elements.adventureDialog.setAttribute("aria-labelledby", "adventure-title");
    elements.adventureDialog.setAttribute("aria-describedby", "adventure-desc");
    renderQuizQuestion();

    if (!elements.adventureDialog.open) {
      elements.adventureDialog.showModal();
    }
    updateBodyLock();
    window.requestAnimationFrame(() => elements.quizTitle?.focus());
  }

  function closeAdventure() {
    if (elements.adventureDialog.open) {
      elements.adventureDialog.close();
    }
  }

  function renderQuizQuestion() {
    const question = QUIZ_QUESTIONS[quiz.index];
    const color = COLORS[question.word];
    if (!question || !color) {
      return;
    }

    quiz.solved = false;
    elements.quizWord.textContent = question.word;
    elements.quizZh.textContent = color.zh;
    elements.quizCurrent.textContent = String(quiz.index + 1);
    elements.quizTotal.textContent = String(QUIZ_QUESTIONS.length);
    elements.quizEarned.textContent = String(quiz.earned);
    elements.quizFeedback.textContent = "";
    elements.quizFeedback.className = "quiz-feedback";
    elements.quizNext.hidden = true;
    elements.quizNext.textContent =
      quiz.index === QUIZ_QUESTIONS.length - 1 ? "完成冒险" : "下一题";

    if (elements.quizListenButton) {
      elements.quizListenButton.dataset.speak = question.word;
      elements.quizListenButton.dataset.audioFallback = color.fallback;
      const hint = elements.quizListenButton.closest(".audio-row")?.querySelector("[data-audio-hint]");
      if (hint) {
        hint.textContent = "";
      }
    }

    elements.quizColorOptions.replaceChildren();
    question.options.forEach((optionKey) => {
      const option = COLORS[optionKey];
      if (!option) {
        return;
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className = "color-option";
      button.dataset.value = optionKey;
      button.setAttribute("aria-label", `${option.zh}，${option.en}`);

      const swatch = document.createElement("span");
      swatch.className = "color-swatch";
      swatch.style.setProperty("--swatch", option.swatch);
      swatch.setAttribute("aria-hidden", "true");

      const name = document.createElement("span");
      name.className = "color-name";
      name.lang = "en";
      name.textContent = option.en;

      const zh = document.createElement("span");
      zh.className = "color-zh";
      zh.textContent = option.zh;

      button.append(swatch, name, zh);
      elements.quizColorOptions.append(button);
    });

    updateQuizProgress();
    if (elements.adventureDialog.open) {
      window.requestAnimationFrame(() => elements.quizTitle?.focus());
    }
  }

  function updateQuizProgress() {
    if (!elements.quizProgress) {
      return;
    }

    $$("span", elements.quizProgress).forEach((step, index) => {
      step.classList.toggle("is-done", index < quiz.index || (index === quiz.index && quiz.solved));
      step.classList.toggle("is-current", index === quiz.index && !quiz.solved);
    });
  }

  function handleQuizAnswer(button) {
    if (quiz.solved) {
      return;
    }

    const question = QUIZ_QUESTIONS[quiz.index];
    const selected = button.dataset.value;
    const selectedColor = COLORS[selected];
    const options = $$(".color-option", elements.quizColorOptions);

    options.forEach((option) => option.classList.remove("is-wrong"));

    if (selected === question.word) {
      const correctColor = COLORS[question.word];
      quiz.solved = true;
      quiz.earned += 1;

      options.forEach((option) => {
        option.disabled = true;
      });
      button.classList.add("is-correct");
      elements.quizEarned.textContent = String(quiz.earned);
      elements.quizFeedback.className = "quiz-feedback is-success";
      elements.quizFeedback.textContent = `答对啦！${correctColor.en} 就是${correctColor.zh}。+1 颗星。`;
      addStars(1);
      updateQuizProgress();
      elements.quizNext.hidden = false;
      elements.quizNext.focus();
    } else {
      button.classList.add("is-wrong");
      elements.quizFeedback.className = "quiz-feedback is-error";
      elements.quizFeedback.textContent = `再试一次。你选的是${selectedColor.zh}（${selectedColor.en}）。提示：${question.hint}`;
    }
  }

  function showQuizComplete() {
    quiz.solved = true;
    elements.quizContent.hidden = true;
    elements.quizComplete.hidden = false;
    elements.quizCompleteStars.textContent = String(quiz.earned);
    elements.adventureDialog.setAttribute("aria-labelledby", "quiz-complete-title");
    elements.adventureDialog.removeAttribute("aria-describedby");

    if (state.adventureDate !== getDateKey()) {
      state.adventureDate = getDateKey();
      saveState();
      renderHero();
    }

    window.requestAnimationFrame(() => elements.quizCompleteTitle?.focus());
  }

  function restartQuiz() {
    quiz.index = 0;
    quiz.earned = 0;
    quiz.solved = false;
    elements.quizComplete.hidden = true;
    elements.quizContent.hidden = false;
    elements.adventureDialog.setAttribute("aria-labelledby", "adventure-title");
    elements.adventureDialog.setAttribute("aria-describedby", "adventure-desc");
    renderQuizQuestion();
  }

  function renderLetterRound({ focus = false } = {}) {
    const round = LETTER_ROUNDS[letterGame.index];
    if (!round) {
      return;
    }

    letterGame.solved = false;
    elements.letterGame.hidden = false;
    elements.letterComplete.hidden = true;
    elements.letterRound.textContent = String(letterGame.index + 1);
    elements.letterUpper.textContent = round.upper;
    elements.letterTarget.textContent = round.upper;
    elements.letterPrompt.querySelector("strong").textContent = round.upper;
    elements.letterNext.hidden = true;
    elements.letterNext.textContent =
      letterGame.index === LETTER_ROUNDS.length - 1 ? "完成这一组" : "下一题";
    elements.letterFeedback.className = "letter-feedback";
    elements.letterFeedback.textContent = "选一个字母试试看。";

    if (elements.letterListenButton) {
      elements.letterListenButton.dataset.speak = round.upper;
      elements.letterListenButton.dataset.audioFallback = `发音提示：字母 ${round.upper} 读作 ${round.ipa}。`;
      const hint = elements.letterListenButton.closest(".audio-row")?.querySelector("[data-audio-hint]");
      if (hint) {
        hint.textContent = "";
      }
    }

    elements.letterOptions.forEach((button, index) => {
      const value = round.options[index];
      if (!value) {
        button.hidden = true;
        return;
      }
      button.hidden = false;
      button.textContent = value;
      button.dataset.value = value;
      button.setAttribute("aria-label", `小写字母 ${value}`);
      button.disabled = false;
      button.classList.remove("is-correct", "is-wrong");
    });

    updateLetterProgress();
    if (focus) {
      elements.letterPrompt.focus();
    }
  }

  function updateLetterProgress() {
    elements.letterDots.forEach((dot, index) => {
      dot.classList.toggle(
        "is-done",
        index < letterGame.index || (index === letterGame.index && letterGame.solved),
      );
      dot.classList.toggle("is-current", index === letterGame.index && !letterGame.solved);
    });
  }

  function handleLetterAnswer(button) {
    if (letterGame.solved) {
      return;
    }

    const round = LETTER_ROUNDS[letterGame.index];
    const selected = button.dataset.value;
    elements.letterOptions.forEach((option) => option.classList.remove("is-wrong"));

    if (selected === round.lower) {
      letterGame.solved = true;
      button.classList.add("is-correct");
      elements.letterOptions.forEach((option) => {
        option.disabled = true;
      });
      elements.letterFeedback.className = "letter-feedback is-success";
      elements.letterFeedback.textContent = `找到了！小写 ${round.lower} 是大写 ${round.upper} 的好朋友。+1 颗星。`;
      state.lettersSolved = Math.min(9999, state.lettersSolved + 1);
      saveState();
      renderLetterScore();
      addStars(1);
      updateLetterProgress();
      elements.letterNext.hidden = false;
      elements.letterNext.focus();
    } else {
      button.classList.add("is-wrong");
      elements.letterFeedback.className = "letter-feedback is-error";
      elements.letterFeedback.textContent = `再找找看。“${selected}”不是大写 ${round.upper} 的小写。${round.hint}`;
    }
  }

  function showLetterComplete() {
    elements.letterGame.hidden = true;
    elements.letterComplete.hidden = false;
    window.requestAnimationFrame(() => elements.letterCompleteTitle?.focus());
  }

  function restartLetterGame() {
    letterGame.index = 0;
    letterGame.solved = false;
    elements.letterComplete.hidden = true;
    elements.letterGame.hidden = false;
    renderLetterRound({ focus: true });
  }

  function applyCourseSearch() {
    const query = elements.search.value.trim().toLowerCase();
    const tokens = query.split(/\s+/).filter(Boolean);
    let visibleCount = 0;

    elements.courseCards.forEach((card) => {
      const key = card.dataset.courseCard;
      const searchable = `${card.textContent} ${COURSE_KEYWORDS[key] || ""}`.toLowerCase();
      const matches = tokens.length === 0 || tokens.every((token) => searchable.includes(token));
      card.hidden = !matches;
      if (matches) {
        visibleCount += 1;
      }
    });

    elements.searchClearButtons.forEach((button) => {
      button.hidden = query.length === 0;
    });
    elements.coursesEmpty.hidden = visibleCount !== 0;
    elements.courseCount.textContent = query
      ? `找到 ${visibleCount} 门课程`
      : `${elements.courseCards.length} 门主题课`;
    elements.searchStatus.textContent = query
      ? `找到 ${visibleCount} 门主题课程。`
      : `已显示全部 ${elements.courseCards.length} 门主题课程。`;
  }

  function clearCourseSearch({ focus = true } = {}) {
    elements.search.value = "";
    applyCourseSearch();
    if (focus) {
      elements.search.focus({ preventScroll: true });
      elements.search.scrollIntoView({
        block: "nearest",
        behavior: mediaReducedMotion.matches ? "auto" : "smooth",
      });
    }
  }

  async function speakText(button) {
    const text = button.dataset.speak?.trim();
    if (!text) {
      return;
    }

    const audioRow = button.closest(".audio-row");
    const hint = audioRow?.querySelector("[data-audio-hint]");
    const fallback = button.dataset.audioFallback || `发音提示：${text}。`;
    const canSpeak =
      "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function";

    $$("[data-audio-hint]").forEach((node) => {
      if (node !== hint) {
        node.textContent = "";
      }
    });

    if (!canSpeak) {
      if (hint) {
        hint.textContent = fallback;
      }
      return;
    }

    try {
      window.speechSynthesis.cancel();

      let voices = window.speechSynthesis.getVoices();
      if (!voices.length) {
        await new Promise((resolve) => {
          let finished = false;
          const finish = () => {
            if (finished) {
              return;
            }
            finished = true;
            window.speechSynthesis.removeEventListener("voiceschanged", finish);
            resolve();
          };
          window.speechSynthesis.addEventListener("voiceschanged", finish, { once: true });
          window.setTimeout(finish, 420);
        });
        voices = window.speechSynthesis.getVoices();
      }

      if (!voices.length) {
        if (hint) {
          hint.textContent = fallback;
        }
        return;
      }

      const utterance = new window.SpeechSynthesisUtterance(text);
      const englishVoice = voices.find((voice) =>
        String(voice.lang || "")
          .toLowerCase()
          .startsWith("en"),
      );
      if (englishVoice) {
        utterance.voice = englishVoice;
      }
      utterance.lang = englishVoice?.lang || "en-US";
      utterance.rate = text.length === 1 ? 0.72 : 0.8;
      utterance.pitch = 1.02;

      utterance.onstart = () => {
        if (hint) {
          hint.textContent = "正在播放…";
        }
      };
      utterance.onend = () => {
        if (hint) {
          hint.textContent = "";
        }
      };
      utterance.onerror = () => {
        if (hint) {
          hint.textContent = fallback;
        }
      };

      window.speechSynthesis.speak(utterance);
    } catch {
      if (hint) {
        hint.textContent = fallback;
      }
    }
  }

  function stopSpeech(clearHints = false) {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    if (clearHints) {
      $$("[data-audio-hint]").forEach((node) => {
        node.textContent = "";
      });
    }
  }

  function openResetDialog() {
    resetReturnFocus = document.activeElement;
    if (!elements.resetDialog.open) {
      elements.resetDialog.showModal();
    }
    updateBodyLock();
    const cancelButton = $("[data-close-reset].button", elements.resetDialog);
    window.requestAnimationFrame(() => cancelButton?.focus());
  }

  function resetProgress() {
    stopSpeech(true);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      storageAvailable = false;
    }

    state = createDefaultState();
    saveState();
    renderAll();

    quiz.index = 0;
    quiz.earned = 0;
    quiz.solved = false;
    elements.quizComplete.hidden = true;
    elements.quizContent.hidden = false;
    renderQuizQuestion();

    letterGame.index = 0;
    letterGame.solved = false;
    elements.letterComplete.hidden = true;
    elements.letterGame.hidden = false;
    renderLetterRound();

    if (elements.resetDialog.open) {
      elements.resetDialog.close();
    }
    announce("本地进度已重置。星星和课程进度已清零。");
    showToast("本地进度已重置");
  }

  function setActiveNav(id) {
    $$("[data-nav]").forEach((link) => {
      const active = link.dataset.nav === id;
      link.classList.toggle("is-active", active);
      if (active) {
        link.setAttribute("aria-current", "location");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  function updateActiveNavOnScroll() {
    const sections = ["daily", "courses", "word", "letters", "stars"]
      .map((id) => document.getElementById(id))
      .filter(Boolean);
    if (!sections.length) {
      return;
    }

    const marker = window.scrollY + Math.min(190, window.innerHeight * 0.35);
    let activeId = sections[0].id;

    sections.forEach((section) => {
      const top = section.getBoundingClientRect().top + window.scrollY;
      if (top <= marker) {
        activeId = section.id;
      }
    });

    setActiveNav(activeId);
  }

  function bindEvents() {
    $$("[data-open-adventure]").forEach((button) => {
      button.addEventListener("click", openAdventure);
    });

    $$("[data-close-adventure]").forEach((button) => {
      button.addEventListener("click", closeAdventure);
    });

    $$("[data-open-reset]").forEach((button) => {
      button.addEventListener("click", openResetDialog);
    });

    $$("[data-close-reset]").forEach((button) => {
      button.addEventListener("click", () => {
        if (elements.resetDialog.open) {
          elements.resetDialog.close();
        }
      });
    });

    $("[data-confirm-reset]").addEventListener("click", resetProgress);
    $("[data-restart-quiz]").addEventListener("click", restartQuiz);
    $("[data-letter-restart]").addEventListener("click", restartLetterGame);

    elements.quizColorOptions.addEventListener("click", (event) => {
      const button = event.target.closest(".color-option");
      if (!button) {
        return;
      }
      handleQuizAnswer(button);
    });

    elements.quizNext.addEventListener("click", () => {
      if (quiz.index < QUIZ_QUESTIONS.length - 1) {
        quiz.index += 1;
        renderQuizQuestion();
      } else {
        showQuizComplete();
      }
    });

    elements.letterOptions.forEach((button) => {
      button.addEventListener("click", () => handleLetterAnswer(button));
    });

    elements.letterNext.addEventListener("click", () => {
      if (letterGame.index < LETTER_ROUNDS.length - 1) {
        letterGame.index += 1;
        renderLetterRound({ focus: true });
      } else {
        showLetterComplete();
      }
    });

    elements.courseCards.forEach((card) => {
      const button = $("[data-course-action]", card);
      button.addEventListener("click", () => {
        const key = card.dataset.courseCard;
        const config = COURSE_CONFIG[key];
        if (!config) {
          return;
        }

        if (state.courses[key] >= config.total) {
          announce(`${config.title}的星星已经全部收好啦。`);
          showToast(`${config.title}已经完成，可以重置进度后重新体验`);
          return;
        }

        state.courses[key] += 1;
        saveState();
        renderCourses();
        addStars(1);

        const completed = state.courses[key] >= config.total;
        const message = completed
          ? `${config.title}全部完成，获得 1 颗星。`
          : `完成${config.title}第 ${state.courses[key]} 节，获得 1 颗星。`;
        announce(message);
        showToast(completed ? `${config.title}全部完成，+1 星` : `第 ${state.courses[key]} 节完成，+1 星`);
      });
    });

    elements.searchForm.addEventListener("submit", (event) => {
      event.preventDefault();
      applyCourseSearch();
      const coursesSection = document.getElementById("courses");
      if (coursesSection) {
        coursesSection.scrollIntoView({
          behavior: mediaReducedMotion.matches ? "auto" : "smooth",
          block: "start",
        });
      }
    });

    elements.search.addEventListener("input", applyCourseSearch);
    elements.search.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && elements.search.value) {
        event.preventDefault();
        clearCourseSearch();
      }
    });

    elements.searchClearButtons.forEach((button) => {
      button.addEventListener("click", () => clearCourseSearch());
    });

    document.addEventListener("click", (event) => {
      const speakButton = event.target.closest("[data-speak]");
      if (speakButton) {
        speakText(speakButton);
      }
    });

    elements.adventureDialog.addEventListener("click", (event) => {
      if (event.target === elements.adventureDialog) {
        const rect = elements.adventureDialog.getBoundingClientRect();
        const outside =
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom;
        if (outside) {
          closeAdventure();
        }
      }
    });

    elements.adventureDialog.addEventListener("close", () => {
      stopSpeech(true);
      updateBodyLock();
      if (quizReturnFocus instanceof HTMLElement) {
        quizReturnFocus.focus({ preventScroll: true });
      }
    });

    elements.resetDialog.addEventListener("click", (event) => {
      if (event.target === elements.resetDialog) {
        const rect = elements.resetDialog.getBoundingClientRect();
        const outside =
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom;
        if (outside) {
          elements.resetDialog.close();
        }
      }
    });

    elements.resetDialog.addEventListener("close", () => {
      updateBodyLock();
      if (resetReturnFocus instanceof HTMLElement) {
        resetReturnFocus.focus({ preventScroll: true });
      }
    });

    $$("[data-nav]").forEach((link) => {
      link.addEventListener("click", () => setActiveNav(link.dataset.nav));
    });

    let scrollTicking = false;
    window.addEventListener(
      "scroll",
      () => {
        if (scrollTicking) {
          return;
        }
        scrollTicking = true;
        window.requestAnimationFrame(() => {
          updateActiveNavOnScroll();
          scrollTicking = false;
        });
      },
      { passive: true },
    );

    window.addEventListener("resize", updateActiveNavOnScroll);
  }

  function init() {
    updateStreakForVisit();
    elements.quizTotal.textContent = String(QUIZ_QUESTIONS.length);
    renderAll();
    renderLetterRound();
    bindEvents();
    applyCourseSearch();
    updateActiveNavOnScroll();
  }

  init();
})();
