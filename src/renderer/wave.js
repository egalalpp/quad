// Моя волна: бесконечная очередь, которая подстраивается под действия прямо во время игры.
(() => {
  const MODE_KEY = 'quad.waveMode';
  const FIRST_BATCH = 12;
  const NEXT_BATCH = 10;
  const REFILL_AT = 4;
  const SKIP_SECONDS = 30;
  const SKIP_SHARE = 0.4;
  const FINISH_SHARE = 0.8;

  const modeButtons = document.querySelectorAll('[data-wave-mode]');

  // Ссылка на этот массив становится очередью, поэтому он меняется на месте.
  let queue = null;
  let loading = false;
  let rebuild = 0;
  let switching = false;
  let mode = localStorage.getItem(MODE_KEY) ?? 'mix';

  const keyOf = (track) => `${track.provider}:${track.id}`;
  const mainArtist = (track) => `${track.provider}:${track.artistList[0]?.id}`;
  const isActive = () => queue !== null && quadPlayer.queueIs(queue);

  async function load(count) {
    const last = queue.at(-1);
    return music.waveNext({
      mode,
      count,
      exclude: queue.map(keyOf),
      previousArtist: last ? mainArtist(last) : null,
    });
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
    loading = true;
    document.body.classList.add('wave-loading');
    try {
      const tracks = await load(FIRST_BATCH);
      queue.push(...tracks);
      if (tracks.length > 0) quadPlayer.play(queue, 0);
    } finally {
      loading = false;
      document.body.classList.remove('wave-loading');
    }
  }

  // Смена режима: всё, что ещё не играло, заменяется новым набором, и волна сразу на него переходит.
  async function applyMode() {
    if (!isActive()) return;
    rebuild += 1;
    const current = rebuild;
    const position = quadPlayer.queueIndex();

    document.body.classList.add('wave-loading');
    try {
      const tracks = await music.waveNext({
        mode,
        count: FIRST_BATCH,
        exclude: queue.slice(0, position + 1).map(keyOf),
        previousArtist: mainArtist(queue[position]),
      });
      if (current !== rebuild || !isActive() || tracks.length === 0) return;

      const next = quadPlayer.queueIndex() + 1;
      queue.splice(next, queue.length, ...tracks);

      // Это смена режима, а не пропуск: трек не должен попасть в нелюбимые.
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

  document.addEventListener('quad:listen', ({ detail }) => {
    if (switching) return;
    const { track, played, duration, finished } = detail;
    const heard = played / duration;

    if (finished || heard >= FINISH_SHARE) {
      music.waveEvent(track, 'finish');
    } else if (played < SKIP_SECONDS && heard < SKIP_SHARE) {
      music.waveEvent(track, 'skip');
      if (isActive()) dropArtist(track);
    }
  });

  document.addEventListener('quad:track', () => {
    if (isActive() && queue.length - quadPlayer.queueIndex() <= REFILL_AT) refill();
    document.body.classList.toggle('wave-on', isActive());
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
      applyMode();
    });
  });

  showMode();
  window.quadWave = { start, isActive };
})();
