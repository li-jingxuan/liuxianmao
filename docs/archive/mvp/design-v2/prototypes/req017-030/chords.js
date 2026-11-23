(() => {
  'use strict';
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const clone = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const base = {
    C:  { frets: [-1,3,2,0,1,0], fingers: ['',3,2,'',1,''] },
    G:  { frets: [3,2,0,0,0,3], fingers: [2,1,'','','',3] },
    Am: { frets: [-1,0,2,2,1,0], fingers: ['','',2,3,1,''] },
    F:  { frets: [1,3,3,2,1,1], fingers: [1,3,4,2,1,1], barres: [{fret:1,from:0,to:5,finger:'1'}] },
    Dm: { frets: [-1,-1,0,2,3,1], fingers: ['','','',2,3,1] },
    Em: { frets: [0,2,2,0,0,0], fingers: ['',2,3,'','',''] },
    D:  { frets: [-1,-1,0,2,3,2], fingers: ['','','',1,3,2] },
    A:  { frets: [-1,0,2,2,2,0], fingers: ['','',1,2,3,''] },
    E:  { frets: [0,2,2,1,0,0], fingers: ['',2,3,1,'',''] },
    Bm: { frets: [-1,2,4,4,3,2], fingers: ['',1,3,4,2,1], barres: [{fret:2,from:1,to:5,finger:'1'}] },
    G7: { frets: [3,2,0,0,0,1], fingers: [3,2,'','','',1] },
    Cmaj7:{frets:[-1,3,2,0,0,0],fingers:['',3,2,'','','']},
    D7: {frets:[-1,-1,0,2,1,2],fingers:['','','',2,1,3]},
    E7: {frets:[0,2,0,1,0,0],fingers:['',2,'',1,'','']},
    A7: {frets:[-1,0,2,0,2,0],fingers:['','',1,'',2,'']},
    Am7:{frets:[-1,0,2,0,1,0],fingers:['','',2,'',1,'']},
    Dm7:{frets:[-1,-1,0,2,1,1],fingers:['','','',2,1,1],barres:[{fret:1,from:4,to:5,finger:'1'}]},
    Em7:{frets:[0,2,0,0,0,0],fingers:['',2,'','','','']},
    Fmaj7:{frets:[-1,-1,3,2,1,0],fingers:['','',3,2,1,'']},
    Bdim:{frets:[-1,2,3,4,3,-1],fingers:['',1,2,4,3,'']},
    'F#m':{frets:[2,4,4,2,2,2],fingers:[1,3,4,1,1,1],barres:[{fret:2,from:0,to:5,finger:'1'}]},
    B: {frets:[-1,2,4,4,4,2],fingers:['',1,2,3,4,1],barres:[{fret:2,from:1,to:5,finger:'1'}]}
  };
  const roots = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
  const keyNames = {C:'C 大调 · 1=C',G:'G 大调 · 1=G',Am:'A 小调 · 6=A'};
  const quickNames = {C:['C','G','Am','F','Dm','Em','G7','Cmaj7'],G:['G','D','Em','C','Am','Bm','D7','G7'],Am:['Am','Dm','E','C','G','F','Em','E7']};
  const emptyShape = () => ({frets:[-1,-1,-1,-1,-1,-1],fingers:['','','','','',''],barres:[],start:1});
  function shapeFor(name) {
    if (base[name]) return {barres:[],start:1,...clone(base[name])};
    const match = name.match(/^([A-G](?:#|b)?)(.*)$/);
    if (!match) return emptyShape();
    const root = match[1]; const type = match[2];
    const pitch = roots.indexOf(root);
    const fret = ((pitch < 0 ? 0 : pitch) - 4 + 12) % 12 || 12;
    const minor = type.startsWith('m') && !type.startsWith('maj');
    const seventh = type === '7' || type === 'm7';
    if(type==='maj7')return {frets:[fret,fret+2,fret+1,fret+1,fret,fret],fingers:['1','4','2','3','1','1'],barres:[{fret,from:0,to:5,finger:'1'}],start:fret};
    if(type==='dim'||type==='m7b5')return {frets:[fret,fret+1,type==='dim'?fret+2:fret,fret,-1,-1],fingers:['1','2',type==='dim'?'3':'1','1','',''],barres:[{fret,from:0,to:3,finger:'1'}],start:fret};
    return {frets:[fret,fret+2,seventh?fret:fret+2,minor?fret:fret+1,fret,fret],fingers:['1','3',seventh?'1':'4',minor?'1':'2','1','1'],barres:[{fret,from:0,to:5,finger:'1'}],start:fret};
  }
  let scoreKey = 'C';
  let targets = ['C','Em','G','C','Am','F','Dm','G','C','G','Am','C'].map((name,i) => ({name,shape:shapeFor(name),display:'diagram',measure:i+2}));
  let selected = 3;
  let draft = clone(targets[selected]);
  let scoreUndo = []; let scoreRedo = [];
  let popoverVisible = true; let moreVisible = false; let zoom = 125;
  let modalStack = []; let custom = null; let mine = [];
  let library = {tab:'all',query:'',root:'',type:'',browseRoot:'C',mode:'major',selected:'C',variant:0};
  let toastTimer;
  function toast(text) {
    $('#toast').textContent=text; $('#toast').hidden=false;
    clearTimeout(toastTimer); toastTimer=setTimeout(() => $('#toast').hidden=true,2400);
  }
  function diagram(shape, className = '', title = '') {
    const positive = shape.frets.filter(n => n > 0);
    let start = Math.max(1, Number(shape.start) || 1);
    if (positive.length && (Math.max(...positive) > start+4 || Math.min(...positive) < start)) start = Math.max(1,Math.min(...positive));
    const x = i => 19+i*12;
    const y = fret => 25+(fret-start+.5)*13;
    let svg=`<svg class="diagram ${className}" viewBox="0 0 100 108" role="img" aria-label="${esc(title || '和弦指法')}，六到一弦 ${esc(shape.frets.map(n=>n<0?'禁奏':n===0?'空弦':n+'品').join('、'))}">`;
    for(let i=0;i<6;i++) svg+=`<line x1="${x(i)}" y1="25" x2="${x(i)}" y2="90" stroke="#62738A" stroke-width=".95"/>`;
    for(let i=0;i<6;i++) svg+=`<line x1="19" y1="${25+i*13}" x2="79" y2="${25+i*13}" stroke="#62738A" stroke-width="${i===0&&start===1?2.8:.95}"/>`;
    if(start>1)svg+=`<text x="6" y="36" font-size="9" fill="#65748A">${start}</text>`;
    shape.frets.forEach((f,i) => {if(f<0)svg+=`<path d="m${x(i)-2.4} 15 4.8 4.8m0-4.8-4.8 4.8" stroke="#526177" stroke-width="1"/>`;else if(f===0)svg+=`<circle cx="${x(i)}" cy="17" r="2.5" fill="none" stroke="#526177" stroke-width=".9"/>`;});
    (shape.barres||[]).forEach(b => {if(b.fret>=start&&b.fret<start+5)svg+=`<line x1="${x(b.from)}" y1="${y(b.fret)}" x2="${x(b.to)}" y2="${y(b.fret)}" stroke="#263B58" stroke-width="7.5" stroke-linecap="round"/>`;});
    shape.frets.forEach((f,i) => {if(f>0&&f>=start&&f<start+5)svg+=`<circle cx="${x(i)}" cy="${y(f)}" r="5" fill="#263B58"/><text x="${x(i)}" y="${y(f)+2.6}" text-anchor="middle" font-size="7.5" fill="white">${esc(shape.fingers[i]||'')}</text>`;});
    return svg+'</svg>';
  }
  const isDirty = () => JSON.stringify(draft)!==JSON.stringify(targets[selected]);
  function refreshDraft(source) {
    const focused=document.activeElement;
    const focusedQuick=focused?.dataset.pick;
    const quickContainer=focused?.parentElement?.id;
    if(source !== 'side') $('#side-name').value=draft.name;
    if(source !== 'popover') $('#popover-name').value=draft.name;
    const preview = draft.name ? `<div class="preview-copy"><strong>${esc(draft.name)}</strong><p>标准调弦 · E A D G B E</p></div>${diagram(draft.shape,'',draft.name)}<button class="link preview-edit" data-action="custom" data-testid="sidebar-custom">编辑指法</button>` : `<div class="empty-preview">此位置暂无和弦</div><button class="link preview-edit" data-action="library">选择和弦</button>`;
    $('#side-preview').innerHTML=preview;
    $('#popover-preview').innerHTML=draft.name?`${diagram(draft.shape,'',draft.name)}<div><strong>当前指法 · ${esc(draft.name)}</strong><p>${draft.shape.barres.length?'横按指型':'开放指型'}</p></div><button class="link" data-action="custom" data-testid="popover-custom">编辑指法</button>`:`<span class="empty-preview">选择和弦，开始编辑</span><button class="link" data-action="custom">自定义指法</button>`;
    $('#quick-caption').textContent=keyNames[scoreKey]; $('#popover-key').textContent=keyNames[scoreKey].split(' · ')[0]; $('#more-key').textContent=keyNames[scoreKey];
    $('#side-quick').innerHTML=quickNames[scoreKey].map(n => `<button class="quick-card ${n===draft.name?'active':''}" data-pick="${n}" data-testid="quick-${n}" aria-pressed="${n===draft.name}">${diagram(shapeFor(n),'',n)}<strong>${n}</strong></button>`).join('');
    $('#popover-quick').innerHTML=quickNames[scoreKey].slice(0,6).map(n=>`<button class="${n===draft.name?'active':''}" data-pick="${n}" aria-pressed="${n===draft.name}">${n}</button>`).join('')+`<button class="more-trigger" data-action="more" data-testid="popover-more" aria-expanded="${moreVisible}" aria-controls="more-dropdown">更多⌄</button>`;
    $$('input[name="display"]').forEach(input=>input.checked=input.value===draft.display);
    $$('.target-label').forEach(el=>el.textContent=`第 ${targets[selected].measure} 小节 · 第 1 拍`);
    $('#position-status').textContent=`当前位置：第 ${targets[selected].measure} 小节，第 1 拍`;
    $('#draft-status').textContent=isDirty()?'草稿有未应用修改':'草稿与谱面一致';
    $('#draft-status').classList.toggle('dirty',isDirty());
    $$('[data-action="apply"]').forEach(button=>button.disabled=!isDirty());
    $$('[data-action="delete"]').forEach(button=>button.disabled=!targets[selected].name&&!draft.name);
    $$('[data-action="undo"]').forEach(button=>button.disabled=!scoreUndo.length);
    $$('[data-action="redo"]').forEach(button=>button.disabled=!scoreRedo.length);
    if(moreVisible) renderMore();
    if(focusedQuick&&quickContainer&&['side-quick','popover-quick'].includes(quickContainer)) {
      $$(`#${quickContainer} [data-pick]`).find(el=>el.dataset.pick===focusedQuick)?.focus({preventScroll:true});
    }
  }
  function choose(name) {
    draft.name=name; draft.shape=shapeFor(name); refreshDraft();
  }
  function storeHistory() {scoreUndo.push({targets:clone(targets),selected});scoreRedo=[];}
  function applyDraft() {if(!isDirty())return;storeHistory();targets[selected]=clone(draft);renderScore();refreshDraft();positionPopover();toast('和弦已应用到当前位置');}
  function deleteChord() {if(!targets[selected].name&&!draft.name)return;storeHistory();draft={...draft,name:'',shape:emptyShape()};targets[selected]=clone(draft);renderScore();refreshDraft();positionPopover();toast('已删除和弦，可撤销');}
  function history(direction) {
    const from=direction==='undo'?scoreUndo:scoreRedo; const to=direction==='undo'?scoreRedo:scoreUndo;
    if(!from.length)return;to.push({targets:clone(targets),selected});const old=from.pop();targets=old.targets;selected=old.selected;draft=clone(targets[selected]);renderScore();refreshDraft();positionPopover();toast(direction==='undo'?'已撤销谱面修改':'已重做谱面修改');
  }
  function renderScore() {
    let html='';
    for(let row=0;row<3;row++) {
      let svg='<svg class="score-svg" viewBox="0 0 820 244" aria-label="六线谱、简谱与歌词">';
      for(let line=0;line<6;line++)svg+=`<line x1="20" y1="${101+line*12}" x2="811" y2="${101+line*12}" stroke="#353B44" stroke-width="1"/>`;
      [20,218,416,614,811].forEach((x,i)=>svg+=`<line x1="${x}" y1="101" x2="${x}" y2="161" stroke="#353B44" stroke-width="${i===4&&row===2?2:1}"/>`);
      if(row===0)svg+='<text x="1" y="117" font-size="10">T</text><text x="1" y="134" font-size="10">A</text><text x="1" y="150" font-size="10">B</text><text x="28" y="125" font-size="18">4</text><text x="28" y="145" font-size="18">4</text>';
      const lyrics=[['轻','轻','拨','动','晚','风','的','弦','旋','律','随','风','慢','慢','升','起'],['和','声','轻','响','山','谷','回','应','你','的','歌','声','落','在','心','底'],['把','这','一','段','温','柔','时','光','留','给','明','天','再','唱','一','遍']][row];
      for(let bar=0;bar<4;bar++) {
        const left=20+bar*198;
        svg+=`<text x="${left+4}" y="95" font-size="8" fill="#7D8A9D">${row*4+bar+2}</text>`;
        for(let note=0;note<8;note++) {
          const x=left+16+note*23;
          const string=(note+bar+row)%5;
          const y=101+string*12;
          const number=[0,2,0,3,2,0,1,0][(note+bar)%8];
          svg+=`<rect x="${x-5}" y="${y-6}" width="10" height="12" fill="white"/><text x="${x}" y="${y+4}" font-size="11" text-anchor="middle">${note%3===0?'×':number}</text><path d="M${x} ${y+7}V181" stroke="#353B44" stroke-width="1"/>`;
          if(note%2===0)svg+=`<path d="M${x} 181h23" stroke="#353B44" stroke-width="2"/>`;
          if(note===2)svg+=`<path d="M${x-2} ${y-8}q13-13 26 0" fill="none" stroke="#353B44" stroke-width="1"/>`;
        }
        for(let j=0;j<4;j++) {
          const x=left+29+j*44;
          svg+=`<text x="${x}" y="205" font-size="13" text-anchor="middle">${[1,2,3,5,6,5,3,2][(row+bar+j)%8]}</text><line x1="${x-11}" y1="211" x2="${x+11}" y2="211" stroke="#353B44" stroke-width="1"/><text x="${x}" y="235" font-size="12" text-anchor="middle">${lyrics[bar*4+j]}</text>`;
        }
      }
      svg+='</svg>';
      html+=`<div class="music-system">${svg}${targets.slice(row*4,row*4+4).map((t,j)=>`<button data-target="${row*4+j}" data-testid="score-chord-${row*4+j}" aria-label="第${t.measure}小节，${esc(t.name||'添加和弦')}" class="score-chord ${selected===row*4+j?'selected':''} ${!t.name?'empty':''} ${t.name&&t.display==='name'?'name-only':''}" style="left:${5.5+j*24.1}%">${t.name?`<strong>${esc(t.name)}</strong>${t.display==='diagram'?diagram(t.shape,'',t.name):''}`:'＋'}</button>`).join('')}</div>`;
    }
    $('#score-music').innerHTML=html;
  }
  function positionPopover() {
    const bubble=$('#chord-popover');bubble.hidden=!popoverVisible;
    if(!popoverVisible)return;
    const button=$(`[data-target="${selected}"]`);if(!button)return;
    const rect=button.getBoundingClientRect();
    const workspace=$('.score-workspace').getBoundingClientRect();
    const bubbleLeft=Math.max(workspace.left+22,Math.min(rect.left-135,workspace.right-440));
    bubble.style.left=`${bubbleLeft}px`;
    bubble.style.setProperty('--arrow-left',`${Math.max(18,Math.min(390,rect.left+rect.width/2-bubbleLeft-6))}px`);
    bubble.style.top=`${Math.max(180,Math.min(rect.bottom+12,window.innerHeight-(moreVisible?540:320)))}px`;
  }
  function toggleMore(value) {
    moreVisible=value;$('#more-dropdown').hidden=!value;refreshDraft();positionPopover();
    if(value)$('#more-search').focus();
  }
  function renderMore() {
    const q=$('#more-search').value.trim().toLowerCase();
    let names=q?Object.keys(base).filter(n=>n.toLowerCase().includes(q)).slice(0,8):quickNames[scoreKey];
    $('#more-cards').innerHTML=names.length?names.map(n=>`<button data-pick="${n}" data-close-more="true">${diagram(shapeFor(n),'',n)}<strong>${esc(n)}</strong></button>`).join(''):'<div class="empty-state" style="grid-column:1/-1;padding:22px 0">没有找到和弦</div>';
  }
  function setBackgroundInert() {
    const open=modalStack.length>0;
    $('#app').inert=open;$('.review-nav').inert=open;$('#chord-popover').inert=open;
    $$('.modal-overlay').forEach((el,i)=>el.inert=i!==modalStack.length-1);
  }
  function pushModal(type,html) {
    const previous=document.activeElement;
    const overlay=document.createElement('div');overlay.className='modal-overlay';overlay.dataset.modal=type;overlay.innerHTML=html;
    const restore={id:previous?.id,testid:previous?.dataset.testid,action:previous?.dataset.action};
    $('#modal-layer').appendChild(overlay);modalStack.push({type,overlay,previous,restore});
    const first=overlay.querySelector('[data-initial-focus]')||overlay.querySelector('input,button,select');
    first?.focus();setBackgroundInert();
    overlay.addEventListener('mousedown',event=>{if(event.target===overlay)closeModal();});
  }
  function closeModal() {
    if(!modalStack.length)return;
    const closed=modalStack.pop();closed.overlay.remove();
    if(closed.type==='custom')custom=null;
    setBackgroundInert();
    const scope=modalStack.at(-1)?.overlay||document;
    const replacement=closed.restore.id?document.getElementById(closed.restore.id):closed.restore.testid?$$('[data-testid]',scope).find(el=>el.dataset.testid===closed.restore.testid):closed.restore.action?$$('[data-action]',scope).find(el=>el.dataset.action===closed.restore.action):null;
    const destination=closed.previous?.isConnected?closed.previous:replacement||(modalStack.length?scope.querySelector('button'):$('#side-name'));
    destination?.focus({preventScroll:true});
  }
  function allEntries() {
    const known=Object.keys(base);
    const extras=roots.flatMap(root=>['','m','7','maj7','m7','dim','m7b5'].map(type=>root+type));
    return [...new Set([...known,...extras])].map(name=>({id:name,name,shape:shapeFor(name)}));
  }
  function libraryEntry() {
    return (library.tab==='mine'?mine:allEntries()).find(e=>e.id===library.selected)||null;
  }
  function libraryVariant(entry) {
    if(!entry)return null;
    const shape=clone(entry.shape);
    if(library.variant===1 && entry.name==='C')return {frets:[-1,3,5,5,5,3],fingers:['',1,2,3,4,1],barres:[{fret:3,from:1,to:5,finger:'1'}],start:3};
    if(library.variant===1 && entry.name==='G')return {frets:[3,2,0,0,3,3],fingers:[2,1,'','',3,4],barres:[],start:1};
    if(library.variant===1) {
      shape.frets=shape.frets.map(n=>n<0?n:n+12);shape.start=13;
      shape.barres=shape.barres.map(b=>({...b,fret:b.fret+12}));
      if(!shape.barres.length)shape.barres=[{fret:12,from:Math.max(0,shape.frets.findIndex(n=>n>0)),to:5,finger:''}];
      shape.start=Math.min(...shape.frets.filter(n=>n>0));
    }
    return shape;
  }
  function openLibrary() {
    if(modalStack.some(m=>m.type==='library'))return;
    library={tab:'all',query:'',root:'',type:'',browseRoot:scoreKey==='Am'?'A':scoreKey,mode:scoreKey==='Am'?'minor':'major',selected:base[draft.name]?draft.name:'C',variant:0};
    pushModal('library',`<section class="modal library-modal" role="dialog" aria-modal="true" aria-labelledby="library-title" data-testid="library-modal"><header class="modal-header"><div><h2 id="library-title">和弦库</h2><p>选择和弦与指法，带回当前编辑位置。</p></div><button class="icon-button modal-close" data-action="close-modal" aria-label="关闭和弦库">×</button></header><div class="library-layout"><section class="library-main"><div class="library-tabs" role="tablist"><button class="active" role="tab" aria-selected="true" data-library-tab="all" data-testid="library-all-tab">全部和弦</button><button role="tab" aria-selected="false" data-library-tab="mine" data-testid="library-mine-tab">我的指法</button></div><div class="library-controls"><div class="library-search-row"><input id="library-search" data-initial-focus data-testid="library-search" aria-label="搜索和弦" placeholder="搜索和弦名称，如 Cmaj7、Bm"><select id="library-root" aria-label="根音筛选" data-testid="library-root"><option value="">全部根音</option>${roots.map(n=>`<option>${n}</option>`).join('')}</select><select id="library-type" aria-label="和弦类型筛选" data-testid="library-type"><option value="">全部类型</option><option value="major">大三和弦</option><option value="minor">小三和弦</option><option value="7">属七和弦</option><option value="maj7">大七和弦</option><option value="m7">小七和弦</option></select></div><div class="browse-tonality"><span>按调性浏览</span><select id="browse-root" aria-label="浏览主音" data-testid="library-browse-root">${roots.map(n=>`<option ${n===library.browseRoot?'selected':''}>${n}</option>`).join('')}</select><select id="browse-mode" aria-label="浏览大小调" data-testid="library-browse-mode"><option value="major" ${library.mode==='major'?'selected':''}>大调</option><option value="minor" ${library.mode==='minor'?'selected':''}>小调</option></select><span class="score-tonality">当前曲谱：${keyNames[scoreKey]}</span></div></div><div class="library-list" data-testid="library-scroll"><div id="library-results"></div></div></section><aside class="library-detail" data-testid="library-fixed-detail" id="library-detail"></aside></div><footer class="modal-footer"><span>选用后回填草稿，点击「应用」写入谱面。</span><button data-action="close-modal">取消</button><button class="primary" data-action="library-use" data-testid="library-use">选用此指法</button></footer></section>`);
    renderLibrary();
  }
  function toneRecommendations(sevenths = false) {
    const p=roots.indexOf(library.browseRoot);
    const intervals=library.mode==='major'?[0,2,4,5,7,9,11]:[0,2,3,5,7,8,10];
    const types=sevenths
      ? library.mode==='major'?['maj7','m7','m7','maj7','7','m7','m7b5']:['m7','m7b5','maj7','m7','m7','maj7','7']
      : library.mode==='major'?['','m','m','','','m','dim']:['m','dim','','m','m','',''];
    return intervals.map((n,i)=>roots[(p+n)%12]+types[i]);
  }
  function renderLibrary() {
    const root=modalStack.find(m=>m.type==='library')?.overlay;if(!root)return;
    const focusedCard=document.activeElement?.dataset.libraryPick;
    $$('[data-library-tab]',root).forEach(button=>{const active=button.dataset.libraryTab===library.tab;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));});
    $('.browse-tonality',root).hidden=library.tab==='mine';
    $('#library-root',root).hidden=library.tab==='mine';$('#library-type',root).hidden=library.tab==='mine';
    let entries=library.tab==='mine'?mine:allEntries();
    const q=library.query.toLowerCase();
    entries=entries.filter(e=>e.name.toLowerCase().includes(q));
    if(library.tab==='all')entries=entries.filter(e=>{const parsed=e.name.match(/^([A-G](?:#|b)?)(.*)$/);const type=parsed?.[2]||'';return (!library.root||parsed?.[1]===library.root)&&(!library.type||(library.type==='major'?type==='':library.type==='minor'?type==='m':type===library.type));});
    const tones=toneRecommendations();
    const sevenths=toneRecommendations(true);
    if(!library.query&&!library.root&&!library.type&&library.tab==='all')entries.sort((a,b)=>{const ai=tones.indexOf(a.name),bi=tones.indexOf(b.name);return (ai<0?99:ai)-(bi<0?99:bi);});
    const selectedEntry=libraryEntry();
    if(!selectedEntry&&entries.length){library.selected=entries[0].id;library.variant=0;}
    const title=library.tab==='mine'?'我的指法':`${library.browseRoot} ${library.mode==='major'?'大调':'小调'}`;
    const card=e=>`<button class="chord-card ${library.selected===e.id?'active':''}" data-library-pick="${esc(e.id)}" data-testid="library-card-${esc(e.name)}" aria-pressed="${library.selected===e.id}">${diagram(e.shape,'',e.name)}<strong>${esc(e.name)}</strong><span class="card-type">${library.tab==='mine'?'我的指法':tones.includes(e.name)?'调内三和弦':sevenths.includes(e.name)?'调内七和弦':'标准调弦'}</span></button>`;
    const group=(heading,list)=>list.length?`<div class="list-heading"><strong>${heading}</strong><span>${list.length} 项</span></div><div class="chord-grid">${list.map(card).join('')}</div>`:'';
    const classified=library.tab==='all'&&!library.query&&!library.root&&!library.type;
    $('#library-results',root).innerHTML=entries.length
      ? classified
        ? group(`${title} · 调内三和弦`,tones.map(name=>entries.find(e=>e.name===name)).filter(Boolean))+group(`${title} · 调内七和弦`,sevenths.map(name=>entries.find(e=>e.name===name)).filter(Boolean))+group('其他和弦',entries.filter(e=>!tones.includes(e.name)&&!sevenths.includes(e.name)))
        : group(library.tab==='mine'?title:'搜索与筛选结果',entries)
      : `<div class="empty-state"><strong>${library.tab==='mine'&&!library.query?'还没有保存指法':'没有找到匹配的和弦'}</strong>${library.tab==='mine'&&!library.query?'在自定义指法中，另存你喜欢的按法。':'试试其他名称，或清除筛选条件。'}<button data-action="${library.tab==='mine'&&!library.query?'custom':'library-clear'}">${library.tab==='mine'&&!library.query?'自定义指法':'清除筛选'}</button></div>`;
    renderLibraryDetail();
    if(focusedCard&&modalStack.at(-1)?.type==='library')$$('[data-library-pick]',root).find(el=>el.dataset.libraryPick===focusedCard)?.focus({preventScroll:true});
  }
  function renderLibraryDetail() {
    const el=$('#library-detail');if(!el)return;
    const entry=libraryEntry();
    const use=$('[data-action="library-use"]');
    if(!entry){el.innerHTML='<div class="empty-state"><strong>选择一个指法</strong>指法详情将显示在这里</div>';use.disabled=true;return;}
    use.disabled=false;
    const shape=libraryVariant(entry);
    el.innerHTML=`<div class="detail-top"><h3>${esc(entry.name)}</h3><span class="small-chip">${library.tab==='mine'?'我的指法':'标准调弦'}</span></div>${diagram(shape,'detail-diagram',entry.name)}<p class="detail-caption">${shape.start>1?'起始 '+shape.start+' 品':'起始 1 品'} · × 禁奏 · ○ 空弦</p><div class="detail-label">指法版本</div><button class="variant ${library.variant===0?'active':''}" data-variant="0" data-testid="library-variant-0" aria-pressed="${library.variant===0}"><strong>${entry.shape.barres.length?'封闭指型':'开放指型'}</strong><span>${entry.shape.frets.map(n=>n<0?'×':n).join(' · ')} / 6 → 1 弦</span></button>${library.tab==='all'?`<button class="variant ${library.variant===1?'active':''}" data-variant="1" data-testid="library-variant-1" aria-pressed="${library.variant===1}"><strong>${entry.name==='G'?'四指开放指型':entry.name==='C'?'第 3 品横按指型':'高把位指型'}</strong><span>${entry.name==='C'?'× · 3 · 5 · 5 · 5 · 3':entry.name==='G'?'3 · 2 · 0 · 0 · 3 · 3':'同音高八度指型'}</span></button>`:''}<button class="link detail-custom" data-action="library-custom" data-testid="library-custom">基于此指法自定义</button>`;
  }
  function useLibrary() {
    const entry=libraryEntry();if(!entry)return;
    draft.name=entry.name;draft.shape=libraryVariant(entry);refreshDraft();closeModal();toast('已选用到草稿');
  }
  function openCustom(initial) {
    if(modalStack.at(-1)?.type==='custom')return;
    const working=initial?clone(initial):{name:draft.name||'C',shape:clone(draft.name?draft.shape:shapeFor('C'))};
    custom={...working,validShape:clone(working.shape),tool:'point',selected:null,pending:null,finger:'',undo:[],redo:[],error:'',saved:false};
    pushModal('custom',`<section class="modal custom-modal" role="dialog" aria-modal="true" aria-labelledby="custom-title" data-testid="custom-modal"><header class="modal-header"><div><h2 id="custom-title">自定义指法</h2><p>第 ${targets[selected].measure} 小节 · 第 1 拍 / 标准调弦 E A D G B E</p></div><span class="custom-header-error" id="custom-error" role="status" data-testid="custom-error"></span><button class="icon-button modal-close" data-action="close-modal" aria-label="关闭自定义指法">×</button></header><div class="custom-body"><section class="fret-editor"><div class="fret-topbar"><strong id="fret-name">${esc(custom.name)}</strong><button class="active" data-tool="point" data-testid="tool-point" aria-pressed="true">按弦</button><button data-tool="barre" data-testid="tool-barre" aria-pressed="false">横按</button><button data-tool="erase" data-testid="tool-erase" aria-pressed="false">擦除</button><button class="fret-history" data-action="custom-undo" data-testid="custom-undo" aria-label="撤销指法修改" title="撤销">↶</button><button class="fret-history" data-action="custom-redo" data-testid="custom-redo" aria-label="重做指法修改" title="重做">↷</button><label class="start-fret-label" for="start-fret">起始品位 <input type="number" id="start-fret" min="1" max="20" value="${custom.shape.start||1}" data-testid="start-fret"></label></div><svg class="fretboard" id="fretboard" viewBox="0 0 570 360" aria-label="指板，左起第六弦，右至第一弦" data-testid="fretboard"></svg><div class="finger-row"><label for="finger-selector">按弦手指</label><select id="finger-selector" data-testid="finger-selector"><option value="">未指定</option><option value="1">1 · 食指</option><option value="2">2 · 中指</option><option value="3">3 · 无名指</option><option value="4">4 · 小指</option><option value="T">T · 拇指</option></select></div><div class="finger-shortcuts"><span>选中按点后</span><kbd>1–4</kbd><span>手指</span><kbd>T</kbd><span>拇指</span><kbd>0</kbd><span>未指定</span></div><div id="fret-instruction" class="fret-instruction" aria-live="polite"></div></section><aside class="custom-aside"><label for="custom-name">和弦名称</label><input id="custom-name" data-initial-focus data-testid="custom-name" value="${esc(custom.name)}" autocomplete="off"><div class="valid-preview"><div class="label-row"><strong>有效指法预览</strong><span class="valid-badge" id="valid-badge">指法有效</span></div><div id="custom-preview" data-testid="custom-preview"></div></div><button class="custom-save" data-action="custom-save" data-testid="custom-save">另存为我的指法</button><div class="save-feedback" id="custom-save-feedback" role="status"></div></aside></div><footer class="modal-footer"><span>完成后返回草稿，可继续修改或统一应用。</span><button data-action="close-modal" data-testid="custom-cancel">取消</button><button class="primary" data-action="custom-done" data-testid="custom-done">完成编辑</button></footer></section>`);
    renderCustom();
  }
  function customSnapshot(){return {shape:clone(custom.shape),selected:clone(custom.selected),finger:custom.finger};}
  function customHistory() {custom.undo.push(customSnapshot());custom.redo=[];custom.saved=false;}
  function validateCustom(preferredField) {
    const start=Number($('#start-fret').value);
    if(preferredField)custom.latestField=preferredField;
    const startError=!Number.isInteger(start)||start<1||start>20?'起始品位请输入 1–20 的整数':'';
    const nameError=!custom.name.trim()?'请填写和弦名称':'';
    const error=custom.latestField==='name'?(nameError||startError):(startError||nameError);
    custom.error=error;
    $('#custom-error').textContent=error;
    $('#start-fret').setAttribute('aria-invalid',String(!!error&&error.startsWith('起始')));
    $('#custom-name').setAttribute('aria-invalid',String(!!error&&error.startsWith('请填写')));
    $('[data-action="custom-done"]').disabled=!!error;
    $('[data-action="custom-save"]').disabled=!!error;
    $('#valid-badge').textContent=error?'保留上次有效指法':'指法有效';
    if(!error)custom.validShape=clone(custom.shape);
    $('#custom-preview').innerHTML=diagram(custom.validShape,'',custom.name);
    return !error;
  }
  function renderCustom() {
    if(!custom)return;
    $('#fret-name').textContent=custom.name||'—';
    $$('[data-tool]').forEach(button=>{button.classList.toggle('active',button.dataset.tool===custom.tool);button.setAttribute('aria-pressed',String(button.dataset.tool===custom.tool));});
    $('[data-action="custom-undo"]').disabled=!custom.undo.length;$('[data-action="custom-redo"]').disabled=!custom.redo.length;
    $('#finger-selector').value=custom.finger;
    $('#fret-instruction').textContent=custom.pending?'再选同一品位的另一根弦完成横按 · Esc 取消':'';
    renderFretboard();validateCustom();
  }
  function fretCell(col,row) {
    if(!custom||custom.error.startsWith('起始'))return;
    const fret=(Number(custom.shape.start)||1)+row;
    if(custom.tool==='barre') {
      if(!custom.pending){custom.pending={col,fret};renderCustom();return;}
      if(custom.pending.fret!==fret){custom.pending={col,fret};renderCustom();return;}
      const from=Math.min(custom.pending.col,col),to=Math.max(custom.pending.col,col);
      if(from===to)return;
      customHistory();
      const b={fret,from,to,finger:''};custom.shape.barres.push(b);
      for(let i=from;i<=to;i++){if(custom.shape.frets[i]<fret){custom.shape.frets[i]=fret;custom.shape.fingers[i]='';}}
      custom.selected={type:'barre',index:custom.shape.barres.length-1};custom.finger='';custom.pending=null;
    } else if(custom.tool==='erase') {
      customHistory();custom.shape.frets[col]=-1;custom.shape.fingers[col]='';custom.shape.barres=custom.shape.barres.filter(b=>!(b.fret===fret&&col>=b.from&&col<=b.to));custom.selected=null;custom.finger='';
    } else {
      if(custom.shape.frets[col]!==fret){customHistory();custom.shape.frets[col]=fret;custom.shape.fingers[col]='';}
      custom.selected={type:'point',col};custom.finger=String(custom.shape.fingers[col]||'');
    }
    renderCustom();$('#fretboard').focus();
  }
  function selectPoint(col) {
    if(custom.tool==='erase'){customHistory();custom.shape.frets[col]=-1;custom.shape.fingers[col]='';custom.selected=null;custom.finger='';}
    else {custom.selected={type:'point',col};custom.finger=String(custom.shape.fingers[col]||'');}
    renderCustom();$('#fretboard').focus();
  }
  function selectBarre(index) {
    if(custom.tool==='erase'){customHistory();custom.shape.barres.splice(index,1);custom.selected=null;custom.finger='';}
    else {custom.selected={type:'barre',index};custom.finger=String(custom.shape.barres[index].finger||'');}
    renderCustom();$('#fretboard').focus();
  }
  function setFinger(value) {
    if(!custom)return;
    if(custom.selected){
      customHistory();
      if(custom.selected.type==='point')custom.shape.fingers[custom.selected.col]=value;
      else {
        const b=custom.shape.barres[custom.selected.index];b.finger=value;
        for(let i=b.from;i<=b.to;i++)if(custom.shape.frets[i]===b.fret)custom.shape.fingers[i]=value;
      }
    }
    custom.finger=value;renderCustom();
  }
  function renderFretboard() {
    const svg=$('#fretboard');svg.setAttribute('tabindex','0');
    const x=i=>105+i*69;const start=Number(custom.shape.start)||1;const y=f=>58+(f-start+.5)*49;
    let html='';
    for(let i=0;i<6;i++)html+=`<line x1="${x(i)}" y1="58" x2="${x(i)}" y2="303" stroke="#9BAABF" stroke-width="${1.8-i*.16}"/><text x="${x(i)}" y="328" fill="#65758E" font-size="12" text-anchor="middle">${6-i} 弦</text>`;
    for(let j=0;j<6;j++)html+=`<line x1="105" y1="${58+j*49}" x2="450" y2="${58+j*49}" stroke="#AAB7CA" stroke-width="${j===0&&start===1?3:1}"/>`;
    for(let r=0;r<5;r++){
      html+=`<text x="76" y="${88+r*49}" text-anchor="middle" fill="#6B7C95" font-size="13">${start+r}</text>`;
      for(let c=0;c<6;c++)html+=`<rect class="fret-hit" data-cell="${c},${r}" data-testid="fret-cell-${6-c}-${start+r}" x="${x(c)-28}" y="${59+r*49}" width="56" height="47" tabindex="0" role="button" aria-label="第${6-c}弦，第${start+r}品"/>`;
    }
    for(let c=0;c<6;c++) {
      const f=custom.shape.frets[c];
      html+=`<g class="string-toggle" data-string="${c}" data-testid="string-toggle-${6-c}" tabindex="0" role="button" aria-label="第${6-c}弦，${f===0?'空弦，点击禁奏':'点击设为空弦'}"><rect x="${x(c)-18}" y="13" width="36" height="35" fill="transparent"/>${f===0?`<circle cx="${x(c)}" cy="32" r="6" fill="white" stroke="#6B7C95" stroke-width="1.5"/>`:f<0?`<path d="m${x(c)-4} 28 8 8m0-8-8 8" stroke="#6B7C95" stroke-width="1.8"/>`:`<circle cx="${x(c)}" cy="32" r="5" fill="#74849B"/>`}</g>`;
    }
    custom.shape.barres.forEach((b,index)=>{
      if(b.fret<start||b.fret>start+4)return;
      const active=custom.selected?.type==='barre'&&custom.selected.index===index;
      html+=`<g class="point-hit" data-barre="${index}" data-testid="barre-${index}" tabindex="0" role="button" aria-label="第${b.fret}品横按，${b.finger||'未指定'}手指">${active?`<line x1="${x(b.from)}" x2="${x(b.to)}" y1="${y(b.fret)}" y2="${y(b.fret)}" stroke="#A4C2FF" stroke-width="27" stroke-linecap="round"/>`:''}<line x1="${x(b.from)}" x2="${x(b.to)}" y1="${y(b.fret)}" y2="${y(b.fret)}" stroke="${active?'#285BE0':'#29405E'}" stroke-width="16" stroke-linecap="round"/></g>`;
    });
    custom.shape.frets.forEach((f,c)=>{
      if(f<start||f>start+4||f<1)return;
      const active=custom.selected?.type==='point'&&custom.selected.col===c;
      html+=`<g class="point-hit" data-point="${c}" data-testid="fret-point-${6-c}" role="button" tabindex="0" aria-label="第${6-c}弦，第${f}品，${custom.shape.fingers[c]||'未指定'}手指" aria-pressed="${active}">${active?`<circle cx="${x(c)}" cy="${y(f)}" r="20" fill="#BCD2FF"/>`:''}<circle cx="${x(c)}" cy="${y(f)}" r="14" fill="${active?'#285BE0':'#29405E'}"/><text x="${x(c)}" y="${y(f)+4.5}" fill="white" font-size="12" text-anchor="middle" pointer-events="none">${esc(custom.shape.fingers[c]||'·')}</text></g>`;
    });
    if(custom.pending)html+=`<circle cx="${x(custom.pending.col)}" cy="${y(custom.pending.fret)}" r="17" fill="#285BE022" stroke="#285BE0" stroke-width="2" stroke-dasharray="3 2"/>`;
    svg.innerHTML=html;
  }
  function customUndoRedo(direction) {
    const from=custom[direction==='undo'?'undo':'redo'],to=custom[direction==='undo'?'redo':'undo'];
    if(!from.length)return;to.push(customSnapshot());const state=from.pop();Object.assign(custom,state);custom.pending=null;$('#start-fret').value=custom.shape.start;renderCustom();
  }
  function customDone() {
    if(!validateCustom())return;
    const result={name:custom.name.trim(),shape:clone(custom.shape)};
    draft.name=result.name;draft.shape=result.shape;refreshDraft();
    closeModal();
    if(modalStack.at(-1)?.type==='library')closeModal();
    toast('自定义指法已带回草稿');
  }
  function customSave() {
    if(!validateCustom())return;
    mine.push({id:'mine-'+Date.now()+'-'+mine.length,name:custom.name.trim(),shape:clone(custom.shape)});custom.saved=true;
    $('#custom-save-feedback').textContent=`已保存「${custom.name.trim()}」，可在和弦库的「我的指法」中选用。`;
    if(modalStack.some(m=>m.type==='library'))renderLibrary();
  }
  document.addEventListener('click',event=>{
    const target=event.target.closest('button,[data-cell],[data-point],[data-barre],[data-string]');if(!target)return;
    if(target.dataset.target!==undefined) {
      const next=Number(target.dataset.target);
      if(next!==selected){selected=next;draft=clone(targets[selected]);moreVisible=false;$('#more-dropdown').hidden=true;}
      popoverVisible=true;renderScore();refreshDraft();positionPopover();return;
    }
    if(target.dataset.pick){choose(target.dataset.pick);if(target.dataset.closeMore){toggleMore(false);$('[data-action="more"]').focus({preventScroll:true});}return;}
    if(target.dataset.libraryTab){library.tab=target.dataset.libraryTab;library.selected=library.tab==='mine'?(mine[0]?.id||''):'C';library.variant=0;renderLibrary();return;}
    if(target.dataset.libraryPick){library.selected=target.dataset.libraryPick;library.variant=0;renderLibrary();return;}
    if(target.dataset.variant!==undefined){library.variant=Number(target.dataset.variant);renderLibraryDetail();$(`[data-variant="${library.variant}"]`)?.focus({preventScroll:true});return;}
    if(target.dataset.tool){custom.tool=target.dataset.tool;custom.pending=null;renderCustom();return;}
    if(target.dataset.cell){const [c,r]=target.dataset.cell.split(',').map(Number);fretCell(c,r);return;}
    if(target.dataset.point!==undefined){selectPoint(Number(target.dataset.point));return;}
    if(target.dataset.barre!==undefined){selectBarre(Number(target.dataset.barre));return;}
    if(target.dataset.string!==undefined){customHistory();const c=Number(target.dataset.string);custom.shape.frets[c]=custom.shape.frets[c]===0?-1:0;custom.shape.fingers[c]='';custom.shape.barres=custom.shape.barres.filter(b=>c<b.from||c>b.to);custom.selected=null;custom.finger='';renderCustom();return;}
    const action=target.dataset.action;
    switch(action){
      case 'apply':applyDraft();break;
      case 'delete':deleteChord();break;
      case 'undo':history('undo');break;
      case 'redo':history('redo');break;
      case 'popover':popoverVisible=true;positionPopover();break;
      case 'close-popover':if(moreVisible)toggleMore(false);popoverVisible=false;positionPopover();$(`[data-target="${selected}"]`)?.focus();break;
      case 'more':toggleMore(!moreVisible);break;
      case 'library':openLibrary();break;
      case 'custom':openCustom();break;
      case 'close-modal':closeModal();break;
      case 'library-use':useLibrary();break;
      case 'library-custom':{const e=libraryEntry();if(e)openCustom({name:e.name,shape:libraryVariant(e)});break;}
      case 'library-clear':library.query='';library.root='';library.type='';$('#library-search').value='';$('#library-root').value='';$('#library-type').value='';renderLibrary();break;
      case 'custom-undo':customUndoRedo('undo');break;
      case 'custom-redo':customUndoRedo('redo');break;
      case 'custom-done':customDone();break;
      case 'custom-save':customSave();break;
      case 'locate':$(`[data-target="${selected}"]`).scrollIntoView({block:'center'});positionPopover();break;
      case 'zoom-in':zoom=Math.min(200,zoom+25);$('#zoom-label').textContent=zoom+'%';toast('谱面缩放 '+zoom+'%');break;
      case 'zoom-out':zoom=Math.max(75,zoom-25);$('#zoom-label').textContent=zoom+'%';toast('谱面缩放 '+zoom+'%');break;
      case 'demo':toast('当前为静态交互原型');break;
    }
  });
  document.addEventListener('input',event=>{
    const el=event.target;
    if(el.id==='side-name'||el.id==='popover-name'){draft.name=el.value;refreshDraft(el.id==='side-name'?'side':'popover');}
    else if(el.id==='more-search')renderMore();
    else if(el.id==='library-search'){library.query=el.value;renderLibrary();}
    else if(el.id==='custom-name'){custom.name=el.value;$('#fret-name').textContent=custom.name||'—';validateCustom('name');}
    else if(el.id==='start-fret'){
      const value=Number(el.value);
      if(Number.isInteger(value)&&value>=1&&value<=20){if(value!==custom.shape.start){customHistory();custom.shape.start=value;}renderCustom();}
      else validateCustom('start');
    }
  });
  document.addEventListener('change',event=>{
    const el=event.target;
    if(el.name==='display'){draft.display=el.value;refreshDraft();}
    else if(el.id==='score-key'){scoreKey=el.value;$('#score-key-label').textContent=scoreKey==='Am'?'6=A':'1='+scoreKey;refreshDraft();}
    else if(el.id==='library-root'){library.root=el.value;renderLibrary();}
    else if(el.id==='library-type'){library.type=el.value;renderLibrary();}
    else if(el.id==='browse-root'){library.browseRoot=el.value;renderLibrary();}
    else if(el.id==='browse-mode'){library.mode=el.value;renderLibrary();}
    else if(el.id==='finger-selector')setFinger(el.value);
  });
  document.addEventListener('keydown',event=>{
    const editing=event.target.matches('input,textarea,select,[contenteditable="true"]');
    const modal=modalStack.at(-1);
    if(event.key==='Escape') {
      event.preventDefault();
      if(custom?.pending){custom.pending=null;renderCustom();return;}
      if(modal){closeModal();return;}
      if(moreVisible){toggleMore(false);$('[data-action="more"]').focus();return;}
      if(popoverVisible){popoverVisible=false;positionPopover();$(`[data-target="${selected}"]`)?.focus();}return;
    }
    if(modal && event.key==='Tab') {
      const focusable=$$('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]',modal.overlay).filter(el=>!el.hidden&&el.getClientRects().length);
      const first=focusable[0],last=focusable.at(-1);
      if(event.shiftKey&&(document.activeElement===first||!modal.overlay.contains(document.activeElement))){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&(document.activeElement===last||!modal.overlay.contains(document.activeElement))){event.preventDefault();first?.focus();}
    }
    if(editing)return;
    if(custom&&/^[0-4tT]$/.test(event.key)){event.preventDefault();setFinger(event.key==='0'?'':event.key.toUpperCase());return;}
    if((event.key==='Enter'||event.key===' ')&&event.target.matches('[data-cell],[data-point],[data-barre],[data-string]')){event.preventDefault();event.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));return;}
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z'){event.preventDefault();if(custom)customUndoRedo(event.shiftKey?'redo':'undo');else history(event.shiftKey?'redo':'undo');}
  });
  document.addEventListener('focusin',event=>{
    const modal=modalStack.at(-1);if(modal&&!modal.overlay.contains(event.target)&&!event.target.closest('#toast'))modal.overlay.querySelector('input,button,select')?.focus();
  });
  window.addEventListener('resize',positionPopover);$('.score-workspace').addEventListener('scroll',positionPopover);
  renderScore();refreshDraft();positionPopover();
  const scene=new URLSearchParams(location.search).get('scene');
  if(scene==='library')openLibrary();else if(scene==='custom')openCustom();else if(scene==='more')toggleMore(true);
})();
