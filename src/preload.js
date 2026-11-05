const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('music', {
  accounts: () => ipcRenderer.invoke('music:accounts'),
  connect: (id) => ipcRenderer.invoke('music:connect', id),
  disconnect: (id) => ipcRenderer.invoke('music:disconnect', id),
  search: (text, source) => ipcRenderer.invoke('music:search', text, source),
  stream: (id, trackId) => ipcRenderer.invoke('music:stream', id, trackId),
  lyrics: (track) => ipcRenderer.invoke('music:lyrics', track),
  library: () => ipcRenderer.invoke('music:library'),
  artist: (id, artistId) => ipcRenderer.invoke('music:artist', id, artistId),
  random: (count) => ipcRenderer.invoke('music:random', count),
  mix: (count, played) => ipcRenderer.invoke('music:mix', count, played),
  likedKeys: () => ipcRenderer.invoke('music:liked-keys'),
  setLiked: (id, trackId, liked) => ipcRenderer.invoke('music:set-liked', id, trackId, liked),
  waveNext: (options) => ipcRenderer.invoke('wave:next', options),
  waveEvent: (track, type, heard) => ipcRenderer.invoke('wave:event', track, type, heard),
  waveSimilar: (track, count, exclude) => ipcRenderer.invoke('wave:similar', track, count, exclude),
  waveGenres: (source) => ipcRenderer.invoke('wave:genres', source),
  waveDislike: (track) => ipcRenderer.invoke('wave:dislike', track),
  waveUndislike: (key) => ipcRenderer.invoke('wave:undislike', key),
  waveDislikes: () => ipcRenderer.invoke('wave:dislikes'),
  downloadFolder: () => ipcRenderer.invoke('downloads:folder'),
  chooseDownloadFolder: () => ipcRenderer.invoke('downloads:choose'),
  openDownloadFolder: () => ipcRenderer.invoke('downloads:open'),
  saveTrack: (track) => ipcRenderer.invoke('downloads:save', track),
  isDownloaded: (track) => ipcRenderer.invoke('downloads:is-saved', track),
  playlists: () => ipcRenderer.invoke('playlists:list'),
  createPlaylist: (title) => ipcRenderer.invoke('playlists:create', title),
  removePlaylist: (id) => ipcRenderer.invoke('playlists:remove', id),
  togglePlaylistTrack: (id, track) => ipcRenderer.invoke('playlists:toggle', id, track),
  collection: (id, collectionId, offset) => ipcRenderer.invoke('music:collection', id, collectionId, offset),
});

contextBridge.exposeInMainWorld('quadUpdate', {
  version: ipcRenderer.sendSync('app:version'),
  check: () => ipcRenderer.invoke('update:check'),
  install: () => ipcRenderer.invoke('update:install'),
  openPage: () => ipcRenderer.send('update:open-page'),
  onProgress: (callback) => {
    ipcRenderer.on('update:progress', (_event, share) => callback(share));
  },
});

contextBridge.exposeInMainWorld('windowControls', {
  platform: process.platform,
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
  setZoom: (factor) => webFrame.setZoomFactor(factor),
  onMaximizedChange: (callback) => {
    ipcRenderer.on('window:maximized', (_event, isMaximized) => callback(isMaximized));
  },
});
