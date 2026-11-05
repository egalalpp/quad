// Перевод ответов SoundCloud в формат Quad. Чистые функции без Electron и сети.
const id = 'soundcloud';
const name = 'SoundCloud';

// У трека без своей обложки её роль играет аватар автора.
function coverUrl(item, size) {
  const url = item.artwork_url ?? item.avatar_url ?? item.user?.avatar_url;
  return url ? url.replace(/-(large|t\d+x\d+|crop)\./, `-${size}.`) : null;
}

function yearOf(track) {
  const date = new Date(track.release_date ?? track.display_date ?? track.created_at ?? NaN);
  return Number.isNaN(date.getTime()) ? null : date.getUTCFullYear();
}

function toTrack(track) {
  const artist = track.user?.username ?? track.publisher_metadata?.artist ?? 'Неизвестный автор';
  return {
    provider: id,
    providerName: name,
    id: String(track.id),
    title: track.title,
    artists: artist,
    artistList: [{ id: String(track.user?.id ?? track.user_id), name: artist }],
    durationMs: track.full_duration ?? track.duration,
    cover: coverUrl(track, 't200x200'),
    coverMedium: coverUrl(track, 't300x300'),
    coverLarge: coverUrl(track, 't500x500'),
    album: track.publisher_metadata?.album_title ?? null,
    albumId: null,
    year: yearOf(track),
    genre: track.genre ? track.genre.toLowerCase() : null,
    label: track.label_name ?? null,
    lyrics: null,
    page: track.permalink_url ?? null,
    canDownload: false,
  };
}


function toArtist(user) {
  const artistId = String(user.id);
  return {
    kind: 'artist',
    provider: id,
    id: artistId,
    collectionId: `artist:${artistId}`,
    title: user.username,
    subtitle: 'Исполнитель',
    cover: coverUrl(user, 't300x300'),
  };
}

function toAlbum(playlist) {
  const collectionId = `playlist:${playlist.id}`;
  return {
    kind: 'album',
    provider: id,
    id: collectionId,
    collectionId,
    title: playlist.title,
    subtitle: playlist.user?.username ?? '',
    cover: coverUrl(playlist, 't300x300'),
  };
}

function toLibraryItem(entry) {
  const playlist = entry.playlist ?? entry.system_playlist;
  if (!playlist) return null;

  const type = entry.type ?? '';
  const system = Boolean(entry.system_playlist);
  const collectionId = system ? `system:${playlist.urn ?? playlist.id}` : `playlist:${playlist.id}`;

  let group = 'playlists';
  if (type.includes('album') || playlist.is_album) group = 'albums';
  else if (system || type.includes('like')) group = 'collections';

  return {
    provider: id,
    id: collectionId,
    collectionId,
    kind: 'playlist',
    group,
    title: playlist.title,
    count: playlist.track_count ?? playlist.tracks?.length ?? 0,
    cover: coverUrl(playlist, 't300x300'),
  };
}

// Зашифрованные потоки браузер без защиты контента не сыграет, а отрывок берём, только если нет полного.
function pickTranscoding(transcodings) {
  const open = transcodings.filter(({ format }) => (
    format?.protocol === 'hls' || format?.protocol === 'progressive'
  ));
  const full = open.filter((item) => !item.snipped);
  const list = full.length > 0 ? full : open;

  const rank = ({ format, quality }) => (
    (format.protocol === 'progressive' ? 2 : 0)
    + (quality === 'hq' ? 4 : 0)
    + (format.mime_type?.includes('mp4') ? 1 : 0)
  );
  return [...list].sort((a, b) => rank(b) - rank(a))[0] ?? null;
}

// Треки лейблов приходят только под защитой: сыграть их плеер не сможет, поэтому в списках их нет.
// У заглушек из плейлистов потоков ещё нет, такие проверятся после загрузки.
function isPlayable(track) {
  if (!track?.title || track.policy === 'BLOCK') return false;
  return !track.media || pickTranscoding(track.media.transcodings ?? []) !== null;
}

function toTracks(tracks) {
  return tracks.filter(isPlayable).map(toTrack);
}

function qualityOf(transcoding) {
  const codec = transcoding.format.mime_type?.includes('mpeg') ? 'mp3' : 'aac';
  return `${codec} ${transcoding.format.protocol === 'hls' ? 'поток' : 'файл'}`;
}

module.exports = {
  id,
  name,
  coverUrl,
  pickTranscoding,
  qualityOf,
  toAlbum,
  toArtist,
  toLibraryItem,
  toTrack,
  toTracks,
};
