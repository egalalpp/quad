const assert = require('node:assert/strict');
const { test } = require('node:test');
const { parseSyncedLyrics, pickLyrics } = require('../src/lyrics');

const track = (title, seconds, ...artists) => ({
  title,
  durationMs: seconds * 1000,
  artistList: artists.map((name) => ({ name })),
});

const item = (artistName, trackName, duration, extra = {}) => ({
  artistName,
  trackName,
  duration,
  plainLyrics: 'строка',
  syncedLyrics: null,
  ...extra,
});

const synced = '[00:01.50] раз\n[00:03.00] два';

test('разбирает таймкоды и пропускает пустые строки', () => {
  assert.deepEqual(parseSyncedLyrics('[00:01.50] раз\n[00:02.00]\nмусор\n[01:00.00] два'), [
    { time: 1.5, text: 'раз' },
    { time: 60, text: 'два' },
  ]);
});

test('берёт синхронный текст той же длины', () => {
  const lyrics = pickLyrics([item('КИНО', 'Группа крови', 235, { syncedLyrics: synced })], track('Группа крови', 236, 'КИНО'));
  assert.equal(lyrics.synced, true);
  assert.equal(lyrics.lines.length, 2);
});

test('при другой длине таймкоды не используются', () => {
  const lyrics = pickLyrics([item('КИНО', 'Группа крови', 200, { syncedLyrics: synced })], track('Группа крови', 236, 'КИНО'));
  assert.equal(lyrics.synced, false);
});

test('Sped Up получает обычный текст оригинала без таймкодов', () => {
  const lyrics = pickLyrics([item('BJ Lips', 'Love Potions', 173, { syncedLyrics: synced })], track('Love Potions (Sped Up)', 140, 'BJ Lips'));
  assert.equal(lyrics.synced, false);
});

test('знаки препинания в названии не мешают', () => {
  const lyrics = pickLyrics([item('BJ Lips • Princess Paparazzi', 'Love Potions Sped Up', 158)], track('Love Potions (Sped Up)', 158, 'BJ Lips'));
  assert.notEqual(lyrics, null);
});

test('чужой артист с таким же названием не подходит', () => {
  assert.equal(pickLyrics([item('Другой', 'Rewind', 149)], track('Rewind', 149, 'fakemink')), null);
});

test('запись без текста пропускается', () => {
  const empty = item('fakemink', 'Rewind', 149, { plainLyrics: null });
  assert.equal(pickLyrics([empty], track('Rewind', 149, 'fakemink')), null);
});

test('совпадение по любому из артистов', () => {
  const lyrics = pickLyrics([item('Kai Angel & 9mice', 'LIPSTICK', 118, { syncedLyrics: synced })], track('LIPSTICK', 121, 'Kai Angel', '9mice'));
  assert.equal(lyrics.synced, true);
});
