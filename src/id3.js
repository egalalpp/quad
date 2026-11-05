// Теги ID3v2.3 для скачанных mp3: эту версию понимают все плееры, в том числе встроенные.
// Чистые функции без Electron и сети, поэтому их легко проверять.
const { Transform } = require('node:stream');

const UTF16 = 1;
const BOM = Buffer.from([0xff, 0xfe]);
const TEXT_END = Buffer.alloc(2);
const LANGUAGE = 'XXX';
const COVER_FRONT = 3;
const TIME_IN_MS = 2;
const CONTENT_LYRICS = 1;
const TAG_HEADER_SIZE = 10;
const FOOTER_FLAG = 0x10;

const utf16 = (text) => Buffer.concat([BOM, Buffer.from(text, 'utf16le')]);
const latin1 = (text) => Buffer.from(text, 'latin1');

function frame(id, body) {
  const header = Buffer.alloc(TAG_HEADER_SIZE);
  header.write(id, 0, 'latin1');
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

function textFrame(id, value) {
  if (value === null || value === undefined || value === '') return null;
  return frame(id, Buffer.concat([Buffer.from([UTF16]), utf16(String(value))]));
}

function userTextFrame(description, value) {
  if (value === null || value === undefined || value === '') return null;
  return frame('TXXX', Buffer.concat([Buffer.from([UTF16]), utf16(description), TEXT_END, utf16(String(value))]));
}

function coverFrame(cover) {
  if (!cover) return null;
  return frame('APIC', Buffer.concat([
    Buffer.from([0]),
    latin1(cover.mime),
    Buffer.from([0, COVER_FRONT, 0]),
    cover.data,
  ]));
}

function lyricsFrame(lyrics) {
  if (!lyrics) return null;
  const text = lyrics.lines.map((line) => line.text).join('\n');
  return frame('USLT', Buffer.concat([Buffer.from([UTF16]), latin1(LANGUAGE), utf16(''), TEXT_END, utf16(text)]));
}

// Текст с таймингами: плееры, которые это умеют, подсвечивают строки под музыку.
function syncedLyricsFrame(lyrics) {
  if (!lyrics?.synced) return null;
  const lines = lyrics.lines.flatMap((line) => {
    const time = Buffer.alloc(4);
    time.writeUInt32BE(Math.round(line.time * 1000));
    return [utf16(line.text), TEXT_END, time];
  });
  return frame('SYLT', Buffer.concat([
    Buffer.from([UTF16]),
    latin1(LANGUAGE),
    Buffer.from([TIME_IN_MS, CONTENT_LYRICS]),
    utf16(''),
    TEXT_END,
    ...lines,
  ]));
}

function dayAndMonth(date) {
  const parsed = new Date(date ?? NaN);
  if (Number.isNaN(parsed.getTime())) return null;
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(parsed.getUTCDate())}${pad(parsed.getUTCMonth() + 1)}`;
}

function position(index, total) {
  if (!index) return null;
  return total ? `${index}/${total}` : String(index);
}

function synchsafe(size) {
  return Buffer.from([(size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]);
}

function buildTag({ track, lyrics = null, cover = null }) {
  const frames = [
    textFrame('TIT2', track.title),
    textFrame('TPE1', track.artists),
    textFrame('TPE2', track.albumArtists),
    textFrame('TALB', track.album),
    textFrame('TRCK', position(track.trackNumber, track.albumTracks)),
    textFrame('TPOS', position(track.discNumber)),
    textFrame('TYER', track.year),
    textFrame('TDAT', dayAndMonth(track.releaseDate)),
    textFrame('TORY', track.originalYear),
    textFrame('TCON', track.genre),
    textFrame('TPUB', track.label),
    textFrame('TCOM', lyrics?.writers?.join(', ')),
    textFrame('TLEN', track.durationMs),
    textFrame('TENC', 'Quad'),
    userTextFrame('SERVICE', track.providerName),
    userTextFrame('SERVICE_TRACK_ID', track.id),
    userTextFrame('LYRICS_SOURCE', lyrics?.source ?? (lyrics ? track.providerName : null)),
    userTextFrame('ITUNESADVISORY', track.explicit ? 1 : null),
    track.page ? frame('WOAF', latin1(track.page)) : null,
    lyricsFrame(lyrics),
    syncedLyricsFrame(lyrics),
    coverFrame(cover),
  ].filter(Boolean);

  const body = Buffer.concat(frames);
  return Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 3, 0, 0]), synchsafe(body.length), body]);
}

// Размер тега, с которого начинается файл, чтобы не оставлять в нём чужой тег рядом с нашим.
function existingTagSize(start) {
  if (start.length < TAG_HEADER_SIZE || start.toString('latin1', 0, 3) !== 'ID3') return 0;
  const size = (start[6] << 21) | (start[7] << 14) | (start[8] << 7) | start[9];
  return TAG_HEADER_SIZE + size + (start[5] & FOOTER_FLAG ? TAG_HEADER_SIZE : 0);
}

function withoutExistingTag() {
  let head = Buffer.alloc(0);
  let toSkip = null;

  return new Transform({
    transform(chunk, _encoding, done) {
      if (toSkip === null) {
        head = Buffer.concat([head, chunk]);
        if (head.length < TAG_HEADER_SIZE) {
          done();
          return;
        }
        toSkip = existingTagSize(head);
        chunk = head;
      }

      const skipped = Math.min(toSkip, chunk.length);
      toSkip -= skipped;
      done(null, chunk.subarray(skipped));
    },
    flush(done) {
      done(null, toSkip === null ? head : null);
    },
  });
}

module.exports = { buildTag, withoutExistingTag };
