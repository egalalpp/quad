const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  MODES,
  buildProfile,
  historyOf,
  pickBatch,
  scoreTrack,
} = require('../src/wave/algorithm');

const NOW = Date.UTC(2026, 10, 4);
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

function track(id, artistId, genre = 'rap') {
  return { provider: 'y', id: String(id), artistList: [{ id: String(artistId) }], genre };
}

function event(trackItem, type, ageMs = 0) {
  return {
    key: `y:${trackItem.id}`,
    artists: [`y:${trackItem.artistList[0].id}`],
    genre: trackItem.genre,
    type,
    at: NOW - ageMs,
  };
}

function context(overrides = {}) {
  return {
    mode: MODES.mix,
    likedKeys: new Set(),
    history: historyOf([]),
    exclude: [],
    now: NOW,
    random: () => 0.5,
    ...overrides,
  };
}

test('свежие лайки весят больше старых', () => {
  const liked = [track(1, 'new'), ...Array.from({ length: 200 }, (_, i) => track(i + 2, `filler${i}`)), track(999, 'old')];
  const { artists } = buildProfile(liked, [], NOW);
  assert.ok(artists.get('y:new') > artists.get('y:old'));
});

test('пропуски опускают артиста, дослушивания поднимают', () => {
  const skipped = track(1, 'a');
  const finished = track(2, 'b');
  const events = [event(skipped, 'skip'), event(skipped, 'skip'), event(finished, 'finish')];
  const { artists } = buildProfile([], events, NOW);
  assert.ok(artists.get('y:a') < 0);
  assert.ok(artists.get('y:b') > 0);
});

test('старые события затухают', () => {
  const item = track(1, 'a');
  const other = track(2, 'b');
  const { artists } = buildProfile([], [event(item, 'finish', 60 * DAY), event(other, 'finish')], NOW);
  assert.ok(artists.get('y:a') < artists.get('y:b') / 5);
});

test('трек, звучавший меньше 6 часов назад, не ставится', () => {
  const item = track(1, 'a');
  const history = historyOf([event(item, 'finish', 2 * HOUR)]);
  const profile = buildProfile([], [], NOW);
  assert.equal(scoreTrack(item, profile, context({ history })), null);
});

test('недавно звучавший трек получает штраф, но не запрет', () => {
  const item = track(1, 'a');
  const profile = buildProfile([], [], NOW);
  const fresh = scoreTrack(item, profile, context());
  const recent = scoreTrack(item, profile, context({ history: historyOf([event(item, 'finish', 12 * HOUR)]) }));
  assert.ok(recent < fresh);
});

test('режим открытий выбирает новое, режим знакомого выбирает лайки', () => {
  const liked = track(1, 'a');
  const unknown = track(2, 'b');
  const likedKeys = new Set(['y:1']);
  const profile = buildProfile([], [], NOW);

  const [discover] = pickBatch([liked, unknown], profile, context({ mode: MODES.discover, likedKeys }), 1);
  const [familiar] = pickBatch([liked, unknown], profile, context({ mode: MODES.familiar, likedKeys }), 1);
  assert.equal(discover.id, '2');
  assert.equal(familiar.id, '1');
});

test('один артист не идёт два раза подряд', () => {
  const candidates = [track(1, 'a'), track(2, 'a'), track(3, 'a'), track(4, 'b'), track(5, 'c')];
  const profile = buildProfile([track(9, 'a')], [], NOW);
  const batch = pickBatch(candidates, profile, context(), 5);
  batch.slice(1).forEach((item, index) => {
    assert.notEqual(item.artistList[0].id, batch[index].artistList[0].id);
  });
});

test('партия не повторяет треки и уважает исключения', () => {
  const item = track(1, 'a');
  const batch = pickBatch([item, item, track(2, 'b'), track(3, 'c')], buildProfile([], [], NOW), context({ exclude: ['y:3'] }), 5);
  assert.deepEqual(batch.map((entry) => entry.id).sort(), ['1', '2']);
});

test('любимый артист обгоняет нелюбимого', () => {
  const loved = track(1, 'love');
  const hated = track(2, 'hate');
  const profile = buildProfile([], [event(loved, 'like'), event(hated, 'skip'), event(hated, 'skip')], NOW);
  const [first] = pickBatch([hated, loved], profile, context(), 1);
  assert.equal(first.id, '1');
});
