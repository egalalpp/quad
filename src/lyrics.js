// Запасной источник текстов: открытая база LRCLIB. Нужен, когда у сервиса текста нет.
const API_URL = 'https://lrclib.net/api/search';
const HEADERS = { 'User-Agent': 'Quad music player' };
const REQUEST_TIMEOUT = 8000;

// Таймкоды годятся только для той же записи: у Sped Up и ремиксов они другие.
const SAME_LENGTH_SECONDS = 3;

const found = new Map();

function normalise(text) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function withoutVersion(title) {
  return title.replace(/\s*[([].*?[)\]]\s*/g, ' ').trim();
}

function parseSyncedLyrics(text) {
  return text.split('\n').flatMap((line) => {
    const match = /^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/.exec(line.trim());
    if (!match || !match[3]) return [];
    return [{ time: Number(match[1]) * 60 + Number(match[2]), text: match[3] }];
  });
}

function plainLines(text) {
  return text.split('\n').map((line) => ({ text: line.trim() }));
}

function toLyrics(item, useTimings) {
  if (useTimings) {
    return { synced: true, lines: parseSyncedLyrics(item.syncedLyrics), writers: [], source: 'LRCLIB' };
  }
  const text = item.plainLyrics
    ?? item.syncedLyrics.replace(/^\[[^\]]*\]\s*/gm, '');
  return { synced: false, lines: plainLines(text), writers: [], source: 'LRCLIB' };
}

function pickLyrics(results, track) {
  const artists = track.artistList.map((artist) => normalise(artist.name));
  const title = normalise(track.title);
  const original = normalise(withoutVersion(track.title));
  const seconds = track.durationMs / 1000;

  const sameArtist = results.filter((item) => (
    (item.plainLyrics || item.syncedLyrics)
    && artists.some((artist) => normalise(item.artistName).includes(artist))
  ));
  const sameLength = (item) => Math.abs(item.duration - seconds) <= SAME_LENGTH_SECONDS;

  const exact = sameArtist.filter((item) => normalise(item.trackName) === title);
  const timed = exact.find((item) => item.syncedLyrics && sameLength(item));
  if (timed) return toLyrics(timed, true);
  if (exact[0]) return toLyrics(exact[0], false);

  const sameSong = sameArtist.find((item) => normalise(item.trackName) === original);
  return sameSong ? toLyrics(sameSong, false) : null;
}

async function search(query) {
  const response = await fetch(`${API_URL}?${new URLSearchParams({ q: query })}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });
  if (!response.ok) throw new Error(`LRCLIB ответил ${response.status}`);
  return response.json();
}

// Ошибка сети или лимит запросов не запоминаются: это не значит, что текста нет.
async function find(track) {
  const key = `${track.provider}:${track.id}`;
  if (found.has(key)) return found.get(key);

  const artist = track.artistList[0]?.name ?? '';
  let lyrics = pickLyrics(await search(`${artist} ${track.title}`), track);

  const original = withoutVersion(track.title);
  if (!lyrics && original !== track.title) {
    lyrics = pickLyrics(await search(`${artist} ${original}`), track);
  }

  found.set(key, lyrics);
  return lyrics;
}

module.exports = { find, parseSyncedLyrics, pickLyrics };
