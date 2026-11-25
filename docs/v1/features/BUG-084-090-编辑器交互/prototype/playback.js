(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const range = (first, last) => Array.from({ length: last - first + 1 }, (_, index) => first + index);
  const scoreView = $('score-view');
  const orderView = $('order-view');
  const paper = $('score');

  // 采用 BUG-089 截图中的试听路线。节点键是到访顺序，同一小节两次经过时仍是两个入口。
  const passages = [
    { title: '首次演奏', measures: range(1, 33) },
    { title: '反复段', measures: range(17, 31), jump: [33, 17, '反复回跳'], backward: true },
    { title: '结束段', measures: range(34, 42), jump: [31, 34, '跳过一房'] },
  ];
  const turns = new Map();
  const visits = [];
  const returnArrow = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4 3 8l4 4M3 8h10a4 4 0 0 1 0 8"/></svg>';
  const forwardArrow = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M13 4l4 4-4 4M17 8H7a4 4 0 0 0 0 8"/></svg>';

  for (const passage of passages) {
    const section = document.createElement('section');
    section.className = 'passage';
    const first = passage.measures[0];
    const last = passage.measures.at(-1);
    section.innerHTML = `<div class="passage-heading"><h3>${passage.title}</h3><span>第 ${first}–${last} 小节</span></div>`;
    if (passage.jump) {
      const [from, to, reason] = passage.jump;
      section.insertAdjacentHTML('beforeend', `<p class="passage-bridge">${passage.backward ? returnArrow : forwardArrow}<b>${from} → ${to}</b><span>${reason}</span></p>`);
    }
    const items = document.createElement('ol');
    items.className = 'visits';
    items.start = visits.length + 1;
    items.setAttribute('role', 'list');
    for (const measure of passage.measures) {
      const pass = (turns.get(measure) || 0) + 1;
      turns.set(measure, pass);
      const index = visits.length;
      const item = document.createElement('li');
      item.className = 'visit-item';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'visit';
      button.dataset.visit = index + 1;
      button.dataset.measure = measure;
      button.setAttribute('aria-label', `试听第 ${measure} 小节，第 ${pass} 次到访，播放顺序 ${index + 1} / 57`);
      if (pass === 2) button.dataset.second = '';
      button.innerHTML = `<span class="measure-label">${measure}</span><span class="visit-note">${measure >= 17 && measure <= 31 ? `第 ${pass} 次` : ''}</span>`;
      button.addEventListener('click', () => beginVisit(index, true, true));
      item.append(button);
      items.append(item);
      visits.push({ measure, pass, button });
    }
    section.append(items);
    orderView.append(section);
  }

  // 依据仓库《理想》的编号、和弦和代表性简谱排成完整 42 小节。TAB 节奏和指法用于原型示意。
  const chords = 'G C Asus2 G G Am D G G Gadd9 Asus2/Dsus2 Gadd9 G Asus2 Dsus2 Gadd9 C G C G C Bm/E Am/C Am/D C G Am/D G/G7 C Bm/E Am C Dsus4/D C C Dsus4 D C G C D7 G'.split(' ');
  const notation = [
    ['0 0 0 0'], ['0 0 0 0'], ['0 0 0 0'], ['0 0 0 0'], ['0 0 0 0'], ['0 0 0 0'], ['0 0 0 0'], ['0 0 0 0'],
    ['0 3 2 3 3 2 3 5 3 3 2 1', '一个人住在这城市为了'],
    ['1 1 1 1 1 1 1 1 6. 1 0 1', '填饱肚子就已精疲力还'],
    ['2 1 2 3 6. 0 5. 5. 6 5 3', '谈什么理想那是我们的'],
    ['2 3 3 0 0', '美梦'],
    ['0 3 2 3 3 2 3 5 6 6 5 3', '梦醒后还是依然奔波在风'],
    ['2 2 3 3 2 2 0 6. 6. 6.', '雨的街头有时候'],
    ['1 2 2 1 2 2 1 6 5 5 5 3 2', '想哭就把泪咽进一腔热血的胸'],
    ['2 1 1 0 0', '口'],
    ['0 1 6. 1 6. 1 1 1 1 6.', '公车上我睡过了车站'],
    ['5. - 0 0'],
    ['0 1 6. 1 6. 1 1 6 5 3', '一路上我望着霓虹的'],
    ['2 3 3 - -', '北京'],
    ['0 6. 1 1 1 0 1 1 1 1 3', '我的理想把我丢在这'],
    ['3 5 6 5 3 6 6 0 6. 6.', '个拥挤的人潮车窗'],
    ['2 2 2 2 3 6 5 5 3 5', '外已经是一片白雪茫'],
    ['5 5 5 - 1\' 7 1\'', '茫又一个'],
    ['1\' 6 5 6 6 6 1\' 1\' 1\' 6 3', '四季在轮回而我一无所', '年代在变幻我已不是无'],
    ['3 6 5 3 2 5 5 3 3 5 5', '获的坐在街头只有理', '悔的那个青年青春被'],
    ['5 2 2 2 2 1 1 2 6 6 5 6', '想在支撑着那些麻木的', '时光抛弃已是当父亲的'],
    ['3 3 3 0 1 1 1\' 7 6', '血肉理想今年你', '年纪理想永远都'],
    ['5 6 6 0 1\' 1\' 1\' -', '几岁你总是', '年轻你让我'],
    ['7 7 7 7 5 7 7 6 0 6. 6. 6.', '诱惑着年轻的朋友你总是', '倔强地反抗着命运你让我'],
    ['3 4 3 4 4 3 4 5 4 6. 6. 6.', '谢了又开给我惊喜又让我', '边得苍白却依然天真地相信'],
    ['4 4 4 4 3 1', '沉入失望的生'],
    ['3 2 2 - -', '活里'],
    ['4 4 4 4 4 4 5 5 1\' 7 5', '沉入失望的生活里又一个'],
    ['5 4 3 3 1 3', '花儿会再次的'],
    ['3 2 2 - -', '盛开'], ['0 0 0 0'],
    ['0 1 6. 1 1 1 6. 6. 1 1 1 6.', '阳光之中到处可见奔忙的'],
    ['6. 5. 5. - -', '人们'],
    ['0 1 6. 1 1 1 6. 6. 1 1 1 6. 1 1', '被拥挤着被一晃而过的光阴'],
    ['1 - - 2 2', '忽略'], ['1 - - -', '过'],
  ];
  const shapes = {
    G: '320003', C: 'x32010', Asus2: 'x02200', Am: 'x02210', D: 'xx0232',
    Gadd9: '320203', Dsus2: 'xx0230', Bm: 'x24432', E: '022100', G7: '320001',
    Dsus4: 'xx0233', D7: 'xx0212',
  };
  const lines = [range(1, 5), range(6, 10), range(11, 14), range(15, 18), range(19, 22), range(23, 26), range(27, 30), range(31, 35), range(36, 40), range(41, 42)];
  const scoreMeasures = new Map();
  const ns = 'http://www.w3.org/2000/svg';
  const line = (x1, y1, x2, y2, width = 0.85) => `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="currentColor" stroke-width="${width}" fill="none"/>`;
  const label = (x, y, text, size = 11, attrs = '') => `<text x="${x}" y="${y}" font-size="${size}" text-anchor="middle" ${attrs}>${text}</text>`;

  function chordAt(name, x) {
    let grid = label(x + 12.5, 24, name, 10);
    for (let string = 0; string < 6; string++) {
      const sx = x + string * 5;
      const fret = shapes[name][string];
      grid += line(sx, 35, sx, 54, .62);
      if (fret === 'x' || fret === '0') grid += label(sx, 33, fret === 'x' ? '×' : '○', 6);
      else grid += `<circle cx="${sx}" cy="${35 + (Number(fret) - .5) * 4.75}" r="1.8" fill="currentColor"/>`;
    }
    for (let fret = 0; fret <= 4; fret++) grid += line(x, 35 + fret * 4.75, x + 25, 35 + fret * 4.75, fret ? .58 : 1.15);
    return grid;
  }

  function renderMeasure(measure, x, width, first) {
    const [melody, verse1 = '', verse2 = ''] = notation[measure - 1];
    const names = chords[measure - 1].split('/');
    const end = x + width;
    const bodyLeft = x + (first ? 22 : 10);
    const bodyWidth = end - bodyLeft - 8;
    let markup = `<rect class="measure-fill" data-score-measure="${measure}" x="${x + .5}" y="61" width="${width - 1}" height="105" rx="2"/>`;
    names.forEach((name, index) => { markup += chordAt(name, bodyLeft + index * bodyWidth / names.length); });
    markup += line(end, 73, end, 156);
    markup += label(end - 1, 69, measure, 9, `class="measure-number" data-number="${measure}" style="text-anchor:end"`);
    if (measure === 33 || measure === 42) markup += line(end - 3, 73, end - 3, 106, 2);
    if (measure === 33) for (const y of [86, 93]) markup += `<circle cx="${end - 8}" cy="${y}" r="1.45" fill="currentColor"/>`;
    if (measure === 17) {
      markup += line(x + 4, 73, x + 4, 106, 1.8);
      for (const y of [86, 93]) markup += `<circle cx="${x + 8}" cy="${y}" r="1.45" fill="currentColor"/>`;
    }
    if (measure === 32 || measure === 34) {
      markup += line(x + 3, 12, end - 3, 12, .68) + line(x + 3, 12, x + 3, 19, .68);
      markup += label(x + 10, 10, measure === 32 ? '1.' : '2.', 9);
    }
    const tabCount = measure > 40 ? 4 : (measure === 33 || measure === 37 ? 7 : (measure < 9 ? 11 : 13));
    const picking = [5, 2, 3, 1, 2, 3, 4, 2, 1, 3, 2, 4, 3];
    const beatGap = bodyWidth / tabCount;
    for (let beat = 0; beat < tabCount; beat++) {
      const tx = bodyLeft + (beat + .5) * beatGap;
      let string = picking[(beat + measure % 3) % picking.length];
      const shape = shapes[names[Math.min(names.length - 1, Math.floor(beat / tabCount * names.length))]];
      if (shape[5 - string] === 'x') string = 3;
      const y = 73 + string * 6.6;
      const muted = beat % 4 === 2;
      const arrow = measure > 24 && beat % 3 === 0;
      if (arrow) {
        markup += line(tx, 75, tx, 106, .7);
        markup += `<path d="M${tx - 2} 77l2-5 2 5z" fill="currentColor"/>`;
      } else {
        markup += `<rect x="${tx - 3.1}" y="${y - 3.1}" width="6.2" height="6.2" fill="var(--white)"/>`;
        markup += label(tx, y + 2.25, muted ? '×' : shape[5 - string], 8);
      }
      markup += line(tx, arrow ? 106 : y + 3.1, tx, 125, .72);
      if (beat % 4 !== 3 && beat < tabCount - 1) {
        markup += line(tx, 125, tx + beatGap, 125, 1.25);
        if (beat % 4 >= 1) markup += line(tx, 121.5, tx + beatGap, 121.5, 1.05);
      }
      if (beat % 9 === 5 && beat < tabCount - 1) markup += `<path d="M${tx} ${y - 5}q${beatGap / 2} -8 ${beatGap} 0" fill="none" stroke="currentColor" stroke-width=".72"/>`;
    }
    const tokens = melody.split(' ');
    for (const [index, token] of tokens.entries()) {
      const gap = bodyWidth / tokens.length;
      const mx = bodyLeft + (index + .5) * gap;
      markup += label(mx, 150, token.replace(/[.']/g, ''), 11);
      if (token.endsWith('.')) markup += `<circle cx="${mx}" cy="154" r=".8" fill="currentColor"/>`;
      if (token.endsWith("'")) markup += `<circle cx="${mx}" cy="141" r=".8" fill="currentColor"/>`;
      if (tokens.length > 5 && token !== '0' && token !== '-') {
        markup += line(mx - gap * .39, 152, mx + gap * .39, 152, .9);
        if (index % 3 !== 2) markup += line(mx - gap * .39, 154.5, mx + gap * .39, 154.5, .78);
      }
    }
    for (const [verse, lyrics] of [verse1, verse2].entries()) {
      const letters = Array.from(lyrics);
      if (letters.length) markup += letters.map((char, index) => label(bodyLeft + (index + .5) * bodyWidth / Math.max(letters.length, tokens.length), 172 + verse * 15, char, 10.5)).join('');
    }
    return markup;
  }

  const scoreHeader = `<header class="score-heading"><h2>理想</h2><p>编谱：六线猫</p></header><p class="score-meta">1=G　·　4/4</p>`;
  paper.innerHTML = scoreHeader;
  const playhead = document.createElementNS(ns, 'line');
  playhead.id = 'playhead';
  for (const group of lines) {
    const svg = document.createElementNS(ns, 'svg');
    const height = group[0] >= 23 && group[0] <= 31 ? 213 : 198;
    svg.setAttribute('viewBox', `0 0 864 ${height}`);
    svg.classList.add('score-system');
    svg.setAttribute('aria-hidden', 'true');
    const leading = 44;
    const groupWidth = group.length === 2 ? 375 : 776;
    const weights = group.map(measure => Math.max(7, notation[measure - 1][0].split(' ').length));
    const weightSum = weights.reduce((total, weight) => total + weight, 0);
    let x = leading;
    let fills = '';
    let measures = '';
    for (const [index, measure] of group.entries()) {
      const width = groupWidth * weights[index] / weightSum;
      const svgContent = renderMeasure(measure, x, width, index === 0);
      const rectEnd = svgContent.indexOf('/>') + 2;
      fills += svgContent.slice(0, rectEnd);
      measures += svgContent.slice(rectEnd);
      scoreMeasures.set(measure, { system: svg, left: x + (index === 0 ? 13 : 3), span: width - (index === 0 ? 16 : 6) });
      x += width;
    }
    const strings = Array.from({ length: 6 }, (_, index) => line(leading, 73 + index * 6.6, leading + groupWidth, 73 + index * 6.6)).join('');
    svg.innerHTML = fills + strings + line(leading, 73, leading, 156) + measures + label(leading + 7, 102, 'B', 8, 'font-family="serif"') + label(leading + 7, 90, 'A', 8, 'font-family="serif"') + label(leading + 7, 78, 'T', 8, 'font-family="serif"');
    for (const measure of group) {
      const record = scoreMeasures.get(measure);
      record.fill = svg.querySelector(`[data-score-measure="${measure}"]`);
      record.number = svg.querySelector(`[data-number="${measure}"]`);
    }
    paper.append(svg);
  }

  function attachScroll(shell) {
    const view = shell.querySelector('.scroll-view');
    const bars = [...shell.querySelectorAll('.scroll-track')].map(track => ({
      track,
      thumb: track.firstElementChild,
      horizontal: track.classList.contains('horizontal'),
      length: 0,
      maximum: 0,
    }));
    let idleTimer;
    let quiet = false;
    let queued = false;

    function update() {
      queued = false;
      for (const bar of bars) {
        const client = bar.horizontal ? view.clientWidth : view.clientHeight;
        const full = bar.horizontal ? view.scrollWidth : view.scrollHeight;
        bar.maximum = full - client;
        shell.classList.toggle(bar.horizontal ? 'has-horizontal' : 'has-vertical', bar.maximum > 0);
        bar.track.toggleAttribute('data-overflow', bar.maximum > 0);
      }
      for (const bar of bars) {
        if (bar.maximum <= 0) continue;
        const { track, thumb, horizontal } = bar;
        const room = horizontal ? track.clientWidth : track.clientHeight;
        const full = horizontal ? view.scrollWidth : view.scrollHeight;
        const client = full - bar.maximum;
        const position = horizontal ? view.scrollLeft : view.scrollTop;
        bar.length = Math.min(room, Math.max(32, room * client / full));
        const offset = position / bar.maximum * (room - bar.length);
        thumb.style[horizontal ? 'width' : 'height'] = `${bar.length}px`;
        thumb.style[horizontal ? 'left' : 'top'] = `${offset}px`;
      }
    }

    const schedule = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(update);
    };

    view.addEventListener('scroll', () => {
      schedule();
      if (quiet) return;
      clearTimeout(idleTimer);
      shell.classList.add('recent-scroll');
      idleTimer = setTimeout(() => shell.classList.remove('recent-scroll'), 470);
    }, { passive: true });

    // 轨道只映射自身视口的滚动范围，拖出区域继续捕获指针，松开或取消时撤销拖动样式。
    for (const bar of bars) {
      const { track, thumb, horizontal } = bar;
      const axis = horizontal ? 'left' : 'top';
      const extent = horizontal ? 'width' : 'height';
      const pointer = event => horizontal ? event.clientX : event.clientY;
      let grabOffset;
      let pointerId;
      function drag(event) {
        const rect = track.getBoundingClientRect();
        const travel = rect[extent] - bar.length;
        const ratio = travel > 0 ? (pointer(event) - rect[axis] - grabOffset) / travel : 0;
        view[horizontal ? 'scrollLeft' : 'scrollTop'] = Math.min(1, Math.max(0, ratio)) * bar.maximum;
      }
      track.addEventListener('pointerdown', event => {
        if (event.button !== 0 || pointerId !== undefined || bar.maximum <= 0) return;
        event.preventDefault();
        const box = thumb.getBoundingClientRect();
        const coordinate = pointer(event);
        grabOffset = coordinate >= box[axis] && coordinate <= box[axis] + box[extent] ? coordinate - box[axis] : bar.length / 2;
        pointerId = event.pointerId;
        track.setPointerCapture(pointerId);
        track.classList.add('dragging');
        shell.classList.add('drag-scroll');
        drag(event);
      });
      track.addEventListener('pointermove', event => {
        if (event.pointerId === pointerId) drag(event);
      });
      track.addEventListener('lostpointercapture', () => {
        pointerId = undefined;
        track.classList.remove('dragging');
        shell.classList.remove('drag-scroll');
      });
    }

    const resize = new ResizeObserver(schedule);
    resize.observe(view);
    for (const child of view.children) resize.observe(child);
    update();
    return {
      withoutReveal(action) {
        quiet = true;
        action();
        requestAnimationFrame(() => { quiet = false; });
      },
    };
  }

  const scoreScroll = attachScroll(scoreView.parentElement);
  const orderScroll = attachScroll(orderView.parentElement);
  let current = 33;
  let phase = 0;
  let playing = false;
  let singleVisit = false;
  let ended = false;
  let frame;
  let previousTick;
  let shownVisit;
  let shownMeasure;
  let zoom = 100;

  function revealVisit(initial) {
    const { button } = visits[current];
    const view = orderView.getBoundingClientRect();
    const box = button.getBoundingClientRect();
    if (initial) {
      // 当前到访已在首屏前 2/3 时，从段落标题开始展示顺序。列表较高时才定位到完整行，给回跳前后都留出上下文。
      const anchor = box.top - view.height * 2 / 3;
      if (anchor <= view.top) return;
      const firstRow = visits.find(visit => visit.button.getBoundingClientRect().top >= anchor);
      if (firstRow) orderView.scrollTop += firstRow.button.getBoundingClientRect().top - view.top - 6;
    } else if (box.top < view.top + 10) orderView.scrollTop += box.top - view.top - 16;
    else if (box.bottom > view.bottom - 10) orderView.scrollTop += box.bottom - view.bottom + 16;
  }

  function revealMeasure(initial) {
    const { system, fill } = scoreMeasures.get(visits[current].measure);
    const view = scoreView.getBoundingClientRect();
    const measure = fill.getBoundingClientRect();
    const box = system.getBoundingClientRect();
    if (initial) {
      const anchor = system.previousElementSibling?.classList.contains('score-system') ? system.previousElementSibling : system;
      scoreView.scrollTop += anchor.getBoundingClientRect().top - view.top;
    } else if (box.top < view.top + 8 || box.bottom > view.bottom - 18) {
      scoreView.scrollTop += box.top - view.top - Math.round((view.height - box.height) * .42);
    }
    if (measure.left < view.left + 24) scoreView.scrollLeft += measure.left - view.left - 24;
    else if (measure.right > view.right - 26) scoreView.scrollLeft += measure.right - view.right + 26;
  }

  function paintProgress() {
    const x = shownMeasure.left + phase * shownMeasure.span;
    playhead.setAttribute('x1', x);
    playhead.setAttribute('x2', x);
    playhead.setAttribute('y1', '62');
    playhead.setAttribute('y2', '162');
    shownVisit.button.style.setProperty('--progress', `${phase * 100}%`);
  }

  function paintState(initial = false) {
    const visit = visits[current];
    if (shownVisit !== visit) {
      shownVisit?.button.removeAttribute('aria-current');
      shownMeasure?.fill.classList.remove('current');
      shownMeasure?.number.classList.remove('current');
      shownVisit = visit;
      shownMeasure = scoreMeasures.get(visit.measure);
      visit.button.setAttribute('aria-current', 'true');
      shownMeasure.fill.classList.add('current');
      shownMeasure.number.classList.add('current');
      shownMeasure.system.append(playhead);
      $('location').textContent = `第 ${visit.measure} 小节 · 第 ${visit.pass} 次`;
      $('status-current').textContent = `第 ${visit.measure} 小节 · 第 ${visit.pass} 次到访`;
      $('status-position').textContent = `进度 ${current + 1} / ${visits.length}`;
      revealVisit(initial);
      revealMeasure(initial);
    }
    const action = playing ? '暂停' : '播放';
    $('play').setAttribute('aria-label', action);
    $('play-text').textContent = action;
    $('play-shape').setAttribute('d', playing ? 'M7 5v10m6-10v10' : 'm7 4 9 6-9 6z');
    $('mode').classList.toggle('playing', playing);
    $('mode').textContent = playing ? '试听中' : ended ? '已结束' : '已暂停';
    paintProgress();
  }

  function bpm() {
    return Math.min(240, Math.max(40, Number.parseInt($('bpm').value, 10) || 90));
  }

  // 以经过时间推进播放计划，先消耗本次到访，再按序号进入下一次，回跳时仍只高亮一个节点。
  function tick(now) {
    const elapsed = previousTick === undefined ? 0 : now - previousTick;
    previousTick = now;
    phase += elapsed / (240000 / bpm());
    const elapsedVisits = Math.floor(phase);
    if (elapsedVisits > 0) {
      if (singleVisit) {
        // 从列表点听只演示所选的这一次到访。停在该小节，方便连续比较两次进入同一小节的上下文。
        phase = 1;
        playing = false;
      } else if (current + elapsedVisits >= visits.length) {
        current = visits.length - 1;
        phase = 1;
        ended = true;
        playing = false;
      } else {
        current += elapsedVisits;
        phase -= elapsedVisits;
      }
      paintState();
    } else paintProgress();
    if (playing) frame = requestAnimationFrame(tick);
  }

  function setPlaying(next) {
    cancelAnimationFrame(frame);
    previousTick = undefined;
    playing = next;
    paintState();
    if (playing) frame = requestAnimationFrame(tick);
  }

  function beginVisit(index, play, onlyThisVisit = false) {
    singleVisit = onlyThisVisit;
    current = index;
    phase = 0;
    ended = false;
    setPlaying(play);
    revealVisit(false);
    revealMeasure(false);
  }

  $('play').addEventListener('click', () => {
    if (!playing && singleVisit) beginVisit(current, true);
    else if (ended) beginVisit(0, true);
    else setPlaying(!playing);
  });
  $('stop').addEventListener('click', () => beginVisit(0, false));
  $('bpm').addEventListener('change', event => { event.currentTarget.value = bpm(); });

  function setZoom(value) {
    zoom = Math.min(175, Math.max(75, value));
    paper.style.setProperty('--zoom', zoom / 100);
    $('zoom-reset').textContent = `${zoom}%`;
    $('zoom-out').disabled = zoom === 75;
    $('zoom-in').disabled = zoom === 175;
    revealMeasure(false);
  }

  $('zoom-out').addEventListener('click', () => setZoom(zoom - 25));
  $('zoom-in').addEventListener('click', () => setZoom(zoom + 25));
  $('zoom-reset').addEventListener('click', () => setZoom(100));

  orderScroll.withoutReveal(() => scoreScroll.withoutReveal(() => paintState(true)));
})();
