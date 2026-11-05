const { app } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const {
  MODES,
  artistKeys,
  buildProfile,
  dislikesOf,
  historyOf,
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

// Что сейчас заходит: столько треков из последних дослушанных становятся отправными точками.
const WARM_SEEDS = 3;
const WARM_WINDOW = 3 * 24 * 60 * 60 * 1000;
const TOP_GENRES = 8;

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

async function candidatesFrom(provider, taste, profile, history, { filters, now }) {
  const filtered = Boolean(filters?.genre || filters?.era);
  const inGenre = filters?.genre ? taste.tracks.filter((track) => track.genre === filters.genre) : [];
  const seedList = inGenre.length > 0 ? inGenre : taste.tracks;

  // Фильтр по жанру: артисты берутся из лайков этого жанра, иначе соседи уведут в другую сторону.
  const artistPool = inGenre.length > 0
    ? [...new Set(inGenre.flatMap((track) => track.artistList.map((artist) => artist.id)))]
    : favouriteArtists(profile, provider).slice(0, 20);

  const artists = sampleRecent(artistPool, SEED_ARTISTS);
  const neighbours = await Promise.allSettled(artists.map((id) => provider.artistNeighbours(id)));
  const found = neighbours.filter((item) => item.status === 'fulfilled').map((item) => item.value);

  const neighbourIds = found.flatMap((item) => item.similarArtistIds);
  const seeds = [
    ...(filtered ? [] : warmSeeds(history, provider, now)),
    ...sampleRecent(seedList, SEED_TRACKS),
  ];
  const requests = [
    ...seeds.map((seed) => similarTo(provider, seed)),
    ...sampleRecent(neighbourIds, NEIGHBOUR_ARTISTS).map(async (id) => (
      (await provider.artistNeighbours(id)).popular.map((track) => ({ ...track, why: 'Рядом с твоими артистами' }))
    )),
    provider.randomTracks(FAMILIAR_TRACKS * (filtered ? FILTERED_POOL_FACTOR : 1)),
  ];

  return [
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
  if (track.why) return track.why;
  if (likedKeys.has(trackKey(track))) return 'Из твоих лайков';
  return strongestArtist(track, profile) > 0 ? 'Твой артист' : 'Новое для тебя';
}

async function prepare(providers) {
  const [history, disliked, tasteList] = await Promise.all([
    loadEvents(),
    loadDislikes(),
    Promise.all(providers.map(tasteOf)),
  ]);
  const now = Date.now();
  const likedTracks = tasteList.flatMap((taste) => taste.tracks);
  return {
    history,
    disliked,
    tasteList,
    now,
    likedKeys: new Set(tasteList.flatMap((taste) => taste.keys)),
    profile: buildProfile(likedTracks, history, now, disliked),
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

async function next(providers, { mode, count, exclude, previousArtist, filters, seed }) {
  const state = await prepare(providers);
  const { history, profile, tasteList, now, likedKeys } = state;

  const seedProvider = seed ? providers.find((provider) => provider.id === seed.provider) : null;
  const pools = seedProvider
    ? [await candidatesFromSeed(seedProvider, seed)]
    : await Promise.all(providers.map((provider, index) => (
      candidatesFrom(provider, tasteList[index], profile, history, { filters, now })
    )));

  const batch = pickBatch(pools.flat(), profile, contextOf(state, mode, {
    exclude,
    previousArtist,
    filters: seedProvider ? null : filters,
    seed,
  }), count);
  return batch.map((track) => ({ ...track, why: explain(track, profile, likedKeys) }));
}

// После лайка волна сразу подкладывает похожие, не дожидаясь следующей партии.
async function similar(providers, track, count, exclude) {
  const provider = providers.find((item) => item.id === track.provider);
  if (!provider) return [];

  const state = await prepare(providers);
  const pool = await similarTo(provider, track);
  return pickBatch(pool, state.profile, contextOf(state, 'mix', { exclude }), count);
}

// Жанры, которые реально слушают: из них собирается фильтр на экране волны.
async function topGenres(providers) {
  const { profile } = await prepare(providers);
  return [...profile.genres]
    .filter(([, weight]) => weight > 0)
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
