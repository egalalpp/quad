// Свои плейлисты живут локально: только так в одном списке могут быть треки разных сервисов.
const { app } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const id = 'quad';
const file = () => path.join(app.getPath('userData'), 'playlists.json');
const sameTrack = (a, b) => a.provider === b.provider && a.id === b.id;

async function load() {
  try {
    return JSON.parse(await fs.readFile(file(), 'utf8'));
  } catch {
    return [];
  }
}

const save = (playlists) => fs.writeFile(file(), JSON.stringify(playlists));

async function create(title) {
  const playlists = await load();
  const playlist = { id: crypto.randomUUID(), title, tracks: [] };
  await save([...playlists, playlist]);
  return playlist;
}

async function remove(playlistId) {
  await save((await load()).filter((playlist) => playlist.id !== playlistId));
}

async function toggleTrack(playlistId, track) {
  const playlists = await load();
  const playlist = playlists.find((item) => item.id === playlistId);
  if (!playlist) return;

  const without = playlist.tracks.filter((item) => !sameTrack(item, track));
  playlist.tracks = without.length === playlist.tracks.length ? [...without, track] : without;
  await save(playlists);
}

async function library() {
  return (await load()).map((playlist) => ({
    provider: id,
    id: playlist.id,
    group: 'playlists',
    title: playlist.title,
    count: playlist.tracks.length,
    cover: playlist.tracks[0]?.coverMedium ?? null,
  }));
}

async function collection(playlistId) {
  const playlist = (await load()).find((item) => item.id === playlistId);
  return { tracks: playlist?.tracks ?? [], nextOffset: null };
}

module.exports = { id, load, create, remove, toggleTrack, library, collection };
