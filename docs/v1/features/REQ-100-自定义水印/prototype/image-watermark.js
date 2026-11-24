const defaultImageStyle = { size: 38, opacity: 18, position: 'center', angle: 0 };

function makeAsset(name, raster, width, height) {
  return { name, raster, url: raster.toDataURL('image/png'), width, height };
}

// 示例也是一幅透明位图，替换示例与上传本地文件共用同一套试排和输出逻辑。
function createExampleLogo() {
  const canvas = document.createElement('canvas');
  canvas.width = 630;
  canvas.height = 250;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#215745';
  ctx.beginPath();
  ctx.moveTo(108, 235);
  ctx.bezierCurveTo(94, 232, 14, 139, 14, 82);
  ctx.bezierCurveTo(14, -7, 203, -7, 203, 82);
  ctx.bezierCurveTo(203, 141, 125, 233, 108, 235);
  ctx.fill();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(108, 102, 37, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 6; i++) ctx.fillRect(92 + i * 6, 64, 2.6, 76);
  ctx.font = 'bold 126px "Songti SC", "Noto Serif CJK SC", serif';
  ctx.fillText('青 禾', 241, 133);
  ctx.font = '46px "PingFang SC", sans-serif';
  ctx.fillText('吉 他 教 室', 251, 210);
  return makeAsset('青禾吉他教室.png', canvas, canvas.width, canvas.height);
}

async function readLogo(file) {
  if (file.size > 5 * 1024 * 1024) throw Error('图片超过 5 MB，请压缩后重试。');
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const bytes = String.fromCharCode(...header);
  const supported = bytes.startsWith('\x89PNG\r\n\x1a\n') || bytes.startsWith('\xff\xd8\xff') || (bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP');
  if (!supported) throw Error('请选择 PNG、JPG 或 WebP 格式的图片。');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const { naturalWidth: width, naturalHeight: height } = image;
    // 冻结一帧并缩到足够覆盖 A4 输出的尺寸，保留原始比例和透明通道。
    const scale = Math.min(1, 1800 / Math.max(width, height));
    const raster = document.createElement('canvas');
    raster.width = Math.max(1, Math.round(width * scale));
    raster.height = Math.max(1, Math.round(height * scale));
    raster.getContext('2d').drawImage(image, 0, 0, raster.width, raster.height);
    return makeAsset(file.name, raster, width, height);
  } catch {
    throw Error('无法读取这张图片，请重新导出或换一张。');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function imageStamp({ asset, size, opacity, position, angle = 0 }) {
  if (!asset) return null;
  const scale = (2480 * size / 100) / Math.max(asset.width, asset.height);
  const width = asset.width * scale;
  const height = asset.height * scale;
  const margin = 2480 * .06;
  let x = (2480 - width) / 2;
  let y = (3508 - height) / 2;
  if (position !== 'center') {
    // 锚定旋转后最外侧的边。返回的 x、y 仍是原图左上角，供预览和成品绕同一中心旋转。
    const radians = angle * Math.PI / 180;
    const cos = Math.abs(Math.cos(radians));
    const sin = Math.abs(Math.sin(radians));
    const outerWidth = width * cos + height * sin;
    const outerHeight = width * sin + height * cos;
    const centerX = position === 'left' ? margin + outerWidth / 2 : 2480 - margin - outerWidth / 2;
    x = centerX - width / 2;
    y = 3508 - margin - (outerHeight + height) / 2;
  }
  return { url: asset.url, canvas: asset.raster, x, y, width, height, angle, opacity: opacity / 100 };
}
