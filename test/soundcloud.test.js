const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  coverUrl,
  pickTranscoding,
  toLibraryItem,
  toTrack,
  toTracks,
} = require('../src/providers/soundcloud-map');

const raw = {
  id: 42,
  title: 'Трек',
  duration: 30000,
  full_duration: 180000,
  artwork_url: 'https://i1.sndcdn.com/artworks-abc-large.jpg',
  genre: 'Hip-hop',
  release_date: '2021-05-02T00:00:00Z',
  permalink_url: 'https://soundcloud.com/a/b',
  user: { id: 7, username: 'Автор', avatar_url: 'https://i1.sndcdn.com/avatars-x-large.jpg' },
  publisher_metadata: { album_title: 'Альбом' },
};

const hls = (mime, extra = {}) => ({ url: 'u', quality: 'sq', format: { protocol: 'hls', mime_type: mime }, ...extra });

test('трек приводится к общему формату', () => {
  const track = toTrack(raw);
  assert.equal(track.id, '42');
  assert.equal(track.artists, 'Автор');
  assert.deepEqual(track.artistList, [{ id: '7', name: 'Автор' }]);
  assert.equal(track.durationMs, 180000);
  assert.equal(track.coverLarge, 'https://i1.sndcdn.com/artworks-abc-t500x500.jpg');
  assert.equal(track.genre, 'hip-hop');
  assert.equal(track.year, 2021);
  assert.equal(track.album, 'Альбом');
  assert.equal(track.canDownload, false);
});

test('без своей обложки берётся аватар автора, без него ничего', () => {
  assert.equal(coverUrl({ ...raw, artwork_url: null }, 't200x200'), 'https://i1.sndcdn.com/avatars-x-t200x200.jpg');
  assert.equal(coverUrl({ artwork_url: null, user: {} }, 't200x200'), null);
});

test('заблокированные и пустые треки отбрасываются', () => {
  const list = toTracks([raw, { ...raw, id: 2, policy: 'BLOCK' }, { id: 3 }, null]);
  assert.deepEqual(list.map((track) => track.id), ['42']);
});

test('трек только с защищёнными потоками не попадает в списки', () => {
  const locked = { ...raw, id: 5, media: { transcodings: [{ url: 'a', format: { protocol: 'ctr-encrypted-hls' } }] } };
  const open = { ...raw, id: 6, media: { transcodings: [hls('audio/mpeg')] } };
  assert.deepEqual(toTracks([locked, open, raw]).map((track) => track.id), ['6', '42']);
});

test('зашифрованные потоки не выбираются', () => {
  const picked = pickTranscoding([
    { url: 'a', format: { protocol: 'ctr-encrypted-hls', mime_type: 'audio/mpeg' } },
    { url: 'b', format: { protocol: 'cbc-encrypted-hls', mime_type: 'audio/mp4' } },
    hls('audio/mp4; codecs="mp4a.40.2"', { url: 'c' }),
  ]);
  assert.equal(picked.url, 'c');
  assert.equal(pickTranscoding([{ url: 'a', format: { protocol: 'ctr-encrypted-hls' } }]), null);
});

test('полный поток лучше отрывка, отрывок лучше ничего', () => {
  const short = hls('audio/mpeg', { url: 's', snipped: true, quality: 'hq' });
  assert.equal(pickTranscoding([short, hls('audio/mpeg', { url: 'f' })]).url, 'f');
  assert.equal(pickTranscoding([short]).url, 's');
});

test('высокое качество и обычный файл выбираются первыми', () => {
  const file = { url: 'p', quality: 'sq', format: { protocol: 'progressive', mime_type: 'audio/mpeg' } };
  assert.equal(pickTranscoding([hls('audio/mpeg'), file]).url, 'p');
  assert.equal(pickTranscoding([file, hls('audio/mp4', { url: 'h', quality: 'hq' })]).url, 'h');
});

test('разделы медиатеки определяются по типу записи', () => {
  const playlist = { id: 5, title: 'П', track_count: 3, artwork_url: null, user: {} };
  assert.equal(toLibraryItem({ type: 'playlist', playlist }).group, 'playlists');
  assert.equal(toLibraryItem({ type: 'album-like', playlist }).group, 'albums');
  assert.equal(toLibraryItem({ type: 'playlist-like', playlist }).group, 'collections');
  assert.equal(toLibraryItem({ type: 'playlist-like', playlist: { ...playlist, is_album: true } }).group, 'albums');
  const system = toLibraryItem({ type: 'system-playlist-like', system_playlist: { urn: 'soundcloud:x:1', title: 'С' } });
  assert.equal(system.group, 'collections');
  assert.equal(system.collectionId, 'system:soundcloud:x:1');
  assert.equal(toLibraryItem({ type: 'unknown' }), null);
});
