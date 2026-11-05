// Алгоритм волны Quad. Чистые функции без Electron и сети, поэтому их легко проверять.
//
// 1. Из лайков, истории и дизлайков строится профиль вкуса: вес каждого артиста и жанра.
//    Свежее весит больше старого, а слушанное в это же время суток больше остального.
// 2. Текущая сессия подстраивает волну на ходу: серия пропусков толкает к новому,
//    жанры из последних действий поднимаются или опускаются сразу.
// 3. Каждый трек-кандидат получает оценку: подходит ли вкусу, насколько он новый
//    (знакомое или открытие зависит от режима), давно ли звучал, пропускали ли его.
// 4. Партия собирается жадно: без одного артиста подряд, без потока из одного альбома и жанра.
//    Доли лайков, знакомого и совсем нового задаёт режим, а сервисы внутри доли идут по очереди.

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

// Столько от доли лайков уступает новому за каждый пропуск подряд.
const STREAK_SHARE = 0.1;
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

const ARTIST_SCORE = 1.2;
const GENRE_SCORE = 0.8;
const SEED_SCORE = 1.4;
const SEED_GENRE_SCORE = 0.4;

// shares: какая часть партии отдана лайкам, знакомому (твои артисты и уже слышанное) и совсем новому.
// Без явных долей режимы сливаются: новых кандидатов всегда больше, и они вытесняют лайки целиком.
const MODES = {
  familiar: { novelty: -0.7, jitter: 0.5, shares: { liked: 0.7, known: 0.2, fresh: 0.1 } },
  mix: { novelty: 0.25, jitter: 0.7, shares: { liked: 0.4, known: 0.3, fresh: 0.3 } },
  discover: { novelty: 1, jitter: 0.8, shares: { liked: 0, known: 0.2, fresh: 0.8 } },
};

const ERAS = {
  fresh: (year, currentYear) => year >= currentYear - 2,
  tens: (year) => year >= 2010 && year < 2020,
  older: (year) => year < 2010,
};

const ANY_KIND = 'any';

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

// Имена артистов: те, чьих треков больше, впереди.
function favouriteNames(tracks) {
  const counts = new Map();
  tracks.forEach((track) => track.artistList.forEach(({ name }) => addWeight(counts, name, 1)));
  return [...counts].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

// Поиск приносит и случайные совпадения: имя должно быть в авторе или названии.
function mentions(track, name) {
  return `${track.artists} ${track.title}`.toLowerCase().includes(name.toLowerCase());
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

function kindOf(track, profile, { history, likedKeys }) {
  const key = trackKey(track);
  if (likedKeys.has(key)) return 'liked';
  return history.lastPlayed.has(key) || strongestArtist(track, profile) > 0 ? 'known' : 'fresh';
}

// Серия пропусков значит, что знакомое сейчас не заходит: часть лайков уступает место новому.
function sharesOf({ shares }, streak) {
  const moved = shares.liked * STREAK_SHARE * streak;
  return { ...shares, liked: shares.liked - moved, fresh: shares.fresh + moved };
}

// Сначала тот вид, который сильнее всего отстал от своей доли на этом месте партии.
function kindsByNeed(shares, counts, position) {
  const lag = (kind) => shares[kind] * (position + 1) - counts[kind];
  return Object.keys(shares)
    .filter((kind) => shares[kind] > 0)
    .sort((a, b) => lag(b) - lag(a));
}

function pickBatch(candidates, profile, context, count) {
  const seen = new Set(context.exclude);
  const shares = sharesOf(context.mode, context.session?.streak ?? 0);
  const scored = [];

  candidates.forEach((track) => {
    const key = trackKey(track);
    if (seen.has(key)) return;
    seen.add(key);
    if (!matchesFilters(track, context.filters, context.now)) return;

    // Вид с нулевой долей запрещён: в режиме «Новое» лайк не появится, даже если больше ничего нет.
    const kind = kindOf(track, profile, context);
    if (shares[kind] === 0) return;

    const score = scoreTrack(track, profile, context);
    if (score === null) return;
    scored.push({ track, score, kind });
  });

  const batch = [];
  const kindCounts = { liked: 0, known: 0, fresh: 0 };
  const providerCounts = new Map();
  const artistCounts = new Map();
  const albumCounts = new Map();
  let previousArtist = context.previousArtist ?? null;
  let lastGenre = null;
  let genreRun = 0;

  const played = ({ track }) => providerCounts.get(track.provider) ?? 0;

  function valueOf({ track, score }) {
    const [mainArtist] = artistKeys(track);
    let value = score - ARTIST_REPEAT_PENALTY * (artistCounts.get(mainArtist) ?? 0);
    if (track.albumId) value -= ALBUM_REPEAT_PENALTY * (albumCounts.get(track.albumId) ?? 0);
    if (genreRun >= GENRE_RUN && track.genre === lastGenre && !context.filters?.genre) value -= GENRE_RUN_PENALTY;
    return value;
  }

  // Лучший трек этого вида. Сервисы идут по очереди: следующий тот, кто звучал реже.
  function bestOf(kind) {
    const fitting = scored.filter((item) => (
      (kind === ANY_KIND || item.kind === kind) && artistKeys(item.track)[0] !== previousArtist
    ));
    const turn = Math.min(...fitting.map(played));
    return fitting
      .filter((item) => played(item) === turn)
      .reduce((best, item) => (best && valueOf(best) >= valueOf(item) ? best : item), null);
  }

  while (batch.length < count) {
    // Волна от трека просит похожее на него, а не долю лайков: важнее всего близость к треку.
    const kinds = context.seed ? [ANY_KIND] : kindsByNeed(shares, kindCounts, batch.length);
    const pick = kinds.map(bestOf).find(Boolean);
    if (!pick) break;

    scored.splice(scored.indexOf(pick), 1);
    const { track, kind } = pick;
    const [mainArtist] = artistKeys(track);
    kindCounts[kind] += 1;
    addWeight(providerCounts, track.provider, 1);
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
  favouriteNames,
  historyOf,
  matchesFilters,
  mentions,
  pickBatch,
  scoreTrack,
  sessionOf,
  strongestArtist,
  trackKey,
};
