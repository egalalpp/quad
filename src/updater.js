// Обновления: при входе спрашиваем GitHub, нет ли версии новее, и ставим её поверх.
const { app, shell } = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const { createWriteStream } = require('node:fs');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { isNewer } = require('./version');

const RELEASES_URL = 'https://api.github.com/repos/egalalpp/quad/releases/latest';
const REQUEST_TIMEOUT = 10000;
const DOWNLOAD_TIMEOUT = 15 * 60 * 1000;
const INSTALLER = /^Quad-Setup-.*\.exe$/;

let offer = null;

async function check() {
  const response = await fetch(RELEASES_URL, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Quad' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });
  if (!response.ok) return null;

  const release = await response.json();
  if (!isNewer(release.tag_name, app.getVersion())) {
    offer = null;
    return null;
  }

  const asset = release.assets.find((item) => INSTALLER.test(item.name));
  offer = { page: release.html_url, asset };
  return {
    version: release.tag_name.replace(/^v/, ''),
    notes: release.body ?? '',
    // На Mac без подписи Apple приложение не может обновить само себя.
    canInstall: process.platform === 'win32' && Boolean(asset),
  };
}

async function download(onProgress) {
  const { asset } = offer;
  const file = path.join(app.getPath('temp'), asset.name);
  const response = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT) });
  if (!response.ok) throw new Error(`Файл недоступен: ${response.status}`);

  const hash = crypto.createHash('sha256');
  let received = 0;
  const counter = new Transform({
    transform(chunk, _encoding, done) {
      received += chunk.length;
      hash.update(chunk);
      onProgress(received / asset.size);
      done(null, chunk);
    },
  });

  await pipeline(Readable.fromWeb(response.body), counter, createWriteStream(file));

  // Недокачанный или подменённый установщик запускать нельзя.
  if (received !== asset.size) throw new Error('Файл скачался не полностью');
  if (asset.digest && asset.digest !== `sha256:${hash.digest('hex')}`) throw new Error('Файл не совпал с релизом');
  return file;
}

// Установщик тихо ставит новую версию на место старой и сам запускает её.
async function install(onProgress) {
  if (!offer?.asset) throw new Error('Нечего устанавливать');
  const file = await download(onProgress);
  spawn(file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
  app.quit();
}

function openPage() {
  if (offer) shell.openExternal(offer.page);
}

module.exports = { check, install, openPage };
