// Алгоритм волны Quad. Чистые функции без Electron и сети, поэтому их легко проверять.
//
// 1. Из лайков и истории прослушиваний строится профиль вкуса: вес каждого артиста и жанра.
//    Свежие лайки и свежие действия весят больше старых.
// 2. Каждый трек-кандидат получает оценку: насколько подходит вкусу, насколько он новый
//    (знакомое или открытие зависит от режима), давно ли звучал, пропускали ли его.
// 3. Партия собирается жадно, но одного артиста подряд не ставит, а за повторы штрафует.

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const EVENT_HALF_LIFE = 14 * DAY;
const EVENT_WEIGHTS = { like: 3, finish: 1.2, skip: -1.6 };
const LIKE_WEIGHT = 1;
const LIKE_RANK_DECAY = 0.99;
const GENRE_SHARE = 0.4;

const BLOCK_REPLAY_HOURS = 6;
const SOFT_REPLAY_HOURS = 72;
const REPLAY_PENALTY = 0.6;
const SKIP_PENALTY = 0.7;
const ARTIST_REPEAT_PENALTY = 0.9;

const ARTIST_SCORE = 1.2;
const GENRE_SCORE = 0.8;

const MODES = {
  familiar: { novelty: -0.7, jitter: 0.5 },
  mix: { novelty: 0.25, jitter: 0.7 },
  discover: { novelty: 1, jitter: 0.8 },
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

function buildProfile(likedTracks, events, now) {
  const artists = new Map();
  const genres = new Map();

  likedTracks.forEach((track, rank) => {
    const weight = LIKE_WEIGHT * LIKE_RANK_DECAY ** rank;
    artistKeys(track).forEach((key) => addWeight(artists, key, weight));
    if (track.genre) addWeight(genres, track.genre, weight * GENRE_SHARE);
  });

  events.forEach((event) => {
    const age = Math.max(0, now - event.at);
    const weight = EVENT_WEIGHTS[event.type] * 0.5 ** (age / EVENT_HALF_LIFE);
    event.artists.forEach((key) => addWeight(artists, key, weight));
    if (event.genre) addWeight(genres, event.genre, weight * GENRE_SHARE);
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

// null значит, что трек сейчас ставить нельзя: он звучал совсем недавно.
function scoreTrack(track, profile, context) {
  const key = trackKey(track);
  const { mode, likedKeys, history, now, random } = context;

  const last = history.lastPlayed.get(key);
  const hours = last === undefined ? Infinity : (now - last) / HOUR;
  if (hours < BLOCK_REPLAY_HOURS) return null;

  const artistWeights = artistKeys(track).map((artistKey) => profile.artists.get(artistKey) ?? 0);
  const artist = artistWeights.reduce((best, value) => (
    Math.abs(value) > Math.abs(best) ? value : best
  ), 0);
  const genre = profile.genres.get(track.genre) ?? 0;

  let novelty = 1;
  if (likedKeys.has(key)) novelty = -1;
  else if (artist > 0) novelty = 0.2;

  const replay = hours < SOFT_REPLAY_HOURS ? REPLAY_PENALTY * (1 - hours / SOFT_REPLAY_HOURS) : 0;
  const skipped = (history.skips.get(key) ?? 0) * SKIP_PENALTY;
  const jitter = (random() - 0.5) * mode.jitter;

  return ARTIST_SCORE * artist + GENRE_SCORE * genre + mode.novelty * novelty - replay - skipped + jitter;
}

function pickBatch(candidates, profile, context, count) {
  const seen = new Set(context.exclude);
  const scored = [];

  candidates.forEach((track) => {
    const key = trackKey(track);
    if (seen.has(key)) return;
    seen.add(key);
    const score = scoreTrack(track, profile, context);
    if (score !== null) scored.push({ track, score });
  });

  const batch = [];
  const artistCounts = new Map();
  let previousArtist = context.previousArtist ?? null;

  while (batch.length < count && scored.length > 0) {
    let bestIndex = -1;
    let bestValue = -Infinity;

    scored.forEach(({ track, score }, index) => {
      const [mainArtist] = artistKeys(track);
      if (mainArtist === previousArtist) return;
      const value = score - ARTIST_REPEAT_PENALTY * (artistCounts.get(mainArtist) ?? 0);
      if (value > bestValue) {
        bestValue = value;
        bestIndex = index;
      }
    });

    if (bestIndex < 0) break;

    const [{ track }] = scored.splice(bestIndex, 1);
    const [mainArtist] = artistKeys(track);
    addWeight(artistCounts, mainArtist, 1);
    previousArtist = mainArtist;
    batch.push(track);
  }

  return batch;
}

module.exports = { MODES, artistKeys, buildProfile, historyOf, pickBatch, scoreTrack, trackKey };
