/* 独立审稿原型。无产品依赖、无云端/本地持久化、无真实下载。 */
(() => {
  'use strict';
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const copy = x => JSON.parse(JSON.stringify(x));
  const pitches = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
  const tonalities = {major:['C','G','D','A','E','B','F#','Db','Ab','Eb','Bb','F'],minor:['Am','Em','Bm','F#m','C#m','G#m','D#m','Bbm','Fm','Cm','Gm','Dm']};
  const keyParts = key => {
    const match = /^([A-G])([#b]?)(m?)$/.exec(key);
    if (!match) return null;
    return {tonicPc:({C:0,D:2,E:4,F:5,G:7,A:9,B:11}[match[1]] + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0) + 12) % 12,mode:match[3] ? 'minor' : 'major'};
  };
  const derivedNumbered = key => { const {tonicPc,mode} = keyParts(key); return pitches[(tonicPc + (mode === 'minor' ? 3 : 0)) % 12]; };
  const matchesTonality = (key, numberedKey, degree) => {
    const parsed = keyParts(key);
    return !!parsed && pitches.includes(numberedKey) && parsed.tonicPc === (pitches.indexOf(numberedKey) + (parsed.mode === 'minor' && degree === 6 ? 9 : 0)) % 12;
  };
  const sample = () => ({title:'风吹过山谷',arranger:'',meter:'4/4',key:'C',numberedKey:'C',capo:0,bars:12,notes:[0,1,0,3],blank:false});
  const filenameFor = title => (title.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'').trim().slice(0,80) || '未命名曲谱') + '.lxm.json';
  const keyLabel = key => (key.endsWith('m') ? key.slice(0,-1) + ' 小调' : key + ' 大调').replace('#','♯').replace('b','♭');
  const tonalitySummary = doc => `1=${doc.numberedKey} · ${keyLabel(doc.key).replace(' ','')}${doc.key.endsWith('m') ? ` · 主音记${doc.minorTonicDegree}` : ''}`;
  const authorLine = doc => doc.arranger.trim() ? `<p>编谱：${escape(doc.arranger)}</p>` : '';
  let score = sample(), baseline = '', started = false, view = 'home', history = [], future = [], draft = false;
  let imported = false, handedOff = false, modalKind = '', exportType = 'json', pending = null, downloadStarted = false;
  let importCandidate = null, importError = '', importFilename = '', page = 1, trigger = null, toastTimer, importGeneration = 0;
  let sideTab = 'song', zoom = 125, sidebarOpen = true, historyOpen = false;
  let pngRange = 'all', imageStage = 'ready', imageSignature = '', generationTimer, generationToken = 0, exportMessage = '', exportError = false;
  const modal = $('#modal');
  const snapshot = () => JSON.stringify(score);
  const dirty = () => started && (!baseline || snapshot() !== baseline);
  const pages = () => Math.ceil(score.bars / 8);
  const actionName = type => ({new:'新建曲谱',import:'导入另一份曲谱',home:'返回首页',advanced:'前往吉他进阶'}[type]);

  function toast(text) { clearTimeout(toastTimer); $('#toast').textContent = text; $('#toast').hidden = false; toastTimer = setTimeout(() => $('#toast').hidden = true, 4200); }
  function svgScore(doc, {home = false, preview = false, currentPage = 1} = {}) {
    const columns = home ? 2 : 4, barCount = home ? 4 : Math.min(8, Math.max(1, doc.bars - (currentPage - 1) * 8));
    const width = columns === 2 ? 560 : 900, rowHeight = home ? 154 : 190, rows = Math.ceil(barCount / columns), height = rows * rowHeight + 8;
    let s = `<svg class="score-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(doc.title)}，六根弦，从上到下为第1至第6弦"><title>六线谱 · 标准调弦</title>`;
    const chords = ['C','Am','F','G'];
    for (let row = 0; row < rows; row++) {
      const y = row * rowHeight + 43, left = 30, right = width - 8, bw = (right - left) / columns;
      for (let string = 0; string < 6; string++) {
        s += `<line x1="${left}" x2="${right}" y1="${y + string * 9}" y2="${y + string * 9}" stroke="#2e333a" stroke-width=".8"/>`;
        if (string < 3) s += `<text x="23" y="${y + string * 9 + 4}" fill="#343a43" font-size="10" text-anchor="middle">${['T','A','B'][string]}</text>`;
      }
      for (let col = 0; col <= columns; col++) s += `<line x1="${left + col * bw}" x2="${left + col * bw}" y1="${y}" y2="${y + 65}" stroke="#343a43" stroke-width="1"/>`;
      for (let col = 0; col < columns; col++) {
        const bar = row * columns + col, absoluteBar = (currentPage - 1) * 8 + bar;
        if (bar >= barCount) continue;
        const x = left + col * bw;
        s += `<text x="${x + 4}" y="${y - 27}" fill="#7d8da1" font-size="9">${absoluteBar + 1}</text>`;
        if (!doc.blank) {
          s += `<text x="${x + 33}" y="${y - 30}" fill="#22262d" font-size="12" text-anchor="middle">${chords[absoluteBar % 4]}</text>`;
          for (let grid = 0; grid < 4; grid++) s += `<path d="M${x + 20 + grid * 8} ${y - 25}v20 M${x + 20} ${y - 25 + grid * 6.5}h24" stroke="#424853" stroke-width=".65"/>`;
          s += `<circle cx="${x + 28}" cy="${y - 14}" r="2" fill="#252a31" stroke="none"/><circle cx="${x + 36}" cy="${y - 8}" r="2" fill="#252a31" stroke="none"/>`;
        }
        if (doc.blank && (!doc.firstNoteEdited || absoluteBar !== 0)) {
          for (let beat = 0; beat < (doc.meter === '3/4' ? 3 : doc.meter === '6/8' ? 6 : 4); beat++) {
            const slots = doc.meter === '3/4' ? 3 : doc.meter === '6/8' ? 6 : 4;
            const nx = x + 18 + beat * ((bw - 36) / Math.max(1, slots - 1));
            s += `<rect x="${nx - 6}" y="${y + 18}" width="12" height="18" rx="2" fill="#fafcff" stroke="#bccbdc" stroke-width=".8" stroke-dasharray="2 2"/>`;
          }
        } else {
          for (let beat = 0; beat < (doc.blank ? 1 : 8); beat++) {
            const nx = x + 20 + beat * ((bw - 30) / 8), str = (beat + absoluteBar) % 6, ny = y + str * 9;
            const selected = absoluteBar === 0 && beat === 0 && !home && !preview;
            const fret = absoluteBar === 0 ? doc.notes[beat % 4] : [0,2,3,0][(beat + absoluteBar) % 4];
            s += `<g ${selected ? 'class="note-target" tabindex="0" role="button" aria-label="修改第1小节第1拍音符"' : ''}>`;
            s += `<rect x="${nx - (selected ? 12 : 7)}" y="${ny - 10}" width="${selected ? 24 : 14}" height="20" rx="3" fill="${selected ? '#e2eeff' : '#fff'}" stroke="${selected ? '#1677ff' : 'none'}" stroke-width=".8"/>`;
            s += `<text x="${nx}" y="${ny + 4}" text-anchor="middle" fill="${selected ? '#0958d9' : '#24282e'}" font-size="12" font-family="Georgia,serif">${fret}</text></g>`;
            s += `<path d="M${nx} ${ny + 7}V${y + 72}" stroke="#30343b" stroke-width=".9"/>`;
            if (beat % 2) s += `<path d="M${nx - (bw - 30) / 8} ${y + 72}H${nx}" stroke="#30343b" stroke-width="1.6"/>`;
          }
          if (!doc.blank) {
            for (let lyric = 0; lyric < 4; lyric++) s += `<text x="${x + 24 + lyric * (bw - 26) / 4}" y="${y + 103}" font-size="12" fill="#24282e">${[0,3,3,2][(lyric + absoluteBar) % 4]}</text>`;
            if (row > 0) s += `<text x="${x + 24}" y="${y + 127}" font-size="11" fill="#24282e">${['风 吹 过 山 谷','把 心 事 带 走','沿 着 那 条 路','慢 慢 向 前 走'][col]}</text>`;
          }
        }
      }
    }
    return s + '</svg>';
  }
  function render() {
    $('#home-view').hidden = view !== 'home'; $('#editor-view').hidden = view !== 'editor';
    $('#editor-actions').hidden = view !== 'editor'; $('#home-caption').hidden = view !== 'home';
    $('#header-subtitle').hidden = view !== 'editor';
    $('#edit-note').disabled = $('#add-measure').disabled = view !== 'editor';
    $('#header-name').textContent = view === 'editor' ? score.title : '让灵感成为曲谱';
    $('#home-score-art').innerHTML = svgScore(sample(), {home:true});
    if (view !== 'editor') return;
    const state = $('#file-state');
    state.textContent = dirty() ? '待导出 JSON' : handedOff ? 'JSON已导出' : imported ? '与导入文件一致' : 'JSON已导出';
    state.className = 'file-state ' + (dirty() ? '' : handedOff ? 'exported' : 'baseline');
    state.title = !dirty() && handedOff ? '当前版本已发起 JSON 下载，请确认文件已下载；可再次导出。' : imported && !dirty() ? '原生 JSON 文件是当前可恢复基线；修改后请重新导出。' : '当前版本尚未发起 JSON 下载，请主动导出留存。';
    $('#score-title').textContent = score.title;
    $('#score-author').hidden = !score.arranger.trim();
    $('#score-author').textContent = score.arranger.trim() ? `编谱：${score.arranger}` : '';
    $('#score-meta').textContent = `${tonalitySummary(score)}　${score.meter}`;
    $('#score-tuning').textContent = '标准调弦';
    $('#toolbar-meta').textContent = `${score.meter}　${tonalitySummary(score)}`;
    page = Math.min(page, pages());
    $('#editor-score-art').innerHTML = svgScore(score, {currentPage:page});
    const target = $('.note-target');
    if (target) { target.addEventListener('click', editNote); target.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); editNote(); } }); }
    $('#measure-count').innerHTML = `${score.bars} 小节　<span>第 ${page} / ${pages()} 页</span>${pages() > 1 ? '　<button id="prev-page" class="quiet" aria-label="上一页">‹</button><button id="next-page" class="quiet" aria-label="下一页">›</button>' : ''}`;
    if ($('#prev-page')) { $('#prev-page').disabled = page === 1; $('#next-page').disabled = page === pages(); $('#prev-page').onclick = () => {page--;render();}; $('#next-page').onclick = () => {page++;render();}; }
    $('#undo').disabled = !history.length;
    $('#redo').disabled = !future.length;
    $('#history-undo').disabled = !history.length;
    $('#history-count').textContent = history.length ? `当前有 ${history.length} 次可撤销的修改` : '暂无编辑记录';
    $('#history-panel').hidden = !historyOpen;
    $('#toggle-history').setAttribute('aria-expanded',String(historyOpen));
    $('.workspace').classList.toggle('sidebar-collapsed',!sidebarOpen);
    $('#toggle-sidebar').setAttribute('aria-expanded',String(sidebarOpen));
    $('#toggle-sidebar').setAttribute('aria-label',sidebarOpen ? '收起右侧面板' : '展开右侧面板');
    $('.editor-paper').style.setProperty('--score-scale',zoom / 125);
    $('#zoom-reset').textContent = `${zoom}%⌄`;
    $('#zoom-out').disabled = zoom <= 75; $('#zoom-in').disabled = zoom >= 175;
    $$('[data-side]').forEach(b => {const selected=b.dataset.side===sideTab;b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1;$(`#side-${b.dataset.side}`).hidden=!selected;});
    $('#apply-draft').disabled = $('#discard-draft').disabled = !draft;
    $('#draft-status').textContent = draft ? '尚未应用' : '修改后应用到曲谱';
    if (!draft) $('#draft-title').value = score.title;
    $('#song-summary').innerHTML = [['编谱作者',score.arranger.trim() || '未填写'],['调性',tonalitySummary(score)],['拍号',score.meter],['调弦','标准调弦']].map(([k,v]) => `<div class="summary-row"><span>${escape(k)}</span><strong>${escape(v)}</strong></div>`).join('');
  }
  function invalidateImages() { clearTimeout(generationTimer); generationToken++; imageStage = 'ready'; imageSignature = ''; exportMessage = ''; }
  function remember() {history.push(copy(score));future=[];invalidateImages();}
  function editNote() { if (view !== 'editor') return; remember(); score.firstNoteEdited = true; score.notes[0] = (score.notes[0] + 1) % 6; $('#editor-status').textContent = `已修改第 1 小节第 1 拍为 ${score.notes[0]} 品`; page = 1; render(); }
  function closeMenu() { $('#file-menu').hidden = true; $('#file-menu-trigger').setAttribute('aria-expanded','false'); $('#export-menu').hidden = true; $('#main-export').setAttribute('aria-expanded','false'); }
  function showDialog(kind, html, wide = false) {
    if (kind !== 'import') importGeneration++;
    if (!modal.open) trigger = document.activeElement;
    modalKind = kind; modal.classList.toggle('wide',wide); modal.classList.toggle('new-score-dialog',kind === 'new'); modal.classList.toggle('guard-dialog',['guard','draft'].includes(kind)); modal.classList.toggle('export-json-dialog',kind === 'export' && exportType === 'json'); modal.classList.toggle('export-visual-dialog',kind === 'export' && exportType !== 'json'); $('#modal-content').innerHTML = html;
    $('.modal-review-strip',modal)?.remove();
    if (['export','guard'].includes(kind)) {
      modal.insertAdjacentHTML('beforeend',`<aside class="modal-review-strip" aria-label="评审工具，非产品内容"><span>评审工具 · 模拟</span><label for="dialog-download-result">交接</label><select id="dialog-download-result"><option value="success">成功</option><option value="cancel">取消</option><option value="fail">失败</option></select>${kind === 'export' && exportType === 'png' ? '<label for="dialog-generation-result">生成</label><select id="dialog-generation-result"><option value="success">成功</option><option value="cancel">取消</option><option value="fail">失败</option></select>' : ''}</aside>`);
      $('#dialog-download-result').value = $('#download-result').value;
      $('#dialog-download-result').onchange = e => {$('#download-result').value=e.target.value;};
      if ($('#dialog-generation-result')) {$('#dialog-generation-result').value=$('#generation-result').value;$('#dialog-generation-result').onchange=e=>{$('#generation-result').value=e.target.value;};}
    }
    if (!modal.open) modal.showModal();
    $('[data-close]',modal)?.addEventListener('click', cancelDialog);
    const focus = $('[autofocus]',modal) || $('input:not([type=file]),select,button',modal); focus?.focus();
  }
  function closeDialog() { importGeneration++; if (imageStage === 'generating') invalidateImages(); if (modal.open) modal.close(); modalKind = ''; const restore = trigger; requestAnimationFrame(() => { if (restore?.isConnected && !restore.closest('[hidden]')) restore.focus(); else (view === 'editor' ? $('#main-export') : $('#home-new')).focus(); }); }
  function cancelDialog() { pending = null; downloadStarted = false; closeDialog(); }
  const head = title => `<div class="dialog-head"><h2 id="dialog-title">${title}</h2><button class="close" data-close aria-label="关闭对话框">×</button></div>`;
  const cancel = '<button type="button" id="cancel-dialog">取消</button>';
  function bindCancel() { $('#cancel-dialog')?.addEventListener('click', cancelDialog); }
  function resetDoc(doc, fromImport = false) { invalidateImages(); score = copy(doc); started = true; imported = fromImport; baseline = fromImport ? snapshot() : ''; handedOff = false; history = []; future = []; draft = false; page = 1; pngRange = 'all'; sideTab = 'song'; view = 'editor'; render(); }

  function requestAction(type, data = null) {
    closeMenu();
    if (draft) { showDraftBlock(); return; }
    // 先填写或预览，再在真正替换文档时保护；取消填写保留原文档及状态。
    if (type === 'new' && !data) {showNew(); return;}
    if (type === 'import' && !data) {showImport(); return;}
    if (dirty()) { pending = {type,data}; downloadStarted = false; showGuard(); return; }
    executeAction(type,data);
  }
  function executeAction(type,data) {
    pending = null; downloadStarted = false;
    if (type === 'new' && !data) { showNew(); return; }
    if (type === 'new') { resetDoc(data); closeDialog(); toast('已创建 4 空小节曲谱，请编辑后导出 JSON'); return; }
    if (type === 'import' && !data) { showImport(); return; }
    if (type === 'import') { resetDoc(data,true); closeDialog(); toast('已打开导入曲谱；修改前可恢复至原文件'); return; }
    if (type === 'home') { view = 'home'; started = false; baseline = ''; draft = false; closeDialog(); render(); }
    if (type === 'advanced') {const destination=$('.advanced-link').href;view='home';started=false;baseline='';draft=false;closeDialog();location.assign(destination);}
  }
  function showNew() {
    showDialog('new', `${head('新建曲谱')}<form id="new-form"><div class="dialog-body">
      <div class="field"><label for="new-title">曲名</label><input id="new-title" name="title" value="" placeholder="未命名曲谱" maxlength="128" autofocus></div>
      <div class="field-grid"><div class="field"><label for="new-author">编谱作者</label><input id="new-author" name="arranger" placeholder="选填" maxlength="64" autocomplete="off"></div>
      <div class="field"><label for="new-key">调性</label><select id="new-key">${Object.entries(tonalities).map(([mode,keys])=>`<optgroup label="${mode === 'major' ? '大调' : '小调'}">${keys.map(key=>`<option value="${key}">${keyLabel(key)}</option>`).join('')}</optgroup>`).join('')}</select></div></div>
      <div class="field-grid"><div class="field"><label for="new-meter">拍号</label><select id="new-meter"><option>4/4</option><option>3/4</option><option>6/8</option></select></div>
      <div class="field"><label for="new-tuning">调弦</label><select id="new-tuning"><option>标准调弦</option></select></div></div>
      </div><div class="dialog-footer">${cancel}<button type="submit" class="primary">创建曲谱</button></div></form>`);
    const tonality = () => {
      const key = $('#new-key').value;
      return {key,numberedKey:derivedNumbered(key),...(key.endsWith('m') ? {minorTonicDegree:6} : {})};
    };
    const form = $('#new-form');
    let composing = false;
    form.addEventListener('compositionstart',() => {composing = true;});
    form.addEventListener('compositionend',() => {composing = false;});
    form.addEventListener('keydown',e => {if (e.key === 'Enter' && (composing || e.isComposing || e.keyCode === 229)) e.preventDefault();});
    bindCancel(); form.onsubmit = e => { e.preventDefault(); if (composing) return; requestAction('new',{title:$('#new-title').value.trim() || '未命名曲谱',arranger:$('#new-author').value.trim(),meter:$('#new-meter').value,...tonality(),capo:0,bars:4,notes:[0,1,0,3],blank:true}); };
  }

  function showImport({candidate = null, error = '', filename = ''} = {}) {
    importGeneration++;
    importCandidate = candidate; importError = error; importFilename = filename;
    const data = candidate;
    showDialog('import', `${head('导入 JSON 曲谱')}<div class="dialog-body">
      <p class="dialog-intro">打开设备上的六线猫原生 JSON，继续编辑曲谱。</p><div class="dropzone" id="dropzone"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 23H4V11h9l3 3h12v9h-2M16 29V17m-5 5 5-5 5 5"/></svg><strong>拖拽 JSON 文件到这里</strong><p>.json / .lxm.json · 最大 10 MiB</p><label class="field-hint" for="import-file">选择本地 JSON 曲谱文件</label><input id="import-file" type="file" accept=".json,application/json"></div>
      <p class="field-hint">支持原生 v8 及 v4–v7 升级。MusicXML、MIDI 暂不支持。</p><div class="demo-line"><span>评审样例</span><button id="load-demo">载入有效文件</button><button id="load-error">载入错误文件</button></div>
      ${error ? `<div class="notice error" role="alert"><strong>无法打开此文件</strong><br>${escape(error)}<br>请重新选择正确文件，当前曲谱未被替换。</div>` : ''}
      ${data ? `<section class="file-preview" aria-label="待导入文件预览"><div class="file-preview-heading"><span class="file-icon">JSON</span><div><strong>${escape(filename || '风吹过山谷.lxm.json')}</strong><small>文件读取完成 · 校验通过（演示）</small></div></div><div class="preview-data"><div><span>曲名</span><b>${escape(data.title)}</b></div><div><span>编谱作者</span><b>${escape(data.arranger.trim() || '未填写')}</b></div><div><span>拍号</span><b>${escape(data.meter)}</b></div><div><span>数字1音高</span><b>${escape(data.numberedKey)}</b></div><div><span>最终调性</span><b>${escape(tonalitySummary(data))}</b></div><div><span>小节</span><b>${data.bars} 小节</b></div><div><span>调弦</span><b>标准调弦</b></div><div><span>轨道</span><b>单轨</b></div></div></section>` : ''}
      <p class="review-note">审稿说明：真实选择/拖拽只读取本目录的 sample-score.demo.json 演示结构，不表示支持产品 lxm-tab-score 协议或版本迁移。样例不可导入产品。打开前完成预览与替换保护。</p></div><div class="dialog-footer">${cancel}<button id="open-import" class="primary" ${data ? '' : 'disabled'}>打开曲谱</button></div>`);
    bindCancel();
    $('#load-demo').onclick = () => showImport({candidate:sample(),filename:'风吹过山谷.lxm.json'});
    $('#load-error').onclick = () => showImport({error:'文件内容不是有效的 JSON。请检查文件是否完整，或重新导出后重试。'});
    $('#open-import').onclick = () => { const doc = copy(importCandidate); requestAction('import',doc); };
    $('#import-file').onchange = e => readFile(e.target.files[0]);
    const zone = $('#dropzone');
    ['dragenter','dragover'].forEach(event => zone.addEventListener(event,e => { e.preventDefault(); zone.classList.add('drag'); }));
    ['dragleave','drop'].forEach(event => zone.addEventListener(event,e => { e.preventDefault(); zone.classList.remove('drag'); }));
    zone.addEventListener('drop',e => readFile(e.dataTransfer.files[0]));
  }
  async function readFile(file) {
    if (!file) return;
    const generation = ++importGeneration;
    if (!file.name.toLowerCase().endsWith('.json')) {showImport({error:'文件格式不支持。请选择 .json；MusicXML、MIDI 不在本期范围。'}); return;}
    if (file.size > 10 * 1024 * 1024) {showImport({error:'文件超过 10 MiB，请选择大小符合限制的原生 JSON。'}); return;}
    try {
      const text = await file.text();
      if (generation !== importGeneration || !modal.open || modalKind !== 'import') return;
      const data = JSON.parse(text);
      if (data.prototype !== 'REQ-048-DEMO-NOT-FOR-PRODUCT') throw new Error('schema');
      const d = data.score;
      if (!d || typeof d.title !== 'string' || d.title.length > 128 || !['4/4','3/4','6/8'].includes(d.meter) || typeof d.key !== 'string' || d.key.length > 4 || !Number.isInteger(d.bars) || d.bars < 1 || d.bars > 64 || !Number.isInteger(d.capo) || d.capo < 0 || d.capo > 12 || !Array.isArray(d.notes) || d.notes.length !== 4 || d.notes.some(n => !Number.isInteger(n) || n < 0 || n > 24)) throw new Error('schema');
      // 只归一化本原型的旧 C 大调演示样例，不推断产品旧文件。
      const numberedKey = d.numberedKey === undefined && d.key === 'C' ? 'C' : d.numberedKey;
      const arranger = d.arranger === undefined ? '' : d.arranger;
      const minor = d.key.endsWith('m'), degree = d.minorTonicDegree === undefined ? 6 : d.minorTonicDegree;
      if (!pitches.includes(numberedKey) || typeof arranger !== 'string' || arranger.length > 64 || /[\r\n\u2028\u2029]/.test(arranger) || (minor ? ![1,6].includes(degree) : d.minorTonicDegree !== undefined) || !matchesTonality(d.key,numberedKey,degree)) throw new Error('schema');
      showImport({candidate:{title:d.title,arranger,meter:d.meter,key:d.key,numberedKey,...(minor ? {minorTonicDegree:degree} : {}),capo:d.capo,bars:d.bars,notes:d.notes,blank:!!d.blank},filename:file.name});
    } catch (err) {if (generation !== importGeneration || !modal.open || modalKind !== 'import') return; showImport({error:err instanceof SyntaxError ? '文件内容不是有效的 JSON。请重新选择完整文件。' : '文件结构或版本不匹配。本原型只读取提供的演示样例，请重新选择；此结果不代表产品校验结论。'});}
  }

  function showDraftBlock() {
    pending = null;
    showDialog('draft',`${head('还有未应用的修改')}<div class="dialog-body"><p class="guard-copy">先返回歌曲面板处理，或放弃草稿。处理后请重新选择原操作。</p><div class="guard-details"><strong>${escape($('#draft-title').value || '未命名曲谱')}</strong><span>曲名草稿</span></div></div><div class="dialog-footer"><button id="draft-ignore">放弃草稿</button><button class="primary" id="draft-back">返回处理</button></div>`);
    $('#draft-back').onclick = () => {cancelDialog();sideTab='song';sidebarOpen=true;render();requestAnimationFrame(()=>$('#draft-title').focus());};
    $('#draft-ignore').onclick = () => {draft = false; closeDialog(); render(); toast('已放弃草稿，请重新选择操作');};
  }
  function applyDraft() {if(!draft)return;remember();score.title = $('#draft-title').value.trim() || '未命名曲谱';draft = false;render();toast('已应用曲名');}

  function showGuard(message = '', error = false) {
    const destination = actionName(pending.type);
    showDialog('guard',`${head('离开前导出曲谱？')}<div class="dialog-body"><p class="guard-copy">当前修改尚未导出为 JSON。导出后可继续编辑这份曲谱。</p><div class="guard-details"><strong>${escape(score.title)}</strong><span>正在${destination}</span></div>${message ? `<p class="guard-feedback ${error ? 'error' : ''}" role="status">${escape(message)}</p>` : ''}${downloadStarted ? '<div class="guard-feedback" role="status">已发起 JSON 下载。确认取得文件后继续。 <button class="link guard-retry" id="guard-redownload">重新下载</button></div>' : ''}</div><div class="dialog-footer guard-footer"><button id="guard-back" autofocus>继续编辑</button><button id="guard-discard" class="danger">不导出并继续</button>${downloadStarted ? '<button id="confirm-continue" class="primary">已下载，继续</button>' : '<button id="guard-download" class="primary">导出 JSON</button>'}</div>`);
    $('#guard-back').onclick = cancelDialog;
    $('#guard-discard').onclick = () => { const next = pending; closeDialog(); executeAction(next.type,next.data); };
    const downloadGuard = () => {
      const result = $('#download-result').value;
      downloadStarted = result === 'success';
      showGuard(result === 'success' ? '' : result === 'cancel' ? '下载已取消，曲谱已保留。' : '下载未能发起，请重试。曲谱已保留。', result !== 'success');
    };
    $('#guard-download')?.addEventListener('click',downloadGuard);
    $('#guard-redownload')?.addEventListener('click',downloadGuard);
    $('#confirm-continue')?.addEventListener('click',() => { const next = pending; baseline = snapshot(); handedOff = true; closeDialog(); executeAction(next.type,next.data); });
  }

  const pngSignature = () => `${snapshot()}|${pngRange}|${page}`;
  function showExport(type = 'json', message = '', isError = false) {
    if (draft) {showDraftBlock();return;}
    if (exportType !== type) {if(imageStage==='generating')invalidateImages();exportMessage='';}
    closeMenu(); exportType = type; exportMessage = message; exportError = isError;
    const json = type === 'json', png = type === 'png';
    if (imageStage === 'generated' && imageSignature !== pngSignature()) invalidateImages();
    const feedback = message ? `<p class="generation-message ${isError?'error':''}" role="status">${escape(message)}</p>` : '';
    const tabs = `<div class="format-tabs" role="tablist" aria-label="导出格式">${[['json','JSON'],['png','PNG 图片'],['print','打印']].map(([k,label])=>`<button role="tab" id="tab-${k}" aria-controls="export-panel" aria-selected="${type===k}" tabindex="${type===k?0:-1}" data-format="${k}">${label}</button>`).join('')}</div>`;
    const thumbs = `<nav class="page-thumbnails" aria-label="预览页面"><h3>页面 · 共 ${pages()} 页</h3>${Array.from({length:pages()},(_,i)=>`<button class="page-thumb" data-page="${i+1}" aria-pressed="${page===i+1}" aria-label="第 ${i+1} 页">${previewPages([i+1])}<span>第 ${i+1} 页</span></button>`).join('')}</nav>`;
    const generating = imageStage === 'generating', generated = imageStage === 'generated';
    const output = png ? `<div class="field"><label for="png-range">输出范围</label><select id="png-range" ${generating?'disabled':''}><option value="all" ${pngRange==='all'?'selected':''}>全部 ${pages()} 页</option><option value="current" ${pngRange==='current'?'selected':''}>当前页 · 第 ${page} 页</option></select></div><p class="output-size">2480 × 3508 像素 · 白底 PNG</p><input type="hidden" id="preview-page" value="${page}">${generating ? '<p class="generation-message" role="status">正在生成图片…</p><div class="generation-progress" aria-hidden="true"></div><button class="output-action" id="cancel-generation">取消生成</button>' : generated ? `<p class="generation-message" role="status">已生成 ${pngRange==='all'?pages():1} 页图片</p><button class="primary output-action" id="download-images">${pngRange==='all'&&pages()>1?'下载 ZIP 图片包':'下载 PNG'}</button><button class="output-action" id="do-export">重新生成</button>` : `<button class="primary output-action" id="do-export">${pngRange==='all'?'生成全部图片':'生成当前页'}</button>`}${feedback}<p class="output-hint">${pngRange==='all'&&pages()>1?'多页图片打包为 ZIP。':'当前页导出为 PNG。'}<br>JSON 留存，图片用于分享。</p>` : `<div class="field"><label for="print-paper">纸张</label><select id="print-paper"><option>A4 · 纵向</option></select></div><p class="output-size">共 ${pages()} 页 · 全部曲谱</p><button class="primary output-action" id="do-export">打开打印</button>${feedback}<p class="output-hint">在打印窗口选择打印机与页码。</p>`;
    showDialog('export',`${head(json?'导出曲谱':png?'A4 图片预览':'A4 打印预览')}${tabs}${json ? `<div id="export-panel" class="json-export-body" role="tabpanel" aria-labelledby="tab-json"><h3>导出可编辑曲谱</h3><p>保留音符与歌曲设置，下次导入后继续编辑。</p><div class="field"><label for="export-name">文件名</label><input id="export-name" value="${escape(filenameFor(score.title))}" readonly></div>${feedback}</div><div class="dialog-footer"><button id="export-close">关闭</button><button class="primary" id="do-export">导出 JSON</button></div>` : `<div id="export-panel" class="export-visual-layout" role="tabpanel" aria-labelledby="tab-${type}">${thumbs}<div class="visual-preview" id="export-preview">${previewPages([page])}</div><section class="output-settings"><h3>输出设置</h3>${output}<button id="export-close" class="quiet output-action">关闭预览</button></section></div>`}`,!json);
    $$('[data-format]',modal).forEach(b => {b.onclick = () => showExport(b.dataset.format);b.onkeydown = e => { if (['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) {e.preventDefault();const keys = ['json','png','print'],i=keys.indexOf(type),next=e.key==='Home'?0:e.key==='End'?2:(i+(e.key==='ArrowRight'?1:2))%3;showExport(keys[next]);$(`#tab-${keys[next]}`).focus();}};});
    $('#export-close').onclick = cancelDialog;
    $$('[data-page]',modal).forEach(b=>{b.disabled=generating;b.onclick=()=>{page=Number(b.dataset.page);invalidateImages();render();showExport(type);};});
    $('#png-range')?.addEventListener('change',e=>{pngRange=e.target.value;invalidateImages();showExport('png');});
    $('#cancel-generation')?.addEventListener('click',()=>{invalidateImages();showExport('png','已取消生成。');});
    $('#download-images')?.addEventListener('click',()=>{
      if(imageSignature!==pngSignature()){invalidateImages();showExport('png','内容已变更，请重新生成。');return;}
      const result=$('#download-result').value;
      showExport('png',result==='success'?'已发起图片下载。':result==='cancel'?'下载已取消，可再次下载。':'下载未能发起，请重试。',result==='fail');
    });
    $('#do-export')?.addEventListener('click',()=>{
      if(png){generateImages();return;}
      const result=$('#download-result').value;
      if(json && result==='success'){baseline=snapshot();handedOff=true;render();}
      showExport(type,result==='cancel'?(json?'下载已取消。':'已取消打印。'):result==='fail'?'任务未能发起，请重试。':json?'已发起 JSON 下载，请确认取得文件。':'已打开打印窗口（模拟）。',result==='fail');
    });
  }
  function generateImages() {
    imageStage='generating';const task=++generationToken, expected=pngSignature(), result=$('#generation-result').value;
    showExport('png');$('#cancel-generation')?.focus();
    generationTimer=setTimeout(()=>{
      if(task!==generationToken || !modal.open || modalKind!=='export' || exportType!=='png')return;
      if(expected!==pngSignature()){invalidateImages();showExport('png','内容已变更，请重新生成。');return;}
      imageStage=result==='success'?'generated':'ready';imageSignature=result==='success'?expected:'';
      showExport('png',result==='success'?'':result==='cancel'?'已取消生成。':'图片生成失败，请重试。',result==='fail');
      (result==='success'?$('#download-images'):$('#do-export'))?.focus();
    },1100);
  }
  function previewPages(list) {return list.map(p => `<div class="mini-paper"><h3>${escape(score.title)}</h3>${authorLine(score)}<p>${escape(tonalitySummary(score))}　${escape(score.meter)}</p>${svgScore(score,{preview:true,currentPage:p})}<div class="mini-page-caption">第 ${p} / ${pages()} 页</div></div>`).join('');}

  $('#home-new').onclick = () => requestAction('new');
  $('#home-import').onclick = () => requestAction('import');
  $('#brand-home').onclick = () => {if(view === 'editor') requestAction('home');};
  $('.advanced-link').onclick = e => {if(e.button===0&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey&&!e.altKey&&e.currentTarget.target!=='_blank'){e.preventDefault();requestAction('advanced');}};
  $('#main-export').onclick = () => {const open=$('#export-menu').hidden;closeMenu();$('#export-menu').hidden=!open;$('#main-export').setAttribute('aria-expanded',String(open));if(open)$('button',$('#export-menu')).focus();};
  $('#file-menu-trigger').onclick = () => { const open = $('#file-menu').hidden; closeMenu(); $('#file-menu').hidden = !open; $('#file-menu-trigger').setAttribute('aria-expanded',String(open)); if(open) $('button',$('#file-menu')).focus(); };
  $$('[data-file]').forEach(b => b.onclick = () => ['json','png','print'].includes(b.dataset.file) ? showExport(b.dataset.file) : requestAction(b.dataset.file));
  $('#edit-note').onclick = editNote;
  $('#add-measure').onclick = () => {if(view!=='editor')return;remember();score.bars++;render();$('#editor-status').textContent='已新增一小节';};
  $('#undo').onclick = () => {if(history.length){future.push(copy(score));score=history.pop();invalidateImages();render();toast('已撤销上一次谱面修改');}};
  $('#redo').onclick = () => {if(future.length){history.push(copy(score));score=future.pop();invalidateImages();render();toast('已重做上一次谱面修改');}};
  $('#history-undo').onclick = () => $('#undo').click();
  $('#toggle-history').onclick = () => {historyOpen=!historyOpen;render();};
  $('#toggle-sidebar').onclick = () => {sidebarOpen=!sidebarOpen;render();};
  function setSide(tab) {sideTab=tab;sidebarOpen=true;render();}
  $('#open-chords').onclick = () => setSide('chords');
  $$('[data-side]').forEach(b=>{b.onclick=()=>setSide(b.dataset.side);b.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const tabs=$$('[data-side]'),i=tabs.indexOf(b),next=e.key==='Home'?0:e.key==='End'?3:(i+(e.key==='ArrowRight'?1:3))%4;setSide(tabs[next].dataset.side);tabs[next].focus();}};});
  $('#zoom-out').onclick = () => {zoom=Math.max(75,zoom-25);render();};
  $('#zoom-in').onclick = () => {zoom=Math.min(175,zoom+25);render();};
  $('#zoom-reset').onclick = () => {zoom=125;render();toast('已恢复 125%');};
  $('#draft-title').oninput = e => {draft=e.target.value!==score.title;$('#apply-draft').disabled=$('#discard-draft').disabled=!draft;$('#draft-status').textContent=draft?'尚未应用':'修改后应用到曲谱';};
  $('#apply-draft').onclick = applyDraft;
  $('#discard-draft').onclick = () => {draft=false;render();toast('已放弃未应用的草稿');};
  document.addEventListener('click',e => {if(!e.target.closest('.file-menu-wrap,#main-export,#export-menu'))closeMenu();});
  document.addEventListener('keydown',e => {
    if (e.key === 'Escape' && !modal.open) {closeMenu();$('#file-menu-trigger').focus();}
    if (!$('#file-menu').hidden && ['ArrowDown','ArrowUp','Home','End'].includes(e.key)) {e.preventDefault();const buttons=$$('button',$('#file-menu')),i=buttons.indexOf(document.activeElement),next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowDown'?1:buttons.length-1))%buttons.length;buttons[next].focus();}
    if (!$('#export-menu').hidden && ['ArrowDown','ArrowUp','Home','End'].includes(e.key)) {e.preventDefault();const buttons=$$('button',$('#export-menu')),i=buttons.indexOf(document.activeElement),next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowDown'?1:buttons.length-1))%buttons.length;buttons[next].focus();}
    if (modal.open && e.key === 'Tab') {const elements = $$('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,a[href]',modal).filter(el => el.getClientRects().length),first=elements[0],last=elements.at(-1);if(e.shiftKey && document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey && document.activeElement===last){e.preventDefault();first.focus();}}
  });
  modal.addEventListener('cancel',e => {e.preventDefault();cancelDialog();});
  // 不以点击遮罩关闭保护；所有退出动作均有明确按钮。
  window.addEventListener('beforeunload',e => {if(view==='editor' && (dirty() || draft)){e.preventDefault();e.returnValue='';}});
  function scene(name) {
    importGeneration++;
    invalidateImages();exportType='json';historyOpen=false;zoom=125;sidebarOpen=window.innerWidth>720;
    clearTimeout(toastTimer); $('#toast').hidden = true; $('#editor-status').textContent = '就绪';
    if (modal.open) modal.close(); pending = null; downloadStarted = false; closeMenu();
    $$('[data-scene]').forEach(b=>b.setAttribute('aria-current',b.dataset.scene===name?'page':'false'));
    if (name==='home'){view='home';started=false;draft=false;render();return;}
    resetDoc(sample());
    if (name==='new')showNew();
    if (name==='import')showImport({candidate:sample(),filename:'风吹过山谷.lxm.json'});
    if (name==='error')showImport({error:'文件内容不是有效的 JSON。请检查文件是否完整，或重新导出后重试。'});
    if (name==='export')showExport();
    if (name==='png')showExport('png');
    if (name==='ready'){imageStage='generated';imageSignature=pngSignature();showExport('png');}
    if (name==='generate-error')showExport('png','图片生成失败，请重试。',true);
    if (name==='guard'){pending={type:'home',data:null};showGuard();}
    if (name==='draft'){baseline=snapshot();imported=true;draft=true;$('#draft-title').value=score.title+' · 练习版';render();showExport();}
  }
  $$('[data-scene]').forEach(b=>b.onclick=()=>{scene(b.dataset.scene);location.hash=b.dataset.scene;});
  const initial = location.hash.slice(1); scene(['home','editor','new','import','error','export','png','ready','generate-error','guard','draft'].includes(initial) ? initial : 'home');
})();
