import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, ConfigProvider, Input, Segmented, Select, Switch, Tag } from 'antd';
import catalog from '../../../../apps/website/public/assets/chords/catalog-2026.11.11.2.json';
import { queryChordCatalog } from '../../../../packages/lxm-editor/src/core/chords/chord-catalog';
import { quickChordMatches, recommendedVoicing } from '../../../../apps/website/components/EditorShell/chords/chord-recommendations';

const spellings = [['C'], ['C#', 'Db'], ['D'], ['D#', 'Eb'], ['E'], ['F'], ['F#', 'Gb'], ['G'], ['G#', 'Ab'], ['A'], ['A#', 'Bb'], ['B']];
const confirmed = value => value.mode === 'major' || value.mode === 'minor';
const keyOf = value => ({ tonicPc: value.tonicPc, mode: value.mode, tonicSpelling: value.spelling });
const keyTitle = value => !confirmed(value) ? '调性未确认' : `${value.spelling}${value.mode === 'minor' ? '小调' : '大调'}`;
const initial = { title: '风吹过山谷', author: '六线猫' };
// 固定展示样例；缺失 mode 的旧曲谱不补全调性，也不设置小调默认记法。
const samples = {
  legacy: { pitch: 0 },
  major: { pitch: 0, mode: 'major', spelling: 'C', tonicPc: 0 },
  minor: { pitch: 0, mode: 'minor', spelling: 'A', tonicPc: 9, minorAs: '6' },
};

function Diagram({ match, width = 66, height = 82 }) {
  const d = recommendedVoicing(match).diagram;
  const start = d.startFret ?? 1;
  return <svg width={width} height={height} viewBox="0 0 100 116" role="img" aria-label={`${match.name} 指法图`}>
    {[0,1,2,3,4,5].map(i => <line key={`s${i}`} x1={24+i*13} x2={24+i*13} y1="24" y2="100" stroke="#58687a" strokeWidth="1"/>)}
    {[0,1,2,3,4,5].map(i => <line key={`f${i}`} x1="24" x2="89" y1={24+i*15.2} y2={24+i*15.2} stroke="#58687a" strokeWidth={i === 0 && start === 1 ? 3 : 1}/>)}
    {start > 1 && <text x="6" y="36" fontSize="11" fill="#66758a">{start}</text>}
    {(d.barres ?? []).map((b,i) => <line key={`b${i}`} x1={24+(6-b.maxString)*13} x2={24+(6-b.minString)*13} y1={24+(b.fret-start+.5)*15.2} y2={24+(b.fret-start+.5)*15.2} stroke="#31465f" strokeWidth="10" strokeLinecap="round"/>)}
    {d.strings.map(s => {const x=24+(6-s.string)*13, y=24+(Number(s.fret)-start+.5)*15.2;return <g key={s.string}>{s.fret === 'x' ? <text x={x} y="16" textAnchor="middle" fontSize="13" fill="#58687a">×</text> : s.fret === 0 ? <circle cx={x} cy="12" r="3.5" stroke="#58687a" fill="none"/> : <><circle cx={x} cy={y} r="6" fill="#31465f"/>{s.finger != null && <text x={x} y={y+3} textAnchor="middle" fontSize="8" fill="white">{s.finger}</text>}</>}</g>;})}
  </svg>;
}

function ChordCard({ match, selected, onClick }) {
  return <Button className={`chord-card${selected ? ' selected' : ''}`} onClick={onClick} aria-label={`选择和弦 ${match.name}`} aria-pressed={!!selected}>
    <div className="chord-name">{match.name}<small>{match.degree || '和弦'}</small></div><Diagram match={match}/>
  </Button>;
}

function ScorePreview({ value, capo }) {
  return <div className="score-context"><div className="context-label"><span>谱面头部</span><span className="saved-badge">已应用</span></div>
    <article className="score-paper" data-testid="score-preview"><h1>{value.title || '未命名歌曲'}</h1><p className="credit">编谱：{value.author || '未填写'}</p>
      <div className="score-meta"><span>{value.pitch===undefined?'1=未设置':`1=${spellings[value.pitch][0]}`} · 4/4</span><span>{keyTitle(value)}</span></div>
      <div className="capo-preview">变调夹：{capo === 0 ? '不使用' : `第 ${capo} 品`}</div>
      <svg className="score-staff" viewBox="0 0 320 130" aria-label="简短六线谱预览"><text x="18" y="20" fontSize="15" fill="#273e58">C</text><text x="170" y="20" fontSize="15" fill="#273e58">Am</text>{[0,1,2,3,4,5].map(i=><line key={i} x1="14" x2="306" y1={40+i*11} y2={40+i*11} stroke="#7b8797" strokeWidth=".7"/>)}{[14,160,306].map(x=><line key={x} x1={x} x2={x} y1="40" y2="95" stroke="#7b8797"/>)}{[0,1,2,3,4,5].map(i=><text key={i} x={35+i*45} y={46+(i%3)*11} fontSize="11" fill="#273e58">{[0,2,0,2,1,0][i]}</text>)}<text x="26" y="122" fontSize="12" fill="#65758b">风　吹　过　山　谷</text></svg>
    </article><p className="preview-caption">修改后点击对应的「应用」，查看头部变化。</p></div>;
}

function Song({ draft, setDraft, applied, setApplied, capo, setCapo, sample, sampleId, setSampleId }) {
  const [capoDraft, setCapoDraft] = useState(capo);
  const [status, setStatus] = useState('');
  const [capoStatus, setCapoStatus] = useState('');
  const [showError,setShowError] = useState(false);
  const dirty = draft.title !== applied.title || draft.author !== applied.author;
  function change(patch) {
    setDraft({ ...draft, ...patch }); setStatus('');
  }
  function applyInfo() {
    if (!dirty) return;
    const next = {title:draft.title.trim(), author:draft.author.trim()};
    setApplied(next); setDraft(next); setStatus('曲谱信息已应用');
  }
  return <><div className="design-note"><Tag color="blue">REQ040 / 041 · 已确认</Tag><span>对稿辅助 · 展示样例（不保存）</span><Segmented aria-label="歌曲展示样例（对稿辅助）" value={sampleId} onChange={setSampleId} options={[{value:'legacy',label:'旧曲谱示例'},{value:'major',label:'C大调'},{value:'minor',label:'A小调记6'}]}/></div>
    <div className="design-note error-demo"><Switch size="small" aria-label="错误提示示例" checked={showError} onChange={setShowError}/><span>错误提示示例 · 仅样式演示</span></div>
    <div className="project-frame"><div className="song-layout"><ScorePreview value={{...applied,...sample}} capo={capo}/><aside className="song-sidebar"><div className="side-tabs"><span>选区</span><span>简谱与歌词</span><span>和弦</span><strong>歌曲</strong></div>
      <section className="side-section"><div className="section-heading"><h2>曲谱信息</h2><Button type="link" disabled={!dirty} onClick={applyInfo} data-testid="apply-info">应用</Button></div>
        <label className="field" htmlFor="song-title"><span>歌曲名称</span><Input id="song-title" value={draft.title} onChange={e=>change({title:e.target.value})}/></label>
        <label className="field" htmlFor="song-author"><span>编谱作者</span><Input id="song-author" value={draft.author} onChange={e=>change({author:e.target.value})}/></label>
        <dl className="key-readonly" aria-label="调性信息（只读）">
          <div><dt>数字 1 音高</dt><dd>{sample.pitch===undefined?'未设置':spellings[sample.pitch][0]}</dd></div>
          <div><dt>大小调</dt><dd>{!confirmed(sample)?'未确认':sample.mode==='minor'?'小调':'大调'}</dd></div>
          <div><dt>主音拼写</dt><dd>{confirmed(sample)?sample.spelling:'—'}</dd></div>
          <div><dt>小调记法</dt><dd>{sample.mode==='minor'?`主音记 ${sample.minorAs}`:'—'}</dd></div>
        </dl>
        {!confirmed(sample) && <p className="inline-hint">调性未确认</p>}
        {showError && <p className="inline-error" role="alert">曲谱信息应用失败，请重试。</p>}
        {status && <p className="inline-success" role="status">{status}</p>}
      </section>
      <section className="side-section basic-section"><h2>歌曲基础</h2><div className="readonly-row"><span>基础拍号</span><strong>4/4</strong></div>
        <div className="capo-row"><label htmlFor="capo">变调夹</label><Select id="capo" aria-label="变调夹" value={capoDraft} onChange={value=>{setCapoDraft(value);setCapoStatus('');}} options={Array.from({length:13},(_,value)=>({value,label:value===0?'不使用':`第 ${value} 品`}))}/><Button disabled={capoDraft===capo} onClick={()=>{setCapo(capoDraft);setCapoStatus('变调夹已应用');}} data-testid="apply-capo">应用</Button></div>
        {capoStatus && <p className="inline-success" role="status">{capoStatus}</p>}
      </section>
    </aside></div></div></>;
}

function Recommendations({ applied, navigate }) {
  const [scenario,setScenario] = useState('song');
  const [text,setText] = useState('');
  const [selected,setSelected] = useState(null);
  const demo = scenario==='unknown' ? samples.legacy : scenario==='minor' ? samples.minor : applied;
  const title = text.trim() ? '搜索结果' : !confirmed(demo)?'常用和弦推荐':`${keyTitle(demo)}·和弦推荐`;
  // 调性已确认时直接复用产品现有推荐方法；未确认仅用现有 C/G/Am 等示例，不推断调性。
  const items = text.trim() ? queryChordCatalog(catalog,{text}).items : quickChordMatches(catalog,keyOf(!confirmed(demo)?samples.major:demo));
  return <><div className="design-note"><Tag color="blue">REQ042</Tag><span>更多推荐弹层</span><Select aria-label="推荐展示状态" value={scenario} onChange={setScenario} options={[{value:'song',label:'跟随已应用歌曲'},{value:'unknown',label:'未确认大小调'},{value:'minor',label:'A小调示例'}]}/></div>
    <div className="recommend-stage"><div className="beat-strip"><span>第 1 小节 · 第 3 拍</span><span>和弦</span></div><div className="recommend-popover" role="dialog" aria-label="更多和弦推荐"><div className="popover-heading"><h2>{title}</h2><Button type="link" onClick={()=>navigate('library')}>和弦库 ↗</Button></div>
      <Input aria-label="搜索推荐和弦" placeholder="搜索和弦，如 F#m7" value={text} onChange={e=>setText(e.target.value)} allowClear/>
      {text.trim() && <div className="search-heading"><span>{items.length} 项</span></div>}
      <div className="recommend-grid">{items.map(match=><ChordCard key={match.item.id} match={match} selected={selected?.item.id===match.item.id} onClick={()=>setSelected(match)}/>)}</div>
      {!items.length && <p className="empty-state">没有匹配的和弦</p>}
      {selected && <div className="selection-status" role="status">已选择 {selected.name}，回填当前和弦草稿</div>}
    </div></div><p className="prototype-caption">复用现有目录和推荐顺序；搜索时展示查询结果。</p></>;
}

function Library() {
  const [minor,setMinor] = useState(true);
  const [text,setText] = useState('');
  const [selected,setSelected] = useState(null);
  const [chosen,setChosen] = useState('');
  const key = minor ? {tonicPc:9,mode:'minor',tonicSpelling:'A'} : {tonicPc:0,mode:'major',tonicSpelling:'C'};
  const result = queryChordCatalog(catalog,{key});
  const natural = result.groups.find(g=>g.id==='natural').items;
  const harmonic = result.groups.find(g=>g.id==='harmonic')?.items || [];
  const ids = new Set([...natural,...harmonic].map(m=>m.item.id));
  const others = catalog.items.filter(item=>!ids.has(item.id)).map(item=>({item,name:item.name}));
  const groups = text.trim() ? [{title:'搜索结果',items:queryChordCatalog(catalog,{text}).items}] : [
    {title:'当前调性 · 自然三和弦',items:natural.slice(0,7)},
    {title:'七和弦',items:natural.slice(7)},
    ...(minor?[{title:'小调和声补充',items:harmonic}]:[]),
    {title:'其他和弦',items:others},
  ];
  return <><div className="design-note"><Tag color="blue">REQ038 · 已确认</Tag><span>对稿辅助 · 恢复旧分组</span><Segmented aria-label="库示例调性" value={minor?'minor':'major'} onChange={value=>setMinor(value==='minor')} options={[{value:'major',label:'C大调'},{value:'minor',label:'A小调'}]}/></div>
    <section className="library-panel"><div className="popover-heading"><h2>和弦库</h2><span className="library-key">当前调性 · {minor?'A小调':'C大调'}</span></div><div className="library-search"><Input aria-label="搜索库和弦" value={text} onChange={e=>setText(e.target.value)} placeholder="搜索和弦，如 F#m7" allowClear/><span>192 种和弦</span></div>
      <div className="library-scroll" data-testid="library-list">{groups.map(group=><section className="chord-group" key={group.title}><div className="group-heading"><h3>{group.title}</h3><span>{group.items.length} 项</span></div><div className="library-grid">{group.items.map(match=><ChordCard key={match.item.id} match={match} selected={selected?.item.id===match.item.id} onClick={()=>{setSelected(match);setChosen('');}}/>)}</div>{!group.items.length && <p className="empty-state">没有匹配的和弦</p>}</section>)}</div>
      <div className="library-footer"><span role="status">{chosen || (selected?`已选择 ${selected.name}`:'选择和弦查看准确指法')}</span><Button type="primary" disabled={!selected} onClick={()=>setChosen(`${selected.name} 已回填和弦草稿`)}>选用此指法</Button></div>
    </section><p className="prototype-caption">已确认恢复旧分组；搜索时平铺，不保留分类标题。</p></>;
}

function App() {
  const [scene,setScene] = useState(new URLSearchParams(location.search).get('scene') || 'song');
  const [draft,setDraft] = useState(initial);
  const [applied,setApplied] = useState(initial);
  const [capo,setCapo] = useState(0);
  const [sampleId,setSampleId] = useState('major');
  function navigate(next) {setScene(next);}
  return <ConfigProvider theme={{token:{colorPrimary:'#1677ff',borderRadius:6,controlHeight:32,fontSize:14,fontFamily:'-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif'}}}>
    <nav className="prototype-nav" aria-label="原型页面"><div className="nav-buttons">{[{value:'song',label:'歌曲设置'},{value:'recommend',label:'和弦推荐'},{value:'library',label:'和弦库回退'}].map(item=><Button key={item.value} type={scene===item.value?'primary':'default'} aria-pressed={scene===item.value} onClick={()=>navigate(item.value)}>{item.label}</Button>)}</div><span>交互设计稿</span></nav>
    <main>{scene==='song'?<Song draft={draft} setDraft={setDraft} applied={applied} setApplied={setApplied} capo={capo} setCapo={setCapo} sample={samples[sampleId]} sampleId={sampleId} setSampleId={setSampleId}/>:<div className="project-frame">{scene==='recommend'?<Recommendations applied={{...applied,...samples[sampleId]}} navigate={navigate}/>:<Library/>}</div>}</main>
  </ConfigProvider>;
}
createRoot(document.getElementById('root')).render(<App/>);
