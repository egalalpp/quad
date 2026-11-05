const { app, dialog, shell } = require('electron');
const fs = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { buildTag, withoutExistingTag } = require('./id3');

const id = 'downloads';
const MAX_NAME_LENGTH = 150;
const REQUEST_TIMEOUT = 120000;
const COVER_TIMEOUT = 15000;
const MAX_ADOPTED_PER_RUN = 20;

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const recordsFile = () => path.join(app.getPath('userData'), 'downloads.json');
const sameTrack = (a, b) => a.provider === b.provider && a.id === b.id;

async function readSettings() {
  try {
    return JSON.parse(await fs.readFile(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}

async function folder() {
  const { downloadFolder } = await readSettings();
  return downloadFolder ?? path.join(app.getPath('music'), 'Quad');
}

async function chooseFolder(parent) {
  const { canceled, filePaths } = await dialog.showOpenDialog(parent, {
    title: 'Папка для музыки',
    defaultPath: await folder(),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled) return folder();

  const [downloadFolder] = filePaths;
  await fs.writeFile(settingsFile(), JSON.stringify({ ...(await readSettings()), downloadFolder }));
  return downloadFolder;
}

async function openFolder() {
  const directory = await folder();
  await fs.mkdir(directory, { recursive: true });
  await shell.openPath(directory);
}

function fileName(track) {
  const name = `${track.artists} - ${track.title}`
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/, '')
    .slice(0, MAX_NAME_LENGTH);
  return `${name}.mp3`;
}

const fileExists = (file) => fs.access(file).then(() => true, () => false);

/* Список скачанного */

async function readRecords() {
  try {
    return JSON.parse(await fs.readFile(recordsFile(), 'utf8'));
  } catch {
    return [];
  }
}

// Несколько скачиваний могут закончиться одновременно, поэтому запись идёт строго по очереди.
let writing = Promise.resolve();

function updateRecords(change) {
  writing = writing.catch(() => {}).then(async () => {
    await fs.writeFile(recordsFile(), JSON.stringify(change(await readRecords())));
  });
  return writing;
}

// Файл могли удалить руками: тогда трека в списке больше нет.
async function existingRecords() {
  const records = await readRecords();
  const flags = await Promise.all(records.map((record) => fileExists(record.file)));
  return records.filter((_record, index) => flags[index]);
}

async function isSaved(track) {
  if (await fileExists(path.join(await folder(), fileName(track)))) return true;
  return (await existingRecords()).some((record) => sameTrack(record, track));
}

async function library() {
  return { provider: id, id, title: 'Скачанные', count: (await existingRecords()).length, cover: null };
}

async function collection() {
  const records = await existingRecords();
  return { tracks: records.reverse().map(({ file: _file, ...track }) => track), nextOffset: null };
}

// Файлы, скачанные до появления списка: по имени файла ищем, какой это был трек.
async function adopt(findTracks) {
  const directory = await folder();
  const known = new Set((await readRecords()).map((record) => path.basename(record.file)));
  const names = (await fs.readdir(directory).catch(() => []))
    .filter((name) => name.endsWith('.mp3') && !known.has(name))
    .slice(0, MAX_ADOPTED_PER_RUN);

  for (const name of names) {
    const tracks = await findTracks(name.slice(0, -'.mp3'.length).replace(' - ', ' ')).catch(() => []);
    const track = tracks.find((item) => fileName(item) === name);
    if (track) await updateRecords((list) => [...list, { ...track, file: path.join(directory, name) }]);
  }
}

// Без обложки трек всё равно сохраняется: она украшение, а не повод терять файл.
async function loadCover(track) {
  const url = track.coverLarge ?? track.cover;
  if (!url) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(COVER_TIMEOUT) });
    if (!response.ok) return null;
    const mime = response.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg';
    return { mime, data: Buffer.from(await response.arrayBuffer()) };
  } catch {
    return null;
  }
}

async function save(track, stream, lyrics) {
  if (stream.preview) throw new Error('Доступен только отрывок');

  const directory = await folder();
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, fileName(track));
  const partial = `${target}.part`;

  const [response, cover] = await Promise.all([
    fetch(stream.url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT) }),
    loadCover(track),
  ]);
  if (!response.ok) throw new Error(`Файл недоступен: ${response.status}`);

  // Недокачанный файл не должен выглядеть как готовый трек.
  try {
    await fs.writeFile(partial, buildTag({ track, lyrics, cover }));
    await pipeline(Readable.fromWeb(response.body), withoutExistingTag(), createWriteStream(partial, { flags: 'a' }));
    await fs.rename(partial, target);
  } catch (error) {
    await fs.rm(partial, { force: true });
    throw error;
  }

  await updateRecords((list) => [
    ...list.filter((record) => !sameTrack(record, track)),
    { ...track, file: target },
  ]);
  return target;
}

module.exports = { id, folder, chooseFolder, openFolder, save, isSaved, library, collection, adopt };
