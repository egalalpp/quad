(() => {
  const buttons = document.querySelectorAll('[data-download]');
  const folderPath = document.getElementById('download-folder');
  const navItem = document.querySelector('[data-view="settings"]');

  const saved = new Set();
  const saving = new Set();

  const keyOf = (track) => `${track.provider}:${track.id}`;

  function render() {
    const track = quadPlayer.currentTrack();
    buttons.forEach((button) => {
      button.hidden = !track || track.canDownload === false;
      if (button.hidden) return;
      const key = keyOf(track);
      button.classList.toggle('is-busy', saving.has(key));
      button.classList.toggle('is-done', saved.has(key));
      button.classList.remove('is-failed');
      button.setAttribute('aria-label', saved.has(key) ? 'Сохранено' : 'Сохранить в папку');
    });
  }

  // Трек мог быть скачан раньше: после перезапуска галочка должна остаться.
  async function checkCurrent() {
    const track = quadPlayer.currentTrack();
    if (!track || saved.has(keyOf(track))) return;
    if (await music.isDownloaded(track)) {
      saved.add(keyOf(track));
      render();
    }
  }

  function fail() {
    buttons.forEach((button) => {
      button.classList.add('is-failed');
      button.setAttribute('aria-label', 'Не удалось сохранить');
    });
  }

  async function saveCurrent() {
    const track = quadPlayer.currentTrack();
    if (!track) return;

    const key = keyOf(track);
    if (saving.has(key) || saved.has(key)) return;

    saving.add(key);
    render();
    try {
      await music.saveTrack(track);
      saved.add(key);
      saving.delete(key);
      render();
      document.dispatchEvent(new CustomEvent('quad:library-changed'));
    } catch {
      saving.delete(key);
      render();
      fail();
    }
  }

  async function showFolder() {
    folderPath.textContent = await music.downloadFolder();
  }

  buttons.forEach((button) => button.addEventListener('click', saveCurrent));
  document.addEventListener('quad:track', () => {
    render();
    checkCurrent();
  });
  navItem.addEventListener('click', showFolder);

  document.getElementById('download-choose').addEventListener('click', async () => {
    folderPath.textContent = await music.chooseDownloadFolder();
  });
  document.getElementById('download-open').addEventListener('click', () => music.openDownloadFolder());
})();
