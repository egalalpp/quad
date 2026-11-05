// Моя волна: бесконечная очередь, которая подстраивается под действия прямо во время игры.
(() => {
  const MODE_KEY = 'quad.waveMode';
  const FILTERS_KEY = 'quad.waveFilters';
  const FIRST_BATCH = 12;
  const NEXT_BATCH = 10;
  const REFILL_AT = 4;
  const SKIP_SECONDS = 30;
  const SKIP_SHARE = 0.4;
  const FINISH_SHARE = 0.8;
  const SIMILAR_AFTER_LIKE = 3;

  const GENRE_NAMES = {
    alternative: 'Альтернатива',
    bard: 'Авторская',
    classical: 'Классика',
    dance: 'Танцевальная',
    electronics: 'Электроника',
    folk: 'Фолк',
    foreignrap: 'Зарубежный рэп',
    hardrock: 'Хард-рок',
    house: 'Хаус',
    indie: 'Инди',
    jazz: 'Джаз',
    metal: 'Метал',
    phonk: 'Фонк',
    pop: 'Поп',
    punk: 'Панк',
    rap: 'Рэп',
    reggae: 'Регги',
    rnb: 'R&B',
    rock: 'Рок',
    rusrap: 'Русский рэп',
    rusrock: 'Русский рок',
    ruspop: 'Русская поп-музыка',
    soundtrack: 'Саундтреки',
    techno: 'Техно',
  };
  const ERAS = [['fresh', 'Свежее'], ['tens', '2010-е'], ['older', 'Старое']];

  const modeButtons = document.querySelectorAll('[data-wave-mode]');
  const dislikeButton = document.getElementById('btn-dislike');
  const seedButtons = document.querySelectorAll('[data-wave-seed]');
  const tuneToggle = document.getElementById('wave-tune-toggle');
  const tunePanel = document.getElementById('wave-tune');
  const genreBox = document.getElementById('wave-genres');
  const eraBox = document.getElementById('wave-eras');
  const seedChip = document.getElementById('wave-seed');

  // Ссылка на этот массив становится очередью, поэтому он меняется на месте.
  let queue = null;
  let loading = false;
  let rebuild = 0;
  let switching = false;
  let mode = localStorage.getItem(MODE_KEY) ?? 'mix';
  let filters = { genre: null, era: null, ...JSON.parse(localStorage.getItem(FILTERS_KEY) ?? 'null') };
  let seed = null;

  const keyOf = (track) => `${track.provider}:${track.id}`;
  const mainArtist = (track) => `${track.provider}:${track.artistList[0]?.id}`;
  const isActive = () => queue !== null && quadPlayer.queueIs(queue);
  const genreName = (genre) => GENRE_NAMES[genre] ?? genre.charAt(0).toUpperCase() + genre.slice(1);

  function requestOptions(count, exclude, previousArtist) {
    return { mode, count, exclude, previousArtist, filters, seed };
  }

  async function load(count) {
    const last = queue.at(-1);
    return music.waveNext(requestOptions(count, queue.map(keyOf), last ? mainArtist(last) : null));
  }

  async function refill() {
    if (loading) return;
    loading = true;
    const started = rebuild;
    try {
      const tracks = await load(NEXT_BATCH);
      if (!isActive() || started !== rebuild) return;
      queue.push(...tracks);
      quadPlayer.renderQueue();
    } catch {
      // Попробует ещё раз на следующем треке.
    } finally {
      loading = false;
    }
  }

  async function start() {
    queue = [];
    seed = null;
    loading = true;
    document.body.classList.add('wave-loading');
    try {
      const tracks = await load(FIRST_BATCH);
      queue.push(...tracks);
      if (tracks.length > 0) quadPlayer.play(queue, 0);
      else quadPlayer.showToast('Под такие настройки ничего не нашлось');
    } finally {
      loading = false;
      document.body.classList.remove('wave-loading');
      renderTune();
    }
  }

  // Волна от конкретного трека. Если он уже играет, музыка не прерывается.
  async function startFrom(track) {
    const playing = quadPlayer.currentTrack();
    const isPlaying = playing !== null && keyOf(playing) === keyOf(track);

    queue = [track];
    seed = track;
    rebuild += 1;
    loading = true;
    document.body.classList.add('wave-loading');
    try {
      queue.push(...await load(FIRST_BATCH));
      if (isPlaying) quadPlayer.adoptQueue(queue, 0);
      else quadPlayer.play(queue, 0);
      quadPlayer.showToast(`Волна по треку: ${track.title}`);
    } catch {
      quadPlayer.showToast('Не удалось собрать волну');
    } finally {
      loading = false;
      document.body.classList.remove('wave-loading');
      renderTune();
    }
  }

  // Смена настроек: всё, что ещё не играло, заменяется новым набором, и волна сразу на него переходит.
  async function applyChanges() {
    if (!isActive()) return;
    rebuild += 1;
    const current = rebuild;
    const position = quadPlayer.queueIndex();

    document.body.classList.add('wave-loading');
    try {
      const tracks = await music.waveNext(requestOptions(
        FIRST_BATCH,
        queue.slice(0, position + 1).map(keyOf),
        mainArtist(queue[position]),
      ));
      if (current !== rebuild || !isActive()) return;
      if (tracks.length === 0) {
        quadPlayer.showToast('Под такие настройки ничего не нашлось');
        return;
      }

      const next = quadPlayer.queueIndex() + 1;
      queue.splice(next, queue.length, ...tracks);

      // Это смена настроек, а не пропуск: трек не должен попасть в нелюбимые.
      switching = true;
      quadPlayer.play(queue, next);
      switching = false;
    } catch {
      // Очередь остаётся прежней.
    } finally {
      if (current === rebuild) document.body.classList.remove('wave-loading');
    }
  }

  // Пропуск сразу убирает из очереди других ближайших треков этого артиста.
  function dropArtist(track) {
    const artist = mainArtist(track);
    const position = quadPlayer.queueIndex();
    for (let i = queue.length - 1; i > position; i -= 1) {
      if (mainArtist(queue[i]) === artist) queue.splice(i, 1);
    }
    quadPlayer.renderQueue();
  }

  /* Не нравится */

  async function undoDislike(track) {
    await music.waveUndislike(keyOf(track));
    document.dispatchEvent(new CustomEvent('quad:dislikes-changed'));
    quadPlayer.showToast('Вернул обратно');
  }

  function popDislike() {
    dislikeButton.classList.remove('is-popping');
    dislikeButton.getBoundingClientRect();
    dislikeButton.classList.add('is-popping');
  }

  async function dislikeCurrent() {
    const track = quadPlayer.currentTrack();
    if (!track) return;

    popDislike();
    await music.waveDislike(track);
    if (isActive()) dropArtist(track);

    // Запись уже есть, отдельный пропуск засчитывать не нужно.
    switching = true;
    quadPlayer.next();
    switching = false;
    if (quadPlayer.currentTrack() === track) quadPlayer.audio.pause();

    document.dispatchEvent(new CustomEvent('quad:dislikes-changed'));
    quadPlayer.showToast(`Больше не поставлю: ${track.title}`, {
      label: 'Отменить',
      run: () => undoDislike(track),
    });
  }

  /* Настройки волны */

  function chip(label, active, onClick) {
    const button = document.createElement('button');
    button.className = 'home-mode';
    button.textContent = label;
    button.classList.toggle('is-active', active);
    button.addEventListener('click', onClick);
    return button;
  }

  function setFilter(name, value) {
    filters = { ...filters, [name]: filters[name] === value ? null : value };
    seed = null;
    localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
    renderTune();
    applyChanges();
  }

  async function renderTune() {
    const active = [filters.genre, filters.era, seed].filter(Boolean).length;
    tuneToggle.textContent = active > 0 ? `Настроить · ${active}` : 'Настроить';
    tuneToggle.classList.toggle('is-active', active > 0);

    eraBox.replaceChildren(
      chip('Любая', !filters.era, () => setFilter('era', filters.era)),
      ...ERAS.map(([value, label]) => chip(label, filters.era === value, () => setFilter('era', value))),
    );

    const current = quadPlayer.currentTrack();
    seedChip.disabled = !current && !seed;
    seedChip.classList.toggle('is-active', Boolean(seed));
    seedChip.textContent = seed ? `От «${seed.title}»` : 'От этого трека';

    if (tunePanel.hidden) return;
    const genres = await music.waveGenres().catch(() => []);
    const list = filters.genre && !genres.includes(filters.genre) ? [filters.genre, ...genres] : genres;
    genreBox.replaceChildren(
      chip('Любой', !filters.genre, () => setFilter('genre', filters.genre)),
      ...list.map((genre) => chip(genreName(genre), filters.genre === genre, () => setFilter('genre', genre))),
    );
  }

  function closeTune() {
    tunePanel.hidden = true;
  }

  tuneToggle.addEventListener('click', (event) => {
    event.stopPropagation();
    tunePanel.hidden = !tunePanel.hidden;
    renderTune();
  });
  tunePanel.addEventListener('click', (event) => event.stopPropagation());
  document.addEventListener('click', closeTune);
  document.addEventListener('quad:view', closeTune);

  seedChip.addEventListener('click', () => {
    if (seed) {
      seed = null;
      renderTune();
      applyChanges();
      return;
    }
    const track = quadPlayer.currentTrack();
    if (track) startFrom(track);
  });

  seedButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const track = quadPlayer.currentTrack();
      if (track) startFrom(track);
    });
  });

  /* События */

  document.addEventListener('quad:listen', ({ detail }) => {
    if (switching) return;
    const { track, played, duration, finished } = detail;
    const heard = played / duration;

    if (finished || heard >= FINISH_SHARE) {
      music.waveEvent(track, 'finish', heard);
    } else if (played < SKIP_SECONDS && heard < SKIP_SHARE) {
      music.waveEvent(track, 'skip', heard);
      if (isActive()) dropArtist(track);
    }
  });

  // Лайк в волне срабатывает сразу: следом идут похожие, а не только через партию.
  document.addEventListener('quad:liked', async ({ detail: track }) => {
    if (!isActive()) return;
    const tracks = await music.waveSimilar(track, SIMILAR_AFTER_LIKE, queue.map(keyOf)).catch(() => []);
    if (!isActive() || tracks.length === 0) return;
    queue.splice(quadPlayer.queueIndex() + 1, 0, ...tracks);
    quadPlayer.renderQueue();
  });

  document.addEventListener('quad:track', () => {
    const current = quadPlayer.currentTrack();
    if (isActive() && queue.length - quadPlayer.queueIndex() <= REFILL_AT) refill();
    document.body.classList.toggle('wave-on', isActive());
    dislikeButton.disabled = current === null;
    seedButtons.forEach((button) => {
      button.hidden = current === null;
    });
    if (!isActive()) seed = null;
    renderTune();
  });

  function showMode() {
    modeButtons.forEach((button) => {
      button.classList.toggle('is-active', button.dataset.waveMode === mode);
    });
  }

  modeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.waveMode === mode) return;
      mode = button.dataset.waveMode;
      localStorage.setItem(MODE_KEY, mode);
      showMode();
      applyChanges();
    });
  });

  dislikeButton.addEventListener('click', dislikeCurrent);

  showMode();
  renderTune();
  window.quadWave = { start, startFrom, isActive };
})();
