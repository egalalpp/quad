// Рисует значки Quad для Windows и Mac и картинки установщика.
// Запуск: npx electron scripts/make-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SIZES = [16, 24, 32, 48, 64, 128, 256];

// На Mac значок не во весь квадрат: система ждёт поля вокруг, иначе он крупнее соседних.
const MAC_ICONS = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]];
const MAC_ART_SHARE = 824 / 1024;

const SIDEBAR = [164, 314];
const HEADER = [150, 57];
const OUTPUT = path.join(__dirname, '..', 'assets');
const FONT = path.join(
  __dirname,
  '..',
  'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
);

// Знак Quad: четыре дуги с открытыми углами, как четыре струны заставки.
// Через свободный угол проходит хвостик, и круг становится буквой Q.
// Выполняется внутри страницы, поэтому всё нужное лежит внутри функции.
function drawMark(ctx, size, centerX, centerY) {
  const small = size <= 48;
  const radius = size * 0.285;
  const halfGap = small ? 0.2 : 0.27;

  // Угол с хвостиком чуть шире остальных, иначе дуги упираются в него.
  const tailRoom = small ? 0.06 : 0.1;
  const paint = ctx.createLinearGradient(0, centerY - radius, 0, centerY + radius * 1.5);
  paint.addColorStop(0, '#ffffff');
  paint.addColorStop(1, '#a9a9b4');

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = size * (small ? 0.105 : 0.06);
  ctx.strokeStyle = paint;
  if (size >= 64) {
    ctx.shadowColor = 'rgba(255, 255, 255, 0.4)';
    ctx.shadowBlur = size * 0.05;
  }

  for (let quarter = 0; quarter < 4; quarter += 1) {
    const corner = Math.PI / 4 + (quarter * Math.PI) / 2;
    ctx.beginPath();
    const from = corner + halfGap + (quarter === 0 ? tailRoom : 0);
    const to = corner + Math.PI / 2 - halfGap - (quarter === 3 ? tailRoom : 0);
    ctx.arc(centerX, centerY, radius, from, to);
    ctx.stroke();
  }

  const diagonal = Math.SQRT1_2;
  ctx.beginPath();
  ctx.moveTo(centerX + radius * 0.5 * diagonal, centerY + radius * 0.5 * diagonal);
  ctx.lineTo(centerX + radius * 1.5 * diagonal, centerY + radius * 1.5 * diagonal);
  ctx.stroke();
  ctx.restore();
}

async function drawIcon(canvasSize, share, mark) {
  const canvas = document.createElement('canvas');
  canvas.width = canvasSize;
  canvas.height = canvasSize;
  const ctx = canvas.getContext('2d');

  const size = canvasSize * share;
  const offset = (canvasSize - size) / 2;
  ctx.translate(offset, offset);

  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, size * 0.23);
  const background = ctx.createLinearGradient(0, 0, 0, size);
  background.addColorStop(0, '#222226');
  background.addColorStop(1, '#050506');
  ctx.fillStyle = background;
  ctx.fill();

  const glow = ctx.createRadialGradient(size * 0.5, size * 0.42, 0, size * 0.5, size * 0.42, size * 0.6);
  glow.addColorStop(0, 'rgba(255, 255, 255, 0.09)');
  glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = glow;
  ctx.fill();

  mark(ctx, size, size * 0.485, size * 0.485);
  return canvas.toDataURL('image/png');
}

// Картинка установщика: чёрный фон, надпись и четыре линии с открытыми углами, как в заставке.
async function drawBanner(width, height, fontUrl, mark) {
  const font = new FontFace('Inter', `url(${fontUrl})`, { weight: '100 900' });
  document.fonts.add(await font.load());

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';

  // Сбоку установщика знак и название, в узкой шапке только знак.
  if (height > 100) {
    mark(ctx, width * 0.9, width / 2, height * 0.42);
    ctx.font = `300 ${width * 0.17}px Inter`;
    ctx.textAlign = 'center';
    ctx.fillText('quad', width / 2, height * 0.66);
  } else {
    mark(ctx, height * 0.95, width - height * 0.55, height / 2);
  }

  return [...ctx.getImageData(0, 0, width, height).data];
}

// Установщик понимает только BMP без прозрачности.
function buildBmp(width, height, rgba) {
  const stride = Math.ceil((width * 3) / 4) * 4;
  const size = stride * height;
  const bmp = Buffer.alloc(54 + size);
  bmp.write('BM', 0, 'latin1');
  bmp.writeUInt32LE(bmp.length, 2);
  bmp.writeUInt32LE(54, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(width, 18);
  bmp.writeInt32LE(height, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  bmp.writeUInt32LE(size, 34);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = ((height - 1 - y) * width + x) * 4;
      const to = 54 + y * stride + x * 3;
      bmp[to] = rgba[from + 2];
      bmp[to + 1] = rgba[from + 1];
      bmp[to + 2] = rgba[from];
    }
  }
  return bmp;
}

function buildIcns(images) {
  const chunks = images.map(({ type, data }) => {
    const header = Buffer.alloc(8);
    header.write(type, 0, 'latin1');
    header.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([header, data]);
  });
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'latin1');
  header.writeUInt32BE(8 + chunks.reduce((total, chunk) => total + chunk.length, 0), 4);
  return Buffer.concat([header, ...chunks]);
}

function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = header.length + images.length * 16;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0);
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('about:blank');

  const fontUrl = `data:font/woff2;base64,${fs.readFileSync(FONT).toString('base64')}`;
  const draw = async (size, share) => {
    const code = `(${drawIcon.toString()})(${size}, ${share}, ${drawMark.toString()})`;
    const url = await win.webContents.executeJavaScript(code);
    return Buffer.from(url.split(',')[1], 'base64');
  };
  const banner = async ([width, height]) => {
    const code = `(${drawBanner.toString()})(${width}, ${height}, ${JSON.stringify(fontUrl)}, ${drawMark.toString()})`;
    return buildBmp(width, height, await win.webContents.executeJavaScript(code));
  };

  const images = [];
  for (const size of SIZES) images.push({ size, data: await draw(size, 1) });

  const macImages = [];
  for (const [type, size] of MAC_ICONS) macImages.push({ type, data: await draw(size, MAC_ART_SHARE) });

  fs.mkdirSync(OUTPUT, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT, 'icon.ico'), buildIco(images));
  fs.writeFileSync(path.join(OUTPUT, 'icon.png'), images.at(-1).data);
  fs.writeFileSync(path.join(OUTPUT, 'icon.icns'), buildIcns(macImages));
  fs.writeFileSync(path.join(OUTPUT, 'installer-sidebar.bmp'), await banner(SIDEBAR));
  fs.writeFileSync(path.join(OUTPUT, 'installer-header.bmp'), await banner(HEADER));
  app.quit();
});
