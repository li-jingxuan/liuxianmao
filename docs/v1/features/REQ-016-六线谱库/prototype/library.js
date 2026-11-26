'use strict';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const query=new URLSearchParams(location.search);
const os=query.get('platform')==='windows'?'windows':'macos';
const empty=query.get('scene')==='empty';
const mod=os==='macos'?'⌘':'Ctrl+';
const storeKey=`lxm.review.016.1.${os}.${empty?'empty':'shelf'}`;
const folders=['曲谱','下载','归档'];
const displayPath=f=>os==='macos'?`~/`+({曲谱:'Music/六线谱',下载:'Downloads',归档:'Music/归档'}[f.folder])+'/'+f.filename:`C:\\Users\\演示\\`+({曲谱:'Music\\六线谱',下载:'Downloads',归档:'Music\\归档'}[f.folder])+'\\'+f.filename;
const fileId=()=>crypto.randomUUID();
const formCopy=o=>JSON.parse(JSON.stringify(o));
const shelfNames=['理想','潮汐之间','橘色黄昏','雨后散步','晚风来信','指板练习曲','纸飞机'];
function makeFile(id,title,author,tone,overrides={}) {
  return {id,title,author,tone,key:'C',meter:'4/4',bpm:90,bars:16,folder:'曲谱',filename:title+'.lxm',version:8,saved:Date.now(),...overrides};
}
function sampleData() {
  const now=Date.now();
  const files=shelfNames.map((name,i)=>makeFile('s'+i,name,['六线猫','林屿','阿岚','六线猫','林屿','六线猫','阿岚'][i],i%6,{
    key:['G','D','C','Am','F','Em','D'][i],meter:['4/4','6/8','4/4','3/4','4/4','4/4','3/4'][i],
    bpm:[90,76,86,72,92,80,68][i],bars:[42,24,32,16,28,16,20][i],idealExcerpt:i===0,saved:now-[17,92,1340,3000,4210,6120,7800][i]*60000
  }));
  const entries=empty?[]:files.map((f,i)=>({id:f.id,folder:f.folder,filename:f.filename,alias:'',opened:i<3?now-[12,70,1200][i]*60000:0}));
  files.unshift(makeFile('i0','清晨前奏','林屿',4,{folder:'下载',bpm:78}),makeFile('i1','旧练习谱','六线猫',3,{folder:'下载',version:6}),makeFile('i2','未完成的传输','',1,{folder:'下载',invalid:true}));
  return {files,entries};
}
let volatile=false, data;
try{const raw=localStorage.getItem(storeKey); data=raw?JSON.parse(raw):sampleData(); if(!raw)localStorage.setItem(storeKey,JSON.stringify(data));}
catch{data=sampleData();volatile=true;}
let session=null, draft=null, fault=null, searchTerm='', ordering='saved', noticeTimer, popupAnchor=null;
const sheet=$('#sheet'),popup=$('#popup');
const getFile=id=>data.files.find(f=>f.id===id);
const getEntry=id=>data.entries.find(e=>e.id===id);
const titleFor=id=>getEntry(id)?.alias||getFile(id)?.title;
const missing=e=>getFile(e.id).folder!==e.folder||getFile(e.id).filename!==e.filename;
function transaction(edit) {
  const next=formCopy(data);edit(next);
  try{if(!volatile)localStorage.setItem(storeKey,JSON.stringify(next));data=next;return true;}
  catch{message('浏览器未能写入演示资料，请检查可用空间后重试。');return false;}
}
function message(text) {clearTimeout(noticeTimer);$('#notice').textContent=text;noticeTimer=setTimeout(()=>$('#notice').textContent='',3400);}
function dateText(time) {
  const date=new Date(time),today=new Date(),yesterday=new Date();yesterday.setDate(today.getDate()-1);
  const clock=date.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
  if(date.toDateString()===today.toDateString())return '今天 '+clock;
  if(date.toDateString()===yesterday.toDateString())return '昨天 '+clock;
  return `${date.getFullYear()}/${String(date.getMonth()+1).padStart(2,'0')}/${String(date.getDate()).padStart(2,'0')}`;
}
const btn=(label,action,cls='',glyph='')=>`<button class="btn ${cls}" data-act="${action}">${glyph?icon(glyph,16):''}${esc(label)}</button>`;
const square=(label,action,glyph)=>`<button class="square" aria-label="${esc(label)}" title="${esc(label)}" data-act="${action}">${icon(glyph,17)}</button>`;
const brand='<div class="brand"><img src="assets/brand.png" alt=""><span>六线猫</span></div>';
function frame() {
  $('#window').innerHTML=os==='macos'?'<div class="macframe"><span class="lights" aria-hidden="true"><i></i><i></i><i></i></span>六线猫</div>':'<div class="winframe"><img alt="" src="assets/brand.png">六线猫<span aria-hidden="true" class="caption"><span>−</span><span>□</span><span>×</span></span></div><div class="winmenu"><button data-act="filemenu">文件</button><span>编辑</span></div>';
}
function status() {
  $('#statusbar').innerHTML=`<span class="foot-inner">${icon(session?'score':'disk',14)}${session?'曲谱编辑器':'本地谱库'}</span><span>·</span><span>${volatile?'浏览器仅保留本次演示':session?(dirty()?'未保存':'已保存'):data.entries.length+' 份曲谱'}</span><span class="spacer"></span><button data-act="review" aria-haspopup="true">${icon('settings',13)}原型选项 ${icon('down',12)}</button>`;
}
function library() {
  session=null;draft=null;document.body.classList.remove('editing');document.title='六线谱库 · 六线猫';
  $('#appbar').innerHTML=brand+'<div class="appsect">桌面工作区</div><span class="spacer"></span><div class="connection"><i></i>离线可用</div>';
  const recent=data.entries.filter(e=>e.opened>0).sort((a,b)=>b.opened-a.opened).slice(0,3);
  const buttons=btn('导入曲谱','import','','import')+btn('新建曲谱','new','primary','plus');
  const header=`<div class="heading"><div><h1>六线谱库</h1><p class="subtitle">浏览和管理这台电脑上的曲谱</p></div>${data.entries.length?`<div class="controls">${buttons}</div>`:''}</div>`;
  const cards=recent.map(e=>{const f=getFile(e.id);return `<button class="recent" data-act="open" data-id="${f.id}" aria-label="继续编辑 ${esc(titleFor(f.id))}">${cover(f.tone)}<span class="card-text"><span class="card-title">${esc(titleFor(f.id))}</span><span class="card-author">${esc(f.author||'编配未填写')}</span><span class="card-meta"><span>${esc(f.key)} 调</span><span>${esc(f.meter)} 拍</span><span>${f.bars} 小节</span></span></span><span class="open-arrow">${icon('arrow',14)}</span></button>`}).join('');
  const shelf=cards?`<section><div class="section-head">${icon('clock',18)}<h2>最近打开</h2></div><div class="shelf">${cards}</div></section>`:'';
  const content=data.entries.length?`${shelf}<section class="desk-table"><div class="table-head"><h2>全部曲谱</h2><span class="count">${data.entries.length}</span><span class="spacer"></span><label class="search">${icon('search',15)}<input aria-label="搜索曲名、文件名或编配" id="search" type="search" placeholder="搜索曲名、文件名或编配" value="${esc(searchTerm)}"></label><button data-act="sort" class="btn sort-btn">${icon('sort',15)}${sortNames[ordering]}${icon('down',12)}</button></div><div id="results" class="list-wrap"></div></section>`:`<section class="empty"><div><span class="empty-icon">${icon('library',33)}</span><h2>谱库里还没有曲谱</h2><p>新建一份曲谱，或导入电脑上的 .lxm 文件。</p><div class="controls">${buttons}</div></div></section>`;
  $('#workspace').innerHTML=`<div class="library">${header}${content}</div>`;
  if(data.entries.length){table();$('#search').oninput=e=>{searchTerm=e.target.value;table();};}status();
}
const sortNames={saved:'最近保存',title:'曲名顺序',opened:'最近打开'};
function table() {
  const q=searchTerm.toLocaleLowerCase().trim();
  const rows=data.entries.filter(e=>[titleFor(e.id),getFile(e.id).title,e.filename,getFile(e.id).author].some(v=>v.toLocaleLowerCase().includes(q))).sort((a,b)=>ordering==='title'?titleFor(a.id).localeCompare(titleFor(b.id),'zh-CN'):ordering==='opened'?b.opened-a.opened:getFile(b.id).saved-getFile(a.id).saved);
  if(!rows.length){$('#results').innerHTML=`<div class="no-match">没有找到匹配的曲谱。 <button class="back-btn" style="display:inline-flex" data-act="clear-search">清除搜索</button></div>`;return;}
  const names=['曲谱名称','编配','调式','拍号','最后保存','操作'];
  $('#results').innerHTML=`<table class="score-list"><colgroup>${[34,18,11,11,20,6].map(w=>`<col style="width:${w}%">`).join('')}</colgroup><thead><tr>${names.map((n,i)=>i===5?'<th aria-label="操作"></th>':`<th scope="col">${n}</th>`).join('')}</tr></thead><tbody>${rows.map(e=>{const f=getFile(e.id);return `<tr data-id="${f.id}"><td><button class="row-main" data-act="open" aria-label="打开 ${esc(titleFor(f.id))}">${cover(f.tone,true)}<span><b>${esc(titleFor(f.id))}${missing(e)?'<em class="missing">待定位</em>':''}</b><small>${esc(e.filename)}</small></span></button></td><td>${esc(f.author||'—')}</td><td><span class="keyval">${esc(f.key)}</span></td><td class="measure">${esc(f.meter)}</td><td class="saved">${dateText(f.saved)}</td><td>${square('管理 '+titleFor(f.id),'manage','more')}</td></tr>`}).join('')}</tbody></table>`;
}
const entryFor=(file,opened=0)=>({id:file.id,folder:file.folder,filename:file.filename,opened,alias:''});
function markOpen(id){return transaction(db=>{const e=db.entries.find(x=>x.id===id);if(e)e.opened=Date.now();else db.entries.push(entryFor(getFile(id),Date.now()));});}
function dirty(){return session&&(!session.base||JSON.stringify(session.file)!==JSON.stringify(session.base));}
function openSession(f,isNew=false) {
  searchTerm='';if(!isNew&&!markOpen(f.id))return;session={file:formCopy(f),base:isNew?null:formCopy(f)};draft=null;editor();
}
function tabScore(f,bar) {
  if(f.idealExcerpt)return bar===0?'<img class="tabline" src="assets/ideal-score.png" alt="《理想》六线谱、和弦图及简谱歌词节选">':'';
  const n=Math.min(4,f.bars-bar);let str='';
  for(let k=0;k<n;k++){
    const x=26+k*184;str+=`<text x="${x+3}" y="26" font-size="10" fill="#70757c">${bar+k+1}</text>`;
    for(let s=0;s<6;s++)str+=`<path d="M${x} ${34+s*6}h184" stroke="#404652" stroke-width=".9"/>`;
    str+=`<path d="M${x} 34v30m184-30v30" stroke="#303540"/>`;
    if(!f.blank){str+=`<text x="${x+28}" y="18" font-family="Georgia,serif" font-weight="bold">${['G','C','Em','D','Am','C','G','D'][(bar+k+f.tone)%8]}</text>`;
      for(let b=0;b<8;b++){const xx=x+16+b*21,yy=34+([5,3,2,1,0,2,1,3][(b+k)%8])*6;str+=`<path d="M${xx} 66v14" stroke="#353d47"/><text x="${xx}" y="${yy+3.5}" text-anchor="middle" font-family="Georgia,serif" font-weight="bold" font-size="11" paint-order="stroke" stroke="white" stroke-width="3" fill="#232730">${[0,2,0,3,1,0,2,0][(b+bar+k)%8]}</text>`;if(b%2===0)str+=`<path d="M${xx} 80h21" stroke="#353d47" stroke-width="2.6"/>`;}
    }
  }
  return `<svg class="tabline" viewBox="0 0 770 88" role="img" aria-label="第 ${bar+1} 至 ${bar+n} 小节示意"><text x="8" y="44" font-size="10" font-weight="bold">T<tspan x="8" dy="10">A</tspan><tspan x="8" dy="10">B</tspan></text>${str}</svg>`;
}
function editor() {
  const f=session.file;document.body.classList.add('editing');document.title=f.title+' · 六线猫';
  $('#appbar').innerHTML=brand+`<span class="appsect"><button class="back-btn" data-act="back">${icon('back',13)}返回谱库</button></span><button data-act="filemenu">文件</button><span class="editor-name">${esc(f.title)}</span><span class="spacer"></span><span class="edit-status">${dirty()?'有未保存的更改':'已保存'}</span>${btn('保存','save','edit-select','save')}`;
  $('#workspace').innerHTML=`<div class="editor-body"><img class="tool-strip" alt="编辑器谱面工具栏（视觉参考）" src="assets/toolbar.png"><div class="editor-split"><div class="desk-paper"><article class="paper"><h1>${esc(f.title)}</h1><p class="byline">编谱：${esc(f.author||'未填写')}</p><div class="score-info">1 = ${esc(f.key)}　${f.meter}　♩ = ${f.bpm}</div>${Array.from({length:Math.min(4,Math.ceil(f.bars/4))},(_,i)=>tabScore(f,i*4)).join('')}</article></div><aside class="sidebar"><div class="side-tabs"><span>选区</span><span>简谱与歌词</span><span>和弦</span><span class="active">歌曲</span></div><div class="side-form"><h2>歌曲设置</h2><label class="field">曲名<input id="song-title" maxlength="80" value="${esc(f.title)}"></label><label class="field">编配<input id="song-author" maxlength="80" value="${esc(f.author)}"></label><label class="field">曲谱速度（BPM）<input id="tempo" type="number" min="20" max="300" value="${f.bpm}"></label><p class="error-box" id="song-error" role="alert"></p>${btn('应用更改','apply','primary')}</div><div class="saved-path">${session.base?'当前文件':'首次保存后加入谱库'}${session.base?`<code class="path">${esc(displayPath(f))}</code>`:''}</div></aside></div></div>`;
  $('.side-form').oninput=()=>{const fields={title:$('#song-title').value,author:$('#song-author').value,bpm:$('#tempo').value};draft=fields.title!==f.title||fields.author!==f.author||fields.bpm!==String(f.bpm)?fields:null;$('#song-error').textContent='';};status();
}
function applyDraft(){if(!draft){message('歌曲设置已应用');return;}const {title,author,bpm}=draft;if(!title.trim()||!Number.isInteger(Number(bpm))||Number(bpm)<20||Number(bpm)>300){$('#song-error').textContent='请填写曲名，并输入 20 至 300 之间的整数速度。';return;}Object.assign(session.file,{title:title.trim(),author:author.trim(),bpm:Number(bpm)});draft=null;editor();message('已应用歌曲设置');}

// 对话框中的动作均显式提交。关闭、Esc 和系统选择器取消都保留当前会话及其保存目标。
function dismiss(){if(sheet.open)sheet.close();}
function dialog(title,body,actions,focus=''){
  closeMenu();sheet.innerHTML=`<div class="sheet-top"><h2 id="sheet-title">${esc(title)}</h2><button data-sheet="close" class="square" aria-label="关闭对话框">${icon('close',16)}</button></div><div class="sheet-body">${body}</div><div class="sheet-foot">${actions.map((a,i)=>`<button class="btn ${a[2]||''}" data-sheet="${i}">${esc(a[0])}</button>`).join('')}</div>`;
  sheet.onclick=e=>{const t=e.target.closest('[data-sheet]');if(t){if(t.dataset.sheet==='close')dismiss();else actions[Number(t.dataset.sheet)][1]();}};
  if(!sheet.open)sheet.showModal();(focus?sheet.querySelector(focus):sheet.querySelector('.sheet-foot button'))?.focus();
}
const cancel=['取消',dismiss];
const filebox=f=>`<div class="filebox">${icon('file',22)}<div><b>${esc(f.filename)}</b><code>${esc(displayPath(f))}</code></div></div>`;
function newScore(){dialog('新建曲谱','<label class="field">曲名<input id="new-title" maxlength="80" placeholder="输入曲名" required></label><label class="field">编配（选填）<input id="new-author" maxlength="80"></label><p class="hint">C 大调、4/4 拍、标准调弦，含 4 个空小节。</p><p id="new-error" class="error-box" role="alert"></p>',[cancel,['开始写谱',()=>{
  const title=$('#new-title').value.trim();if(!title){$('#new-error').textContent='请填写曲名。';$('#new-title').focus();return;}
  const file=makeFile(fileId(),title,$('#new-author').value.trim(),data.entries.length%6,{bars:4,blank:true});dismiss();openSession(file,true);
},'primary']],'#new-title');}
function guardDraft(next){if(!draft){next();return;}dialog('歌曲设置尚未应用','<p>曲名、编配或速度还有待应用的输入。回到歌曲设置应用更改，或放弃这些输入后继续。</p>',[['放弃输入并继续',()=>{dismiss();draft=null;editor();next();}],['返回歌曲设置',()=>{dismiss();$('#song-title').focus();},'primary']]);}
function guardLeave(next){guardDraft(()=>{if(!dirty()){next();return;}dialog('要保存对曲谱的更改吗？',`<p>《${esc(session.file.title)}》有未保存的更改。${session.base?'放弃后保留上一次保存的版本。':'放弃后这份新谱不会加入谱库。'}</p>`,[['继续编辑',dismiss],['不保存并继续',()=>{dismiss();next();}],['保存并继续',()=>{dismiss();save(false,next);},'primary']]);});}
function save(asCopy=false,after=null){guardDraft(()=>{
  const file=session.file;
  if(asCopy||!session.base){chooseSave(asCopy,after);return;}
  if(file.version<8){dialog('升级曲谱格式',`<p>保存将以 v8 替换这份 v${file.version} 文件。需要保留旧版时，可另存为新文件。</p>${filebox(file)}`,[cancel,['另存为…',()=>chooseSave(true,after)],['升级并覆盖',()=>commitSave(formCopy(file),after),'primary']]);return;}
  commitSave(formCopy(file),after);
});}
function safeStem(s){return s.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').slice(0,60).replace(/[. ]+$/g,'')||'未命名';}
function chooseSave(copy,after){const f=session.file;const suggested=copy?safeStem(f.title)+' 副本.lxm':safeStem(f.title)+'.lxm';dialog(copy?'另存曲谱':'保存曲谱',`<label class="field">文件名<input id="save-name" value="${esc(suggested)}" maxlength="100"></label><label class="field">位置<select id="save-folder">${folders.map(v=>`<option ${v===f.folder?'selected':''}>${v}</option>`).join('')}</select></label><div class="path" id="save-path"></div><p class="error-box" id="save-error" role="alert"></p>`,[cancel,['保存',()=>{
  let name=$('#save-name').value.trim();if(!name||/[<>:"/\\|?*\u0000-\u001f]/.test(name)||name.toLowerCase()==='.lxm'){ $('#save-error').textContent='请使用有效的文件名。';return; }if(!/\.lxm$/i.test(name))name+='.lxm';
  const folder=$('#save-folder').value;const prev=data.files.find(x=>x.folder===folder&&x.filename.toLowerCase()===name.toLowerCase());const target={...f,id:prev?.id||(!session.base?f.id:fileId()),folder,filename:name};
  if(prev){dialog('替换已有曲谱文件？',`<p>此位置已有同名文件。替换将覆盖磁盘中这份${prev.version<8?'旧版':''}曲谱的内容${prev.version<8?'，写入 v8 格式':''}。</p>${filebox(target)}`,[cancel,['替换并保存',()=>commitSave(target,after),'danger']]);}
  else commitSave(target,after);
},'primary']],'#save-name');const update=()=>{$('#save-path').textContent=displayPath({filename:$('#save-name').value,folder:$('#save-folder').value});};$('#save-name').oninput=update;$('#save-folder').onchange=update;update();}
function commitSave(target,after){
  if(fault==='write'){fault=null;dialog('曲谱未能保存',`<p>目标目录没有写入权限。已保留当前更改，请检查文件权限后重试，或选择其他位置另存。</p>${filebox(target)}`,[['继续编辑',dismiss],['另存为…',()=>chooseSave(true,after)],['重试保存',()=>commitSave(target,after),'primary']]);return;}
  Object.assign(target,{version:8,saved:Date.now(),invalid:false});
  if(!transaction(db=>{const i=db.files.findIndex(f=>f.id===target.id);if(i===-1)db.files.push(target);else db.files[i]=target;const entry=db.entries.find(e=>e.id===target.id);if(entry)Object.assign(entry,{folder:target.folder,filename:target.filename,opened:Date.now()});else db.entries.push(entryFor(target,Date.now()));}))return;
  dismiss();session={file:formCopy(target),base:formCopy(target)};draft=null;editor();if(after)after();message('已保存 '+target.filename);
}

// 文件对象与索引条目分开持久化；移除、改显示名、重新定位均不改动模拟源文件的内容。
function picker(mode,oldId=null){
  let selected=null;const list=[...data.files];if(oldId)list.sort((a,b)=>Number(b.id===oldId)-Number(a.id===oldId));
  const title={import:'选择要导入的曲谱',native:'打开曲谱',locate:'定位本地文件'}[mode];
  dialog(title,`<p>选择一个 .lxm 文件，大小上限为 10 MiB。</p><div class="filechoices">${list.map(f=>`<button class="filechoice" data-choice="${f.id}" aria-pressed="false">${icon('file',17)}<span>${esc(f.filename)}</span><small>${esc(f.folder)}</small></button>`).join('')}</div><p class="hint" style="margin-top:12px">演示文件选择器，仅列出虚拟磁盘上的曲谱。</p>`,[cancel,['预览曲谱',()=>{if(selected)preview(mode,selected,oldId);},'primary']]);
  const confirm=sheet.querySelector('[data-sheet="1"]');confirm.disabled=true;
  sheet.querySelector('.filechoices').onclick=e=>{const b=e.target.closest('[data-choice]');if(!b)return;selected=b.dataset.choice;sheet.querySelectorAll('[data-choice]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));confirm.disabled=false;};
}
function preview(mode,id,oldId){
  const f=getFile(id),entry=getEntry(id);if(f.invalid){dialog('无法读取曲谱',`<p>文件内容不完整，无法解析为六线猫曲谱。请重新取得完整文件或选择另一份 .lxm。</p>${filebox(f)}`,[cancel,['重新选择',()=>picker(mode,oldId),'primary']]);return;}
  // 重定位只接受所选的实物。已在库内的其他文件不允许覆盖原条目或合并错谱。
  if(mode==='locate'&&entry&&id!==oldId){dialog('这份曲谱已在谱库中',`<p>请为《${esc(titleFor(oldId))}》选择正确的原件，已登记的两个条目将分别保留。</p>${filebox(f)}`,[cancel,['重新选择',()=>picker(mode,oldId),'primary']]);return;}
  const heading=mode==='locate'?'确认新的文件位置':mode==='import'?'导入曲谱预览':'打开曲谱预览';
  const info=mode==='locate'?`<p>将《${esc(titleFor(oldId))}》的库内条目指向下方文件。请核对曲名与编配。</p>`:mode==='import'?`<p>${entry&&!missing(entry)?'这份文件已在谱库中，确认后保留一个条目。':'谱库将登记此文件的位置。以后在编辑器保存时会写回这份原件。'}</p>`:'';
  dialog(heading,`${info}${filebox(f)}<dl><dt>谱内曲名</dt><dd>${esc(f.title)}</dd><dt>编配</dt><dd>${esc(f.author||'—')}</dd><dt>谱面</dt><dd>${f.key} 调　${f.meter} 拍　${f.bars} 小节</dd></dl>${f.version<8?`<div class="warn-note">v${f.version} 旧谱可升级打开。首次覆盖保存时确认写入 v8。</div>`:''}`,[cancel,[mode==='locate'?'更新位置并打开':mode==='import'?(entry?'确认登记':'加入谱库'):'打开曲谱',()=>{
    dismiss();const proceed=()=>{
      if(!transaction(db=>{if(mode==='locate'){const e=db.entries.find(x=>x.id===oldId);Object.assign(e,{id:f.id,folder:f.folder,filename:f.filename});}else {const e=db.entries.find(x=>x.id===id);if(e)Object.assign(e,{folder:f.folder,filename:f.filename});else db.entries.push(entryFor(f));}}))return;
      if(mode==='import'){searchTerm='';library();message(entry?'已确认文件位置':'已加入谱库');}else openSession(getFile(id));
    };if(session)guardLeave(proceed);else proceed();
  },'primary']]);
}
function openFromList(id){const e=getEntry(id);if(!e)return;
  if(fault==='move'){fault=null;if(!transaction(db=>{const f=db.files.find(x=>x.id===id);f.folder=f.folder==='归档'?'曲谱':'归档';}))return;library();}
  if(missing(e)){dialog('找不到曲谱原件',`<p>文件可能已移位，或所在磁盘尚未连接。可接回原磁盘后重试，或定位文件的新位置。</p>${filebox(e)}`,[cancel,['重试',()=>{dismiss();openFromList(id);}],['重新定位…',()=>picker('locate',id),'primary']]);return;}openSession(getFile(id));
}
function renameEntry(id){const e=getEntry(id);dialog('重命名库内显示名',`<label class="field">库内显示名<input id="alias" maxlength="80" value="${esc(titleFor(id))}"></label><p>仅更改谱库中的名称。谱内曲名为“${esc(getFile(id).title)}”，磁盘文件仍为“${esc(e.filename)}”。</p><div class="error-box" id="alias-error" role="alert"></div>`,[cancel,['保存显示名',()=>{const alias=$('#alias').value.trim();if(!alias){$('#alias-error').textContent='请填写显示名。';return;}if(!transaction(db=>db.entries.find(x=>x.id===id).alias=alias===getFile(id).title?'':alias))return;dismiss();library();message('已更新库内显示名');},'primary']],'#alias');}
function removeEntry(id){const e=getEntry(id);dialog('从谱库移除这份曲谱？',`<p>“${esc(titleFor(id))}”将从全部曲谱和最近打开中移除。电脑上的 .lxm 原件会保留，可随时重新导入。</p>${filebox(e)}`,[cancel,['仅从谱库移除',()=>{if(!transaction(db=>{db.entries=db.entries.filter(x=>x.id!==id);}))return;dismiss();library();message('已从谱库移除，原件已保留');},'danger']]);}
function closeMenu(){if(popupAnchor)popupAnchor.setAttribute('aria-expanded','false');popupAnchor=null;popup.hidden=true;popup.innerHTML='';}
const menuItem=(text,fn,glyph='',hint='',danger=false)=>({text,fn,glyph,hint,danger});
function menu(anchor,items){closeMenu();popupAnchor=anchor;anchor.setAttribute('aria-expanded','true');popup.hidden=false;popup.innerHTML=items.map((it,i)=>typeof it==='string'?(it==='-'?'<div class="divider"></div>':`<small class="menu-label">${esc(it)}</small>`):`<button class="menu-item ${it.danger?'danger-text':''}" data-menu="${i}">${it.glyph?icon(it.glyph,15):''}${esc(it.text)}${it.hint?`<small>${esc(it.hint)}</small>`:''}</button>`).join('');
  popup.onclick=e=>{const b=e.target.closest('[data-menu]');if(!b)return;closeMenu();anchor.focus();items[Number(b.dataset.menu)].fn();};const r=anchor.getBoundingClientRect();popup.style.left=Math.max(6,Math.min(innerWidth-221,r.right-215))+'px';popup.style.top=(r.bottom+popup.offsetHeight+6>innerHeight?r.top-popup.offsetHeight-4:r.bottom+4)+'px';popup.querySelector('button')?.focus();
}
function switchScene(platform,scene){const url=new URL(location.href);url.searchParams.set('platform',platform);url.searchParams.set('scene',scene);const next=()=>location.assign(url.href);if(session)guardLeave(next);else next();}
function review(anchor){const items=['平台预览',...['macos','windows'].map(p=>menuItem(p==='macos'?'macOS':'Windows',()=>switchScene(p,empty?'empty':'collection'),p===os?'check':'')),'-','独立演示谱库',menuItem('馆藏示例',()=>switchScene(os,'collection'),!empty?'check':''),menuItem('空库起步',()=>switchScene(os,'empty'),empty?'check':''),'-','故障演练'];
  if(!session)items.push(menuItem('下次打开时模拟文件移位',()=>{fault='move';message('请选择库内一份曲谱，演示文件移位后的重新定位');},'folder'));
  items.push(menuItem('下次保存时模拟写入失败',()=>{fault='write';message('下次保存将演示写入失败');},'warn'));menu(anchor,items);
}
function fileMenu(anchor){const items=[menuItem('打开…',()=>picker('native'),'folder',mod+'O')];if(session)items.push(menuItem('保存',()=>save(),'save',mod+'S'),menuItem('另存为…',()=>save(true),'file',os==='macos'?'⇧⌘S':'Ctrl+Shift+S'));menu(anchor,items);}
document.addEventListener('click',event=>{
  if(sheet.contains(event.target)||popup.contains(event.target))return;const b=event.target.closest('[data-act]'),row=event.target.closest('tr[data-id]');
  if(!b){closeMenu();if(row)openFromList(row.dataset.id);return;}const id=b.closest('[data-id]')?.dataset.id;const act=b.dataset.act;if(popupAnchor===b){closeMenu();return;}closeMenu();
  switch(act){case 'new':newScore();break;case 'import':picker('import');break;case 'open':openFromList(id);break;case 'back':guardLeave(library);break;case 'save':save();break;case 'apply':applyDraft();break;case 'review':review(b);break;case 'filemenu':fileMenu(b);break;
    case 'clear-search':searchTerm='';$('#search').value='';table();$('#search').focus();break;
    case 'sort':menu(b,Object.keys(sortNames).map(k=>menuItem(sortNames[k],()=>{ordering=k;library();$('[data-act="sort"]').focus();},k===ordering?'check':'')));break;
    case 'manage':menu(b,[menuItem('打开曲谱',()=>openFromList(id),'score'),menuItem('重命名显示名…',()=>renameEntry(id),'edit'),'-',menuItem('从谱库移除…',()=>removeEntry(id),'remove','',true)]);break;
  }
});
document.addEventListener('keydown',e=>{
  if(sheet.open){if(e.key==='Enter'&&e.target.tagName==='INPUT'){e.preventDefault();sheet.querySelector('.sheet-foot button:last-child')?.click();}return;}
  if(!popup.hidden){if(e.key==='Escape'){const a=popupAnchor;closeMenu();a?.focus();return;}if(['ArrowUp','ArrowDown'].includes(e.key)){const buttons=[...popup.querySelectorAll('button')],i=buttons.indexOf(document.activeElement);buttons[(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length].focus();e.preventDefault();return;}if(e.key==='Tab')closeMenu();}
  if(!(os==='macos'?e.metaKey:e.ctrlKey)||e.altKey)return;const key=e.key.toLowerCase();if(key==='s'&&session){e.preventDefault();save(e.shiftKey);}else if(key==='o'){e.preventDefault();picker('native');}
});
$('#workspace').addEventListener('scroll',closeMenu);window.addEventListener('resize',closeMenu);
frame();library();
