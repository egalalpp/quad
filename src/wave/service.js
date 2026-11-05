const { app } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { scopeOf } = require('../providers');
const {
  MODES,
  artistKeys,
  buildProfile,
  dislikesOf,
  favouriteNames,
  historyOf,
  matchesFilters,
  mentions,
  pickBatch,
  sessionOf,
  strongestArtist,
  trackKey,
} = require('./algorithm');

const HISTORY_LIMIT = 3000;
const TASTE_LIFETIME = 20 * 60 * 1000;
const SEED_TRACKS = 5;
const SEED_ARTISTS = 2;
const NEIGHBOUR_ARTISTS = 3;
const FAMILIAR_TRACKS = 30;

// С фильтром большая часть кандидатов отсеется, поэтому их нужно больше.
const FILTERED_POOL_FACTOR = 5;
const FILTERED_SEEDS_FACTOR = 2;

// Что сейчас заходит: столько треков из последних дослушанных становятся отправными точками.
const WARM_SEEDS = 3;
const WARM_WINDOW = 3 * 24 * 60 * 60 * 1000;
const TOP_GENRES = 8;

// Пустой аккаунт: столько артистов с других сервисов ищутся здесь за одну партию.
const BORROWED_POOL = 30;
const BORROWED_ARTISTS = 3;
const BORROWED_TRACKS = 6;

const historyFile = () => path.join(app.getPath('userData'), 'wave-history.json');
const dislikesFile = () => path.join(app.getPath('userData'), 'wave-dislikes.json');

let events = null;
let dislikes = null;
const tastes = new Map();

async function loadEvents() {
  if (events) return events;
  try {
    events = JSON.parse(await fs.readFile(historyFile(), 'utf8'));
  } catch {
    events = [];
  }
  return events;
}

async function loadDislikes() {
  if (dislikes) return dislikes;
  try {
    dislikes = JSON.parse(await fs.readFile(dislikesFile(), 'utf8'));
  } catch {
    dislikes = [];
  }
  return dislikes;
}

async function recordEvent(track, type, heard) {
  const list = await loadEvents();
  list.push({
    key: trackKey(track),
    title: track.title,
    artists: artistKeys(track),
    genre: track.genre,
    type,
    heard,
    at: Date.now(),
  });
  events = list.slice(-HISTORY_LIMIT);
  await fs.writeFile(historyFile(), JSON.stringify(events));
}

/* Не нравится: живёт отдельно от истории, чтобы не вытесняться из неё со временем */

async function saveDislikes(list) {
  dislikes = list;
  await fs.writeFile(dislikesFile(), JSON.stringify(list));
}

async function dislike(track) {
  const list = await loadDislikes();
  const key = trackKey(track);
  if (list.some((item) => item.key === key)) return;
  await saveDislikes([...list, {
    key,
    title: track.title,
    label: track.artists,
    artists: artistKeys(track),
    genre: track.genre,
    at: Date.now(),
  }]);
}

async function undislike(key) {
  await saveDislikes((await loadDislikes()).filter((item) => item.key !== key));
}

async function dislikedKeys() {
  return (await loadDislikes()).map((item) => item.key);
}

async function tasteOf(provider) {
  const cached = tastes.get(provider.id);
  if (cached && Date.now() - cached.at < TASTE_LIFETIME) return cached;

  const [{ tracks }, ids] = await Promise.all([provider.collection('liked', 0), provider.likedIds()]);
  const taste = {
    at: Date.now(),
    tracks,
    keys: ids.map((id) => `${provider.id}:${id}`),
  };
  tastes.set(provider.id, taste);
  return taste;
}

// Сервис, который сейчас не отвечает, выпадает из волны и не мешает остальным.
async function tastesOf(providers) {
  const results = await Promise.allSettled(providers.map(tasteOf));
  return results.flatMap((result, index) => (
    result.status === 'fulfilled' ? [{ provider: providers[index], taste: result.value }] : []
  ));
}

// Чаще берёт начало списка: там самые свежие лайки.
function sampleRecent(list, count) {
  const picked = new Set();
  for (let attempt = 0; attempt < count * 4 && picked.size < Math.min(count, list.length); attempt += 1) {
    picked.add(list[Math.floor(Math.random() ** 2 * list.length)]);
  }
  return [...picked];
}

function favouriteArtists(profile, provider) {
  const prefix = `${provider.id}:`;
  return [...profile.artists]
    .filter(([key, weight]) => key.startsWith(prefix) && weight > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key.slice(prefix.length));
}

// Последние дослушанные и лайкнутые треки этого сервиса: от них волна идёт в первую очередь.
function warmSeeds(history, provider, now) {
  const prefix = `${provider.id}:`;
  const seeds = new Map();
  for (let i = history.length - 1; i >= 0 && seeds.size < WARM_SEEDS; i -= 1) {
    const event = history[i];
    if (now - event.at > WARM_WINDOW) break;
    if (event.key.startsWith(prefix) && event.type !== 'skip' && event.title) {
      seeds.set(event.key, { id: event.key.slice(prefix.length), title: event.title });
    }
  }
  return [...seeds.values()];
}

function similarTo(provider, seed, extra = {}) {
  return provider.similarTracks(seed.id).then((tracks) => tracks.map((track) => ({
    ...track,
    why: `Похоже на «${seed.title}»`,
    ...extra,
  })));
}

function settledTracks(results) {
  return results.filter((item) => item.status === 'fulfilled').flatMap((item) => item.value);
}

const artistIds = (tracks) => [...new Set(tracks.flatMap((track) => track.artistList.map((artist) => artist.id)))];

// Своих лайков нет, но вкус известен по другим сервисам: те же артисты ищутся здесь.
// Искать не по кому или никого не нашлось: отправной точкой становится то, что советует сам сервис.
async function startersFor(provider, others) {
  const liked = others.flatMap(({ taste }) => taste.tracks);
  const names = sampleRecent(favouriteNames(liked).slice(0, BORROWED_POOL), BORROWED_ARTISTS);
  const found = settledTracks(await Promise.allSettled(names.map(async (name) => (
    (await provider.search(name)).tracks
      .filter((track) => mentions(track, name))
      .slice(0, BORROWED_TRACKS)
      .map((track) => ({ ...track, why: `Потому что любишь ${name}` }))
  ))));
  if (found.length > 0 || !provider.discover) return found;

  const trending = await provider.discover().catch(() => []);
  return trending.map((track) => ({ ...track, why: `Сейчас в тренде на ${provider.name}` }));
}

async function candidatesFrom({ provider, taste }, { history, now, profile, tasteList }, filters) {
  const filtered = Boolean(filters?.genre || filters?.era);
  const widen = filtered ? FILTERED_SEEDS_FACTOR : 1;

  // Запрос уходит сразу: с фильтром эта выборка нужна ещё и как отправные точки.
  const familiar = provider.randomTracks(FAMILIAR_TRACKS * (filtered ? FILTERED_POOL_FACTOR : 1)).catch(() => []);

  const isEmpty = taste.tracks.length === 0;
  const starters = isEmpty
    ? await startersFor(provider, tasteList.filter((item) => item.provider !== provider))
    : [];
  const known = isEmpty ? starters : taste.tracks;

  // С фильтром отправные точки только подходящие, иначе соседи уведут в другую сторону.
  // Вкус хранит лишь свежую сотню лайков, поэтому смотрим ещё и случайную выборку из всех.
  const matching = filtered
    ? [...known, ...await familiar].filter((track) => matchesFilters(track, filters, now))
    : [];
  const seedList = matching.length > 0 ? matching : known;

  const favourites = favouriteArtists(profile, provider).slice(0, 20);
  const artistPool = matching.length === 0 && favourites.length > 0 ? favourites : artistIds(seedList);

  const artists = sampleRecent(artistPool, SEED_ARTISTS * widen);
  const neighbours = await Promise.allSettled(artists.map((id) => provider.artistNeighbours(id)));
  const found = neighbours.filter((item) => item.status === 'fulfilled').map((item) => item.value);

  const neighbourIds = found.flatMap((item) => item.similarArtistIds);
  const seeds = [
    ...(filtered ? [] : warmSeeds(history, provider, now)),
    ...sampleRecent(seedList, SEED_TRACKS * widen),
  ];
  const requests = [
    ...seeds.map((seed) => similarTo(provider, seed)),
    ...sampleRecent(neighbourIds, NEIGHBOUR_ARTISTS).map(async (id) => (
      (await provider.artistNeighbours(id)).popular.map((track) => ({ ...track, why: 'Рядом с твоими артистами' }))
    )),
    familiar,
  ];

  return [
    ...starters,
    ...found.flatMap((item) => item.popular),
    ...settledTracks(await Promise.allSettled(requests)),
  ];
}

// Волна от конкретного трека: похожие на него, его артист и соседи артиста.
async function candidatesFromSeed(provider, seed) {
  const artistId = seed.artistList[0]?.id;
  const neighbour = artistId ? await provider.artistNeighbours(artistId).catch(() => null) : null;
  const near = neighbour?.similarArtistIds.slice(0, NEIGHBOUR_ARTISTS) ?? [];
  const why = `Похоже на «${seed.title}»`;

  const results = await Promise.allSettled([
    similarTo(provider, seed, { fromSeed: true }),
    ...near.map(async (id) => (
      (await provider.artistNeighbours(id)).popular.map((track) => ({ ...track, why, fromSeed: true }))
    )),
  ]);
  return [
    ...(neighbour?.popular ?? []).map((track) => ({ ...track, why, fromSeed: true })),
    ...settledTracks(results),
  ];
}

function explain(track, profile, likedKeys) {
  if (likedKeys.has(trackKey(track))) return 'Из твоих лайков';
  if (track.why) return track.why;
  return strongestArtist(track, profile) > 0 ? 'Твой артист' : 'Новое для тебя';
}

// Профиль строится только по выбранным сервисам: жанры у них свои и друг к другу не подходят.
async function prepare(connected, chosen) {
  const [history, disliked, tasteList] = await Promise.all([
    loadEvents(),
    loadDislikes(),
    tastesOf(connected),
  ]);
  const sources = tasteList.filter(({ provider }) => chosen.includes(provider));
  if (chosen.length > 0 && sources.length === 0) throw new Error('Сервисы волны не ответили');

  const now = Date.now();
  const isChosen = ({ key }) => chosen.some((provider) => key.startsWith(`${provider.id}:`));
  const likedTracks = sources.flatMap(({ taste }) => taste.tracks);
  return {
    history,
    disliked,
    sources,
    tasteList,
    now,
    likedKeys: new Set(tasteList.flatMap(({ taste }) => taste.keys)),
    profile: buildProfile(likedTracks, history.filter(isChosen), now, disliked.filter(isChosen)),
  };
}

function contextOf({ history, disliked, likedKeys, now }, mode, options) {
  return {
    mode: MODES[mode] ?? MODES.mix,
    likedKeys,
    history: historyOf(history),
    dislikes: dislikesOf(disliked),
    session: sessionOf(history, now),
    now,
    random: Math.random,
    ...options,
  };
}

async function next(connected, { source, mode, count, exclude, previousArtist, filters, seed }) {
  // Волна от трека идёт по его сервису, что бы ни было выбрано на экране.
  const seedProvider = seed ? connected.find((provider) => provider.id === seed.provider) : null;
  const state = await prepare(connected, seedProvider ? [seedProvider] : scopeOf(connected, source));
  const { likedKeys, profile, sources } = state;

  const pools = seedProvider
    ? [await candidatesFromSeed(seedProvider, seed)]
    : await Promise.all(sources.map((item) => candidatesFrom(item, state, filters)));

  const context = contextOf(state, mode, {
    exclude,
    previousArtist,
    filters: seedProvider ? null : filters,
    seed,
  });

  const batch = pickBatch(pools.flat(), profile, context, count);
  return batch.map((track) => ({ ...track, why: explain(track, profile, likedKeys) }));
}

// После лайка волна сразу подкладывает похожие, не дожидаясь следующей партии.
async function similar(connected, track, count, exclude) {
  const provider = connected.find((item) => item.id === track.provider);
  if (!provider) return [];

  const state = await prepare(connected, [provider]);
  const pool = await similarTo(provider, track);
  return pickBatch(pool, state.profile, contextOf(state, 'mix', { exclude }), count);
}

// Жанры, которые реально слушают: из них собирается фильтр на экране волны.
// Отрицательный вес не повод прятать жанр: серия пропусков утягивает в минус и самые любимые.
async function topGenres(connected, source) {
  const { profile } = await prepare(connected, scopeOf(connected, source));
  return [...profile.genres]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_GENRES)
    .map(([genre]) => genre);
}

function forgetTaste() {
  tastes.clear();
}

module.exports = {
  dislike,
  dislikedKeys,
  dislikes: loadDislikes,
  forgetTaste,
  next,
  recordEvent,
  similar,
  topGenres,
  undislike,
};
