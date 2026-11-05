const { app, BrowserWindow, Menu, ipcMain, session } = require('electron');
const path = require('node:path');
const downloads = require('./downloads');
const lyrics = require('./lyrics');
const playlists = require('./playlists');
const yandex = require('./providers/yandex');
const wave = require('./wave/service');

const isMac = process.platform === 'darwin';

const providers = { yandex };
const trackSources = { ...providers, quad: playlists, downloads };

function providerById(id) {
  if (!Object.hasOwn(trackSources, id)) throw new Error(`Неизвестный сервис: ${id}`);
  return trackSources[id];
}

function shuffled(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Без этого заголовка эквалайзер получал бы тишину, а цвет обложки нельзя было бы прочитать:
// браузер не отдаёт в обработку данные с чужого домена, если сервер явно этого не разрешил.
function allowAudioProcessing() {
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ['https://*.yandex.net/*'] },
    (details, callback) => {
      if (details.resourceType !== 'media' && details.resourceType !== 'image') {
        callback({});
        return;
      }
      const headers = Object.fromEntries(
        Object.entries(details.responseHeaders)
          .filter(([name]) => name.toLowerCase() !== 'access-control-allow-origin'),
      );
      callback({ responseHeaders: { ...headers, 'Access-Control-Allow-Origin': ['*'] } });
    },
  );
}

let mainWindow = null;
let quitting = false;

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 760,
    minHeight: 480,
    backgroundColor: '#000000',
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    show: false,

    // На Mac кнопки окна системные, поверх нашего содержимого. В остальных системах они свои.
    ...(isMac
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 14 } }
      : { frame: false }),

    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  const sendMaximized = () => win.webContents.send('window:maximized', win.isMaximized());
  win.on('maximize', sendMaximized);
  win.on('unmaximize', sendMaximized);

  // На Mac красная кнопка только прячет окно: музыка играет дальше, значок в доке вернёт окно.
  win.on('close', (event) => {
    if (isMac && !quitting) {
      event.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => {
    mainWindow = null;
  });

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow = win;
}

function senderWindow(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

ipcMain.on('window:minimize', (event) => senderWindow(event).minimize());
ipcMain.on('window:close', (event) => senderWindow(event).close());
ipcMain.on('window:toggle-maximize', (event) => {
  const win = senderWindow(event);
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});

ipcMain.handle('music:accounts', () => Promise.all(
  Object.values(providers).map(async (provider) => ({
    id: provider.id,
    name: provider.name,
    ...(await provider.status()),
  })),
));

ipcMain.handle('music:connect', (event, id) => providerById(id).login(senderWindow(event)));
ipcMain.handle('music:disconnect', (_event, id) => providerById(id).logout());
ipcMain.handle('music:stream', (_event, id, trackId) => providerById(id).streamUrl(trackId));

// Сначала текст самого сервиса, а если его нет или он не загрузился, то запасной источник.
ipcMain.handle('music:lyrics', async (_event, track) => {
  if (track.lyrics) {
    try {
      return await providerById(track.provider).lyrics(track.id, track.lyrics);
    } catch {
      // Идём дальше, к запасному источнику.
    }
  }
  return lyrics.find(track);
});

ipcMain.handle('music:collection', (_event, id, collectionId, offset) => (
  providerById(id).collection(collectionId, offset)
));

async function connectedProviders() {
  const all = Object.values(providers);
  const flags = await Promise.all(all.map((provider) => provider.isConnected()));
  return all.filter((_provider, index) => flags[index]);
}

// Спрашивает все подключённые сервисы и падает, только если не ответил ни один.
async function fromConnected(ask) {
  const connected = await connectedProviders();
  const results = await Promise.allSettled(connected.map(ask));
  const found = results.filter((result) => result.status === 'fulfilled');
  if (connected.length > 0 && found.length === 0) throw results[0].reason;
  return found.flatMap((result) => result.value);
}

ipcMain.handle('music:search', async (_event, text) => {
  const results = await fromConnected(async (provider) => [await provider.search(text)]);
  return {
    best: results.find((result) => result.best)?.best ?? null,
    tracks: results.flatMap((result) => result.tracks),
    artists: results.flatMap((result) => result.artists),
    albums: results.flatMap((result) => result.albums),
  };
});

let adopted = null;

ipcMain.handle('music:library', async () => {
  adopted ??= downloads.adopt((text) => fromConnected(async (provider) => (await provider.search(text)).tracks));
  await adopted;

  const remote = await fromConnected((provider) => provider.library());
  return [
    ...remote.filter((collection) => collection.id === 'liked'),
    await downloads.library(),
    ...remote.filter((collection) => collection.id !== 'liked'),
    ...(await playlists.library()),
  ];
});

ipcMain.handle('music:liked-keys', () => fromConnected(async (provider) => (
  (await provider.likedIds()).map((trackId) => `${provider.id}:${trackId}`)
)));
ipcMain.handle('music:set-liked', async (_event, id, trackId, liked) => {
  await providerById(id).setLiked(trackId, liked);
  wave.forgetTaste();
});

ipcMain.handle('wave:next', async (_event, options) => wave.next(await connectedProviders(), options));
ipcMain.handle('wave:event', (_event, track, type) => wave.recordEvent(track, type));

ipcMain.handle('downloads:folder', () => downloads.folder());
ipcMain.handle('downloads:choose', (event) => downloads.chooseFolder(senderWindow(event)));
ipcMain.handle('downloads:open', () => downloads.openFolder());
ipcMain.handle('downloads:save', async (_event, track) => (
  downloads.save(track, await providerById(track.provider).streamUrl(track.id))
));
ipcMain.handle('downloads:is-saved', (_event, track) => downloads.isSaved(track));

ipcMain.handle('playlists:list', () => playlists.load());
ipcMain.handle('playlists:create', (_event, title) => playlists.create(title));
ipcMain.handle('playlists:remove', (_event, id) => playlists.remove(id));
ipcMain.handle('playlists:toggle', (_event, id, track) => playlists.toggleTrack(id, track));

ipcMain.handle('music:artist', (_event, id, artistId) => providerById(id).artist(artistId));

// Треки всех аккаунтов перемешиваются между собой, а не идут блоками по сервисам.
ipcMain.handle('music:random', async (_event, count) => (
  shuffled(await fromConnected((provider) => provider.randomTracks(count)))
));

// То же, что выше, но уже сыгравшие в этом миксе треки не возвращаются.
ipcMain.handle('music:mix', async (_event, count, played) => {
  const skip = new Set(played);
  return shuffled(await fromConnected((provider) => provider.randomTracks(count, skip)));
});

// Кэш обложек на видеокарте: на экране их меньше чем на 40 МБ, а без предела он раздувается до сотен.
app.commandLine.appendSwitch('force-gpu-mem-discardable-limit-mb', '96');

app.setAppUserModelId('com.quad.player');

// На Mac без меню перестают работать Cmd+Q, Cmd+H и копирование с вставкой.
Menu.setApplicationMenu(isMac
  ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }])
  : null);

app.whenReady().then(() => {
  allowAudioProcessing();
  createWindow();
  app.on('activate', () => {
    if (mainWindow) mainWindow.show();
    else createWindow();
  });
});

app.on('before-quit', () => {
  quitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
