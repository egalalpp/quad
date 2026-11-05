// Все сервисы Quad в одном месте. Чтобы подключить новый:
// 1. Создать файл в этой папке: id, name, mediaHosts и методы из REQUIRED.
// 2. Вписать его в services и убрать из planned.
// 3. Добавить адреса из mediaHosts в CSP в renderer/index.html.
// Вход, переключатели сервисов, поиск, медиатека и волна подхватят его сами.
//
// Необязательные методы: lyrics (свой текст песни) и discover (что советует сам сервис,
// волна начинает с этого на пустом аккаунте, если вкус не удалось взять с других сервисов).
const soundcloud = require('./soundcloud');
const yandex = require('./yandex');

const REQUIRED = [
  'isConnected',
  'status',
  'search',
  'artist',
  'artistNeighbours',
  'similarTracks',
  'likedIds',
  'setLiked',
  'library',
  'collection',
  'randomTracks',
  'streamUrl',
  'login',
  'logout',
];

const ALL = 'all';

const services = [yandex, soundcloud];

// Кнопки на заставке и строки в Аккаунтах уже есть, подключения пока нет.
const planned = [
  { id: 'spotify', name: 'Spotify' },
  { id: 'apple', name: 'Apple Music' },
  { id: 'youtube', name: 'YouTube Music' },
  { id: 'files', name: 'Локальные файлы' },
];

function missingMethods(provider) {
  return REQUIRED.filter((method) => typeof provider[method] !== 'function');
}

// Выбранный сервис, а если его отключили или выбраны все, то все подключённые.
function scopeOf(connected, source = ALL) {
  const chosen = connected.filter((provider) => provider.id === source);
  return chosen.length > 0 ? chosen : connected;
}

module.exports = {
  ALL,
  missingMethods,
  planned,
  scopeOf,
  services,
};
