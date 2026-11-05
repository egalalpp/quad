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

// Выполняется внутри страницы: строчная q из шрифта интерфейса, с его настоящими пропорциями.
async function drawIcon(canvasSize, fontUrl, share) {
  const font = new FontFace('Inter', `url(${fontUrl})`, { weight: '100 900' });
  document.fonts.add(await font.load());

  const canvas = document.createElement('canvas');
  canvas.width = canvasSize;
  canvas.height = canvasSize;
  const ctx = canvas.getContext('2d');

  const size = canvasSize * share;
  ctx.translate((canvasSize - size) / 2, (canvasSize - size) / 2);

  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, size * 0.23);
  const background = ctx.createLinearGradient(0, 0, 0, size);
  background.addColorStop(0, '#1e1e1e');
  background.addColorStop(1, '#000000');
  ctx.fillStyle = background;
  ctx.fill();

  // На мелких размерах тонкая буква рассыпается, поэтому она жирнее.
  const weight = size <= 32 ? 600 : 400;
  ctx.font = `${weight} ${size * 0.86}px Inter`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // Центрируется по видимым границам буквы, а не по метрикам шрифта.
  const box = ctx.measureText('q');
  const width = box.actualBoundingBoxLeft + box.actualBoundingBoxRight;
  const height = box.actualBoundingBoxAscent + box.actualBoundingBoxDescent;
  const x = (size - width) / 2 + box.actualBoundingBoxLeft;
  const y = (size - height) / 2 + box.actualBoundingBoxAscent;

  const metal = ctx.createLinearGradient(0, size * 0.2, 0, size * 0.85);
  metal.addColorStop(0, '#ffffff');
  metal.addColorStop(1, '#bdbdbd');
  ctx.fillStyle = metal;

  if (size >= 64) {
    ctx.shadowColor = 'rgba(255, 255, 255, 0.35)';
    ctx.shadowBlur = size * 0.05;
  }
  ctx.fillText('q', x, y);

  return canvas.toDataURL('image/png');
}

// Картинка установщика: чёрный фон, надпись и четыре линии с открытыми углами, как в заставке.
async function drawBanner(width, height, fontUrl) {
  const font = new FontFace('Inter', `url(${fontUrl})`, { weight: '100 900' });
  document.fonts.add(await font.load());

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);

  const size = Math.min(width, height) * 0.62;
  const centerX = width / 2;
  const centerY = height / 2;
  ctx.translate(centerX, centerY);

  if (height > 100) {
    ctx.save();
    ctx.rotate(0.3);
    ctx.lineWidth = 1;
    for (let side = 0; side < 4; side += 1) {
      const length = size * 0.37;
      const gradient = ctx.createLinearGradient(-length, 0, length, 0);
      gradient.addColorStop(0, 'rgba(255,255,255,0)');
      gradient.addColorStop(0.18, 'rgba(255,255,255,0.8)');
      gradient.addColorStop(0.82, 'rgba(255,255,255,0.8)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(-length, -size / 2);
      ctx.lineTo(length, -size / 2);
      ctx.stroke();
      ctx.rotate(Math.PI / 2);
    }
    ctx.restore();
  }

  ctx.fillStyle = '#fff';
  ctx.font = `300 ${height > 100 ? size * 0.3 : height * 0.42}px Inter`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('quad', 0, 0);

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
    const code = `(${drawIcon.toString()})(${size}, ${JSON.stringify(fontUrl)}, ${share})`;
    const url = await win.webContents.executeJavaScript(code);
    return Buffer.from(url.split(',')[1], 'base64');
  };
  const banner = async ([width, height]) => {
    const code = `(${drawBanner.toString()})(${width}, ${height}, ${JSON.stringify(fontUrl)})`;
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
