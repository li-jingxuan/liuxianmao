import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, ConfigProvider, Input, Modal, Segmented, Select, message } from 'antd';
import catalog from '../../../../apps/website/public/assets/chords/catalog-2026.11.11.2.json';

const roots = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const qualities = ['major', 'm', '7', 'maj7', 'm7', 'dim', 'dim7', 'm7b5', 'aug', 'sus2', 'sus4', 'add9', '6', 'm6', '9', 'm9'];
const suffixes = { major: '', m: 'm', '7': '7', maj7: 'maj7', m7: 'm7', dim: 'dim', dim7: 'dim7', m7b5: 'm7b5', aug: 'aug', sus2: 'sus2', sus4: 'sus4', add9: 'add9', '6': '6', m6: 'm6', '9': '9', m9: 'm9' };
const formulas = { major: [0,4,7], m: [0,3,7], '7': [0,4,7,10], maj7: [0,4,7,11], m7: [0,3,7,10], dim: [0,3,6], dim7: [0,3,6,9], m7b5: [0,3,6,10], aug: [0,4,8], sus2: [0,2,7], sus4: [0,5,7], add9: [0,4,7,14], '6': [0,4,7,9], m6: [0,3,7,9], '9': [0,4,7,10,14], m9: [0,3,7,10,14] };
const qualityNames = { major:'大三和弦', m:'小三和弦', '7':'属七和弦', maj7:'大七和弦', m7:'小七和弦', dim:'减三和弦', dim7:'减七和弦', m7b5:'半减七和弦', aug:'增三和弦', sus2:'挂二和弦', sus4:'挂四和弦', add9:'加九和弦', '6':'大六和弦', m6:'小六和弦', '9':'属九和弦', m9:'小九和弦' };
const mod = n => (n % 12 + 12) % 12;
const defaultC = catalog.items.find(item => item.rootPc === 0 && item.quality === 'major');
const defaultAm = catalog.items.find(item => item.rootPc === 9 && item.quality === 'm');
const voicing = item => item.voicings.find(v => v.id === 'open-01') ?? item.voicings.find(v => v.id === item.defaultVoicingId) ?? item.voicings[0];
const clone = value => structuredClone(value);
const romanMajor = ['I','♭II','II','♭III','III','IV','♯IV','V','♭VI','VI','♭VII','VII'];
const romanMinor = ['I','♭II','II','III','♯III','IV','♯IV','V','VI','♯VI','VII','♯VII'];
const degreeSpellingsMajor = [[0,0],[1,-1],[1,0],[2,-1],[2,0],[3,0],[3,1],[4,0],[5,-1],[5,0],[6,-1],[6,0]];
const degreeSpellingsMinor = [[0,0],[1,-1],[1,0],[2,0],[2,1],[3,0],[3,1],[4,0],[5,0],[5,1],[6,0],[6,1]];
const naturalPcs = { C:0,D:2,E:4,F:5,G:7,A:9,B:11 };
function matchesSearch(item, text) {
  if (!text.trim()) return true;
  const match = /^([A-Ga-g])((?:#{1,4}|b{1,4})?)(.*)$/.exec(text.trim().replaceAll('♯','#').replaceAll('♭','b'));
  if (!match) return false;
  const root = mod(naturalPcs[match[1].toUpperCase()] + (match[2].startsWith('#') ? match[2].length : -match[2].length));
  const aliases = {maj:'major', major:'major', M:'major', min:'m', '-':'m', M7:'maj7', 'Δ7':'maj7', min7:'m7', '-7':'m7', '°':'dim', '°7':'dim7', 'ø':'m7b5', 'ø7':'m7b5', '+':'aug', sus:'sus4'};
  return item.rootPc === root && (!match[3] || item.quality === (aliases[match[3]] ?? match[3]));
}
function spelling(tonic, mode, interval) {
  const letters = 'CDEFGAB';
  const [degree] = (mode === 'minor' ? degreeSpellingsMinor : degreeSpellingsMajor)[interval];
  const letter = letters[(letters.indexOf(roots[tonic][0]) + degree) % 7];
  let delta = mod(tonic + interval - naturalPcs[letter]);
  if (delta > 6) delta -= 12;
  return letter + (delta > 0 ? '#'.repeat(delta) : 'b'.repeat(-delta));
}
function describe(item, tonic, mode) {
  const interval = mod(item.rootPc - tonic);
  const base = (mode === 'minor' ? romanMinor : romanMajor)[interval];
  const lower = ['m','m7','m6','m9','dim','dim7','m7b5'].includes(item.quality);
  const degree = (lower ? base.toLowerCase() : base) + ({ major:'', m:'', dim:'°', dim7:'°7', m7b5:'ø7', aug:'+' }[item.quality] ?? suffixes[item.quality].replace(/^m(?!aj)/,''));
  const scale = mode === 'minor' ? [0,2,3,5,7,8,10] : [0,2,4,5,7,9,11];
  const tones = formulas[item.quality].map(tone => mod(interval + tone));
  const isNatural = tones.every(tone => scale.includes(tone));
  const isHarmonic = mode === 'minor' && tones.every(tone => [0,2,3,5,7,8,11].includes(tone));
  let relation = isNatural ? '自然调内' : isHarmonic ? '和声小调内' : '含调外音';
  if (isNatural && ['major','m','dim'].includes(item.quality)) relation = '自然三和弦';
  if (isNatural && ['maj7','m7','7','m7b5'].includes(item.quality)) relation = '自然七和弦';
  const root = spelling(tonic, mode, interval);
  return { name: root + suffixes[item.quality], degree, relation, root, base, interval };
}

function UndoIcon({ redo = false }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={redo ? {transform:'scaleX(-1)'} : {}} aria-hidden="true"><path d="M3 10h5M3 10V5M3 10a9 9 0 1 1 2 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function Diagram({ diagram, width = 90, height = 115 }) {
  const d = diagram ?? voicing(defaultC).diagram;
  const start = d.startFret ?? 1;
  return <svg viewBox="0 0 100 125" width={width} height={height} aria-label="和弦指法图" role="img">
    {[0,1,2,3,4,5].map(i => <line key={'s'+i} x1={22+i*13} x2={22+i*13} y1="25" y2="103" stroke="#354456" strokeWidth="1"/>)}
    {[0,1,2,3,4,5].map(i => <line key={'f'+i} x1="22" x2="87" y1={25+i*15.6} y2={25+i*15.6} stroke="#354456" strokeWidth={i===0 && start===1 ? 3 : 1}/>)}
    {start > 1 && <text x="8" y="37" fontSize="10" fill="#607084">{start}</text>}
    {(d.barres ?? []).map((b,i) => <line key={'b'+i} x1={22+(6-b.maxString)*13} x2={22+(6-b.minString)*13} y1={25+(b.fret-start+.5)*15.6} y2={25+(b.fret-start+.5)*15.6} stroke="#263b53" strokeWidth="10" strokeLinecap="round"/>)}
    {d.strings.map(s => { const x = 22+(6-s.string)*13; const y=25+(Number(s.fret)-start+.5)*15.6; return <g key={s.string}>{s.fret === 'x' ? <text x={x} y="17" textAnchor="middle" fontSize="13" fill="#354456">×</text> : s.fret === 0 ? <circle cx={x} cy="13" r="3.5" fill="none" stroke="#607084"/> : <><circle cx={x} cy={y} r="6" fill="#263b53"/>{s.finger != null && <text x={x} y={y+3} textAnchor="middle" fontSize="8" fill="white">{s.finger}</text>}</>}</g>; })}
  </svg>;
}
function Fretboard({ diagram, onChange, tool, finger }) {
  function edit(string, fret) {
    const next = clone(diagram);
    const entry = next.strings.find(s => s.string === string);
    entry.fret = tool === 'erase' ? 'x' : fret;
    if (finger !== 'unset' && tool !== 'erase') entry.finger = finger === 'T' ? 'T' : Number(finger);
    else delete entry.finger;
    onChange(next);
  }
  return <svg className="large-fret" viewBox="0 0 560 340" role="group" aria-label="可编辑指板">
    {[0,1,2,3,4,5].map(i => <line key={'s'+i} x1={90+i*75} x2={90+i*75} y1="45" y2="290" stroke="#8d9caf"/>)}
    {[0,1,2,3,4,5].map(i => <g key={'f'+i}><line x1="90" x2="465" y1={45+i*49} y2={45+i*49} stroke="#8d9caf"/>{i<5 && <text x="32" y={76+i*49} fill="#778396" fontSize="13">{Number(diagram.startFret)+i || i+1}</text>}</g>)}
    {Array.from({length:6},(_,i) => <g key={i}><text x={90+i*75} y="321" textAnchor="middle" fill="#778396" fontSize="12">{6-i} 弦</text><text x={90+i*75} y="25" textAnchor="middle" fill="#607084" fontSize="17">{diagram.strings.find(s=>s.string===6-i)?.fret === 'x' ? '×' : diagram.strings.find(s=>s.string===6-i)?.fret === 0 ? '○' : '●'}</text></g>)}
    {diagram.strings.filter(s => typeof s.fret==='number' && s.fret>0).map(s => <g key={s.string}><circle cx={90+(6-s.string)*75} cy={45+(s.fret-(Number(diagram.startFret)||1)+.5)*49} r="16" fill="#263b53"/><text x={90+(6-s.string)*75} y={50+(s.fret-(Number(diagram.startFret)||1)+.5)*49} textAnchor="middle" fill="white" fontSize="13">{s.finger ?? ''}</text></g>)}
    {Array.from({length:30},(_,i) => { const string=6-i%6, fret=Math.floor(i/6)+(Number(diagram.startFret)||1), x=90+(i%6)*75, y=45+(Math.floor(i/6)+.5)*49; return <g key={i} className="fret-hit" role="button" aria-label={`${string}弦${fret}品`} tabIndex="0" onClick={()=>edit(string,fret)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();edit(string,fret);}}}><rect x={x-30} y={y-24} width="60" height="48" fill="transparent"/><circle className="hover-dot" cx={x} cy={y} r="11"/></g>; })}
  </svg>;
}

function App() {
  const initial = new URLSearchParams(location.search).get('scene') ?? 'library';
  const [scene, setScene] = useState(initial);
  const [customOpen, setCustomOpen] = useState(initial === 'custom');
  const [libraryOpen, setLibraryOpen] = useState(initial === 'library');
  const [stacked, setStacked] = useState(false);
  const [tab,setTab] = useState('all');
  const [tonic,setTonic] = useState(0);
  const [mode,setMode] = useState('major');
  const [search,setSearch] = useState('');
  const [rootFilter,setRootFilter] = useState();
  const [qualityFilter,setQualityFilter] = useState();
  const [selected,setSelected] = useState(defaultC);
  const [selectedDiagram,setSelectedDiagram] = useState(voicing(defaultC).diagram);
  const [customName,setCustomName] = useState('C');
  const [startInput,setStartInput] = useState('1');
  const [diagram,setDiagram] = useState(clone(voicing(defaultC).diagram));
  const [history,setHistory] = useState([]);
  const [future,setFuture] = useState([]);
  const [finger,setFinger] = useState('unset');
  const [tool,setTool] = useState('press');
  const [customs,setCustoms] = useState([{...clone(defaultC),id:'saved-c',name:'C · 我的指法',voicings:[clone(voicing(defaultC))]},{...clone(defaultAm),id:'saved-am',name:'Am · 我的指法',voicings:[clone(voicing(defaultAm))]}]);
  const [confirm,setConfirm] = useState(null);
  const [draft,setDraft] = useState(null);
  const [draftName,setDraftName] = useState('');
  const [applied,setApplied] = useState(null);
  const listRef = useRef(null);
  const libraryLink = useRef(null);
  const [messageApi, contextHolder] = message.useMessage();
  const keyTitle = roots[tonic] + (mode === 'minor' ? ' 小调' : ' 大调');
  const selectedInfo = selected ? describe(selected,tonic,mode) : null;
  const all = useMemo(()=>catalog.items.map(item => ({item, ...describe(item,tonic,mode)})),[tonic,mode]);
  const filtered = all.filter(m => (rootFilter === undefined || m.item.rootPc===rootFilter) && (!qualityFilter || m.item.quality===qualityFilter) && matchesSearch(m.item,search));
  const order = mode === 'minor' ? [0,2,3,5,7,8,10,1,4,6,9,11] : [0,2,4,5,7,9,11,1,3,6,8,10];
  const groups = order.map(interval=>({interval, root:spelling(tonic,mode,interval), base:(mode==='minor'?romanMinor:romanMajor)[interval], items:filtered.filter(m=>m.interval===interval).sort((a,b)=>qualities.indexOf(a.item.quality)-qualities.indexOf(b.item.quality))})).filter(g=>g.items.length);
  useEffect(()=>{if(listRef.current)listRef.current.scrollTop=0;},[tonic,mode,tab,search,rootFilter,qualityFilter]);
  function navigate(next) {
    setScene(next);setConfirm(null);setStacked(false);setCustomOpen(next==='custom');setLibraryOpen(next==='library');setTab('all');setSearch('');
    const url=new URL(location.href);url.searchParams.set('scene',next);historyReplace(url);
  }
  function openLibrary(fromCustom=false) {
    setStacked(fromCustom);setTab(fromCustom?'mine':'all');setSearch('');setSelected(null);setLibraryOpen(true);
  }
  function closeLibrary() { setLibraryOpen(false); if(stacked)requestAnimationFrame(()=>libraryLink.current?.focus()); }
  function updateDiagram(next) { setHistory([...history,{diagram:clone(diagram),name:customName,start:startInput}]);setFuture([]);setDiagram(next); }
  function undo() {
    if(!history.length)return; const state=history.at(-1);setFuture([...future,{diagram:clone(diagram),name:customName,start:startInput}]);setHistory(history.slice(0,-1));setDiagram(state.diagram);setCustomName(state.name);setStartInput(state.start);
  }
  function redo() {
    if(!future.length)return;const state=future.at(-1);setHistory([...history,{diagram:clone(diagram),name:customName,start:startInput}]);setFuture(future.slice(0,-1));setDiagram(state.diagram);setCustomName(state.name);setStartInput(state.start);
  }
  function cancelCustom() { if(history.length || customName!=='C' || startInput!=='1')setConfirm('discard');else setCustomOpen(false); }
  function replaceCustom() {
    setHistory([...history,{diagram:clone(diagram),name:customName,start:startInput}]);setFuture([]);setCustomName(tab==='all'?selectedInfo.name:selected.name.split(' · ')[0]);setStartInput(String(selectedDiagram.startFret));setDiagram(clone(selectedDiagram));setConfirm(null);closeLibrary();
  }
  function choose() {
    if(!selected)return;
    if(stacked)setConfirm('replace');
    else {const name=tab==='all'?selectedInfo.name:selected.name.split(' · ')[0];setDraft({name,diagram:clone(selectedDiagram)});setDraftName(name);closeLibrary();}
  }
  function saveCustom() {
    setCustoms([...customs,{...clone(defaultC),id:'saved-'+Date.now(),name:customName+' · 我的指法',voicings:[{...voicing(defaultC),diagram:clone(diagram)}]}]);messageApi.success('已另存为我的指法');
  }
  function customDone() { if(!/^\d+$/.test(startInput) || Number(startInput)<1 || Number(startInput)>24){messageApi.warning('起始品位请输入 1–24');return;}setDraft({name:customName,diagram:clone(diagram)});setDraftName(customName);setCustomOpen(false); }
  const visibleCustoms = customs.filter(item=>item.name.toLowerCase().includes(search.toLowerCase()));
  const title = <><span>和弦库</span><div className="modal-subtitle">选择和弦与指法，带回当前编辑位置。</div></>;
  return <ConfigProvider theme={{token:{colorPrimary:'#285be0',borderRadius:6,fontFamily:'-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif'}}}>
    {contextHolder}
    <header className="review"><div><span className="version">设计稿 v1</span><strong>REQ-031 / 033 / 038 / 039</strong></div><nav aria-label="设计场景"><Button type={scene==='library'?'primary':'default'} onClick={()=>navigate('library')}>031 / 038 · 和弦库</Button><Button type={scene==='custom'?'primary':'default'} onClick={()=>navigate('custom')}>033 · 弹窗覆盖</Button><Button type={scene==='empty'?'primary':'default'} onClick={()=>navigate('empty')}>039 · 空拍侧栏</Button></nav></header>
    <div className="review-note">{scene==='library'?<><b>031：实际 AntD 默认 Segmented</b><span>038：全部 192 种按当前调性的根音分组，可切换 C 大调 / A 小调核对。</span><span>小调级数以自然小调为基准。</span></>:scene==='custom'?<><b>033：自定义弹窗保持打开</b><span>改名或编辑指板 → 查看我的指法 → Esc 返回；点击选用后确认替换。</span><span>可输入未完成的起始品位，检查返回保留。</span></>:<><b>039：选中拍尚无和弦</b><span>顶部保留背景框，显示「尚未配置和弦」；选用与完成编辑先回填，应用后更新谱面。</span></>}</div>
    <header className="app-header"><div className="brand">六线猫</div><div><strong>风吹过山谷</strong><small>吉他弹唱谱</small></div><div className="header-actions"><Button>导入曲谱</Button><Button>导出曲谱</Button><Button type="primary">导出图片</Button></div></header>
    <div className="toolbar"><UndoIcon/><UndoIcon redo/><span className="divider"/><span>𝅝</span><span>𝅗𝅥</span><span>♩</span><span>♪</span><span>♬</span><span className="divider"/><span>附点</span><span>休止</span><span>H</span><span>P</span><span>S</span><span>⌒</span><span className="divider"/><span>小节 ⌄</span><span>拍点 ⌄</span><span>连音 ⌄</span></div>
    <main className="workspace"><div className="paper-area"><article className="paper"><h1>风吹过山谷</h1><p className="credit">词曲：山谷来信　　编谱：六线猫</p><div className="score-meta"><span>1=C · 4/4</span><span>轻柔地　♩ = 76</span></div><svg className="score-svg" viewBox="0 0 760 370" aria-label="曲谱上下文"><text x="60" y="24" fontSize="17" fill="#263b53">C</text><text x="260" y="24" fontSize="17" fill="#263b53">Am</text>{applied && <text x="460" y="24" fontSize="17" fill="#263b53">{applied.name}</text>}{[0,1].map(row=><g key={row}>{[0,1,2,3,4,5].map(i=><line key={i} x1="20" x2="740" y1={65+row*170+i*12} y2={65+row*170+i*12} stroke="#394958" strokeWidth=".7"/>)}{[20,200,380,560,740].map(x=><line key={x} x1={x} x2={x} y1={65+row*170} y2={125+row*170} stroke="#394958"/>)}{[80,140,260,320,440,500,620,680].map((x,i)=><text key={x} x={x} y={80+row*170+(i%3)*12} fontSize="12" fill="#263b53">{[0,2,3,0,2,0,1,0][i]}</text>)}</g>)}<rect x="426" y="99" width="31" height="17" rx="2" fill="#eaf0ff" stroke="#285be0" strokeWidth="1.5"/><text x="80" y="159" fontSize="14" fill="#354456">风　吹　过　山　谷　　轻　轻　地</text></svg></article></div>
    <aside className="sidebar"><div className="side-tabs"><span>选区</span><span>简谱与歌词</span><span className="active">和弦</span><span>歌曲</span></div><div className="side-content"><div className="beat-context"><span>第 1 小节 · 第 3 拍</span><span>标准调弦</span></div><div className={'chord-summary'+(!draft&&!applied?' empty-summary':'')} data-testid="chord-summary">{draft||applied?<><Diagram diagram={(draft??applied).diagram} width={50} height={60}/><strong>{draftName||applied?.name}</strong><Button type="link" size="small" onClick={()=>{setCustomOpen(true);setStacked(false);}}>编辑指法</Button></>:'尚未配置和弦'}</div><label className="field-label" htmlFor="draft-name">和弦名称</label><div className="name-row"><Input id="draft-name" value={draftName} onChange={e=>setDraftName(e.target.value)} placeholder="输入和弦名称"/><Button type="primary" disabled={!draftName.trim()} onClick={()=>{setApplied({name:draftName,diagram:draft?.diagram});messageApi.success('和弦已应用');}}>应用</Button></div><Button block onClick={()=>{setCustomOpen(true);setStacked(false);}}>自定义指法</Button><div className="section-title"><strong>常用和弦</strong><Button type="link" size="small" onClick={()=>openLibrary(false)}>和弦库 &gt;</Button></div><div className="recommendations">{[0,9,5,7,2,4,7,0].map((pc,i)=>{const item=catalog.items.find(m=>m.rootPc===pc&&m.quality===['major','m','major','major','m','m','7','maj7'][i]);return <Button key={i} onClick={()=>{setDraft({name:item.name,diagram:clone(voicing(item).diagram)});setDraftName(item.name);}}><Diagram diagram={voicing(item).diagram}/><span>{item.name}</span></Button>;})}</div><div className="side-controls"><span>谱面显示</span><Select defaultValue="both" options={[{value:'both',label:'名称与指法'},{value:'name',label:'仅名称'}]}/></div></div></aside></main>
    <Modal open={customOpen} className="design-modal custom-modal" width={1240} style={{top:scene==='custom'?125:95}} zIndex={1000} mask={{closable:false}} keyboard={!libraryOpen&&!confirm} onCancel={cancelCustom} title="自定义指法" footer={<div className="modal-footer"><span className="help">完成后返回草稿，可继续修改或统一应用。</span><Button onClick={cancelCustom}>取消</Button><Button type="primary" onClick={customDone}>完成编辑</Button></div>}>
      <div className="custom-layout"><div className="fret-editor"><div className="custom-tools"><strong>{customName||'未命名'}</strong><Button type={tool==='press'?'primary':'default'} ghost={tool==='press'} onClick={()=>setTool('press')}>按弦</Button><Button type={tool==='erase'?'primary':'default'} ghost={tool==='erase'} onClick={()=>setTool('erase')}>擦除</Button><Button aria-label="撤销指法修改" icon={<UndoIcon/>} disabled={!history.length} onClick={undo}/><Button aria-label="重做指法修改" icon={<UndoIcon redo/>} disabled={!future.length} onClick={redo}/><label className="fret-start">起始品位<Input aria-label="起始品位" value={startInput} onChange={e=>setStartInput(e.target.value)}/></label></div><Fretboard diagram={diagram} onChange={updateDiagram} tool={tool} finger={finger}/><div className="finger-control">按弦手指<Select value={finger} onChange={setFinger} options={[{value:'unset',label:'未指定'},...['1','2','3','4','T'].map(value=>({value,label:value==='T'?'T · 拇指':value}))]}/></div><p className="keyboard-help">选择手指后点击指板设置按点；悬停为蓝色实心圆。</p></div><div className="custom-aside"><label className="field-label" htmlFor="custom-name">和弦名称</label><Input id="custom-name" value={customName} onChange={e=>setCustomName(e.target.value)}/><div className="preview-panel"><div><strong>有效指法预览</strong><em>指法有效</em></div><Diagram diagram={diagram}/></div><Button block onClick={saveCustom}>另存为我的指法</Button><p className="help">另存保留收藏，取消编辑仍会保留。</p><Button type="link" className="library-link" ref={libraryLink} onClick={()=>openLibrary(true)}>查看我的指法 &gt;</Button></div></div>
    </Modal>
    <Modal open={libraryOpen} className="design-modal library-modal" width={stacked?1120:1280} style={{top:stacked?165:125}} zIndex={stacked?1100:1000} mask={{closable:false}} keyboard={!confirm} onCancel={closeLibrary} title={title} footer={<div className="modal-footer"><span className="help">{stacked?'选用后返回自定义编辑；完成编辑后再应用。':'选用只回填草稿，应用和弦后才写入谱面。'}</span><Button onClick={closeLibrary}>{stacked?'返回自定义编辑':'取消'}</Button><Button type="primary" disabled={!selected} onClick={choose}>选用此指法</Button></div>}>
      <div className="library-layout"><Segmented className="library-tabs" aria-label="和弦库分类" value={tab} onChange={value=>{setTab(value);setSearch('');}} options={[{value:'all',label:'全部和弦'},{value:'mine',label:'我的指法'}]}/><div className="filters"><Input aria-label="搜索和弦" placeholder="搜索和弦名称，如 F#m7" value={search} onChange={e=>setSearch(e.target.value)} allowClear/>{tab==='all'&&<><Select aria-label="筛选根音" allowClear placeholder="全部根音" value={rootFilter} onChange={setRootFilter} options={roots.map((label,value)=>({label,value}))}/><Select aria-label="筛选和弦类型" allowClear placeholder="全部类型" value={qualityFilter} onChange={setQualityFilter} options={qualities.map(value=>({value,label:qualityNames[value]}))}/></>}</div><div className="tonality">{tab==='all'?<><span>按调性浏览</span><Select aria-label="浏览主音" value={tonic} onChange={setTonic} options={roots.map((label,value)=>({label,value}))}/><Select aria-label="浏览大小调" value={mode} onChange={setMode} options={[{value:'major',label:'大调'},{value:'minor',label:'小调'}]}/><span>曲谱 C 大调</span>{(tonic!==0||mode!=='major')&&<Button size="small" type="link" onClick={()=>{setTonic(0);setMode('major');}}>跟随曲谱</Button>}<span style={{marginLeft:'auto'}}>{filtered.length} / 192 项</span></>:<span>已保存 {customs.length} 项指法</span>}</div>
      <div className="library-list" ref={listRef} data-testid="library-scroll">{tab==='all'?groups.length?groups.map(group=><section className="chord-group" key={group.interval} data-root={group.root}><div className="group-heading"><h4>{keyTitle} · {group.base} 级根音 {group.root}</h4><span>{group.items.length} 项</span></div><div className="chord-grid">{group.items.map(m=><Button key={m.item.id} className="chord-card" data-selected={selected?.id===m.item.id} onClick={()=>{setSelected(m.item);setSelectedDiagram(voicing(m.item).diagram);}}><Diagram diagram={voicing(m.item).diagram}/><span className="card-copy"><b>{m.name}</b><small>{m.degree}</small></span></Button>)}</div></section>):<p className="empty-list">没有匹配的和弦，请更换搜索条件。</p>:<><div className="group-heading"><h4>我的指法</h4><span>{visibleCustoms.length} 项</span></div><div className="chord-grid">{visibleCustoms.map(item=><Button key={item.id} className="chord-card" data-selected={selected?.id===item.id} onClick={()=>{setSelected(item);setSelectedDiagram(voicing(item).diagram);}}><Diagram diagram={voicing(item).diagram}/><span className="card-copy"><b>{item.name.split(' · ')[0]}</b><small>我的指法</small></span></Button>)}</div>{!visibleCustoms.length&&<p className="empty-list">没有匹配的指法。</p>}</>}</div>
      <aside className="library-detail" data-testid="library-detail">{selected?<><div className="detail-name"><h3>{tab==='mine'?selected.name.split(' · ')[0]:selectedInfo.name}</h3>{tab==='all'&&<span>{selectedInfo.degree}</span>}</div><Diagram diagram={selectedDiagram}/>{tab==='all'&&<p className="classification-note">{keyTitle} · {selectedInfo.relation}<br/>根音 {selectedInfo.root}，{qualityNames[selected.quality]}</p>}<h4>指法版本</h4>{selected.voicings.map(v=><Button key={v.id} className="variation" style={{height:'auto',textAlign:'left',display:'block',whiteSpace:'normal',borderColor:selectedDiagram===v.diagram?'#285be0':undefined}} onClick={()=>setSelectedDiagram(v.diagram)}><b>{tab==='mine'?'我的指法':v.label}</b><span>{[...v.diagram.strings].sort((a,b)=>b.string-a.string).map(s=>s.fret==='x'?'×':s.fret).join(' · ')} ／ 6 → 1 弦</span></Button>)}</>:<p className="help">选择一个和弦查看指法；尚未改变当前草稿。</p>}</aside></div>
    </Modal>
    <Modal open={!!confirm} className="design-modal confirm-modal" title={confirm==='replace'?'替换当前编辑中的指法？':'放弃本次修改？'} width={450} centered zIndex={1200} mask={{closable:false}} onCancel={()=>setConfirm(null)} footer={<><Button onClick={()=>setConfirm(null)}>{confirm==='replace'?'取消':'继续编辑'}</Button><Button type="primary" onClick={()=>{if(confirm==='replace')replaceCustom();else{setConfirm(null);setCustomOpen(false);}}}>{confirm==='replace'?'确认替换':'放弃修改'}</Button></>}>
      <p className="confirm-copy">{confirm==='replace'?'当前编辑内容将被所选指法替换。替换后可在自定义编辑中撤销；谱面尚未改变。':'本次未完成的自定义修改将被放弃，已经另存的收藏会保留。'}</p>
    </Modal>
  </ConfigProvider>;
}
function historyReplace(url) { window.history.replaceState(null,'',url); }
createRoot(document.getElementById('root')).render(<App/>);
