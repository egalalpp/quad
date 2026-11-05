(() => {
  const VOLUME_KEY = 'quad.volume';
  const RESTART_AFTER = 3;
  const MAX_ROW_DELAY = 14;
  const QUEUE_SHOWN = 80;

  // Фон рисуется один раз на маленьком холсте и растягивается. Должно совпадать с размерами в CSS.
  const AMBIENT_SIZE = 192;
  const AMBIENT_INSET = 32;
  const AMBIENT_BLUR = 10;
  const TOAST_MS = 1800;
  const TOAST_ACTION_MS = 6000;
  const TALL_TIP_TARGET = 100;

  // Следующий трек готовится заранее: чуть позже старта текущего и ещё раз перед его концом.
  const PREPARE_DELAY = 1500;
  const PREPARE_BEFORE_END = 20;
  const PREPARED_LIFETIME = 4 * 60 * 1000;

  // Трек, который не играет, не должен останавливать очередь, но и перебирать её бесконечно нельзя.
  const SKIP_BROKEN_AFTER = 1200;
  const MAX_BROKEN_IN_ROW = 5;

  const audio = new Audio();
  audio.crossOrigin = 'anonymous';

  // Молчаливый плеер качает начало следующего трека: основной потом берёт уже скачанное.
  const warmAudio = new Audio();
  warmAudio.crossOrigin = 'anonymous';
  warmAudio.preload = 'auto';
  warmAudio.muted = true;

  const queueEmpty = document.getElementById('queue-empty');
  const queueList = document.getElementById('queue-list');
  const appAmbient = document.getElementById('app-ambient');
  const nowTrack = document.getElementById('now-track');
  const nowCover = document.getElementById('now-cover');
  const nowCoverImage = document.getElementById('now-cover-image');
  const nowTitle = document.getElementById('now-title');
  const nowArtist = document.getElementById('now-artist');
  const time = document.getElementById('time');
  const fill = document.querySelector('.progress-fill');
  const seekDot = document.getElementById('seek-dot');
  const seekArea = document.getElementById('seek');
  const volume = document.getElementById('volume');
  const playButton = document.getElementById('btn-play');
  const prevButton = document.getElementById('btn-prev');
  const nextButton = document.getElementById('btn-next');
  const navAvatar = document.getElementById('nav-avatar');
  const navInitial = document.getElementById('nav-initial');
  const navAccountName = document.getElementById('nav-account-name');
  const navAccountNote = document.getElementById('nav-account-note');
  const connectNote = document.getElementById('connect-note');
  const accountRows = document.getElementById('account-rows');
  const laterButton = document.getElementById('intro-later');
  const toast = document.getElementById('toast');
  const toastText = document.getElementById('toast-text');
  const toastAction = document.getElementById('toast-action');
  const tip = document.getElementById('tip');

  let accounts = [];
  let queue = [];
  let queueIndex = -1;

  // «Играть следующим» живёт отдельно: очередь это тот же массив, что и открытый список,
  // поэтому вставлять в неё нельзя. Трек из этого списка играет мимо очереди, не сдвигая её.
  let upNext = [];
  let detour = null;
  let movedKeys = new Set();

  let currentStream = null;
  let toastTimer = 0;
  let listening = null;
  let playRequest = 0;
  let prepared = null;
  let prepareTimer = 0;
  let brokenInRow = 0;

  const trackKey = (track) => `${track.provider}:${track.id}`;
  const currentTrack = () => detour ?? queue[queueIndex] ?? null;
  const hasAccount = () => accounts.some((account) => account.connected);

  function formatTime(seconds) {
    const total = Math.floor(seconds);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  function plural(count, one, few, many) {
    const lastTwo = count % 100;
    const last = count % 10;
    if (lastTwo >= 11 && lastTwo <= 14) return many;
    if (last === 1) return one;
    return last >= 2 && last <= 4 ? few : many;
  }

  function shuffled(list) {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function hideToast() {
    toast.classList.remove('is-visible');
  }

  function showToast(text, action) {
    toastText.textContent = text;
    toastAction.hidden = !action;
    toastAction.textContent = action?.label ?? '';
    toastAction.onclick = action ? () => {
      hideToast();
      action.run();
    } : null;

    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, action ? TOAST_ACTION_MS : TOAST_MS);
  }

  // Свои подсказки вместо системных: те выбиваются из стиля и появляются с задержкой.
  function showTip(event) {
    const target = event.target.closest?.('[data-tip]');
    tip.classList.toggle('is-visible', Boolean(target));
    if (!target) return;

    tip.textContent = target.dataset.tip;
    const box = target.getBoundingClientRect();
    const half = tip.offsetWidth / 2;
    const center = box.left + box.width / 2;
    tip.style.left = `${Math.max(half + 8, Math.min(window.innerWidth - half - 8, center))}px`;
    tip.style.top = `${(box.height > TALL_TIP_TARGET ? event.clientY - 12 : box.top - 8)}px`;
  }

  document.addEventListener('pointerover', showTip);
  document.addEventListener('pointerdown', () => tip.classList.remove('is-visible'));

  /* Аккаунты */

  async function toggleAccount(account) {
    if (account.connected) {
      await music.disconnect(account.id);
      await refreshAccounts();
    } else {
      await connect(account.id);
    }
  }

  function accountRow(account) {
    const parts = [account.account ?? 'подключено'];
    if (account.hasSubscription === false) parts.push('без Плюса');

    const status = element('span', 'status', account.connected ? parts.join(' · ') : 'не подключено');
    status.classList.toggle('is-on', account.connected);
    status.dataset.accountStatus = account.id;

    const end = element('span', 'row-end');
    end.append(status);
    if (!account.planned) {
      const action = element('button', 'row-action', account.connected ? 'Выйти' : 'Подключить');
      action.dataset.accountAction = account.id;
      action.addEventListener('click', () => toggleAccount(account));
      end.append(action);
    }

    const row = element('li');
    row.append(element('span', '', account.name), end);
    return row;
  }

  function renderAccounts() {
    accountRows.replaceChildren(...accounts.map(accountRow));
    for (const account of accounts) {
      document.querySelector(`.service[data-provider="${account.id}"]`)
        ?.classList.toggle('is-connected', account.connected);
    }

    const connected = accounts.find((account) => account.connected);
    const accountName = connected?.account ?? null;
    navAvatar.classList.toggle('is-connected', accountName !== null);
    navInitial.textContent = accountName?.charAt(0).toUpperCase() ?? '';
    navAccountName.textContent = accountName ?? 'Аккаунты';
    navAccountNote.textContent = connected?.name ?? '';

    laterButton.textContent = hasAccount() ? 'Продолжить' : 'Позже';
  }

  async function refreshAccounts() {
    accounts = await music.accounts();
    renderAccounts();
    document.dispatchEvent(new CustomEvent('quad:accounts'));
  }

  async function connect(id) {
    const connected = await music.connect(id);
    await refreshAccounts();
    return connected;
  }

  document.querySelectorAll('.service').forEach((button) => {
    button.addEventListener('click', async () => {
      if (button.classList.contains('is-connected')) return;
      if (accounts.find((account) => account.id === button.dataset.provider)?.planned) {
        connectNote.textContent = `Подключение ${button.dataset.service} пока не готово`;
        return;
      }
      connectNote.textContent = 'Войдите в открывшемся окне';
      try {
        const connected = await connect(button.dataset.provider);
        connectNote.textContent = connected ? `${button.textContent.trim()}: подключено` : '';
      } catch {
        connectNote.textContent = 'Не удалось подключить аккаунт';
      }
    });
  });

  /* Строка трека */

  function rowAction(className, label, iconId) {
    const button = element('button', `track-action ${className}`);
    button.setAttribute('aria-label', label);
    button.append(document.getElementById(iconId).content.cloneNode(true));
    return button;
  }

  // Строка не кнопка: внутри неё свои кнопки, а вложенные кнопки в HTML запрещены.
  function createRow(track, index, tracks, { onRemove } = {}) {
    const row = element('div', 'track-row');
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.dataset.key = trackKey(track);
    row.quadTrack = track;
    row.style.setProperty('--row', index % 100 < MAX_ROW_DELAY ? index % 100 : MAX_ROW_DELAY);

    const bars = element('span', 'bars');
    bars.append(element('i'), element('i'), element('i'));

    const number = element('span', 'track-number');
    number.append(
      element('span', 'track-index', index + 1),
      document.getElementById('row-play-icon').content.cloneNode(true),
      bars,
    );

    const cover = element('span', 'cover');
    if (track.cover) {
      const image = element('img');
      image.src = track.cover;
      image.alt = '';
      image.loading = 'lazy';
      cover.append(image);
    }

    const artist = element('span', 'track-artist');
    renderArtistLinks(artist, track);

    const text = element('span', 'track-text');
    text.append(element('span', 'track-title', track.title), artist);

    const like = rowAction('like-button row-like', 'Мне нравится', 'heart-icon');
    like.classList.toggle('is-liked', quadPlayer.isLiked(track));

    const wave = rowAction('row-wave', 'Волна по этому треку', 'wave-icon');
    wave.dataset.tip = 'Волна по этому треку';
    wave.addEventListener('click', () => quadWave.startFrom(track));

    const next = rowAction('row-next', 'Играть следующим', 'next-icon');
    next.dataset.tip = 'Играть следующим';
    next.addEventListener('click', () => addNext(track));

    const actions = element('span', 'row-actions');
    actions.append(wave, next, like, rowAction('row-add', 'Добавить в плейлист', 'plus-icon'));
    if (onRemove) {
      const remove = rowAction('row-remove', 'Убрать из плейлиста', 'cross-icon');
      remove.addEventListener('click', () => onRemove(track));
      actions.append(remove);
    }

    row.append(
      number,
      cover,
      text,
      albumCell(track),
      actions,
      element('span', 'track-time', formatTime(track.durationMs / 1000)),
    );

    row.addEventListener('click', (event) => {
      if (!event.target.closest('.row-actions, .artist-link, .album-link')) play(tracks, index);
    });
    row.addEventListener('keydown', (event) => {
      if (event.target === row && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        play(tracks, index);
      }
    });

    const item = element('li');
    item.append(row);
    return item;
  }

  /* Очередь */

  function queueEntry(track, onPlay, action) {
    const cover = element('span', 'queue-cover');
    if (track.cover) {
      const image = element('img');
      image.src = track.cover;
      image.alt = '';
      image.loading = 'lazy';
      cover.append(image);
    }

    const text = element('span', 'queue-text');
    text.append(element('span', 'queue-title', track.title), element('span', 'queue-artist', track.artists));

    const entry = element('div', 'queue-item');
    entry.dataset.tip = `${track.title} — ${track.artists}`;
    entry.append(cover, text, action);
    entry.addEventListener('click', (event) => {
      if (!event.target.closest('.queue-action')) onPlay();
    });

    const item = element('li');
    item.append(entry);
    return item;
  }

  function queueAction(label, iconId, onClick) {
    const button = rowAction('queue-action', label, iconId);
    button.dataset.tip = label;
    button.addEventListener('click', onClick);
    return button;
  }

  function queueHeading(text) {
    return element('li', 'queue-heading', text);
  }

  function renderQueue() {
    const planned = upNext.map((track, position) => queueEntry(
      track,
      () => {
        detour = upNext.splice(position, 1)[0];
        startTrack(detour);
      },
      queueAction('Убрать из очереди', 'cross-icon', () => removeNext(position)),
    ));

    const rest = [];
    for (let index = queueIndex + 1; index < queue.length && rest.length < QUEUE_SHOWN; index += 1) {
      const track = queue[index];
      if (!movedKeys.has(trackKey(track))) {
        rest.push(queueEntry(
          track,
          () => playAt(index),
          queueAction('Играть следующим', 'next-icon', () => addNext(track)),
        ));
      }
    }

    queueEmpty.hidden = planned.length + rest.length > 0;
    queueList.replaceChildren(
      ...(planned.length > 0 ? [queueHeading('Следующие'), ...planned] : []),
      ...(planned.length > 0 && rest.length > 0 ? [queueHeading('Дальше')] : []),
      ...rest,
    );
    renderControls();
    schedulePrepare();
  }

  // Трек, поставленный следующим из самой очереди, не должен потом сыграть второй раз.
  function addNext(track) {
    if (!currentTrack()) {
      play([track], 0);
      return;
    }

    const key = trackKey(track);
    if (upNext.some((item) => trackKey(item) === key)) {
      showToast('Этот трек уже стоит следующим');
      return;
    }
    if (queue.slice(queueIndex + 1).some((item) => trackKey(item) === key)) movedKeys.add(key);
    upNext.push(track);
    renderQueue();
    showToast(`Следующим: ${track.title}`);
  }

  function removeNext(position) {
    const [track] = upNext.splice(position, 1);
    movedKeys.delete(trackKey(track));
    renderQueue();
  }

  // Следующая позиция в очереди с учётом треков, которые из неё уже переставили.
  function upcomingIndex() {
    let index = queueIndex + 1;
    while (index < queue.length && movedKeys.has(trackKey(queue[index]))) index += 1;
    return index;
  }

  function markCurrentRow() {
    const current = currentTrack();
    document.querySelectorAll('.track-row').forEach((row) => {
      row.classList.toggle('is-current', current !== null && row.dataset.key === trackKey(current));
    });
  }

  /* Плеер */

  function showProgress(percent) {
    fill.style.width = `${percent}%`;
    seekDot.style.left = `${percent}%`;
  }

  function renderControls() {
    const hasTrack = currentTrack() !== null;
    playButton.disabled = !hasTrack;
    prevButton.disabled = !hasTrack;
    nextButton.disabled = upNext.length === 0 && upcomingIndex() >= queue.length;
    playButton.setAttribute('aria-label', audio.paused ? 'Играть' : 'Пауза');
    document.body.classList.toggle('is-playing', !audio.paused);
  }

  // Не кнопка: кнопка не умеет обрезаться многоточием посреди строки.
  function textLink(className, text, open) {
    const link = element('span', className, text);
    link.tabIndex = 0;
    link.setAttribute('role', 'link');
    link.addEventListener('click', open);
    link.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') open();
    });
    return link;
  }

  function renderArtistLinks(box, track, note) {
    box.replaceChildren();
    track.artistList.forEach((artist, index) => {
      if (index > 0) box.append(', ');
      box.append(textLink('artist-link', artist.name, () => quadEntity.open({
        kind: 'artist',
        provider: track.provider,
        id: artist.id,
        collectionId: `artist:${artist.id}`,
        title: artist.name,
        subtitle: 'Исполнитель',
        cover: null,
      })));
    });
    if (note) box.append(` · ${note}`);
  }

  // Старые плейлисты хранят треки без номера альбома: там название остаётся простым текстом.
  function albumLink(track) {
    if (!track.albumId) return document.createTextNode(track.album ?? '');
    return textLink('album-link', track.album, () => quadEntity.open({
      kind: 'album',
      provider: track.provider,
      id: track.albumId,
      collectionId: `album:${track.albumId}`,
      title: track.album,
      subtitle: [track.artists, track.year].filter(Boolean).join(' · '),
      cover: track.coverMedium,
    }));
  }

  function albumCell(track) {
    const cell = element('span', 'track-album');
    cell.append(albumLink(track));
    return cell;
  }

  // Огромная картинка с фильтром размытия заново считалась бы на видеокарте и держала там полный слой.
  async function paintAmbient(canvas, url) {
    canvas.dataset.url = url ?? '';
    canvas.classList.toggle('has-image', Boolean(url));
    if (!url) return;

    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      return;
    }
    if (canvas.dataset.url !== url) return;

    const context = canvas.getContext('2d');
    const size = AMBIENT_SIZE - AMBIENT_INSET * 2;
    context.clearRect(0, 0, AMBIENT_SIZE, AMBIENT_SIZE);
    context.filter = `blur(${AMBIENT_BLUR}px) saturate(1.3)`;
    context.drawImage(image, AMBIENT_INSET, AMBIENT_INSET, size, size);
  }

  function renderNowPlaying(track, note) {
    nowTitle.textContent = track.title;
    nowTitle.classList.remove('muted');
    renderArtistLinks(nowArtist, track, note);
    nowArtist.title = note === 'отрывок' ? 'Полные треки доступны с подпиской Плюс' : '';

    nowTrack.classList.add('has-cover');
    nowCover.hidden = false;
    if (track.cover) nowCoverImage.src = track.cover;
    else nowCoverImage.removeAttribute('src');
    paintAmbient(appAmbient, track.cover);
  }

  function updateMediaSession(track) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artists,
      artwork: track.cover ? [{ src: track.cover, sizes: '200x200' }] : [],
    });
  }

  // Волна учится на том, что дослушали, а что пропустили.
  function reportListen(finished) {
    if (!listening) return;
    const duration = Number.isFinite(audio.duration) ? audio.duration : listening.durationMs / 1000;
    document.dispatchEvent(new CustomEvent('quad:listen', {
      detail: { track: listening, played: audio.currentTime, duration, finished },
    }));
    listening = null;
  }

  /* Заготовка следующего трека */

  const nextTrack = () => upNext[0] ?? queue[upcomingIndex()] ?? null;
  const isFresh = ({ at }) => Date.now() - at < PREPARED_LIFETIME;

  async function prepareNext() {
    const track = nextTrack();
    if (!track || !currentStream) return;
    const key = trackKey(track);
    if (prepared?.key === key && isFresh(prepared)) return;

    const request = playRequest;
    try {
      const stream = await music.stream(track.provider, track.id);
      if (request !== playRequest || nextTrack() !== track) return;
      prepared = { key, stream, at: Date.now() };
      warmAudio.src = stream.url;
      if (track.coverLarge) new Image().src = track.coverLarge;
    } catch {
      // Ссылка запросится как обычно, в момент переключения.
    }
  }

  // Не откладывает уже назначенный запуск: иначе частые вызовы не дали бы ему случиться.
  function schedulePrepare() {
    if (prepareTimer !== 0) return;
    prepareTimer = setTimeout(() => {
      prepareTimer = 0;
      prepareNext();
    }, PREPARE_DELAY);
  }

  function takePrepared(track) {
    const ready = prepared;
    prepared = null;
    return ready?.key === trackKey(track) && isFresh(ready) ? ready.stream : null;
  }

  function releaseWarmAudio() {
    warmAudio.removeAttribute('src');
    warmAudio.load();
  }

  function skipBroken(request) {
    brokenInRow += 1;
    if (brokenInRow >= MAX_BROKEN_IN_ROW) {
      brokenInRow = 0;
      return;
    }
    setTimeout(() => {
      if (request === playRequest) playNext();
    }, SKIP_BROKEN_AFTER);
  }

  async function startTrack(track) {
    reportListen(false);
    playRequest += 1;
    const request = playRequest;

    currentStream = null;
    audio.pause();
    showProgress(0);
    seekDot.hidden = false;
    time.textContent = '0:00';
    renderNowPlaying(track);
    renderQueue();
    markCurrentRow();
    renderControls();
    updateMediaSession(track);
    document.dispatchEvent(new CustomEvent('quad:track'));

    const open = async (stream) => {
      if (request !== playRequest) return;
      currentStream = stream;
      if (stream.preview) renderNowPlaying(track, 'отрывок');
      document.dispatchEvent(new CustomEvent('quad:track'));
      audio.src = stream.url;
      await audio.play();
      listening = track;
      brokenInRow = 0;
      releaseWarmAudio();
      schedulePrepare();
    };
    const ask = () => music.stream(track.provider, track.id);

    try {
      // Заготовленная ссылка могла устареть, тогда запрашивается свежая.
      const ready = takePrepared(track);
      await open(ready ?? await ask()).catch(async (error) => {
        if (!ready || error.name === 'AbortError') throw error;
        await open(await ask());
      });
    } catch (error) {
      // AbortError значит, что пользователь уже включил другой трек.
      if (request === playRequest && error.name !== 'AbortError') {
        renderNowPlaying(track, 'не удалось включить');
        skipBroken(request);
      }
    }
  }

  function playAt(index) {
    detour = null;
    queueIndex = index;
    return startTrack(queue[index]);
  }

  function play(tracks, index) {
    queue = tracks;
    movedKeys = new Set();
    playAt(index);
  }

  // Новая очередь без перезапуска: то, что играет, продолжает играть.
  function adoptQueue(tracks, index) {
    queue = tracks;
    queueIndex = index;
    detour = null;
    movedKeys = new Set();
    renderQueue();
    document.dispatchEvent(new CustomEvent('quad:track'));
  }

  function playNext() {
    if (upNext.length > 0) {
      detour = upNext.shift();
      startTrack(detour);
      return;
    }
    const index = upcomingIndex();
    if (index < queue.length) playAt(index);
  }

  // Назад из вставленного трека ведёт к тому, что играло до него.
  function playPrevious() {
    if (currentStream && audio.currentTime > RESTART_AFTER) audio.currentTime = 0;
    else if (detour) playAt(queueIndex);
    else if (queueIndex === 0) audio.currentTime = 0;
    else playAt(queueIndex - 1);
  }

  function togglePlay() {
    if (!currentTrack()) return;
    if (audio.paused) audio.play();
    else audio.pause();
  }

  function seekTo(event) {
    if (!Number.isFinite(audio.duration)) return;
    const box = seekArea.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    audio.currentTime = ratio * audio.duration;
  }

  audio.addEventListener('timeupdate', () => {
    if (!Number.isFinite(audio.duration)) return;
    showProgress((audio.currentTime / audio.duration) * 100);
    time.textContent = formatTime(audio.currentTime);
    if (audio.duration - audio.currentTime < PREPARE_BEFORE_END) schedulePrepare();
  });
  audio.addEventListener('play', renderControls);
  audio.addEventListener('pause', renderControls);
  audio.addEventListener('ended', () => {
    reportListen(true);
    playNext();
  });

  playButton.addEventListener('click', togglePlay);
  prevButton.addEventListener('click', playPrevious);
  nextButton.addEventListener('click', playNext);

  seekArea.addEventListener('pointerdown', (event) => {
    seekArea.setPointerCapture(event.pointerId);
    seekTo(event);
  });
  seekArea.addEventListener('pointermove', (event) => {
    if (seekArea.hasPointerCapture(event.pointerId)) seekTo(event);
  });

  volume.addEventListener('input', () => {
    audio.volume = volume.value / 100;
    localStorage.setItem(VOLUME_KEY, volume.value);
  });

  document.addEventListener('keydown', (event) => {
    if (event.code === 'Space' && event.target === document.body
      && !document.body.classList.contains('intro-active')) {
      event.preventDefault();
      togglePlay();
    }
  });

  navigator.mediaSession.setActionHandler('play', togglePlay);
  navigator.mediaSession.setActionHandler('pause', togglePlay);
  navigator.mediaSession.setActionHandler('nexttrack', playNext);
  navigator.mediaSession.setActionHandler('previoustrack', playPrevious);

  const savedVolume = localStorage.getItem(VOLUME_KEY);
  if (savedVolume !== null) volume.value = savedVolume;
  volume.dispatchEvent(new Event('input'));

  window.quadPlayer = {
    audio,
    addNext,
    adoptQueue,
    albumLink,
    connectedAccount: () => accounts.find((account) => account.connected),
    createRow,
    currentTrack,
    currentStream: () => currentStream,
    hasAccount,
    markCurrentRow,
    next: playNext,
    paintAmbient,
    play,
    plural,
    queueIndex: () => queueIndex,
    queueIs: (list) => queue === list,
    renderArtistLinks,
    renderQueue,
    services: () => accounts.filter((account) => account.connected),
    showToast,
    shuffled,
  };

  // Только после загрузки всех скриптов, иначе ответ может прийти раньше, чем они подпишутся на событие.
  document.addEventListener('DOMContentLoaded', refreshAccounts);
})();
