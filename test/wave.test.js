const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  MODES,
  buildProfile,
  dislikesOf,
  favouriteNames,
  historyOf,
  mentions,
  pickBatch,
  scoreTrack,
  sessionOf,
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

test('дизлайк навсегда убирает трек из волны', () => {
  const item = track(1, 'a');
  const dislikes = dislikesOf([{ key: 'y:1', artists: ['y:a'], at: NOW - 400 * DAY }]);
  const profile = buildProfile([], [], NOW);
  assert.equal(scoreTrack(item, profile, context({ dislikes })), null);
});

test('дизлайк опускает артиста, а после трёх он не ставится совсем', () => {
  const list = [1, 2].map((id) => ({ key: `y:${id}`, artists: ['y:a'], genre: 'rap', at: NOW }));
  const profile = buildProfile([], [], NOW, list);
  assert.ok(profile.artists.get('y:a') < 0);
  assert.ok(profile.genres.get('rap') < 0);

  const other = track(9, 'a');
  const empty = buildProfile([], [], NOW);
  const two = scoreTrack(other, empty, context({ dislikes: dislikesOf(list) }));
  assert.ok(two < scoreTrack(other, empty, context()));

  const three = dislikesOf([...list, { key: 'y:3', artists: ['y:a'], at: NOW }]);
  assert.equal(scoreTrack(other, empty, context({ dislikes: three })), null);
});

test('пропуск на первых секундах весит больше позднего', () => {
  const early = track(1, 'a');
  const late = track(2, 'b');
  const { artists } = buildProfile([], [
    { ...event(early, 'skip'), heard: 0.02 },
    { ...event(late, 'skip'), heard: 0.38 },
  ], NOW);
  assert.ok(artists.get('y:a') < artists.get('y:b'));
});

test('слушанное в это же время суток весит больше', () => {
  const same = track(1, 'a');
  const opposite = track(2, 'b');
  const { artists } = buildProfile([], [event(same, 'finish', DAY), event(opposite, 'finish', DAY + 12 * HOUR)], NOW);
  assert.ok(artists.get('y:a') > artists.get('y:b') * 1.2);
});

test('серия пропусков толкает волну к новому', () => {
  const liked = track(1, 'a');
  const unknown = track(2, 'b');
  const likedKeys = new Set(['y:1']);
  const profile = buildProfile([], [], NOW);
  const skips = [track(5, 'x'), track(6, 'y'), track(7, 'z')].map((item) => event(item, 'skip', 60000));

  const calm = sessionOf([], NOW);
  const tired = sessionOf(skips, NOW);
  assert.equal(tired.streak, 3);

  const gap = (session) => scoreTrack(unknown, profile, context({ mode: MODES.familiar, likedKeys, session }))
    - scoreTrack(liked, profile, context({ mode: MODES.familiar, likedKeys, session }));
  assert.ok(gap(tired) > gap(calm));
});

test('жанр из пропущенных сейчас опускается, из дослушанных поднимается', () => {
  const session = sessionOf([event(track(1, 'a', 'rock'), 'skip', 60000), event(track(2, 'b', 'pop'), 'finish', 30000)], NOW);
  const profile = buildProfile([], [], NOW);
  const rock = scoreTrack(track(3, 'c', 'rock'), profile, context({ session }));
  const pop = scoreTrack(track(4, 'd', 'pop'), profile, context({ session }));
  assert.ok(pop > rock);
});

test('фильтр по жанру и эпохе оставляет только подходящее', () => {
  const profile = buildProfile([], [], NOW);
  const items = [
    { ...track(1, 'a', 'rap'), year: 2026 },
    { ...track(2, 'b', 'rock'), year: 2026 },
    { ...track(3, 'c', 'rap'), year: 2015 },
    { ...track(4, 'd', 'rap'), year: null },
  ];
  const ids = (filters) => pickBatch(items, profile, context({ filters }), 5).map((item) => item.id).sort();
  assert.deepEqual(ids({ genre: 'rap' }), ['1', '3', '4']);
  assert.deepEqual(ids({ era: 'fresh' }), ['1', '2']);
  assert.deepEqual(ids({ genre: 'rap', era: 'tens' }), ['3']);
});

test('волна по треку ставит найденное от него выше остального', () => {
  const profile = buildProfile([track(9, 'love')], [], NOW);
  const favourite = track(1, 'love');
  const similar = { ...track(2, 'other', 'pop'), fromSeed: true };
  const [first] = pickBatch([favourite, similar], profile, context({ seed: { genre: 'pop' } }), 1);
  assert.equal(first.id, '2');
});

test('не даёт подряд треки одного альбома и один жанр потоком', () => {
  const profile = buildProfile([], [], NOW);
  const album = [1, 2, 3].map((id) => ({ ...track(id, `a${id}`), albumId: 'same' }));
  const others = [4, 5].map((id) => ({ ...track(id, `b${id}`), albumId: `x${id}` }));
  const batch = pickBatch([...album, ...others], profile, context({ mode: MODES.familiar }), 3);
  assert.ok(batch.filter((item) => item.albumId === 'same').length < 3);

  const rap = [1, 2, 3, 4].map((id) => track(id, `r${id}`, 'rap'));
  const rock = [5, 6].map((id) => track(id, `k${id}`, 'rock'));
  const run = pickBatch([...rap, ...rock], profile, context({ mode: MODES.familiar }), 4).map((item) => item.genre);
  assert.ok(run.includes('rock'));
});

// Лайки, треки знакомых артистов и совсем новое, у каждого трека свой артист.
function pool(size = 20) {
  const ids = Array.from({ length: size }, (_, i) => i);
  const liked = ids.map((i) => track(100 + i, `liked${i}`));
  const known = ids.map((i) => track(200 + i, `liked${i}`));
  const fresh = ids.map((i) => track(300 + i, `fresh${i}`));
  return {
    liked,
    known,
    fresh,
    likedKeys: new Set(liked.map((item) => `y:${item.id}`)),
    profile: buildProfile(liked, [], NOW),
  };
}

function shareOf(batch) {
  const count = (from, to) => batch.filter((item) => Number(item.id) >= from && Number(item.id) < to).length;
  return [count(100, 200), count(200, 300), count(300, 400)];
}

test('каждый режим держит свою долю лайков, знакомого и нового', () => {
  const { liked, known, fresh, likedKeys, profile } = pool();
  const batchOf = (mode) => pickBatch([...fresh, ...known, ...liked], profile, context({ mode, likedKeys }), 10);
  assert.deepEqual(shareOf(batchOf(MODES.familiar)), [7, 2, 1]);
  assert.deepEqual(shareOf(batchOf(MODES.mix)), [4, 3, 3]);
  assert.deepEqual(shareOf(batchOf(MODES.discover)), [0, 2, 8]);
});

test('микс не сливается с новым, даже если новых кандидатов намного больше', () => {
  const { liked, fresh, likedKeys, profile } = pool(60);
  const batch = pickBatch([...fresh, ...liked.slice(0, 6)], profile, context({ likedKeys }), 10);
  assert.ok(shareOf(batch)[0] >= 4);
});

test('режим Новое не ставит лайки, даже если больше ставить нечего', () => {
  const { liked, likedKeys, profile } = pool();
  assert.deepEqual(pickBatch(liked, profile, context({ mode: MODES.discover, likedKeys }), 5), []);
});

test('новое с эпохой не откатывается на лайки', () => {
  const { likedKeys, profile } = pool();
  const oldLiked = { ...track(100, 'liked0'), year: 1999 };
  const oldFresh = { ...track(300, 'fresh0'), year: 1998 };
  const batch = pickBatch([oldLiked, oldFresh], profile, context({
    mode: MODES.discover,
    likedKeys,
    filters: { era: 'older' },
  }), 5);
  assert.deepEqual(batch.map((item) => item.id), ['300']);
});

test('когда вид кончился, места занимают другие', () => {
  const { known, fresh, likedKeys, profile } = pool();
  const batch = pickBatch([...known, ...fresh], profile, context({ mode: MODES.familiar, likedKeys }), 10);
  assert.equal(batch.length, 10);
  assert.equal(shareOf(batch)[0], 0);
});

test('уже слышанный трек не считается новым', () => {
  const { likedKeys, profile } = pool();
  const heard = track(300, 'fresh0');
  const history = historyOf([event(heard, 'finish', 40 * DAY)]);
  const batch = pickBatch([heard, track(301, 'fresh1')], profile, context({ mode: MODES.discover, likedKeys, history }), 1);
  assert.equal(batch[0].id, '301');
});

test('серия пропусков отдаёт часть лайков новому', () => {
  const { liked, known, fresh, likedKeys, profile } = pool();
  const session = { streak: 3, genres: new Map() };
  const batch = pickBatch([...fresh, ...known, ...liked], profile, context({ likedKeys, session }), 10);
  const [likedCount, , freshCount] = shareOf(batch);
  assert.ok(likedCount < 4, String(likedCount));
  assert.ok(freshCount > 3, String(freshCount));
});

test('внутри одного вида сервисы идут по очереди', () => {
  const { likedKeys, profile } = pool();
  const service = (provider, from) => Array.from({ length: 6 }, (_, i) => ({ ...track(from + i, `${provider}${i}`), provider }));
  const batch = pickBatch([...service('y', 300), ...service('s', 310)], profile, context({ mode: MODES.discover, likedKeys }), 6);
  assert.deepEqual(batch.map((item) => item.provider).sort().join(''), 'sssyyy');
});

test('один сервис без лайков не размывает режим Любимое', () => {
  const { liked, likedKeys, profile } = pool();
  const other = Array.from({ length: 20 }, (_, i) => ({ ...track(300 + i, `s${i}`), provider: 's' }));
  const batch = pickBatch([...other, ...liked], profile, context({ mode: MODES.familiar, likedKeys }), 10);
  assert.equal(batch.filter((item) => item.provider === 'y').length >= 7, true);
});

test('чаще встречающийся артист идёт первым', () => {
  const liked = (...names) => ({ artistList: names.map((name) => ({ id: name, name })) });
  assert.deepEqual(favouriteNames([liked('A'), liked('B', 'C'), liked('B')]), ['B', 'A', 'C']);
  assert.deepEqual(favouriteNames([]), []);
});

test('найденный трек должен упоминать артиста', () => {
  const found = { artists: 'trashpixels', title: 'Burial-Archangel' };
  assert.equal(mentions(found, 'burial'), true);
  assert.equal(mentions(found, 'Trashpixels'), true);
  assert.equal(mentions(found, 'Radiohead'), false);
});
