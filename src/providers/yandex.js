const { BrowserWindow, session } = require('electron');
const crypto = require('node:crypto');
const { parseSyncedLyrics } = require('../lyrics');
const tokens = require('../token-store');

// Официального API нет: адреса, client_id и соль взяты из github.com/MarshalX/yandex-music-api.
const API_URL = 'https://api.music.yandex.net';
const AUTH_URL = 'https://oauth.yandex.ru/authorize?response_type=token&client_id=23cabbbdc6cd418abb4b39c32c41195d';
const DOWNLOAD_SALT = 'XGRlBW9FXlekgbPrRHuSiA';
const LYRICS_SIGN_KEY = 'p93jhgh689SBReK6ghtw62';
const LYRICS_CLIENT = 'YandexMusicAndroid/24023621';
const LOGIN_PARTITION = 'yandex-login';
const REQUEST_TIMEOUT = 10000;
const RATE_LIMIT_DELAYS = [600, 1800];
const COVER_SIZE = '200x200';
const MEDIUM_COVER_SIZE = '400x400';
const LARGE_COVER_SIZE = '1000x1000';
const PAGE_SIZE = 100;

const id = 'yandex';
const name = 'Яндекс Музыка';

let accountUid = null;
let likedTrackIds = null;
let likesRequest = null;
let openCollection = { id: null, trackIds: [] };

function assertYandexHost(url) {
  if (!new URL(url).hostname.endsWith('.yandex.net')) {
    throw new Error(`Неожиданный адрес: ${url}`);
  }
}

async function request(url, { headers, ...options } = {}) {
  assertYandexHost(url);

  const token = await tokens.read(id);
  const allHeaders = { 'Accept-Language': 'ru', ...headers };
  if (token) allHeaders.Authorization = `OAuth ${token}`;

  const send = () => fetch(url, {
    ...options,
    headers: allHeaders,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });

  // Яндекс отвечает 429, когда запросов слишком много подряд. Это временно, поэтому пробуем ещё.
  let response = await send();
  for (const delay of RATE_LIMIT_DELAYS) {
    if (response.status !== 429) break;
    await new Promise((resolve) => setTimeout(resolve, delay));
    response = await send();
  }

  if (response.status === 401 && token) await tokens.remove(id);
  if (!response.ok) throw new Error(`Яндекс ответил ${response.status}`);
  return response;
}

async function getResult(path) {
  const response = await request(`${API_URL}${path}`);
  return (await response.json()).result;
}

async function isConnected() {
  return (await tokens.read(id)) !== null;
}

async function status() {
  if (!(await isConnected())) return { connected: false };

  try {
    const result = await getResult('/account/status');
    accountUid = result.account.uid;
    return {
      connected: true,
      account: result.account.displayName || result.account.login,
      hasSubscription: Boolean(result.plus?.hasPlus),
    };
  } catch {
    // Токен удаляется только при 401. Если он на месте, это просто нет сети.
    return { connected: await isConnected() };
  }
}

function coverUrl(uri, size) {
  return uri ? `https://${uri.replace('%%', size)}` : null;
}

function lyricsKind(info) {
  if (info?.hasAvailableSyncLyrics) return 'sync';
  return info?.hasAvailableTextLyrics ? 'text' : null;
}

function toTrack(track) {
  const album = track.albums?.[0];
  const label = album?.labels?.[0];
  return {
    provider: id,
    providerName: name,
    id: String(track.id),
    title: track.version ? `${track.title} (${track.version})` : track.title,
    artists: track.artists.map((artist) => artist.name).join(', '),
    artistList: track.artists.map((artist) => ({ id: String(artist.id), name: artist.name })),
    durationMs: track.durationMs,
    cover: coverUrl(track.coverUri, COVER_SIZE),
    coverMedium: coverUrl(track.coverUri, MEDIUM_COVER_SIZE),
    coverLarge: coverUrl(track.coverUri, LARGE_COVER_SIZE),
    album: album?.title ?? null,
    albumId: album ? String(album.id) : null,
    year: album?.year ?? null,
    genre: album?.genre ?? null,
    label: typeof label === 'string' ? label : label?.name ?? null,
    lyrics: lyricsKind(track.lyricsInfo),
  };
}

function toTracks(tracks) {
  return tracks.filter((track) => track.available).map(toTrack);
}

function toArtist(artist) {
  return {
    kind: 'artist',
    provider: id,
    id: String(artist.id),
    collectionId: `artist:${artist.id}`,
    title: artist.name,
    subtitle: 'Исполнитель',
    cover: coverUrl(artist.cover?.uri ?? artist.ogImage, MEDIUM_COVER_SIZE),
  };
}

function toAlbum(album) {
  const artists = album.artists?.map((artist) => artist.name).join(', ');
  return {
    kind: 'album',
    provider: id,
    id: String(album.id),
    collectionId: `album:${album.id}`,
    title: album.title,
    subtitle: [artists, album.year].filter(Boolean).join(' · '),
    cover: coverUrl(album.coverUri, MEDIUM_COVER_SIZE),
  };
}

function toBest(best) {
  const convert = { track: toTrack, artist: toArtist, album: toAlbum }[best?.type];
  return convert && best.result ? { kind: best.type, item: convert(best.result) } : null;
}

async function search(text) {
  const query = new URLSearchParams({ text, type: 'all', page: '0', nocorrect: 'false' });
  const result = await getResult(`/search?${query}`);
  return {
    best: toBest(result.best),
    tracks: toTracks(result.tracks?.results ?? []),
    artists: (result.artists?.results ?? []).map(toArtist),
    albums: (result.albums?.results ?? []).map(toAlbum),
  };
}

async function artist(artistId) {
  const result = await getResult(`/artists/${encodeURIComponent(artistId)}/brief-info`);
  const listeners = result.stats?.lastMonthListeners;
  return {
    ...toArtist(result.artist),
    subtitle: listeners ? `Слушателей за месяц: ${listeners.toLocaleString('ru-RU')}` : 'Исполнитель',
    albums: (result.albums ?? []).map(toAlbum),
    similar: (result.similarArtists ?? []).map(toArtist),
  };
}

// Популярное у артиста и его соседи: сырьё для волны.
async function artistNeighbours(artistId) {
  const result = await getResult(`/artists/${encodeURIComponent(artistId)}/brief-info`);
  return {
    popular: toTracks(result.popularTracks ?? []),
    similarArtistIds: (result.similarArtists ?? []).map((item) => String(item.id)),
  };
}

async function similarTracks(trackId) {
  const result = await getResult(`/tracks/${encodeURIComponent(trackId)}/similar`);
  return toTracks(result.similarTracks ?? []);
}

/* Лайки */

async function likedIds() {
  likedTrackIds = await collectionTrackIds('liked');
  return likedTrackIds.map((trackId) => trackId.split(':')[0]);
}

async function setLiked(trackId, liked) {
  const user = await uid();
  await request(`${API_URL}/users/${user}/likes/tracks/${liked ? 'add-multiple' : 'remove'}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ 'track-ids': trackId }),
  });
  likedTrackIds = null;
}

/* Медиатека */

async function uid() {
  if (accountUid === null) accountUid = (await getResult('/account/status')).account.uid;
  return accountUid;
}

// На старте лайки нужны сразу нескольким экранам: одновременные вызовы делят один запрос.
function fetchLikes() {
  likesRequest ??= uid()
    .then((user) => getResult(`/users/${user}/likes/tracks`))
    .finally(() => {
      likesRequest = null;
    });
  return likesRequest;
}

async function library() {
  const user = await uid();
  const [likes, playlists] = await Promise.all([
    fetchLikes(),
    getResult(`/users/${user}/playlists/list`),
  ]);

  return [
    {
      provider: id,
      id: 'liked',
      title: 'Мне нравится',
      count: likes.library.tracks.length,
      cover: null,
    },
    ...playlists.map((playlist) => ({
      provider: id,
      id: String(playlist.kind),
      title: playlist.title,
      count: playlist.trackCount,
      cover: coverUrl(playlist.cover?.uri ?? playlist.ogImage, MEDIUM_COVER_SIZE),
    })),
  ];
}

async function collectionTrackIds(collectionId) {
  const [kind, entityId] = collectionId.split(':');
  if (kind === 'artist') {
    const { tracks } = await getResult(`/artists/${encodeURIComponent(entityId)}/tracks?page=0&page-size=${PAGE_SIZE}`);
    return tracks.map((track) => String(track.id));
  }
  if (kind === 'album') {
    const { volumes } = await getResult(`/albums/${encodeURIComponent(entityId)}/with-tracks`);
    return volumes.flat().map((track) => String(track.id));
  }

  if (collectionId === 'liked') {
    const { library: likes } = await fetchLikes();
    return likes.tracks.map((track) => `${track.id}:${track.albumId}`);
  }
  const user = await uid();
  const playlist = await getResult(`/users/${user}/playlists/${encodeURIComponent(collectionId)}`);
  return playlist.tracks.map((item) => String(item.id));
}

async function tracksById(trackIds) {
  const response = await request(`${API_URL}/tracks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ 'track-ids': trackIds.join(','), 'with-positions': 'false' }),
  });
  return toTracks((await response.json()).result);
}

async function randomTracks(count, skip = new Set()) {
  likedTrackIds ??= await collectionTrackIds('liked');

  const ids = likedTrackIds.filter((entry) => !skip.has(`${id}:${entry.split(':')[0]}`));
  const picked = Math.min(count, ids.length);
  for (let i = 0; i < picked; i += 1) {
    const j = i + Math.floor(Math.random() * (ids.length - i));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return picked > 0 ? tracksById(ids.slice(0, picked)) : [];
}

// Лайков могут быть тысячи, поэтому полные данные треков запрашиваются страницами.
async function collection(collectionId, offset) {
  if (offset === 0 || openCollection.id !== collectionId) {
    openCollection = { id: collectionId, trackIds: await collectionTrackIds(collectionId) };
  }

  const page = openCollection.trackIds.slice(offset, offset + PAGE_SIZE);
  const end = offset + page.length;
  return {
    tracks: page.length > 0 ? await tracksById(page) : [],
    nextOffset: end < openCollection.trackIds.length ? end : null,
  };
}

/* Тексты */

async function lyrics(trackId, kind) {
  const synced = kind === 'sync';
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = crypto.createHmac('sha256', LYRICS_SIGN_KEY).update(`${trackId}${timestamp}`).digest('base64');
  const query = new URLSearchParams({ format: synced ? 'LRC' : 'TEXT', timeStamp: String(timestamp), sign });

  const response = await request(`${API_URL}/tracks/${encodeURIComponent(trackId)}/lyrics?${query}`, {
    headers: { 'X-Yandex-Music-Client': LYRICS_CLIENT },
  });
  const { result } = await response.json();

  // Ссылка уже подписана: заголовок с токеном здесь не нужен и не должен уходить в хранилище.
  assertYandexHost(result.downloadUrl);
  const file = await fetch(result.downloadUrl, { signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
  if (!file.ok) throw new Error(`Текст недоступен: ${file.status}`);
  const text = await file.text();

  return {
    synced,
    lines: synced ? parseSyncedLyrics(text) : text.split('\n').map((line) => ({ text: line.trim() })),
    writers: result.writers ?? [],
  };
}

// Ссылка живёт около минуты, поэтому запрашивать её надо прямо перед воспроизведением.
async function streamUrl(trackId) {
  const result = await getResult(`/tracks/${encodeURIComponent(trackId)}/download-info`);

  const [best] = result
    .filter((option) => option.codec === 'mp3')
    .sort((a, b) => a.preview - b.preview || b.bitrateInKbps - a.bitrateInKbps);
  if (!best) throw new Error('Для трека нет mp3');

  const xml = await (await request(best.downloadInfoUrl)).text();
  const field = (tag) => new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml)?.[1];
  const host = field('host');
  const path = field('path');
  const ts = field('ts');
  const s = field('s');
  if (!host || !path || !ts || !s) throw new Error('Неожиданный ответ с данными загрузки');

  const sign = crypto.createHash('md5').update(DOWNLOAD_SALT + path.slice(1) + s).digest('hex');
  return {
    url: `https://${host}/get-mp3/${sign}/${ts}${path}`,
    preview: best.preview,
    quality: `${best.codec} ${best.bitrateInKbps} кбит/с`,
  };
}

// Токен приходит в адресе редиректа после подтверждения доступа.
function watchForToken(contents, onToken) {
  let found = false;
  const inspect = (event, url) => {
    const match = /[#&]access_token=([^&]+)/.exec(url ?? event.url);
    if (!match || found) return;
    found = true;
    event.preventDefault?.();
    onToken(decodeURIComponent(match[1]));
  };

  ['will-redirect', 'will-navigate', 'did-navigate', 'did-navigate-in-page']
    .forEach((eventName) => contents.on(eventName, inspect));
}

function login(parent) {
  return new Promise((resolve) => {
    let connected = false;
    const win = new BrowserWindow({
      parent,
      width: 460,
      height: 680,
      title: 'Вход в Яндекс',
      backgroundColor: '#000000',
      webPreferences: { partition: LOGIN_PARTITION, sandbox: true, contextIsolation: true },
    });

    win.webContents.setUserAgent(win.webContents.getUserAgent().replace(/ (Electron|Quad|quad)\/\S+/g, ''));
    watchForToken(win.webContents, async (token) => {
      try {
        await tokens.write(id, token);
        connected = true;
      } finally {
        win.close();
      }
    });
    win.once('closed', () => resolve(connected));
    win.loadURL(AUTH_URL).catch(() => {});
  });
}

async function logout() {
  await tokens.remove(id);
  accountUid = null;
  likedTrackIds = null;
  openCollection = { id: null, trackIds: [] };
  await session.fromPartition(LOGIN_PARTITION).clearStorageData();
}

module.exports = {
  id,
  name,
  isConnected,
  status,
  search,
  artist,
  artistNeighbours,
  similarTracks,
  likedIds,
  setLiked,
  library,
  collection,
  randomTracks,
  lyrics,
  streamUrl,
  watchForToken,
  login,
  logout,
};
