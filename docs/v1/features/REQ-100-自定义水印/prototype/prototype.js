const byId = id => document.getElementById(id);
const preview = byId('preview');
const field = byId('signature');
const range = byId('range');
const sample = '青禾吉他教室 · 练习用';
const count = scorePages.length;
const segments = new Intl.Segmenter('zh', { granularity: 'grapheme' });
let mode = 'image';
let current = 0;
let applied = null;
if (location.hash === '#example') applied = { kind: 'text', text: sample };
if (['#logo', '#rotate'].includes(location.hash)) applied = { kind: 'image', ...defaultImageStyle, asset: createExampleLogo() };
let draftOn = Boolean(applied);
let kind = 'text';
let imageDraft = { ...defaultImageStyle, asset: null };
let loadVersion = 0;
let reading = false;
let uploadError = '';
let mark = null;
let busy = false;
let operation = 0;
let fileUrl = '';
let statusMessage = '';
let opener;

const ink = scorePages.map(source => {
  const image = new Image();
  image.src = source;
  return image;
});

function paintWatermark(text) {
  if (!text) return null;
  const canvas = document.createElement('canvas');
  canvas.width = 2480;
  canvas.height = 3508;
  const ctx = canvas.getContext('2d');
  ctx.scale(canvas.width / 794, canvas.height / 1123);
  const family = 'Arial, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.font = `40px ${family}`;
  const size = Math.min(40, 40 * 794 * .75 / ctx.measureText(text).width);
  ctx.font = `${size}px ${family}`;
  const bounds = ctx.measureText(text);
  ctx.translate(397, 561.5);
  ctx.rotate(-Math.PI / 6);
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(0,0,0,.12)';
  ctx.fillText(text, 0, (bounds.actualBoundingBoxAscent - bounds.actualBoundingBoxDescent) / 2);
  return { canvas, url: canvas.toDataURL(), x: 0, y: 0, width: 2480, height: 3508, opacity: 1 };
}

function fillPage(paper, index, stamp = mark) {
  const layers = [];
  if (stamp) {
    const watermark = new Image();
    watermark.alt = '';
    watermark.className = 'watermark';
    watermark.src = stamp.url;
    Object.assign(watermark.style, {
      left: `${stamp.x / 2480 * 100}%`, top: `${stamp.y / 3508 * 100}%`,
      width: `${stamp.width / 2480 * 100}%`, height: `${stamp.height / 3508 * 100}%`, opacity: stamp.opacity,
      transform: `rotate(${stamp.angle || 0}deg)`,
    });
    layers.push(watermark);
  }
  const notes = new Image();
  notes.src = ink[index].src;
  notes.alt = '';
  layers.push(notes);
  paper.replaceChildren(...layers);
}

function renderCurrentPage() {
  const trial = draftOn && kind === 'image' && imageDraft.asset && draftState().dirty;
  const stamp = trial ? imageStamp(imageDraft) : mark;
  const name = trial ? imageDraft.asset.name : applied?.asset?.name || applied?.text;
  fillPage(byId('main-page'), current, stamp);
  byId('trial').hidden = !trial;
  byId('main-page').setAttribute('aria-label', `《理想》第 ${current + 1} 页，${name ? '水印为' + name : '水印关闭'}${trial ? '，试排中' : ''}`);
  byId('main-page').setAttribute('role', 'img');
}

function renderSelection() {
  renderCurrentPage();
  byId('page-count').textContent = `${current + 1} / ${count}`;
  range.options[1].textContent = `当前页（第 ${current + 1} 页）`;
  [...byId('thumbs').children].forEach((button, index) => {
    if (index === current) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  byId('viewport').scrollTo(0, 0);
}

function renderPages() {
  mark = applied?.kind === 'image' ? imageStamp(applied) : paintWatermark(applied?.text);
  const printPages = [];
  ink.forEach((_, index) => {
    fillPage(byId('thumbs').children[index].firstElementChild, index);
    const paper = document.createElement('div');
    paper.className = 'paper';
    fillPage(paper, index);
    printPages.push(paper);
  });
  byId('print-pages').replaceChildren(...printPages);
  renderSelection();
}

function clearFile() {
  if (fileUrl) URL.revokeObjectURL(fileUrl);
  fileUrl = '';
  byId('download').removeAttribute('href');
}

function draftState() {
  const text = field.value.trim();
  const length = [...segments.segment(text)].length;
  if (!draftOn) return { dirty: Boolean(applied), length, text, error: '' };
  if (kind === 'image') {
    const dirty = reading || applied?.kind !== 'image' || ['asset', ...Object.keys(defaultImageStyle)].some(key => imageDraft[key] !== applied[key]);
    return { dirty, length, text, error: reading ? '正在读取图片…' : imageDraft.asset ? '' : '请选择图片，或试用示例。' };
  }
  const dirty = applied?.kind !== 'text' || field.value !== applied.text;
  const error = !length ? '请输入水印文字。' : length > 32 ? `请减少 ${length - 32} 个字符，最多 32 个。` : '';
  return { text, length, dirty, error };
}

function refresh() {
  const { dirty, error, length } = draftState();
  const printing = mode === 'print';
  const group = range.value === 'all';
  byId('image-mode').setAttribute('aria-pressed', String(!printing));
  byId('print-mode').setAttribute('aria-pressed', String(printing));
  byId('image-mode').disabled = byId('print-mode').disabled = busy || dirty;
  byId('toggle').setAttribute('aria-checked', String(draftOn));
  byId('toggle').disabled = busy;
  byId('off-hint').hidden = draftOn;
  byId('kind-picker').hidden = !draftOn;
  byId('text-panel').hidden = !draftOn || kind !== 'text';
  byId('image-panel').hidden = !draftOn || kind !== 'image';
  for (const type of ['text', 'image']) {
    byId(`${type}-kind`).setAttribute('aria-pressed', String(kind === type));
    byId(`${type}-kind`).disabled = busy;
  }
  renderImageControls();
  field.disabled = !draftOn || kind !== 'text' || busy;
  field.setAttribute('aria-invalid', String(kind === 'text' && Boolean(error)));
  byId('counter').textContent = `${draftOn ? length : 0} / 32`;
  let feedback = error;
  if (!draftOn && dirty) feedback = '应用后将移除全部页的水印。';
  else if (dirty && !error) feedback = kind === 'image' ? '当前页正在试排，应用后更新全部谱页。' : '应用后更新全部谱页。';
  else if (applied && !dirty) feedback = '已应用于本曲谱的全部页。';
  byId('feedback').textContent = uploadError && kind === 'image' && error ? '' : feedback;
  byId('feedback').classList.toggle('error', Boolean(error) && kind === 'text');
  byId('draft-actions').hidden = !dirty;
  byId('apply').disabled = Boolean(error) || busy;
  byId('restore').disabled = busy;
  byId('settings-title').textContent = printing ? '打印设置' : '图片设置';
  for (const id of ['range-field', 'resolution', 'pixels']) byId(id).hidden = printing;
  byId('print-help').hidden = !printing;
  range.disabled = busy;
  byId('previous').disabled = busy || !current;
  byId('next').disabled = busy || current === count - 1;
  for (const button of byId('thumbs').children) button.disabled = busy;
  const showDownload = !printing && !!fileUrl && !dirty && !busy;
  byId('download').hidden = !showDownload;
  byId('produce').hidden = showDownload;
  byId('produce').disabled = busy || dirty;
  byId('produce').textContent = printing ? '打开打印窗口' : busy ? '正在生成…' : group ? `生成全部 ${count} 页` : `生成第 ${current + 1} 页图片`;
  byId('cancel-job').hidden = !busy || printing;
  byId('close').disabled = busy && printing;
  byId('output-message').textContent = dirty ? '请先应用或还原水印，再输出曲谱。' : statusMessage || (printing ? `将打印全部 ${count} 页` : group ? `${count} 张 PNG 图片，将打包为 ZIP` : `当前第 ${current + 1} 页，将生成为 PNG`);
}

function renderImageControls() {
  const { asset, size, opacity, position, angle } = imageDraft;
  byId('empty-upload').hidden = !!asset;
  byId('filled-upload').hidden = !asset;
  byId('placement').hidden = !asset;
  byId('placement').disabled = busy || reading;
  byId('sample-logo').hidden = !!asset;
  byId('sample-logo').disabled = byId('upload').disabled = busy;
  if (asset) {
    if (byId('logo-thumb').getAttribute('src') !== asset.url) byId('logo-thumb').src = asset.url;
    byId('logo-name').textContent = asset.name;
    byId('logo-size').textContent = `${asset.width} × ${asset.height} px`;
  } else byId('logo-thumb').removeAttribute('src');
  byId('size').value = size;
  byId('size-value').value = `纸宽的 ${size}%`;
  byId('opacity').value = opacity;
  byId('opacity-value').value = opacity + '%';
  byId('angle').value = angle;
  byId('angle-value').value = angle > 0 ? `+${angle}°` : `${angle}°`;
  byId('angle').setAttribute('aria-valuetext', angle === 0 ? '水平，0 度' : `${angle < 0 ? '逆时针' : '顺时针'} ${Math.abs(angle)} 度`);
  for (const button of byId('angle-presets').children) button.setAttribute('aria-pressed', String(angle === Number(button.dataset.angle)));
  for (const button of byId('positions').children) button.setAttribute('aria-pressed', String(position === button.dataset.position));
  byId('upload-message').textContent = uploadError;
  byId('upload-message').classList.toggle('error', Boolean(uploadError));
}

function cancelRead() {
  loadVersion++;
  reading = false;
  uploadError = '';
  byId('upload').classList.remove('dragging');
}

function restoreDraft() {
  cancelRead();
  field.value = applied?.text || '';
  kind = applied?.kind || 'text';
  imageDraft = kind === 'image' ? { ...applied } : { ...defaultImageStyle, asset: null };
  draftOn = Boolean(applied);
  refresh();
  renderCurrentPage();
}

function selectPage(index) {
  if (busy || index === current || index < 0 || index >= count) return;
  current = index;
  if (range.value === 'page') { clearFile(); statusMessage = ''; }
  renderSelection();
  byId('thumbs').children[index].scrollIntoView({block:'nearest'});
  refresh();
}

function switchMode(nextMode) {
  if (busy || draftState().dirty || nextMode === mode) return;
  clearFile();
  mode = nextMode;
  statusMessage = '';
  refresh();
}

function cancelJob() {
  operation += 1;
  busy = false;
  statusMessage = '已取消生成，可调整后重试。';
  refresh();
}

function closePreview() {
  if (mode === 'print' && busy) return;
  cancelJob();
  clearFile();
  statusMessage = '';
  restoreDraft();
  preview.close();
  (opener || document.querySelector(`[data-open="${mode}"]`)).focus();
}

function openPreview(nextMode, trigger) {
  opener = trigger;
  mode = nextMode;
  current = 0;
  range.value = 'all';
  setZoom(false);
  restoreDraft();
  renderSelection();
  preview.showModal();
  byId('toggle').focus({preventScroll:true});
}

function setZoom(zoomed) {
  byId('viewport').classList.toggle('zoomed', zoomed);
  byId('zoom').textContent = zoomed ? '适应整页' : '放大查看';
  byId('zoom').setAttribute('aria-pressed', String(zoomed));
}

async function generate() {
  if (busy || draftState().dirty) return;
  const token = ++operation;
  const selected = range.value === 'all' ? ink.map((_, i) => i) : [current];
  const stamp = mark;
  const files = {};
  busy = true;
  clearFile();
  try {
    for (const [position, index] of selected.entries()) {
      statusMessage = `正在生成第 ${position + 1} / ${selected.length} 张图片…`;
      refresh();
      await ink[index].decode();
      if (token !== operation) return;
      const canvas = document.createElement('canvas');
      canvas.width = 2480;
      canvas.height = 3508;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (stamp) {
        // 每一页复用已应用的角度；局部坐标只作用于水印，后续谱线和页脚使用原纸面坐标。
        ctx.save();
        ctx.globalAlpha = stamp.opacity;
        ctx.translate(stamp.x + stamp.width / 2, stamp.y + stamp.height / 2);
        ctx.rotate((stamp.angle || 0) * Math.PI / 180);
        ctx.drawImage(stamp.canvas, -stamp.width / 2, -stamp.height / 2, stamp.width, stamp.height);
        ctx.restore();
      }
      ctx.drawImage(ink[index], 0, 0);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      canvas.width = canvas.height = 1;
      if (token !== operation) return;
      if (!blob) throw Error('PNG 编码失败');
      files[`理想_${String(index + 1).padStart(3, '0')}.png`] = scoreFiles.png(new Uint8Array(await blob.arrayBuffer()));
      if (token !== operation) return;
    }
    const zipped = selected.length > 1;
    const name = zipped ? '理想_A4图片.zip' : Object.keys(files)[0];
    const data = zipped ? scoreFiles.zip(files) : files[name];
    fileUrl = URL.createObjectURL(new Blob([data], {type:zipped ? 'application/zip' : 'image/png'}));
    const link = byId('download');
    link.href = fileUrl;
    link.download = name;
    link.textContent = zipped ? '下载图片包 (.zip)' : '下载图片 (.png)';
    statusMessage = `${name} 已生成`;
  } catch {
    if (token === operation) statusMessage = '生成失败，请重新生成图片。';
  } finally {
    if (token === operation) { busy = false; refresh(); }
  }
}

async function printScore() {
  if (busy || draftState().dirty) return;
  busy = true;
  statusMessage = '正在准备打印…';
  refresh();
  try {
    await Promise.all([...byId('print-pages').querySelectorAll('img')].map(img => img.decode()));
    window.print();
  } catch {
    busy = false;
    statusMessage = '打印准备失败，请重试。';
    refresh();
  }
}

byId('page-total').textContent = `共 ${count} 页`;
ink.forEach((_, i) => {
  const button = document.createElement('button');
  button.className = 'thumb';
  button.setAttribute('aria-label', `第 ${i + 1} 页`);
  const paper = document.createElement('span');
  paper.className = 'paper';
  const caption = document.createElement('span');
  caption.className = 'thumb-caption';
  caption.textContent = `第 ${i + 1} 页`;
  button.append(paper, caption);
  button.addEventListener('click', () => selectPage(i));
  byId('thumbs').append(button);
});
byId('toggle').onclick = () => {
  cancelRead();
  draftOn = !draftOn;
  refresh();
  renderCurrentPage();
  if (draftOn) (kind === 'image' ? byId('upload') : field).focus();
};
for (const type of ['text', 'image']) byId(`${type}-kind`).onclick = () => {
  if (kind === type) return;
  cancelRead();
  kind = type;
  refresh();
  renderCurrentPage();
};

async function chooseFile(file) {
  if (!file || busy || !draftOn || kind !== 'image') return;
  cancelRead();
  const version = loadVersion;
  reading = true;
  refresh();
  try {
    const asset = await readLogo(file);
    // 替换、还原或关闭可打断解码，迟到的文件不能覆盖用户后一次选择。
    if (version === loadVersion) imageDraft.asset = asset;
  } catch (e) {
    if (version === loadVersion) uploadError = e.message + (imageDraft.asset ? ' 已保留原图。' : '');
  } finally {
    if (version === loadVersion) {
      reading = false;
      refresh();
      renderCurrentPage();
    }
  }
}

const upload = byId('upload');
upload.onclick = () => byId('logo-file').click();
byId('logo-file').onchange = event => {
  const file = event.target.files[0];
  event.target.value = '';
  chooseFile(file);
};
upload.ondragover = event => { event.preventDefault(); if (!busy) upload.classList.add('dragging'); };
upload.ondragleave = event => { if (!upload.contains(event.relatedTarget)) upload.classList.remove('dragging'); };
upload.ondrop = event => { event.preventDefault(); upload.classList.remove('dragging'); chooseFile(event.dataTransfer.files[0]); };
byId('sample-logo').onclick = () => {
  cancelRead();
  imageDraft.asset = createExampleLogo();
  refresh();
  renderCurrentPage();
  upload.focus();
};
function updateImageStyle(key, value) {
  imageDraft[key] = value;
  refresh();
  renderCurrentPage();
}
for (const key of ['size', 'opacity', 'angle']) byId(key).oninput = event => updateImageStyle(key, Number(event.target.value));
for (const button of byId('angle-presets').children) button.onclick = () => updateImageStyle('angle', Number(button.dataset.angle));
for (const button of byId('positions').children) button.onclick = () => {
  updateImageStyle('position', button.dataset.position);
};
field.oninput = refresh;
field.onpaste = event => {
  const text = event.clipboardData.getData('text/plain');
  if (!/[\r\n]/.test(text)) return;
  event.preventDefault();
  field.setRangeText(text.replace(/(?:\r\n|\r|\n)+/g, ' '), field.selectionStart, field.selectionEnd, 'end');
  refresh();
};
field.onkeydown = event => {
  if (event.key === 'Enter' && !event.isComposing && !byId('apply').disabled && draftState().dirty) byId('apply').click();
};
byId('apply').onclick = () => {
  const { text, error } = draftState();
  if (error || busy) return;
  let next = null;
  if (draftOn) next = kind === 'image' ? { ...imageDraft, kind } : { kind, text };
  if (kind !== 'text' || applied?.kind !== 'text' || next?.text !== applied.text) clearFile();
  applied = next;
  statusMessage = '';
  restoreDraft();
  renderPages();
  byId('toggle').focus();
};
byId('restore').onclick = () => { restoreDraft(); byId('toggle').focus(); };
range.onchange = () => { clearFile(); statusMessage = ''; refresh(); };
byId('image-mode').onclick = () => switchMode('image');
byId('print-mode').onclick = () => switchMode('print');
byId('previous').onclick = () => selectPage(current - 1);
byId('next').onclick = () => selectPage(current + 1);
byId('zoom').onclick = () => setZoom(!byId('viewport').classList.contains('zoomed'));
byId('close').onclick = closePreview;
byId('cancel-job').onclick = cancelJob;
byId('produce').onclick = () => mode === 'print' ? printScore() : generate();
window.addEventListener('afterprint', () => { if (mode === 'print' && busy) { busy = false; statusMessage = '已关闭打印窗口。'; refresh(); } });
preview.addEventListener('cancel', event => { event.preventDefault(); closePreview(); });
document.querySelectorAll('[data-open]').forEach(button => button.onclick = () => openPreview(button.dataset.open, button));
renderPages();
openPreview(location.hash === '#print' ? 'print' : 'image');
// 评审入口展示尚未应用的 -30°，可直接比较当前页与左侧已应用的水平缩略图。
if (location.hash === '#rotate') {
  updateImageStyle('angle', -30);
  byId('angle').focus({ preventScroll: true });
}
