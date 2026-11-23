/* 和弦快捷气泡的独立设计演示。所有内容均为内存中的固定样例，不连接产品或音乐引擎。 */
(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const presets = {
    C: { frets: ['x', 3, 2, 0, 1, 0], fingers: [null, 3, 2, null, 1, null], barre: false },
    G: { frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, null, null, null, 3], barre: false },
    Am: { frets: ['x', 0, 2, 2, 1, 0], fingers: [null, null, 2, 3, 1, null], barre: false },
    F: { frets: [1, 3, 3, 2, 1, 1], fingers: [1, 3, 4, 2, 1, 1], barre: true },
    Dm: { frets: ['x', 'x', 0, 2, 3, 1], fingers: [null, null, null, 2, 3, 1], barre: false },
    Em: { frets: [0, 2, 2, 0, 0, 0], fingers: [null, 2, 3, null, null, null], barre: false },
  };
  const scenes = [['existing', '已有和弦'], ['preset', '切换常用指法'], ['new', '工具栏添加'], ['unselected', '未选拍点'], ['name', '仅名称'], ['tuning', '自定义调弦'], ['error', '名称错误'], ['diagram', '指法错误'], ['edge', '谱面边缘'], ['settings', '侧栏共享编辑']];
  const positions = ['第 2 小节 · 第 1 拍', '第 3 小节 · 第 1 拍', '第 4 小节 · 第 1 拍', '第 5 小节 · 第 1 拍', '第 6 小节 · 第 1 拍', '第 7 小节 · 第 1 拍'];
  let state;
  let composing = false;
  let cooling = false;
  let coolingTimer;
  let history = [];
  let redo = [];
  const popover = $('#chord-popover');
  const stage = $('.score-stage');

  function initialScores() {
    return ['C', 'G', 'Am', '', 'F', 'G'].map((name) => ({ name, shape: name ? clone(presets[name]) : null, display: name ? 'nameAndDiagram' : 'name' }));
  }
  function dirty() { return state.open && JSON.stringify(state.draft) !== JSON.stringify(state.scores[state.target]); }
  function nameIssue() { return state.open && (!state.draft.name.trim() ? '请输入和弦名称，例如 C 或 Am。' : ''); }
  function issue() { return nameIssue() || (state.open && state.draft.shape?.invalid ? '起始品位无效，请在右侧编辑台修正。' : ''); }
  function canApply() { return dirty() && !issue() && !composing && !cooling; }
  function shapePreset(shape) { return Object.entries(presets).find(([, value]) => JSON.stringify(value) === JSON.stringify(shape))?.[0]; }

  // 图形只表达样例中的六弦位置；正式实现必须使用现有领域图元，不能复制此绘图函数。
  function diagram(shape, label = '当前指法预览') {
    if (!shape) return '<div class="empty-preview" aria-label="尚无指法图">尚无<br>指法图</div>';
    if (shape.invalid) return '<div class="empty-preview" aria-label="指法无效，暂停预览">暂停<br>预览</div>';
    let lines = '<path class="nut" d="M13 18h50"/>';
    for (let index = 0; index < 6; index++) lines += `<path d="M${13 + index * 10} 18v50"/>`;
    for (let index = 1; index <= 5; index++) lines += `<path d="M13 ${18 + index * 10}h50"/>`;
    if (shape.barre) lines += '<path d="M13 23h50" stroke-width="6"/>';
    shape.frets.forEach((fret, index) => {
      const x = 13 + index * 10;
      if (fret === 'x' || fret === 0) lines += `<text x="${x}" y="11" text-anchor="middle">${fret === 'x' ? '×' : '○'}</text>`;
      else if (!(shape.barre && fret === 1)) {
        const y = 18 + (fret - .5) * 10;
        lines += `<circle class="dot" cx="${x}" cy="${y}" r="4.2"/>`;
        if (shape.fingers[index]) lines += `<text class="finger" x="${x}" y="${y}">${shape.fingers[index]}</text>`;
      }
    });
    return `<svg class="diagram" role="img" aria-label="${escape(label)}" viewBox="0 0 76 82">${lines}</svg>`;
  }
  function scoreStaff(row) {
    let svg = '<svg class="score-svg" viewBox="0 0 724 220" aria-hidden="true">';
    for (let index = 0; index < 6; index++) svg += `<path d="M0 ${93 + index * 11}H724"/>`;
    for (let index = 0; index < 4; index++) svg += `<path d="M${index * 241} 93v55"/>`;
    svg += '<path d="M723 93v55"/>';
    for (let index = 0; index < 18; index++) {
      const x = 32 + index * 38;
      const fret = [3, 0, 2, 0, 1, 3, 5, 0, 7, 5, 3, 2, 0, 3, 2, 1, 0, 3][index];
      const y = 96 + (index % 4) * 11;
      svg += `<rect x="${x - 5}" y="${y - 9}" width="10" height="12" fill="white" stroke="none"/><text x="${x}" y="${y}" text-anchor="middle">${fret}</text><path d="M${x} ${y + 5}v${158 - y}"/><text class="numbered-note" x="${x}" y="181" text-anchor="middle">${[5, 6, 7, 1, 2, 3, 2, 1, 1, 6, 3, 5, 1, 2, 3, 5, 6, 1][(index + row * 3) % 18]}</text>`;
      if (index % 2 === 0) svg += `<text class="lyric-note" x="${x}" y="207" text-anchor="middle">${(row ? '歌声轻响余音悠长' : '旋律随风慢慢升起')[index / 2] ?? ''}</text>`;
    }
    svg += '<path d="M32 158h38m76 0h38m76 0h38m76 0h38m76 0h38m76 0h38"/>';
    return svg + '</svg>';
  }
  function renderScore() {
    $('#score').innerHTML = [0, 1].map((row) => `<div class="score-row" ${state.scene === 'edge' && row === 1 ? 'style="margin-top:190px"' : ''}>${scoreStaff(row)}${[0, 1, 2].map((column) => {
      const index = row * 3 + column;
      const chord = state.scores[index];
      const left = [80, 319, 650][column];
      return `<button class="beat-target" style="--left:${left}px" data-beat="${index}" aria-pressed="${state.selectedTarget === index}" aria-label="选择 TAB ${positions[index]}" ${composing || cooling ? 'disabled' : ''}></button>${chord.name ? `<button class="chord-anchor" style="--left:${left}px" data-target="${index}" aria-current="${state.open && state.target === index}" aria-label="编辑和弦 ${escape(chord.name)}，TAB ${positions[index]}"><span class="anchor-name">${escape(chord.name)}</span>${chord.shape && chord.display === 'nameAndDiagram' ? diagram(chord.shape, `${chord.name} 已应用指法`) : ''}</button>` : ''}`;
    }).join('')}</div>`).join('');
  }
  function presetsMarkup() {
    const current = state.draft?.shape && shapePreset(state.draft.shape);
    return `<div class="preset-row" role="group" aria-label="常用指法">${Object.keys(presets).map((name) => `<button data-preset="${name}" aria-pressed="${current === name && state.draft.name === name}" ${state.customTuning || composing || cooling ? 'disabled' : ''}>${name}</button>`).join('')}</div>`;
  }
  function displayMarkup() {
    return `<div class="display-row"><span>谱面显示</span><div class="segmented" role="group" aria-label="和弦显示方式">${[['name', '仅名称'], ['nameAndDiagram', '名称与指法']].map(([value, label]) => `<button data-display="${value}" aria-pressed="${state.draft.display === value}" ${(!state.draft.shape && value === 'nameAndDiagram') || composing || cooling ? 'disabled' : ''}>${label}</button>`).join('')}</div></div>`;
  }
  function renderPopover() {
    if (!state.open) { popover.hidden = true; return; }
    popover.hidden = false;
    const error = nameIssue();
    popover.innerHTML = `<div class="popover-header"><strong id="popover-title">${state.scores[state.target].name ? '编辑和弦' : '添加和弦'}</strong><span class="position">TAB · ${positions[state.target]}</span><button class="icon-button" data-action="end" aria-label="结束和弦编辑" title="结束编辑，丢弃未应用修改" ${composing || cooling ? 'disabled' : ''}>${icon('close')}</button></div>
      <div class="field"><label for="popover-name">和弦名称</label><input class="name-input" id="popover-name" value="${escape(state.draft.name)}" placeholder="例如 C、Am、G7" autocomplete="off" spellcheck="false" aria-invalid="${!!error}" aria-describedby="${error ? 'popover-error ' : ''}name-shape-help">${error ? `<p class="field-error" id="popover-error">${error}</p>` : ''}</div>
      <p class="quick-label">常用指法</p>${presetsMarkup()}
      ${state.customTuning ? '<p class="tuning-notice">当前为自定义调弦，常用预设暂停。可在右侧编辑台编辑。</p>' : ''}
      <div class="chord-summary">${diagram(state.draft.shape)}<div class="chord-summary-text"><strong>${state.draft.shape ? '当前指法' : '先填写名称，也可选择常用指法'}</strong><p class="tuning">${state.customTuning ? '自定义调弦 · D A D G B E' : '标准调弦 · E A D G B E'}</p>${displayMarkup()}${state.draft.shape && state.draft.display === 'name' ? '<p class="tuning">指法保留，不显示在谱面。</p>' : ''}</div></div>
      ${state.draft.shape?.invalid ? `<p class="field-error">${issue()} <button class="link-button" data-action="fix-diagram">前往修正</button></p>` : ''}
      <p id="name-shape-help" class="popover-notice">${state.draft.shape ? '改名称不会自动改指法；选择预设会同时替换二者。' : '仅名称也可应用；自定义指法请在右侧编辑台编辑。'}</p>
      ${state.appliedMessage ? '<p class="saved-caption" role="status">已应用到当前 TAB 拍。</p>' : ''}
      <p class="leave-hint">切换位置或结束编辑会丢弃未应用输入。<br>Ctrl / ⌘ + Enter 应用，停留当前拍。</p>
      <div class="popover-actions"><button class="primary" data-action="apply" ${!canApply() ? 'disabled' : ''}>应用和弦</button></div>`;
  }
  function renderSidebar() {
    const context = $('#object-context');
    const body = $('#sidebar-body');
    const actions = $('#sidebar-actions');
    context.innerHTML = `<div class="context-top"><strong>${state.open ? '和弦与指法' : '尚未选择和弦'}</strong>${state.open ? `<button class="link-button" data-action="locate">${icon('target')}定位谱面</button>` : ''}</div><div class="context-bottom">${state.open ? `${positions[state.target]}<span class="pill">TAB 拍点</span>` : '在 TAB 拍点添加和弦，或选择已有和弦'}</div>`;
    $('#status-location').textContent = state.open ? `和弦 / TAB / ${positions[state.target]}` : '请选择 TAB 拍点';
    if (!state.open) {
      const selected = state.selectedTarget !== null;
      if (selected) {
        context.innerHTML = `<div class="context-top"><strong>TAB 拍点已选中</strong></div><div class="context-bottom">${positions[state.selectedTarget]}<span class="pill">TAB 拍点</span></div>`;
        $('#status-location').textContent = `TAB / ${positions[state.selectedTarget]}`;
      }
      body.innerHTML = `<div class="sidebar-empty"><strong>${selected ? '从工具栏打开和弦编辑' : '先选择一个 TAB 拍点'}</strong><p>${selected ? '点击「技巧」右侧的和弦图标。' : '选择 TAB 拍点，再点击工具栏和弦图标。'}<br>也可直接点击已有和弦编辑。</p></div>`;
      actions.innerHTML = ''; return;
    }
    body.innerHTML = `<section class="sidebar-preview"><div><strong>${escape(state.draft.name) || '未命名'}</strong><p>${state.customTuning ? '自定义调弦　D A D G B E' : '标准调弦　E A D G B E'}</p></div>${diagram(state.draft.shape)}</section>
      <div class="field"><label for="sidebar-name">和弦名称</label><input id="sidebar-name" value="${escape(state.draft.name)}" autocomplete="off" spellcheck="false" aria-invalid="${!!issue()}"></div>${issue() ? `<p class="field-error">${issue()}</p>` : ''}
      <h3>常用指法</h3>${presetsMarkup()}<p class="help">${state.customTuning ? '常用预设暂停，仍可自定义六弦与横按。' : '选择后填入当前输入，应用后才写入谱面。'}</p>
      ${state.draft.shape ? `<details class="disclosure" open><summary>六弦指法<small>由粗弦到细弦 · 6 → 1</small></summary><div class="disclosure-content"><table class="finger-table"><thead><tr><th scope="col">弦</th><th scope="col">品位</th><th scope="col">手指</th></tr></thead><tbody>${state.draft.shape.frets.map((fret, index) => `<tr><th scope="row">第 ${6 - index} 弦</th><td><select data-fret="${index}" aria-label="${6 - index} 弦品位">${['x', 0, 1, 2, 3, 4, 5].map((value) => `<option value="${value}" ${value === fret ? 'selected' : ''}>${value === 'x' ? '× 禁奏' : value === 0 ? '○ 空弦' : `${value} 品`}</option>`).join('')}</select></td><td><span class="muted-inline">${fret === 'x' ? '禁奏弦无需手指' : fret === 0 ? '空弦无需手指' : state.draft.shape.fingers[index] || '未指定'}</span></td></tr>`).join('')}</tbody></table></div></details><details class="disclosure" data-group="range"><summary>横按与显示范围<small>${state.draft.shape.barre ? 1 : 0} / 4 组横按</small></summary><div class="disclosure-content"><p class="help">${state.draft.shape.barre ? '第 1 品 · 1–6 弦 · 食指' : '尚无横按'}</p><div class="field"><label for="sidebar-start-fret">起始品位</label><input id="sidebar-start-fret" value="${state.draft.shape.invalid ? '' : '1'}" placeholder="1–20 的整数" inputmode="numeric" aria-invalid="${!!state.draft.shape.invalid}">${state.draft.shape.invalid ? `<p class="field-error">${issue()}</p>` : ''}</div><p class="help">本稿仅展示入口与错误修正；详细字段沿用现有完整设置。</p></div></details>` : '<button data-action="create-diagram">创建指法图</button><p class="help">先建立指法输入，应用前不改变谱面。</p>'}
      <details class="disclosure" open><summary>谱面显示</summary><div class="disclosure-content">${displayMarkup()}<p class="help">仅名称不会删除已有指法。</p></div></details>
      <details class="disclosure"><summary>移除和弦</summary><div class="disclosure-content"><button class="link-button danger-button" data-action="remove" ${!state.scores[state.target].name ? 'disabled' : ''}>删除当前和弦</button><p class="help">只移除这个 TAB 拍的和弦。</p></div></details>`;
    const rangeInput = body.querySelector('#sidebar-start-fret');
    if (rangeInput) {
      rangeInput.placeholder = '本演示填写 1 修正错误';
      rangeInput.closest('.disclosure-content').lastElementChild.textContent = '本稿仅演示第 1 品的错误修正；实际产品沿用完整品位范围。';
    }
    actions.innerHTML = `<p>${dirty() ? '和弦有未应用修改 · 名称、指法与显示一起应用' : '当前和弦已应用'}</p><div><button data-action="restore" ${!dirty() || composing || cooling ? 'disabled' : ''}>恢复和弦修改</button><button class="primary" data-action="apply" ${!canApply() ? 'disabled' : ''}>应用和弦</button></div><p class="leave-note">切换位置或结束编辑会丢弃未应用输入。</p>`;
  }
  function placePopover() {
    if (!state.open) return;
    const anchor = $(`[data-target="${state.target}"]`) || $(`[data-beat="${state.target}"]`);
    if (!anchor) return;
    const box = anchor.getBoundingClientRect();
    const bounds = stage.getBoundingClientRect();
    popover.hidden = false;
    const height = popover.offsetHeight;
    const width = popover.offsetWidth;
    const x = box.left - bounds.left;
    const y = box.top - bounds.top;
    const clamp = (value, max) => Math.max(12, Math.min(value, max - 12));
    const alignedLeft = clamp(x - 18, bounds.width - width);
    const alignedTop = clamp(y - 24, bounds.height - height);
    const candidates = [
      { placement: 'below', left: alignedLeft, top: y + box.height + 10 },
      { placement: 'above', left: alignedLeft, top: y - height - 10 },
      { placement: 'right', left: x + box.width + 10, top: alignedTop },
      { placement: 'left', left: x - width - 10, top: alignedTop },
    ];
    const visible = x >= 0 && y >= 0 && x + box.width <= bounds.width && y + box.height <= bounds.height;
    const position = visible && candidates.find(({ left, top }) => left >= 12 && top >= 12 && left + width <= bounds.width - 12 && top + height <= bounds.height - 12);
    if (!position) {
      if (popover.contains(document.activeElement) && !$('.inspector').hidden) $('#sidebar-name')?.focus({ preventScroll: true });
      popover.hidden = true;
      return;
    }
    const { left, top, placement } = position;
    popover.dataset.placement = placement;
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
    popover.style.setProperty('--arrow-x', `${clamp(x + box.width / 2 - left - 5, width - 12)}px`);
    popover.style.setProperty('--arrow-y', `${clamp(y + box.height / 2 - top - 5, height - 12)}px`);
  }
  function render({ score = false, focus = null, selection = null } = {}) {
    const active = document.activeElement;
    const activeId = focus || (active?.tagName === 'INPUT' ? active.id : null);
    const caret = selection || (active?.tagName === 'INPUT' ? [active.selectionStart, active.selectionEnd, active.selectionDirection] : null);
    const openGroups = Array.from($('#sidebar-body').querySelectorAll('details')).map((node) => node.open);
    if (score) renderScore();
    renderPopover(); renderSidebar();
    $('#scene-buttons').innerHTML = scenes.map(([id, name]) => `<button data-scene="${id}" aria-pressed="${state.scene === id}">${name}</button>`).join('');
    $('#undo').disabled = !history.length || composing || cooling;
    $('#redo').disabled = !redo.length || composing || cooling;
    renderChordTool();
    if (!focus) $('#sidebar-body').querySelectorAll('details').forEach((node, index) => { if (openGroups[index] !== undefined) node.open = openGroups[index]; });
    placePopover();
    if (activeId && state.open) {
      const field = document.getElementById(activeId);
      if (field?.getClientRects().length) {
        field.focus({ preventScroll: true });
        if (caret) field.setSelectionRange(caret[0], caret[1], caret[2] || 'none');
      }
    }
  }
  function feedback(text) { $('#status-feedback').textContent = text; }
  function renderChordTool() {
    const valid = state.selectedTarget !== null;
    const existing = valid && !!state.scores[state.selectedTarget].name;
    const button = $('#toolbar-chord');
    const label = existing ? '编辑和弦' : '添加和弦';
    button.disabled = !valid || composing || cooling;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-expanded', String(state.open && state.target === state.selectedTarget));
    button.querySelector('use').setAttribute('href', existing ? '#i-chord' : '#i-chord-add');
    $('#chord-tool-tip').textContent = !valid ? '先选择一个 TAB 拍点，再添加和弦' : `${label} · ${positions[state.selectedTarget]}`;
    button.parentElement.tabIndex = button.disabled ? 0 : -1;
  }
  function selectBeat(index) {
    if (composing || cooling) return;
    if (state.open && state.target === index) return;
    state.selectedTarget = index; state.target = index; state.open = false; state.draft = null;
    render({ score: true });
    $(`[data-beat="${index}"]`).focus({ preventScroll: true });
    feedback(`${positions[index]}已选中，点击工具栏和弦按钮${state.scores[index].name ? '编辑' : '添加'}和弦。`);
  }
  function openTarget(index) {
    if (composing || cooling) return;
    state.selectedTarget = index;
    if (state.open && index === state.target) { $('#popover-name').focus({ preventScroll: true }); return; }
    state.target = index; state.open = true; state.draft = clone(state.scores[index]); state.appliedMessage = false;
    render({ score: true, focus: 'popover-name' });
    feedback('已进入当前 TAB 拍；未应用输入只保留在本次编辑中。');
  }
  function end() {
    if (composing || cooling) return;
    const target = state.target;
    state.open = false; state.draft = null; state.appliedMessage = false;
    render({ score: true });
    ($(`[data-target="${target}"]`) || $(`[data-beat="${target}"]`))?.focus({ preventScroll: true });
    feedback('已结束和弦编辑，未应用输入已丢弃。');
  }
  function apply() {
    if (!canApply()) return;
    history.push(clone(state.scores)); redo = [];
    state.scores[state.target] = clone(state.draft); state.appliedMessage = true;
    render({ score: true }); feedback('演示：当前 TAB 拍的和弦已应用，可用撤销恢复。');
  }
  function loadScene(id) {
    if (composing || cooling) return;
    state = { scene: id, scores: initialScores(), target: 0, selectedTarget: 0, open: true, draft: null, customTuning: id === 'tuning', appliedMessage: false };
    history = []; redo = [];
    $('.inspector').hidden = false; $('#reopen-sidebar').hidden = true;
    if (id === 'new') state.target = 3;
    if (id === 'name') state.scores[0] = { name: 'Cmaj7', shape: null, display: 'name' };
    if (id === 'edge') state.target = 5;
    state.draft = clone(state.scores[state.target]);
    if (id === 'preset') state.draft = { name: 'Am', shape: clone(presets.Am), display: 'nameAndDiagram' };
    if (id === 'error') state.draft.name = '';
    if (id === 'diagram') state.draft.shape.invalid = true;
    state.selectedTarget = state.target;
    if (id === 'new' || id === 'unselected') { state.open = false; state.draft = null; }
    if (id === 'unselected') state.selectedTarget = null;
    render({ score: true, focus: id === 'settings' ? 'sidebar-name' : 'popover-name' });
    feedback(id === 'new' ? '已选中第 5 小节第 1 拍，点击「技巧」右侧的和弦图标添加。' : '固定演示数据，不写入真实曲谱。');
    const url = new URL(location.href); url.searchParams.set('scene', id); historyReplace(url);
  }
  const historyReplace = (url) => window.history.replaceState(null, '', url);
  function toggleSidebar(collapsed) {
    if (composing || cooling) return;
    $('.inspector').hidden = collapsed;
    $('#reopen-sidebar').hidden = !collapsed;
    requestAnimationFrame(placePopover);
    if (collapsed) $('#reopen-sidebar').focus({ preventScroll: true });
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button.dataset.scene) { loadScene(button.dataset.scene); return; }
    if (button.id === 'toolbar-chord') { if (state.selectedTarget !== null) openTarget(state.selectedTarget); return; }
    if (button.dataset.beat !== undefined) { selectBeat(Number(button.dataset.beat)); return; }
    if (button.dataset.target !== undefined) { openTarget(Number(button.dataset.target)); return; }
    if (button.dataset.preset) {
      if (composing || cooling || state.customTuning) return;
      state.draft = { name: button.dataset.preset, shape: clone(presets[button.dataset.preset]), display: 'nameAndDiagram' };
      const surface = button.closest('.chord-popover') ? popover : $('#sidebar-body');
      const chosen = button.dataset.preset;
      state.appliedMessage = false; render();
      surface.querySelector(`[data-preset="${chosen}"]`)?.focus({ preventScroll: true });
      feedback('预设已填入当前输入，尚未应用到谱面。'); return;
    }
    if (button.dataset.display) {
      state.draft.display = button.dataset.display; state.appliedMessage = false;
      const surface = button.closest('.chord-popover') ? popover : $('#sidebar-body');
      const value = button.dataset.display;
      render(); surface.querySelector(`[data-display="${value}"]`)?.focus({ preventScroll: true }); return;
    }
    const action = button.dataset.action;
    if (action === 'end') end();
    else if (action === 'apply') apply();
    else if (action === 'restore') { state.draft = clone(state.scores[state.target]); state.appliedMessage = false; render({ focus: 'sidebar-name' }); }
    else if (action === 'fix-diagram') {
      if (composing || cooling) return;
      toggleSidebar(false); render();
      $('#sidebar-body [data-group="range"]').open = true;
      $('#sidebar-start-fret').scrollIntoView({ block: 'nearest' }); $('#sidebar-start-fret').focus({ preventScroll: true });
      feedback('已定位右侧同一和弦的错误字段，当前输入保留。');
    } else if (action === 'locate') {
      const anchor = $(`[data-target="${state.target}"]`) || $(`[data-beat="${state.target}"]`); anchor.classList.add('locate-flash');
      setTimeout(() => anchor.classList.remove('locate-flash'), 900);
    } else if (action === 'create-diagram') {
      state.draft.shape = { frets: [0, 0, 0, 0, 0, 0], fingers: [null, null, null, null, null, null], barre: false }; state.appliedMessage = false;
      render({ focus: 'sidebar-name' });
    } else if (action === 'remove') {
      history.push(clone(state.scores)); redo = []; state.scores[state.target] = { name: '', shape: null, display: 'name' }; end();
      feedback('演示：已删除当前拍和弦，可通过撤销恢复。');
    } else if (action === 'export') feedback(dirty() || composing || cooling ? '请先应用或结束当前和弦编辑，再重新发起导出。' : '设计演示：当前无未应用修改；本页不生成真实文件。');
  });
  document.addEventListener('pointerdown', (event) => {
    if (event.target.closest('[data-action="fix-diagram"], [data-action="locate"]')) event.preventDefault();
  });
  document.addEventListener('input', (event) => {
    if (event.target.id === 'sidebar-start-fret') {
      if (event.target.value === '1') { delete state.draft.shape.invalid; render({ focus: 'sidebar-start-fret' }); }
      else {
        state.draft.shape.invalid = true;
        const value = event.target.value;
        render({ focus: 'sidebar-start-fret' });
        $('#sidebar-start-fret').value = value;
      }
      return;
    }
    if (!['popover-name', 'sidebar-name'].includes(event.target.id)) return;
    state.draft.name = event.target.value; state.appliedMessage = false;
    if (composing) {
      const other = $(event.target.id === 'popover-name' ? '#sidebar-name' : '#popover-name');
      if (other) other.value = event.target.value;
      return;
    }
    render();
  });
  document.addEventListener('change', (event) => {
    if (event.target.dataset.fret === undefined || !state.draft.shape) return;
    const index = Number(event.target.dataset.fret); const value = event.target.value === 'x' ? 'x' : Number(event.target.value);
    state.draft.shape.frets[index] = value;
    if (value === 'x' || value === 0) state.draft.shape.fingers[index] = null;
    state.appliedMessage = false; render();
    $(`[data-fret="${index}"]`)?.focus({ preventScroll: true });
  });
  document.addEventListener('compositionstart', (event) => {
    if (!['popover-name', 'sidebar-name'].includes(event.target.id)) return;
    composing = true;
    renderChordTool();
    document.querySelectorAll('[data-beat]').forEach((node) => { node.disabled = true; });
    document.querySelectorAll('[data-action="apply"], [data-action="end"], [data-action="restore"], [data-action="fix-diagram"], [data-action="create-diagram"], [data-action="remove"], select, [data-scene], [data-target], [data-preset], [data-display], #collapse-sidebar, #reopen-sidebar, #undo, #redo').forEach((node) => { node.disabled = true; });
  });
  document.addEventListener('compositionend', (event) => {
    if (!['popover-name', 'sidebar-name'].includes(event.target.id)) return;
    composing = false; cooling = true; state.draft.name = event.target.value;
    clearTimeout(coolingTimer);
    coolingTimer = setTimeout(() => { cooling = false; $('#collapse-sidebar').disabled = false; $('#reopen-sidebar').disabled = false; render({ score: true }); }, 60);
  });
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || composing || cooling || event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape' && state.open) { event.preventDefault(); end(); }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && ['popover-name', 'sidebar-name'].includes(event.target.id)) { event.preventDefault(); apply(); }
  });
  $('#toggle-notes').addEventListener('click', (event) => {
    const shown = event.target.getAttribute('aria-pressed') !== 'true';
    event.target.setAttribute('aria-pressed', String(shown)); event.target.textContent = shown ? '隐藏标注' : '显示标注'; $('#design-notes').hidden = !shown;
  });
  $('#collapse-sidebar').addEventListener('click', () => toggleSidebar(true));
  $('#reopen-sidebar').addEventListener('click', () => { toggleSidebar(false); $('#sidebar-name')?.focus({ preventScroll: true }); });
  $('#undo').addEventListener('click', () => {
    if (!history.length || composing || cooling) return;
    redo.push(clone(state.scores)); state.scores = history.pop();
    if (state.open) state.draft = clone(state.scores[state.target]); state.appliedMessage = false; render({ score: true }); feedback('演示：已撤销上次应用。');
  });
  $('#redo').addEventListener('click', () => {
    if (!redo.length || composing || cooling) return;
    history.push(clone(state.scores)); state.scores = redo.pop();
    if (state.open) state.draft = clone(state.scores[state.target]); state.appliedMessage = false; render({ score: true }); feedback('演示：已重做上次应用。');
  });
  $('.score-scroll').addEventListener('scroll', placePopover, { passive: true });
  window.addEventListener('resize', placePopover);
  const requested = new URLSearchParams(location.search).get('scene');
  loadScene(scenes.some(([id]) => id === requested) ? requested : 'existing');
})();
