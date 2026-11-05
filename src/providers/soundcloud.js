// SoundCloud. Как и с Яндексом, официального пути для такого плеера нет: приложение работает
// от имени твоей сессии. Вход идёт в окне самого сайта, а ключ сайта и токен берутся из его
// собственных запросов, поэтому в коде ничего не зашито.
const { BrowserWindow, session } = require('electron');
const tokens = require('../token-store');
const {
  id,
  name,
  pickTranscoding,
  qualityOf,
  toAlbum,
  toArtist,
  toLibraryItem,
  toTracks,
} = require('./soundcloud-map');

const API_HOST = 'api-v2.soundcloud.com';
const API_URL = `https://${API_HOST}`;
const LOGIN_URL = 'https://soundcloud.com/signin';
const LOGIN_PARTITION = 'persist:soundcloud-login';
const TRENDING = '/charts?kind=trending&genre=soundcloud:genres:all-music&limit=50';
const mediaHosts = ['https://*.sndcdn.com/*', 'https://*.soundcloud.cloud/*'];
const REQUEST_TIMEOUT = 15000;
const RATE_LIMIT_DELAYS = [800, 2000];
const PAGE_SIZE = 100;
const MAX_LIKES = 5000;
const TRACKS_PER_REQUEST = 50;
const SEARCH_TRACKS = 20;
const SEARCH_OTHERS = 10;

let account = null;
let likes = null;
let likesRequest = null;
let openCollection = { id: null, tracks: [] };

function forget() {
  account = null;
  likes = null;
  openCollection = { id: null, tracks: [] };
}

async function credentials() {
  const saved = await tokens.read(id);
  return saved ? JSON.parse(saved) : null;
}

async function request(target, { method = 'GET' } = {}) {
  const saved = await credentials();
  if (!saved) throw new Error('SoundCloud не подключён');

  const url = new URL(target, API_URL);
  if (url.hostname !== API_HOST) throw new Error(`Неожиданный адрес: ${url.hostname}`);
  url.searchParams.set('client_id', saved.clientId);

  const send = () => fetch(url, {
    method,
    headers: { Authorization: `OAuth ${saved.token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });

  let response = await send();
  for (const delay of RATE_LIMIT_DELAYS) {
    if (response.status !== 429) break;
    await new Promise((resolve) => setTimeout(resolve, delay));
    response = await send();
  }

  // Сессия или ключ сайта устарели: при новом входе подхватятся свежие.
  if (response.status === 401) {
    await tokens.remove(id);
    forget();
  }
  if (!response.ok) throw new Error(`SoundCloud ответил ${response.status}`);
  return response;
}

const getJson = async (target) => (await request(target)).json();

async function allPages(target, limit) {
  const items = [];
  let next = target;
  while (next && items.length < limit) {
    const page = await getJson(next);
    items.push(...page.collection);
    next = page.next_href;
  }
  return items;
}

async function isConnected() {
  return Boolean(await tokens.read(id));
}

async function me() {
  account ??= await getJson('/me');
  return account;
}

async function status() {
  if (!await isConnected()) return { connected: false };
  try {
    const user = await me();
    return { connected: true, account: user.username };
  } catch {
    return { connected: await isConnected() };
  }
}

/* Поиск и страницы */

async function search(text) {
  const query = `q=${encodeURIComponent(text)}`;
  const [tracks, users, albums] = await Promise.all([
    getJson(`/search/tracks?${query}&limit=${SEARCH_TRACKS}`),
    getJson(`/search/users?${query}&limit=${SEARCH_OTHERS}`),
    getJson(`/search/albums?${query}&limit=${SEARCH_OTHERS}`).catch(() => ({ collection: [] })),
  ]);
  return {
    best: null,
    tracks: toTracks(tracks.collection),
    artists: users.collection.map(toArtist),
    albums: albums.collection.map(toAlbum),
  };
}

async function artist(artistId) {
  const key = encodeURIComponent(artistId);
  const [user, albums, related] = await Promise.all([
    getJson(`/users/${key}`),
    getJson(`/users/${key}/albums?limit=20`).catch(() => ({ collection: [] })),
    getJson(`/users/${key}/relatedartists?limit=12`).catch(() => ({ collection: [] })),
  ]);
  const followers = user.followers_count;
  return {
    ...toArtist(user),
    subtitle: followers ? `Подписчиков: ${followers.toLocaleString('ru-RU')}` : 'Исполнитель',
    albums: albums.collection.map(toAlbum),
    similar: related.collection.map(toArtist),
  };
}

// Популярное у артиста и его соседи: сырьё для волны.
async function artistNeighbours(artistId) {
  const key = encodeURIComponent(artistId);
  const [top, related] = await Promise.all([
    getJson(`/users/${key}/toptracks?limit=20`),
    getJson(`/users/${key}/relatedartists?limit=12`).catch(() => ({ collection: [] })),
  ]);
  return {
    popular: toTracks(top.collection),
    similarArtistIds: related.collection.map((user) => String(user.id)),
  };
}

async function similarTracks(trackId) {
  const { collection: tracks } = await getJson(`/tracks/${encodeURIComponent(trackId)}/related?limit=25`);
  return toTracks(tracks);
}

async function discover() {
  const { collection: items } = await getJson(TRENDING);
  return toTracks(items.map((item) => item.track));
}

/* Лайки */

// Лайки нужны сразу нескольким экранам: одновременные вызовы делят один запрос.
function likedTracks() {
  if (likes) return Promise.resolve(likes);
  likesRequest ??= me()
    .then((user) => allPages(`/users/${user.id}/track_likes?limit=200&linked_partitioning=1`, MAX_LIKES))
    .then((items) => {
      likes = toTracks(items.map((item) => item.track));
      return likes;
    })
    .finally(() => {
      likesRequest = null;
    });
  return likesRequest;
}

async function likedIds() {
  return (await likedTracks()).map((track) => track.id);
}

async function setLiked(trackId, liked) {
  const user = await me();
  await request(`/users/${user.id}/track_likes/${encodeURIComponent(trackId)}`, { method: liked ? 'PUT' : 'DELETE' });
  likes = null;
}

async function randomTracks(count, skip = new Set()) {
  const pool = (await likedTracks()).filter((track) => !skip.has(`${id}:${track.id}`));
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

/* Медиатека */

async function libraryItems() {
  const items = await allPages('/me/library/all?limit=200&linked_partitioning=1', MAX_LIKES).catch(() => []);
  return items.map(toLibraryItem).filter(Boolean);
}

async function library() {
  const [liked, items] = await Promise.all([likedTracks(), libraryItems()]);
  return [
    { provider: id, id: 'liked', title: 'Лайки SoundCloud', count: liked.length, cover: null },
    ...items,
  ];
}

// В плейлисте полные данные есть только у первых треков, остальные приходят одними номерами.
async function fillTracks(stubs) {
  const missing = stubs.filter((track) => !track.title).map((track) => track.id);
  const found = new Map();
  for (let start = 0; start < missing.length; start += TRACKS_PER_REQUEST) {
    const ids = missing.slice(start, start + TRACKS_PER_REQUEST).join(',');
    (await getJson(`/tracks?ids=${ids}`)).forEach((track) => found.set(track.id, track));
  }
  return toTracks(stubs.map((track) => found.get(track.id) ?? track));
}

async function loadCollection(collectionId) {
  const [kind, ...rest] = collectionId.split(':');
  const key = encodeURIComponent(rest.join(':'));

  if (collectionId === 'liked') return likedTracks();
  if (kind === 'artist') return toTracks((await getJson(`/users/${key}/toptracks?limit=${PAGE_SIZE}`)).collection);
  if (kind === 'system') return fillTracks((await getJson(`/system-playlists/${key}`)).tracks ?? []);
  return fillTracks((await getJson(`/playlists/${key}?representation=full`)).tracks ?? []);
}

async function collection(collectionId, offset) {
  if (offset === 0 || openCollection.id !== collectionId) {
    openCollection = { id: collectionId, tracks: await loadCollection(collectionId) };
  }
  const end = offset + PAGE_SIZE;
  return {
    tracks: openCollection.tracks.slice(offset, end),
    nextOffset: end < openCollection.tracks.length ? end : null,
  };
}

/* Звук */

// Ссылка живёт недолго, поэтому запрашивать её надо прямо перед воспроизведением.
async function streamUrl(trackId) {
  const track = await getJson(`/tracks/${encodeURIComponent(trackId)}`);
  const transcoding = pickTranscoding(track.media?.transcodings ?? []);
  if (!transcoding) throw new Error('У трека нет открытого потока');

  const address = new URL(transcoding.url);
  if (track.track_authorization) address.searchParams.set('track_authorization', track.track_authorization);
  const { url } = await getJson(address.href);
  return { url, preview: Boolean(transcoding.snipped), quality: qualityOf(transcoding) };
}

/* Вход */

// Сайт сам обращается к своему серверу с ключом и токеном: их и запоминаем.
function login(parent) {
  return new Promise((resolve) => {
    let connected = false;
    const win = new BrowserWindow({
      parent,
      width: 480,
      height: 760,
      title: 'Вход в SoundCloud',
      backgroundColor: '#000000',
      webPreferences: { partition: LOGIN_PARTITION, sandbox: true, contextIsolation: true },
    });
    win.webContents.setUserAgent(win.webContents.getUserAgent().replace(/ (Electron|Quad|quad)\/\S+/g, ''));

    const { webRequest } = win.webContents.session;
    webRequest.onBeforeSendHeaders({ urls: [`${API_URL}/*`] }, (details, done) => {
      done({ requestHeaders: details.requestHeaders });
      if (connected) return;

      const header = Object.entries(details.requestHeaders)
        .find(([key]) => key.toLowerCase() === 'authorization')?.[1];
      const clientId = new URL(details.url).searchParams.get('client_id');
      const token = /^OAuth (.+)$/.exec(header ?? '')?.[1];
      if (!token || !clientId) return;

      connected = true;
      tokens.write(id, JSON.stringify({ token, clientId })).finally(() => {
        if (!win.isDestroyed()) win.close();
      });
    });

    win.once('closed', () => {
      session.fromPartition(LOGIN_PARTITION).webRequest.onBeforeSendHeaders(null);
      resolve(connected);
    });
    win.loadURL(LOGIN_URL).catch(() => {});
  });
}

async function logout() {
  await tokens.remove(id);
  forget();
  await session.fromPartition(LOGIN_PARTITION).clearStorageData();
}

module.exports = {
  id,
  name,
  mediaHosts,
  isConnected,
  status,
  search,
  artist,
  artistNeighbours,
  similarTracks,
  discover,
  likedIds,
  setLiked,
  library,
  collection,
  randomTracks,
  streamUrl,
  login,
  logout,
};
