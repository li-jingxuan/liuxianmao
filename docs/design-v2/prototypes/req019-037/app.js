/* 独立设计原型：所有数据仅在本页内存中，不连接产品，不持久化。 */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const icons = {
  undo:'<path d="M8 7H3V2m0 5a9 9 0 1 1-1 9"/>',
  redo:'<path d="M16 7h5V2m0 5a9 9 0 1 0 1 9"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  check:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  locate:'<circle cx="12" cy="12" r="6"/><path d="M12 2v5m0 10v5M2 12h5m10 0h5"/>',
  empty:'<path d="M5 8h14v13H5zM8 8V4h8v4M9 13h6m-6 4h4"/>',
};
const icon = name => `<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.empty}</svg>`;
const definitions = {
  C:{frets:[-1,3,2,0,1,0],fingers:['',3,2,'',1,'']},
  G:{frets:[3,2,0,0,0,3],fingers:[2,1,'','','',3]},
  Am:{frets:[-1,0,2,2,1,0],fingers:['','',2,3,1,'']},
  F:{frets:[1,3,3,2,1,1],fingers:[1,3,4,2,1,1],barre:true},
  Dm:{frets:[-1,-1,0,2,3,1],fingers:['','','',2,3,1]},
  Em:{frets:[0,2,2,0,0,0],fingers:['',2,3,'','','']},
  G7:{frets:[3,2,0,0,0,1],fingers:[3,2,'','','',1]},
  Cmaj7:{frets:[-1,3,2,0,0,0],fingers:['',3,2,'','','']},
  Bdim:{frets:[-1,2,3,4,3,-1],fingers:['',1,2,4,3,'']},
  Dm7:{frets:[-1,-1,0,2,1,1],fingers:['','','',2,1,1]},
  Em7:{frets:[0,2,0,0,0,0],fingers:['',2,'','','','']},
  Fmaj7:{frets:[-1,-1,3,2,1,0],fingers:['','',3,2,1,'']},
  Am7:{frets:[-1,0,2,0,1,0],fingers:['','',2,'',1,'']},
  Bm7b5:{frets:[-1,2,3,2,3,-1],fingers:['',1,3,2,4,'']},
  D:{frets:[-1,-1,0,2,3,2],fingers:['','','',1,3,2]},
  A:{frets:[-1,0,2,2,2,0],fingers:['','',1,2,3,'']},
  E:{frets:[0,2,2,1,0,0],fingers:['',2,3,1,'','']},
  Bm:{frets:[-1,2,4,4,3,2],fingers:['',1,3,4,2,1]},
  B7:{frets:[-1,2,1,2,0,2],fingers:['',2,1,3,'',4]},
  Fsharpdim:{frets:[2,3,4,2,-1,-1],fingers:[1,2,4,1,'','']},
};
const quickNames = ['C','G','Am','F','Dm','Em','G7','Cmaj7'];
const degreeC = {C:'I',Dm:'ii',Em:'iii',F:'IV',G:'V',Am:'vi',Bdim:'vii°',Cmaj7:'Imaj7',Dm7:'ii7',Em7:'iii7',Fmaj7:'IVmaj7',G7:'V7',Am7:'vi7',Bm7b5:'viiø7'};
const degreeG = {G:'I',Am:'ii',Bm:'iii',C:'IV',D:'V',Em:'vi',Fsharpdim:'vii°'};
const degreeAm = {Am:'i',Bdim:'ii°',C:'III',Dm:'iv',Em:'v',F:'VI',G:'VII',E:'V',B7:''};
const clone = value => JSON.parse(JSON.stringify(value));
let state;
let toastTimer;
let lastFocus;
let nativeMenuOpen=false;
function freshState(){
  return {scene:'editor',context:'single',tab:'chord',beat:0,popover:true,more:false,draft:{name:'G',shape:'G',display:'diagram'},score:{0:{name:'G',shape:'G',display:'diagram'},1:{name:'C',shape:'C',display:'diagram'},2:{name:'',shape:null,display:'diagram'}},scoreUndo:[],scoreRedo:[],libraryTab:'all',libraryKey:'C',libraryMode:'major',librarySearch:'',libraryRoot:'all',libraryType:'all',librarySelected:'F',libraryVersion:0,libraryOrigin:'editor',my:[],custom:null,customReturn:null,dialog:null,techSize:7,focusOuter:true};
}
function diagram(shape, customData){
  const def = customData || definitions[shape] || definitions.C;
  const frets = def.frets || definitions.C.frets;
  const fingers = def.fingers || [];
  const start = def.start || Math.max(1,Math.min(...frets.filter(f => f > 0)) > 3 ? Math.min(...frets.filter(f => f > 0)) : 1);
  let out = '<svg class="diagram" viewBox="0 0 78 86" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1">';
  for(let i=0;i<6;i++)out+=`<path d="M${12+i*11} 22v50"/>`;
  for(let i=0;i<5;i++)out+=`<path d="M12 ${22+i*12.5}h55" stroke-width="${i===0&&start===1?2.3:1}"/>`;
  if(start>1)out+=`<text x="3" y="32" fill="currentColor" stroke="none" font-size="8">${start}</text>`;
  frets.forEach((f,i)=>{
    const x=12+i*11;
    if(f<0)out+=`<path d="m${x-2} 13 4 4m-4 0 4-4" stroke-width=".8"/>`;
    else if(f===0)out+=`<circle cx="${x}" cy="15" r="2.3" stroke-width=".8"/>`;
    else{const y=22+(f-start+.5)*12.5;if(y<78&&y>20)out+=`<circle cx="${x}" cy="${y}" r="4.5" fill="currentColor"/><text x="${x}" y="${y+2.6}" fill="white" stroke="none" font-size="7.5" text-anchor="middle" font-family="Arial">${esc(fingers[i]||'')}</text>`;}
  });
  if(def.barre)out+='<path d="M12 28h55" stroke-width="6" stroke-linecap="round"/>';
  return out+'</svg>';
}
function draftShape(){return state.draft.custom || null;}
function sameDraft(){return JSON.stringify(state.draft)===JSON.stringify(state.score[state.beat]||{name:'',shape:null,display:'diagram'});}
function validContext(){return state.context==='single'||state.context==='empty';}
function tile(name){return `<button class="chord-tile ${state.draft.name===name?'chosen':''}" data-preset="${name}" aria-label="${name} 和弦，回填草稿" aria-pressed="${state.draft.name===name}">${diagram(name)}<span>${name}</span></button>`;}
function applyField(id){return `<div class="input-apply"><input id="${id}" data-draft-name aria-label="和弦名称" placeholder="输入和弦名称" autocomplete="off" value="${esc(state.draft.name)}"><button class="primary apply-button" data-action="apply" ${sameDraft()||!state.draft.name.trim()?'disabled':''}>应用</button></div>`;}
function searchBox(id,placeholder,value=''){return `<label class="search-box">${icon('search')}<input id="${id}" aria-label="${placeholder}" placeholder="${placeholder}" value="${esc(value)}" autocomplete="off"></label>`;}
function renderSidebar(){
  $$('.side-tabs button').forEach(b=>{b.classList.toggle('active',b.dataset.tab===state.tab);b.setAttribute('aria-selected',b.dataset.tab===state.tab);});
  if(state.tab!=='chord'){
    const names={selection:'选区',lyrics:'简谱与歌词',song:'歌曲'};
    $('#sidebar-content').innerHTML=`<div class="other-tab"><h3>${names[state.tab]}</h3><p>当前工具保持打开。<br>选择 TAB 拍点后，点击「和弦」页签即可编辑对应和弦。</p><div class="context-pill">${contextText()}</div><p>此处仅演示切换和弦时不抢占其他页签。</p></div>`;
    return;
  }
  const context=`<div class="side-context"><div><strong>${state.context==='empty'?'新增 TAB 和弦':'TAB 和弦'}</strong><span>${contextText()}</span></div>${validContext()?`<button class="text-button" data-action="locate">${icon('locate')}定位</button>`:''}</div>`;
  if(!validContext()){
    $('#sidebar-content').innerHTML=context+`<div class="side-empty">${icon('locate')}<h3>${state.context==='multi'?'请选择一个 TAB 拍点':'先选择 TAB 拍点'}</h3><p>${state.context==='multi'?'当前选中了多个拍点。选择单个拍点后，<br>即可编辑它的和弦。':'点击六线谱中的单个拍点，<br>在这里设置和弦名称与指法。'}</p></div>`;
    return;
  }
  const preview=state.draft.shape?`<div class="compact-preview"><div class="preview-info"><div class="preview-name" data-preview-name>${esc(state.draft.name||'未命名')}</div><small>标准调弦　E A D G B E</small></div>${diagram(state.draft.shape,draftShape())}<button class="text-button" data-action="open-custom">编辑指法</button></div>`:'';
  $('#sidebar-content').innerHTML=context+`<div class="side-body">${preview}<section class="field-group"><div class="label-row"><label for="side-name">和弦名称</label><button class="danger-button" data-action="delete" ${!state.draft.name&&!state.score[state.beat]?.name?'disabled':''}>删除</button></div>${applyField('side-name')}</section><section><div class="label-row"><h3>常用和弦</h3><button class="text-button" data-action="open-library">更多配置</button></div><p class="key-caption">曲谱 C 大调 · 1=C</p><div class="quick-grid">${quickNames.map(tile).join('')}</div></section><section class="display-field"><label>谱面显示</label><div class="radio-row"><label><input type="radio" name="display" value="name" ${state.draft.display==='name'?'checked':''}>仅名称</label><label><input type="radio" name="display" value="diagram" ${state.draft.display==='diagram'?'checked':''}>名称与指法</label></div></section>${!state.draft.shape?'<button class="text-button" style="margin-top:14px;font-size:12px" data-action="open-custom">创建自定义指法</button>':''}</div>`;
}
function renderPopover(){
  const el=$('#popover');el.hidden=!state.popover||!validContext()||state.scene!=='editor'||state.tab!=='chord';
  if(el.hidden)return;
  el.innerHTML=`<div class="popover-header"><strong>${state.context==='empty'?'新增和弦':'编辑和弦'}</strong><span>TAB · ${contextText()}</span><button class="icon-button close-button" data-action="close-popover" aria-label="关闭和弦气泡">×</button></div><label for="pop-name" class="popover-label">和弦名称</label>${applyField('pop-name')}<div class="popover-quick-label"><strong>常用和弦</strong><span>C 大调</span></div><div class="inline-quick">${quickNames.slice(0,6).map(n=>`<button data-preset="${n}" class="${state.draft.name===n?'chosen':''}">${n}</button>`).join('')}<button data-action="more" aria-expanded="${state.more}">更多 ⌄</button></div>${state.draft.shape?`<div class="popover-preview">${diagram(state.draft.shape,draftShape())}<div><strong>当前指法</strong><p>${esc(state.draft.name)} · ${state.draft.custom?'自定义指法':'标准调弦'}</p><button class="text-button" data-action="open-custom">编辑指法 →</button></div></div>`:''}<div class="more-dropdown" ${state.more?'':'hidden'}>${searchBox('more-search','搜索全部和弦，如 Bm、G7')}<div class="dropdown-heading"><strong>和弦推荐</strong><button class="text-button" data-action="open-library">和弦库 &gt;</button></div><div class="quick-grid" id="more-grid">${quickNames.map(tile).join('')}</div></div>`;
  const positions=[113,299,467];el.style.left=`${positions[state.beat]||113}px`;
}
function contextText(){if(state.context==='none')return '未选择拍点';if(state.context==='multi')return '已选择 3 个 TAB 拍点';return `第 1 小节 · 第 ${state.beat+1} 拍`;}
function renderStatus(){
  $('#status-context').textContent=`TAB · ${contextText()}`;
  $('#status-draft').textContent=validContext()&&!sameDraft()?'草稿有修改':'';
  $$('.apply-button').forEach(b=>b.disabled=sameDraft()||!state.draft.name.trim());
  $('#score-undo').disabled=!state.scoreUndo.length;$('#score-redo').disabled=!state.scoreRedo.length;
}
function renderScore(){
  let svg='<svg class="score-svg" viewBox="0 0 880 530" role="img" aria-label="风吹过山谷六线谱示意，可点击前三个拍点">';
  const line=(x,y,x2,y2,width=1)=>`<path d="M${x} ${y}L${x2} ${y2}" fill="none" stroke="currentColor" stroke-width="${width}"/>`;
  for(let row=0;row<2;row++){
    const top=108+row*260;
    for(let s=0;s<6;s++)svg+=line(10,top+s*12,870,top+s*12,.9);
    for(let m=0;m<5;m++)svg+=line(10+m*215,top,10+m*215,top+60,m===4?1.7:1);
    svg+=`<text x="15" y="${top+10}" font-size="11">T</text><text x="15" y="${top+34}" font-size="11">A</text><text x="15" y="${top+58}" font-size="11">B</text>`;
    for(let m=0;m<4;m++){
      const base=38+m*215;
      for(let n=0;n<7;n++){
        const x=base+n*26,y=top+12+((n+m+row)%4)*12;
        svg+=`<rect x="${x-5}" y="${y-9}" width="11" height="13" fill="white"/><text x="${x}" y="${y+2}" font-size="12" text-anchor="middle">${[0,2,'×',3,'×',0,2][(n+m)%7]}</text>`;
        svg+=line(x,top+63,x,top+94);
        if(n%2===0&&n<6)svg+=line(x,top+94,x+26,top+94,2.2);
      }
      for(let n=0;n<4;n++){
        const x=base+10+n*48;
        svg+=`<text x="${x}" y="${top+133}" font-size="15" text-anchor="middle">${[1,2,3,5,5,6,7,1][(n+m+row)%8]}</text><text x="${x}" y="${top+166}" font-size="13" text-anchor="middle">${(row?['歌','声','轻','响','余','音','绵','长']:['轻','轻','唱','起','旋','律','随','风'])[(n+m)%8]}</text>`;
      }
      const tech=[['H','P','S','P.M.'],['let ring','A.H.','T','tr']][row][m];
      const techX=base+38;
      if(tech==='H'||tech==='P')svg+=`<path d="M${base+20} ${top+10}q18 -20 37 0" stroke="currentColor" fill="none" stroke-width="1"/>`;
      else if(tech==='S')svg+=line(base+20,top+10,base+57,top-2,.9);
      else if(tech==='P.M.'||tech==='let ring')svg+=`<path d="M${base+12} ${top-4}h${tech==='let ring'?86:65}v5" stroke="currentColor" fill="none" stroke-dasharray="3 3" stroke-width=".8"/>`;
      svg+=`<text class="score-technique-label" x="${techX}" y="${top-9}" font-size="${state.techSize*1.35}" text-anchor="middle">${tech}</text>`;
      let chordName=['G','C','Em','G'][m];let shape=chordName;let custom=null;let display='diagram';
      if(row===0&&m<3){const item=state.score[m];if(item){chordName=item.name;shape=item.shape;custom=item.custom;display=item.display;}}
      if(row===1)chordName=shape=['Am','D','G','C'][m];
      const chordX=base+24;
      if(chordName){svg+=`<g transform="translate(${chordX-22},${top-96})"><text x="24" y="10" fill="currentColor" font-size="13" text-anchor="middle">${esc(chordName)}</text>${shape&&display==='diagram'?`<g transform="translate(-3,8) scale(.7)">${diagram(shape,custom).replace('<svg class="diagram"','<svg width="78" height="86"')}</g>`:''}</g>`;}
    }
  }
  if(validContext()){
    const xs=[83,298,513],x=xs[state.beat];
    svg+=`<rect x="${x-16}" y="102" width="32" height="72" rx="3" fill="#285be00c" stroke="#285be0" stroke-width="1.3"/>`;
    if(state.score[state.beat]?.name)svg+=`<rect x="${x-22}" y="10" width="52" height="91" rx="5" fill="#285be00c" stroke="#285be0" stroke-width="1.2"/>`;
  }
  for(let i=0;i<3;i++)svg+=`<g class="beat-target" role="button" tabindex="0" data-beat="${i}" aria-label="选择第1小节第${i+1}拍${i===2?'空拍':''}"><rect class="beat-hit" x="${54+i*215}" y="8" width="72" height="177" rx="4" fill="transparent" stroke="transparent"/></g>`;
  $('#score-svg').innerHTML=svg+'</svg>';
}
function render(){
  renderScore();renderSidebar();renderPopover();renderStatus();
  $$('.scene-nav button').forEach(b=>{b.classList.toggle('selected',b.dataset.scene===state.scene);b.setAttribute('aria-current',b.dataset.scene===state.scene?'page':'false');});
  $$('[data-context]').forEach(b=>{b.classList.toggle('selected',b.dataset.context===state.context);b.setAttribute('aria-pressed',b.dataset.context===state.context);});
  $('#show-popover').checked=state.popover;
  $('#review-note').textContent=({editor:'019 / 020 / 035 / 036：紧凑布局与共享草稿',library:'021 / 031：名称与级数并排分组，详情固定',custom:'032 / 033 / 034：局部按点反馈与暂存往返',technique:'037：同类技巧文字统一调整，数值待设计确认'})[state.scene];
  if(state.scene==='editor')$('#scene-layer').innerHTML='';
  else if(state.scene==='library')renderLibrary();
  else if(state.scene==='custom')renderCustom();
  else renderTechnique();
  fitStage();
}
function setScene(scene){
  if(scene===state.scene)return;
  if(state.scene==='custom'&&isCustomDirty()){
    requestCustomExit(()=>{state.scene=scene;if(scene==='library')openLibrary('editor');else render();});return;
  }
  if(scene==='library'){openLibrary('editor');return;}
  if(scene==='custom'){openCustom();return;}
  state.scene=scene;render();
}
function setContext(type){
  if(state.scene!=='editor')return toast('请先返回编辑器审阅拍点状态');
  if(state.context===type&&(!validContext()||state.beat===(type==='empty'?2:0)))return;
  state.context=type;
  state.beat=type==='empty'?2:0;
  state.draft=clone(state.score[state.beat]||{name:'',shape:null,display:'diagram'});
  state.more=false;render();
}
function choosePreset(name,custom){
  state.draft.name=name;state.draft.shape=name;
  delete state.draft.custom;if(custom)state.draft.custom=clone(custom);
  state.more=false;render();toast(`已回填 ${name}，点击「应用」写入当前拍`);
}
function applyDraft(){
  if(!validContext()||!state.draft.name.trim()||sameDraft())return;
  state.scoreUndo.push(clone(state.score));state.scoreRedo=[];
  state.draft.name=state.draft.name.trim();state.score[state.beat]=clone(state.draft);state.context='single';render();toast(`已应用 ${state.draft.name} · ${contextText()}`);
}
function deleteChord(){
  if(!validContext())return;
  state.scoreUndo.push(clone(state.score));state.scoreRedo=[];
  state.draft={name:'',shape:null,display:'diagram'};state.score[state.beat]=clone(state.draft);state.context='empty';render();toast('已删除当前拍和弦');
}
function scoreHistory(direction){
  const src=direction==='undo'?state.scoreUndo:state.scoreRedo,dst=direction==='undo'?state.scoreRedo:state.scoreUndo;
  if(!src.length)return;dst.push(clone(state.score));state.score=src.pop();state.draft=clone(state.score[state.beat]);render();toast(direction==='undo'?'已撤销谱面修改':'已重做谱面修改');
}
function libraryGroups(){
  if(state.libraryTab==='mine')return [{title:'我的指法',items:state.my.map((item,index)=>({name:item.name,custom:item.shape,myIndex:index}))}];
  let groups;
  if(state.libraryMode==='minor')groups=[{title:'A 小调 · 自然三和弦',items:['Am','Bdim','C','Dm','Em','F','G']},{title:'和声小调补充',items:['E']},{title:'其他和弦',items:['G7','Cmaj7','B7']}];
  else if(state.libraryKey==='G')groups=[{title:'G 大调 · 自然三和弦',items:['G','Am','Bm','C','D','Em','Fsharpdim']},{title:'其他可搜索和弦',items:['Cmaj7','G7','A','E']}];
  else groups=[{title:'C 大调 · 自然三和弦',items:['C','Dm','Em','F','G','Am','Bdim']},{title:'调内七和弦',items:['Cmaj7','Dm7','Em7','Fmaj7','G7','Am7','Bm7b5']},{title:'其他和弦',items:['D','A','E','Bm','B7']}];
  return groups.map(g=>({...g,items:g.items.map(name=>({name}))}));
}
function degree(name){
  if(state.libraryTab==='mine')return '';
  return (state.libraryMode==='minor'?degreeAm:state.libraryKey==='G'?degreeG:degreeC)[name]||'';
}
function filterLibrary(item){
  const name=item.name.toLowerCase(),q=state.librarySearch.trim().toLowerCase();
  return (!q||name.includes(q))&&(state.libraryRoot==='all'||name.startsWith(state.libraryRoot.toLowerCase()))&&(state.libraryType==='all'||(state.libraryType==='seven'?name.includes('7'):!name.includes('7')));
}
function renderLibraryCards(){
  const groups=libraryGroups().map(g=>({...g,items:g.items.filter(filterLibrary)}));
  const count=groups.reduce((sum,g)=>sum+g.items.length,0);
  const el=$('#library-scroll');if(!el)return;
  if(!count){el.innerHTML=`<div class="library-empty">${icon('empty')}<h3>${state.libraryTab==='mine'&&!state.my.length?'还没有保存的指法':'没有找到匹配的和弦'}</h3><p>${state.libraryTab==='mine'&&!state.my.length?'在自定义指法中编辑并保存，下次就能从这里选用。':'试试其他和弦名称，或清除搜索和筛选条件。'}</p>${state.libraryTab==='mine'&&!state.my.length?'<button data-action="empty-create">创建自定义指法</button>':'<button data-action="clear-search">清除筛选</button>'}</div>`;}
  else el.innerHTML=groups.filter(g=>g.items.length).map(g=>`<section class="library-section"><h3 class="library-section-title">${g.title}<span>${g.items.length} 项</span></h3><div class="library-cards">${g.items.map(item=>`<button class="library-card ${state.librarySelected===(item.myIndex!==undefined?'my:'+item.myIndex:item.name)?'chosen':''}" data-library-item="${item.myIndex!==undefined?'my:'+item.myIndex:item.name}" aria-pressed="${state.librarySelected===(item.myIndex!==undefined?'my:'+item.myIndex:item.name)}">${diagram(item.name,item.custom)}<span class="card-text"><strong>${esc(item.name==='Fsharpdim'?'F♯dim':item.name)}</strong>${degree(item.name)?`<small>${degree(item.name)}</small>`:''}</span></button>`).join('')}</div></section>`).join('');
  renderLibraryDetail();
}
function selectedLibrary(){
  if(state.librarySelected?.startsWith('my:')){const item=state.my[+state.librarySelected.split(':')[1]];return item?{name:item.name,custom:item.shape}:null;}
  if(state.libraryTab==='mine')return null;
  return state.librarySelected?{name:state.librarySelected}:null;
}
function versionShape(item){
  if(item.custom)return item.custom;
  if(item.name==='F'&&state.libraryVersion===1)return {frets:[-1,8,10,10,10,8],fingers:['',1,3,3,3,1],start:8,barre:false};
  if(item.name==='F'&&state.libraryVersion===2)return {frets:[-1,-1,3,2,1,1],fingers:['','',3,2,1,1]};
  return definitions[item.name]||definitions.C;
}
function renderLibraryDetail(){
  const item=selectedLibrary(),el=$('#library-detail');
  $('#library-use').disabled=!item;
  if(!item){el.className='library-detail empty-detail';el.innerHTML='选择指法后在这里预览';return;}
  el.className='library-detail';
  const versions=item.name==='F'?[
    ['六弦根音 · 封闭指型','1 · 3 · 3 · 2 · 1 · 1'],
    ['五弦根音 · 封闭指型','× · 8 · 10 · 10 · 10 · 8'],
    ['四弦根音 · 小横按','× · × · 3 · 2 · 1 · 1'],
  ]:[[item.custom?'我的指法':'开放指型',versionShape(item).frets.map(f=>f<0?'×':f).join(' · ')]];
  el.innerHTML=`<div class="detail-title"><strong>${esc(item.name==='Fsharpdim'?'F♯dim':item.name)}</strong>${degree(item.name)?`<span class="degree">${degree(item.name)}</span>`:''}<small>标准调弦</small></div><div class="detail-diagram">${diagram(item.name,versionShape(item))}</div><h3>指法版本</h3>${versions.map((v,i)=>`<button class="version-button ${state.libraryVersion===i?'chosen':''}" data-version="${i}"><strong>${v[0]}</strong><small>${v[1]}　/　6 → 1 弦</small></button>`).join('')}<button class="text-button" data-action="custom-from-library">基于此指法自定义</button>`;
}
function renderLibrary(){
  const returning=state.libraryOrigin==='custom';
  $('#scene-layer').innerHTML=`<div class="scene-scrim"><section class="modal library-modal ${state.focusOuter?'':'no-outer-focus'}" role="dialog" aria-modal="true" aria-labelledby="library-title" tabindex="-1"><header class="modal-header"><div><h2 id="library-title">和弦库</h2><p>${returning?'当前自定义已暂存。选用其他指法前会确认替换；取消可恢复编辑。':'选择和弦与指法，带回当前编辑位置。'}</p><div class="context-pill">${returning?'返回目标：自定义指法':`回填位置：TAB · ${contextText()}`}</div></div><button class="icon-button close-button" data-action="close-library" aria-label="关闭和弦库">×</button></header><div class="library-body"><div class="library-main"><div class="library-tabs" role="tablist" aria-label="和弦来源"><button role="tab" data-library-tab="all" aria-selected="${state.libraryTab==='all'}" class="${state.libraryTab==='all'?'active':''}">全部和弦</button><button role="tab" data-library-tab="mine" aria-selected="${state.libraryTab==='mine'}" class="${state.libraryTab==='mine'?'active':''}">我的指法</button></div><div class="library-filter">${searchBox('library-search','搜索和弦名称，如 F#m7',state.librarySearch)}${state.libraryTab==='all'?`<select id="root-filter" aria-label="根音筛选"><option value="all">全部根音</option>${['C','D','E','F','G','A','B'].map(n=>`<option value="${n}" ${state.libraryRoot===n?'selected':''}>${n}</option>`).join('')}</select><select id="type-filter" aria-label="类型筛选"><option value="all">全部类型</option><option value="triad" ${state.libraryType==='triad'?'selected':''}>三和弦</option><option value="seven" ${state.libraryType==='seven'?'selected':''}>七和弦</option></select>`:''}</div>${state.libraryTab==='all'?`<div class="key-browse"><span>按调性浏览</span><select id="library-key" aria-label="浏览调性"><option value="C" ${state.libraryKey==='C'?'selected':''}>C</option><option value="G" ${state.libraryKey==='G'?'selected':''}>G</option><option value="A" ${state.libraryKey==='A'?'selected':''}>A</option></select><select id="library-mode" aria-label="大小调"><option value="major" ${state.libraryMode==='major'?'selected':''}>大调</option><option value="minor" ${state.libraryMode==='minor'?'selected':''}>小调</option></select><small>曲谱仍为 C 大调</small></div>`:''}<div class="library-scroll" id="library-scroll"></div><div class="focus-variant"><span>搜索外层焦点 · 待确认</span><button data-focus-outer="yes" class="${state.focusOuter?'selected':''}">保留常规焦点</button><button data-focus-outer="no" class="${!state.focusOuter?'selected':''}">仅键盘虚线</button></div>${state.libraryTab==='mine'?'<div class="review-inline">空状态审阅 <button class="text-button" data-action="empty-mine">清空本次演示收藏</button></div>':''}</div><aside class="library-detail" id="library-detail" aria-label="当前选择的固定详情"></aside></div><footer class="modal-footer"><p>${returning?'取消恢复暂存；选用先确认替换，仍需完成编辑并应用。':'选用只回填草稿，点击「应用」后写入谱面。'}</p><button data-action="close-library">${returning?'返回自定义':'取消'}</button><button class="primary" id="library-use" data-action="use-library">选用此指法</button></footer></section></div>`;
  renderLibraryCards();
}
function openLibrary(origin='editor'){
  if(origin==='editor'&&!validContext()){toast('请先选择一个 TAB 拍点');return;}
  if(origin==='custom'){
    state.customReturn=clone(state.custom);state.libraryTab='mine';state.librarySelected=state.my.length?'my:0':null;
  }else{state.libraryTab='all';state.librarySelected='F';}
  state.libraryOrigin=origin;state.librarySearch='';state.libraryRoot='all';state.libraryType='all';state.libraryVersion=0;state.scene='library';state.more=false;render();focusModal();
}
function closeLibrary(){
  if(state.libraryOrigin==='custom'&&state.customReturn){state.custom=clone(state.customReturn);state.scene='custom';state.customReturn=null;render();focusModal();}
  else{state.scene='editor';render();restoreFocus();}
}
function useLibrary(){
  const item=selectedLibrary();if(!item)return;
  const shape=clone(versionShape(item));
  if(state.libraryOrigin==='custom'){
    openDialog('replace',`<h2>替换当前自定义指法？</h2><p>选用「${esc(item.name)}」将替换暂存的自定义内容。替换后仍留在自定义编辑，不会直接应用到谱面。</p><div class="dialog-actions"><button data-dialog-action="cancel">取消</button><button class="primary" data-dialog-action="replace">确认替换</button></div>`,()=>{
      const saved=state.customReturn,loaded=makeCustom(item.name,shape);
      loaded.base=saved.base;loaded.origin=saved.origin;loaded.history=[...saved.history,customSnapshot(saved)];
      state.custom=loaded;state.customReturn=null;state.scene='custom';render();toast(`已载入 ${item.name}，可继续编辑`);
    });
  }else{state.scene='editor';choosePreset(item.name,shape);restoreFocus();}
}
function customData(custom=state.custom){
  const frets=clone(custom.opens),fingers=Array(6).fill('');
  custom.points.forEach(p=>{if(p.fret>frets[p.string]){frets[p.string]=p.fret;fingers[p.string]=p.finger||'';}});
  custom.barres.forEach(b=>{for(let s=b.from;s<=b.to;s++){if(b.fret>frets[s]){frets[s]=b.fret;fingers[s]=b.finger||'';}}});
  return {frets,fingers,start:custom.start,barre:custom.barres.some(b=>b.from===0&&b.to===5&&b.fret===custom.start)};
}
function makeCustom(name,shape){
  const s=shape||definitions.G;
  const custom={name:name||'G',points:[],barres:[],opens:s.frets.map(f=>f<0?-1:0),start:s.start||1,rawStart:String(s.start||1),error:'',mode:'press',finger:'',selected:null,barreAnchor:null,history:[],future:[],base:null,origin:'editor'};
  s.frets.forEach((f,string)=>{if(f>0)custom.points.push({string,fret:f,finger:String(s.fingers?.[string]||'')});});
  custom.base=customSnapshot(custom);return custom;
}
function customSnapshot(custom=state.custom){return JSON.stringify({name:custom.name,points:custom.points,barres:custom.barres,opens:custom.opens,start:custom.start,rawStart:custom.rawStart,error:custom.error});}
function isCustomDirty(){return state.custom&&customSnapshot()!==state.custom.base;}
function pushCustom(){state.custom.history.push(customSnapshot());state.custom.future=[];}
function restoreCustom(snapshot){Object.assign(state.custom,JSON.parse(snapshot));state.custom.selected=null;state.custom.barreAnchor=null;}
function openCustom(name,shape,origin='editor'){
  if(!validContext()){toast('请先选择一个 TAB 拍点');return;}
  const item=name?{name,shape}:state.draft;
  state.custom=makeCustom(item.name||'G',shape||item.custom||definitions[item.shape]||definitions.G);state.custom.origin=origin;
  state.scene='custom';state.more=false;render();focusModal();
}
function renderCustom(){
  const c=state.custom;if(!c)return;
  $('#scene-layer').innerHTML=`<div class="scene-scrim"><section class="modal custom-modal" role="dialog" aria-modal="true" aria-labelledby="custom-title" tabindex="-1"><header class="modal-header"><div><h2 id="custom-title">自定义指法</h2></div><span class="header-error" id="custom-error" role="status"></span><button class="icon-button close-button" data-action="close-custom" aria-label="关闭自定义指法">×</button></header><div class="custom-body"><section class="fret-panel"><div class="custom-toolbar"><strong id="custom-toolbar-name">${esc(c.name)}</strong>${[['press','按弦'],['barre','横按'],['erase','擦除']].map(([m,t])=>`<button data-mode="${m}" class="${c.mode===m?'active':''}" aria-pressed="${c.mode===m}">${t}</button>`).join('')}<button class="icon-button" data-action="custom-undo" aria-label="撤销指法修改" title="撤销" ${c.history.length?'':'disabled'}>${icon('undo')}</button><button class="icon-button" data-action="custom-redo" aria-label="重做指法修改" title="重做" ${c.future.length?'':'disabled'}>${icon('redo')}</button><label>起始品位 <input id="start-fret" type="number" min="1" max="20" value="${c.start}" aria-label="起始品位"></label></div><div class="fretboard" id="fretboard"><div class="fret-grid">${Array.from({length:30},(_,i)=>{
    const string=i%6,fret=Math.floor(i/6)+c.start,point=c.points.find(p=>p.string===string&&p.fret===fret),key=`${string}:${fret}`;
    return `<button class="fret-cell ${point?'occupied':''} ${c.selected===key?'selected':''}" data-cell="${key}" aria-label="${6-string}弦 ${fret}品${point?'，按点':''}" aria-pressed="${c.selected===key}">${point?`<span class="finger">${esc(point.finger)}</span>`:''}</button>`;
  }).join('')}${c.barres.map((b,i)=>`<span class="barre-mark ${c.selected==='barre:'+i?'selected':''}" style="top:${(b.fret-c.start)*52+15}px;left:${b.from*55+16.5}px;width:${(b.to-b.from)*55+22}px"></span>`).join('')}</div>${Array.from({length:5},(_,i)=>`<span class="fret-number" style="top:${58+i*52}px">${i+c.start}</span>`).join('')}${Array.from({length:6},(_,i)=>`<button class="string-state" style="left:${83.5+i*55}px" data-string-state="${i}" aria-label="${6-i}弦 ${c.opens[i]<0?'不发声':'空弦'}，点击切换">${c.opens[i]<0?'×':'○'}</button><span class="string-label" style="left:${83.5+i*55}px">${6-i} 弦</span>`).join('')}</div><label class="finger-picker">按弦手指 <select id="finger-select" aria-label="按弦手指">${[['','未指定'],['1','1 · 食指'],['2','2 · 中指'],['3','3 · 无名指'],['4','4 · 小指'],['T','T · 拇指']].map(([v,t])=>`<option value="${v}" ${selectedFinger()===v?'selected':''}>${t}</option>`).join('')}</select></label><p class="keyboard-hint">选中按点后 <kbd>1–4</kbd> 手指　<kbd>T</kbd> 拇指　<kbd>0</kbd> 未指定</p></section><aside class="custom-side"><label for="custom-name">和弦名称</label><input id="custom-name" value="${esc(c.name)}" autocomplete="off"><div class="valid-preview"><div class="valid-header"><strong>有效指法预览</strong><span>指法有效</span></div><div id="custom-diagram">${diagram(c.name,customData())}</div></div><button class="wide" data-action="save-mine">另存为我的指法</button><button class="text-button view-mine" data-action="view-mine">查看我的指法 &gt;</button><div class="proposal" style="border-color:#c5d4ec;color:#66778f"><strong style="color:#586b88">已确认 · 暂存往返</strong>打开我的指法时暂存当前编辑。取消返回恢复；选用其他指法先确认替换，仍需完成并应用。</div></aside></div><footer class="modal-footer"><p>完成后回填草稿，点击「应用」写入谱面。</p><button data-action="close-custom">取消</button><button class="primary" data-action="finish-custom">完成编辑</button></footer></section></div>`;
  $('.custom-body').insertAdjacentHTML('beforebegin','<div class="return-flow" aria-label="我的指法往返流程"><strong>我的指法往返</strong><span>当前编辑自动暂存</span>›<span>查看我的指法</span>›<span>返回恢复原编辑</span><small>选用其他指法前确认替换</small></div>');
  const rawInput=$('#start-fret');rawInput.type='text';rawInput.inputMode='numeric';rawInput.value=c.rawStart;
  $('#custom-error').textContent=c.error;
  $('.valid-header span').textContent=c.error?'待修正':'指法有效';
  $('.valid-header span').style.color=c.error?'var(--danger)':'var(--green)';
}
function selectedFinger(){const c=state.custom;if(c.selected?.startsWith('barre:'))return c.barres[+c.selected.split(':')[1]]?.finger||'';const point=c.points.find(p=>`${p.string}:${p.fret}`===c.selected);return point?point.finger:c.finger;}
function renderCustomPreview(){
  $('#custom-toolbar-name').textContent=state.custom.name;
  $('#custom-diagram').innerHTML=diagram(state.custom.name,customData());
}
function editCell(key){
  const c=state.custom,[string,fret]=key.split(':').map(Number),existing=c.points.findIndex(p=>p.string===string&&p.fret===fret);
  if(c.mode==='erase'){
    const barre=c.barres.findIndex(b=>b.fret===fret&&string>=b.from&&string<=b.to);
    if(existing<0&&barre<0)return;
    pushCustom();if(existing>=0)c.points.splice(existing,1);if(barre>=0)c.barres.splice(barre,1);c.selected=null;
  }else if(c.mode==='barre'){
    if(!c.barreAnchor){c.barreAnchor={string,fret};c.selected=key;renderCustom();$('#custom-error').textContent='再点同一品的另一根弦，设置横按范围';return;}
    if(c.barreAnchor.fret!==fret){$('#custom-error').textContent='横按的起点与终点需在同一品';return;}
    if(c.barreAnchor.string===string){$('#custom-error').textContent='请选择另一根弦';return;}
    pushCustom();c.barres.push({from:Math.min(string,c.barreAnchor.string),to:Math.max(string,c.barreAnchor.string),fret,finger:c.finger});c.selected='barre:'+(c.barres.length-1);c.barreAnchor=null;
  }else{
    if(existing<0){pushCustom();c.points=c.points.filter(p=>p.string!==string);c.points.push({string,fret,finger:c.finger});}
    c.selected=key;
  }
  renderCustom();
}
function changeFinger(finger){
  const c=state.custom;
  if(c.selected?.startsWith('barre:')){const item=c.barres[+c.selected.split(':')[1]];if(item&&item.finger!==finger){pushCustom();item.finger=finger;}}
  else{const item=c.points.find(p=>`${p.string}:${p.fret}`===c.selected);if(item&&item.finger!==finger){pushCustom();item.finger=finger;}else if(!item)c.finger=finger;}
  renderCustom();
}
function customHistory(direction){
  const c=state.custom,src=direction==='undo'?c.history:c.future,dst=direction==='undo'?c.future:c.history;
  if(!src.length)return;dst.push(customSnapshot());restoreCustom(src.pop());renderCustom();
}
function exitCustom(){
  const origin=state.custom?.origin;
  if(origin==='library'){state.scene='library';render();focusModal();}
  else{state.scene='editor';render();restoreFocus();}
}
function requestCustomExit(next=exitCustom){
  if(!isCustomDirty()){next();return;}
  openDialog('discard','<h2>放弃当前修改？</h2><p>当前自定义指法有未完成的修改。放弃后返回上一层，父级和弦草稿保持不变。</p><div class="dialog-actions"><button class="primary" data-dialog-action="cancel">继续编辑</button><button data-dialog-action="discard">放弃修改</button></div>',next);
}
function finishCustom(){
  if(state.custom.error){$('#custom-error').textContent=state.custom.error;return;}
  const c=state.custom;if(!c.name.trim()){$('#custom-error').textContent='请输入和弦名称';$('#custom-name').focus();return;}
  state.draft={...state.draft,name:c.name.trim(),shape:c.name.trim(),custom:customData()};state.scene='editor';render();toast('自定义指法已回填，点击「应用」写入当前拍');restoreFocus();
}
function saveMine(){
  if(state.custom.error){$('#custom-error').textContent=state.custom.error;return;}
  const c=state.custom;if(!c.name.trim()){$('#custom-error').textContent='请输入和弦名称';return;}
  state.my.push({name:c.name.trim(),shape:clone(customData())});toast(`已保存 ${c.name.trim()} 到我的指法`);
}
function techniqueSVG(size,compact=false){
  const texts=['H','P','S','P.M.','let ring','A.H.','T','tr','full','N.H.','1/2','tap'];
  const width=compact?500:540,height=compact?95:307;
  let out=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${size}布局单位技巧文字预览" fill="#202838">`;
  const rows=compact?1:4;
  for(let r=0;r<rows;r++){
    const y=compact?33:35+r*72;
    for(let s=0;s<6;s++)out+=`<path d="M8 ${y+s*5}H${width-8}" stroke="#566071" stroke-width=".65"/>`;
    const subset=compact?['H','P','P.M.','A.H.','let ring']:texts.slice(r*3,r*3+3);
    subset.forEach((t,i)=>{
      const x=compact?30+i*98:45+i*173;
      const units=t==='N.H.'?Math.max(6,8*size/9):t==='1/2'?6:size;
      const actual=compact?units:units*1.65;
      out+=`<rect x="${x-5}" y="${y+1}" width="12" height="11" fill="white"/><text x="${x}" y="${y+10}" text-anchor="middle" font-size="11" font-family="Arial">${i===2?'7':'2'}</text><rect x="${x+38}" y="${y+1}" width="12" height="11" fill="white"/><text x="${x+43}" y="${y+10}" text-anchor="middle" font-size="11" font-family="Arial">${i===2?'9':'0'}</text>`;
      if(['H','P','S'].includes(t))out+=t==='S'?`<path d="M${x+5} ${y+6}l31 -8" stroke="#202838" fill="none" stroke-width=".8"/>`:`<path d="M${x} ${y+2}q21 -18 43 0" stroke="#202838" fill="none" stroke-width=".8"/>`;
      if(t==='P.M.'||t==='let ring')out+=`<path d="M${x-4} ${y-8}h68v5" stroke="#202838" stroke-dasharray="3 3" fill="none" stroke-width=".8"/>`;
      if(t==='full')out+=`<path d="M${x+4} ${y+5}q23 -1 29 -22m-3 4 3-4 1 6" stroke="#202838" fill="none" stroke-width=".9"/>`;
      out+=`<text x="${x+20}" y="${y-9}" text-anchor="middle" font-family="Arial,sans-serif" font-size="${actual}" font-weight="400">${t}</text>`;
      out+=`<path d="M${x} ${y+28}v17h43v-17" stroke="#202838" stroke-width="1" fill="none"/>`;
    });
  }
  return out+'</svg>';
}
function renderTechnique(){
  $('#scene-layer').innerHTML=`<div class="scene-scrim"><section class="modal technique-modal" role="dialog" aria-modal="true" aria-labelledby="tech-title" tabindex="-1"><header class="modal-header"><div><h2 id="tech-title">谱面技巧文字 · 字号对比</h2><p>已确认范围：H / P / S、P.M.、let ring、A.H.、T、tr、推弦文本等同类技巧文字。工具栏维持 13px。</p></div><button class="icon-button close-button" data-action="close-scene" aria-label="关闭字号预览">×</button></header><div class="technique-body"><div class="technique-settings"><span>拟议字号</span><input id="tech-size" aria-label="拟议谱面技巧字号" type="range" min="6" max="8" step="0.5" value="${state.techSize}"><strong id="tech-value">${state.techSize} 布局单位</strong><button data-tech-preset="6.5" class="${state.techSize===6.5?'primary':''}">6.5</button><button data-tech-preset="7" class="${state.techSize===7?'primary':''}">7</button><small>拟议参数 · 待设计稿确认</small></div><div class="technique-comparison"><section class="technique-sample"><h3>原有字号 <span>9 布局单位</span></h3>${techniqueSVG(9)}<p class="sample-description">原有大部分技巧文字为 9；自然泛音原为 8。<br>H / P 碰撞时可回退至 6，此处展示无碰撞状态。</p></section><section class="technique-sample"><h3>拟议字号 <span id="tech-proposed-label">${state.techSize} 布局单位 · 约 ${Math.round(state.techSize/9*100)}%</span></h3><div id="tech-proposed">${techniqueSVG(state.techSize)}</div><p class="sample-description">统一缩小同类谱面文字；技巧本身、连线与拍点位置保持。<br>full 为推弦文本示例，比例按设计预览拟议。</p></section></div><div class="print-strip"><div><div class="strip-header"><strong>编辑视图 · 拟议</strong><span>同一字号规则</span></div><div id="tech-edit">${techniqueSVG(state.techSize,true)}</div></div><div><div class="strip-header"><strong>印刷预览 · 拟议</strong><span>同一字号规则</span></div><div id="tech-print">${techniqueSVG(state.techSize,true)}</div></div></div></div><footer class="modal-footer"><p>示意为局部排版；正式碰撞策略与印刷清晰度须在实现后回归验证。</p><button data-action="close-scene">返回编辑器</button></footer></section></div>`;
  $('[data-tech-preset="7"]').textContent='7 · 推荐';
  $('[data-tech-preset="6.5"]').textContent='6.5 · 备选';
  $$('.technique-sample .sample-description')[1].innerHTML='自然泛音原 8 按同比例缩小，最低 6；已有内嵌 6 不再缩小。<br>命中范围不缩小；full 为推弦文本，1/2 演示原有内嵌 6。';
}
function changeTech(size){
  state.techSize=Number(size);$('#tech-value').textContent=`${state.techSize} 布局单位`;
  $('#tech-proposed-label').textContent=`${state.techSize} 布局单位 · 约 ${Math.round(state.techSize/9*100)}%`;
  $('#tech-proposed').innerHTML=techniqueSVG(state.techSize);$('#tech-edit').innerHTML=techniqueSVG(state.techSize,true);$('#tech-print').innerHTML=techniqueSVG(state.techSize,true);$('#tech-size').value=state.techSize;
  $$('[data-tech-preset]').forEach(b=>b.classList.toggle('primary',Number(b.dataset.techPreset)===state.techSize));renderScore();
}
function openDialog(kind,html,confirm){
  state.dialog={kind,confirm,focus:document.activeElement};
  $('#dialog-layer').innerHTML=`<div class="dialog-scrim"><section class="confirm-dialog" role="alertdialog" aria-modal="true" aria-label="${kind==='discard'?'放弃当前修改确认':kind==='replace'?'替换指法确认':'设计口径说明'}" tabindex="-1">${html}</section></div>`;
  $('.confirm-dialog button')?.focus();
}
function closeDialog(){const old=state.dialog;state.dialog=null;$('#dialog-layer').innerHTML='';old?.focus?.isConnected?old.focus.focus():$('.modal .close-button')?.focus();}
function focusModal(){lastFocus=document.activeElement;$('.modal')?.focus({preventScroll:true});}
function restoreFocus(){if(lastFocus?.isConnected)lastFocus.focus({preventScroll:true});}
function toast(message){clearTimeout(toastTimer);$('#toast').innerHTML=icon('check')+`<span>${esc(message)}</span>`;$('#toast').hidden=false;toastTimer=setTimeout(()=>{$('#toast').hidden=true;},2500);}
function fitStage(){
  const stage=$('#stage'),viewport=$('#viewport');
  if(innerWidth<=700){stage.style.transform='none';viewport.style.height='auto';return;}
  const selected=$('#review-zoom').value,available=viewport.clientWidth-36;
  const scale=selected==='fit'?Math.min(1,available/1400):Number(selected);
  stage.style.transform=`scale(${scale})`;viewport.style.height=`${910*scale}px`;
  stage.style.marginLeft=selected==='fit'?`${Math.max(0,(available-1400*scale)/2)}px`:'0';
}
document.addEventListener('click',event=>{
  const target=event.target.closest('button,[data-beat]');if(!target)return;
  if(target.dataset.scene){setScene(target.dataset.scene);return;}
  if(target.dataset.context){setContext(target.dataset.context);return;}
  if(target.dataset.beat!==undefined){
      const nextBeat=Number(target.dataset.beat);
      if(validContext()&&state.beat===nextBeat){renderSidebar();renderPopover();return;}
      state.beat=nextBeat;state.context=state.score[state.beat]?.name?'single':'empty';state.draft=clone(state.score[state.beat]);state.more=false;render();return;
  }
  if(target.dataset.tab){state.tab=target.dataset.tab;renderSidebar();renderPopover();return;}
  if(target.dataset.preset){choosePreset(target.dataset.preset);return;}
  if(target.dataset.libraryTab){state.libraryTab=target.dataset.libraryTab;state.librarySelected=state.libraryTab==='mine'?(state.my.length?'my:0':null):'F';state.librarySearch='';state.libraryRoot='all';state.libraryType='all';state.libraryVersion=0;renderLibrary();return;}
  if(target.dataset.libraryItem){state.librarySelected=target.dataset.libraryItem;state.libraryVersion=0;renderLibraryCards();return;}
  if(target.dataset.version!==undefined){state.libraryVersion=Number(target.dataset.version);renderLibraryDetail();return;}
  if(target.dataset.focusOuter){state.focusOuter=target.dataset.focusOuter==='yes';renderLibrary();return;}
  if(target.dataset.mode){state.custom.mode=target.dataset.mode;state.custom.barreAnchor=null;renderCustom();return;}
  if(target.dataset.cell){editCell(target.dataset.cell);return;}
  if(target.dataset.stringState!==undefined){pushCustom();const i=Number(target.dataset.stringState);state.custom.opens[i]=state.custom.opens[i]<0?0:-1;renderCustom();return;}
  if(target.dataset.techPreset){changeTech(target.dataset.techPreset);return;}
  if(target.dataset.dialogAction){const action=target.dataset.dialogAction,confirm=state.dialog?.confirm;closeDialog();if(action!=='cancel')confirm?.();return;}
  switch(target.dataset.action){
    case 'open-library':openLibrary();break;
    case 'close-library':closeLibrary();break;
    case 'use-library':useLibrary();break;
    case 'open-custom':openCustom();break;
    case 'close-custom':requestCustomExit();break;
    case 'finish-custom':finishCustom();break;
    case 'custom-from-library':{const item=selectedLibrary();if(item)openCustom(item.name,versionShape(item),'library');break;}
    case 'empty-create':if(state.libraryOrigin==='custom'){closeLibrary();}else openCustom();break;
    case 'view-mine':openLibrary('custom');break;
    case 'review-return-flow':openCustom();break;
    case 'save-mine':saveMine();break;
    case 'empty-mine':state.my=[];state.librarySelected=null;renderLibrary();break;
    case 'clear-search':state.librarySearch='';state.libraryRoot='all';state.libraryType='all';renderLibrary();break;
    case 'apply':applyDraft();break;
    case 'delete':deleteChord();break;
    case 'more':state.more=!state.more;renderPopover();if(state.more)$('#more-search').focus();break;
    case 'close-popover':state.popover=false;renderPopover();$('#show-popover').checked=false;break;
    case 'toggle-popover':state.popover=!state.popover;renderPopover();$('#show-popover').checked=state.popover;break;
    case 'locate':$('#score-svg').scrollIntoView({block:'center',behavior:'smooth'});toast(`已定位 ${contextText()}`);break;
    case 'score-undo':scoreHistory('undo');break;
    case 'score-redo':scoreHistory('redo');break;
    case 'custom-undo':customHistory('undo');break;
    case 'custom-redo':customHistory('redo');break;
    case 'close-scene':state.scene='editor';render();restoreFocus();break;
    case 'review-notes':openDialog('notes','<h2>设计确认前的审阅口径</h2><ul><li>搜索只保留一个容器；外层常规焦点能否保留，仍待确认，可在和弦库切换比较。</li><li>查看我的指法：已确认暂存往返、取消恢复，选用先确认替换。</li><li>所有同类谱面技巧文字统一缩小已确认；6.5 / 7 布局单位仍为拟议数值。</li><li>按点为 22px；推荐 tile 为 72 × 78px，均为设计建议尺寸。</li><li>本页仅设计草案，须先确认设计稿再产品实现。</li></ul><div class="dialog-actions"><button class="primary" data-dialog-action="cancel">知道了</button></div>');break;
  }
});
document.addEventListener('input',event=>{
  const el=event.target;
  if(el.matches('[data-draft-name]')){
    state.draft.name=el.value;
    $$('[data-draft-name]').forEach(input=>{if(input!==el)input.value=el.value;});
    $$('[data-preview-name]').forEach(x=>x.textContent=el.value||'未命名');renderStatus();
  }else if(el.id==='more-search'){
    const q=el.value.toLowerCase().trim(),names=Object.keys(definitions).filter(n=>n.toLowerCase().includes(q));
    $('#more-grid').innerHTML=q?(names.slice(0,8).map(tile).join('')||'<p class="empty-search">没有匹配的和弦</p>'):quickNames.map(tile).join('');
  }else if(el.id==='library-search'){state.librarySearch=el.value;renderLibraryCards();}
  else if(el.id==='custom-name'){if(el.value!==state.custom.name){pushCustom();state.custom.name=el.value;renderCustomPreview();}}
  else if(el.id==='start-fret'){
    pushCustom();state.custom.rawStart=el.value;
    const value=Number(el.value);
    state.custom.error=el.value.trim()&&Number.isInteger(value)&&value>=1&&value<=20?'':'起始品位需为 1–20 的整数';
    $('#custom-error').textContent=state.custom.error;
  }
  else if(el.id==='tech-size')changeTech(el.value);
});
document.addEventListener('change',event=>{
  const el=event.target;
  nativeMenuOpen=false;
  if(el.id==='show-popover'){state.popover=el.checked;renderPopover();}
  else if(el.id==='review-zoom')fitStage();
  else if(el.name==='display'){state.draft.display=el.value;renderStatus();}
  else if(el.id==='library-key'){
    state.libraryKey=el.value;if(el.value==='A')state.libraryMode='minor';else state.libraryMode='major';renderLibrary();
  }else if(el.id==='library-mode'){
    state.libraryMode=el.value;state.libraryKey=el.value==='minor'?'A':'C';renderLibrary();
  }else if(el.id==='root-filter'){state.libraryRoot=el.value;renderLibraryCards();}
  else if(el.id==='type-filter'){state.libraryType=el.value;renderLibraryCards();}
  else if(el.id==='finger-select')changeFinger(el.value);
  else if(el.id==='start-fret'){
    const value=Number(el.value);if(state.custom.error)return;
    state.custom.start=value;renderCustom();
  }
});
document.addEventListener('pointerdown',event=>{nativeMenuOpen=event.target.tagName==='SELECT';});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){
    if(nativeMenuOpen){nativeMenuOpen=false;return;}
    event.preventDefault();
    if(state.dialog){closeDialog();return;}
    if(state.scene==='custom'){
      if(state.custom.barreAnchor){state.custom.barreAnchor=null;state.custom.selected=null;renderCustom();return;}
      requestCustomExit();return;
    }
    if(state.scene==='library'){closeLibrary();return;}
    if(state.scene==='technique'){state.scene='editor';render();return;}
    if(state.more){state.more=false;renderPopover();return;}
    state.popover=false;renderPopover();$('#show-popover').checked=false;return;
  }
  if(event.target.tagName==='SELECT'&&['ArrowDown','ArrowUp',' '].includes(event.key))nativeMenuOpen=true;
  if((event.key==='Enter'||event.key===' ')&&event.target.matches('[data-beat]')){event.preventDefault();event.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));return;}
  if(event.key==='Tab'){
    const modal=$('.confirm-dialog')||$('.modal');if(!modal)return;
    const list=$$('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]',modal).filter(e=>e.getClientRects().length);
    if(!list.length)return;
    const first=list[0],last=list[list.length-1];
    if(event.shiftKey&&(document.activeElement===first||document.activeElement===modal||!modal.contains(document.activeElement))){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===modal||!modal.contains(document.activeElement))){event.preventDefault();first.focus();}
  }
  if(state.scene==='custom'&&!state.dialog&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)&&/^[0-4tT]$/.test(event.key)){
    event.preventDefault();changeFinger(event.key==='0'?'':event.key.toUpperCase());
  }
});
$('#reset-demo').addEventListener('click',()=>{state=freshState();$('#dialog-layer').innerHTML='';$('#toast').hidden=true;render();toast('已重置设计演示');});
window.addEventListener('resize',fitStage);
$('#score-undo').innerHTML=icon('undo');$('#score-redo').innerHTML=icon('redo');
state=freshState();
const initial=new URLSearchParams(location.search).get('scene');
render();if(['library','custom','technique'].includes(initial))setScene(initial);
