/* 独立交互设计原型：固定演示数据，不连接曲谱引擎、存储或产品 API。 */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const scenes = [
    ['melody','简谱录入'],['lyrics','歌词映射'],['selection','音符选区'],['measure','小节结构'],
    ['chord','和弦指法'],['song','歌曲设置'],['empty','无选区'],['error','校验错误'],['export','导出检查'],['guard','和弦切换确认']
  ];
  const tabs = [['selection','target','选区'],['writing','music','简谱与歌词'],['chord','chord','和弦'],['song','settings','歌曲']];
  const state = {
    scene:'melody', tab:'writing', writing:'melody', selection:'note', target:0,
    melody:'5 6 7 1', lyric:'旋 律 随 风', melodyMode:'sequence', lyricMode:'sequence', verse:'1',
    melodyBase:'5 6 5 3', lyricBase:'旋 律 轻 响', dirty:true, dirtyType:'melody',
    duration:'1/8', dots:'0', chord:'C', chordFrets:['x','3','2','0','1','0'],
    chordFingers:['0','3','2','0','1','0'], chordDirty:false, showPopover:false,
    empty:false, error:false, applied:false,
    melodyBases:['5 6 5 3','2 3 2 1'], pending:null, undo:null, otherDirty:false, rhythmDirty:false,
    songTitle:'风吹过山谷', author:'六线猫', tonality:'C', capo:'2', time:'4/4'
  };
  let toastTimer;
  function toast(text) {
    $('#toast').textContent=text; $('#toast').hidden=false;
    clearTimeout(toastTimer); toastTimer=setTimeout(() => { $('#toast').hidden=true; },3400);
    $('#status-feedback').textContent=text;
  }
  let fieldId=0;
  function field(label,content,hint='') {
    let id=content.match(/\bid="([^"]+)"/)?.[1];
    if(!id){id=`field-${++fieldId}`;content=content.replace(/<(input|select|textarea)/,`<$1 id="${id}"`);}
    content=content.replace(/aria-label="[^"]*"/,`aria-label="${esc(label)}"`);
    return `<div class="field">${label?`<label for="${id}">${label}</label>`:''}${content}${hint?`<small>${hint}</small>`:''}</div>`;
  }
  function select(id,values,value,attr='') { return `<select id="${id}" name="${id}" aria-label="${id==='verse'?'歌词段号':id}" ${attr}>${values.map(v=>{const a=Array.isArray(v)?v:[v,v];return `<option value="${esc(a[0])}" ${String(a[0])===String(value)?'selected':''}>${esc(a[1])}</option>`;}).join('')}</select>`; }
  function disclosure(title,summary,body,open=false) {return `<details class="disclosure" ${open?'open':''}><summary>${title}<span>${esc(summary)}</span></summary><div class="disclosure-content">${body}</div></details>`;}
  function segmented(name,items,value) {return `<div class="segmented" role="group" aria-label="${name==='melodyMode'?'简谱录入方式':'歌词录入方式'}">${items.map(([v,t])=>`<button data-mode="${name}" data-value="${v}" aria-pressed="${v===value}">${t}</button>`).join('')}</div>`;}
  function tokens() {return state.melody.trim().split(/\s+/).filter(Boolean);}
  function validMelody() {return tokens().length>0&&tokens().every(t=>/^[#b♯♭]?[0-7](?:\+[0-7])*(?:['.,]*)$/.test(t));}
  function currentType() {return state.tab==='writing'?state.writing:state.tab;}
  function isDirty() {return state.tab==='writing'?state.dirty:(state.tab==='chord'?state.chordDirty:state.otherDirty);}
  function hasPending() {return isDirty()||state.rhythmDirty;}
  function currentPosition() {return state.target===0?'第 2 小节 · 第 1 拍':'第 3 小节 · 第 1 拍';}
  function discardWriting() {
    state.melody=state.melodyBase;state.lyric=state.lyricBase;
    state.duration='1/8';state.dots='0';state.dirty=false;state.rhythmDirty=false;state.error=false;
  }
  function context() {
    let title,sub,tag='';
    if(state.empty){ title='还没有选择编辑对象';sub='选择谱面位置后，在这里查看和编辑'; }
    else if(state.tab==='writing'){title=state.writing==='melody'?'简谱事件':'歌词';sub=`${currentPosition()}${state.writing==='lyrics'?` · 第 ${state.verse} 段`:''}`;tag=state.writing==='melody'?'独立简谱':'跟随简谱';}
    else if(state.tab==='selection'){title={note:'六线谱音符',measure:'小节',tuplet:'连音组'}[state.selection];sub=state.selection==='measure'?'第 2 小节 · 作用到下一变化点':'第 2 小节 · 第 1 拍 · 第 2 弦';tag=state.selection==='note'?'TAB':'';}
    else if(state.tab==='chord'){title='和弦与指法';sub='第 2 小节 · 第 1 拍';tag='TAB 拍点';}
    else{title='歌曲设置';sub='作用于整首曲谱';tag='全曲';}
    $('#object-context').innerHTML=`<div class="context-top"><strong>${title}</strong>${!state.empty&&state.tab!=='song'?`<button class="link-button" data-action="locate">${icon('target')}定位谱面</button>`:''}</div><div class="context-bottom">${esc(sub)}${tag?`<span class="context-pill">${tag}</span>`:''}</div>`;
    $('#status-location').textContent=state.empty?'尚未选择编辑对象':`${title} / ${sub.replaceAll(' · ',' / ')}`;
  }
  function renderPreview() {
    if(state.writing==='lyrics') {
      const words=state.lyricMode==='single'?[state.lyric]:state.lyric.trim().split(/\s+/).filter(Boolean);
      const notes=state.melodyBases[state.target].split(/\s+/);
      return `<div class="preview"><div class="preview-heading"><strong>字词与音符对齐</strong><span class="tag">第 ${state.verse} 段</span></div><div class="beat-map lyric-map" style="grid-template-columns:repeat(${Math.min(Math.max(words.length,1),6)},1fr)">${words.slice(0,6).map((w,i)=>`<div class="beat-slot"><div class="lyric-slot">${w==='_'?'留空':esc(w)}<small>${esc(notes[i]||'—')}</small></div><span class="beat-label">${i+1}</span></div>`).join('')}</div><div class="preview-summary"><span>${words.filter(w=>w!=='_').length} 个字词${words.length>6?'，此处显示前 6 个':''}</span><span>跳过休止</span></div></div>`;
    }
    const parts=tokens();
    if(!validMelody())return `<div class="preview"><div class="preview-heading"><strong>音符预览</strong><span>等待有效内容</span></div><p class="help">输入有效音符后，将显示节拍位置和影响范围。</p></div>`;
    const names={'1/2':'二分音符','1/4':'四分音符','1/8':'八分音符','1/16':'十六分音符'};
    const step=4*Number(state.duration.split('/')[0])/Number(state.duration.split('/')[1])*(state.dots==='1'?1.5:state.dots==='2'?1.75:1);
    const labelAt=(i)=>{const at=i*step;return Number.isInteger(at)?`${at+1} 拍`:at%1===.5?'后半拍':`${Math.floor(at)+1} 拍 + ${at%1}`;};
    return `<div class="preview"><div class="preview-heading"><strong>应用后的简谱</strong><span class="tag">${names[state.duration]}${state.dots!=='0'?' · 附点':''}</span></div><div class="beat-map" style="grid-template-columns:repeat(${Math.min(parts.length,6)},1fr)">${parts.slice(0,6).map((n,i)=>`<div class="beat-slot"><span class="music-number">${esc(n)}</span><span class="beat-label">${labelAt(i)}</span></div>`).join('')}</div><div class="preview-summary"><span>替换 ${parts.length} 个音符${parts.length>6?'，显示前 6 个':''}</span><span>第 ${state.target===0?'2':'3'} 小节 · ${parts.length*step} 拍时长</span></div></div>`;
  }
  function writingPanel() {
    let body=`<div class="sub-tabs" role="group" aria-label="简谱或歌词"><button data-writing="melody" aria-pressed="${state.writing==='melody'}">简谱</button><button data-writing="lyrics" aria-pressed="${state.writing==='lyrics'}">歌词</button></div>`;
    if(state.writing==='lyrics')return body+lyricsPanel();
    body+=`<div class="mode-row"><label>录入方式</label>${segmented('melodyMode',[['sequence','连续录入'],['single','单音组']],state.melodyMode)}</div>`;
    if(state.error)body+=`<div class="error-summary" id="error-summary" tabindex="-1" role="alert"><strong>简谱内容需要修改</strong><br><a href="#melody-input">“9”不是有效音符，使用 0–7。</a></div>`;
    body+=`<div class="field"><label for="melody-input">${state.melodyMode==='sequence'?'音符内容':'同一时刻的音符'}</label><input class="music-input ${state.error?'input-invalid':''}" id="melody-input" data-bind="melody" value="${esc(state.melody)}" aria-invalid="${state.error}" ${state.error?'aria-describedby="melody-error"':'aria-describedby="melody-help"'} autocomplete="off" spellcheck="false">${state.error?'<small class="field-error" id="melody-error">请将 9 改为有效音符，例如 7。</small>':'<small id="melody-help">空格分隔先后音；+ 连接同时发声的音。</small>'}</div><div id="live-preview">${renderPreview()}</div>`;
    const rhythm=`<div class="field-row">${field('录入时值',select('duration',[['1/2','二分音符'],['1/4','四分音符'],['1/8','八分音符'],['1/16','十六分音符']],state.duration))}${field('附点',select('dots',[['0','无附点'],['1','单附点'],['2','双附点']],state.dots))}</div>${field('节奏模板',select('rhythm-template',['自选时值','前八后十六','前十六后八','三连音','自定义成员时值'],'自选时值'))}<label class="check-field"><input type="checkbox" id="overwrite" checked>替换范围内已有简谱</label><p class="help">当前替换第 2 小节前两拍的 4 个简谱音符。正文与时值分别应用。</p><button class="secondary small" style="margin-top:10px" data-action="apply-rhythm">应用时值</button>`;
    body+=disclosure('节奏与范围','八分音符 · 2 拍',rhythm);
    body+=disclosure('音高与连接','升降、八度、延音线',`<div class="field-row">${field('选择音符',select('pitch-member',['第 1 个音符','第 2 个音符','第 3 个音符'],'第 1 个音符'))}${field('八度',select('octave',['本位','高八度','低八度'],'本位'))}</div><div class="field-row">${field('音高',select('pitch',['1','2','3','4','5','6','7'],'5'))}${field('变音',select('accidental',['无','升号','降号','还原号'],'无'))}</div><button class="secondary small" data-action="apply-pitch">应用单个音高</button><div class="inline-note">${icon('info')}单个音高独立应用。正文有修改时，请先处理正文。</div><div class="compact-actions"><button class="secondary" data-action="connection">设置延音线</button><button class="secondary" data-action="connection">设置连音线</button></div>`);
    body+=disclosure('复制与粘贴','按简谱范围复用',`<p class="help">复制独立简谱时间范围，可选择覆盖或插入；不复制 TAB。</p><div class="copy-range" style="margin-top:10px">${field('开始',select('copy-from',['第 2 小节 · 第 1 拍','第 2 小节 · 第 2 拍'],'第 2 小节 · 第 1 拍'))}${field('结束',select('copy-to',['第 2 小节 · 第 2 拍','第 2 小节 · 第 4 拍'],'第 2 小节 · 第 2 拍'))}</div><div class="compact-actions"><button class="secondary" data-action="copy">复制简谱范围</button><button class="secondary" data-action="paste">粘贴范围…</button></div>`);
    body+=disclosure('移除当前事件','同时移除附着歌词',`<p class="help">普通简谱事件删除后，其附着歌词也会删除。连音成员清空时保留时值与歌词。</p><button class="danger-button" data-action="delete">${icon('bin')}删除当前简谱事件…</button>`);
    return body;
  }
  function lyricsPanel() {
    return `<div class="mode-row"><label for="verse">歌词段号</label><div style="width:185px">${select('verse',[['1','第 1 段'],['2','第 2 段'],['3','第 3 段'],['4','第 4 段']],state.verse)}</div></div><div class="mode-row"><label>填写方式</label>${segmented('lyricMode',[['single','单个位置'],['sequence','连续填词']],state.lyricMode)}</div><div class="field"><label for="lyric-input">${state.lyricMode==='single'?'当前歌词':'歌词内容'}</label><textarea id="lyric-input" data-bind="lyric" aria-describedby="lyric-help" rows="2">${esc(state.lyric)}</textarea><small id="lyric-help">空格分词；_ 保留一个位置。歌词按简谱音符对齐。</small></div><div id="live-preview">${renderPreview()}</div>${disclosure('覆盖与逐项预览','4 个字词 · 第 1 段',`<label class="check-field"><input type="checkbox" checked>替换已有歌词</label><p class="help">本例将「旋 / 律 / 轻 / 响」替换为「旋 / 律 / 随 / 风」。点击谱面同一音符，可在气泡继续编辑。</p><div class="reference-list"><button class="secondary small" data-action="locate">查看第一个字</button><button class="secondary small" data-action="mapping">查看完整映射</button></div>`)}${disclosure('连续填词规则','空格、留空与休止',`<p class="help">空格将输入分成多个字词，_ 跳过一个可填写位置。自动跳过休止，超出谱尾时整批不应用。每项最多 64 字，每批最多 256 个位置。第 1–4 段分别编辑。</p>`)}${disclosure('移除歌词','只影响当前段号',`<p class="help">先切换至单个位置，再删除当前歌词。删除歌词不会删除简谱。</p><button class="danger-button" data-action="delete-lyric">${icon('bin')}删除当前歌词…</button>`)}`;
  }
  function selectionPanel() {
    const subtabs=`<div class="sub-tabs" role="group" aria-label="选区详情">${[['note','音符'],['measure','小节'],['tuplet','连音']].map(([v,t])=>`<button data-selection="${v}" aria-pressed="${state.selection===v}">${t}</button>`).join('')}</div>`;
    if(state.selection==='measure')return subtabs+`<div class="section-block"><div class="section-heading"><h2>小节拍号</h2><span>局部设置</span></div>${field('从第 2 小节开始',select('measure-time',['4/4','3/4','6/8','2/4'],'4/4'),'持续至下一个拍号变化点。')}</div><div class="section-block"><div class="section-heading"><h2>段落标记</h2><span>当前位置</span></div>${field('段落名称','<input data-mark-dirty placeholder="例如：主歌、副歌" value="主歌" aria-label="段落名称">','段落名称是小节标记，不会新增歌词或简谱行。')}</div>${disclosure('小节线与反复','右边界：单线',`${field('右侧小节线',select('barline',['单线','双线','终止','开始反复','结束反复','双向反复'],'单线'))}<p class="help">谱尾不能设置开始反复或双向反复；谱首反复仅在首小节提供。</p>`)}${disclosure('复制小节范围','谱层与插入位置',`<div class="copy-range">${field('起始小节','<input type="number" min="1" value="2" aria-label="起始小节">')}${field('结束小节','<input type="number" min="1" value="3" aria-label="结束小节">')}</div>${field('插入到',select('insert-at',['第 4 小节之前','曲谱末尾'],'第 4 小节之前'))}<button class="secondary small" data-action="copy-measures">预览复制影响</button>`)}`;
    if(state.selection==='tuplet')return subtabs+`<div class="detail-stat"><span class="stat-large">3:2</span><div><strong>三个音符，占两个音符的时间</strong><small>第 2 小节 · 连续 3 个拍点</small></div></div>${field('连音比例',select('tuplet-ratio',['3:2','5:4','6:4','7:4','9:8','10:8'],'3:2'))}<div class="inline-note">${icon('info')}成员须在同一小节内，且时值、附点相同；不支持跨小节、重叠或嵌套。</div><button class="secondary small" data-action="tuplet-apply">应用连音比例</button><button class="danger-button" data-action="remove-tuplet">${icon('bin')}移除连音组</button>`;
    return subtabs+`<div class="detail-stat"><span class="stat-large">3</span><div><strong>第 2 弦 · 第 3 品</strong><small>当前选中 1 个 TAB 音符</small></div></div><div class="section-block"><div class="section-heading"><h2>时值</h2><span>单拍选区</span></div><div class="duration-picker" role="group" aria-label="音符时值">${[['1/2','𝅗𝅥'],['1/4','♩'],['1/8','♪'],['1/16','♬']].map(([v,t])=>`<button data-duration="${v}" aria-label="${v} 时值" aria-pressed="${state.duration===v}">${t}</button>`).join('')}</div><div style="margin-top:12px">${field('附点',select('note-dots',[['0','无附点'],['1','单附点'],['2','双附点']],state.dots))}</div></div><div class="section-block"><div class="section-heading"><h2>音符状态</h2></div><div class="compact-actions"><button class="secondary" data-action="mute">设为闷音 x</button><button class="secondary" data-action="rest">设为整拍休止…</button></div><p class="help" style="margin-top:9px">闷音只影响所选弦；休止会清空整拍全部弦音符。</p></div>${disclosure('演奏技巧','快捷工具与当前记号',`<p class="help">使用顶栏技巧工具添加击弦、勾弦、滑音、延音等记号。侧栏展示目标、参数与影响。</p><button class="secondary small" style="margin-top:9px" data-action="techniques">查看技巧参数</button>`)}<button class="danger-button" style="margin-top:13px" data-action="delete-note">${icon('bin')}删除所选弦音符</button>`;
  }
  const presets={C:['x','3','2','0','1','0'],G:['3','2','0','0','0','3'],Am:['x','0','2','2','1','0'],F:['1','3','3','2','1','1'],Dm:['x','x','0','2','3','1'],Em:['0','2','2','0','0','0']};
  function chordSvg(name='C',large=false) {
    const frets=presets[name]||state.chordFrets;
    return `<svg class="chord-diagram" viewBox="0 0 100 122" aria-label="${esc(name)} 和弦指法预览" role="img"><g stroke="#59667b" stroke-width=".9">${Array.from({length:6},(_,i)=>`<path d="M${20+i*12} 28v76"/>`).join('')}${Array.from({length:5},(_,i)=>`<path d="M20 ${28+i*19}h60" stroke-width="${i===0?3:1}"/>`).join('')}</g>${frets.map((f,i)=>f==='x'?`<text x="${20+i*12}" y="17" text-anchor="middle" style="font:12px Arial;fill:#626e82;stroke:none">×</text>`:f==='0'?`<circle cx="${20+i*12}" cy="13" r="3" fill="none" stroke="#626e82"/>`:`<circle cx="${20+i*12}" cy="${28+(Number(f)-.5)*19}" r="5" fill="${large?'#285be0':'#202838'}" stroke="none"/>`).join('')}</svg>`;
  }
  function chordPanel() {
    return `<div class="chord-hero"><div class="chord-name">${esc(state.chord)}<small>标准调弦　E A D G B E</small></div><div id="chord-preview">${chordSvg(state.chord,true)}</div></div>${field('和弦名称',`<input id="chord-name" data-bind="chord" value="${esc(state.chord)}" autocomplete="off">`)}<div class="section-heading"><h3>常用指法</h3><span>标准调弦可用</span></div><div class="preset-row">${Object.keys(presets).map(n=>`<button data-chord="${n}" aria-pressed="${state.chord===n}">${n}</button>`).join('')}</div>${disclosure('六弦指法','禁奏 / 空弦 / 品位',`<div class="string-row string-head"><span>弦</span><span>品位</span><span>手指</span></div>${[6,5,4,3,2,1].map((n,i)=>`<div class="string-row"><span>第 ${n} 弦</span>${select(`fret-${i}`,[['x','× 禁奏'],['0','○ 空弦'],...Array.from({length:24},(_,j)=>[String(j+1),`${j+1} 品`])],state.chordFrets[i])}${select(`finger-${i}`,[['0','未指定'],['1','食指'],['2','中指'],['3','无名指'],['4','小指']],state.chordFingers[i],['0','x'].includes(state.chordFrets[i])?'disabled':'')}</div>`).join('')}`,true)}${disclosure('横按与显示范围','最多 4 组横按',`<p class="help">横按可设置品位、起止弦和手指；显示范围只移动观察窗口，不会转调。</p><button class="secondary small" style="margin-top:9px" data-action="barre">${icon('plus')}添加横按</button><div class="field-row" style="margin-top:12px">${field('起始品位','<input type="number" min="1" max="20" value="1" aria-label="起始品位">')}${field('显示品格',select('fret-count',['3','4','5'],'4'))}</div>`)}${disclosure('移除和弦','名称与指法可分别保留',`<div class="compact-actions"><button class="secondary" data-action="clear-diagram">仅清除指法图</button><button class="secondary" data-action="delete-chord">移除和弦…</button></div>`)}`;
  }
  function songPanel() {
    return `<div class="section-block"><div class="section-heading"><h2>曲谱信息</h2><span>整首曲谱</span></div>${field('歌曲名称',`<input id="song-title" data-bind="songTitle" value="${esc(state.songTitle)}">`)}${field('编谱作者',`<input data-bind="author" value="${esc(state.author)}" aria-label="编谱作者">`)}${field('调性',select('tonality',['C','D','E','F','G','A','B'],state.tonality))}<button class="secondary small" data-action="apply-info">应用曲谱信息</button></div><div class="section-block"><div class="section-heading"><h2>演奏设置</h2></div><div class="field-row">${field('基础拍号',select('song-time',['4/4','3/4','6/8','2/4'],state.time))}${field('变调夹',select('capo',Array.from({length:13},(_,i)=>[String(i),i===0?'不使用':`${i} 品`]),state.capo))}</div><p class="help">基础拍号作用于谱首，持续至下一个拍号变化点。当前小节的段落、拍号和反复在「选区 → 小节」编辑。</p><div class="reference-list"><button class="secondary small" data-action="apply-time">应用基础拍号</button><button class="secondary small" data-action="apply-capo">应用变调夹</button></div></div><button class="link-button" data-action="measure">编辑当前小节</button>`;
  }
  function emptyPanel() {
    return `<div class="empty-state"><div class="empty-illustration"><svg viewBox="0 0 110 70" aria-hidden="true"><path d="M8 18h94M8 28h94M8 38h94M8 48h94M8 58h94" stroke="#ced8e8"/><rect x="36" y="12" width="28" height="51" rx="5" fill="#edf3ff" stroke="#9cb5e8" stroke-dasharray="3 3"/><path d="M50 28v20m-10-10h20" stroke="#285be0"/></svg></div><h2>从谱面上的一个位置开始</h2><p>点击音符、简谱、歌词或和弦，<br>这里会显示对应的编辑内容。</p><button class="primary small" data-action="example">选择一个示例音符</button><div class="empty-options"><button data-action="add-melody"><span>${icon('music')}在当前位置录入简谱</span>${icon('chevron')}</button><button data-action="add-lyric"><span>${icon('file')}为简谱填写歌词</span>${icon('chevron')}</button><button data-action="song"><span>${icon('settings')}查看歌曲设置</span>${icon('chevron')}</button></div></div>`;
  }
  function updateToolbarDots() {
    const enabled=!state.empty&&((state.tab==='selection'&&state.selection==='note')||(state.tab==='writing'&&state.writing==='melody'&&!hasPending()));
    document.querySelectorAll('[data-dots]').forEach(button=>{
      button.disabled=!enabled;
      button.setAttribute('aria-pressed',String(enabled&&button.dataset.dots===state.dots));
      button.title=!enabled?'请先选择可编辑音符，并处理未应用输入。':`${button.dataset.dots==='1'?'单附点：原时值的 1.5 倍':'双附点：原时值的 1.75 倍'}；再次点击取消附点`;
    });
  }
  function updateFooter() {
    updateToolbarDots();
    const dirty=isDirty(),type=currentType();let summary,button;
    if(state.empty){$('#apply-bar').innerHTML=`<div class="apply-summary">${icon('info')}还没有修改曲谱</div><p class="help">选择对象后，操作与影响范围会显示在这里。</p>`;return;}
    if(state.tab==='selection'){summary=state.selection==='measure'?'小节设置分别应用；复制前先查看影响':'快捷操作直接作用于选区，可使用撤销';button=state.selection==='measure'?'应用小节设置':null;}
    else if(state.tab==='song'){summary=dirty?'曲谱设置有未应用修改':'各项设置独立应用，范围始终是整首曲谱';button=null;}
    else if(type==='chord'){summary=dirty?'未应用：和弦名称与指法':'和弦名称与指法将作为一次修改应用';button='应用和弦';}
    else if(type==='lyrics'){summary=dirty?`未应用：第 ${state.verse} 段歌词`:'歌词已与曲谱一致';button='应用歌词';}
    else{summary=state.error?'简谱内容需要修改后才能应用':dirty?`未应用：替换 ${tokens().length} 个简谱音符`:'简谱内容已与曲谱一致';button='应用简谱内容';}
    if(state.applied&&!dirty)summary='已应用到曲谱，可使用撤销';
    if(state.rhythmDirty)summary=dirty?'简谱内容与时值均未应用，需分别处理':'时值未应用，请在「节奏与范围」中处理';
    $('#apply-bar').innerHTML=`<div class="apply-summary ${dirty?'pending':state.applied?'done':''}">${dirty?'<span class="focus-dot" style="background:var(--amber)"></span>':icon(state.applied?'check':'info')}${esc(summary)}</div><div class="apply-buttons">${dirty?'<button class="quiet" data-action="restore">恢复本次修改</button>':'<span class="help">'+(state.tab==='writing'?'修改后在此应用':'')+'</span>'}${button?`<button class="primary" data-action="apply" ${state.error||(!dirty&&state.tab!=='selection')?'disabled':''}>${button}${state.tab==='writing'?'<span class="keyboard-hint">⌘ ↵</span>':''}</button>`:''}</div>`;
    if(state.tab==='writing')$('#apply-bar').insertAdjacentHTML('beforeend','<p class="leave-hint">应用后写入曲谱；切换位置、模式或段号会放弃未应用内容。</p>');
  }
  function render() {
    $('#scenes').innerHTML=scenes.map(([id,title])=>`<button data-scene="${id}" aria-pressed="${state.scene===id}">${title}</button>`).join('');
    $('#primary-tabs').innerHTML=tabs.map(([id,ic,title])=>`<button role="tab" id="tab-${id}" data-tab="${id}" aria-selected="${state.tab===id}" aria-controls="panel-body" tabindex="${state.tab===id?'0':'-1'}">${icon(ic)}${title}</button>`).join('');
    $('#panel-body').setAttribute('aria-labelledby',`tab-${state.tab}`);
    context();
    $('#panel-body').innerHTML=state.empty?emptyPanel():state.tab==='writing'?writingPanel():state.tab==='selection'?selectionPanel():state.tab==='chord'?chordPanel():songPanel();
    updateFooter();renderScore();renderPopover();
  }
  function renderScore() {
    const phrase=state.lyricBase.trim().split(/\s+/);
    const active=!state.empty&&state.tab!=='song';
    let svg=`<svg class="score-svg" viewBox="0 0 650 960" xmlns="http://www.w3.org/2000/svg" aria-label="风吹过山谷演示谱面"><g fill="none" stroke="#202838" stroke-width=".85">`;
    [0,1,2].forEach(row=>{const y=140+row*280;for(let i=0;i<6;i++)svg+=`<path d="M15 ${y+i*13}h620"/>`;[15,195,410,635].forEach(x=>{svg+=`<path d="M${x} ${y}v65"/>`;});});
    svg+='</g>';
    [0,1,2].forEach(row=>{
      const y=140+row*280;
      svg+=`<text x="17" y="${y-15}" style="font:10px Arial;fill:#7b879a">${row*3+1}</text><text x="197" y="${y-15}" style="font:10px Arial;fill:#7b879a">${row*3+2}</text><text x="412" y="${y-15}" style="font:10px Arial;fill:#7b879a">${row*3+3}</text>`;
      ['T','A','B'].forEach((l,i)=>svg+=`<text x="20" y="${y+18+i*19}" style="font:15px Georgia">${l}</text>`);
      const fretNotes=[1,3,0,3,3,5,7,8,10,10,8,0];
      fretNotes.forEach((n,i)=>{const x=57+i*49;const sy=y+(i%4===0?13:i%3===0?39:0);svg+=`<text x="${x}" y="${sy+4}" text-anchor="middle" class="guitar-fret">${row===1?[3,5,3,0,1,3,0,1,3,1,0,1][i]:n}</text><path d="M${x} ${sy+8}v${y+92-sy-8}" stroke="#202838" stroke-width=".9"/>`;});
      const sequence=['1','2','3','5',...state.melodyBases[0].trim().split(/\s+/),...state.melodyBases[1].trim().split(/\s+/)];
      sequence.forEach((n,i)=>{
        const x=57+i*49,measure=row*3+Math.floor(i/4)+1;
        const selected=row===0&&active&&state.tab==='writing'&&state.writing==='melody'&&(state.target===0?i>=4&&i<=7:i>=8);
        const interactive=row===0&&i>=4;
        svg+=`<g class="${interactive?'score-object':''} ${selected?'active-note':''}" ${interactive?`role="button" tabindex="0" data-score="melody" data-target="${i>=8?'1':'0'}" aria-label="编辑第 ${measure} 小节简谱 ${esc(n)}"`:''}><rect x="${x-16}" y="${y+108}" width="32" height="36" rx="5" fill="${selected?'#edf3ff':'transparent'}" stroke="${selected?'#285be0':'transparent'}"/><text x="${x}" y="${y+132}" text-anchor="middle" class="score-digit">${esc(n)}</text><path d="M${x-9} ${y+138}h18" stroke="${selected?'#285be0':'#202838'}" stroke-width="1.1"/></g>`;
        const lyric=i>=4&&i<=7?phrase[i-4]||'_':['轻','轻','唱','起','旋','律','随','风','慢','慢','升','起'][i];
        const lyricSelected=row===0&&i>=4&&i<=7&&active&&state.tab==='writing'&&state.writing==='lyrics';
        svg+=`<g class="${row===0&&i>=4&&i<=7?'score-object':''} ${lyricSelected?'active-note':''}" ${row===0&&i>=4&&i<=7?`role="button" tabindex="0" data-score="lyrics" data-target="0" aria-label="编辑歌词 ${esc(lyric)}"`:''}><rect x="${x-16}" y="${y+149}" width="32" height="27" rx="4" fill="transparent" stroke="transparent"/><text x="${x}" y="${y+168}" text-anchor="middle" class="lyric-text">${esc(lyric==='_'?'':lyric)}</text></g>`;
      });
      ['C',row===1?'F':'G','Am'].forEach((ch,i)=>{const x=[52,247,462][i];svg+=`<g class="score-object" role="button" tabindex="0" data-score="chord" data-chord-score="${ch}" aria-label="编辑 ${ch} 和弦"><rect x="${x-14}" y="${y-102}" width="76" height="92" rx="5" fill="transparent"/><text x="${x+20}" y="${y-91}" text-anchor="middle" style="font:13px Georgia">${ch}</text><g transform="translate(${x-10},${y-88}) scale(.63)">${chordSvg(ch).replace(/<svg[^>]*>|<\/svg>/g,'')}</g></g>`;});
    });
    svg+='</svg>';$('#score').innerHTML=svg;
  }
  function renderPopover() {
    const show=state.showPopover&&state.tab==='writing'&&!state.empty&&!$('#inspector').hidden;
    $('#popover').hidden=!show;
    if(!show)return;
    const lyric=state.writing==='lyrics';
    $('#popover').innerHTML=`<div class="popover-head"><strong>${lyric?'填写歌词':'录入简谱'}</strong><span>${currentPosition()}</span><button class="icon-button" data-action="close-popover" aria-label="收起气泡">${icon('close')}</button></div><div class="popover-line"><input aria-label="${lyric?'气泡歌词内容':'气泡简谱内容'}" data-bind="${lyric?'lyric':'melody'}" value="${esc(lyric?state.lyric:state.melody)}"><button class="primary small" data-action="apply">应用</button></div><div class="popover-foot"><span>与编辑台共用本次修改</span><button class="link-button" data-action="focus-editor">完整属性</button></div>`;
    const anchor=document.querySelector(`[data-score="${lyric?'lyrics':'melody'}"][data-target="${state.target}"]`),stage=$('.score-stage');
    if(anchor?.getBoundingClientRect&&stage?.getBoundingClientRect){
      const a=anchor.getBoundingClientRect(),s=stage.getBoundingClientRect(),pop=$('#popover');
      pop.style.left=`${Math.max(16,Math.min(a.left-s.left+stage.scrollLeft-12,stage.clientWidth-300))}px`;
      pop.style.top=`${Math.max(16,a.top-s.top+stage.scrollTop-pop.offsetHeight-12)}px`;
    }
  }
  function navigate(tab,writing,skip=false) {
    const changes=tab!==state.tab||(writing&&writing!==state.writing);
    if(!changes&&!state.empty)return;
    if(!skip&&hasPending()&&state.tab!=='writing'){showGuard({kind:'navigate',tab,writing});return;}
    if(state.tab==='writing')discardWriting();
    state.tab=tab;if(writing)state.writing=writing;state.empty=false;state.error=false;state.showPopover=false;state.applied=false;state.dirty=false;state.chordDirty=false;state.otherDirty=false;state.rhythmDirty=false;
    render();$('#panel-body').scrollTop=0;
  }
  function showGuard(pending) {
    state.pending=pending;
    const multi=state.rhythmDirty||state.tab==='song';
    const type=currentType(),title={melody:'简谱',lyrics:'歌词',chord:'和弦',song:'歌曲设置',selection:'小节设置'}[type];
    const value=type==='lyrics'?state.lyric:type==='chord'?state.chord:type==='song'?state.songTitle:state.melody;
    $('#guard-dialog').innerHTML=`<h2 id="guard-title">${pending.kind==='export'?'当前输入尚未应用':'先处理当前修改，再切换'}</h2><p>${pending.kind==='export'?'导出只包含已应用的曲谱。返回当前编辑，应用或放弃后再发起导出。':multi?'设置需要分别应用，返回处理或明确放弃。':'当前和弦尚未写入曲谱。请选择如何处理本次修改。'}</p><div class="guard-object"><strong>${title} / ${type==='song'?'整首曲谱':currentPosition()}</strong><span>${esc(value)}</span></div><div class="guard-actions">${pending.kind!=='export'&&!multi?'<button class="primary" data-guard="apply">应用当前内容并切换</button>':'<button class="primary" data-guard="return">返回当前编辑</button>'}${pending.kind!=='export'?'<button class="secondary" data-guard="discard">放弃本次修改并切换</button>':''}<button class="quiet" data-guard="cancel">${pending.kind==='export'?'取消导出':'继续编辑'}</button></div>`;
    $('#guard-dialog').showModal();
  }
  function apply() {
    const focusedBind=document.activeElement?.dataset?.bind;
    if(state.tab==='writing'&&state.writing==='melody'&&!validMelody()){
      state.error=true;render();$('#error-summary')?.focus();return false;
    }
    if(state.tab==='writing'&&state.writing==='lyrics'&&!state.lyric.trim()){toast('请先输入歌词，或使用删除当前歌词。');return false;}
    state.undo={melody:state.melodyBase,lyric:state.lyricBase,type:currentType()};
    if(state.tab==='writing'){if(state.writing==='melody'){state.melodyBase=state.melody;state.melodyBases[state.target]=state.melody;}else state.lyricBase=state.lyric;state.dirty=false;}
    if(state.tab==='chord')state.chordDirty=false;state.otherDirty=false;state.applied=true;state.error=false;
    render();if(focusedBind)document.querySelector(`[data-bind="${focusedBind}"]`)?.focus();toast(`${state.tab==='writing'?(state.writing==='melody'?'简谱内容':'歌词'):state.tab==='chord'?'和弦':'小节设置'}已应用（演示）`);return true;
  }
  function scene(id) {
    if($('#guard-dialog').open)$('#guard-dialog').close();
    Object.assign(state,{scene:id,tab:'writing',writing:'melody',selection:'note',target:0,melody:'5 6 7 1',lyric:'旋 律 随 风',melodyBase:'5 6 5 3',melodyBases:['5 6 5 3','2 3 2 1'],lyricBase:'旋 律 轻 响',melodyMode:'sequence',lyricMode:'sequence',duration:'1/8',dots:'0',dirty:false,chordDirty:false,otherDirty:false,error:false,empty:false,applied:false,showPopover:false,rhythmDirty:false});
    $('#inspector').hidden=false;$('#reopen').hidden=true;
    if(['melody','error','export'].includes(id))state.dirty=true;
    if(id==='lyrics'){state.writing='lyrics';state.dirty=true;}
    if(id==='selection')state.tab='selection';
    if(id==='measure'){state.tab='selection';state.selection='measure';}
    if(id==='chord')state.tab='chord';
    if(id==='song')state.tab='song';
    if(id==='empty'){state.empty=true;state.tab='selection';}
    if(id==='error'){state.melody='5 6 9 1';state.error=true;}
    if(id==='guard'){state.tab='chord';state.chord='G';state.chordDirty=true;}
    render();$('#panel-body').scrollTop=0;
    if(id==='guard')showGuard({kind:'navigate',tab:'song'});
    if(id==='export')showGuard({kind:'export'});
  }
  function bindInput(el) {
    const name=el.dataset.bind;if(!name)return;
    state[name]=el.value;state.applied=false;
    if(name==='melody'||name==='lyric'){
      state.dirty=state[name]!==state[name==='melody'?'melodyBase':'lyricBase'];
      if(name==='melody'&&validMelody()&&state.error){state.error=false;el.classList.remove('input-invalid');el.setAttribute('aria-invalid','false');$('#error-summary')?.remove();$('#melody-error')?.remove();}
      document.querySelectorAll(`[data-bind="${name}"]`).forEach(other=>{if(other!==el)other.value=el.value;});
      if($('#live-preview'))$('#live-preview').innerHTML=renderPreview();
    }else if(name==='chord')state.chordDirty=true;else state.otherDirty=true;
    updateFooter();
  }
  function doAction(action) {
    if(action==='apply'){apply();return;}
    if(action==='restore'){
      if(state.writing==='melody')state.melody=state.melodyBase;else state.lyric=state.lyricBase;
      state.dirty=false;state.chordDirty=false;state.otherDirty=false;state.rhythmDirty=false;state.error=false;state.applied=false;render();toast('已恢复本次修改（演示）');return;
    }
    if(action==='export'){
      if(hasPending()){showGuard({kind:'export'});return;}
      toast('演示：修改已处理，可以进入导出流程。');return;
    }
    if(action==='locate'){ $('#paper').scrollIntoView({block:'nearest'});$('#canvas-caption').textContent=`已定位：${currentPosition()}`;toast('已定位到谱面中的蓝色编辑对象');return;}
    if(action==='close-popover'){discardWriting();state.showPopover=false;state.empty=true;render();toast('已结束编辑，未应用内容已放弃。');return;}
    if(action==='focus-editor'){(state.writing==='melody'?$('#melody-input'):$('#lyric-input'))?.focus();return;}
    if(action==='example'||action==='add-melody'){navigate(action==='example'?'selection':'writing','melody',true);return;}
    if(action==='add-lyric'){navigate('writing','lyrics',true);return;}
    if(action==='song'){navigate('song');return;}
    if(action==='measure'||action==='tuplet'){
      if(hasPending()&&state.tab!=='writing'){showGuard({kind:'navigate',tab:'selection',selection:action==='measure'?'measure':'tuplet'});return;}
      state.selection=action==='measure'?'measure':'tuplet';navigate('selection',null,true);return;
    }
    if(action==='apply-rhythm'){
      if(state.dirty){toast('简谱内容尚未应用。先应用或恢复正文，再单独应用时值。');return;}
      state.rhythmDirty=false;updateFooter();toast('时值已应用（演示），没有同时应用单个音高。');return;
    }
    if(action==='apply-pitch'){
      toast(state.dirty?'请先应用或恢复简谱内容，再应用单个音高。':'单个音高已应用（演示）。');return;
    }
    if(['apply-info','apply-time','apply-capo'].includes(action)){state.otherDirty=false;state.applied=true;updateFooter();toast(`${{'apply-info':'曲谱信息','apply-time':'基础拍号','apply-capo':'变调夹'}[action]}已应用（演示）`);return;}
    if(action==='undo'){
      if(!state.undo){toast('还没有可撤销的演示修改。');return;}
      state.melody=state.melodyBase=state.undo.melody;state.melodyBases[state.target]=state.undo.melody;state.lyric=state.lyricBase=state.undo.lyric;state.dirty=false;state.undo=null;state.applied=false;render();toast('已撤销上次应用（演示）');return;
    }
    if(action==='rest'||action==='delete'){
      const rest=action==='rest';$('#guard-dialog').innerHTML=`<h2 id="guard-title">${rest?'将整拍设为休止？':'删除当前简谱事件？'}</h2><p>${rest?'会清空当前拍所有弦上的音符；可用撤销恢复。':'会同时移除附着在此事件上的歌词；可用撤销恢复。'}</p><div class="guard-actions"><button class="primary" data-confirm="${action}">${rest?'设为整拍休止':'删除事件及歌词'}</button><button class="secondary" data-guard="cancel">保留当前内容</button></div>`;$('#guard-dialog').showModal();return;
    }
    if(action==='delete-lyric'&&state.lyricMode!=='single'){toast('请先切换到「单个位置」，再删除该处歌词。');return;}
    if(action==='clear-diagram'){state.chordDirty=true;updateFooter();toast('指法图将清除，和弦名称保留；应用后生效（演示）。');return;}
    const messages={redo:'原型仅演示撤销入口；完整历史仍由产品管理。',view:'侧栏设计提案不改变现有谱面排版设置。',techniques:'技巧仍从顶栏选择；参数与目标在「选区」检查。',connection:'演示：选定连接类型后，在谱面选择合法终点。',copy:'已复制简谱范围（演示），未复制 TAB。',paste:'粘贴设计：选择覆盖或插入，先查看受影响的事件。',mapping:'逐项映射：旋→5、律→6、随→7、风→1。',barre:'演示：新增横按行，设置品位、起止弦与手指；最多 4 组。','copy-measures':'演示：复制第 2–3 小节，插入至第 4 小节之前；确认后整次可撤销。','tuplet-apply':'已应用连音比例（演示）。','remove-tuplet':'已移除连音组（演示）。',mute:'已将所选弦设为闷音 x（演示）。','delete-note':'已删除所选弦音符，其他弦不受影响（演示）。','delete-lyric':'已删除当前段号的此处歌词（演示）。','delete-chord':'演示：确认后移除当前拍和弦，TAB 音符保留。'};
    toast(messages[action]||'此处为设计入口，详细规则见交互规格。');
  }
  document.addEventListener('click',(e)=>{
    const button=e.target.closest('button,[data-score]');if(!button)return;
    if(button.dataset.scene){scene(button.dataset.scene);return;}
    if(button.dataset.tab){navigate(button.dataset.tab);return;}
    if(button.dataset.writing){navigate('writing',button.dataset.writing);return;}
    if(button.dataset.selection){state.selection=button.dataset.selection;render();return;}
    if(button.dataset.mode){if(state[button.dataset.mode]!==button.dataset.value)discardWriting();state[button.dataset.mode]=button.dataset.value;render();return;}
    if(button.dataset.chord){state.chord=button.dataset.chord;state.chordFrets=[...presets[state.chord]];state.chordDirty=true;render();return;}
    if(button.dataset.duration){state.duration=button.dataset.duration;state.rhythmDirty=state.tab==='writing';render();if(state.tab==='selection')toast('已修改所选音符时值（演示）');return;}
    if(button.dataset.dots&&!button.disabled){state.dots=state.dots===button.dataset.dots?'0':button.dataset.dots;render();toast(`${{'0':'无附点','1':'单附点','2':'双附点'}[state.dots]}已应用（演示）`);return;}
    if(button.dataset.score){
      const type=button.dataset.score,target=Number(button.dataset.target||0);
      if(type==='chord'){navigate('chord');return;}
      if(type==='melody'&&state.tab==='writing'&&state.writing==='melody'&&target!==state.target){
        discardWriting();state.target=target;state.melody=state.melodyBase=state.melodyBases[target];state.showPopover=true;render();return;
      }
      if(state.tab!=='writing'||state.writing!==type){navigate('writing',type);return;}
      state.showPopover=true;renderPopover();return;
    }
    if(button.dataset.guard){
      const choice=button.dataset.guard,pending=state.pending;
      if(choice==='apply'){if(!apply()){$('#guard-dialog').close();return;}}
      if(choice==='discard'){state.dirty=false;state.chordDirty=false;state.otherDirty=false;state.rhythmDirty=false;}
      $('#guard-dialog').close();
      if(['apply','discard'].includes(choice)&&pending?.kind==='navigate'){if(pending.selection)state.selection=pending.selection;navigate(pending.tab,pending.writing,true);}
      return;
    }
    if(button.dataset.confirm){$('#guard-dialog').close();toast('已执行该操作（固定演示），正式产品支持命令撤销。');return;}
    if(button.dataset.action){doAction(button.dataset.action);return;}
  });
  document.addEventListener('input',(e)=>{if(e.target.dataset.bind)bindInput(e.target);if(e.target.hasAttribute('data-mark-dirty')){state.otherDirty=true;updateFooter();}});
  document.addEventListener('change',(e)=>{
    const el=e.target,id=el.id;
    if(id==='note-dots'){state.dots=el.value;render();toast('已修改所选音符附点（演示）');return;}
    if(id==='duration'||id==='dots'){state[id]=el.value;state.rhythmDirty=true;if($('#live-preview'))$('#live-preview').innerHTML=renderPreview();updateFooter();}
    if(id==='verse'){if(state.verse!==el.value)discardWriting();state.verse=el.value;render();}
    if(id.startsWith('fret-')){const i=Number(id.split('-')[1]);state.chordFrets[i]=el.value;state.chord='自定义';state.chordDirty=true;render();}
    if(id.startsWith('finger-')){state.chordFingers[Number(id.split('-')[1])]=el.value;state.chordDirty=true;updateFooter();}
    if(['tonality','capo','song-time'].includes(id)){state[id==='song-time'?'time':id]=el.value;state.otherDirty=true;updateFooter();}
    if(['measure-time','barline'].includes(id)){state.otherDirty=true;updateFooter();}
  });
  document.addEventListener('keydown',(e)=>{
    if(e.isComposing||e.keyCode===229)return;
    if((e.metaKey||e.ctrlKey)&&e.key==='Enter'&&state.tab==='writing'&&!$('#guard-dialog').open){e.preventDefault();apply();return;}
    if(e.key==='Enter'&&e.target.matches('[data-score]')){e.preventDefault();e.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));return;}
    const tab=e.target.closest('[role=tab]');
    if(tab&&['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){
      e.preventDefault();const index=tabs.findIndex(t=>t[0]===tab.dataset.tab);const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(index+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
      navigate(tabs[next][0]);if(!$('#guard-dialog').open)$(`#tab-${tabs[next][0]}`).focus();
    }
    if(e.key==='Escape'&&!$('#guard-dialog').open&&state.showPopover){state.showPopover=false;renderPopover();}
  });
  $('#collapse').addEventListener('click',()=>{$('#inspector').hidden=true;$('#reopen').hidden=false;$('#popover').hidden=true;$('#reopen').focus();});
  $('#reopen').addEventListener('click',()=>{$('#inspector').hidden=false;$('#reopen').hidden=true;render();$('#collapse').focus();});
  $('#notes-toggle').addEventListener('click',()=>{const hidden=!$('#design-notes').hidden;$('#design-notes').hidden=hidden;document.body.classList.toggle('notes-mode',!hidden);$('#notes-toggle').setAttribute('aria-pressed',String(!hidden));});
  const params=new URLSearchParams(location.search);const initial=params.get('scene')||'melody';
  if(params.get('panel')==='1')document.body.classList.add('panel-only');
  if(params.get('embed')==='1')document.body.classList.add('embed-only');
  scene(scenes.some(s=>s[0]===initial)?initial:'melody');
  if(params.get('popover')==='1'){state.showPopover=true;renderPopover();}
})();
