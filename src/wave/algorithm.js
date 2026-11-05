// Алгоритм волны Quad. Чистые функции без Electron и сети, поэтому их легко проверять.
//
// 1. Из лайков, истории и дизлайков строится профиль вкуса: вес каждого артиста и жанра.
//    Свежее весит больше старого, а слушанное в это же время суток больше остального.
// 2. Текущая сессия подстраивает волну на ходу: серия пропусков толкает к новому,
//    жанры из последних действий поднимаются или опускаются сразу.
// 3. Каждый трек-кандидат получает оценку: подходит ли вкусу, насколько он новый
//    (знакомое или открытие зависит от режима), давно ли звучал, пропускали ли его.
// 4. Партия собирается жадно: без одного артиста подряд, без потока из одного альбома
//    и жанра, а на отдельных местах приоритет у незнакомых артистов.

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const EVENT_HALF_LIFE = 14 * DAY;
const EVENT_WEIGHTS = { like: 3, finish: 1.2, skip: -1.6 };
const LIKE_WEIGHT = 1;
const LIKE_RANK_DECAY = 0.99;
const GENRE_SHARE = 0.4;

// Трек, выключенный на первых секундах, говорит о вкусе больше, чем выключенный под конец.
const SKIP_SHARE = 0.4;
const EARLY_SKIP_BONUS = 1;

const TIME_OF_DAY_BOOST = 0.5;
const TIME_OF_DAY_WINDOW = 3;

const DISLIKE_HALF_LIFE = 180 * DAY;
const DISLIKE_ARTIST_WEIGHT = 2.5;
const ARTIST_BLOCK_AT = 3;
const ARTIST_DISLIKE_PENALTY = 0.8;

const SESSION_WINDOW = 45 * 60 * 1000;
const MAX_SKIP_STREAK = 3;
const STREAK_NOVELTY = 0.3;
const STREAK_JITTER = 0.35;
const SESSION_WARM = 0.15;
const SESSION_COLD = 0.25;
const SESSION_LIMIT = 0.6;

const BLOCK_REPLAY_HOURS = 6;
const SOFT_REPLAY_HOURS = 72;
const REPLAY_PENALTY = 0.6;
const SKIP_PENALTY = 0.7;
const ARTIST_REPEAT_PENALTY = 0.9;
const ALBUM_REPEAT_PENALTY = 0.5;
const GENRE_RUN = 2;
const GENRE_RUN_PENALTY = 0.35;
const EXPLORE_BONUS = 1.5;

const ARTIST_SCORE = 1.2;
const GENRE_SCORE = 0.8;
const SEED_SCORE = 1.4;
const SEED_GENRE_SCORE = 0.4;

const MODES = {
  familiar: { novelty: -0.7, jitter: 0.5, exploreEvery: 0 },
  mix: { novelty: 0.25, jitter: 0.7, exploreEvery: 4 },
  discover: { novelty: 1, jitter: 0.8, exploreEvery: 2 },
};

const ERAS = {
  fresh: (year, currentYear) => year >= currentYear - 2,
  tens: (year) => year >= 2010 && year < 2020,
  older: (year) => year < 2010,
};

const trackKey = (track) => `${track.provider}:${track.id}`;

function artistKeys(track) {
  return track.artistList.map((artist) => `${track.provider}:${artist.id}`);
}

function addWeight(map, key, value) {
  map.set(key, (map.get(key) ?? 0) + value);
}

function normalise(map) {
  const largest = Math.max(1, ...[...map.values()].map(Math.abs));
  return new Map([...map].map(([key, value]) => [key, value / largest]));
}

function timeOfDayFactor(at, now) {
  const distance = Math.abs(new Date(at).getHours() - new Date(now).getHours());
  const hours = Math.min(distance, 24 - distance);
  return 1 + TIME_OF_DAY_BOOST * Math.max(0, 1 - hours / TIME_OF_DAY_WINDOW);
}

function eventWeight(event, now) {
  const age = Math.max(0, now - event.at);
  let weight = EVENT_WEIGHTS[event.type] * 0.5 ** (age / EVENT_HALF_LIFE);
  if (event.type === 'skip' && event.heard !== undefined) {
    weight *= 1 + EARLY_SKIP_BONUS * Math.max(0, 1 - event.heard / SKIP_SHARE);
  }
  return weight * timeOfDayFactor(event.at, now);
}

function buildProfile(likedTracks, events, now, dislikes = []) {
  const artists = new Map();
  const genres = new Map();

  likedTracks.forEach((track, rank) => {
    const weight = LIKE_WEIGHT * LIKE_RANK_DECAY ** rank;
    artistKeys(track).forEach((key) => addWeight(artists, key, weight));
    if (track.genre) addWeight(genres, track.genre, weight * GENRE_SHARE);
  });

  events.forEach((event) => {
    const weight = eventWeight(event, now);
    event.artists.forEach((key) => addWeight(artists, key, weight));
    if (event.genre) addWeight(genres, event.genre, weight * GENRE_SHARE);
  });

  dislikes.forEach((dislike) => {
    const age = Math.max(0, now - dislike.at);
    const weight = -DISLIKE_ARTIST_WEIGHT * 0.5 ** (age / DISLIKE_HALF_LIFE);
    dislike.artists.forEach((key) => addWeight(artists, key, weight));
    if (dislike.genre) addWeight(genres, dislike.genre, weight * GENRE_SHARE);
  });

  return { artists: normalise(artists), genres: normalise(genres) };
}

function historyOf(events) {
  const lastPlayed = new Map();
  const skips = new Map();
  events.forEach((event) => {
    lastPlayed.set(event.key, Math.max(lastPlayed.get(event.key) ?? 0, event.at));
    if (event.type === 'skip') addWeight(skips, event.key, 1);
  });
  return { lastPlayed, skips };
}

function dislikesOf(dislikes) {
  const tracks = new Set();
  const artists = new Map();
  dislikes.forEach((dislike) => {
    tracks.add(dislike.key);
    if (dislike.artists[0]) addWeight(artists, dislike.artists[0], 1);
  });
  return { tracks, artists };
}

// Что происходит прямо сейчас: сколько треков подряд выключили и какие жанры заходят.
function sessionOf(events, now) {
  const recent = events.filter((event) => now - event.at < SESSION_WINDOW);

  let streak = 0;
  for (let i = recent.length - 1; i >= 0 && recent[i].type === 'skip'; i -= 1) streak += 1;

  const genres = new Map();
  recent.forEach((event) => {
    if (!event.genre) return;
    if (event.type === 'skip') addWeight(genres, event.genre, -SESSION_COLD);
    else addWeight(genres, event.genre, event.type === 'like' ? SESSION_WARM * 2 : SESSION_WARM);
  });
  return { streak: Math.min(streak, MAX_SKIP_STREAK), genres };
}

function matchesFilters(track, filters, now) {
  if (filters?.genre && track.genre !== filters.genre) return false;
  if (!filters?.era) return true;
  return track.year !== null && track.year !== undefined
    && ERAS[filters.era](track.year, new Date(now).getFullYear());
}

function strongestArtist(track, profile) {
  return artistKeys(track)
    .map((key) => profile.artists.get(key) ?? 0)
    .reduce((best, value) => (Math.abs(value) > Math.abs(best) ? value : best), 0);
}

// null значит, что трек сейчас ставить нельзя: он звучал совсем недавно или его не хотят слышать.
function scoreTrack(track, profile, context) {
  const key = trackKey(track);
  const { mode, likedKeys, history, now, random, dislikes, session, seed } = context;

  if (dislikes?.tracks.has(key)) return null;
  const [mainArtist] = artistKeys(track);
  const artistDislikes = dislikes?.artists.get(mainArtist) ?? 0;
  if (artistDislikes >= ARTIST_BLOCK_AT) return null;

  const last = history.lastPlayed.get(key);
  const hours = last === undefined ? Infinity : (now - last) / HOUR;
  if (hours < BLOCK_REPLAY_HOURS) return null;

  const artist = strongestArtist(track, profile);
  const genre = profile.genres.get(track.genre) ?? 0;

  let novelty = 1;
  if (likedKeys.has(key)) novelty = -1;
  else if (artist > 0) novelty = 0.2;

  const streak = session?.streak ?? 0;
  const noveltyPull = mode.novelty + STREAK_NOVELTY * streak;
  const jitter = (random() - 0.5) * mode.jitter * (1 + STREAK_JITTER * streak);

  const mood = Math.max(-SESSION_LIMIT, Math.min(SESSION_LIMIT, session?.genres.get(track.genre) ?? 0));
  const replay = hours < SOFT_REPLAY_HOURS ? REPLAY_PENALTY * (1 - hours / SOFT_REPLAY_HOURS) : 0;
  const skipped = (history.skips.get(key) ?? 0) * SKIP_PENALTY;

  let seeded = 0;
  if (seed) {
    if (track.fromSeed) seeded += SEED_SCORE;
    if (track.genre && track.genre === seed.genre) seeded += SEED_GENRE_SCORE;
  }

  return ARTIST_SCORE * artist + GENRE_SCORE * genre + noveltyPull * novelty + mood + seeded
    - replay - skipped - ARTIST_DISLIKE_PENALTY * artistDislikes + jitter;
}

function pickBatch(candidates, profile, context, count) {
  const seen = new Set(context.exclude);
  const scored = [];

  candidates.forEach((track) => {
    const key = trackKey(track);
    if (seen.has(key)) return;
    seen.add(key);
    if (!matchesFilters(track, context.filters, context.now)) return;

    const score = scoreTrack(track, profile, context);
    if (score === null) return;
    const unknown = !context.likedKeys.has(key) && strongestArtist(track, profile) <= 0;
    scored.push({ track, score, unknown });
  });

  const batch = [];
  const artistCounts = new Map();
  const albumCounts = new Map();
  const { exploreEvery } = context.mode;
  let previousArtist = context.previousArtist ?? null;
  let lastGenre = null;
  let genreRun = 0;

  while (batch.length < count && scored.length > 0) {
    const exploring = exploreEvery > 0 && (batch.length + 1) % exploreEvery === 0;
    let bestIndex = -1;
    let bestValue = -Infinity;

    scored.forEach(({ track, score, unknown }, index) => {
      const [mainArtist] = artistKeys(track);
      if (mainArtist === previousArtist) return;

      let value = score - ARTIST_REPEAT_PENALTY * (artistCounts.get(mainArtist) ?? 0);
      if (track.albumId) value -= ALBUM_REPEAT_PENALTY * (albumCounts.get(track.albumId) ?? 0);
      if (genreRun >= GENRE_RUN && track.genre === lastGenre && !context.filters?.genre) value -= GENRE_RUN_PENALTY;
      if (exploring && unknown) value += EXPLORE_BONUS;

      if (value > bestValue) {
        bestValue = value;
        bestIndex = index;
      }
    });

    if (bestIndex < 0) break;

    const [{ track }] = scored.splice(bestIndex, 1);
    const [mainArtist] = artistKeys(track);
    addWeight(artistCounts, mainArtist, 1);
    if (track.albumId) addWeight(albumCounts, track.albumId, 1);
    genreRun = track.genre === lastGenre ? genreRun + 1 : 1;
    lastGenre = track.genre;
    previousArtist = mainArtist;
    batch.push(track);
  }

  return batch;
}

module.exports = {
  MODES,
  artistKeys,
  buildProfile,
  dislikesOf,
  historyOf,
  matchesFilters,
  pickBatch,
  scoreTrack,
  sessionOf,
  strongestArtist,
  trackKey,
};
