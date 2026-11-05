const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { test } = require('node:test');
const { buildTag, withoutExistingTag } = require('../src/id3');

function framesOf(tag) {
  const size = (tag[6] << 21) | (tag[7] << 14) | (tag[8] << 7) | tag[9];
  const frames = new Map();
  let offset = 10;
  while (offset < 10 + size) {
    const id = tag.toString('latin1', offset, offset + 4);
    const length = tag.readUInt32BE(offset + 4);
    const body = tag.subarray(offset + 10, offset + 10 + length);
    frames.set(id, [...(frames.get(id) ?? []), body]);
    offset += 10 + length;
  }
  return { size, frames };
}

const text = (body) => body.subarray(3).toString('utf16le');

const track = {
  id: '77',
  title: 'Тест',
  artists: 'Кто-то, Ещё',
  albumArtists: 'Кто-то',
  album: 'Альбом',
  albumTracks: 12,
  trackNumber: 3,
  discNumber: 2,
  year: 2024,
  releaseDate: '2024-03-09T00:00:00+03:00',
  genre: 'rusrap',
  label: 'Лейбл',
  durationMs: 180500,
  providerName: 'Яндекс Музыка',
  explicit: true,
  page: 'https://music.yandex.ru/album/1/track/77',
};

test('тег записывает все поля трека', () => {
  const { frames } = framesOf(buildTag({ track }));
  assert.equal(text(frames.get('TIT2')[0]), 'Тест');
  assert.equal(text(frames.get('TPE1')[0]), 'Кто-то, Ещё');
  assert.equal(text(frames.get('TPE2')[0]), 'Кто-то');
  assert.equal(text(frames.get('TALB')[0]), 'Альбом');
  assert.equal(text(frames.get('TRCK')[0]), '3/12');
  assert.equal(text(frames.get('TPOS')[0]), '2');
  assert.equal(text(frames.get('TYER')[0]), '2024');
  assert.equal(text(frames.get('TCON')[0]), 'rusrap');
  assert.equal(text(frames.get('TPUB')[0]), 'Лейбл');
  assert.equal(text(frames.get('TLEN')[0]), '180500');
  assert.equal(frames.get('WOAF')[0].toString('latin1'), track.page);
  assert.equal(frames.get('TXXX').length, 3);
});

test('пустые поля не попадают в тег', () => {
  const { frames } = framesOf(buildTag({ track: { id: '1', title: 'Только название' } }));
  assert.ok(frames.has('TIT2'));
  assert.ok(!frames.has('TALB'));
  assert.ok(!frames.has('TRCK'));
  assert.ok(!frames.has('APIC'));
  assert.ok(!frames.has('USLT'));
});

test('обложка лежит в теге без изменений', () => {
  const data = Buffer.from([0xff, 0xd8, 1, 2, 3, 0, 4]);
  const { frames } = framesOf(buildTag({ track, cover: { mime: 'image/jpeg', data } }));
  const [body] = frames.get('APIC');
  assert.ok(body.includes(Buffer.from('image/jpeg')));
  assert.ok(body.subarray(body.length - data.length).equals(data));
});

test('текст с таймингами пишется и обычным, и синхронным', () => {
  const lyrics = {
    synced: true,
    writers: ['Автор Один', 'Автор Два'],
    lines: [{ time: 1.5, text: 'Первая' }, { time: 62.25, text: 'Вторая' }],
  };
  const { frames } = framesOf(buildTag({ track, lyrics }));
  assert.ok(frames.get('USLT')[0].toString('utf16le').includes('Первая') || frames.get('USLT')[0].subarray(1).includes(Buffer.from('Первая', 'utf16le')));
  assert.equal(text(frames.get('TCOM')[0]), 'Автор Один, Автор Два');

  const [sync] = frames.get('SYLT');
  const time = Buffer.alloc(4);
  time.writeUInt32BE(62250);
  assert.ok(sync.includes(time));
});

test('текст без таймингов не создаёт синхронный блок', () => {
  const { frames } = framesOf(buildTag({ track, lyrics: { synced: false, writers: [], lines: [{ text: 'Строка' }] } }));
  assert.ok(frames.has('USLT'));
  assert.ok(!frames.has('SYLT'));
});

test('размер тега записан в формате без единиц в старших битах', () => {
  const tag = buildTag({ track, cover: { mime: 'image/jpeg', data: Buffer.alloc(300000, 7) } });
  [6, 7, 8, 9].forEach((index) => assert.ok(tag[index] < 128));
  assert.equal(framesOf(tag).size, tag.length - 10);
});

async function collect(chunks) {
  const parts = [];
  for await (const chunk of Readable.from(chunks).pipe(withoutExistingTag())) parts.push(chunk);
  return Buffer.concat(parts);
}

test('чужой тег в начале файла вырезается, даже если пришёл кусками', async () => {
  const old = buildTag({ track: { id: '1', title: 'Старый' } });
  const audio = Buffer.from([0xff, 0xfb, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const whole = Buffer.concat([old, audio]);
  const split = [whole.subarray(0, 4), whole.subarray(4, 20), whole.subarray(20)];
  assert.ok((await collect(split)).equals(audio));
});

test('файл без тега проходит как есть', async () => {
  const audio = Buffer.from([0xff, 0xfb, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.ok((await collect([audio.subarray(0, 3), audio.subarray(3)])).equals(audio));
  const tiny = Buffer.from([0xff, 0xfb, 1]);
  assert.ok((await collect([tiny])).equals(tiny));
});
