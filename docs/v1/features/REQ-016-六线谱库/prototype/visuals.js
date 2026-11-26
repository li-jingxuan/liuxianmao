// 图标和封面随原型分发。每本谱册沿用同一装订样式，用弦线纹样帮助辨认最近打开的谱。
const shapes = {
  plus:'M12 5v14M5 12h14', import:'M12 3v11m-4-4 4 4 4-4M4 14v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5',
  library:'M3 4h4v16H3zM10 4h3v16h-3zM15 5l3-1 4 15-3 1z',
  clock:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM12 7v5l3 2',
  disk:'M5 5h14l3 12v2H2v-2zM3 15h18M16 17h2',
  search:'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0zM15 15l6 6',
  sort:'M4 6h12M4 11h9M4 16h6M18 9v11m-3-3 3 3 3-3', down:'m7 9 5 5 5-5',
  arrow:'m10 5 7 7-7 7', back:'m14 5-7 7 7 7', check:'m4 12 5 5L20 6',
  more:'M5 12h.2m6.7 0h.2m6.7 0h.2', close:'M6 6l12 12M18 6 6 18',
  file:'M5 3h9l5 5v13H5zM14 3v6h5M8 13h8m-8 3h6', folder:'M3 6h7l2 2h9v11H3z',
  edit:'m4 16 11-11 4 4L8 20H4zM13 7l4 4', remove:'M4 4h11v5M4 4v16h11v-5m-4-3h10m-3-3 3 3-3 3',
  settings:'M3 7h6m5 0h7M3 17h10m5 0h3M9 4v6h5V4zM13 14v6h5v-6z',
  save:'M3 3h15l3 3v15H3zM7 3v6h9V3M7 21v-7h10v7', warn:'m12 3 10 17H2zM12 9v4m0 3v.2',
  score:'M6 3h11l3 3v15H6zM10 14v-5l6-1v5M10 14a1.4 1.4 0 1 1-1.4-1.4M16 13a1.4 1.4 0 1 1-1.4-1.4',
  local:'M3 4h18v13H3zM8 21h8m-4-4v4', tag:'m3 4 9 0 9 9-8 8L3 11zM8 8h.2',
  note:'M9 17V6l10-2v11M9 17c0 4-7 5-7 1 0-3 7-4 7-1zm10-2c0 4-7 5-7 1 0-3 7-4 7-1z'
};
function icon(name, size=18) {
  return `<svg aria-hidden="true" class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${name==='more'?3.6:1.65}" stroke-linecap="round" stroke-linejoin="round"><path d="${shapes[name]}"/></svg>`;
}
const palettes = [
  ['#253e83','#b7d0ff','#e3edff'], ['#206457','#b3dcc9','#e4f4e9'], ['#b85c30','#ffdb97','#fff0d1'],
  ['#6c5282','#e0c9e8','#f8edff'], ['#446478','#bedee6','#ebf7f9'], ['#936b36','#eddab3','#fff4db']
];
function cover(tone, miniature=false) {
  const [ink,thread,letter] = palettes[tone % palettes.length];
  let lines='';
  for (let j=0;j<24;j++) {
    let path='';
    for (let x=-2;x<=104;x+=2) {
      let y;
      if(tone%3===0) y=53+j*2.6+16*Math.sin(x/27-j*.054)+6*Math.sin(x/14+j*.03);
      else if(tone%3===1) y=56+j*2.8+18*Math.sin(x/34+j*.094)+6*Math.cos(x/15-j*.09);
      else y=55+j*2.6+14*Math.cos(x/20+j*.105)+9*Math.sin(x/32-j*.09);
      path+=`${x===-2?'M':'L'}${x} ${y.toFixed(1)} `;
    }
    lines+=`<path d="${path}"/>`;
  }
  const artwork=`<svg viewBox="0 0 100 124" aria-hidden="true" preserveAspectRatio="none"><rect width="100" height="124" fill="${ink}"/><g stroke="${thread}" fill="none" stroke-width=".76" opacity=".9">${lines}</g><path d="M9 0v124" stroke="white" opacity=".24"/><path d="M5 0v124" stroke="#000" opacity=".2"/>${miniature?'':`<g fill="${letter}" font-family="Georgia,serif"><text x="18" y="24" font-size="12" font-weight="bold" letter-spacing="1.2">TAB</text></g><path d="M18 30h18" stroke="${thread}"/>`}</svg>`;
  return `<span aria-hidden="true" class="cover ${miniature?'mini':''}">${artwork}</span>`;
}
