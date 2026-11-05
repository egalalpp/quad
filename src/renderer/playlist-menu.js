// Меню «добавить в плейлист». Открывается из плеера, страницы трека и любой строки списка.
(() => {
  const GAP = 10;
  const EDGE = 12;

  const menu = document.getElementById('playlist-menu');
  const list = document.getElementById('playlist-menu-list');
  const form = document.getElementById('playlist-menu-form');
  const input = document.getElementById('playlist-menu-input');
  const playerButtons = document.querySelectorAll('[data-add-playlist]');

  let menuTrack = null;
  let anchor = null;

  const hasTrack = (playlist, track) => playlist.tracks.some((item) => (
    item.provider === track.provider && item.id === track.id
  ));

  function close() {
    menu.hidden = true;
    anchor = null;
  }

  async function render() {
    const playlists = await music.playlists();

    list.replaceChildren(...playlists.map((playlist) => {
      const row = document.createElement('button');
      row.className = 'playlist-menu-item';
      row.textContent = playlist.title;
      row.classList.toggle('is-added', hasTrack(playlist, menuTrack));
      row.addEventListener('click', async () => {
        await music.togglePlaylistTrack(playlist.id, menuTrack);
        document.dispatchEvent(new CustomEvent('quad:library-changed'));
        render();
      });
      return row;
    }));
  }

  async function open(button, track) {
    if (anchor === button) {
      close();
      return;
    }

    menuTrack = track;
    anchor = button;
    await render();
    menu.hidden = false;

    // Над кнопкой, а если там не хватает места, то под ней.
    const box = button.getBoundingClientRect();
    const above = box.top - menu.offsetHeight - GAP;
    const left = Math.min(box.left, window.innerWidth - menu.offsetWidth - EDGE);
    menu.style.left = `${Math.max(EDGE, left)}px`;
    menu.style.top = `${above >= EDGE ? above : box.bottom + GAP}px`;
    input.focus();
  }

  playerButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      open(button, quadPlayer.currentTrack());
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const title = input.value.trim();
    if (!title) return;

    const playlist = await music.createPlaylist(title);
    await music.togglePlaylistTrack(playlist.id, menuTrack);
    input.value = '';
    document.dispatchEvent(new CustomEvent('quad:library-changed'));
    render();
  });

  menu.addEventListener('click', (event) => event.stopPropagation());

  document.addEventListener('click', (event) => {
    const button = event.target.closest('.row-add');
    if (button) open(button, button.closest('.track-row').quadTrack);
    else close();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });

  document.addEventListener('quad:track', () => {
    const playing = Boolean(quadPlayer.currentTrack());
    playerButtons.forEach((button) => {
      button.hidden = !playing;
    });
  });
})();
