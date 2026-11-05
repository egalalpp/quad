(() => {
  const playerButtons = document.querySelectorAll('[data-like]');

  let liked = new Set();

  const keyOf = (track) => `${track.provider}:${track.id}`;

  function render() {
    const current = quadPlayer.currentTrack();
    playerButtons.forEach((button) => {
      button.hidden = !current;
      if (!current) return;
      const isLiked = liked.has(keyOf(current));
      button.classList.toggle('is-liked', isLiked);
      button.setAttribute('aria-pressed', String(isLiked));
      button.setAttribute('aria-label', isLiked ? 'Убрать из «Мне нравится»' : 'Добавить в «Мне нравится»');
    });

    document.querySelectorAll('.track-row').forEach((row) => {
      row.querySelector('.row-like').classList.toggle('is-liked', liked.has(row.dataset.key));
    });
  }

  async function toggle(track) {
    const key = keyOf(track);
    const next = !liked.has(key);
    if (next) liked.add(key);
    else liked.delete(key);
    render();

    try {
      await music.setLiked(track.provider, track.id, next);
      if (next) music.waveEvent(track, 'like');
      document.dispatchEvent(new CustomEvent('quad:library-changed'));
    } catch {
      if (next) liked.delete(key);
      else liked.add(key);
      render();
    }
  }

  async function load() {
    try {
      liked = new Set(await music.likedKeys());
    } catch {
      liked = new Set();
    }
    render();
  }

  quadPlayer.isLiked = (track) => liked.has(keyOf(track));

  playerButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const track = quadPlayer.currentTrack();
      if (track) toggle(track);
    });
  });

  document.addEventListener('click', (event) => {
    const button = event.target.closest('.row-like');
    if (button) toggle(button.closest('.track-row').quadTrack);
  });

  document.addEventListener('quad:track', render);
  document.addEventListener('quad:accounts', load);
})();
