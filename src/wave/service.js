const { app } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const {
  MODES,
  artistKeys,
  buildProfile,
  historyOf,
  pickBatch,
  trackKey,
} = require('./algorithm');

const HISTORY_LIMIT = 3000;
const TASTE_LIFETIME = 20 * 60 * 1000;
const SEED_TRACKS = 5;
const SEED_ARTISTS = 2;
const NEIGHBOUR_ARTISTS = 3;
const FAMILIAR_TRACKS = 30;

const historyFile = () => path.join(app.getPath('userData'), 'wave-history.json');

let events = null;
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

async function recordEvent(track, type) {
  const list = await loadEvents();
  list.push({
    key: trackKey(track),
    artists: artistKeys(track),
    genre: track.genre,
    type,
    at: Date.now(),
  });
  events = list.slice(-HISTORY_LIMIT);
  await fs.writeFile(historyFile(), JSON.stringify(events));
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

async function candidatesFrom(provider, taste, profile) {
  const artists = sampleRecent(favouriteArtists(profile, provider).slice(0, 20), SEED_ARTISTS);
  const neighbours = await Promise.allSettled(artists.map((id) => provider.artistNeighbours(id)));
  const found = neighbours.filter((item) => item.status === 'fulfilled').map((item) => item.value);

  const neighbourIds = found.flatMap((item) => item.similarArtistIds);
  const requests = [
    ...sampleRecent(taste.tracks, SEED_TRACKS).map((track) => provider.similarTracks(track.id)),
    ...sampleRecent(neighbourIds, NEIGHBOUR_ARTISTS).map(async (id) => (
      (await provider.artistNeighbours(id)).popular
    )),
    provider.randomTracks(FAMILIAR_TRACKS),
  ];

  const results = await Promise.allSettled(requests);
  return [
    ...found.flatMap((item) => item.popular),
    ...results.filter((item) => item.status === 'fulfilled').flatMap((item) => item.value),
  ];
}

async function next(providers, { mode, count, exclude, previousArtist }) {
  const history = await loadEvents();
  const tasteList = await Promise.all(providers.map(tasteOf));

  const now = Date.now();
  const likedTracks = tasteList.flatMap((taste) => taste.tracks);
  const profile = buildProfile(likedTracks, history, now);

  const pools = await Promise.all(providers.map((provider, index) => (
    candidatesFrom(provider, tasteList[index], profile)
  )));

  return pickBatch(pools.flat(), profile, {
    mode: MODES[mode] ?? MODES.mix,
    likedKeys: new Set(tasteList.flatMap((taste) => taste.keys)),
    history: historyOf(history),
    exclude,
    previousArtist,
    now,
    random: Math.random,
  }, count);
}

function forgetTaste() {
  tastes.clear();
}

module.exports = { forgetTaste, next, recordEvent };
